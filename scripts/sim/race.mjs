// Headless races: the game's own simulation (js/Race.js) and NPC drivers,
// with no rendering, faster than real time.
//
//   npm run sim -- --calibrate                 lap time per AI skill, per track
//   npm run sim -- --soak                      9 cars × 20 laps × every track × 3 seeds
//   npm run sim -- --soak --tracks monza --laps 5 --seeds 1
//   npm run sim -- --balance                   a stand-in player races the field twice, as in the game
//   npm run sim -- --fit                       grip and braking for the NPCs' speed profile (RacingLine.DRIVE)

import * as THREE from 'three';
import { registerAll } from 'crashcat';
import { Race, STEP } from '../../js/Race.js';
import { AIDriver, rng } from '../../js/AIDriver.js';
import { TRACKS, trackLine } from '../../js/Tracks.js';
import { TrackShape } from '../../js/TrackShape.js';
import { CARS } from '../../js/CarList.js';
import { MAX_SPEED } from '../../js/Vehicle.js';
import { planField, FIRST_RACE } from '../../js/Difficulty.js';
import { DRIVE } from '../../js/RacingLine.js';

const args = process.argv.slice( 2 );
const arg = ( name, fallback ) => {

	const i = args.indexOf( '--' + name );
	return i >= 0 ? args[ i + 1 ] : fallback;

};

const tracks = arg( 'tracks', TRACKS.map( ( t ) => t.id ).join( ',' ) ).split( ',' ).map( ( id ) => TRACKS.find( ( t ) => t.id === id ) );

registerAll();

// Vehicle.js only needs the named nodes
function stubModel() {

	const root = new THREE.Group();

	for ( const name of [ 'body', 'wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right' ] ) {

		const node = new THREE.Object3D();
		node.name = name;
		root.add( node );

	}

	return root;

}

function makeRace( track ) {

	const line = trackLine( track );
	return new Race( { cells: track.cells, line, shape: new TrackShape( track, line ), classic: track.id === 'classic', ai: track.ai } );

}

function median( values ) {

	const sorted = values.slice().sort( ( a, b ) => a - b );
	return sorted[ Math.floor( sorted.length / 2 ) ];

}

