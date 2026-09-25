import type { INodeProperties } from 'n8n-workflow';

export const appLocator = (
	resources: string[],
	operations?: string[],
	overrides: Partial<INodeProperties> = {},
): INodeProperties => ({
	displayName: 'App',
	name: 'appId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The Kleap app (website) to work on',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchApps', searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 39541',
			validation: [
				{ type: 'regex', properties: { regex: '^[0-9]+$', errorMessage: 'An app ID is a number' } },
			],
		},
		{
			displayName: 'By Site URL or Domain',
			name: 'url',
			type: 'string',
			placeholder: 'e.g. https://my-site.kleap.io or mydomain.com',
		},
	],
	displayOptions: {
		show: operations ? { resource: resources, operation: operations } : { resource: resources },
	},
	...overrides,
});

const waitFields = (resource: string, operations: string[], defaultMinutes: number): INodeProperties[] => [
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until the AI has finished building before continuing. When off, the node returns the task_id right away.',
		displayOptions: { show: { resource: [resource], operation: operations } },
	},
	{
		displayName: 'Publish When Done',
		name: 'publishWhenDone',
		type: 'boolean',
		default: false,
		description:
			'Whether to publish the site to its public URL once the build is done, and wait until it is live',
		displayOptions: { show: { resource: [resource], operation: operations, waitForCompletion: [true] } },
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeoutMinutes',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 60 },
		default: defaultMinutes,
		description:
			'How long to wait before giving up. On timeout the node still outputs the task, with wait_timed_out set to true.',
		displayOptions: { show: { resource: [resource], operation: operations, waitForCompletion: [true] } },
	},
];

const taskOptions = (resource: string, operations: string[]): INodeProperties => ({
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	displayOptions: { show: { resource: [resource], operation: operations } },
	options: [
		{
			displayName: 'Idempotency Key',
			name: 'idempotencyKey',
			type: 'string',
			default: '',
			description:
				'Sending the same key twice returns the first task instead of starting a second build. Use a stable value such as the row ID of your trigger.',
		},
		{
			displayName: 'Webhook Secret',
			name: 'webhookSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Secret used to sign the completion webhook',
		},
		{
			displayName: 'Webhook URL',
			name: 'webhookUrl',
			type: 'string',
			default: '',
			placeholder: 'https://…',
			description: 'HTTPS URL Kleap calls when the task finishes (for example an n8n Webhook node)',
		},
	],
});

/* -------------------------------------------------------------------------- */
/*                                     App                                    */
/* -------------------------------------------------------------------------- */

export const appOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['app'] } },
	options: [
		{
			name: 'Connect Search Console',
			value: 'connectSearchConsole',
			action: 'Connect google search console to an app',
			description: 'Start connecting Google Search Console; returns the link the owner must open',
		},
		{
			name: 'Create',
			value: 'create',
			action: 'Create a website from a prompt',
			description: 'Build a new website with AI from a text prompt',
		},
		{
			name: 'Edit With AI',
			value: 'sendMessage',
			action: 'Edit a website with AI',
			description: 'Describe a change; the Kleap AI edits the site',
		},
		{
			name: 'Generate Image',
			value: 'generateImage',
			action: 'Generate an image into a website',
			description: 'Generate an AI image and save it in the site’s public folder',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get an app',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many apps',
		},
		{
			name: 'Get Messages',
			value: 'getMessages',
			action: 'Get the chat history of an app',
		},
		{
			name: 'Get Publish Status',
			value: 'getPublishStatus',
			action: 'Get the publish status of an app',
			description: 'Includes the post-deploy quality report (broken links, SEO checks)',
		},
		{
			name: 'Get Screenshot',
			value: 'getScreenshot',
			action: 'Get a screenshot of an app',
		},
		{
			name: 'Get Search Console',
			value: 'getSearchConsole',
			action: 'Get google search performance of an app',
			description: 'Clicks, impressions and top queries from Google Search Console',
		},
		{
			name: 'Publish',
			value: 'publish',
			action: 'Publish an app',
			description: 'Deploy the site to its public URL',
		},
		{
			name: 'Rename',
			value: 'rename',
			action: 'Rename an app',
			description: 'Change the display name (the URL does not change)',
		},
		{
			name: 'Resolve',
			value: 'resolve',
			action: 'Find an app by URL or domain',
			description: 'Find which app serves a URL, custom domain or slug',
		},
		{
			name: 'Wake',
			value: 'wake',
			action: 'Wake an app',
			description: 'Restart the live preview of an app that went to sleep',
		},
	],
	default: 'create',
};

