// Check the built-in track layouts (js/Tracks.js) and draw them. For hilly
// tracks also: the steepest gradient, and each crest's radius and the speed
// at which a car leaves the ground over it (v² = g · R; top speed ~14.6 m/s).
// Fails on any scenery footprint closer than Scenery.CLEARANCE to the
// walls' outer face, on anything that hides the road from the chase camera
// on a stand or pit that doesn't face the road, on a stand that's not on a
// straight right behind the wall, and on a theme or palette two tracks share;
// warns when a track's optimized racing line was made
// for a different layout (rerun `npm run sim -- --optimize --tracks <id>`).
//
//   npm run tracks

import { TRACKS, trackLine } from '../js/Tracks.js';
import { checkLayout, CELL } from '../js/TrackPath.js';
import { TrackShape } from '../js/TrackShape.js';
import { planScenery, footprint, roadGap, hidesRoad, roadSamples, sceneryColormaps, themeOf, CLEARANCE } from '../js/Scenery.js';
import { CATALOG } from '../js/SceneryCatalog.js';
import { SCENERY } from '../js/SceneryList.js';
import { WALL_OUTER } from '../js/TrackShape.js';
import { RACE_LINES } from '../js/RaceLines.js';
import { lineHash } from '../js/RacingLine.js';

const GRAVITY = 9.81 * 1.5;
const MAX_GRADIENT = 0.2;
const MAX_TURN = 15; // ° a stand's or a pit's front may be off the road
const STAND_GAP = 0.6; // m a stand's front may be behind the wall's outer face
const STAND_TURN = 2; // ° a stand may be off square to the road

// One theme per track, and no palette on two tracks: they mustn't look alike
const paletteTrack = new Map(), themeTrack = new Map();

let failed = 0;

