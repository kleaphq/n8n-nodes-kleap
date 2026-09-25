import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Kleap, KleapTrigger, httpError, makeContext } from './harness.mjs';

const run = (ctx) => new Kleap().execute.call(ctx);
const poll = (ctx) => new KleapTrigger().poll.call(ctx);
const app = (id) => ({ mode: 'id', value: String(id) });

test('create + wait: long-polls the task until completed and surfaces production_url', async () => {
	let polls = 0;
	const ctx = makeContext({
		params: {
			resource: 'app',
			operation: 'create',
			prompt: 'A site for a bakery',
			visibility: 'personal',
			waitForCompletion: true,
			publishWhenDone: false,
			timeoutMinutes: 5,
			options: { idempotencyKey: 'row-42' },
		},
		http: (req) => {
			if (req.method === 'POST' && req.url.endsWith('/apps')) {
				assert.equal(req.body.prompt, 'A site for a bakery');
				assert.equal(req.body.idempotency_key, 'row-42');
				assert.equal(req.body.metadata.source, 'n8n');
				return { task_id: 't1', app_id: 7, build_url: 'https://kleap.co/build/t1' };
			}
			if (req.url.endsWith('/tasks/t1')) {
				assert.equal(req.qs.wait, 50);
				polls++;
				return polls < 3
					? { task_id: 't1', status: 'processing', progress: polls * 30 }
					: {
							task_id: 't1',
							status: 'completed',
							app_id: 7,
							result: { preview_url: 'https://p', production_url: null, response: 'done' },
						};
			}
			throw new Error(`unexpected ${req.method} ${req.url}`);
		},
	});
	const [[out]] = await run(ctx);
	assert.equal(polls, 3);
	assert.equal(out.json.status, 'completed');
	assert.equal(out.json.app_id, 7);
	assert.equal(out.json.build_url, 'https://kleap.co/build/t1');
	assert.equal(out.json.production_url, null);
	assert.equal(out.json.preview_url, 'https://p');
});

test('a failed task throws with its error code', async () => {
	const ctx = makeContext({
		params: {
			resource: 'task',
			operation: 'get',
			taskId: 't9',
			waitForCompletion: true,
			timeoutMinutes: 1,
		},
		http: () => ({ task_id: 't9', status: 'failed', error: { code: 'TASK_TIMEOUT', message: 'stuck' } }),
	});
	await assert.rejects(run(ctx), /TASK_TIMEOUT stuck/);
});

test('Kleap error envelope becomes "CODE: message" on the node error', async () => {
	const ctx = makeContext({
		params: { resource: 'app', operation: 'sendMessage', appId: app(5), message: 'x', waitForCompletion: false },
		http: () => {
			throw httpError(402, {
				error: { code: 'INSUFFICIENT_CREDITS', message: 'Not enough credits', details: { balance: 1, required: 2 }, request_id: 'req_1' },
			});
		},
	});
	await assert.rejects(run(ctx), (err) => {
		assert.match(err.message, /^INSUFFICIENT_CREDITS: Not enough credits/);
		assert.match(err.description, /"required":2/);
		assert.match(err.description, /req_1/);
		return true;
	});
});

test('publish: a deploy already running (409) is joined, not treated as a failure', async () => {
	let statusCalls = 0;
	const ctx = makeContext({
		params: { resource: 'app', operation: 'publish', appId: app(12), waitForLive: true, timeoutMinutes: 5 },
		http: (req) => {
			if (req.method === 'POST') {
				throw httpError(409, { error: { code: 'CONFLICT', message: 'Deploy in progress', details: { deploy_key: 'u:12' } } });
			}
			assert.equal(req.qs.deploy_key, 'u:12');
			statusCalls++;
			return statusCalls < 2
				? { status: 'running', current_step: 'build' }
				: { status: 'published', production_url: 'https://x.kleap.io', report: { verdict: 'ok' } };
		},
	});
	const [[out]] = await run(ctx);
	assert.equal(out.json.status, 'published');
	assert.equal(out.json.production_url, 'https://x.kleap.io');
	assert.equal(statusCalls, 2);
});

test('the URL mode of the app locator resolves through /apps/resolve', async () => {
	const ctx = makeContext({
		params: { resource: 'app', operation: 'get', appId: { mode: 'url', value: 'https://cafe.kleap.io' } },
		http: (req) => {
			if (req.url.endsWith('/apps/resolve')) {
				assert.equal(req.qs.q, 'https://cafe.kleap.io');
				return { app_id: 99 };
			}
			assert.ok(req.url.endsWith('/apps/99'));
			return { id: 99, name: 'Café' };
		},
	});
	const [[out]] = await run(ctx);
	assert.equal(out.json.id, 99);
});

