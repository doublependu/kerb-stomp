// GPU frame cost per quality tier, viewport and track, with parts of the
// scene hidden to see where the time goes (window.__kerb.benchmark: renders
// synchronously and forces completion, so vsync doesn't hide the cost).
//
//   npm run build && npm run bench
//   npm run bench -- --url http://127.0.0.1:4173/ --tiers low,medium --tracks classic,monza --npcs 0,8 --parts
//
// Measured on the setup screen: the camera on the player's car at the back
// of the grid, with the opponents lined up in front.
//
// --step instead measures the CPU side while racing (low tier, 1366×768):
// the simulation step (physics, AI, car contacts) and the whole frame, with
// Chrome's CPU throttled like a slow phone.
//
//   npm run bench -- --step --npcs 0,4,8 --cpu 1,4 --tracks classic,monaco

import { chromium } from 'playwright';
import { launchOptions, startServer } from './playtest/browser.mjs';

const args = process.argv.slice( 2 );
const arg = ( name, fallback ) => {

	const i = args.indexOf( '--' + name );
	return i >= 0 ? args[ i + 1 ] : fallback;

};

const tiers = arg( 'tiers', 'low,medium,high' ).split( ',' );
const tracks = arg( 'tracks', 'classic' ).split( ',' );
const sizes = arg( 'sizes', '1366x768,1920x1080' ).split( ',' ).map( ( s ) => s.split( 'x' ).map( Number ) );
const extra = arg( 'query', '' );
const npcCounts = arg( 'npcs', '4' ).split( ',' ).map( Number );
const parts = args.includes( '--parts' ) ? [ 'decorations', 'shadows', 'track', 'cars' ] : [];
const cpuRates = arg( 'cpu', '1,4' ).split( ',' ).map( Number );

const server = arg( 'url', null ) ? null : await startServer( 'vite' );
const url = arg( 'url', null ) || server.url;
const browser = await chromium.launch( launchOptions() );

const fastest = ( values ) => Math.min( ...values );

try {

	console.log( `GPU: ${ await gpuName() }\n` );

	if ( args.includes( '--step' ) ) await stepCost();
	else await frameCost();

} finally {

	await browser.close();
	if ( server ) server.stop();

}

// GPU cost per frame on the setup screen
async function frameCost() {

	console.log( [ 'track', 'npcs', 'tier', 'size', 'ms/frame', ...parts.map( ( p ) => '−' + p ) ].join( '\t' ) );

	for ( const track of tracks ) for ( const npcs of npcCounts ) {

		for ( const tier of tiers ) {

			for ( const [ width, height ] of sizes ) {

				const context = await browser.newContext( { viewport: { width, height } } );
				await context.addInitScript( ( n ) => {

					localStorage.setItem( 'kerb.car', 'vehicle-truck-yellow' );
					localStorage.setItem( 'kerb.npcs', String( n ) );

				}, npcs );
				const page = await context.newPage();
				await page.goto( `${ url }?playtest&quality=${ tier }&track=${ track }${ extra }` );
				await page.waitForFunction( ( n ) => document.body.dataset.state === 'ready' && window.__kerb.state().cars === n + 1, npcs, { timeout: 60000 } );
				await page.waitForTimeout( 500 );

				// The iGPU's clock ramps and drops between runs: warm up, then
				// take the fastest of several runs as the cost
				const measure = () => page.evaluate( () => {

					window.__kerb.benchmark( 30 );
					const runs = [];
					for ( let i = 0; i < 6; i ++ ) runs.push( window.__kerb.benchmark( 30 ) );
					return runs;

				} );

				const row = [ track, npcs, tier, `${ width }×${ height }`, fastest( await measure() ).toFixed( 1 ) ];

				for ( const part of parts ) {

					await page.evaluate( ( p ) => window.__kerb.toggle( p, false ), part );
					row.push( fastest( await measure() ).toFixed( 1 ) );
					await page.evaluate( ( p ) => window.__kerb.toggle( p, true ), part );

				}

				console.log( row.join( '\t' ) );
				await context.close();

			}

		}

	}

}

// The player holds the throttle (so stays in the pack for a while); the field
// races. Step and frame percentiles cover the last ~3 s of a 15 s race.
async function stepCost() {

	console.log( [ 'track', 'npcs', 'cpu×', 'step p50', 'step p95', 'frame p50', 'frame p95' ].join( '\t' ) );

	for ( const track of tracks ) for ( const npcs of npcCounts ) for ( const rate of cpuRates ) {

		const context = await browser.newContext( { viewport: { width: 1366, height: 768 } } );
		await context.addInitScript( ( n ) => {

			localStorage.setItem( 'kerb.car', 'vehicle-truck-yellow' );
			localStorage.setItem( 'kerb.npcs', String( n ) );

		}, npcs );
		const page = await context.newPage();
		await page.goto( `${ url }?playtest&quality=low&track=${ track }${ extra }` );
		await page.waitForFunction( ( n ) => document.body.dataset.state === 'ready' && window.__kerb.state().cars === n + 1, npcs, { timeout: 60000 } );

		const cdp = await context.newCDPSession( page );
		await cdp.send( 'Emulation.setCPUThrottlingRate', { rate } );

		await page.keyboard.down( 'KeyW' );
		await page.waitForFunction( () => window.__kerb.state().raceTime > 15, null, { timeout: 120000, polling: 500 } );
		const s = await page.evaluate( () => window.__kerb.state() );
		await page.keyboard.up( 'KeyW' );

		const ms = ( v ) => ( v * 1000 ).toFixed( 2 );
		console.log( [ track, npcs, rate, ms( s.stepP50 ), ms( s.stepP95 ), ms( s.frameP50 ), ms( s.frameP95 ) ].join( '\t' ) );
		await context.close();

	}

}

async function gpuName() {

	const page = await browser.newPage();
	const name = await page.evaluate( () => {

		const gl = document.createElement( 'canvas' ).getContext( 'webgl2' );
		const ext = gl.getExtension( 'WEBGL_debug_renderer_info' );
		return ext ? gl.getParameter( ext.UNMASKED_RENDERER_WEBGL ) : gl.getParameter( gl.RENDERER );

	} );
	await page.close();
	return name;

}
