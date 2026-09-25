// End-to-end run of the compiled node against the real Kleap API.
//   KLEAP_API_KEY=kleap_live_sk_... node scripts/e2e.mjs read            (no credits spent)
//   KLEAP_API_KEY=kleap_live_sk_... node scripts/e2e.mjs build           (creates + edits + publishes a site)
import { Kleap, KleapTrigger, makeContext, realHttp } from '../test/harness.mjs';

const apiKey = process.env.KLEAP_API_KEY;
if (!apiKey) throw new Error('KLEAP_API_KEY is required');
const credentials = { apiKey, baseUrl: process.env.KLEAP_BASE_URL ?? 'https://kleap.co/api/v1' };
const phase = process.argv[2] ?? 'read';

async function step(label, params, { trigger = false, mode } = {}) {
	const ctx = makeContext({ params, http: realHttp, credentials, mode });
	const started = Date.now();
	try {
		const out = trigger ? await new KleapTrigger().poll.call(ctx) : await new Kleap().execute.call(ctx);
		const items = out?.[0] ?? [];
		const secs = ((Date.now() - started) / 1000).toFixed(1);
		console.log(`✔ ${label} — ${items.length} item(s), ${secs}s`);
		return items.map((i) => i.json);
	} catch (err) {
		console.log(`✘ ${label} — ${err.message}${err.description ? ` | ${err.description}` : ''} (http ${err.httpCode ?? '?'})`);
		return null;
	}
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

if (phase === 'read') {
	const [credits] = await step('Account → Get Credits', { resource: 'account', operation: 'getCredits' });
	console.log('  ', credits);

	const apps = await step('App → Get Many (limit 5)', { resource: 'app', operation: 'getMany', returnAll: false, limit: 5, filters: {} });
	const target = apps.find((a) => a.production_url) ?? apps[0];
	console.log('   target:', pick(target, ['id', 'name', 'production_url']));
	const appId = { mode: 'list', value: String(target.id) };

	const listCtx = makeContext({ params: {}, http: realHttp, credentials });
	const found = await new Kleap().methods.listSearch.searchApps.call(listCtx, target.name?.slice(0, 5));
	console.log(`✔ App locator list search "${target.name?.slice(0, 5)}" — ${found.results.length} result(s), first: ${found.results[0]?.name}`);

	const [detail] = await step('App → Get', { resource: 'app', operation: 'get', appId });
	console.log('  ', pick(detail, ['id', 'slug', 'first_turn_complete']));

	if (target.production_url) {
		const [resolved] = await step('App → Resolve (by production URL)', { resource: 'app', operation: 'resolve', query: target.production_url });
		console.log('   resolved app_id:', resolved?.app_id, resolved?.app_id === target.id ? '(match)' : '(MISMATCH)');
		await step('App → Get via locator "By Site URL"', { resource: 'app', operation: 'get', appId: { mode: 'url', value: target.production_url } });
	}

	const files = await step('File → Get Many', { resource: 'file', operation: 'getMany', appId });
	const page = files?.find((f) => f.path === 'src/pages/index.astro') ?? files?.[0];
	const read = await step(`File → Read (${page?.path})`, { resource: 'file', operation: 'read', appId, paths: `${page?.path}, does/not/exist.txt` });
	console.log('   ', read?.map((f) => pick(f, ['path', 'bytes', 'missing'])));

	const msgs = await step('App → Get Messages (limit 3)', { resource: 'app', operation: 'getMessages', appId, limit: 3 });
	console.log('   roles:', msgs?.map((m) => m.role));

	const [status] = await step('App → Get Publish Status', { resource: 'app', operation: 'getPublishStatus', appId });
	console.log('  ', pick(status ?? {}, ['status', 'production_url']), status?.report ? `report verdict=${status.report.verdict}` : '');

	const subs = await step('Form Submission → Get Many', { resource: 'formSubmission', operation: 'getMany', appId, limit: 5, simplify: true, filters: {} });
	console.log('   submissions:', subs?.length);
	const [analytics] = await step('Analytics → Get (30d)', { resource: 'analytics', operation: 'get', appId, period: '30d' });
	console.log('  ', pick(analytics ?? {}, ['configured', 'visitors', 'pageviews']));

	const domains = await step('Domain → Search', { resource: 'domain', operation: 'search', query: 'cafe lumiere lausanne', tlds: 'ch, com' });
	console.log('  ', domains?.map((d) => `${d.domain}:${d.status}:${d.price}`).join('  '));

	await step('Trigger → manual test', { event: 'formSubmission', appId, simplify: true }, { trigger: true, mode: 'manual' });
	await step('Trigger → activation poll', { event: 'formSubmission', appId, simplify: true }, { trigger: true });

	await step('Error path: App → Get on an app that is not ours (expect 404)', { resource: 'app', operation: 'get', appId: { mode: 'id', value: '1' } });
	const badCtx = makeContext({ params: { resource: 'account', operation: 'getCredits' }, http: realHttp, credentials: { ...credentials, apiKey: 'kleap_live_sk_00000000000000000000000000000000' } });
	await new Kleap().execute.call(badCtx).then(
		() => console.log('✘ bad key accepted?!'),
		(e) => console.log(`✔ Error path: bad key → ${e.message} (http ${e.httpCode})`),
	);
}

if (phase === 'build') {
	const stamp = new Date().toISOString().slice(0, 16);
	const [created] = await step('App → Create + wait + publish', {
		resource: 'app',
		operation: 'create',
		prompt: `One-page website for "Atelier Nord", a small ceramics studio in Lausanne: hero, three featured pieces, opening hours and a contact form. (n8n node e2e ${stamp})`,
		visibility: 'personal',
		waitForCompletion: true,
		publishWhenDone: true,
		timeoutMinutes: 25,
		options: { idempotencyKey: `n8n-e2e-${stamp}` },
	});
	if (!created) process.exit(1);
	console.log('  ', pick(created, ['app_id', 'task_id', 'status', 'build_url', 'preview_url', 'production_url', 'wait_timed_out']));
	console.log('   publish:', pick(created.publish ?? {}, ['status', 'production_url', 'duration_seconds']), created.publish?.report?.verdict);
	const appId = { mode: 'id', value: String(created.app_id) };

	const [edited] = await step('App → Edit With AI + wait', {
		resource: 'app',
		operation: 'sendMessage',
		appId,
		message: 'Change the opening hours to: Tuesday to Saturday, 10:00–18:00. Closed Sunday and Monday.',
		waitForCompletion: true,
		publishWhenDone: false,
		timeoutMinutes: 20,
		options: {},
	});
	console.log('  ', pick(edited ?? {}, ['status', 'task_id']), 'files:', edited?.result?.files_changed?.map((f) => f.path));

	await step('File → Write (text)', { resource: 'file', operation: 'write', appId, path: 'public/n8n-e2e.txt', binaryData: false, content: `written by n8n-nodes-kleap e2e at ${stamp}\n` });
	await step('File → Edit (find/replace)', { resource: 'file', operation: 'edit', appId, path: 'public/n8n-e2e.txt', oldString: 'written by', newString: 'Written by', replaceAll: false });
	const [check] = await step('File → Read back', { resource: 'file', operation: 'read', appId, paths: 'public/n8n-e2e.txt' });
	console.log('   content:', JSON.stringify(check?.content));

	const [published] = await step('App → Publish + wait until live', { resource: 'app', operation: 'publish', appId, waitForLive: true, timeoutMinutes: 10 });
	console.log('  ', pick(published ?? {}, ['status', 'production_url', 'wait_timed_out']));
	if (published?.production_url) {
		const res = await fetch(`${published.production_url.replace(/\/$/, '')}/n8n-e2e.txt`);
		console.log(`   GET ${published.production_url}/n8n-e2e.txt → ${res.status} ${JSON.stringify((await res.text()).slice(0, 60))}`);
		const home = await fetch(published.production_url);
		const html = await home.text();
		console.log(`   GET ${published.production_url} → ${home.status}, mentions "Atelier Nord": ${/Atelier Nord/i.test(html)}, new hours: ${/10:00/.test(html)}`);
	}
	await step('File → Delete', { resource: 'file', operation: 'delete', appId, paths: 'public/n8n-e2e.txt' });
	const [shot] = await step('App → Get Screenshot', { resource: 'app', operation: 'getScreenshot', appId });
	console.log('  ', pick(shot ?? {}, ['image_url', 'cached']));
	console.log(`APP_ID=${created.app_id}`);
}

if (phase === 'db') {
	// Needs an app with a Kleap Database and a table n8n_e2e_leads(id, email, status, created_at).
	const appId = { mode: 'id', value: process.env.KLEAP_DB_APP_ID ?? '104139' };
	const email = `n8n-e2e-${Date.now()}@example.com`;
	const schema = await step('Database → Get Schema', { resource: 'database', operation: 'getSchema', appId });
	console.log('   tables:', schema?.map((t) => t.name).join(', '));
	const [ins] = await step('Database → Insert Row', { resource: 'database', operation: 'insertRows', appId, table: 'n8n_e2e_leads', row: JSON.stringify({ email }) });
	console.log('  ', ins);
	const rows = await step('Database → Get Many Rows (where)', { resource: 'database', operation: 'getRows', appId, table: 'n8n_e2e_leads', where: JSON.stringify({ email }), returnAll: false, limit: 10, rowOptions: { orderBy: 'created_at', order: 'desc' } });
	console.log('   found:', rows?.length);
	const [upd] = await step('Database → Update Rows', { resource: 'database', operation: 'updateRows', appId, table: 'n8n_e2e_leads', where: JSON.stringify({ email }), set: JSON.stringify({ status: 'won' }) });
	console.log('   status after update:', upd?.status);
	const [sql] = await step('Database → Run SQL', { resource: 'database', operation: 'runSql', appId, sql: 'SELECT count(*)::int AS n FROM n8n_e2e_leads WHERE email = $1', params: JSON.stringify([email]) });
	console.log('  ', sql);
	await step('Database → Delete Rows (empty where, expect refusal)', { resource: 'database', operation: 'deleteRows', appId, table: 'n8n_e2e_leads', where: '{}' });
	const [del] = await step('Database → Delete Rows', { resource: 'database', operation: 'deleteRows', appId, table: 'n8n_e2e_leads', where: JSON.stringify({ email }) });
	console.log('  ', del);

	// Trigger: activation poll, insert, next poll must see exactly that row.
	const staticData = {};
	const trig = (mode) => new KleapTrigger().poll.call(makeContext({ params: { event: 'databaseRow', appId, table: 'n8n_e2e_leads', cursorColumn: 'created_at' }, http: realHttp, credentials, staticData, mode }));
	console.log('   trigger activation →', await trig());
	const email2 = `n8n-trigger-${Date.now()}@example.com`;
	await step('Database → Insert Row (for trigger)', { resource: 'database', operation: 'insertRows', appId, table: 'n8n_e2e_leads', row: JSON.stringify({ email: email2 }) });
	const fired = await trig();
	console.log('   trigger poll → emitted:', fired?.[0]?.map((i) => i.json.email));
	console.log('   trigger poll again →', await trig());
	await step('Database → Delete Rows (cleanup)', { resource: 'database', operation: 'deleteRows', appId, table: 'n8n_e2e_leads', where: JSON.stringify({ email: email2 }) });

	const [buy] = await step('Domain → Buy (checkout link only)', { resource: 'domain', operation: 'buy', domain: 'n8n-e2e-check.com', years: 1, connectAppId: '' });
	console.log('   checkout_url host:', buy?.checkout_url ? new URL(buy.checkout_url).host : null, 'price:', buy?.price);
	const [img] = await step('App → Generate Image', { resource: 'app', operation: 'generateImage', appId: { mode: 'id', value: '105810' }, imagePrompt: 'a ceramic vase on a shelf', imagePath: 'public/images/n8n-e2e.webp', imageOptions: { width: 512, height: 512 } });
	console.log('  ', img && { path: img.path, bytes: img.bytes });
}