export const appFields: INodeProperties[] = [
	// create
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		placeholder: 'e.g. A one-page site for Café Lumière, a specialty coffee shop in Lausanne, with menu and contact form',
		description: 'What to build. Up to 10,000 characters. Costs at least 5 credits.',
		displayOptions: { show: { resource: ['app'], operation: ['create'] } },
	},
	{
		displayName: 'Visibility',
		name: 'visibility',
		type: 'options',
		options: [
			{ name: 'Personal', value: 'personal' },
			{ name: 'Public', value: 'public' },
			{ name: 'Workspace', value: 'workspace' },
		],
		default: 'personal',
		description: 'Who can see the app in Kleap. Publishing to a public URL is separate.',
		displayOptions: { show: { resource: ['app'], operation: ['create'] } },
	},

	// every operation that targets an existing app
	appLocator(
		['app'],
		[
			'generateImage',
			'get',
			'getMessages',
			'getPublishStatus',
			'getScreenshot',
			'publish',
			'rename',
			'sendMessage',
			'connectSearchConsole',
			'getSearchConsole',
			'wake',
		],
	),

	// sendMessage
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		placeholder: 'e.g. Add a pricing section with three plans and make the header sticky',
		description: 'The change to make, in plain language. Up to 10,000 characters. Costs at least 2 credits.',
		displayOptions: { show: { resource: ['app'], operation: ['sendMessage'] } },
	},

	...waitFields('app', ['create', 'sendMessage'], 30),
	taskOptions('app', ['create', 'sendMessage']),

	// generateImage
	{
		displayName: 'Image Prompt',
		name: 'imagePrompt',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		description: 'Description of the image to generate',
		displayOptions: { show: { resource: ['app'], operation: ['generateImage'] } },
	},
	{
		displayName: 'Save As',
		name: 'imagePath',
		type: 'string',
		default: 'public/images/hero.webp',
		required: true,
		description: 'Path in the site, under public/, ending in .png, .jpg or .webp',
		displayOptions: { show: { resource: ['app'], operation: ['generateImage'] } },
	},
	{
		displayName: 'Options',
		name: 'imageOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['app'], operation: ['generateImage'] } },
		options: [
			{
				displayName: 'HD',
				name: 'hd',
				type: 'boolean',
				default: false,
				description: 'Whether to use the higher-quality model',
			},
			{
				displayName: 'Height',
				name: 'height',
				type: 'number',
				typeOptions: { minValue: 256, maxValue: 1440 },
				default: 768,
			},
			{
				displayName: 'Width',
				name: 'width',
				type: 'number',
				typeOptions: { minValue: 256, maxValue: 1440 },
				default: 768,
			},
		],
	},

	// getMany
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['app'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['app'], operation: ['getMany'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['app'], operation: ['getMany'] } },
		options: [
			{
				displayName: 'Search',
				name: 'q',
				type: 'string',
				default: '',
				description: 'Only apps whose name or slug contains this text',
			},
		],
	},

	// getMessages
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['app'], operation: ['getMessages'] } },
	},

	// publish
	{
		displayName: 'Wait Until Live',
		name: 'waitForLive',
		type: 'boolean',
		default: true,
		description: 'Whether to wait until the site answers on its public URL before continuing',
		displayOptions: { show: { resource: ['app'], operation: ['publish'] } },
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeoutMinutes',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 30 },
		default: 10,
		description: 'How long to wait for the deploy. On timeout the node outputs the last status with wait_timed_out set to true.',
		displayOptions: { show: { resource: ['app'], operation: ['publish'], waitForLive: [true] } },
	},

	// rename
	{
		displayName: 'New Name',
		name: 'name',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['app'], operation: ['rename'] } },
	},

	// resolve
	{
		displayName: 'URL, Domain or Slug',
		name: 'query',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. https://cafe-lumiere.kleap.io',
		displayOptions: { show: { resource: ['app'], operation: ['resolve'] } },
	},
];

