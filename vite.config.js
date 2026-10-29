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
// has parsed and run (they only begin ~250ms in otherwise): the track pieces,
// decorations and the Starter Kit colormap. The player's car depends on what
// they picked last time, so a tiny inline script adds that preload from
// localStorage (and the Car Kit colormap if it needs it). Opponents' cars
// load later. Crossorigin matches how GLTFLoader (fetch, cors) and
// TextureLoader (anonymous img) request them, so the preloaded responses get
// reused.
const CRITICAL = /^models\/(track|decoration)-[^/]*\.glb$|^models\/src\/Textures\/colormap\.png$/;
const CAR_MODEL = /^models\/(?:cars\/)?([^/]+)\.glb$/;

function preloadAssets() {

	return {
		name: 'kerb-preload-assets',
		transformIndexHtml: {
			order: 'post',
			async handler( html, ctx ) {

				if ( ! ctx.bundle || ! ctx.filename.endsWith( 'index.html' ) ) return;

				const { CARS, DEFAULT_CAR } = await import( './js/CarList.js' );
				const carIds = new Set( CARS.map( ( c ) => c.id ) );
				const kits = Object.fromEntries( CARS.map( ( c ) => [ c.id, c.kit ] ) );
				const tags = [];
				const cars = {};
				let carsColormap = null;

				for ( const [ file, output ] of Object.entries( ctx.bundle ) ) {

					const sources = ( output.originalFileNames || [] ).map( ( f ) => f.replace( /^\.?\//, '' ) );

					for ( const source of sources ) {

						const car = source.match( CAR_MODEL );

						if ( CRITICAL.test( source ) ) {

							tags.push( { tag: 'link', attrs: { rel: 'preload', href: './' + file, as: source.endsWith( '.png' ) ? 'image' : 'fetch', crossorigin: '' }, injectTo: 'head' } );

						} else if ( car && carIds.has( car[ 1 ] ) ) {

							cars[ car[ 1 ] ] = [ './' + file, kits[ car[ 1 ] ] ];

						} else if ( source === 'models/src/cars/Textures/colormap.png' ) {

							carsColormap = './' + file;

						}

					}

				}

				const script = `try{var m=${ JSON.stringify( cars ) },c=localStorage.getItem('kerb.car'),e=m[c]||m[${ JSON.stringify( DEFAULT_CAR ) }],p=function(h,a){var l=document.createElement('link');l.rel='preload';l.as=a;l.crossOrigin='';l.href=h;document.head.appendChild(l)};p(e[0],'fetch');if(e[1]==='cars')p(${ JSON.stringify( carsColormap ) },'image')}catch(x){}`;
				tags.push( { tag: 'script', children: script, injectTo: 'head' } );

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
