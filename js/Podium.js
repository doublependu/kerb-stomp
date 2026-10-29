import * as THREE from 'three';

// The podium behind the results: the winner slowly turning on a round table
// under a spotlight, 2nd and 3rd on lower steps either side when the race
// had three badges to give (4+ cars), each with its medal over it, and a
// burst of confetti. Its own little scene, drawn instead of the race (which
// keeps running behind, so the steps fill as the others finish), framed in
// the part of the screen the results panel leaves free.

export const MEDALS = [ '#f5c242', '#c9d1db', '#d08a4f' ];

// How many badges a race gives: 3 or fewer cars, just the winner
export function badgeCount( cars ) {

	return cars <= 3 ? 1 : 3;

}

// A medal as inline SVG (results list, track picker)
export function medalSVG( place, size = 18 ) {

	return `<svg class="medal" width="${ size }" height="${ size }" viewBox="0 0 20 20" aria-label="${ [ 'Gold', 'Silver', 'Bronze' ][ place - 1 ] }"><path d="M6 1h3l2 6H8zM14 1h-3L9 7h3z" fill="#5b7bd6"/><circle cx="10" cy="12.5" r="6.5" fill="${ MEDALS[ place - 1 ] }" stroke="rgba(0,0,0,0.25)"/><text x="10" y="15.6" text-anchor="middle" font-size="8.5" font-weight="800" font-family="sans-serif" fill="#3a2c08">${ place }</text></svg>`;

}

