// Check the built-in track layouts (js/Tracks.js) and draw them.
//
//   npm run tracks

import { TRACKS } from '../js/Tracks.js';
import { checkLayout, layoutPath, centerline } from '../js/TrackPath.js';

let failed = 0;

for ( const track of TRACKS ) {

	const line = centerline( track.cells );
	const corners = track.cells.filter( ( c ) => c[ 2 ] === 'track-corner' ).length;
	const problems = track.layout ? checkLayout( track.layout, track.heading ) : [];
	if ( ! line.closed ) problems.push( 'centerline does not close' );
	failed += problems.length;

	console.log( `\n${ track.name } (${ track.id }): ${ track.cells.length } cells, ${ corners } corners, ${ line.length.toFixed( 0 ) } m, ${ track.laps } laps` );
	for ( const p of problems ) console.log( '  ✗ ' + p );

	// Top-down: F finish, + corner, | and - straights
	const at = new Map( track.cells.map( ( c ) => [ c[ 0 ] + ',' + c[ 1 ], c ] ) );
	const xs = track.cells.map( ( c ) => c[ 0 ] ), zs = track.cells.map( ( c ) => c[ 1 ] );

	for ( let z = Math.min( ...zs ); z <= Math.max( ...zs ); z ++ ) {

		let row = '  ';

		for ( let x = Math.min( ...xs ); x <= Math.max( ...xs ); x ++ ) {

			const c = at.get( x + ',' + z );
			row += ' ' + ( ! c ? '.' : c[ 2 ] === 'track-finish' ? 'F' : c[ 2 ] === 'track-corner' ? '+' : c[ 3 ] === 0 || c[ 3 ] === 10 ? '|' : '-' );

		}

		console.log( row );

	}

}

if ( failed ) process.exit( 1 );
