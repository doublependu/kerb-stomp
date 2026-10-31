// Playtest suite: bots play the built game through real keyboard / touch
// input, record video, and report gameplay metrics plus pass/fail checks.
//
//   npm run build && npm run playtest
//   npm run playtest -- --scenario desktop-keyboard,pause-resume --laps 2
//   npm run playtest -- --no-record --url https://kerb-stomp.example.workers.dev/
//   npm run playtest -- --scenario race --race-tracks classic,monza --race-skills average --npcs 4
//   npm run playtest -- --scenario scenery,flyover --tier high   (a forced quality tier)
//   npm run playtest -- --scenario flicker --tracks monaco,bathurst
//
// Recordings and reports go to playtests/ (gitignored).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { launchOptions, startServer } from './browser.mjs';
import { SCENARIOS } from './scenarios.mjs';

const args = process.argv.slice( 2 );
const arg = ( name, fallback ) => {

	const i = args.indexOf( '--' + name );
	return i >= 0 ? args[ i + 1 ] : fallback;

};

const names = arg( 'scenario', Object.keys( SCENARIOS ).join( ',' ) ).split( ',' );
const unknown = names.filter( ( n ) => ! SCENARIOS[ n ] );

if ( unknown.length ) {

	console.error( `Unknown scenario(s): ${ unknown.join( ', ' ) }\nAvailable: ${ Object.keys( SCENARIOS ).join( ', ' ) }` );
	process.exit( 2 );

}

if ( ! existsSync( 'dist/index.html' ) ) {

	console.error( 'No build found: run `npm run build` first.' );
	process.exit( 2 );

}

const stamp = new Date().toISOString().replace( /[:.]/g, '-' ).slice( 0, 19 );
const recordDir = join( 'playtests', 'recordings', stamp );
const reportDir = join( 'playtests', 'reports' );
mkdirSync( recordDir, { recursive: true } );
mkdirSync( reportDir, { recursive: true } );

const server = arg( 'url', null ) ? null : await startServer( 'wrangler' );
const browser = await chromium.launch( launchOptions( { headed: args.includes( '--headed' ) } ) );
const videos = [];

const env = {
	browser,
	url: arg( 'url', null ) || server.url,
	laps: Number( arg( 'laps', 3 ) ),
	raceTracks: arg( 'race-tracks', 'classic' ).split( ',' ),
	raceSkills: arg( 'race-skills', 'novice,average,expert' ).split( ',' ),
	tracks: arg( 'tracks', null )?.split( ',' ) ?? null,
	npcs: Number( arg( 'npcs', 4 ) ),
	seed: Number( arg( 'seed', 1 ) ),
	tier: arg( 'tier', null ),
	record: ! args.includes( '--no-record' ),
	videoDir: join( recordDir, '.raw' ),
	saveVideo( page, label ) {

		const video = page.video();
		if ( video ) videos.push( video.saveAs( join( recordDir, label + '.webm' ) ).then( () => video.delete() ).catch( ( e ) => console.warn( `${ label }: video not saved (${ e.message.split( '\n' )[ 0 ] })` ) ) );

	},
	async screenshot( page, name, before ) {

		if ( before ) await before();
		await page.screenshot( { path: join( recordDir, name + '.png' ) } );

	},
	// A data URL from the page (window.__kerb.view) as a file
	saveImage( name, url ) {

		const [ head, data ] = url.split( ',' );
		writeFileSync( join( recordDir, name + ( head.includes( 'jpeg' ) ? '.jpg' : '.png' ) ), Buffer.from( data, 'base64' ) );

	},
};

console.log( `Playtest ${ stamp } against ${ env.url }${ env.record ? ' (recording)' : '' }${ env.tier ? ' at ' + env.tier : '' }\n` );

const report = { stamp, url: env.url, laps: env.laps, seed: env.seed, tier: env.tier, scenarios: {} };

