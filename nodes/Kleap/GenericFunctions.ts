import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type KleapContext = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;

const DEFAULT_BASE_URL = 'https://kleap.co/api/v1';

// The task long-poll holds the connection up to 50 s server-side; leave headroom.
const LONG_POLL_TIMEOUT_MS = 75_000;

interface KleapErrorBody {
	error?: { code?: string; message?: string; details?: IDataObject; request_id?: string };
}

function extractErrorBody(error: unknown): KleapErrorBody | undefined {
	const e = error as {
		response?: { data?: unknown; body?: unknown };
		cause?: { response?: { data?: unknown; body?: unknown } };
		description?: unknown;
	};
	const candidates = [
		e?.response?.data,
		e?.response?.body,
		e?.cause?.response?.data,
		e?.cause?.response?.body,
	];
	for (const candidate of candidates) {
		let parsed = candidate;
		if (typeof parsed === 'string') {
			try {
				parsed = JSON.parse(parsed);
			} catch {
				continue;
			}
		}
		if (parsed && typeof parsed === 'object' && 'error' in parsed) {
			return parsed as KleapErrorBody;
		}
	}
	return undefined;
}

function httpCodeOf(error: unknown): string | undefined {
	const e = error as {
		httpCode?: string;
		response?: { status?: number };
		cause?: { response?: { status?: number } };
	};
	const status = e?.response?.status ?? e?.cause?.response?.status;
	return e?.httpCode ?? (status ? String(status) : undefined);
}

type RawResult =
	| { ok: true; data: IDataObject }
	| { ok: false; error: unknown; kleapError?: KleapErrorBody['error'] };

async function kleapApiRequestRaw(
	this: KleapContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
	options: { timeout?: number } = {},
): Promise<RawResult> {
	const credentials = await this.getCredentials('kleapApi');
	const baseUrl = ((credentials.baseUrl as string) || DEFAULT_BASE_URL).replace(/\/+$/, '');

	const request: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		json: true,
		headers: { 'User-Agent': 'n8n-nodes-kleap' },
	};
	if (body && Object.keys(body).length) request.body = body;
	if (qs && Object.keys(qs).length) request.qs = qs;
	if (options.timeout) request.timeout = options.timeout;

	try {
		const data = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'kleapApi',
			request,
		)) as IDataObject;
		return { ok: true, data };
	} catch (error) {
		return { ok: false, error, kleapError: extractErrorBody(error)?.error };
	}
}

function toNodeApiError(this: KleapContext, failure: Extract<RawResult, { ok: false }>): NodeApiError {
	const { error, kleapError } = failure;
	if (!kleapError?.message) return new NodeApiError(this.getNode(), error as JsonObject);
	const details =
		kleapError.details && Object.keys(kleapError.details).length
			? ` Details: ${JSON.stringify(kleapError.details)}`
			: '';
	const requestId = kleapError.request_id ? ` (request ${kleapError.request_id})` : '';
	const httpCode = httpCodeOf(error);
	// Handing NodeApiError the raw HTTP error would make it replace our description with
	// response.data.error.message and drop the details (required credits, deploy key…).
	const errorResponse: JsonObject = {
		message: kleapError.message,
		httpCode: httpCode ?? null,
		code: kleapError.code ?? null,
		details: (kleapError.details as JsonObject) ?? null,
		request_id: kleapError.request_id ?? null,
	};
	return new NodeApiError(this.getNode(), errorResponse, {
		message: kleapError.code ? `${kleapError.code}: ${kleapError.message}` : kleapError.message,
		description: `${kleapError.message}${details}${requestId}`,
		httpCode,
	});
}

export async function kleapApiRequest(
	this: KleapContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
	options: { timeout?: number } = {},
): Promise<IDataObject> {
	const result = await kleapApiRequestRaw.call(this, method, endpoint, body, qs, options);
	if (result.ok) return result.data;
	throw toNodeApiError.call(this, result);
}

/** Same as kleapApiRequest, but returns the Kleap error code instead of throwing for the listed codes. */
export async function kleapApiRequestAllowing(
	this: KleapContext,
	allowedCodes: string[],
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
): Promise<{ data?: IDataObject; errorCode?: string; errorDetails?: IDataObject }> {
	const result = await kleapApiRequestRaw.call(this, method, endpoint, body);
	if (result.ok) return { data: result.data };
	const code = result.kleapError?.code;
	if (code && allowedCodes.includes(code)) return { errorCode: code, errorDetails: result.kleapError?.details };
	throw toNodeApiError.call(this, result);
}

/**
 * Long-polls GET /tasks/{id} until the task is completed or failed, or the deadline passes.
 * A failed task throws; a deadline returns the last state with `wait_timed_out: true` so the
 * workflow can keep the task_id and check again later.
 */