/* -------------------------------------------------------------------------- */
/*                                    Task                                    */
/* -------------------------------------------------------------------------- */

export const taskOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['task'] } },
	options: [
		{
			name: 'Get',
			value: 'get',
			action: 'Get a task',
			description: 'Get the status and result of a build or edit',
		},
		{
			name: 'Retry',
			value: 'retry',
			action: 'Retry a task',
			description: 'Resume a failed build from the files it already wrote',
		},
	],
	default: 'get',
};

export const taskFields: INodeProperties[] = [
	{
		displayName: 'Task ID',
		name: 'taskId',
		type: 'string',
		default: '',
		required: true,
		description: 'The task_id returned by Create or Edit With AI',
		displayOptions: { show: { resource: ['task'] } },
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: false,
		description: 'Whether to wait until the task is completed or failed',
		displayOptions: { show: { resource: ['task'] } },
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeoutMinutes',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 60 },
		default: 20,
		description: 'How long to wait before giving up',
		displayOptions: { show: { resource: ['task'], waitForCompletion: [true] } },
	},
];

/* -------------------------------------------------------------------------- */
/*                                    File                                    */
/* -------------------------------------------------------------------------- */

export const fileOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['file'] } },
	options: [
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete files',
			description: 'Remove pages or assets from the site',
		},
		{
			name: 'Edit',
			value: 'edit',
			action: 'Find and replace in a file',
			description: 'Replace exact text in a file without rewriting it',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'List files',
			description: 'List every file of the site',
		},
		{
			name: 'Read',
			value: 'read',
			action: 'Read files',
			description: 'Get the content of one or more files',
		},
		{
			name: 'Write',
			value: 'write',
			action: 'Write a file',
			description: 'Create or replace a file (text, or binary such as an image)',
		},
	],
	default: 'read',
};

export const fileFields: INodeProperties[] = [
	appLocator(['file']),
	{
		displayName: 'Paths',
		name: 'paths',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. src/pages/index.astro, src/data/site.json',
		description: 'One or more paths, separated by commas or new lines (max 60)',
		displayOptions: { show: { resource: ['file'], operation: ['read', 'delete'] } },
	},
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. src/pages/about.astro',
		displayOptions: { show: { resource: ['file'], operation: ['edit', 'write'] } },
	},
	{
		displayName: 'Find',
		name: 'oldString',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		description: 'Exact text to replace. Must appear once, unless Replace All is on.',
		displayOptions: { show: { resource: ['file'], operation: ['edit'] } },
	},
	{
		displayName: 'Replace With',
		name: 'newString',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		displayOptions: { show: { resource: ['file'], operation: ['edit'] } },
	},
	{
		displayName: 'Replace All',
		name: 'replaceAll',
		type: 'boolean',
		default: false,
		description: 'Whether to replace every occurrence instead of requiring exactly one',
		displayOptions: { show: { resource: ['file'], operation: ['edit'] } },
	},
	{
		displayName: 'Binary File',
		name: 'binaryData',
		type: 'boolean',
		default: false,
		description: 'Whether to upload a binary field of the input item (image, font, PDF) instead of text',
		displayOptions: { show: { resource: ['file'], operation: ['write'] } },
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 8 },
		default: '',
		description: 'Full new content of the file (max 512 KB)',
		displayOptions: { show: { resource: ['file'], operation: ['write'], binaryData: [false] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field containing the file to upload',
		displayOptions: { show: { resource: ['file'], operation: ['write'], binaryData: [true] } },
	},
];

/* -------------------------------------------------------------------------- */
/*                               Form Submission                              */
/* -------------------------------------------------------------------------- */

export const formOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['formSubmission'] } },
	options: [
		{
			name: 'Get Many',
			value: 'getMany',
			action: 'Get many form submissions',
			description: 'Get what visitors sent through the site’s forms, newest first',
		},
	],
	default: 'getMany',
};

export const formFields: INodeProperties[] = [
	appLocator(['formSubmission']),
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['formSubmission'], operation: ['getMany'] } },
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to put the submitted form fields at the top level of each item instead of under "data"',
		displayOptions: { show: { resource: ['formSubmission'], operation: ['getMany'] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['formSubmission'], operation: ['getMany'] } },
		options: [
			{
				displayName: 'Submitted After',
				name: 'since',
				type: 'dateTime',
				default: '',
				description: 'Only submissions received at or after this date',
			},
		],
	},
];

