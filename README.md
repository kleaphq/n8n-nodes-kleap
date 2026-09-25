# n8n-nodes-kleap

Build, edit and publish real websites with AI from any n8n workflow, and start workflows when visitors submit a form on those sites.

[Kleap](https://kleap.co) turns a text prompt into a hosted website (Astro, SSL, forms, analytics, custom domains). This package adds two nodes to n8n:

- **Kleap**: create a site from a prompt, ask the AI to change it, publish it, read and write its files, and read its form submissions and analytics.
- **Kleap Trigger**: starts a workflow on every new form submission of a site (contact, booking, signup…), every new row in a table of the site’s database, or every new app.

## Installation

In n8n: **Settings → Community Nodes → Install**, then enter `n8n-nodes-kleap`.

See the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) for self-hosted setups.

## Credentials

1. Sign in to [kleap.co](https://kleap.co) and open **Settings → API key**.
2. Create a key with the **Full** preset. It covers every operation of this node, including database access and domain checkout. A key created before September 2026 may lack the `database:*` and `domains:checkout` scopes; the node then fails with `INSUFFICIENT_SCOPE`. Create a new key to fix this.
3. In n8n, create a **Kleap API** credential and paste the key (`kleap_live_sk_…`).

The credential test calls `GET /account/credits`.

## Operations

| Resource | Operations |
| --- | --- |
| App | Create (from a prompt) · Edit With AI · Publish · Get · Get Many · Get Messages · Get Publish Status · Get Screenshot · Generate Image · Rename · Resolve (URL/domain → app) · Wake · Get / Connect Search Console |
| Task | Get · Retry |
| File | Get Many · Read · Write (text or binary) · Edit (find/replace) · Delete |
| Form Submission | Get Many |
| Analytics | Get (7/30/90 days) |
| Account | Get Credits |
| Database | Get Schema · Get Many Rows · Insert Row · Update Rows · Delete Rows · Run SQL |
| Domain | Search · Buy (returns a checkout link the owner pays) · Check · Connect |

An app can be picked from a searchable list, by ID, or by its URL or custom domain.

### Waiting for the AI

**Create** and **Edit With AI** start an AI task that takes about 1 to 5 minutes. With **Wait for Completion** on (the default), the node waits for the task to finish and returns the result. The result includes the files changed, the credits charged and the preview URL.

Turn on **Publish When Done** to also deploy the site. The node waits until the site is live and returns its `production_url` and the post-deploy quality report. The report covers broken links, SEO checks and the design gate.

With **Wait for Completion** off, the node returns the `task_id` immediately. You can then:

- Poll the task with **Task → Get**.
- Or set a **Webhook URL** in the options, and Kleap calls it when the task ends.

### Credits

| Action | Cost |
| --- | --- |
| Create | Needs at least 5 credits |
| Edit With AI | Needs at least 2 credits |
| Reading data (files, forms, analytics) | Free |
| Publishing | Free |

Use **Idempotency Key** with a stable value, such as a sheet row ID. If the workflow runs again with the same key, it returns the existing task and does not start a second build.

## Example: one website per new Google Sheets row

```
Google Sheets Trigger (row added)
  → Kleap: App → Create
      Prompt: "Website for {{ $json.business }} in {{ $json.city }}. Services: {{ $json.services }}."
      Wait for Completion: on · Publish When Done: on
      Options → Idempotency Key: {{ $json.row_number }}
  → Google Sheets: Update row, column "Site" = {{ $json.production_url }}
```

## Example: website form → CRM

```
Kleap Trigger (New Form Submission, App = my site)
  → HubSpot / Airtable / Slack …   (form fields are at the top level: {{ $json.email }}, {{ $json.message }})
```

The trigger polls Kleap on your chosen schedule.

- **First activation:** it only records a starting point and does not replay old submissions.
- **Test step:** it returns the latest submission.

## Rate limits

The standard API tier allows:

- 30 requests per minute and 500 per day.
- 2 AI tasks running at the same time.

When a limit is hit, the node fails with `RATE_LIMITED`. Use n8n's **Retry On Fail** setting for batch workflows.

## Development

```bash
npm install
npm run build
npm run lint
npm test                                          # unit tests (no network)
KLEAP_API_KEY=… node scripts/e2e.mjs read         # real API, read-only
KLEAP_API_KEY=… node scripts/e2e.mjs build        # real API, creates and publishes a site (spends credits)
```

## License

MIT
