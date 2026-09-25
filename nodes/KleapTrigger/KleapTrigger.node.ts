import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { appLocator } from '../Kleap/descriptions';
import { getColumns, getTables, kleapApiRequest, searchApps, simplifySubmission } from '../Kleap/GenericFunctions';

// The shared locator is scoped to a resource; the trigger has none, so drop its displayOptions.
const { displayOptions: _unused, ...appProperty } = appLocator(['app']);

interface TriggerState {
	appId?: string;
	lastSubmittedAt?: string;
	seenIds?: number[];
	// New App / New Database Row
	scope?: string;
	cursor?: string | number;
	seenKeys?: string[];
}

export class KleapTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kleap Trigger',
		name: 'kleapTrigger',
		icon: { light: 'file:kleap.svg', dark: 'file:kleap.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when a visitor submits a form on a Kleap website',
		defaults: { name: 'Kleap Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'kleapApi', required: true }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'New App',
						value: 'app',
						description: 'A new app was created in your Kleap account',
					},
					{
						name: 'New Database Row',
						value: 'databaseRow',
						description: 'A row was added to a table of the app’s database (for example a signup or an order)',
					},
					{
						name: 'New Form Submission',
						value: 'formSubmission',
						description: 'A visitor sent a contact, booking, signup or any other form on the site',
					},
				],
				default: 'formSubmission',
			},
			{ ...appProperty, displayOptions: { show: { event: ['formSubmission', 'databaseRow'] } } },
			{
				displayName: 'Table Name or ID',
				name: 'table',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTables', loadOptionsDependsOn: ['appId.value'] },
				default: '',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { event: ['databaseRow'] } },
			},
			{
				displayName: 'Detect New Rows With Column Name or ID',
				name: 'cursorColumn',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getColumns', loadOptionsDependsOn: ['appId.value', 'table'] },
				default: 'created_at',
				required: true,
				description:
					'A column that grows with each new row, like created_at or ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { event: ['databaseRow'] } },
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					'Whether to put the submitted form fields at the top level of each item instead of under "data"',
				displayOptions: { show: { event: ['formSubmission'] } },
			},
		],
	};

	methods = {
		listSearch: { searchApps },
		loadOptions: { getTables, getColumns },
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		if (event === 'app') return pollNewRecords.call(this, 'apps', '/apps', { limit: 50 }, 'created_at', 'apps');
		if (event === 'databaseRow') {
			const appId = await resolvePollAppId.call(this);
			const table = this.getNodeParameter('table') as string;
			const cursorColumn = this.getNodeParameter('cursorColumn') as string;
			return pollNewRecords.call(
				this,
				`db:${appId}:${table}:${cursorColumn}`,
				`/apps/${appId}/database/tables/${encodeURIComponent(table)}/rows`,
				{ limit: 100, order_by: cursorColumn, order: 'desc' },
				cursorColumn,
				'rows',
			);
		}
		return pollFormSubmissions.call(this);
	}
}

/**
 * Generic "newest first" poller: remembers the highest cursor value seen, emits records above it
 * (and records equal to it that were not seen yet), oldest first. No backfill on activation.
 */
async function pollNewRecords(
	this: IPollFunctions,
	scope: string,
	endpoint: string,
	qs: IDataObject,
	cursorField: string,
	listField: string,
): Promise<INodeExecutionData[][] | null> {
	const state = this.getWorkflowStaticData('node') as TriggerState;
	const response = await kleapApiRequest.call(this, 'GET', endpoint, undefined, qs);
	const records = ((response[listField] as IDataObject[]) ?? []).filter((r) => r[cursorField] != null);
	const keyOf = (r: IDataObject) => String(r.id ?? JSON.stringify(r));
	const valueOf = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v)) || String(v));
	const compare = (a: unknown, b: unknown) => {
		const x = valueOf(a);
		const y = valueOf(b);
		return x > y ? 1 : x < y ? -1 : 0;
	};

	if (this.getMode() === 'manual') {
		if (!records.length) {
			throw new NodeOperationError(this.getNode(), 'Nothing found yet. Create one, then test again.');
		}
		return [this.helpers.returnJsonArray(records.slice(0, 1))];
	}

	if (state.scope !== scope || state.cursor === undefined) {
		state.scope = scope;
		state.cursor = (records[0]?.[cursorField] as string | number | undefined) ?? new Date().toISOString();
		state.seenKeys = records.filter((r) => compare(r[cursorField], state.cursor) === 0).map(keyOf);
		return null;
	}

	const seen = new Set(state.seenKeys ?? []);
	const fresh = records
		.filter((r) => {
			const c = compare(r[cursorField], state.cursor);
			return c > 0 || (c === 0 && !seen.has(keyOf(r)));
		})
		.sort((a, b) => compare(a[cursorField], b[cursorField]));
	if (!fresh.length) return null;

	const newest = fresh[fresh.length - 1][cursorField] as string | number;
	if (compare(newest, state.cursor) > 0) {
		state.cursor = newest;
		state.seenKeys = [];
	}
	state.seenKeys = [
		...new Set([
			...(state.seenKeys ?? []),
			...records.filter((r) => compare(r[cursorField], state.cursor) === 0).map(keyOf),
		]),
	];
	return [this.helpers.returnJsonArray(fresh)];
}