/* -------------------------------------------------------------------------- */
/*                                  Analytics                                 */
/* -------------------------------------------------------------------------- */

export const analyticsOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['analytics'] } },
	options: [
		{
			name: 'Get',
			value: 'get',
			action: 'Get site analytics',
			description: 'Visitors, pageviews, top pages and referrers of a published site',
		},
	],
	default: 'get',
};

export const analyticsFields: INodeProperties[] = [
	appLocator(['analytics']),
	{
		displayName: 'Period',
		name: 'period',
		type: 'options',
		options: [
			{ name: 'Last 7 Days', value: '7d' },
			{ name: 'Last 30 Days', value: '30d' },
			{ name: 'Last 90 Days', value: '90d' },
		],
		default: '7d',
		displayOptions: { show: { resource: ['analytics'] } },
	},
];

/* -------------------------------------------------------------------------- */
/*                                   Account                                  */
/* -------------------------------------------------------------------------- */

export const accountOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['account'] } },
	options: [
		{
			name: 'Get Credits',
			value: 'getCredits',
			action: 'Get the credit balance',
		},
	],
	default: 'getCredits',
};

/* -------------------------------------------------------------------------- */
/*                                   Domain                                   */
/* -------------------------------------------------------------------------- */

export const domainOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['domain'] } },
	options: [
		{
			name: 'Buy',
			value: 'buy',
			action: 'Buy a domain',
			description:
				'Get a secure checkout link for a domain. The domain is only bought once its owner pays on that link.',
		},
		{
			name: 'Check',
			value: 'check',
			action: 'Check a connected domain',
			description: 'Check whether a connected domain’s DNS points to Kleap',
		},
		{
			name: 'Connect',
			value: 'connect',
			action: 'Connect a domain to an app',
			description: 'Attach a domain you own to a published app (paid plan)',
		},
		{
			name: 'Search',
			value: 'search',
			action: 'Search available domains',
			description: 'Check availability and price of domain names',
		},
	],
	default: 'search',
};

export const domainFields: INodeProperties[] = [
	appLocator(['domain'], ['connect']),
	{
		displayName: 'Domain',
		name: 'domain',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. cafe-lumiere.ch',
		displayOptions: { show: { resource: ['domain'], operation: ['buy', 'check', 'connect'] } },
	},
	{
		displayName: 'Years',
		name: 'years',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 1,
		displayOptions: { show: { resource: ['domain'], operation: ['buy'] } },
	},
	{
		displayName: 'Connect to App ID',
		name: 'connectAppId',
		type: 'string',
		default: '',
		placeholder: 'e.g. 39541',
		description: 'Optional. Once paid, the domain is also connected to this app.',
		displayOptions: { show: { resource: ['domain'], operation: ['buy'] } },
	},
	{
		displayName: 'Name or Keyword',
		name: 'query',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. cafelumiere or cafelumiere.ch',
		description: 'A name (spaces and accents are removed) or a full domain',
		displayOptions: { show: { resource: ['domain'], operation: ['search'] } },
	},
	{
		displayName: 'Extensions',
		name: 'tlds',
		type: 'string',
		default: '',
		placeholder: 'e.g. .com, .ch, .io',
		description: 'Comma-separated list. Empty = .ch, .com, .io, .co, .net.',
		displayOptions: { show: { resource: ['domain'], operation: ['search'] } },
	},
];

/* -------------------------------------------------------------------------- */
/*                                  Database                                  */
/* -------------------------------------------------------------------------- */

export const databaseOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['database'] } },
	options: [
		{
			name: 'Add Row',
			value: 'insertRows',
			action: 'Add a row',
			description: 'Add one row per input item. Each column of the table becomes a field.',
		},
		{
			name: 'Delete Rows',
			value: 'deleteRows',
			action: 'Delete rows',
			description: 'Delete the rows that match your conditions',
		},
		{
			name: 'Find Rows',
			value: 'getRows',
			action: 'Find rows',
			description: 'Get the rows of a table, optionally only those that match your conditions',
		},
		{
			name: 'List Tables',
			value: 'getSchema',
			action: 'List the tables',
			description: 'See the tables of the site’s database and their columns',
		},
		{
			name: 'Run SQL (Advanced)',
			value: 'runSql',
			action: 'Run an SQL query',
			description: 'For developers: run any SQL statement on the site’s Postgres database',
		},
		{
			name: 'Update Rows',
			value: 'updateRows',
			action: 'Update rows',
			description: 'Change the rows that match the column you pick',
		},
	],
	default: 'insertRows',
};