// Run until every car has `laps` laps or the clock runs out
function run( race, laps, limit ) {

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

if ( args.includes( '--calibrate' ) ) {

	const skills = [ 0, 0.25, 0.5, 0.75, 1 ];
	const laps = Number( arg( 'laps', 4 ) );

	console.log( 'Lap time (median of laps 2+, over several seeds) for one AI car at full pace, by skill\n' );
	console.log( [ 'track', ...skills.map( ( s ) => 'skill ' + s ), 'top m/s', 'm/s per speed' ].join( '\t' ) );

	for ( const track of tracks ) {

		const row = [ track.id ];
		let top = 0, ratio = 0;

		for ( const skill of skills ) {

			// Median over several drivers' seeds: low skills are erratic
			const times = [];

			for ( let seed = 7; seed < 7 + Number( arg( 'seeds', 5 ) ); seed ++ ) {

				const race = makeRace( track );
				const car = race.addCar( CARS[ 0 ], stubModel(), { driver: new AIDriver( race.line, { skill, seed } ) } );
				race.setup( 'race', race.cars, 99 );

				const step = race.step.bind( race );
				race.step = ( input ) => {

					step( input );
					const speed = Math.hypot( car.vehicle.sphereVel.x, car.vehicle.sphereVel.z );

					if ( speed > top ) {

						top = speed;
						ratio = speed / Math.max( 1e-3, car.vehicle.linearSpeed );

					}

				};

				run( race, laps, laps * 90 );
				times.push( ...car.lapTimes.slice( 1 ) );

			}

			row.push( times.length ? median( times ).toFixed( 2 ) : 'DNF' );

		}

		row.push( top.toFixed( 1 ), ratio.toFixed( 2 ) );
		console.log( row.join( '\t' ) );

	}

	console.log( `\nMAX_SPEED (Vehicle) = ${ MAX_SPEED }` );

}

// The fastest grip / braking pair for a skill-1 NPC, over every track
// (each track's lap relative to its best over the grid)
if ( args.includes( '--fit' ) ) {

	const grips = arg( 'grips', '40,70,200' ).split( ',' ).map( Number );
	const brakes = arg( 'brakes', '15,30' ).split( ',' ).map( Number );
	const yaws = arg( 'yaws', '99' ).split( ',' ).map( Number );
	const results = [];

	for ( const grip of grips ) for ( const yaw of yaws ) {

		for ( const brake of brakes ) {

			DRIVE.grip = grip;
			DRIVE.brake = brake;
			DRIVE.yaw = yaw;
			const laps = [];

			for ( const track of tracks ) {

				const race = makeRace( track );
				race.racing.profiles.clear();
				const car = race.addCar( CARS[ 0 ], stubModel(), { driver: new AIDriver( race.line, { skill: 1, seed: 7 } ) } );
				race.setup( 'race', race.cars, 99 );
				run( race, 3, 3 * 90 );
				laps.push( car.lapTimes.length > 1 ? median( car.lapTimes.slice( 1 ) ) : Infinity );

			}

			results.push( { grip, brake, yaw, laps } );
			console.log( `grip ${ grip } brake ${ brake } yaw ${ yaw }: ${ laps.map( ( t ) => t.toFixed( 2 ) ).join( ' ' ) }` );

		}

	}

	const best = tracks.map( ( _, i ) => Math.min( ...results.map( ( r ) => r.laps[ i ] ) ) );
	for ( const r of results ) r.score = r.laps.reduce( ( a, t, i ) => a + t / best[ i ], 0 ) / tracks.length;
	results.sort( ( a, b ) => a.score - b.score );
	console.log( '\nBest:', results.slice( 0, 5 ).map( ( r ) => `grip ${ r.grip } brake ${ r.brake } yaw ${ r.yaw } (${ ( ( r.score - 1 ) * 100 ).toFixed( 1 ) }% off the best per track)` ).join( '; ' ) );

}

// Weight classes: the same NPC (skill --skill) in a light, a medium and a
// heavy car, alone, on every track. Lap time relative to the yellow truck.
if ( args.includes( '--classes' ) ) {

	const skill = Number( arg( 'skill', 1 ) );
	const laps = Number( arg( 'laps', 6 ) );
	const ids = arg( 'cars', 'kart-oobi,race,sedan-sports,vehicle-truck-yellow,van,ambulance,garbage-truck' ).split( ',' );

	console.log( `Lap (median of laps 2+) relative to the yellow truck, skill ${ skill }\n` );
	console.log( [ 'track'.padEnd( 13 ), ...ids.map( ( id ) => id.slice( 0, 12 ).padStart( 13 ) ) ].join( '' ) );

	for ( const track of tracks ) {

		// Median over several drivers' seeds: one bad lap shouldn't decide it
		const times = ids.map( ( id ) => median( [ 7, 8, 9, 10, 11 ].slice( 0, Number( arg( 'seeds', 5 ) ) ).flatMap( ( seed ) => {

			const race = makeRace( track );
			const car = race.addCar( CARS.find( ( c ) => c.id === id ), stubModel(), { driver: new AIDriver( race.line, { skill, seed } ) } );
			race.setup( 'race', race.cars, 99 );
			run( race, laps, laps * 90 );
			return car.lapTimes.slice( 1 );

		} ) ) );

		const base = times[ ids.indexOf( 'vehicle-truck-yellow' ) ];
		console.log( [ track.id.padEnd( 13 ), ...times.map( ( t ) => ( t / base ).toFixed( 3 ).padStart( 13 ) ) ].join( '' ) );

	}

}

if ( args.includes( '--soak' ) ) {

	const laps = Number( arg( 'laps', 20 ) );
	const seeds = Number( arg( 'seeds', 3 ) );
	const count = Number( arg( 'cars', 9 ) );
	let failures = 0;

	for ( const track of tracks ) {

		for ( let seed = 1; seed <= seeds; seed ++ ) {

			const random = rng( seed * 101 );
			const race = makeRace( track );
			const pool = CARS.slice();

			for ( let i = 0; i < count; i ++ ) {

				const def = pool.splice( Math.floor( random() * pool.length ), 1 )[ 0 ];
				const skill = i / Math.max( 1, count - 1 );
				race.addCar( def, stubModel(), { driver: new AIDriver( race.line, { skill, seed: seed * 31 + i, aggression: random() } ) } );

			}

			race.setup( 'race', race.cars, laps );
			const step = race.step.bind( race );
			race.step = ( input ) => {

				for ( const c of race.cars ) c.wasTumbling = c.vehicle.tumbling;
				step( input );
				for ( const c of race.cars ) if ( c.vehicle.tumbling && ! c.wasTumbling ) c.launches = ( c.launches || 0 ) + 1;

			};
			const t0 = performance.now();
			const simTime = run( race, laps, laps * 80 );
			const wall = performance.now() - t0;

			const lines = race.cars.map( ( c ) => {

				const done = c.lapTimes.length;
				if ( done < laps ) failures ++;
				return `  ${ c.name.padEnd( 15 ) } skill ${ c.driver.skill.toFixed( 2 ) }  laps ${ String( done ).padStart( 2 ) }  median ${ done ? median( c.lapTimes ).toFixed( 2 ) : '-' }  best ${ done ? Math.min( ...c.lapTimes ).toFixed( 2 ) : '-' }  wand ${ c.respawns }  launches ${ c.launches || 0 }  car hits ${ c.carHits }`;

			} );

			console.log( `${ track.id } seed ${ seed }: ${ simTime.toFixed( 0 ) } s simulated in ${ ( wall / 1000 ).toFixed( 1 ) } s (${ ( wall / ( simTime / STEP ) ).toFixed( 2 ) } ms/step)` );
			console.log( lines.join( '\n' ) );

		}

	}

	if ( failures ) {

		console.log( `\n${ failures } car(s) didn't finish their laps` );
		process.exit( 1 );

	}

}

// Difficulty check without a browser, the way the game plays it: an AI
// stands in for the player (its skill ≈ a novice / average / expert keyboard
// player) and races twice. Race 1 is aimed at the track's par until its
// first lap (no best lap yet); race 2 at its best lap from race 1.
if ( args.includes( '--balance' ) ) {

	const proxies = arg( 'skills', '0.2,0.5,0.9' ).split( ',' ).map( Number );
	const seeds = Number( arg( 'seeds', 6 ) );
	const count = Number( arg( 'cars', 4 ) );
	const verbose = args.includes( '--verbose' );

	console.log( `Finishing positions of a stand-in player against ${ count } NPCs (${ seeds } seeds × 2 races)\n` );

	for ( const track of tracks ) {

		for ( const skill of proxies ) {

			const results = [ { positions: [], gaps: [], lapped: 0, lapping: 0 }, { positions: [], gaps: [], lapped: 0, lapping: 0 } ];

			for ( let seed = 1; seed <= seeds; seed ++ ) {

				const random = rng( seed * 977 );
				const race = makeRace( track );
				const pool = CARS.slice( 1 );
				const field = planField( count, random ).map( ( p ) => {

					const def = pool.splice( Math.floor( random() * pool.length ), 1 )[ 0 ];
					const car = race.addCar( def, stubModel(), { driver: new AIDriver( race.line, { seed: Math.floor( random() * 1e6 ), aggression: p.aggression } ) } );
					car.paceFactor = p.factor;
					return car;

				} );
				const player = race.addCar( CARS[ 0 ], stubModel(), { player: true, driver: new AIDriver( race.line, { skill, seed: seed + 50 } ) } );
				let best = null;

				for ( const result of results ) {

					race.aimField( best ?? track.par * FIRST_RACE, best !== null );
					race.setup( 'race', [ ...field, player ], track.laps );
					race.start();

					// Lapped: the player a lap down when the winner finishes.
					// Lapping: the player a lap up on someone when they finish.
					race.events.onFinish = ( car ) => {

						if ( race.finishOrder.length === 1 && car.distance - player.distance > race.line.length ) result.lapped ++;
						if ( car === player && race.cars.some( ( c ) => player.distance - c.distance > race.line.length ) ) result.lapping ++;

					};

					const input = { x: 0, z: 0, mode: 'car' };
					let guard = 0;
					while ( race.phase !== 'done' && guard ++ < ( track.laps * 90 + 30 ) / STEP ) race.step( input );

					const winner = race.standings()[ 0 ];
					result.positions.push( race.position( player ) );
					if ( player.finished && winner.finished ) result.gaps.push( player.finishTime - winner.finishTime );

					if ( verbose ) {

						const laps = ( c ) => c.lapTimes.map( ( t ) => t.toFixed( 1 ) ).join( ' ' );
						console.log( `  seed ${ seed } race ${ results.indexOf( result ) + 1 }: reference ${ best === null ? 'par ' + track.par : best.toFixed( 2 ) }, you ${ laps( player ) } → ${ race.position( player ) }` );
						for ( const c of field ) console.log( `    target ${ c.targetLap.toFixed( 2 ) } skill ${ c.driver.skill.toFixed( 2 ) } pace ${ c.driver.pace.toFixed( 2 ) }: ${ laps( c ) }` );

					}

					best = Math.min( best ?? Infinity, ...player.lapTimes );

				}

			}

			const summary = results.map( ( r, i ) => {

				const mean = r.positions.reduce( ( a, b ) => a + b, 0 ) / r.positions.length;
				const wins = r.positions.filter( ( p ) => p === 1 ).length;
				return `race ${ i + 1 }: ${ r.positions.join( ' ' ) } (mean ${ mean.toFixed( 1 ) }, wins ${ wins }, gap ${ r.gaps.length ? median( r.gaps ).toFixed( 1 ) + ' s' : '-' }, lapped ${ r.lapped }, lapping ${ r.lapping })`;

			} );

			console.log( `${ track.id.padEnd( 13 ) } skill ${ skill.toFixed( 2 ) }  ${ summary.join( '   ' ) }` );

		}

	}

}
