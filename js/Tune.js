import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { COLLISION } from './CarCollisions.js';

// ?tune: live knobs for car-to-car contact, to find what's fun. Loaded only
// when asked for. Aggression applies to the opponents on the grid now; a new
// field (count or car change) rolls its own.
export function tune( race ) {

	const gui = new GUI( { title: 'Car contact' } );
	gui.domElement.style.top = '64px'; // below the pause button

	gui.add( COLLISION, 'restitution', 0, 1, 0.01 );
	gui.add( COLLISION, 'friction', 0, 1, 0.01 );
	gui.add( COLLISION, 'yaw', 0, 2, 0.05 ).name( 'yaw kick' );
	gui.add( COLLISION, 'massExponent', 0, 2, 0.05 ).name( 'mass exponent' );
	gui.add( COLLISION, 'speedLoss', 0, 1, 0.05 ).name( 'speed loss' );

	const field = { aggression: 0.5 };

	gui.add( field, 'aggression', 0, 1, 0.05 ).name( 'NPC aggression' ).onChange( ( value ) => {

		for ( const car of race.cars ) if ( car.driver && ! car.player ) car.driver.aggression = value;

	} );

	return gui;

}
