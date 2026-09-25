import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	accountOperations,
	analyticsFields,
	analyticsOperations,
	appFields,
	appOperations,
	databaseFields,
	databaseOperations,
	domainFields,
	domainOperations,
	fileFields,
	fileOperations,
	formFields,
	formOperations,
	taskFields,
	taskOperations,
} from './descriptions';
import {
	getTables,
	kleapApiRequest,
	parseJsonParameter,
	publishAndWait,
	resolveAppId,
	searchApps,
	simplifySubmission,
	toList,
	waitForTask,
} from './GenericFunctions';

export class Kleap implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kleap',
		name: 'kleap',
		icon: { light: 'file:kleap.svg', dark: 'file:kleap.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Build, edit and publish websites with AI, and read their form submissions and analytics',
		defaults: { name: 'Kleap' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'kleapApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Analytics', value: 'analytics' },
					{ name: 'App', value: 'app' },
					{ name: 'Database', value: 'database' },
					{ name: 'Domain', value: 'domain' },
					{ name: 'File', value: 'file' },
					{ name: 'Form Submission', value: 'formSubmission' },
					{ name: 'Task', value: 'task' },
				],
				default: 'app',
			},
			appOperations,
			...appFields,
			taskOperations,
			...taskFields,
			fileOperations,
			...fileFields,
			formOperations,
			...formFields,
			analyticsOperations,
			...analyticsFields,
			databaseOperations,
			...databaseFields,
			accountOperations,
			domainOperations,
			...domainFields,
		],
	};

	methods = {
		listSearch: { searchApps },
		loadOptions: { getTables },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const result = await runOperation.call(this, resource, operation, i);
				const results = Array.isArray(result) ? result : [result];
				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(results), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Already a NodeApiError / NodeOperationError: keep its message, point it at the item.
				const nodeError = error as NodeOperationError;
				if (nodeError.context) {
					nodeError.context.itemIndex = i;
					throw nodeError;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function runTask(
	this: IExecuteFunctions,
	i: number,
	appId: string | undefined,
	started: IDataObject,
): Promise<IDataObject> {
	const waitForCompletion = this.getNodeParameter('waitForCompletion', i) as boolean;
	if (!waitForCompletion) return started;

	const timeoutMinutes = this.getNodeParameter('timeoutMinutes', i) as number;
	const publishWhenDone = this.getNodeParameter('publishWhenDone', i, false) as boolean;
	const task = await waitForTask.call(this, started.task_id as string, timeoutMinutes, i);
	const output: IDataObject = { ...started, ...task };
	const result = (task.result as IDataObject | undefined) ?? {};
	output.production_url = result.production_url ?? null;
	output.preview_url = result.preview_url ?? started.preview_url ?? null;

	if (publishWhenDone && task.status === 'completed') {
		const targetAppId = appId ?? String(task.app_id ?? started.app_id);
		const publish = await publishAndWait.call(this, targetAppId, true, 10);
		output.publish = publish;
		if (publish.production_url) output.production_url = publish.production_url;
	}
	return output;
}

function taskBody(this: IExecuteFunctions, i: number, body: IDataObject): IDataObject {
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	if (options.idempotencyKey) body.idempotency_key = options.idempotencyKey;
	if (options.webhookUrl) body.webhook_url = options.webhookUrl;
	if (options.webhookSecret) body.webhook_secret = options.webhookSecret;
	body.metadata = { source: 'n8n', workflow_id: this.getWorkflow().id ?? null };
	return body;
}

async function runOperation(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (resource === 'app') {
		if (operation === 'create') {
			const prompt = (this.getNodeParameter('prompt', i) as string).trim();
			if (!prompt) throw new NodeOperationError(this.getNode(), 'The prompt is empty', { itemIndex: i });
			const body = taskBody.call(this, i, {
				prompt,
				visibility: this.getNodeParameter('visibility', i) as string,
			});
			const started = await kleapApiRequest.call(this, 'POST', '/apps', body);
			return runTask.call(this, i, started.app_id ? String(started.app_id) : undefined, started);
		}

		if (operation === 'resolve') {
			const query = this.getNodeParameter('query', i) as string;
			return kleapApiRequest.call(this, 'GET', '/apps/resolve', undefined, { q: query });
		}

		if (operation === 'getMany') {
			const returnAll = this.getNodeParameter('returnAll', i) as boolean;
			const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			const apps: IDataObject[] = [];
			let offset = 0;
			while (apps.length < limit) {
				const qs: IDataObject = { limit: Math.min(100, limit - apps.length), offset };
				if (filters.q) qs.q = filters.q;
				const page = await kleapApiRequest.call(this, 'GET', '/apps', undefined, qs);
				apps.push(...((page.apps as IDataObject[]) ?? []));
				const pagination = (page.pagination as IDataObject) ?? {};
				if (!pagination.has_more || pagination.next_offset == null) break;
				offset = pagination.next_offset as number;
			}
			return apps;
		}

		const appId = await resolveAppId.call(this, i);

		switch (operation) {
			case 'get':
				return kleapApiRequest.call(this, 'GET', `/apps/${appId}`);
			case 'sendMessage': {
				const message = (this.getNodeParameter('message', i) as string).trim();
				if (!message) throw new NodeOperationError(this.getNode(), 'The message is empty', { itemIndex: i });
				const started = await kleapApiRequest.call(
					this,
					'POST',
					`/apps/${appId}/messages`,
					taskBody.call(this, i, { message }),
				);
				return runTask.call(this, i, appId, { app_id: Number(appId), ...started });
			}
			case 'getMessages': {
				const limit = Math.min(100, this.getNodeParameter('limit', i) as number);
				const response = await kleapApiRequest.call(this, 'GET', `/apps/${appId}/messages`, undefined, {
					limit,
				});
				return (response.messages as IDataObject[]) ?? [];
			}
			case 'publish': {
				const waitForLive = this.getNodeParameter('waitForLive', i) as boolean;
				const timeoutMinutes = waitForLive ? (this.getNodeParameter('timeoutMinutes', i) as number) : 0;
				return publishAndWait.call(this, appId, waitForLive, timeoutMinutes);
			}
			case 'getPublishStatus':
				return kleapApiRequest.call(this, 'GET', `/apps/${appId}/publish`);
			case 'getScreenshot':
				return kleapApiRequest.call(this, 'GET', `/apps/${appId}/screenshot`);
			case 'rename':
				return kleapApiRequest.call(this, 'PATCH', `/apps/${appId}`, {
					name: this.getNodeParameter('name', i) as string,
				});
			case 'wake':
				return kleapApiRequest.call(this, 'POST', `/apps/${appId}/wake`);
			case 'getSearchConsole':
				return kleapApiRequest.call(this, 'GET', `/apps/${appId}/search-console`);
			case 'connectSearchConsole':
				return kleapApiRequest.call(this, 'POST', `/apps/${appId}/search-console/connect`);
			case 'generateImage': {
				const imageOptions = this.getNodeParameter('imageOptions', i, {}) as IDataObject;
				return kleapApiRequest.call(this, 'POST', `/apps/${appId}/generate-image`, {
					prompt: this.getNodeParameter('imagePrompt', i) as string,
					path: this.getNodeParameter('imagePath', i) as string,
					...imageOptions,
				});
			}
		}
	}

	if (resource === 'task') {
		const taskId = (this.getNodeParameter('taskId', i) as string).trim();
		const waitForCompletion = this.getNodeParameter('waitForCompletion', i) as boolean;
		const timeoutMinutes = waitForCompletion ? (this.getNodeParameter('timeoutMinutes', i) as number) : 0;
		let id = taskId;
		let retried: IDataObject | undefined;
		if (operation === 'retry') {
			retried = await kleapApiRequest.call(this, 'POST', `/tasks/${encodeURIComponent(taskId)}/retry`);
			id = retried.task_id as string;
			if (!waitForCompletion) return retried;
		}
		if (!waitForCompletion) {
			return kleapApiRequest.call(this, 'GET', `/tasks/${encodeURIComponent(id)}`);
		}
		const task = await waitForTask.call(this, id, timeoutMinutes, i);
		return retried ? { ...retried, ...task } : task;
	}

	if (resource === 'file') {
		const appId = await resolveAppId.call(this, i);
		switch (operation) {
			case 'getMany': {
				const response = await kleapApiRequest.call(this, 'GET', `/apps/${appId}/files`);
				return (response.files as IDataObject[]) ?? [];
			}
			case 'read': {
				const paths = toList(this.getNodeParameter('paths', i) as string);
				const response = await kleapApiRequest.call(this, 'GET', `/apps/${appId}/files`, undefined, {
					paths: paths.join(','),
				});
				const missing = (response.missing as string[]) ?? [];
				const files = (response.files as IDataObject[]) ?? [];
				return [...files, ...missing.map((path) => ({ path, missing: true }))];
			}
			case 'write': {
				const path = this.getNodeParameter('path', i) as string;
				const binaryData = this.getNodeParameter('binaryData', i) as boolean;
				let file: IDataObject;
				if (binaryData) {
					const field = this.getNodeParameter('binaryPropertyName', i) as string;
					this.helpers.assertBinaryData(i, field);
					const buffer = await this.helpers.getBinaryDataBuffer(i, field);
					file = { path, content: buffer.toString('base64'), encoding: 'base64' };
				} else {
					file = { path, content: this.getNodeParameter('content', i) as string };
				}
				return kleapApiRequest.call(this, 'PUT', `/apps/${appId}/files`, { files: [file] });
			}
			case 'edit':
				return kleapApiRequest.call(this, 'PATCH', `/apps/${appId}/files`, {
					edits: [
						{
							path: this.getNodeParameter('path', i) as string,
							old_string: this.getNodeParameter('oldString', i) as string,
							new_string: this.getNodeParameter('newString', i) as string,
							replace_all: this.getNodeParameter('replaceAll', i) as boolean,
						},
					],
				});
			case 'delete':
				return kleapApiRequest.call(this, 'DELETE', `/apps/${appId}/files`, {
					paths: toList(this.getNodeParameter('paths', i) as string),
				});
		}
	}

	if (resource === 'database') {
		const appId = await resolveAppId.call(this, i);
		const base = `/apps/${appId}/database`;
		const table = () =>
			`${base}/tables/${encodeURIComponent(this.getNodeParameter('table', i) as string)}/rows`;
		switch (operation) {
			case 'getSchema': {
				const schema = await kleapApiRequest.call(this, 'GET', base);
				return (schema.tables as IDataObject[]) ?? [];
			}
			case 'getRows': {
				const returnAll = this.getNodeParameter('returnAll', i) as boolean;
				const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
				const where = parseJsonParameter.call(this, 'where', i, {}) as IDataObject;
				const rowOptions = this.getNodeParameter('rowOptions', i, {}) as IDataObject;
				const rows: IDataObject[] = [];
				let offset = 0;
				while (rows.length < limit) {
					const qs: IDataObject = { limit: Math.min(500, limit - rows.length), offset };
					if (Object.keys(where).length) qs.where = JSON.stringify(where);
					if (rowOptions.orderBy) qs.order_by = rowOptions.orderBy;
					if (rowOptions.order) qs.order = rowOptions.order;
					const page = await kleapApiRequest.call(this, 'GET', table(), undefined, qs);
					const batch = (page.rows as IDataObject[]) ?? [];
					rows.push(...batch);
					if (!page.has_more || !batch.length) break;
					offset += batch.length;
				}
				return rows;
			}
			case 'insertRows': {
				const row = parseJsonParameter.call(this, 'row', i, {}) as IDataObject;
				const response = await kleapApiRequest.call(this, 'POST', table(), { rows: [row] });
				const inserted = (response.rows as IDataObject[]) ?? [];
				return inserted.length ? inserted : response;
			}
			case 'updateRows':
			case 'deleteRows': {
				const where = parseJsonParameter.call(this, 'where', i, {}) as IDataObject;
				if (!Object.keys(where).length) {
					throw new NodeOperationError(this.getNode(), 'Where must contain at least one condition', {
						itemIndex: i,
						description: 'This protects you from changing or deleting every row of the table by mistake.',
					});
				}
				if (operation === 'deleteRows') {
					return kleapApiRequest.call(this, 'DELETE', table(), { where });
				}
				const set = parseJsonParameter.call(this, 'set', i, {}) as IDataObject;
				const response = await kleapApiRequest.call(this, 'PATCH', table(), { where, set });
				const updated = (response.rows as IDataObject[]) ?? [];
				return updated.length ? updated : response;
			}
			case 'runSql': {
				const params = parseJsonParameter.call(this, 'params', i, []) as unknown[];
				const response = await kleapApiRequest.call(this, 'POST', `${base}/query`, {
					sql: this.getNodeParameter('sql', i) as string,
					params: Array.isArray(params) ? params : [params],
				});
				const rows = (response.rows as IDataObject[]) ?? [];
				return rows.length ? rows : { command: response.command, row_count: response.row_count };
			}
		}
	}

	if (resource === 'formSubmission' && operation === 'getMany') {
		const appId = await resolveAppId.call(this, i);
		const limit = Math.min(100, this.getNodeParameter('limit', i) as number);
		const simplify = this.getNodeParameter('simplify', i) as boolean;
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const qs: IDataObject = { limit };
		if (filters.since) qs.since = new Date(filters.since as string).toISOString();
		const response = await kleapApiRequest.call(this, 'GET', `/apps/${appId}/forms`, undefined, qs);
		const submissions = (response.submissions as IDataObject[]) ?? [];
		return simplify ? submissions.map((s) => simplifySubmission(s, appId)) : submissions;
	}

	if (resource === 'analytics' && operation === 'get') {
		const appId = await resolveAppId.call(this, i);
		return kleapApiRequest.call(this, 'GET', `/apps/${appId}/analytics`, undefined, {
			period: this.getNodeParameter('period', i) as string,
		});
	}

	if (resource === 'account' && operation === 'getCredits') {
		return kleapApiRequest.call(this, 'GET', '/account/credits');
	}

	if (resource === 'domain') {
		switch (operation) {
			case 'search': {
				// The API wants one label ("cafelumiere"), not a phrase; "Café Lumière" would be refused.
				const query = (this.getNodeParameter('query', i) as string)
					.trim()
					.toLowerCase()
					.normalize('NFD')
					.replace(/[\u0300-\u036f]/g, '')
					.replace(/\s+/g, '');
				const body: IDataObject = { query };
				const tlds = toList(this.getNodeParameter('tlds', i, '') as string).map((t) =>
					t.startsWith('.') ? t : `.${t}`,
				);
				if (tlds.length) body.tlds = tlds;
				const response = await kleapApiRequest.call(this, 'POST', '/domains/search', body);
				return (response.results as IDataObject[]) ?? [];
			}
			case 'buy': {
				const body: IDataObject = {
					domain: (this.getNodeParameter('domain', i) as string).trim().toLowerCase(),
					years: this.getNodeParameter('years', i) as number,
				};
				const connectAppId = (this.getNodeParameter('connectAppId', i, '') as string).trim();
				if (connectAppId) body.app_id = Number(connectAppId);
				return kleapApiRequest.call(this, 'POST', '/domains/checkout', body);
			}
			case 'check': {
				const domain = (this.getNodeParameter('domain', i) as string).trim();
				return kleapApiRequest.call(this, 'GET', `/domains/${encodeURIComponent(domain)}/check`);
			}
			case 'connect': {
				const appId = await resolveAppId.call(this, i);
				return kleapApiRequest.call(this, 'POST', '/domains/connect', {
					app_id: Number(appId),
					domain: (this.getNodeParameter('domain', i) as string).trim(),
				});
			}
		}
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation "${operation}" is not supported for "${resource}"`,
		{ itemIndex: i },
	);
}
