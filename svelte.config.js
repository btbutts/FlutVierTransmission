import adapterStatic from '@sveltejs/adapter-static';
import { relative, sep } from 'node:path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// defaults to rune mode for the project, execept for `node_modules`. Can be removed in svelte 6.
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');

			return isExternalLibrary ? undefined : true;
		}
	},
	kit: {
		// SPA mode: all pages are client-rendered; the static adapter pre-builds the shell
		// and writes a 200.html fallback so deep-link refreshes resolve to the app.
		// Output goes to dist/web-frontend/ so it stays separate from the PollService build output
		// (dist/pollservice/). Both are gitignored under dist/.
		adapter: adapterStatic({ fallback: '200.html', pages: 'dist/web-frontend', assets: 'dist/web-frontend' })
	}
};

export default config;
