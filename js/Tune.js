import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { COLLISION } from './CarCollisions.js';
import { HANDLING } from './Vehicle.js';
import { SURFACE } from './Race.js';
import { TAKEOFF } from './TakeOff.js';

// ?tune: live knobs for car-to-car contact, handling by mass, the kerbs and
// the ramps, to find what's fun. Loaded only when asked for. Aggression applies to the
// opponents on the grid now; a new field (count or car change) rolls its own.
export function tune( race ) {

	const gui = new GUI( { title: 'Tuning' } );
	gui.domElement.style.top = '64px'; // below the pause button

	const contact = gui.addFolder( 'Car contact' );
	contact.add( COLLISION, 'restitution', 0, 1, 0.01 );
	contact.add( COLLISION, 'friction', 0, 1, 0.01 );
	contact.add( COLLISION, 'yaw', 0, 2, 0.05 ).name( 'yaw kick' );
	contact.add( COLLISION, 'massExponent', 0, 2, 0.05 ).name( 'mass exponent' );
	contact.add( COLLISION, 'speedLoss', 0, 1, 0.05 ).name( 'speed loss' );
	contact.add( COLLISION, 'spinAt', 0, 6, 0.1 ).name( 'spin at (m/s)' );
	contact.add( COLLISION, 'launchAt', 2, 12, 0.1 ).name( 'launch at (m/s)' );
	contact.add( COLLISION, 'lift', 0, 2, 0.05 );
	contact.add( COLLISION, 'tumble', 0, 4, 0.05 );

	// Handling exponents: rates go as mass ^ −exponent
	const handling = gui.addFolder( 'Handling by mass' );
	const apply = () => {

		for ( const car of race.cars ) car.vehicle.setMass( car.vehicle.mass );

	};

	for ( const key of [ 'accel', 'coast', 'brake', 'wobble' ] ) handling.add( HANDLING, key, 0, 1.5, 0.05 ).onChange( apply );

	const surface = gui.addFolder( 'Kerbs and gravel' );
	surface.add( SURFACE, 'kerb', 0, 3, 0.05 ).name( 'kerb drag' );
	surface.add( SURFACE, 'gravel', 0, 2, 0.05 ).name( 'gravel drag' );

	const ramps = gui.addFolder( 'Take-off' );
	ramps.add( TAKEOFF, 'minSpeed', 5, 14, 0.1 ).name( 'least speed (m/s)' );
	ramps.add( TAKEOFF, 'fullSpeed', 6, 15, 0.1 ).name( 'full flight (m/s)' );
	ramps.add( TAKEOFF, 'lift', 1, 8, 0.1 ).name( 'launch (m/s up)' );
	ramps.add( TAKEOFF, 'longest', 1, 4, 0.1 ).name( 'longest flight (s)' );
	ramps.add( TAKEOFF, 'straighten', 0, 20, 1 ).name( 'straightening (°)' );

	const field = { aggression: 0.5 };

	gui.add( field, 'aggression', 0, 1, 0.05 ).name( 'NPC aggression' ).onChange( ( value ) => {

		for ( const car of race.cars ) if ( car.driver && ! car.player ) car.driver.aggression = value;

	} );

	return gui;

}
