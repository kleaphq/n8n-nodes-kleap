import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KleapApi implements ICredentialType {
	name = 'kleapApi';

	displayName = 'Kleap API';

	icon: Icon = { light: 'file:kleap.svg', dark: 'file:kleap.svg' };

	documentationUrl = 'https://kleap.co/settings/api-key';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'kleap_live_sk_...',
			description:
				'Create one at kleap.co → Settings → API key. The "full" preset covers every operation of this node except buying domains.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://kleap.co/api/v1',
			description: 'Only change this if Kleap support asked you to',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/account/credits',
			method: 'GET',
		},
	};
}
