import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const REPO_URL = 'https://github.com/doublependu/kerb-stomp';
const OFFLINE_HTML = resolve( import.meta.dirname, 'dist-offline/index.html' );

// Commit of the build: CI-provided SHA first (Cloudflare Workers Builds,
// GitHub Actions), then the local checkout.
function resolveCommit() {

	const env = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA;
	if ( env ) return env;

	try {

		return execSync( 'git rev-parse HEAD', { stdio: [ 'ignore', 'pipe', 'ignore' ] } ).toString().trim();

	} catch {

		return 'dev';

	}

}

// Size label for the download link. `npm run build` builds the offline file
// first, so the main build can read it.
function offlineSize() {

	try {

		return ( statSync( OFFLINE_HTML ).size / 1e6 ).toFixed( 1 ) + ' MB';

	} catch {

		return '';

	}

}

// Start the startup assets downloading with the HTML instead of after the JS
// has parsed and run (they only begin ~250ms in otherwise). Crossorigin
// matches how GLTFLoader (fetch, cors) and TextureLoader (anonymous img)
// request them, so the preloaded responses get reused.
function preloadAssets() {

	return {
		name: 'kerb-preload-assets',
		transformIndexHtml: {
			order: 'post',
			handler( html, ctx ) {

				if ( ! ctx.bundle || ! ctx.filename.endsWith( 'index.html' ) ) return;

				const tags = [];

				for ( const file of Object.keys( ctx.bundle ) ) {

					const as = file.endsWith( '.glb' ) ? 'fetch' : /colormap-.*\.png$/.test( file ) ? 'image' : null;
					if ( ! as ) continue;
					tags.push( { tag: 'link', attrs: { rel: 'preload', href: './' + file, as, crossorigin: '' }, injectTo: 'head' } );

				}

				return tags;

			},
		},
	};

}

export default defineConfig( ( { mode, command } ) => {

	const offline = mode === 'offline';

	// VITE_* values reach both the JS (import.meta.env) and the HTML (%VITE_*%)
	process.env.VITE_APP_VERSION = 'v.' + resolveCommit().slice( 0, 4 );
	process.env.VITE_REPO_URL = REPO_URL;
	process.env.VITE_OFFLINE_SIZE = command === 'build' && ! offline ? offlineSize() : '';

	return {
		base: './',
		publicDir: offline ? false : 'public',
		plugins: offline ? [ viteSingleFile( { removeViteModuleLoader: true } ) ] : [ preloadAssets() ],
		build: {
			target: 'es2022',
			chunkSizeWarningLimit: 1000,
			outDir: offline ? 'dist-offline' : 'dist',
			emptyOutDir: true,
			assetsInlineLimit: offline ? Number.MAX_SAFE_INTEGER : 4096,
			rolldownOptions: {
				input: offline
					? { main: resolve( import.meta.dirname, 'index.html' ) }
					: {
						main: resolve( import.meta.dirname, 'index.html' ),
						editor: resolve( import.meta.dirname, 'editor.html' ),
					},
			},
		},
	};

} );
