// A worker for the sim's searches (race.mjs --steer, --optimize): runs one
// car alone on a track and answers with its laps.
//
// Task: { track (id), car (id), seed, laps, skill, steer (AIDriver.STEER
// values), line ({ offsets, caps } at the control points, to drive instead
// of the track's), noise (steering wobble) }

import { parentPort } from 'node:worker_threads';
import { TRACKS } from '../../js/Tracks.js';
import { CARS } from '../../js/CarList.js';
import { STEER } from '../../js/AIDriver.js';
import { solo } from './common.mjs';

const DEFAULT_STEER = { ...STEER };

parentPort.on( 'message', ( { id, task } ) => {

	Object.assign( STEER, DEFAULT_STEER, task.steer || {} );
	const track = TRACKS.find( ( t ) => t.id === task.track );
	const def = CARS.find( ( c ) => c.id === task.car ) || CARS[ 0 ];

	try {

		const { laps, kerb, speed, wand, air } = solo( track, { def, skill: task.skill ?? 1, seed: task.seed ?? 7, laps: task.laps ?? 4, line: task.line || null, noise: task.noise ?? null } );
		parentPort.postMessage( { id, result: { laps, kerb, speed, wand, air } } );

	} catch ( error ) {

		parentPort.postMessage( { id, result: { laps: [], kerb: 0, speed: 0, wand: 99, error: String( error ) } } );

	}

} );
