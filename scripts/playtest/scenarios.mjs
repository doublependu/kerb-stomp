// Playtest scenarios. Each gets a fresh browser context, plays through real
// input, and returns { checks: [{ name, ok, detail }], runs: [metrics] }.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Polyline, encodeLoop, encodeCells } from './track.mjs';
import { KeyboardDriver, TouchDriver, PadsDriver, drive } from './driver.mjs';
import { TRACKS as BUILT_IN } from '../../js/Tracks.js';
import { computeTrackBounds } from '../../js/Track.js';
import { CELL } from '../../js/TrackPath.js';
import { readPNG } from '../png.mjs';

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

async function open( env, contextOptions, { query = '', video = env.record, label, prefs = {}, init = null } ) {

	const context = await env.browser.newContext( {
		...contextOptions,
		...( video ? { recordVideo: { dir: env.videoDir, size: contextOptions.viewport } } : {} ),
	} );

	await presetStorage( context, settings( prefs ) );
	if ( init ) await context.addInitScript( init );

	const page = await context.newPage();
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	page.on( 'console', ( m ) => {

		if ( m.type() === 'error' ) errors.push( m.text() );

	} );

	// --tier forces a quality tier, unless the scenario picks its own
	const tier = env.tier && ! query.includes( 'quality=' ) ? '&quality=' + env.tier : '';
	await page.goto( env.url + '?playtest' + query + tier );
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

// The fly-over's picture, frame by frame. Its clock runs SLOW times slower,
// a fixed step a frame (the game's timer goes by requestAnimationFrame's
// timestamps), so features barely move between frames, a busy computer
// can't jerk them, and what changes and changes back is flicker, not motion.
// A flash: over 0.4% of the pixels doing that, and 3× the frames
// around it. The hand-over: the share of pixels the first chase frame changes.
const SLOW = 6;

function slowClock( slow ) {

	const raf = window.requestAnimationFrame.bind( window );
	let clock = 0, last = null;
	window.__clockRate = 1;

	window.requestAnimationFrame = ( callback ) => raf( ( t ) => {

		// Once a frame, however many callbacks it has
		if ( t !== last ) clock += 1000 / 60 * window.__clockRate;
		last = t;
		callback( clock );

	} );

	window.__slow = 1 / slow;

}

function watchPicture() {

	const k = window.__kerb, { renderer, scene } = k.three;
	const gl = renderer.getContext();
	const render = renderer.render.bind( renderer );
	const T = 10;
	const probe = window.__picture = { log: [], handover: null, before: [], done: false };
	let a = null, b = null, pixels = null, flying = false;

	const read = () => {

		const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
		pixels = pixels || new Uint8Array( w * h * 4 );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
		const luma = new Int16Array( w * h );
		for ( let i = 0; i < luma.length; i ++ ) luma[ i ] = ( pixels[ i * 4 ] * 77 + pixels[ i * 4 + 1 ] * 151 + pixels[ i * 4 + 2 ] * 28 ) >> 8;
		return luma;

	};

	const changed = ( p, q ) => {

		let count = 0;
		for ( let i = 0; i < p.length; i ++ ) if ( Math.abs( p[ i ] - q[ i ] ) > 8 ) count ++;
		return count / p.length;

	};

	renderer.render = ( s, c ) => {

		// The bloom's own passes come through here too
		if ( s !== scene || probe.done ) return render( s, c );

		const f = k.flyover();
		if ( f ) window.__clockRate = window.__slow;
		render( s, c );

		if ( f ) {

			flying = true;
			const c0 = read();

			if ( a && b ) {

				let count = 0;

				for ( let i = 0; i < c0.length; i ++ ) {

					const d1 = b[ i ] - a[ i ], d2 = c0[ i ] - b[ i ];
					if ( ( d1 > T && d2 < - T ) || ( d1 < - T && d2 > T ) ) count ++;

				}

				probe.log.push( [ f.t, count / c0.length ] );

			}

			if ( b ) probe.before.push( changed( b, c0 ) );
			a = b;
			b = c0;

		} else if ( flying ) {

			probe.handover = changed( b, read() );
			probe.done = true;
			window.__clockRate = 1;

		}

	};

}

// The player's car in a straight line for the ramp's lip, `distance` m short
// of it at `speed` m/s, rolling
function aimAtRamp( { distance, speed } ) {

	const race = window.__kerb.race, car = race.player, line = race.line;
	const s = race.shape.ramps[ 0 ].s - distance, p = line.pointAt( s ), dir = line.directionAt( s );

	race.place( car, [ p[ 0 ], 0.55 + line.heightAt( s ), p[ 1 ] ], dir );
	car.counter.running = true;
	car.vehicle.linearSpeed = speed / 10;

	const motion = car.vehicle.rigidBody.motionProperties;
	motion.linearVelocity[ 0 ] = Math.sin( dir ) * speed;
	motion.linearVelocity[ 2 ] = Math.cos( dir ) * speed;
	motion.angularVelocity[ 0 ] = Math.cos( dir ) * speed * 2;
	motion.angularVelocity[ 2 ] = - Math.sin( dir ) * speed * 2;

	return dir;

}

// A flight from the page's side, from now till it lands: how far the nose
// turned, how much speed it lost, how long it was up
function watchFlight() {

	return new Promise( ( resolve ) => {

		const k = window.__kerb, first = k.state();
		let turned = 0, lost = 0, airtime = 0;

		const tick = () => {

			const s = k.state();
			if ( ! s.flying ) return resolve( { turned, lost, airtime, speed: first.speed, heading: s.heading } );

			const d = s.heading - first.heading;
			turned = Math.max( turned, Math.abs( Math.atan2( Math.sin( d ), Math.cos( d ) ) ) );
			lost = Math.max( lost, first.speed - s.speed );
			airtime = s.airtime;
			requestAnimationFrame( tick );

		};

		tick();

	} );

}

function turnedSince( heading, now ) {

	return Math.abs( Math.atan2( Math.sin( now - heading ), Math.cos( now - heading ) ) );

}

function flashes( log ) {

	const median = ( values ) => values.slice().sort( ( p, q ) => p - q )[ values.length >> 1 ];
	const found = [];

	log.forEach( ( [ t, share ], i ) => {

		if ( i < 6 || i >= log.length - 6 ) return;
		if ( share > 0.004 && share > 3 * median( log.slice( i - 6, i + 7 ).map( ( e ) => e[ 1 ] ) ) ) found.push( { t, share } );

	} );

	return found;

}

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

// How much a screenshot's colours vary (the mean distance of a sparse grid of
// pixels from their average): a blank frame of one colour gives 0
function frameSpread( png ) {

	const { width, height, pixels } = readPNG( png );
	const samples = [];

	for ( let y = 4; y < height; y += 16 ) for ( let x = 4; x < width; x += 16 ) {

		const o = ( y * width + x ) * 4;
		samples.push( [ pixels[ o ], pixels[ o + 1 ], pixels[ o + 2 ] ] );

	}

	const mean = [ 0, 1, 2 ].map( ( k ) => samples.reduce( ( a, s ) => a + s[ k ], 0 ) / samples.length );
	return samples.reduce( ( a, s ) => a + Math.hypot( s[ 0 ] - mean[ 0 ], s[ 1 ] - mean[ 1 ], s[ 2 ] - mean[ 2 ] ), 0 ) / samples.length;

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

	// Stills for review once the scenery has loaded: each built-in track from
	// above, and every turn from straight above (its landmark, chevron and
	// whatever stands near the road)
	'scenery': async ( env ) => {

		const checks = [];

		for ( const track of BUILT_IN ) {

			const { page, errors, close } = await open( env, LAPTOP, { query: `&track=${ track.id }&noflyover`, label: 'scenery-' + track.id, video: false } );
			await page.waitForFunction( () => window.__kerb.sceneryLoaded(), null, { timeout: 30000 } );
			await page.waitForTimeout( 300 );

			const b = computeTrackBounds( track.id === 'classic' ? null : track.cells );
			const tall = Math.max( b.halfWidth * 768 / 1366, b.halfDepth ) / Math.tan( Math.PI / 180 * 25 );
			env.saveImage( `scenery-${ track.id }`, await page.evaluate( ( [ p, l ] ) => window.__kerb.view( p, l ), [ [ b.centerX, tall, b.centerZ + 0.01 ], [ b.centerX, 0, b.centerZ ] ] ) );

			const cells = track.cells;
			const turns = cells.filter( ( c, i ) => c[ 2 ] === 'track-corner' && ( ! track.layout || cells[ ( i - 1 + cells.length ) % cells.length ][ 2 ] !== 'track-corner' ) );

			for ( const [ k, c ] of turns.entries() ) {

				const x = ( c[ 0 ] + 0.5 ) * CELL, z = ( c[ 1 ] + 0.5 ) * CELL;
				env.saveImage( `scenery-${ track.id }-turn-${ k + 1 }`, await page.evaluate( ( [ p, l ] ) => window.__kerb.view( p, l ), [ [ x, 30, z + 0.01 ], [ x, 0, z ] ] ) );

			}

			// The chase camera's own view, along the lap: nothing hides the road
			const points = await page.evaluate( () => window.__kerb.line.points );

			for ( let k = 0; k < 8; k ++ ) {

				const q = points[ Math.floor( k / 8 * points.length ) ];
				env.saveImage( `scenery-${ track.id }-chase-${ k + 1 }`, await page.evaluate( ( [ p, l ] ) => window.__kerb.view( p, l, 32 ), [ [ q[ 0 ] + 9.27, 9.18, q[ 1 ] + 9.27 ], [ q[ 0 ], 0, q[ 1 ] ] ] ) );

			}

			check( checks, `scenery ${ track.id }: ${ turns.length } turns shot, no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
			await close();

		}

		return { checks, runs: [] };

	},

	// Every built-in track drawn at each quality tier, from the setup view and
	// a second into a race: no blank or single-colour frame, and no mesh with
	// a zero-length or non-finite normal (the lit tiers normalise those into
	// NaN pixels, and the high tier's bloom spreads them over the frame)
	'tiers': async ( env ) => {

		const checks = [];

		for ( const track of BUILT_IN ) {

			for ( const tier of [ 'low', 'medium', 'high' ] ) {

				const label = `tiers-${ track.id }-${ tier }`;
				const { page, errors, close } = await open( env, LAPTOP, { query: `&track=${ track.id }&noflyover&quality=${ tier }`, label, video: false } );
				await page.waitForFunction( () => window.__kerb.sceneryLoaded(), null, { timeout: 30000 } );
				await page.waitForTimeout( 500 );

				for ( const moment of [ 'setup', 'race' ] ) {

					// W dismisses the start screen and drives
					if ( moment === 'race' ) {

						await page.keyboard.down( 'KeyW' );
						await page.waitForTimeout( 2500 );

					}

					const png = await page.screenshot();
					env.saveImage( `${ label }-${ moment }`, 'data:image/png;base64,' + png.toString( 'base64' ) );
					const spread = frameSpread( png );
					check( checks, `${ label }: ${ moment } frame isn't blank`, spread > 12, `colour spread ${ spread.toFixed( 1 ) }` );

				}

				await page.keyboard.up( 'KeyW' );

				const normals = await page.evaluate( () => {

					const bad = [];

					window.__kerb.three.scene.traverse( ( o ) => {

						const normal = o.isMesh && o.geometry && o.geometry.getAttribute( 'normal' );
						if ( ! normal ) return;
						let n = 0;

						for ( let i = 0; i < normal.count; i ++ ) {

							const l = Math.hypot( normal.getX( i ), normal.getY( i ), normal.getZ( i ) );
							if ( ! ( l > 0.5 ) ) n ++;

						}

						if ( n ) bad.push( `${ o.name || o.parent && o.parent.name || 'mesh' } ${ n }/${ normal.count }` );

					} );

					return bad;

				} );

				check( checks, `${ label }: no zero or NaN normals`, normals.length === 0, normals.slice( 0, 3 ).join( ', ' ) );
				check( checks, `${ label }: no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
				await close();

			}

		}

		return { checks, runs: [] };

	},

	// The Scenery tool, through real input: on Indianapolis take a stand away,
	// place a tree, turn it 90° and drag it; Play carries that into the game as
	// the same track; reloading the editor's link brings the edit back. On
	// Suzuka the road is locked and the hill's scenery still opens.
	'editor-scenery': async ( env ) => {

		const checks = [];
		const context = await env.browser.newContext( LAPTOP );
		const page = await context.newPage();
		const errors = [];
		page.on( 'pageerror', ( e ) => errors.push( e.message ) );
		page.on( 'console', ( m ) => {

			if ( m.type() === 'error' ) errors.push( m.text() );

		} );

		const items = () => page.evaluate( () => window.__editor.items().map( ( { id, x, z, angle } ) => ( { id, x, z, angle } ) ) );
		const screen = ( x, z ) => page.evaluate( ( [ a, b ] ) => window.__editor.screen( a, b ), [ x, z ] );

		await page.goto( env.url + 'editor.html?playtest&track=indianapolis' );
		await page.waitForFunction( () => window.__editor, null, { timeout: 30000 } );
		await page.keyboard.press( '4' );
		await page.waitForFunction( () => window.__editor.items() && window.__editor.items().length > 0, null, { timeout: 30000 } );
		await page.waitForTimeout( 500 );

		const before = await items();
		const stand = before.find( ( i ) => i.id === 'racing/grandStandAwning' );

		// Select the stand and remove it
		await page.mouse.click( ...await screen( stand.x, stand.z ) );
		await page.keyboard.press( 'Delete' );
		const removed = await items();
		check( checks, 'editor: Delete removes the selected stand', removed.length === before.length - 1 && ! removed.some( ( i ) => i.x === stand.x && i.z === stand.z ) );

		// Ctrl+Z brings it back, Ctrl+Shift+Z takes it away again
		await page.keyboard.press( 'Control+z' );
		await page.waitForTimeout( 200 );
		check( checks, 'editor: Ctrl+Z restores it', ( await items() ).length === before.length );
		await page.keyboard.press( 'Control+Shift+z' );
		await page.waitForTimeout( 200 );
		check( checks, 'editor: Ctrl+Shift+Z removes it again', ( await items() ).length === before.length - 1 );

		// Place a tree in the middle of the infield: on the road it's refused
		const lane = await page.evaluate( () => window.__editor.items().find( ( i ) => i.id === 'racing/control-tower' ) );
		const spot = { x: lane.x - 8, z: lane.z + 10 };
		await page.locator( '#palette button[data-id="racing/treeLarge"]' ).click();
		await page.waitForFunction( () => window.__editor.placing(), null, { timeout: 15000 } );
		const count = ( await items() ).length;
		await page.mouse.move( ...await screen( spot.x, spot.z ) );
		await page.mouse.click( ...await screen( spot.x, spot.z ) );
		await page.keyboard.press( 'Escape' );
		await page.waitForTimeout( 200 );
		const placed = await items();
		const tree = placed[ placed.length - 1 ];
		check( checks, 'editor: a tree goes down where it was clicked', placed.length === count + 1 && tree.id === 'racing/treeLarge' && Math.hypot( tree.x - spot.x, tree.z - spot.z ) < 0.3, `${ tree.id } at ${ tree.x.toFixed( 1 ) }, ${ tree.z.toFixed( 1 ) }` );

		// Select it, turn it 90° with Shift+Q, and drag it 2 m
		await page.mouse.click( ...await screen( tree.x, tree.z ) );
		await page.keyboard.press( 'Shift+Q' );
		const turned = ( await items() ).at( - 1 );
		check( checks, 'editor: Shift+Q turns it 90°', Math.abs( turned.angle - tree.angle - Math.PI / 2 ) < 1e-6, `${ ( ( turned.angle - tree.angle ) * 180 / Math.PI ).toFixed( 1 ) }°` );

		await page.mouse.move( ...await screen( tree.x, tree.z ) );
		await page.mouse.down();
		await page.mouse.move( ...await screen( tree.x, tree.z + 2 ), { steps: 4 } );
		await page.mouse.up();
		const moved = ( await items() ).at( - 1 );
		check( checks, 'editor: dragging moves it', Math.abs( moved.z - tree.z - 2 ) < 0.3, `${ ( moved.z - tree.z ).toFixed( 2 ) } m` );

		// Dropped on the road, it goes back
		const road = await page.evaluate( () => window.__editor.items().find( ( i ) => i.id === 'racing/pitsOffice' ) );
		await page.mouse.move( ...await screen( moved.x, moved.z ) );
		await page.mouse.down();
		await page.mouse.move( ...await screen( road.x + 8, road.z ), { steps: 4 } );
		await page.mouse.up();
		const back = ( await items() ).at( - 1 );
		check( checks, 'editor: dropped on the road, it goes back', Math.hypot( back.x - moved.x, back.z - moved.z ) < 1e-6 );

		// Play: the same track, with this scenery
		const [ game ] = await Promise.all( [ context.waitForEvent( 'page' ), page.locator( '#btn-play' ).click() ] );
		await presetStorage( context, settings() );
		await game.waitForLoadState();
		await game.evaluate( () => {

			localStorage.setItem( 'kerb.car', 'vehicle-truck-yellow' );

		} );
		await game.goto( game.url() + '&playtest&noflyover' );
		await game.waitForFunction( () => window.__kerb && window.__kerb.sceneryLoaded(), null, { timeout: 30000 } );

		const inGame = await game.evaluate( () => ( { track: window.__kerb.state().track, url: location.search, items: window.__kerb.plan.items.map( ( { id, x, z, angle } ) => ( { id, x, z, angle } ) ) } ) );
		const found = inGame.items.at( - 1 );
		check( checks, 'game: plays as the built-in track', inGame.track === 'indianapolis', inGame.track );
		check( checks, 'game: the stand is gone', inGame.items.filter( ( i ) => i.id === stand.id ).length === before.filter( ( i ) => i.id === stand.id ).length - 1 );
		check( checks, 'game: the tree stands where it was left, at its angle', found.id === 'racing/treeLarge' && Math.hypot( found.x - moved.x, found.z - moved.z ) < 0.11 && Math.abs( found.angle - ( ( moved.angle % ( Math.PI * 2 ) ) + Math.PI * 2 ) % ( Math.PI * 2 ) ) < 0.03, `${ found.id } at ${ found.x }, ${ found.z }` );
		await game.close();

		// The editor's link brings it all back
		await page.reload();
		await page.waitForFunction( () => window.__editor, null, { timeout: 30000 } );
		await page.keyboard.press( '4' );
		await page.waitForFunction( () => window.__editor.items() && window.__editor.items().length > 0, null, { timeout: 30000 } );
		const again = await items();
		check( checks, 'editor: a reload restores the edit', again.length === placed.length && again.at( - 1 ).id === 'racing/treeLarge', `${ again.length } items` );

		// The hill tracks open on the scenery, road locked
		await page.goto( env.url + 'editor.html?playtest&track=suzuka' );
		await page.waitForFunction( () => window.__editor && window.__editor.items() && window.__editor.items().length > 0, null, { timeout: 30000 } );
		check( checks, 'editor: Suzuka opens with its road locked', await page.locator( '#btn-road' ).isDisabled() );

		// A custom track takes a theme, with its own stands and colours
		await page.goto( env.url + '?playtest&noflyover&theme=industrial&map=' + TRACKS.oval );
		await page.waitForFunction( () => window.__kerb && window.__kerb.sceneryLoaded(), null, { timeout: 30000 } );
		const themed = await page.evaluate( () => window.__kerb.plan.items.map( ( i ) => i.id ) );
		check( checks, 'game: a custom track in a theme gets its sites', themed.some( ( id ) => id.startsWith( 'industrial/' ) ) && ! themed.some( ( id ) => id.includes( 'pits' ) ), `${ themed.length } items` );

		check( checks, 'editor-scenery: no page errors', errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
		await context.close();
		return { checks, runs: [] };

	},

	// The fly-over runs its course (about 8 s) and hands over to the race,
	// with the whole track on screen while it orbits, on a laptop and a
	// portrait phone, and no quality step-down from its wide views
	'flyover': async ( env ) => {

		const checks = [];

		for ( const [ device, options ] of [ [ 'laptop', LAPTOP ], [ 'phone', PHONE_PORTRAIT ] ] ) {

			const { page, errors, close } = await open( env, options, { query: '&track=suzuka', label: 'flyover-' + device, prefs: { npcs: 3 } } );
			await page.waitForFunction( () => document.getElementById( 'start-btn' ).textContent !== 'Getting ready…', null, { timeout: 30000 } );
			const before = await page.evaluate( () => window.__kerb.state().tier );

			await page.click( '#start-btn' );
			await page.waitForTimeout( 300 );
			let s = await page.evaluate( () => window.__kerb.state() );
			check( checks, `flyover ${ device }: starts on Race`, s.flyover && s.phase === 'grid', `flyover ${ s.flyover }, ${ s.phase }` );

			// The track's box on screen overhead, mid-orbit and at the orbit's end
			for ( const at of [ 0.6, 3.6, 6.2 ] ) {

				await page.waitForFunction( ( t ) => ( window.__kerb.flyover()?.t ?? Infinity ) >= t, at, { timeout: 15000 } );
				const view = await page.evaluate( () => {

					const k = window.__kerb, f = k.flyover();
					return f ? { t: f.t, ndc: f.corners.map( ( c ) => k.project( ...c ) ) } : null;

				} );
				if ( ! view ) break;
				const worst = Math.max( ...view.ndc.flat().map( Math.abs ) );
				check( checks, `flyover ${ device }: the whole track on screen at ${ view.t.toFixed( 1 ) } s`, worst <= 1, `furthest corner at ${ worst.toFixed( 2 ) } of the half-screen` );
				await env.screenshot( page, `flyover-${ device }-${ at }` );

			}

			const duration = await page.evaluate( () => window.__kerb.flyover()?.duration ?? 0 );
			check( checks, `flyover ${ device }: lasts about 8 s`, duration > 7.5 && duration < 8.5, `${ duration.toFixed( 1 ) } s` );

			await page.waitForFunction( () => window.__kerb.state().phase === 'countdown', null, { timeout: 15000 } );
			s = await page.evaluate( () => {

				const k = window.__kerb;
				const p = k.race.player.vehicle.container.position;
				const ndc = k.project( p.x, p.y + 0.5, p.z );
				return { ...k.state(), ndc, far: k.three.camera.far };

			} );
			check( checks, `flyover ${ device }: lands on the chase camera behind the player`, Math.abs( s.ndc[ 0 ] ) < 0.3 && Math.abs( s.ndc[ 1 ] ) < 0.4 && s.far < 200, `player at ${ s.ndc.map( ( v ) => v.toFixed( 2 ) ) } on screen, far ${ s.far.toFixed( 0 ) }` );
			check( checks, `flyover ${ device }: no quality step-down`, s.tier === before, `${ before } → ${ s.tier }` );
			check( checks, `flyover ${ device }: no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
			await close();

		}

		return { checks, runs: [] };

	},

	// Nothing flashes in the fly-over and nothing jumps when it hands over to
	// the chase camera, on any track, at both ends of the quality range
	'flicker': async ( env ) => {

		const checks = [];

		for ( const tier of env.tier ? [ env.tier ] : [ 'low', 'high' ] ) {

			for ( const track of BUILT_IN.filter( ( t ) => ! env.tracks || env.tracks.includes( t.id ) ) ) {

				const { page, errors, close } = await open( env, LAPTOP, { query: `&track=${ track.id }&quality=${ tier }`, label: `flicker-${ track.id }-${ tier }`, video: false, prefs: { npcs: 3 }, init: `(${ slowClock })( ${ SLOW } )` } );
				await page.waitForFunction( () => window.__kerb.sceneryLoaded() && document.getElementById( 'start-btn' ).textContent !== 'Getting ready…', null, { timeout: 30000 } );
				await page.evaluate( watchPicture );
				await page.click( '#start-btn' );
				await page.waitForFunction( () => window.__picture.done, null, { timeout: 120000 } );

				const { log, handover, before } = await page.evaluate( () => window.__picture );
				const found = flashes( log );
				const worst = found.length ? Math.max( ...found.map( ( f ) => f.share ) ) : 0;
				const lastFrames = Math.max( ...before.slice( - 8 ) );

				check( checks, `flicker ${ track.id } ${ tier }: no flash frames`, found.length === 0, `${ found.length } in ${ log.length } frames, worst ${ ( worst * 100 ).toFixed( 2 ) }%${ found.length ? ' at ' + found.slice( 0, 4 ).map( ( f ) => f.t.toFixed( 2 ) ).join( ' ' ) : '' }` );
				check( checks, `flicker ${ track.id } ${ tier }: no jump at the hand-over`, handover < 0.01, `${ ( handover * 100 ).toFixed( 2 ) }% of pixels, ${ ( lastFrames * 100 ).toFixed( 2 ) }% just before` );
				check( checks, `flicker ${ track.id } ${ tier }: no page errors`, errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
				await close();

			}

		}

		return { checks, runs: [] };

	},

	// Off Bathurst's ramp with the controls held over in the air: nothing
	// changes where the car is going, it flies 1–3 s, the controls come back
	// when it lands, on keys and the touch joystick; and a slow car rolls over
	'takeoff': async ( env ) => {

		const checks = [];
		const flying = () => window.__kerb.state().flying;

		{

			const { page, errors, close } = await open( env, LAPTOP, { query: '&track=bathurst', label: 'takeoff-keys' } );
			await page.keyboard.press( 'Enter' );
			await page.waitForTimeout( 500 );

			await page.keyboard.down( 'KeyW' );
			await page.evaluate( aimAtRamp, { distance: 9, speed: 12.8 } );
			await page.waitForFunction( flying, null, { timeout: 5000, polling: 'raf' } );

			const watching = page.evaluate( watchFlight );
			await page.keyboard.up( 'KeyW' );
			await page.keyboard.down( 'KeyA' );
			await page.keyboard.down( 'KeyS' );
			await page.waitForTimeout( 900 );
			await env.screenshot( page, 'takeoff-in-the-air' );
			const flight = await watching;

			check( checks, 'takeoff keys: 1–3 s in the air', flight.airtime >= 1 && flight.airtime <= 3.1, `${ flight.airtime.toFixed( 2 ) } s from ${ flight.speed.toFixed( 1 ) } m/s` );
			check( checks, 'takeoff keys: steering does nothing in the air', flight.turned < 0.02, `nose turned ${ flight.turned.toFixed( 3 ) } rad` );
			check( checks, 'takeoff keys: brakes do nothing in the air', flight.lost < 0.15, `lost ${ flight.lost.toFixed( 2 ) } m/s` );

			await page.waitForTimeout( 400 );
			const after = await page.evaluate( () => window.__kerb.state() );
			check( checks, 'takeoff keys: the same keys work again on landing', turnedSince( flight.heading, after.heading ) > 0.2 && after.speed < flight.speed - 2, `nose turned ${ turnedSince( flight.heading, after.heading ).toFixed( 2 ) } rad, speed ${ flight.speed.toFixed( 1 ) } → ${ after.speed.toFixed( 1 ) } m/s` );

			await page.keyboard.up( 'KeyA' );
			await page.keyboard.up( 'KeyS' );
			await page.evaluate( aimAtRamp, { distance: 3, speed: 7 } );
			const slow = await page.evaluate( () => new Promise( ( resolve ) => {

				const k = window.__kerb, car = k.race.player, ramp = k.race.shape.ramps[ 0 ];

				const tick = () => {

					if ( k.state().flying ) resolve( 'flew' );
					else if ( car.proj.s > ramp.s + 3 ) resolve( 'rolled over' );
					else requestAnimationFrame( tick );

				};

				tick();

			} ) );
			check( checks, 'takeoff keys: a slow car rolls over the ramp', slow === 'rolled over', slow );
			check( checks, 'takeoff keys: no page errors', errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
			await close();

		}

		{

			const { page, errors, close } = await open( env, PHONE_LANDSCAPE, { query: '&track=bathurst', label: 'takeoff-touch', prefs: { touch: 'joystick' } } );
			const driver = new TouchDriver( page, await trackLine( page ), { skill: 'expert' } );
			await driver.start();
			await page.waitForTimeout( 500 );

			// The thumb up the road: the 45° camera's mapping, as TouchDriver
			const dir = await page.evaluate( aimAtRamp, { distance: 9, speed: 12.8 } );
			const wx = Math.sin( dir ), wz = Math.cos( dir );
			await driver.touch( 'touchMove', driver.anchor[ 0 ] + ( wx - wz ) * Math.SQRT1_2 * 66, driver.anchor[ 1 ] + ( wx + wz ) * Math.SQRT1_2 * 66 );
			await page.waitForFunction( flying, null, { timeout: 5000, polling: 'raf' } );

			// Then hard across it, which turns a car on the ground at once
			const watching = page.evaluate( watchFlight );
			await driver.touch( 'touchMove', driver.anchor[ 0 ] + ( wx + wz ) * Math.SQRT1_2 * 66, driver.anchor[ 1 ] + ( wz - wx ) * Math.SQRT1_2 * 66 );
			const flight = await watching;

			check( checks, 'takeoff touch: 1–3 s in the air', flight.airtime >= 1 && flight.airtime <= 3.1, `${ flight.airtime.toFixed( 2 ) } s from ${ flight.speed.toFixed( 1 ) } m/s` );
			check( checks, 'takeoff touch: the joystick does nothing in the air', flight.turned < 0.02 && flight.lost < 0.15, `nose turned ${ flight.turned.toFixed( 3 ) } rad, lost ${ flight.lost.toFixed( 2 ) } m/s` );

			await page.waitForTimeout( 500 );
			const after = await page.evaluate( () => window.__kerb.state() );
			check( checks, 'takeoff touch: the joystick works again on landing', turnedSince( flight.heading, after.heading ) > 0.2, `nose turned ${ turnedSince( flight.heading, after.heading ).toFixed( 2 ) } rad` );
			check( checks, 'takeoff touch: no page errors', errors.length === 0, errors.slice( 0, 2 ).join( ' | ' ) );
			await driver.release();
			await close();

		}

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