const dbOps = (ops: string[]) => ({ show: { resource: ['database'], operation: ops } });

const tableDependsOn = ['appId.value', 'table'];

export const databaseFields: INodeProperties[] = [
	appLocator(['database']),
	{
		displayName: 'Table Name or ID',
		name: 'table',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTables', loadOptionsDependsOn: ['appId.value'] },
		default: '',
		required: true,
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: dbOps(['getRows', 'insertRows', 'updateRows', 'deleteRows']),
	},

	// Add Row / Update Rows: one field per column, like the Postgres and Google Sheets nodes.
	{
		displayName: 'Columns',
		name: 'columns',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: tableDependsOn,
			resourceMapper: {
				resourceMapperMethod: 'getMappingColumns',
				mode: 'add',
				fieldWords: { singular: 'column', plural: 'columns' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: true,
			},
		},
		displayOptions: dbOps(['insertRows']),
	},
	{
		displayName: 'Columns',
		name: 'columns',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		typeOptions: {
			loadOptionsDependsOn: tableDependsOn,
			resourceMapper: {
				resourceMapperMethod: 'getMappingColumns',
				mode: 'update',
				fieldWords: { singular: 'column', plural: 'columns' },
				addAllFields: true,
				multiKeyMatch: true,
				supportAutoMap: true,
				matchingFieldsLabels: {
					title: 'Find the Rows Where',
					description: 'The rows whose value in this column matches are updated',
					hint: 'Usually the email or the ID',
				},
			},
		},
		displayOptions: dbOps(['updateRows']),
	},

	// Find Rows / Delete Rows: "column = value" conditions picked from dropdowns.
	{
		displayName: 'Only Rows Where',
		name: 'conditions',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Condition',
		default: {},
		description: 'Every condition must match. Leave empty to get every row.',
		displayOptions: dbOps(['getRows']),
		options: [
			{
				displayName: 'Condition',
				name: 'condition',
				values: [
					{
						displayName: 'Column Name or ID',
						name: 'column',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getColumns', loadOptionsDependsOn: tableDependsOn },
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Is Equal To',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'Delete Rows Where',
		name: 'conditions',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Condition',
		default: {},
		required: true,
		description: 'Every condition must match. At least one is required, so a mistake can never empty the table.',
		displayOptions: dbOps(['deleteRows']),
		options: [
			{
				displayName: 'Condition',
				name: 'condition',
				values: [
					{
						displayName: 'Column Name or ID',
						name: 'column',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getColumns', loadOptionsDependsOn: tableDependsOn },
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Is Equal To',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: dbOps(['getRows']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['database'], operation: ['getRows'], returnAll: [false] } },
	},
	{
		displayName: 'Options',
		name: 'rowOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: dbOps(['getRows']),
		options: [
			{
				displayName: 'Sort By Column Name or ID',
				name: 'orderBy',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getColumns', loadOptionsDependsOn: tableDependsOn },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Order',
				name: 'order',
				type: 'options',
				options: [
					{ name: 'Newest / Largest First', value: 'desc' },
					{ name: 'Oldest / Smallest First', value: 'asc' },
				],
				default: 'desc',
			},
		],
	},

	// Run SQL (advanced)
	{
		displayName: 'SQL',
		name: 'sql',
		type: 'string',
		typeOptions: { rows: 6, editor: 'sqlEditor', sqlDialect: 'PostgreSQL' },
		default: '',
		required: true,
		placeholder: 'e.g. SELECT * FROM leads WHERE status = $1',
		description:
			'Use $1, $2… for values and fill them in below. New tables must enable row-level security, or the query is refused.',
		displayOptions: dbOps(['runSql']),
	},
	{
		displayName: 'Values for $1, $2…',
		name: 'queryParams',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Value',
		default: {},
		displayOptions: dbOps(['runSql']),
		options: [
			{
				displayName: 'Value',
				name: 'param',
				values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }],
			},
		],
	},
];