try {

	for ( const name of names ) {

		const t0 = Date.now();
		process.stdout.write( `▶ ${ name } … ` );

		try {

			report.scenarios[ name ] = await SCENARIOS[ name ]( env );

		} catch ( e ) {

			report.scenarios[ name ] = { checks: [ { name: `${ name } crashed`, ok: false, detail: e.message.split( '\n' )[ 0 ] } ], runs: [] };

		}

		const failed = report.scenarios[ name ].checks.filter( ( c ) => ! c.ok ).length;
		console.log( `${ failed ? failed + ' failed' : 'ok' } (${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) }s)` );

	}

} finally {

	await browser.close();
	await Promise.all( videos );
	if ( server ) server.stop();

}

// Summary

const fmt = ( t ) => t === undefined || t === null ? '   -  ' : t.toFixed( 2 ).padStart( 6 );
const pct = ( v ) => v === null || v === undefined ? '  - ' : ( v * 100 ).toFixed( 0 ).padStart( 3 ) + '%';

const previousPath = join( reportDir, 'latest.json' );
const previous = existsSync( previousPath ) ? JSON.parse( readFileSync( previousPath, 'utf8' ) ) : null;
const previousRuns = {};
if ( previous ) for ( const s of Object.values( previous.scenarios ) ) for ( const r of s.runs ) previousRuns[ r.label ] = r;

console.log( '\nRuns' );
console.log( '  ' + 'run'.padEnd( 30 ) + ' best   mean  Δbest  hits/lap stuck lat50  see0.6s see1.2s frame50/95ms tier' );

for ( const scenario of Object.values( report.scenarios ) ) {

	for ( const r of scenario.runs ) {

		const best = r.lapTimes.length ? Math.min( ...r.lapTimes ) : null;
		const mean = r.lapTimes.length ? r.lapTimes.reduce( ( a, b ) => a + b, 0 ) / r.lapTimes.length : null;
		const prev = previousRuns[ r.label ];
		const prevBest = prev && prev.lapTimes.length ? Math.min( ...prev.lapTimes ) : null;
		const delta = best !== null && prevBest !== null ? ( best - prevBest >= 0 ? '+' : '' ) + ( best - prevBest ).toFixed( 2 ) : '   - ';
		const hits = r.completedLaps ? ( r.wallImpacts / Math.max( 1, r.completedLaps ) ).toFixed( 1 ) : String( r.wallImpacts );

		console.log(
			'  ' + r.label.padEnd( 30 ) + fmt( best ) + ' ' + fmt( mean ) + ' ' + delta.padStart( 6 ) + '  ' +
			hits.padStart( 6 ) + '   ' + String( r.stuckEvents ).padStart( 3 ) + '  ' + r.lateralP50.toFixed( 2 ) + '   ' +
			pct( r.roadVisibleNear ) + '    ' + pct( r.roadVisibleFar ) + '    ' +
			( r.frameP50 * 1000 ).toFixed( 1 ).padStart( 5 ) + '/' + ( r.frameP95 * 1000 ).toFixed( 1 ).padEnd( 5 ) + ' ' + r.tier
		);

	}

}

let failures = 0;
console.log( '\nChecks' );

for ( const scenario of Object.values( report.scenarios ) ) {

	for ( const c of scenario.checks ) {

		if ( ! c.ok ) failures ++;
		console.log( `  ${ c.ok ? '✓' : '✗' } ${ c.name }${ c.detail ? '  (' + c.detail + ')' : '' }` );

	}

}

writeFileSync( join( reportDir, stamp + '.json' ), JSON.stringify( report, null, 2 ) );
writeFileSync( previousPath, JSON.stringify( report, null, 2 ) );

console.log( `\n${ failures ? failures + ' check(s) failed' : 'All checks passed' }. Report: ${ join( reportDir, stamp + '.json' ) }` );
if ( env.record ) console.log( `Recordings: ${ recordDir }/` );

process.exitCode = failures ? 1 : 0;
