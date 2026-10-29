// Load-time budget check (CLAUDE.md Spec §1): cold-cache time from navigation
// to the game being interactive (the `kerb:interactive` mark, i.e. the
// "press any key / tap to drive" screen), under throttled network and CPU.
//
//   npm run perf:load                      # serves the existing dist/ via `wrangler dev`
//   npm run perf:load -- --url https://…   # measure a deployed site
//   npm run perf:load -- --runs 5
//   npm run perf:load -- --query '?track=bathurst'

import { chromium } from 'playwright';
import { launchOptions, startServer } from './playtest/browser.mjs';

const args = process.argv.slice( 2 );
const arg = ( name, fallback ) => {

	const i = args.indexOf( '--' + name );
	return i >= 0 ? args[ i + 1 ] : fallback;

};

const RUNS = Number( arg( 'runs', 3 ) );
let url = arg( 'url', null );

// Download / upload in Mbit/s, RTT in ms. "average" is a conservative read of
// current global median broadband/mobile; "slow" is a weak 4G connection.
const PROFILES = [
	{ name: 'average', down: 25, up: 10, rtt: 40, cpu: 1 },
	{ name: 'average + 4x CPU', down: 25, up: 10, rtt: 40, cpu: 4 },
	{ name: 'slow', down: 10, up: 5, rtt: 100, cpu: 1 },
	{ name: 'slow + 4x CPU', down: 10, up: 5, rtt: 100, cpu: 4 },
];

const GREAT = 1000, REQUIRED = 3000, MAX = 4000;

async function measure( browser, profile ) {

	const context = await browser.newContext( { viewport: { width: 1280, height: 720 } } );
	const page = await context.newPage();
	const cdp = await context.newCDPSession( page );

	await cdp.send( 'Network.enable' );
	await cdp.send( 'Network.setCacheDisabled', { cacheDisabled: true } );
	await cdp.send( 'Network.emulateNetworkConditions', {
		offline: false,
		latency: profile.rtt,
		downloadThroughput: profile.down * 1e6 / 8,
		uploadThroughput: profile.up * 1e6 / 8,
	} );
	await cdp.send( 'Emulation.setCPUThrottlingRate', { rate: profile.cpu } );

	await page.addInitScript( () => {

		window.__longTasks = [];
		new PerformanceObserver( ( list ) => {

			for ( const e of list.getEntries() ) window.__longTasks.push( Math.round( e.duration ) );

		} ).observe( { type: 'longtask', buffered: true } );

	} );

	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );

	await page.goto( url + arg( 'query', '' ), { waitUntil: 'commit' } );
	await page.waitForFunction( () => performance.getEntriesByName( 'kerb:interactive' ).length > 0 || document.body.dataset.state === 'error', null, { timeout: 30000, polling: 50 } );

	const result = await page.evaluate( () => {

		const fcp = performance.getEntriesByName( 'first-contentful-paint' )[ 0 ];
		const mark = performance.getEntriesByName( 'kerb:interactive' )[ 0 ];
		const resources = performance.getEntriesByType( 'resource' );
		const nav = performance.getEntriesByType( 'navigation' )[ 0 ];
		const bytes = resources.reduce( ( sum, r ) => sum + ( r.transferSize || 0 ), nav ? nav.transferSize : 0 );

		const marks = {};
		for ( const m of performance.getEntriesByType( 'mark' ) ) if ( m.name.startsWith( 'kerb:' ) ) marks[ m.name.slice( 5 ) ] = Math.round( m.startTime );

		return {
			marks,
			fcp: fcp ? fcp.startTime : null,
			interactive: mark ? mark.startTime : null,
			bytes,
			requests: resources.length + 1,
			longTasks: window.__longTasks,
			state: document.body.dataset.state,
		};

	} );

	await context.close();

	return { ...result, errors };

}

const median = ( values ) => {

	const sorted = values.slice().sort( ( a, b ) => a - b );
	return sorted[ Math.floor( sorted.length / 2 ) ];

};

let server = null;

if ( ! url ) {

	server = await startServer( 'wrangler' );
	url = server.url;

}

console.log( `Measuring ${ url } (${ RUNS } cold runs per profile)\n` );

const browser = await chromium.launch( launchOptions() );
let failed = false;

try {

	for ( const profile of PROFILES ) {

		const runs = [];
		for ( let i = 0; i < RUNS; i ++ ) runs.push( await measure( browser, profile ) );

		const bad = runs.find( ( r ) => r.interactive === null );

		if ( bad ) {

			console.log( `${ profile.name.padEnd( 18 ) } FAILED (${ bad.state }) ${ bad.errors.join( '; ' ) }` );
			failed = true;
			continue;

		}

		const interactive = median( runs.map( ( r ) => r.interactive ) );
		const fcp = median( runs.map( ( r ) => r.fcp ) );
		const longest = Math.max( 0, ...runs.flatMap( ( r ) => r.longTasks ) );
		const verdict = interactive <= GREAT ? 'great' : interactive <= REQUIRED ? 'ok' : interactive <= MAX ? 'OVER TARGET' : 'OVER MAX';

		if ( interactive > REQUIRED ) failed = true;

		console.log(
			`${ profile.name.padEnd( 18 ) } interactive ${ ( interactive / 1000 ).toFixed( 2 ) }s  ` +
			`first paint ${ ( fcp / 1000 ).toFixed( 2 ) }s  ` +
			`${ ( runs[ 0 ].bytes / 1e6 ).toFixed( 2 ) } MB / ${ runs[ 0 ].requests } req  ` +
			`longest task ${ longest }ms  → ${ verdict }`
		);

		if ( args.includes( '--marks' ) ) console.log( '  ' + JSON.stringify( runs[ 0 ].marks ) );

	}

} finally {

	await browser.close();
	if ( server ) server.stop();

}

console.log( `\nTargets: ≤ ${ GREAT / 1000 }s great, ≤ ${ REQUIRED / 1000 }s required, ${ MAX / 1000 }s absolute max.` );
process.exitCode = failed ? 1 : 0;