async function pollFormSubmissions(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
	const state = this.getWorkflowStaticData('node') as TriggerState;
	const simplify = this.getNodeParameter('simplify') as boolean;
	const appId = await resolvePollAppId.call(this);
	const isManual = this.getMode() === 'manual';

	// Switching the app starts a fresh cursor instead of replaying the new app's history.
	if (state.appId !== appId) {
		state.appId = appId;
		state.lastSubmittedAt = undefined;
		state.seenIds = [];
	}

	const qs: IDataObject = { limit: isManual ? 1 : 100 };
	if (!isManual && state.lastSubmittedAt) qs.since = state.lastSubmittedAt;
	const response = await kleapApiRequest.call(this, 'GET', `/apps/${appId}/forms`, undefined, qs);
	const submissions = ((response.submissions as IDataObject[]) ?? []).filter(
		(s) => typeof s.submitted_at === 'string',
	);

	if (isManual) {
		if (!submissions.length) {
			throw new NodeOperationError(
				this.getNode(),
				'This site has no form submission yet. Submit its form once, then test again.',
			);
		}
		return [this.helpers.returnJsonArray(submissions.map((s) => format(s, appId, simplify)))];
	}

	// First activation: remember where we are, emit nothing (no backfill of old submissions).
	if (!state.lastSubmittedAt) {
		state.lastSubmittedAt = submissions[0]?.submitted_at
			? (submissions[0].submitted_at as string)
			: new Date().toISOString();
		state.seenIds = submissions
			.filter((s) => s.submitted_at === state.lastSubmittedAt)
			.map((s) => s.id as number);
		return null;
	}

	const seen = new Set(state.seenIds ?? []);
	const fresh = submissions
		.filter((s) => !seen.has(s.id as number))
		.sort((a, b) => Date.parse(a.submitted_at as string) - Date.parse(b.submitted_at as string));

	if (!fresh.length) return null;

	const newest = fresh[fresh.length - 1].submitted_at as string;
	if (Date.parse(newest) > Date.parse(state.lastSubmittedAt)) {
		state.lastSubmittedAt = newest;
		state.seenIds = [];
	}
	// `since` is inclusive: remember every id sitting exactly on the cursor so it is not emitted twice.
	state.seenIds = [
		...new Set([
			...(state.seenIds ?? []),
			...submissions.filter((s) => s.submitted_at === state.lastSubmittedAt).map((s) => s.id as number),
		]),
	];

	return [this.helpers.returnJsonArray(fresh.map((s) => format(s, appId, simplify)))];
}

function format(submission: IDataObject, appId: string, simplify: boolean): IDataObject {
	return simplify ? simplifySubmission(submission, appId) : { ...submission, app_id: Number(appId) };
}

async function resolvePollAppId(this: IPollFunctions): Promise<string> {
	const locator = this.getNodeParameter('appId') as { mode?: string; value?: string | number } | string;
	const mode = typeof locator === 'object' ? locator.mode : 'id';
	const raw = String(typeof locator === 'object' ? (locator.value ?? '') : locator).trim();
	if (!raw) throw new NodeOperationError(this.getNode(), 'No app selected');
	if (mode === 'url' || !/^\d+$/.test(raw)) {
		const match = await kleapApiRequest.call(this, 'GET', '/apps/resolve', undefined, { q: raw });
		return String(match.app_id);
	}
	return raw;
}