export async function waitForTask(
	this: IExecuteFunctions,
	taskId: string,
	timeoutMinutes: number,
	itemIndex: number,
): Promise<IDataObject> {
	const deadline = Date.now() + timeoutMinutes * 60_000;
	let task: IDataObject = {};
	while (true) {
		const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
		const wait = Math.max(0, Math.min(50, remainingSeconds));
		task = await kleapApiRequest.call(
			this,
			'GET',
			`/tasks/${encodeURIComponent(taskId)}`,
			undefined,
			{ wait },
			{ timeout: LONG_POLL_TIMEOUT_MS },
		);
		const status = task.status as string;
		if (status === 'completed') return task;
		if (status === 'failed') {
			const err = (task.error as IDataObject) ?? {};
			throw new NodeOperationError(
				this.getNode(),
				`Kleap task ${taskId} failed: ${(err.code as string) ?? 'TASK_FAILED'} ${(err.message as string) ?? ''}`.trim(),
				{
					itemIndex,
					description:
						'If some files were already written, the "Task → Retry" operation resumes the generation from them.',
				},
			);
		}
		if (Date.now() >= deadline) return { ...task, wait_timed_out: true };
		if (wait === 0) await sleep(3000);
	}
}

/**
 * Starts a deploy (unless one is already running) and long-polls its status until the site is live.
 * Returns the final publish status, including the post-deploy quality `report`.
 */
export async function publishAndWait(
	this: IExecuteFunctions,
	appId: string,
	waitForLive: boolean,
	timeoutMinutes: number,
): Promise<IDataObject> {
	const started = await kleapApiRequestAllowing.call(this, ['CONFLICT'], 'POST', `/apps/${appId}/publish`);
	const deployKey =
		(started.data?.deploy_key as string | undefined) ??
		(started.errorDetails?.deploy_key as string | undefined);

	if (!waitForLive) {
		return started.data ?? { id: Number(appId), status: 'deploying', deploy_key: deployKey, already_running: true };
	}

	const deadline = Date.now() + timeoutMinutes * 60_000;
	let status: IDataObject = {};
	while (true) {
		const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
		const wait = Math.max(0, Math.min(45, remainingSeconds));
		const qs: IDataObject = { wait };
		if (deployKey) qs.deploy_key = deployKey;
		status = await kleapApiRequest.call(this, 'GET', `/apps/${appId}/publish`, undefined, qs, {
			timeout: LONG_POLL_TIMEOUT_MS,
		});
		if (status.status === 'published') return status;
		if (Date.now() >= deadline) return { ...status, wait_timed_out: true };
		if (wait === 0) await sleep(3000);
	}
}

/** Resolves the "App" resource locator to a numeric app id, whatever mode the user picked. */
export async function resolveAppId(
	this: IExecuteFunctions,
	itemIndex: number,
	parameterName = 'appId',
): Promise<string> {
	const locator = this.getNodeParameter(parameterName, itemIndex) as
		| { mode?: string; value?: string | number }
		| string
		| number;
	const mode = typeof locator === 'object' ? locator.mode : 'id';
	const raw = String(typeof locator === 'object' ? (locator.value ?? '') : locator).trim();

	if (!raw) {
		throw new NodeOperationError(this.getNode(), 'No app selected', { itemIndex });
	}
	if (mode === 'url' || !/^\d+$/.test(raw)) {
		const match = await kleapApiRequest.call(this, 'GET', '/apps/resolve', undefined, { q: raw });
		return String(match.app_id);
	}
	return raw;
}

export async function searchApps(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const offset = paginationToken ? Number(paginationToken) : 0;
	const qs: IDataObject = { limit: 50, offset };
	if (filter) qs.q = filter;
	const response = await kleapApiRequest.call(this, 'GET', '/apps', undefined, qs);
	const apps = (response.apps as IDataObject[]) ?? [];
	const pagination = (response.pagination as IDataObject) ?? {};
	return {
		results: apps.map((app) => ({
			name: `${(app.name as string) || (app.slug as string)} (#${app.id as number})`,
			value: String(app.id),
			url: (app.production_url as string) || (app.preview_url as string) || undefined,
		})),
		paginationToken: pagination.has_more ? String(pagination.next_offset) : undefined,
	};
}

export function toList(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((v) => v.trim())
		.filter(Boolean);
}

export function simplifySubmission(submission: IDataObject, appId: string): IDataObject {
	const data = (submission.data as IDataObject) ?? {};
	return {
		...data,
		submission_id: submission.id,
		submitted_at: submission.submitted_at,
		app_id: Number(appId),
	};
}
