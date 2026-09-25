import tseslint from 'typescript-eslint';
import { configs as communityConfigs } from '@n8n/eslint-plugin-community-nodes';
import n8nNodesBase from 'eslint-plugin-n8n-nodes-base';

export default tseslint.config(
	{ ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'test/**', 'index.js', 'eslint.config.mjs'] },
	{
		files: ['**/*.ts'],
		languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: 'module' } },
	},
	communityConfigs.recommended,
	{
		files: ['credentials/**/*.ts'],
		plugins: { 'n8n-nodes-base': n8nNodesBase },
		rules: {
			...n8nNodesBase.configs.credentials.rules,
			// The API key page is behind login; kleap.co/settings/api-key is the documentation users need.
			'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
		},
	},
	{
		files: ['nodes/**/*.ts'],
		plugins: { 'n8n-nodes-base': n8nNodesBase },
		rules: {
			...n8nNodesBase.configs.nodes.rules,
			// Written for the old string form; NodeConnectionTypes.Main is what current n8n expects.
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
		},
	},
);