for ( const track of TRACKS ) {

	const line = trackLine( track );
	const shape = new TrackShape( track, line );
	const corners = track.cells.filter( ( c ) => c[ 2 ] === 'track-corner' ).length;
	const problems = track.layout ? checkLayout( track.layout, track.heading, track.heights || null ) : [];
	if ( ! line.closed ) problems.push( 'centerline does not close' );

	if ( track.heights ) {

		if ( track.heights.some( ( h ) => h < 0 || h > 6 ) ) problems.push( 'heights must be 0–6 m' );

		for ( const i of shape.unsealed ) {

			if ( track.cells[ i ][ 2 ] === 'track-finish' ) problems.push( `cell ${ i }: the finish can't be gravel` );

		}

	}

	failed += problems.length;

	console.log( `\n${ track.name } (${ track.id }): ${ track.cells.length } cells, ${ corners } corners, ${ line.length.toFixed( 0 ) } m, ${ track.laps } laps${ shape.crossings.length ? `, crosses itself (cell ${ shape.crossings[ 0 ].over } over ${ shape.crossings[ 0 ].under })` : '' }` );

	if ( track.heights ) {

		let steepest = 0, at = 0;
		const crests = [];

		for ( let s = 0; s < line.length; s += 0.5 ) {

			const g = Math.abs( line.slopeAt( s ) );
			if ( g > steepest ) { steepest = g; at = s; }

			// A crest: the profile's curvature, over a couple of metres
			const d = 2;
			const bend = - ( line.heightAt( s + d ) - 2 * line.heightAt( s ) + line.heightAt( s - d ) ) / ( d * d );
			const last = crests[ crests.length - 1 ];

			if ( bend > 0.02 ) {

				if ( last && s - last.end < 1 ) {

					last.end = s;
					if ( bend > last.bend ) Object.assign( last, { bend, s } );

				} else {

					crests.push( { s, end: s, bend } );

				}

			}

		}

		console.log( `  heights 0–${ shape.maxHeight } m, steepest ${ ( steepest * 100 ).toFixed( 0 ) }% at ${ at.toFixed( 0 ) } m (cell ${ line.cellAt( at ) })${ shape.unsealed.size ? `, gravel cells ${ [ ...shape.unsealed ].join( ' ' ) }` : '' }` );
		if ( steepest > MAX_GRADIENT ) { console.log( `  ✗ steeper than ${ MAX_GRADIENT * 100 }%` ); failed ++; }

		for ( const c of crests ) {

			const radius = 1 / c.bend;
			const takeoff = Math.sqrt( GRAVITY * radius );
			console.log( `  crest at ${ c.s.toFixed( 0 ) } m (cell ${ line.cellAt( c.s ) }${ shape.isUnsealed( c.s ) ? ', gravel' : '' }): radius ${ radius.toFixed( 1 ) } m, airborne above ${ takeoff.toFixed( 1 ) } m/s` );

		}

	}

	// Scenery: nothing on the road or over a wall
	const plan = planScenery( shape, track );
	const kits = new Set( plan.items.map( ( item ) => item.id.split( '/' )[ 0 ] ) );
	let onRoad = 0;

	for ( const item of plan.items ) {

		const gap = roadGap( line, footprint( item ) );
		if ( gap >= CLEARANCE - 1e-6 ) continue;
		problems.push( `${ item.id } in cell ${ Math.floor( item.x / CELL ) },${ Math.floor( item.z / CELL ) } is ${ gap < 0 ? ( - gap ).toFixed( 2 ) + ' m over the wall' : gap.toFixed( 2 ) + ' m outside the wall' } (needs ${ CLEARANCE } m)` );
		onRoad ++;

	}

	// Nothing hides the road from the chase camera, and whatever has a front
	// shows it to the road
	const samples = roadSamples( line );
	let hidden = 0, turned = 0;

	for ( const item of plan.items ) {

		if ( hidesRoad( samples, item ) ) {

			problems.push( `${ item.id } in cell ${ Math.floor( item.x / CELL ) },${ Math.floor( item.z / CELL ) } hides the road` );
			hidden ++;

		}

		const role = CATALOG[ item.id ].role;
		if ( role !== 'stand' && role !== 'pit' ) continue;

		// A stand is for watching: on a straight, right behind the wall, square on
		if ( role === 'stand' ) {

			const depth = SCENERY[ item.id ].d * item.scale;
			const front = line.project( item.x + Math.sin( item.angle ) * depth / 2, item.z + Math.cos( item.angle ) * depth / 2 );
			const under = track.cells[ line.cellAt( front.s ) ][ 2 ];
			const q = line.pointAt( front.s );
			const square = Math.atan2( q[ 0 ] - ( item.x + Math.sin( item.angle ) * depth / 2 ), q[ 1 ] - ( item.z + Math.cos( item.angle ) * depth / 2 ) ) - item.angle;
			const off = Math.abs( Math.atan2( Math.sin( square ), Math.cos( square ) ) ) * 180 / Math.PI;
			const gap = Math.abs( front.lateral ) - WALL_OUTER;

			if ( under === 'track-corner' || gap > STAND_GAP || off > STAND_TURN ) {

				problems.push( `${ item.id } in cell ${ Math.floor( item.x / CELL ) },${ Math.floor( item.z / CELL ) } is no place to watch from: on ${ under }, ${ gap.toFixed( 2 ) } m behind the wall, ${ off.toFixed( 0 ) }° off square` );
				turned ++;

			}

		}

		const p = line.pointAt( line.project( item.x, item.z ).s );
		const off = Math.atan2( p[ 0 ] - item.x, p[ 1 ] - item.z ) - item.angle;
		const degrees = Math.abs( Math.atan2( Math.sin( off ), Math.cos( off ) ) ) * 180 / Math.PI;

		if ( degrees > MAX_TURN ) {

			problems.push( `${ item.id } in cell ${ Math.floor( item.x / CELL ) },${ Math.floor( item.z / CELL ) } faces ${ degrees.toFixed( 0 ) }° off the road` );
			turned ++;

		}

	}

	// Nothing that sets one track's look on another
	const { theme } = track;
	if ( themeTrack.has( theme ) ) problems.push( `theme ${ theme } is also ${ themeTrack.get( theme ) }'s` );
	themeTrack.set( theme, track.id );

	for ( const name of sceneryColormaps( plan, themeOf( track ).variations ) ) {

		if ( paletteTrack.has( name ) ) problems.push( `palette ${ name } is also on ${ paletteTrack.get( name ) }` );
		paletteTrack.set( name, track.id );

	}

	console.log( `  scenery: ${ plan.items.length } items from ${ kits.size } kit${ kits.size === 1 ? '' : 's' } (${ [ ...kits ].join( ', ' ) }), ${ plan.boards.length } boards${ onRoad ? `, ${ onRoad } too close to the road` : '' }` );

	// The optimized racing line, if it's for this layout
	const saved = RACE_LINES[ track.id ];
	if ( ! saved ) console.log( '  racing line: not optimized (NPCs drive the smooth line)' );
	else if ( saved.hash !== lineHash( track ) ) console.log( `  ⚠ racing line: optimized for a different layout; NPCs drive the smooth line until \`npm run sim -- --optimize --tracks ${ track.id }\`` );

	failed += onRoad + hidden + turned;

	for ( const p of problems ) console.log( '  ✗ ' + p );

	// Top-down: F finish, + corner, | and - straights, X a crossing, g gravel
	const at = new Map();
	track.cells.forEach( ( c, i ) => at.set( c[ 0 ] + ',' + c[ 1 ], at.has( c[ 0 ] + ',' + c[ 1 ] ) ? 'X' : c[ 2 ] === 'track-finish' ? 'F' : shape.unsealed.has( i ) ? 'g' : c[ 2 ] === 'track-corner' ? '+' : c[ 3 ] === 0 || c[ 3 ] === 10 ? '|' : '-' ) );
	const xs = track.cells.map( ( c ) => c[ 0 ] ), zs = track.cells.map( ( c ) => c[ 1 ] );

	for ( let z = Math.min( ...zs ); z <= Math.max( ...zs ); z ++ ) {

		let row = '  ';
		for ( let x = Math.min( ...xs ); x <= Math.max( ...xs ); x ++ ) row += ' ' + ( at.get( x + ',' + z ) || '.' );
		console.log( row );

	}

}

if ( failed ) process.exit( 1 );
