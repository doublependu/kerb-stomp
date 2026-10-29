import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SMOKE_URL } from './Assets.js';

// The magic wand that fetches cars back to the track (Race.respawn): a
// star on a stick hovering over the car, a soft beam of light, and gold
// sparkles, drawn while the car is carried. Rendering only; the flight
// itself is in Race.js.

const MAX_WANDS = 9;
const SPARKS = 400;
const SPARK_LIFE = 0.9;

// Starter Kit colormap swatches: purple, gold
const STICK_UV = [ 0.094, 0.375 ];
const STAR_UV = [ 0.406, 0.6 ];

function painted( geometry, uv ) {

	geometry = geometry.index ? geometry.toNonIndexed() : geometry;
	const uvs = new Float32Array( geometry.getAttribute( 'position' ).count * 2 );
	for ( let i = 0; i < uvs.length; i += 2 ) uvs.set( uv, i );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	return geometry;

}

function wandGeometry() {

	const star = new THREE.Shape();

	for ( let i = 0; i < 10; i ++ ) {

		const a = i / 10 * Math.PI * 2 + Math.PI / 2;
		const r = i % 2 ? 0.16 : 0.38;
		if ( i === 0 ) star.moveTo( Math.cos( a ) * r, Math.sin( a ) * r );
		else star.lineTo( Math.cos( a ) * r, Math.sin( a ) * r );

	}

	const head = new THREE.ExtrudeGeometry( star, { depth: 0.1, bevelEnabled: false } ).translate( 0, 0, - 0.05 );
	head.deleteAttribute( 'uv' );
	const stick = new THREE.CylinderGeometry( 0.035, 0.035, 1.1, 6 ).translate( 0, - 0.85, 0 );
	stick.deleteAttribute( 'uv' );

	const geometry = mergeGeometries( [ painted( head, STAR_UV ), painted( stick, STICK_UV ) ] );
	geometry.computeVertexNormals();
	return geometry;

}

export class Wand {

	// material: one using the Starter Kit colormap (from a track piece)
	constructor( scene, material ) {

		const geometry = wandGeometry();
		const beamGeometry = new THREE.CylinderGeometry( 0.25, 0.9, 1, 16, 1, true ).translate( 0, 0.5, 0 );
		const beamMaterial = new THREE.MeshBasicMaterial( { color: 0xffe08a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false } );

		this.wands = [];

		for ( let i = 0; i < MAX_WANDS; i ++ ) {

			const group = new THREE.Group();
			const stick = new THREE.Mesh( geometry, material );
			stick.castShadow = true;
			const beam = new THREE.Mesh( beamGeometry, beamMaterial.clone() );
			group.add( stick, beam );
			group.visible = false;
			scene.add( group );
			this.wands.push( { group, stick, beam } );

		}

		// Sparkles: gold points that drift up and fade
		this.sparks = Array.from( { length: SPARKS }, () => ( { life: 0, v: new THREE.Vector3() } ) );
		this.positions = new Float32Array( SPARKS * 3 );
		this.alphas = new Float32Array( SPARKS );
		const sparkGeometry = new THREE.BufferGeometry();
		sparkGeometry.setAttribute( 'position', new THREE.BufferAttribute( this.positions, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		sparkGeometry.setAttribute( 'aOpacity', new THREE.BufferAttribute( this.alphas, 1 ).setUsage( THREE.DynamicDrawUsage ) );

		const sparkMaterial = new THREE.PointsMaterial( {
			map: new THREE.TextureLoader().load( SMOKE_URL ),
			color: 0xffd45e,
			size: 0.35,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		} );

		sparkMaterial.onBeforeCompile = ( shader ) => {

			shader.vertexShader = 'attribute float aOpacity;\nvarying float vOpacity;\n' + shader.vertexShader.replace( 'void main() {', 'void main() {\n\tvOpacity = aOpacity;' );
			shader.fragmentShader = 'varying float vOpacity;\n' + shader.fragmentShader.replace( 'vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vOpacity );' );

		};

		this.points = new THREE.Points( sparkGeometry, sparkMaterial );
		this.points.frustumCulled = false;
		scene.add( this.points );
		this.next = 0;
		this.time = 0;

	}

	// Per frame: a wand over every car being carried
	update( dt, cars ) {

		this.time += dt;
		let used = 0;

		for ( const car of cars ) {

			const carry = car.carry;
			if ( ! carry || used >= MAX_WANDS ) continue;

			const { group, stick, beam } = this.wands[ used ++ ];
			const p = car.vehicle.container.position;
			const u = Math.min( 1, carry.t / 1.3 );
			const fade = Math.min( 1, u * 6, ( 1 - u ) * 6 );

			group.visible = true;
			group.position.set( p.x, p.y + 2.6 + Math.sin( this.time * 6 ) * 0.08, p.z );
			stick.rotation.set( Math.sin( this.time * 4 ) * 0.25, this.time * 2.5, 0.35 );
			stick.scale.setScalar( Math.max( 0.01, fade ) );
			beam.position.y = - 2.6;
			beam.scale.set( 1, 2.5, 1 );
			beam.material.opacity = 0.3 * fade;

			for ( let k = 0; k < 2; k ++ ) this.spark( p.x + ( Math.random() - 0.5 ) * 1.6, p.y + Math.random() * 1.2, p.z + ( Math.random() - 0.5 ) * 1.6 );
			if ( Math.random() < 0.5 ) this.spark( group.position.x, group.position.y + 0.3, group.position.z );

		}

		for ( let i = used; i < MAX_WANDS; i ++ ) this.wands[ i ].group.visible = false;

		for ( let i = 0; i < SPARKS; i ++ ) {

			const s = this.sparks[ i ];
			if ( s.life <= 0 ) continue;

			s.life -= dt;
			this.positions[ i * 3 ] += s.v.x * dt;
			this.positions[ i * 3 + 1 ] += s.v.y * dt;
			this.positions[ i * 3 + 2 ] += s.v.z * dt;
			this.alphas[ i ] = Math.max( 0, s.life / SPARK_LIFE ) * ( 0.6 + 0.4 * Math.sin( ( this.time + i ) * 20 ) );

		}

		this.points.geometry.attributes.position.needsUpdate = true;
		this.points.geometry.attributes.aOpacity.needsUpdate = true;

	}

	spark( x, y, z ) {

		const i = this.next;
		this.next = ( i + 1 ) % SPARKS;
		const s = this.sparks[ i ];

		s.life = SPARK_LIFE * ( 0.6 + Math.random() * 0.4 );
		s.v.set( ( Math.random() - 0.5 ) * 0.8, 0.6 + Math.random() * 0.8, ( Math.random() - 0.5 ) * 0.8 );
		this.positions.set( [ x, y, z ], i * 3 );
		this.alphas[ i ] = 1;

	}

}
