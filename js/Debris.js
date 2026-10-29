import * as THREE from 'three';
import { setLambert } from './Materials.js';

// Bits that fly off in hard car-to-car hits: Car Kit debris (bumpers,
// plates, bolts, the odd tyre), thrown up from the contact point, bouncing on
// the ground and shrinking away. Purely cosmetic: no physics bodies, and the
// race never sees them.

const LIFE = 2.6;
const GRAVITY = 14;
const SMALL = [ 'debris-bolt', 'debris-nut', 'debris-plate-small-a' ];
const LARGE = [ 'debris-bumper', 'debris-door', 'debris-door-window', 'debris-plate-a', 'debris-spoiler-a' ];

const _axis = new THREE.Vector3();
const _quat = new THREE.Quaternion();

export class Debris {

	constructor( scene, max ) {

		this.scene = scene;
		this.max = max;
		this.templates = null;
		this.pieces = [];
		this.index = 0;
		this.lambert = false;

	}

	// model: debris.glb's scene, one root node per part (scripts/models.mjs)
	setModel( model ) {

		this.templates = {};

		for ( const child of model.children ) {

			child.traverse( ( o ) => {

				if ( o.isMesh ) o.castShadow = true;

			} );

			this.templates[ child.name ] = child;

		}

	}

	// A hit at (x, z) with closing speed `speed` (m/s)
	burst( x, z, speed ) {

		if ( ! this.templates || this.max === 0 ) return;

		const count = Math.min( 3, Math.floor( ( speed - 3 ) / 2 ) + 1 );

		for ( let i = 0; i < count; i ++ ) {

			const r = Math.random();
			const list = r < 0.55 ? SMALL : LARGE;
			const name = speed > 7 && r > 0.9 ? 'debris-tire' : list[ Math.floor( Math.random() * list.length ) ];
			this.spawn( name, x, z, speed );

		}

	}

	spawn( name, x, z, speed ) {

		const template = this.templates[ name ];
		if ( ! template ) return;

		const slot = this.index;
		this.index = ( slot + 1 ) % this.max;

		if ( this.pieces[ slot ] ) this.scene.remove( this.pieces[ slot ].object );

		const object = template.clone();
		setLambert( object, this.lambert );
		object.scale.setScalar( 0.5 );
		object.position.set( x, 0.4, z );
		object.quaternion.setFromEuler( new THREE.Euler( Math.random() * 6, Math.random() * 6, Math.random() * 6 ) );
		this.scene.add( object );

		const a = Math.random() * Math.PI * 2;
		const out = 1 + Math.random() * speed * 0.35;

		this.pieces[ slot ] = {
			object,
			life: LIFE,
			velocity: new THREE.Vector3( Math.cos( a ) * out, 2.5 + Math.random() * speed * 0.4, Math.sin( a ) * out ),
			spin: new THREE.Vector3( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).multiplyScalar( 18 ),
		};

	}

	update( dt ) {

		for ( const piece of this.pieces ) {

			if ( ! piece || piece.life <= 0 ) continue;

			piece.life -= dt;
			const o = piece.object;

			if ( piece.life <= 0 ) {

				this.scene.remove( o );
				continue;

			}

			piece.velocity.y -= GRAVITY * dt;
			o.position.addScaledVector( piece.velocity, dt );

			// Bounce and scrape along the ground
			if ( o.position.y < 0.05 ) {

				o.position.y = 0.05;
				piece.velocity.y = Math.abs( piece.velocity.y ) * 0.35;
				piece.velocity.x *= 0.7;
				piece.velocity.z *= 0.7;
				piece.spin.multiplyScalar( 0.6 );

			}

			const w = piece.spin.length();

			if ( w > 1e-3 ) {

				_quat.setFromAxisAngle( _axis.copy( piece.spin ).divideScalar( w ), w * dt );
				o.quaternion.premultiply( _quat );

			}

			// Shrink away over the last half second
			o.scale.setScalar( 0.5 * Math.min( 1, piece.life * 2 ) );

		}

	}

}