function medalTexture( place ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = 128;
	const g = canvas.getContext( '2d' );
	g.fillStyle = '#5b7bd6';
	g.beginPath(); g.moveTo( 38, 4 ); g.lineTo( 56, 4 ); g.lineTo( 70, 44 ); g.lineTo( 52, 44 ); g.fill();
	g.beginPath(); g.moveTo( 90, 4 ); g.lineTo( 72, 4 ); g.lineTo( 58, 44 ); g.lineTo( 76, 44 ); g.fill();
	g.fillStyle = MEDALS[ place - 1 ];
	g.strokeStyle = 'rgba(0,0,0,0.25)';
	g.lineWidth = 4;
	g.beginPath(); g.arc( 64, 80, 40, 0, Math.PI * 2 ); g.fill(); g.stroke();
	g.fillStyle = '#3a2c08';
	g.font = 'bold 52px sans-serif';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText( String( place ), 64, 83 );

	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

const CONFETTI = 260;
const PLACES = [ [ 0, 0.55 ], [ - 2.7, 0.3 ], [ 2.7, 0.18 ] ]; // x, height of each step

export class Podium {

	constructor( { shadows = true } = {} ) {

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color( 0x272c37 );
		this.camera = new THREE.PerspectiveCamera( 32, 1, 0.1, 100 );
		this.active = false;
		this.cars = new Map();
		this.time = 0;

		this.scene.add( new THREE.HemisphereLight( 0xdfe8ff, 0x4a4236, 2.4 ) );
		const spot = new THREE.SpotLight( 0xfff1d6, 120, 30, 0.5, 0.6 );
		spot.position.set( 1, 11, 4 );
		spot.castShadow = shadows;
		spot.shadow.mapSize.setScalar( 1024 );
		this.scene.add( spot, spot.target );

		const grey = new THREE.MeshStandardMaterial( { color: 0x9aa3b8, roughness: 0.8 } );
		const dark = new THREE.MeshStandardMaterial( { color: 0x3d4352, roughness: 1 } );
		const gold = new THREE.MeshStandardMaterial( { color: 0xf5c242, roughness: 0.35, metalness: 0.6 } );

		const floor = new THREE.Mesh( new THREE.CircleGeometry( 9, 48 ), dark );
		floor.rotation.x = - Math.PI / 2;
		floor.receiveShadow = true;
		this.scene.add( floor );

		// The round table turns; the steps don't
		this.table = new THREE.Group();
		const top = new THREE.Mesh( new THREE.CylinderGeometry( 1.55, 1.65, PLACES[ 0 ][ 1 ], 48 ), grey );
		top.position.y = PLACES[ 0 ][ 1 ] / 2;
		const rim = new THREE.Mesh( new THREE.TorusGeometry( 1.6, 0.07, 8, 64 ), gold );
		rim.rotation.x = Math.PI / 2;
		rim.position.y = PLACES[ 0 ][ 1 ];
		this.table.add( top, rim );
		this.scene.add( this.table );

		this.steps = [ null ];

		for ( const [ x, h ] of PLACES.slice( 1 ) ) {

			const step = new THREE.Mesh( new THREE.CylinderGeometry( 1.1, 1.2, h, 40 ), grey );
			step.position.set( x, h / 2, 0.6 );
			this.scene.add( step );
			this.steps.push( step );

		}

		for ( const mesh of [ top, ...this.steps.slice( 1 ) ] ) {

			mesh.castShadow = true;
			mesh.receiveShadow = true;

		}

		this.medals = [ 1, 2, 3 ].map( ( place ) => {

			const sprite = new THREE.Sprite( new THREE.SpriteMaterial( { map: medalTexture( place ), transparent: true } ) );
			sprite.scale.setScalar( 0.9 );
			sprite.visible = false;
			this.scene.add( sprite );
			return sprite;

		} );

		// Confetti: little squares tumbling down
		const positions = new Float32Array( CONFETTI * 3 ), colors = new Float32Array( CONFETTI * 3 );
		const palette = [ 0xf5c242, 0xe85d4f, 0x5b7bd6, 0x61cb8b, 0xffffff ].map( ( c ) => new THREE.Color( c ) );
		this.confetti = Array.from( { length: CONFETTI }, ( _, i ) => {

			palette[ i % palette.length ].toArray( colors, i * 3 );
			return { v: new THREE.Vector3(), phase: Math.random() * 6 };

		} );

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
		this.points = new THREE.Points( geometry, new THREE.PointsMaterial( { size: 0.12, vertexColors: true } ) );
		this.points.frustumCulled = false;
		this.scene.add( this.points );

	}

	burst() {

		const p = this.points.geometry.attributes.position;

		this.confetti.forEach( ( c, i ) => {

			p.setXYZ( i, ( Math.random() - 0.5 ) * 7, 5 + Math.random() * 5, ( Math.random() - 0.5 ) * 4 );
			c.v.set( ( Math.random() - 0.5 ) * 0.6, - 0.8 - Math.random() * 0.8, ( Math.random() - 0.5 ) * 0.4 );

		} );

		p.needsUpdate = true;

	}

	// The standings so far: put each badge-winner that has finished on its
	// step (the race keeps going behind the results)
	show( race ) {

		if ( ! this.active ) {

			this.active = true;
			this.time = 0;
			this.burst();

		}

		const winners = badgeCount( race.cars.length );
		const standings = race.standings();

		for ( let i = 0; i < winners; i ++ ) {

			const car = standings[ i ];
			const entry = this.cars.get( i );
			if ( ! car || ! car.finished || ( entry && entry.car === car ) ) continue;
			if ( entry ) entry.holder.removeFromParent();

			const holder = new THREE.Group();
			const model = car.vehicle.model.clone();
			model.traverse( ( child ) => {

				if ( child.isMesh ) child.castShadow = child.receiveShadow = true;

			} );
			holder.add( model );
			holder.scale.setScalar( 1.25 );

			if ( i === 0 ) {

				holder.position.y = PLACES[ 0 ][ 1 ];
				this.table.add( holder );

			} else {

				holder.position.set( PLACES[ i ][ 0 ], PLACES[ i ][ 1 ], 0.6 );
				holder.rotation.y = i === 1 ? 0.5 : - 0.5;
				this.scene.add( holder );

			}

			this.cars.set( i, { car, holder } );

			const medal = this.medals[ i ];
			medal.visible = true;
			medal.position.set( PLACES[ i ][ 0 ], PLACES[ i ][ 1 ] + 1.8, i === 0 ? 0 : 0.6 );

		}

	}

	hide() {

		this.active = false;

		for ( const { holder } of this.cars.values() ) holder.removeFromParent();
		this.cars.clear();
		for ( const medal of this.medals ) medal.visible = false;

	}

	// Frame the podium in the screen area left of / above the panel: free,
	// the free region's rectangle (CSS px)
	frame( width, height, free ) {

		const cx = free.x + free.width / 2, cy = free.y + free.height / 2;
		const fit = Math.min( 1, free.width / width * 1.6, free.height / height * 1.6 );

		this.camera.aspect = width / height;
		this.camera.position.set( 0, 4.2, 14 / Math.max( 0.45, fit ) );
		this.camera.lookAt( 0, 1, 0 );
		this.camera.setViewOffset( width, height, width / 2 - cx, height / 2 - cy, width, height );
		this.camera.updateProjectionMatrix();

	}

	update( dt ) {

		this.time += dt;
		this.table.rotation.y += dt * 0.5;

		const p = this.points.geometry.attributes.position;

		this.confetti.forEach( ( c, i ) => {

			const y = p.getY( i );
			if ( y < 0.02 ) return;
			p.setXYZ( i, p.getX( i ) + ( c.v.x + Math.sin( this.time * 3 + c.phase ) * 0.3 ) * dt, Math.max( 0.01, y + c.v.y * dt ), p.getZ( i ) + c.v.z * dt );

		} );

		p.needsUpdate = true;

		for ( let i = 0; i < 3; i ++ ) this.medals[ i ].position.y += Math.sin( this.time * 2 + i ) * 0.002;

	}

}