test('getMany apps follows pagination until the limit', async () => {
	const ctx = makeContext({
		params: { resource: 'app', operation: 'getMany', returnAll: true, filters: {} },
		http: (req) => {
			const offset = req.qs.offset;
			if (offset === 0) return { apps: [{ id: 1 }, { id: 2 }], pagination: { has_more: true, next_offset: 2 } };
			return { apps: [{ id: 3 }], pagination: { has_more: false, next_offset: null } };
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(out.map((o) => o.json.id), [1, 2, 3]);
});

test('file write from a binary field sends base64', async () => {
	const ctx = makeContext({
		params: { resource: 'file', operation: 'write', appId: app(3), path: 'public/logo.png', binaryData: true, binaryPropertyName: 'data' },
		binary: { data: { data: Buffer.from('PNGDATA').toString('base64'), mimeType: 'image/png' } },
		http: (req) => {
			assert.equal(req.method, 'PUT');
			assert.deepEqual(req.body.files, [{ path: 'public/logo.png', content: Buffer.from('PNGDATA').toString('base64'), encoding: 'base64' }]);
			return { written: 1 };
		},
	});
	const [[out]] = await run(ctx);
	assert.equal(out.json.written, 1);
});

test('form submissions are flattened when Simplify is on', async () => {
	const ctx = makeContext({
		params: { resource: 'formSubmission', operation: 'getMany', appId: app(4), limit: 500, simplify: true, filters: {} },
		http: (req) => {
			assert.equal(req.qs.limit, 100, 'limit is clamped to the API max');
			return { submissions: [{ id: 1, submitted_at: '2026-09-25T10:00:00Z', data: { email: 'a@b.c', message: 'hi' } }] };
		},
	});
	const [[out]] = await run(ctx);
	assert.deepEqual(out.json, { email: 'a@b.c', message: 'hi', submission_id: 1, submitted_at: '2026-09-25T10:00:00Z', app_id: 4 });
});

test('trigger: no backfill on activation, then each new submission exactly once', async () => {
	let submissions = [
		{ id: 1, submitted_at: '2026-09-25T10:00:00.000Z', data: { n: 1 } },
		{ id: 2, submitted_at: '2026-09-25T09:00:00.000Z', data: { n: 2 } },
	];
	const sinceSeen = [];
	const staticData = {};
	const params = { event: 'formSubmission', appId: app(8), simplify: true };
	const http = (req) => {
		sinceSeen.push(req.qs.since);
		const since = req.qs.since ? Date.parse(req.qs.since) : -Infinity;
		return { submissions: submissions.filter((s) => Date.parse(s.submitted_at) >= since) };
	};
	const ctx = () => makeContext({ params, http, staticData });

	assert.equal(await poll(ctx()), null, 'first activation emits nothing');
	assert.equal(staticData.lastSubmittedAt, '2026-09-25T10:00:00.000Z');

	assert.equal(await poll(ctx()), null, 'the submission sitting on the cursor is not replayed');

	// two new ones, one of them at the very same timestamp as the cursor
	submissions = [
		{ id: 4, submitted_at: '2026-09-25T11:00:00.000Z', data: { n: 4 } },
		{ id: 3, submitted_at: '2026-09-25T10:00:00.000Z', data: { n: 3 } },
		...submissions,
	];
	const [out] = await poll(ctx());
	assert.deepEqual(out.map((o) => o.json.submission_id), [3, 4], 'oldest first, each once');

	assert.equal(await poll(ctx()), null, 'nothing new');
	assert.equal(sinceSeen.at(-1), '2026-09-25T11:00:00.000Z');
});

test('trigger: manual test returns the latest submission', async () => {
	const ctx = makeContext({
		params: { event: 'formSubmission', appId: app(8), simplify: false },
		mode: 'manual',
		http: (req) => {
			assert.equal(req.qs.limit, 1);
			return { submissions: [{ id: 5, submitted_at: '2026-09-25T10:00:00Z', data: { a: 1 } }] };
		},
	});
	const [out] = await poll(ctx);
	assert.equal(out[0].json.id, 5);
	assert.equal(out[0].json.app_id, 8);
});
