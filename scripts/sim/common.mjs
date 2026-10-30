// What the sim scripts share: a race on a built-in track with stub car
// models, running it, and one car's laps alone.

import * as THREE from 'three';
import { registerAll } from 'crashcat';
import { Race, STEP } from '../../js/Race.js';
import { AIDriver } from '../../js/AIDriver.js';
import { trackLine } from '../../js/Tracks.js';
import { TrackShape } from '../../js/TrackShape.js';
import { CARS } from '../../js/CarList.js';

registerAll();

// Vehicle.js only needs the named nodes
export function stubModel() {

	const root = new THREE.Group();

	for ( const name of [ 'body', 'wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right' ] ) {

		const node = new THREE.Object3D();
		node.name = name;
		root.add( node );

	}

	return root;

}

export function makeRace( track ) {

	const line = trackLine( track );
	return new Race( { cells: track.cells, line, shape: new TrackShape( track, line ), classic: track.id === 'classic', ai: track.ai, ace: track.ace, par: track.par } );

}

export function median( values ) {

	const sorted = values.slice().sort( ( a, b ) => a - b );
	return sorted[ Math.floor( sorted.length / 2 ) ];

}

export const mean = ( values ) => values.reduce( ( a, b ) => a + b, 0 ) / Math.max( 1, values.length );

// Run until every car has `laps` laps or the clock runs out
export function run( race, laps, limit ) {

	const input = { x: 0, z: 0, mode: 'car' };
	race.start();

	let steps = 0;
	const maxSteps = limit / STEP;

	while ( steps ++ < maxSteps ) {

		race.step( input );

		for ( const car of race.cars ) {

			const p = car.vehicle.spherePos;
			if ( ! Number.isFinite( p.x + p.y + p.z ) ) throw new Error( `${ car.name }: position is NaN` );

		}

		if ( race.cars.every( ( c ) => c.lapTimes.length >= laps ) ) break;

	}

	return steps * STEP;

}

// One car alone for `laps` laps: its lap times, the share of the time with
// a wheel on the kerbs, its mean speed, wand carries, launches, and the time spent in
// each cell on each lap (cellTimes[ lap ][ cell ]). line: { offsets, caps }
// at the control points to drive instead of the track's racing line
// (RacingLine.useControl); noise: steering wobble instead of the skill's;
// pace: AIDriver.pace.
export function solo( track, { def = CARS[ 0 ], skill = 1, pace = 1, seed = 7, laps = 5, driver = null, line = null, noise = null } = {} ) {

	const race = makeRace( track );
	if ( line ) race.racing.useControl( line.offsets, line.caps );
	const car = race.addCar( def, stubModel(), { driver: driver || new AIDriver( race.line, { skill, seed } ) } );
	if ( noise !== null ) car.driver.params.noise = noise;
	car.driver.pace = pace;
	if ( driver && driver.setup ) driver.setup( race );
	race.setup( 'race', race.cars, 99 );

	const cellTimes = [];
	let steps = 0, kerbSteps = 0, speedSum = 0, airs = 0, airTime = 0;
	const step = race.step.bind( race );

	race.step = ( input ) => {

		step( input );
		if ( race.phase !== 'racing' ) return;

		const lap = car.lapTimes.length;
		const cell = race.line.cellAt( car.proj.s );
		( cellTimes[ lap ] ||= [] )[ cell ] = ( cellTimes[ lap ][ cell ] || 0 ) + STEP;

		steps ++;
		if ( car.kerb > 0 ) kerbSteps ++;
		speedSum += Math.hypot( car.vehicle.sphereVel.x, car.vehicle.sphereVel.z );

		// Launches: off the ground for over a quarter of a second
		airTime = car.vehicle.grounded || car.carry ? 0 : airTime + STEP;
		if ( airTime > 0.25 && airTime - STEP <= 0.25 ) airs ++;

	};

	run( race, laps, laps * 90 );

	return { laps: car.lapTimes, kerb: kerbSteps / Math.max( 1, steps ), speed: speedSum / Math.max( 1, steps ), wand: car.respawns, air: airs, cellTimes: cellTimes.slice( 0, car.lapTimes.length ) };

}
