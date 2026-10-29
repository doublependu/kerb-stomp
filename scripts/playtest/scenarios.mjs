// Playtest scenarios. Each gets a fresh browser context, plays through real
// input, and returns { checks: [{ name, ok, detail }], runs: [metrics] }.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Polyline, encodeLoop, encodeCells } from './track.mjs';
import { KeyboardDriver, TouchDriver, PadsDriver, drive } from './driver.mjs';

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

// Saved settings the page starts with: a car already picked (or the car grid
// opens first), the opponent count (0 = the time trial these scenarios were
// written for) and the touch scheme
function settings( { car = 'vehicle-truck-yellow', npcs = 0, touch = 'joystick' } = {} ) {

	return { car, npcs, touch };

}

async function presetStorage( context, prefs ) {

	await context.addInitScript( ( p ) => {

		if ( sessionStorage.getItem( 'playtest-preset' ) ) return;
		sessionStorage.setItem( 'playtest-preset', '1' );
		localStorage.setItem( 'kerb.car', p.car );
		localStorage.setItem( 'kerb.npcs', String( p.npcs ) );
		localStorage.setItem( 'kerb.touch', p.touch );

	}, prefs );

}

async function open( env, contextOptions, { query = '', video = env.record, label, prefs = {} } ) {

	const context = await env.browser.newContext( {
		...contextOptions,
		...( video ? { recordVideo: { dir: env.videoDir, size: contextOptions.viewport } } : {} ),
	} );

	await presetStorage( context, settings( prefs ) );

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

// The game's own centerline (a track that crosses itself can't be walked
// from its cells by grid position)
async function trackLine( page ) {

	const line = await page.evaluate( () => window.__kerb.line );
	return new Polyline( line.points, line.closed );

}

const DRIVERS = { keyboard: KeyboardDriver, touch: TouchDriver, pads: PadsDriver };

async function driveRuns( env, name, contextOptions, { input, skills, laps, query = '' } ) {

	const checks = [];
	const runs = [];

	for ( const skill of skills ) {

		const label = `${ name }-${ skill }`;
		const { page, errors, close } = await open( env, contextOptions, { query, label, prefs: { touch: input === 'pads' ? 'pads' : 'joystick' } } );
		const line = await trackLine( page );
		const Driver = DRIVERS[ input ];
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

	'phone-portrait-pads': ( env ) => driveRuns( env, 'phone-portrait-pads', PHONE_PORTRAIT, { input: 'pads', skills: [ 'novice', 'average', 'expert' ], laps: env.laps } ),

	'phone-landscape-pads': ( env ) => driveRuns( env, 'phone-landscape-pads', PHONE_LANDSCAPE, { input: 'pads', skills: [ 'average' ], laps: env.laps } ),

	// The built-in tracks in time trial, one average lap each way round
	'tracks': async ( env ) => {

		const checks = [];
		const runs = [];

		for ( const id of [ 'indianapolis', 'monza', 'monaco', 'suzuka', 'bathurst' ] ) {

			const result = await driveRuns( env, `track-${ id }`, LAPTOP, { input: 'keyboard', skills: [ 'average' ], laps: 2, query: '&track=' + id } );
			checks.push( ...result.checks );
			runs.push( ...result.runs );

		}

		return { checks, runs };

	},

	// Races against the NPCs: each bot skill races twice (the first race sets
	// a best lap, which the second race's field is paced from). Records the
	// finishing position: the field should be beatable but not a walkover.
	'race': async ( env ) => {

		const checks = [];
		const runs = [];
		const skills = env.raceSkills || [ 'novice', 'average', 'expert' ];

		for ( const id of env.raceTracks || [ 'classic' ] ) {

			for ( const skill of skills ) {

				const label = `race-${ id }-${ skill }`;
				const { page, errors, close } = await open( env, LAPTOP, { query: '&track=' + id, label, prefs: { npcs: env.npcs ?? 4 } } );
				const line = await trackLine( page );
				const results = [];

				// A failed race is a failed check; the rest of the matrix still runs
				try {

					for ( let race = 1; race <= 2; race ++ ) {

						// Enter: Race on the setup screen, Race again on the results.
						// The race's lap count is only set once it lines up.
						await page.keyboard.press( 'Enter' );
						await page.waitForFunction( () => window.__kerb.state().phase === 'countdown', null, { timeout: 15000 } );

						const laps = await page.evaluate( () => window.__kerb.race.laps );
						const driver = new KeyboardDriver( page, line, { skill, seed: env.seed + race } );
						const run = await drive( page, driver, { laps, timeout: laps * 70 + 30, until: ( s ) => s.finished } );

						await page.waitForFunction( () => document.body.dataset.state === 'finished', null, { timeout: 20000 } ).catch( () => {} );
						await page.waitForTimeout( 1500 );

						const s = await page.evaluate( () => ( { ...window.__kerb.state(), standings: window.__kerb.standings() } ) );
						const winner = s.standings[ 0 ];
						const me = s.standings.find( ( c ) => c.player );

						run.label = `${ label }-${ race }`;
						run.errors = errors.slice();
						run.position = s.position;
						run.field = s.cars;
						run.finishTime = me.finishTime;
						run.gapToWinner = me.finishTime !== null && winner.finishTime !== null ? me.finishTime - winner.finishTime : null;
						run.npcs = s.standings.filter( ( c ) => ! c.player ).map( ( c ) => ( { car: c.car, skill: c.skill, target: c.target, pace: c.pace, laps: c.lapTimes, respawns: c.respawns, hits: c.carHits } ) );
						delete run.final;
						runs.push( run );
						results.push( `${ s.position }/${ s.cars }` );

						check( checks, `${ run.label }: finishes the race`, s.finished, `${ run.completedLaps }/${ laps } laps` );
						check( checks, `${ run.label }: results screen`, s.screen === 'finished', s.screen );
						check( checks, `${ run.label }: never stuck`, run.stuckEvents === 0, `${ run.stuckEvents } stuck` );

						if ( race === 1 ) await env.screenshot( page, `${ label }-results` );

					}

				} catch ( e ) {

					const s = await page.evaluate( () => window.__kerb.state() ).catch( () => null );
					const where = s ? `${ s.screen } / ${ s.phase }, lap ${ s.lap }, finished ${ s.finished }` : 'page gone';
					check( checks, `${ label }: race ${ results.length + 1 } runs to the end`, false, `${ e.message.split( '\n' )[ 0 ] } (${ where })` );
					await env.screenshot( page, `${ label }-failed` ).catch( () => {} );

				}

				check( checks, `${ label }: no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
				checks.push( { name: `${ label }: finishing positions ${ results.join( ', ' ) }`, ok: true, detail: '' } );
				await close();

			}

		}

		return { checks, runs };

	},

	// The race flow around the driving: countdown, pause, results, race
	// again, back to setup, opponents and car changes, switching track
	'race-flow': async ( env ) => {

		const checks = [];
		const { page, errors, close } = await open( env, LAPTOP, { label: 'race-flow', prefs: { npcs: 3 } } );
		const state = () => page.evaluate( () => window.__kerb.state() );

		// Name the UI step that failed, rather than a bare timeout
		const tap = ( selector ) => page.click( selector, { timeout: 5000 } ).catch( ( e ) => {

			throw new Error( `clicking ${ selector }: ${ e.message.split( '\n' )[ 0 ] }` );

		} );

		// The opponents' cars load after the setup screen is up
		await page.waitForFunction( () => window.__kerb.state().cars === 4, null, { timeout: 10000 } ).catch( () => {} );
		let s = await state();
		check( checks, 'setup screen lines up the field', s.screen === 'ready' && s.mode === 'race' && s.cars === 4, `${ s.screen } ${ s.mode } ${ s.cars } cars` );
		await env.screenshot( page, 'race-flow-setup' );

		// W starts the race; the fly-over plays first, and a fresh key skips it
		await page.keyboard.down( 'KeyW' );
		await page.waitForTimeout( 1000 );
		s = await state();
		check( checks, 'the fly-over plays before the race', s.flyover && s.phase === 'grid' && s.speed < 0.2, `flyover ${ s.flyover }, ${ s.phase }` );
		await page.keyboard.press( 'Space' );
		await page.waitForTimeout( 500 );
		s = await state();
		check( checks, 'a key skips the fly-over; the countdown holds the cars', ! s.flyover && s.phase === 'countdown' && s.speed < 0.2, `flyover ${ s.flyover }, ${ s.phase }, speed ${ s.speed.toFixed( 2 ) }` );
		await page.waitForFunction( () => window.__kerb.state().phase === 'racing', null, { timeout: 5000 } );
		await page.waitForTimeout( 1200 );
		s = await state();
		check( checks, 'GO releases the cars', s.speed > 3 && s.raceTime > 0.8, `speed ${ s.speed.toFixed( 1 ) }, race time ${ s.raceTime.toFixed( 2 ) }` );
		await env.screenshot( page, 'race-flow-start' );

		await page.keyboard.press( 'Escape' );
		const a = await state();
		await page.waitForTimeout( 1000 );
		const b = await state();
		check( checks, 'pause freezes the race clock', b.screen === 'paused' && Math.abs( b.raceTime - a.raceTime ) < 0.02, `+${ ( b.raceTime - a.raceTime ).toFixed( 3 ) }s` );

		await tap( '#reset-btn' );
		await page.waitForTimeout( 300 );
		s = await state();
		check( checks, 'reset car puts it back on track and resumes', s.screen === 'playing' && s.resets >= 1, `${ s.screen }, ${ s.resets } resets` );
		await page.keyboard.up( 'KeyW' );

		await page.keyboard.press( 'Escape' );
		await tap( '.when-paused .restart-btn' );
		await page.waitForTimeout( 400 );
		s = await state();
		check( checks, 'restart lines up again', s.phase === 'countdown' && s.lap === 1 && s.raceTime === 0, `${ s.phase }, lap ${ s.lap }, ${ s.raceTime.toFixed( 2 ) }s` );

		await page.keyboard.press( 'Escape' );
		await tap( '.when-paused .setup-btn' );
		await page.waitForTimeout( 300 );
		await tap( '.when-ready .npc-stepper [data-step="-1"]' );
		await page.waitForTimeout( 800 );
		s = await state();
		check( checks, 'fewer opponents takes one off the grid', s.screen === 'ready' && s.cars === 3, `${ s.screen }, ${ s.cars } cars` );

		await tap( '#car-btn' );
		await tap( '.car-tile[data-car="firetruck"]' );
		await page.waitForTimeout( 800 );
		s = await state();
		check( checks, 'picking a car swaps the player\'s car', s.car === 'firetruck', s.car );
		await env.screenshot( page, 'race-flow-firetruck' );

		for ( let i = 0; i < 2; i ++ ) await tap( '.when-ready .npc-stepper [data-step="-1"]' );
		await page.waitForTimeout( 500 );
		s = await state();
		check( checks, 'no opponents is a time trial', s.mode === 'timetrial' && s.cars === 1 && ( await page.textContent( '#start-btn' ) ) === 'Drive', `${ s.mode }, ${ s.cars } cars` );

		await Promise.all( [ page.waitForNavigation(), tap( '#track-picker button:has-text("Monza")' ) ] );
		await page.waitForFunction( () => document.body.dataset.state === 'ready', null, { timeout: 30000 } );
		s = await state();
		check( checks, 'track picker loads Monza with the same car', s.track === 'monza' && s.car === 'firetruck', `${ s.track }, ${ s.car }` );
		await env.screenshot( page, 'race-flow-monza' );

		check( checks, 'race-flow: no page errors', errors.length === 0, errors.slice( 0, 3 ).join( ' | ' ) );
		await close();

		return { checks, runs: [] };

	},

	// The fly-over runs its course and hands over to the race, with no
	// quality step-down from its wide views
	'flyover': async ( env ) => {

		const checks = [];
		const { page, errors, close } = await open( env, LAPTOP, { query: '&track=suzuka', label: 'flyover', prefs: { npcs: 3 } } );
		await page.waitForFunction( () => document.getElementById( 'start-btn' ).textContent !== 'Getting ready…', null, { timeout: 30000 } );
		const before = await page.evaluate( () => window.__kerb.state().tier );

		await page.click( '#start-btn' );
		await page.waitForTimeout( 600 );
		let s = await page.evaluate( () => window.__kerb.state() );
		check( checks, 'flyover: starts on Race', s.flyover && s.phase === 'grid', `flyover ${ s.flyover }, ${ s.phase }` );
		await env.screenshot( page, 'flyover-overview' );

		await page.waitForFunction( () => window.__kerb.state().phase === 'countdown', null, { timeout: 10000 } );
		s = await page.evaluate( () => {

			const k = window.__kerb;
			const p = k.race.player.vehicle.container.position;
			const ndc = k.project( p.x, p.y + 0.5, p.z );
			return { ...k.state(), ndc, far: k.three.camera.far };

		} );
		check( checks, 'flyover: lands on the chase camera behind the player', Math.abs( s.ndc[ 0 ] ) < 0.3 && Math.abs( s.ndc[ 1 ] ) < 0.4 && s.far < 200, `player at ${ s.ndc.map( ( v ) => v.toFixed( 2 ) ) } on screen, far ${ s.far.toFixed( 0 ) }` );
		check( checks, 'flyover: no quality step-down', s.tier === before, `${ before } → ${ s.tier }` );
		check( checks, 'flyover: no page errors', errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
		await close();

		return { checks, runs: [] };

	},

	// Off Bathurst's unsealed cliff top: the wand brings the car back to the
	// road while the race clock runs on
	'cliff': async ( env ) => {

		const checks = [];
		const { page, errors, close } = await open( env, LAPTOP, { query: '&track=bathurst', label: 'cliff' } );

		await page.keyboard.press( 'Enter' );
		await page.waitForTimeout( 500 );

		// On the gravel past Skyline, pointed at the drop
		const start = await page.evaluate( () => {

			const r = window.__kerb.race;
			const line = r.line;
			const s = r.shape.cellStart[ 14 ] + 3;
			const p = line.pointAt( s ), dir = line.directionAt( s );
			const out = r.shape.outsideAt( s ); // the side the drop is (+ lateral is right)
			const angle = dir - out * Math.PI * 0.4;
			r.place( r.player, [ p[ 0 ], 0.5 + line.heightAt( s ), p[ 1 ] ], angle );
			r.player.counter.running = true;
			return { y: r.player.vehicle.spherePos.y, resets: r.player.vehicle.resets };

		} );

		await page.keyboard.down( 'KeyW' );
		let fell = false, carried = false, back = false;

		for ( let t = 0; t < 60 && ! back; t ++ ) {

			await page.waitForTimeout( 100 );
			const s = await page.evaluate( () => {

				const c = window.__kerb.race.player;
				return { y: c.vehicle.spherePos.y, carry: Boolean( c.carry ), road: c.onRoad, lateral: c.proj.lateral, time: window.__kerb.race.time };

			} );

			if ( s.y < start.y - 2 ) fell = true;
			if ( s.carry ) { carried = true; await page.keyboard.up( 'KeyW' ); }
			if ( carried && ! s.carry && s.road && Math.abs( s.lateral ) < 3.4 ) back = true;
			if ( t === 8 ) await env.screenshot( page, 'cliff-falling' );

		}

		await page.keyboard.up( 'KeyW' );
		check( checks, 'cliff: the car goes over the edge', fell );
		check( checks, 'cliff: the wand fetches it', carried );
		check( checks, 'cliff: and puts it back on the road', back );
		check( checks, 'cliff: no page errors', errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
		await close();

		return { checks, runs: [] };

	},

	// Badges: one with 3 or fewer cars, three with more; the podium shows
	'podium': async ( env ) => {

		const checks = [];

		for ( const [ npcs, medals ] of [ [ 2, 1 ], [ 4, 3 ] ] ) {

			const { page, errors, close } = await open( env, LAPTOP, { query: '&noflyover', label: `podium-${ npcs + 1 }-cars`, prefs: { npcs } } );
			await page.waitForFunction( () => document.getElementById( 'start-btn' ).textContent !== 'Getting ready…', null, { timeout: 30000 } );
			await page.click( '#start-btn' );
			await page.waitForFunction( () => window.__kerb.state().phase === 'racing', null, { timeout: 10000 } );

			// The player's car on autopilot, one lap
			await page.evaluate( () => {

				const r = window.__kerb.race;
				r.laps = 1;
				const Driver = r.cars.find( ( c ) => c.driver ).driver.constructor;
				r.player.driver = new Driver( r.line, { skill: 1, seed: 5 } );
				r.player.driver.racing = r.racing;

			} );

			await page.waitForFunction( () => document.body.dataset.state === 'finished', null, { timeout: 60000 } );
			await page.waitForFunction( () => window.__kerb.race.cars.every( ( c ) => c.finished ) || window.__kerb.race.phase === 'done', null, { timeout: 30000 } ).catch( () => {} );
			await page.waitForTimeout( 1200 );

			const s = await page.evaluate( () => ( { medals: document.querySelectorAll( '#results .medal' ).length, podium: window.__kerb.podium.active, picker: localStorage.getItem( 'kerb.medals' ) } ) );
			check( checks, `podium, ${ npcs + 1 } cars: ${ medals } badge${ medals > 1 ? 's' : '' }`, s.medals === medals, `${ s.medals } medals` );
			check( checks, `podium, ${ npcs + 1 } cars: the podium shows`, s.podium );
			await env.screenshot( page, `podium-${ npcs + 1 }-cars` );
			check( checks, `podium, ${ npcs + 1 } cars: no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
			await close();

		}

		return { checks, runs: [] };

	},

	// What the kerbs cost: the expert bot (which never brakes, so it slides
	// wide onto them) with the kerbs dragging and without
	'kerbs': async ( env ) => {

		const checks = [];
		const runs = [];
		const laps = {};

		for ( const kerb of [ 0, null ] ) {

			const label = `kerbs-${ kerb === 0 ? 'off' : 'on' }`;
			const { page, errors, close } = await open( env, LAPTOP, { label } );
			if ( kerb === 0 ) await page.evaluate( () => window.__kerb.surface.kerb = 0 );
			const line = await trackLine( page );
			const run = await drive( page, new KeyboardDriver( page, line, { skill: 'expert', seed: env.seed } ), { laps: 3, timeout: 120 } );
			run.label = label;
			delete run.final;
			runs.push( run );
			laps[ label ] = Math.min( ...run.lapTimes );
			check( checks, `${ label }: no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
			await close();

		}

		const cost = laps[ 'kerbs-on' ] / laps[ 'kerbs-off' ] - 1;
		check( checks, `kerbs: cost the wall-sliding expert ${ ( cost * 100 ).toFixed( 1 ) }% a lap`, cost > 0.02, `${ laps[ 'kerbs-off' ].toFixed( 2 ) } → ${ laps[ 'kerbs-on' ].toFixed( 2 ) } s` );

		return { checks, runs };

	},

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

		// The wand flies it back: measure once it's down
		await page.waitForFunction( () => ! window.__kerb.state().carried, null, { timeout: 5000, polling: 50 } ).catch( () => {} );
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
		const start = await page.evaluate( () => {

			const r = document.getElementById( 'start-btn' ).getBoundingClientRect();
			return [ r.left + r.width / 2, r.top + r.height / 2 ];

		} );
		await touch( 'touchStart', [ start ] );
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
		await presetStorage( context, settings() );
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
