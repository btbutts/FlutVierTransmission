import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';
import unusedImports from 'eslint-plugin-unused-imports';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),

	// Global ignores for SvelteKit build artifacts
	{
    	ignores: ['.svelte-kit/', 'build/', 'dist/']
	},

	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		// unused-imports plugin
		plugins: {
			'unused-imports': unusedImports
		},
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			// Turn off base prefer-const (it conflicts with Svelte 5 runes + bind:this)
			'prefer-const': 'off',
			// Use Svelte-aware version instead — this fixes your buttonRef error
			'svelte/prefer-const': 'error',

			// Additional helpful Svelte 5 rules
			'svelte/no-reactive-reassign': 'error',
			'svelte/valid-compile': 'error',

			// Optional: discourage unused vars in a more Svelte-friendly way
			'no-unused-vars': 'off', // already handled by typescript-eslint
			// TypeScript rules
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true
				}
			],

			'unused-imports/no-unused-imports': 'warn', // Specifically for imports
			'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],

			'@typescript-eslint/no-explicit-any': 'warn',


			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
		}
	},
	// Svelte + .svelte.ts files configuration
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig,
				tsconfigRootDir: path.resolve(import.meta.dirname),
			},
		},
		rules: {
			// SvelteKit-specific best practices
			'svelte/no-export-load-in-svelte-module-in-kit-pages': 'error',
			'svelte/valid-prop-names-in-kit-pages': 'error',
		},
	},
	// Pure TypeScript files (non-Svelte)
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: path.resolve(import.meta.dirname),
			},
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
