import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { appLocator } from '../Kleap/descriptions';
import { kleapApiRequest, searchApps, simplifySubmission } from '../Kleap/GenericFunctions';

// The shared locator is scoped to a resource; the trigger has none, so drop its displayOptions.
const { displayOptions: _unused, ...appProperty } = appLocator(['app']);

interface TriggerState {
	appId?: string;
	lastSubmittedAt?: string;
	seenIds?: number[];
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
						name: 'New Form Submission',
						value: 'formSubmission',
						description: 'A visitor sent a contact, booking, signup or any other form on the site',
					},
				],
				default: 'formSubmission',
			},
			appProperty,
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					'Whether to put the submitted form fields at the top level of each item instead of under "data"',
			},
		],
	};

	methods = {
		listSearch: { searchApps },
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
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
