// Minimal stand-in for n8n's IExecuteFunctions / IPollFunctions, enough to run the compiled
// nodes against either a scripted fake API (unit tests) or the real Kleap API (e2e).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { Kleap } = require('../dist/nodes/Kleap/Kleap.node.js');
export const { KleapTrigger } = require('../dist/nodes/KleapTrigger/KleapTrigger.node.js');

const NODE = { id: 'n1', name: 'Kleap', type: 'n8n-nodes-kleap.kleap', typeVersion: 1, position: [0, 0], parameters: {} };

/** Mimics the error n8n's httpRequest throws: an axios-style error with response.status/data. */
export function httpError(status, body) {
	const error = new Error(`Request failed with status code ${status}`);
	error.response = { status, data: body };
	return error;
}

/**
 * @param {object} opts
 * @param {object | object[]} opts.params node parameters (one object, or one per input item)
 * @param {(req: object) => Promise<object> | object} opts.http called for each authenticated request
 * @param {object} [opts.credentials]
 * @param {object} [opts.staticData] persisted between poll() calls
 * @param {string} [opts.mode] 'trigger' | 'manual'
 * @param {object[]} [opts.items]
 */
export function makeContext({ params, http, credentials, staticData = {}, mode = 'trigger', items, binary }) {
	const paramsPerItem = Array.isArray(params) ? params : [params];
	const inputItems = items ?? paramsPerItem.map(() => ({ json: {}, binary }));
	const creds = credentials ?? { apiKey: 'kleap_live_sk_test', baseUrl: 'https://kleap.test/api/v1' };
	const requests = [];

	const ctx = {
		requests,
		staticData,
		getNode: () => NODE,
		getMode: () => mode,
		getWorkflow: () => ({ id: 'wf_test', name: 'test', active: true }),
		getInputData: () => inputItems,
		getCredentials: async () => creds,
		getWorkflowStaticData: () => staticData,
		continueOnFail: () => false,
		getNodeParameter(name, itemIndexOrFallback, fallback) {
			const isPoll = typeof itemIndexOrFallback !== 'number';
			const p = paramsPerItem[isPoll ? 0 : itemIndexOrFallback] ?? paramsPerItem[0];
			if (name in p) return p[name];
			const fb = isPoll ? itemIndexOrFallback : fallback;
			if (fb !== undefined) return fb;
			throw new Error(`Missing test parameter "${name}"`);
		},
		helpers: {
			async httpRequestWithAuthentication(credentialType, request) {
				if (credentialType !== 'kleapApi') throw new Error('wrong credential type');
				requests.push(request);
				return http({ ...request, headers: { ...request.headers, Authorization: `Bearer ${creds.apiKey}` } });
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (items, { itemData }) => items.map((it) => ({ ...it, pairedItem: itemData })),
			assertBinaryData(i, field) {
				const b = inputItems[i].binary?.[field];
				if (!b) throw new Error(`No binary field "${field}"`);
				return b;
			},
			async getBinaryDataBuffer(i, field) {
				return Buffer.from(inputItems[i].binary[field].data, 'base64');
			},
		},
	};
	return ctx;
}

/** Real HTTP, for the e2e script. */
export async function realHttp(req) {
	const url = new URL(req.url);
	for (const [k, v] of Object.entries(req.qs ?? {})) url.searchParams.set(k, String(v));
	const res = await fetch(url, {
		method: req.method,
		headers: { 'Content-Type': 'application/json', ...req.headers },
		body: req.body ? JSON.stringify(req.body) : undefined,
		signal: req.timeout ? AbortSignal.timeout(req.timeout) : undefined,
	});
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	if (!res.ok) throw httpError(res.status, data);
	return data;
}
