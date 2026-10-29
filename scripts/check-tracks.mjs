// Check the built-in track layouts (js/Tracks.js) and draw them. For hilly
// tracks also: the steepest gradient, and each crest's radius and the speed
// at which a car leaves the ground over it (v² = g · R; top speed ~14.6 m/s).
//
//   npm run tracks

import { TRACKS, trackLine } from '../js/Tracks.js';
import { checkLayout } from '../js/TrackPath.js';
import { TrackShape } from '../js/TrackShape.js';

const GRAVITY = 9.81 * 1.5;
const MAX_GRADIENT = 0.2;

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
