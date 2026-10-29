// Compress the source models in models/src/ into models/ and write
// js/CarList.js from the vehicles' bounds.
//
//   npm run models
//
// Sources: Kenney's Starter Kit Racing (models/src/*.glb) and Car Kit 3.1
// (models/src/cars/*.glb). Both reference an external Textures/colormap.png
// per kit; the outputs carry a 1×1 placeholder image named after the kit
// instead, and js/Loader.js swaps in the shared colormap at load time.
//
// Quantization moves a dequantization transform into the node that holds a
// mesh. Vehicle.js spins wheels and tilts the body around their node origins
// (and sets the body's height), so every mesh is first moved into an unnamed
// child node: the named nodes keep their transforms exactly.

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { NodeIO, Logger, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, unpartition, mergeDocuments } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const ROOT = resolve( import.meta.dirname, '..' );
const SRC = resolve( ROOT, 'models/src' );
const OUT = resolve( ROOT, 'models' );

// Godot imports the vehicles at root_scale 0.5 (main.js applies it at load)
const VEHICLE_SCALE = 0.5;

const PLACEHOLDER_PNG = Buffer.from( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64' );

// Display order and names. Starter Kit trucks first, then the Car Kit.
const STARTER_CARS = {
	'vehicle-truck-yellow': 'Yellow Truck',
	'vehicle-truck-green': 'Green Truck',
	'vehicle-truck-purple': 'Purple Truck',
	'vehicle-truck-red': 'Red Truck',
};

const KIT_CARS = {
	'sedan': 'Sedan',
	'sedan-sports': 'Sports Sedan',
	'hatchback-sports': 'Hot Hatch',
	'taxi': 'Taxi',
	'police': 'Police Car',
	'suv': 'SUV',
	'suv-luxury': 'Luxury SUV',
	'van': 'Van',
	'truck': 'Pickup',
	'truck-flat': 'Flatbed Pickup',
	'race': 'Formula',
	'race-future': 'Future Racer',
	'kart-oobi': 'Kart Oobi',
	'kart-oodi': 'Kart Oodi',
	'kart-ooli': 'Kart Ooli',
	'kart-oopi': 'Kart Oopi',
	'kart-oozi': 'Kart Oozi',
	'delivery': 'Delivery Truck',
	'delivery-flat': 'Tow Truck',
	'ambulance': 'Ambulance',
	'firetruck': 'Fire Truck',
	'garbage-truck': 'Garbage Truck',
	'tractor': 'Tractor',
	'tractor-police': 'Police Tractor',
	'tractor-shovel': 'Loader',
};

// Loose parts that fly off in hard crashes, packed into one file
const DEBRIS = [ 'debris-bumper', 'debris-door', 'debris-door-window', 'debris-plate-a', 'debris-plate-small-a', 'debris-spoiler-a', 'debris-tire', 'debris-bolt', 'debris-nut' ];

const WHEEL = /^wheel-(front|back)-(left|right)$/;

const io = new NodeIO()
	.registerExtensions( ALL_EXTENSIONS )
	.registerDependencies( { 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder } )
	.setLogger( new Logger( Logger.Verbosity.WARN ) );

function placeholderTextures( document, kit ) {

	for ( const texture of document.getRoot().listTextures() ) {

		texture.setImage( PLACEHOLDER_PNG ).setMimeType( 'image/png' ).setURI( '' ).setName( 'colormap-' + kit );

	}

}

// Car Kit layout → the layout Vehicle.js expects: one node named "body"
// carrying every non-wheel part (doors, grills, spoilers tilt with it), and
// only the four road wheels named wheel-front-left etc.
function normalizeCar( document, id ) {

	const scene = document.getRoot().listScenes()[ 0 ];
	const roots = scene.listChildren();

	let body = roots.find( ( n ) => n.getName() === 'body' );

	if ( ! body && id.startsWith( 'kart-' ) ) {

		body = roots.find( ( n ) => n.getName() === id );
		body.setName( 'body' );

	}

	if ( ! body ) throw new Error( `${ id }: no body node` );

	const bodyT = body.getTranslation();

	for ( const node of roots ) {

		if ( node === body || WHEEL.test( node.getName() ) ) continue;

		if ( node.getRotation().some( ( v, i ) => v !== ( i === 3 ? 1 : 0 ) ) || node.getScale().some( ( v ) => v !== 1 ) || body.getRotation()[ 3 ] !== 1 ) {

			throw new Error( `${ id }: can't reparent rotated/scaled node ${ node.getName() }` );

		}

		const t = node.getTranslation();
		scene.removeChild( node );
		body.addChild( node.setTranslation( [ t[ 0 ] - bodyT[ 0 ], t[ 1 ] - bodyT[ 1 ], t[ 2 ] - bodyT[ 2 ] ] ) );

	}

	// The SUV's spare wheel would otherwise spin with the road wheels
	body.traverse( ( node ) => {

		if ( node !== body && node.getName().startsWith( 'wheel' ) && ! WHEEL.test( node.getName() ) ) node.setName( 'spare-' + node.getName() );

	} );

	for ( const wheel of [ 'front-left', 'front-right', 'back-left', 'back-right' ] ) {

		if ( ! roots.concat( body.listChildren() ).some( ( n ) => n.getName() === 'wheel-' + wheel ) ) throw new Error( `${ id }: missing wheel-${ wheel }` );

	}

}

function detachMeshes( document ) {

	for ( const node of document.getRoot().listNodes() ) {

		const mesh = node.getMesh();
		if ( ! mesh ) continue;

		node.setMesh( null );
		node.addChild( document.createNode( '' ).setMesh( mesh ) );

	}

}

function namedTransforms( document ) {

	const map = new Map();

	for ( const node of document.getRoot().listNodes() ) {

		if ( node.getName() ) map.set( node.getName(), node.getWorldMatrix().slice() );

	}

	return map;

}

function verify( name, before, beforeBounds, document ) {

	const after = namedTransforms( document );

	for ( const [ key, matrix ] of before ) {

		const m = after.get( key );
		if ( ! m || m.some( ( v, i ) => Math.abs( v - matrix[ i ] ) > 1e-5 ) ) throw new Error( `${ name }: node ${ key } moved` );

	}

	const bounds = getBounds( document.getRoot().listScenes()[ 0 ] );

	for ( const k of [ 'min', 'max' ] ) {

		for ( let i = 0; i < 3; i ++ ) {

			if ( Math.abs( bounds[ k ][ i ] - beforeBounds[ k ][ i ] ) > 1e-3 ) throw new Error( `${ name }: bounds changed (${ k }[${ i }] ${ beforeBounds[ k ][ i ] } → ${ bounds[ k ][ i ] })` );

		}

	}

}

async function compress( document, name, outPath ) {

	const before = namedTransforms( document );
	const beforeBounds = getBounds( document.getRoot().listScenes()[ 0 ] );

	detachMeshes( document );

	await document.transform(
		dedup(),
		prune( { keepLeaves: true, keepSolidTextures: true } ),
		weld(),
		meshopt( { encoder: MeshoptEncoder, level: 'high' } ),
	);

	const bytes = await io.writeBinary( document );
	writeFileSync( outPath, bytes );

	verify( name, before, beforeBounds, await io.readBinary( bytes ) );

	return bytes.length;

}

function footprint( document, id, kit ) {

	const scene = document.getRoot().listScenes()[ 0 ];
	const { min, max } = getBounds( scene );
	const body = document.getRoot().listNodes().find( ( n ) => n.getName() === 'body' );
	const s = VEHICLE_SCALE;
	const r = ( v ) => Math.round( v * 1000 ) / 1000;

	return {
		id,
		name: kit === 'starter' ? STARTER_CARS[ id ] : KIT_CARS[ id ],
		kit,
		length: r( ( max[ 2 ] - min[ 2 ] ) * s ),
		width: r( ( max[ 0 ] - min[ 0 ] ) * s ),
		height: r( ( max[ 1 ] - min[ 1 ] ) * s ),
		centerZ: r( ( max[ 2 ] + min[ 2 ] ) / 2 * s ),
		// Resting body height in model units: the trucks settle to 0.3 (as
		// in the Godot scene); Car Kit bodies stay where they're modelled
		bodyY: kit === 'starter' ? 0.3 : r( body.getTranslation()[ 1 ] ),
	};

}

await MeshoptEncoder.ready;
mkdirSync( resolve( OUT, 'cars' ), { recursive: true } );

const report = [];
const cars = [];

// Starter Kit: track pieces, decorations, trucks (track-tents.glb is unused)

for ( const file of readdirSync( SRC ).filter( ( f ) => f.endsWith( '.glb' ) && f !== 'track-tents.glb' ).sort() ) {

	const id = basename( file, '.glb' );
	const document = await io.read( resolve( SRC, file ) );
	placeholderTextures( document, 'starter' );

	if ( id in STARTER_CARS ) cars.push( footprint( document, id, 'starter' ) );

	report.push( [ file, await compress( document, file, resolve( OUT, file ) ) ] );

}

// Car Kit vehicles

for ( const id of Object.keys( KIT_CARS ) ) {

	const document = await io.read( resolve( SRC, 'cars', id + '.glb' ) );
	placeholderTextures( document, 'cars' );
	normalizeCar( document, id );
	cars.push( footprint( document, id, 'cars' ) );

	report.push( [ 'cars/' + id + '.glb', await compress( document, id, resolve( OUT, 'cars', id + '.glb' ) ) ] );

}

// Debris: one file, one named root node per part (each source has one root)

{

	const document = await io.read( resolve( SRC, 'cars', DEBRIS[ 0 ] + '.glb' ) );
	const scene = document.getRoot().listScenes()[ 0 ];
	const parts = [ scene.listChildren()[ 0 ] ];

	for ( const id of DEBRIS.slice( 1 ) ) {

		const part = await io.read( resolve( SRC, 'cars', id + '.glb' ) );
		const roots = part.getRoot().listScenes()[ 0 ].listChildren();
		if ( roots.length !== 1 ) throw new Error( `${ id }: expected one root node` );

		const map = mergeDocuments( document, part );
		const node = map.get( roots[ 0 ] );
		scene.addChild( node );
		parts.push( node );

	}

	for ( const s of document.getRoot().listScenes() ) if ( s !== scene ) s.dispose();

	DEBRIS.forEach( ( id, i ) => parts[ i ].setName( id ).setTranslation( [ 0, 0, 0 ] ) );

	placeholderTextures( document, 'cars' );
	await document.transform( unpartition() );
	report.push( [ 'cars/debris.glb', await compress( document, 'debris', resolve( OUT, 'cars', 'debris.glb' ) ) ] );

}

const order = [ ...Object.keys( STARTER_CARS ), ...Object.keys( KIT_CARS ) ];
cars.sort( ( a, b ) => order.indexOf( a.id ) - order.indexOf( b.id ) );

writeFileSync( resolve( ROOT, 'js/CarList.js' ),
	'// Generated by scripts/models.mjs from the models\' bounds; don\'t edit.\n' +
	'// length / width / height / centerZ are in world units (after the 0.5\n' +
	'// vehicle scale); bodyY is the body node\'s resting height in model units.\n\n' +
	'export const CARS = [\n' +
	cars.map( ( c ) => '\t{ ' + Object.entries( c ).map( ( [ k, v ] ) => k + ': ' + ( typeof v === 'string' ? `'${ v }'` : v ) ).join( ', ' ) + ' }' ).join( ',\n' ) +
	',\n];\n\n' +
	'export const DEFAULT_CAR = \'vehicle-truck-yellow\';\n\n' +
	'export function getCar( id ) {\n\n\treturn CARS.find( ( c ) => c.id === id ) || CARS[ 0 ];\n\n}\n'
);

let total = 0;

for ( const [ file, size ] of report ) {

	total += size;
	console.log( file.padEnd( 32 ), ( size / 1024 ).toFixed( 1 ).padStart( 7 ) + ' KB' );

}

console.log( 'total'.padEnd( 32 ), ( total / 1024 ).toFixed( 1 ).padStart( 7 ) + ' KB' );
