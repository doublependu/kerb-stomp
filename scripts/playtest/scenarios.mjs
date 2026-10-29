// Playtest scenarios. Each gets a fresh browser context, plays through real
// input, and returns { checks: [{ name, ok, detail }], runs: [metrics] }.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { centerline, encodeLoop, encodeCells } from './track.mjs';
import { KeyboardDriver, TouchDriver, drive } from './driver.mjs';

const DESKTOP = { viewport: { width: 1920, height: 1080 } };
const LAPTOP = { viewport: { width: 1366, height: 768 } };
const PHONE_PORTRAIT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const PHONE_LANDSCAPE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

// Custom tracks, as the editor would encode them
const TRACKS = {
	oval: encodeLoop( [ [ 0, 0 ], [ 1, 0 ], [ 2, 0 ], [ 3, 0 ], [ 3, 1 ], [ 3, 2 ], [ 2, 2 ], [ 1, 2 ], [ 0, 2 ], [ 0, 1 ] ], 1 ),
	stepped: encodeLoop( [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 2, 1 ], [ 3, 1 ], [ 3, 2 ], [ 3, 3 ], [ 2, 3 ], [ 1, 3 ], [ 0, 3 ], [ 0, 2 ], [ 0, 1 ] ], 10 ),
	// An open straight: driving off its end and off the ground tests the fall reset
	deadEnd: encodeCells( [ [ 0, 0, 'track-finish', 0 ], [ 0, 1, 'track-straight', 0 ], [ 0, 2, 'track-straight', 0 ] ] ),
};

function check( checks, name, ok, detail = '' ) {

	checks.push( { name, ok: Boolean( ok ), detail } );

}

async function open( env, contextOptions, { query = '', video = env.record, label } ) {

	const context = await env.browser.newContext( {
		...contextOptions,
		...( video ? { recordVideo: { dir: env.videoDir, size: contextOptions.viewport } } : {} ),
	} );

	const page = await context.newPage();
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	page.on( 'console', ( m ) => {

		if ( m.type() === 'error' ) errors.push( m.text() );

	} );

	await page.goto( env.url + '?playtest' + query );
	await page.waitForFunction( () => document.body.dataset.state === 'ready' || document.body.dataset.state === 'error', null, { timeout: 30000 } );

	const close = async () => {

		await context.close();
		if ( video ) env.saveVideo( page, label );

	};

	return { context, page, errors, close };

}

async function trackLine( page ) {

	const { cells, spawn } = await page.evaluate( () => ( { cells: window.__kerb.cells, spawn: window.__kerb.spawn } ) );
	return centerline( cells, spawn.angle );

}

async function driveRuns( env, name, contextOptions, { input, skills, laps, query = '' } ) {

	const checks = [];
	const runs = [];

	for ( const skill of skills ) {

		const label = `${ name }-${ skill }`;
		const { page, errors, close } = await open( env, contextOptions, { query, label } );
		const line = await trackLine( page );
		const Driver = input === 'touch' ? TouchDriver : KeyboardDriver;
		const run = await drive( page, new Driver( page, line, { skill, seed: env.seed } ), { laps, timeout: laps * 60 + 20 } );

		run.label = label;
		run.errors = errors;
		delete run.final;
		runs.push( run );

		check( checks, `${ label }: completes ${ laps } laps`, run.completedLaps >= laps, `${ run.completedLaps } laps` );
		check( checks, `${ label }: no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
		check( checks, `${ label }: never stuck`, run.stuckEvents === 0, `${ run.stuckEvents } stuck` );

		await close();

	}

	return { checks, runs };

}

async function viewportMatches( page ) {

	const s = await page.evaluate( () => ( { ...window.__kerb.state(), innerWidth, innerHeight } ) );
	const backing = Math.abs( s.canvasWidth - Math.round( s.clientWidth * s.pixelRatio ) ) <= 1 && Math.abs( s.canvasHeight - Math.round( s.clientHeight * s.pixelRatio ) ) <= 1;
	const fills = s.clientWidth === s.innerWidth && s.clientHeight === s.innerHeight;
	const aspect = Math.abs( s.aspect - s.clientWidth / s.clientHeight ) / ( s.clientWidth / s.clientHeight ) < 0.01;

	return { ok: backing && fills && aspect, detail: `css ${ s.clientWidth }×${ s.clientHeight } canvas ${ s.canvasWidth }×${ s.canvasHeight } @${ s.pixelRatio } aspect ${ s.aspect.toFixed( 3 ) } fov ${ s.fov.toFixed( 1 ) } zoom ${ s.zoomOut.toFixed( 2 ) }` };

}

export const SCENARIOS = {

	'desktop-keyboard': ( env ) => driveRuns( env, 'desktop-keyboard', DESKTOP, { input: 'keyboard', skills: [ 'novice', 'average', 'expert' ], laps: env.laps } ),

	'laptop-keyboard': ( env ) => driveRuns( env, 'laptop-keyboard', LAPTOP, { input: 'keyboard', skills: [ 'average' ], laps: env.laps } ),

	'phone-portrait-touch': ( env ) => driveRuns( env, 'phone-portrait-touch', PHONE_PORTRAIT, { input: 'touch', skills: [ 'novice', 'average', 'expert' ], laps: env.laps } ),

	'phone-landscape-touch': ( env ) => driveRuns( env, 'phone-landscape-touch', PHONE_LANDSCAPE, { input: 'touch', skills: [ 'average' ], laps: env.laps } ),

	'custom-tracks': async ( env ) => {

		const checks = [];
		const runs = [];

		for ( const name of [ 'oval', 'stepped' ] ) {

			const result = await driveRuns( env, `custom-${ name }`, LAPTOP, { input: 'keyboard', skills: [ 'average' ], laps: 2, query: '&map=' + TRACKS[ name ] } );
			checks.push( ...result.checks );
			runs.push( ...result.runs );

		}

		// Off the end of an open track, off the ground, and back to *this*
		// track's start line (it used to reset to the default track's spawn)
		const { page, errors, close } = await open( env, LAPTOP, { query: '&map=' + TRACKS.deadEnd, label: 'custom-dead-end' } );
		const spawn = await page.evaluate( () => window.__kerb.spawn );
		await page.keyboard.down( 'KeyW' );
		await page.waitForFunction( () => window.__kerb.state().resets > 0, null, { timeout: 30000, polling: 50 } ).catch( () => {} );
		await page.keyboard.up( 'KeyW' );
		const after = await page.evaluate( () => window.__kerb.state() );
		const distance = Math.hypot( after.x - spawn.position[ 0 ], after.z - spawn.position[ 2 ] );

		check( checks, 'custom-dead-end: falling off resets the truck', after.resets > 0, `${ after.resets } resets` );
		check( checks, 'custom-dead-end: reset lands on this track\'s start', distance < 2, `${ distance.toFixed( 2 ) } m from spawn` );
		check( checks, 'custom-dead-end: no page errors', errors.length === 0, errors.join( ' | ' ) );
		await close();

		return { checks, runs };

	},

	'rotate-mid-race': async ( env ) => {

		const checks = [];
		const { page, errors, close } = await open( env, PHONE_PORTRAIT, { label: 'rotate-mid-race' } );
		const line = await trackLine( page );
		const driver = new TouchDriver( page, line, { skill: 'average', seed: env.seed } );

		// On a mobile context Playwright also flips screen.orientation, and
		// (unlike a raw CDP override) keeps screenshots at the new size
		const orientations = [
			{ width: 844, height: 390 },
			{ width: 390, height: 844 },
			{ width: 844, height: 390 },
		];
		let next = 0;
		let lastRotate = Date.now();

		const shot = async ( name ) => env.screenshot( page, `rotate-${ name }` );

		const run = await drive( page, driver, {
			laps: 2,
			timeout: 140,
			onTick: async ( state ) => {

				if ( state.screen !== 'playing' || next >= orientations.length || Date.now() - lastRotate < 6000 ) return;

				const o = orientations[ next ++ ];
				await shot( `${ next }-before` );
				await page.setViewportSize( o );
				await page.waitForTimeout( 400 );
				const match = await viewportMatches( page );
				const orientation = await page.evaluate( () => screen.orientation.type );
				check( checks, `rotate ${ next } → ${ o.width }×${ o.height } (${ orientation }): canvas fills and keeps aspect`, match.ok, match.detail );
				await shot( `${ next }-after` );
				await driver.replace();
				lastRotate = Date.now();

			},
		} );

		delete run.final;
		run.label = 'rotate-mid-race';
		check( checks, 'rotate-mid-race: keeps driving through rotations (2 laps)', run.completedLaps >= 2, `${ run.completedLaps } laps` );
		check( checks, 'rotate-mid-race: no page errors', errors.length === 0, errors.join( ' | ' ) );
		await close();

		return { checks, runs: [ run ] };

	},

	'pause-resume': async ( env ) => {

		const checks = [];
		const { page, errors, close } = await open( env, LAPTOP, { label: 'pause-resume' } );
		const state = () => page.evaluate( () => window.__kerb.state() );

		async function frozenWhilePaused( how, pauseFn, resumeFn ) {

			await page.keyboard.down( 'KeyW' );
			await page.waitForTimeout( 1500 );
			await pauseFn();
			await page.waitForTimeout( 200 );
			const a = await state();
			await page.waitForTimeout( 1500 );
			const b = await state();
			check( checks, `pause via ${ how }: shows pause screen`, a.screen === 'paused', a.screen );
			check( checks, `pause via ${ how }: lap clock and truck frozen`, Math.abs( b.lapTime - a.lapTime ) < 0.02 && Math.hypot( b.x - a.x, b.z - a.z ) < 0.01, `clock +${ ( b.lapTime - a.lapTime ).toFixed( 3 ) }s` );
			check( checks, `pause via ${ how }: audio suspended`, b.audioState !== 'running', b.audioState );
			await resumeFn();
			await page.waitForTimeout( 300 );
			const c = await state();
			check( checks, `resume after ${ how }: no jump on resume`, Math.hypot( c.x - b.x, c.z - b.z ) < 4, `${ Math.hypot( c.x - b.x, c.z - b.z ).toFixed( 2 ) } m in 0.3s` );
			await page.keyboard.up( 'KeyW' );
			await page.waitForTimeout( 300 );

		}

		await frozenWhilePaused( 'Escape key', () => page.keyboard.press( 'Escape' ), () => page.keyboard.press( 'Escape' ) );
		await frozenWhilePaused( 'pause button', () => page.click( '#pause-btn' ), () => page.click( '#resume-btn' ) );
		await frozenWhilePaused( 'tab hidden', () => page.evaluate( () => {

			Object.defineProperty( document, 'hidden', { value: true, configurable: true } );
			document.dispatchEvent( new Event( 'visibilitychange' ) );

		} ), async () => {

			await page.evaluate( () => {

				Object.defineProperty( document, 'hidden', { value: false, configurable: true } );
				document.dispatchEvent( new Event( 'visibilitychange' ) );

			} );
			await page.keyboard.press( 'KeyP' );

		} );

		// Alt-tab while holding W: the keyup is never delivered, so the game
		// must drop held keys on blur or the truck drives itself on return
		await page.keyboard.down( 'KeyW' );
		await page.waitForTimeout( 1500 );
		await page.evaluate( () => window.dispatchEvent( new Event( 'blur' ) ) );
		await page.waitForTimeout( 200 );
		const blurred = await state();
		check( checks, 'window blur: pauses', blurred.screen === 'paused', blurred.screen );
		await page.click( '#resume-btn' );
		await page.waitForTimeout( 2500 );
		const coasted = await state();
		check( checks, 'window blur: held keys are released (truck coasts to a stop)', coasted.linearSpeed < 0.3, `linearSpeed ${ coasted.linearSpeed.toFixed( 2 ) }` );
		await page.keyboard.up( 'KeyW' );

		await env.screenshot( page, 'pause-screen', async () => {

			await page.keyboard.press( 'Escape' );
			await page.waitForTimeout( 300 );

		} );

		check( checks, 'pause-resume: no page errors', errors.length === 0, errors.join( ' | ' ) );
		await close();

		return { checks, runs: [] };

	},

	'zoom-lock': async ( env ) => {

		const checks = [];
		const { page, context, errors, close } = await open( env, PHONE_PORTRAIT, { video: false } );
		const cdp = await context.newCDPSession( page );
		const scale = () => page.evaluate( () => window.visualViewport.scale );
		const touch = ( type, points ) => cdp.send( 'Input.dispatchTouchEvent', { type, touchPoints: points.map( ( [ x, y ], id ) => ( { x, y, id } ) ) } );

		// Start the game, then pinch outwards
		await touch( 'touchStart', [ [ 195, 420 ] ] );
		await touch( 'touchEnd', [] );
		await touch( 'touchStart', [ [ 170, 420 ], [ 220, 420 ] ] );
		for ( let i = 1; i <= 10; i ++ ) await touch( 'touchMove', [ [ 170 - i * 12, 420 ], [ 220 + i * 12, 420 ] ] );
		await touch( 'touchEnd', [] );
		await page.waitForTimeout( 300 );
		check( checks, 'pinch does not zoom the page', ( await scale() ) === 1, `scale ${ await scale() }` );

		// Double-tap on the pause overlay (DOM UI, not the canvas)
		await page.click( '#pause-btn' );
		for ( let i = 0; i < 2; i ++ ) {

			await touch( 'touchStart', [ [ 195, 120 ] ] );
			await touch( 'touchEnd', [] );
			await page.waitForTimeout( 80 );

		}

		await page.waitForTimeout( 300 );
		check( checks, 'double-tap does not zoom the page', ( await scale() ) === 1, `scale ${ await scale() }` );
		check( checks, 'zoom-lock: no page errors', errors.length === 0, errors.join( ' | ' ) );
		checks.push( { name: 'note: emulated touch only; confirm pinch on a real iPhone (Safari ignores user-scalable=no)', ok: true, detail: '' } );
		await close();

		return { checks, runs: [] };

	},

	'offline-file': async ( env ) => {

		const checks = [];
		const context = await env.browser.newContext( { ...LAPTOP, offline: true } );
		const page = await context.newPage();
		const errors = [];
		const requests = [];
		page.on( 'pageerror', ( e ) => errors.push( e.message ) );
		page.on( 'request', ( r ) => {

			if ( ! /^(data|blob|file):/.test( r.url() ) ) requests.push( r.url() );

		} );

		const file = pathToFileURL( resolve( 'dist/kerb-stomp.html' ) ).href;
		await page.goto( file + '?playtest' );
		await page.waitForFunction( () => document.body.dataset.state === 'ready' || document.body.dataset.state === 'error', null, { timeout: 30000 } );
		await page.keyboard.down( 'KeyW' );
		await page.waitForTimeout( 2500 );
		await page.keyboard.up( 'KeyW' );
		const s = await page.evaluate( () => ( { ...window.__kerb.state(), download: ! document.getElementById( 'download-link' ).hidden, editor: [ ...document.querySelectorAll( '.editor-link' ) ].some( ( a ) => ! a.hidden ) } ) );

		check( checks, 'offline file: loads and drives over file:// with no network', s.screen === 'playing' && s.speed > 2, `screen ${ s.screen }, speed ${ s.speed.toFixed( 1 ) }` );
		check( checks, 'offline file: makes no network requests', requests.length === 0, requests.slice( 0, 3 ).join( ' ' ) );
		check( checks, 'offline file: engine synth runs (worklet loads)', s.engineReady && s.audioState === 'running', `${ s.audioState }, engine ${ s.engineReady }` );
		check( checks, 'offline file: hides download and editor links', ! s.download && ! s.editor, `download ${ s.download }, editor ${ s.editor }` );
		check( checks, 'offline file: no page errors', errors.length === 0, errors.join( ' | ' ) );
		await context.close();

		return { checks, runs: [] };

	},

	// Same scripted input, no feedback loop, at several display rates: the
	// fixed-step sim should produce the same motion
	'framerate': async ( env ) => {

		const checks = [];
		const rates = [ [ '30fps', '&fps=30' ], [ '60fps', '' ], [ '120Hz', '&frames=2' ] ];
		const script = [ [ 0, [ 'KeyW' ] ], [ 1.5, [ 'KeyW', 'KeyA' ] ], [ 2.1, [ 'KeyW' ] ], [ 2.6, [] ] ];
		const at = [ 1.0, 1.5, 2.1, 2.6, 3.4 ];
		const results = {};

		for ( const [ label, query ] of rates ) {

			const { page, close } = await open( env, LAPTOP, { query: '&quality=low' + query, video: false } );
			const held = new Set();
			const samples = [];
			let stepIndex = 0;

			while ( samples.length < at.length ) {

				const s = await page.evaluate( () => window.__kerb.state() );
				const t = s.timerRunning ? s.lapTime : 0;

				while ( stepIndex < script.length && t >= script[ stepIndex ][ 0 ] ) {

					const keys = new Set( script[ stepIndex ++ ][ 1 ] );
					for ( const k of held ) if ( ! keys.has( k ) ) await page.keyboard.up( k );
					for ( const k of keys ) if ( ! held.has( k ) ) await page.keyboard.down( k );
					held.clear();
					keys.forEach( ( k ) => held.add( k ) );

				}

				if ( t >= at[ samples.length ] ) samples.push( s.speed );
				await page.waitForTimeout( 8 );

			}

			results[ label ] = samples;
			await close();

		}

		const base = results[ '60fps' ];

		for ( const label of Object.keys( results ) ) {

			const worst = Math.max( ...results[ label ].map( ( v, i ) => Math.abs( v - base[ i ] ) / Math.max( 1, base[ i ] ) ) );
			check( checks, `framerate: ${ label } matches 60fps motion`, worst < 0.03, `worst speed diff ${ ( worst * 100 ).toFixed( 1 ) }% (${ results[ label ].map( ( v ) => v.toFixed( 2 ) ).join( ', ' ) })` );

		}

		return { checks, runs: [] };

	},

};
