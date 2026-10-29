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
import { NodeIO, Logger, Document, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, unpartition, mergeDocuments, flatten, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { KITS } from './import-kits.mjs';
import { writePNG } from './png.mjs';

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

// Mass (yellow truck = 1) goes with the model's volume, except for vehicles
// built heavier or lighter than they look
const MASS_FACTOR = { 'tractor': 1.4, 'tractor-police': 1.4, 'tractor-shovel': 1.5, 'race': 0.85, 'race-future': 0.85 };
const REFERENCE_VOLUME = 1.4 * 0.75 * 0.775; // the yellow truck

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

	if ( ! beforeBounds ) return;

	const bounds = getBounds( document.getRoot().listScenes()[ 0 ] );

	for ( const k of [ 'min', 'max' ] ) {

		for ( let i = 0; i < 3; i ++ ) {

			if ( Math.abs( bounds[ k ][ i ] - beforeBounds[ k ][ i ] ) > 1e-3 ) throw new Error( `${ name }: bounds changed (${ k }[${ i }] ${ beforeBounds[ k ][ i ] } → ${ bounds[ k ][ i ] })` );

		}

	}

}

async function compress( document, name, outPath, { checkBounds = true } = {} ) {

	const before = namedTransforms( document );
	const beforeBounds = checkBounds ? getBounds( document.getRoot().listScenes()[ 0 ] ) : null;

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

	const length = r( ( max[ 2 ] - min[ 2 ] ) * s ), width = r( ( max[ 0 ] - min[ 0 ] ) * s ), height = r( ( max[ 1 ] - min[ 1 ] ) * s );

	return {
		id,
		name: kit === 'starter' ? STARTER_CARS[ id ] : KIT_CARS[ id ],
		kit,
		length,
		width,
		height,
		mass: Math.round( Math.min( 1.6, Math.max( 0.25, length * width * height / REFERENCE_VOLUME * ( MASS_FACTOR[ id ] || 1 ) ) ) * 100 ) / 100,
		centerZ: r( ( max[ 2 ] + min[ 2 ] ) / 2 * s ),
		// Resting body height in model units: the trucks settle to 0.3 (as
		// in the Godot scene); Car Kit bodies stay where they're modelled
		bodyY: kit === 'starter' ? 0.3 : r( body.getTranslation()[ 1 ] ),
	};

}

// ─── Scenery ──────────────────────────────────────────────
//
// Kit models become one draw each where they can (materials that differ
// only by name merged, nodes flattened and joined), with their origin moved
// to the middle of their footprint at ground level, so js/Scenery.js can
// place and rotate them by their bounds alone.

// Fantasy Town houses assembled from its wall and roof parts, in unit cells
// (x, z). Storeys stack one unit each; the front faces +z.
const PREFABS = {
	'house-cottage': { cells: [ [ 0, 0 ] ], storeys: [ 'stone' ], roof: 'roof-gable', chimney: true },
	'house-tall': { cells: [ [ 0, 0 ] ], storeys: [ 'stone', 'wood' ], roof: 'roof-gable' },
	'house-long': { cells: [ [ 0, 0 ], [ 1, 0 ] ], storeys: [ 'stone' ], roof: 'roof-gable', chimney: true },
	'house-long-tall': { cells: [ [ 0, 0 ], [ 1, 0 ] ], storeys: [ 'stone', 'wood' ], roof: 'roof-gable' },
	'house-tower': { cells: [ [ 0, 0 ] ], storeys: [ 'stone', 'stone', 'wood' ], roof: 'roof-point' },
	// Landmarks: the kit's sails and wheel on a tower and a long house
	'house-windmill': { cells: [ [ 0, 0 ] ], storeys: [ 'stone', 'stone', 'wood' ], roof: 'roof-point', extra: [ 'windmill', [ 0, 2.4, 0.62 ], Math.PI / 2 ] },
	'house-watermill': { cells: [ [ 0, 0 ], [ 1, 0 ] ], storeys: [ 'stone', 'wood' ], roof: 'roof-gable', extra: [ 'watermill', [ 1.62, 0.9, 0 ], 0 ] },
};

const WALLS = {
	stone: { door: 'wall-door', front: 'wall-window-shutters', side: 'wall-window-small', back: 'wall' },
	wood: { door: 'wall-wood-door', front: 'wall-wood-window-shutters', side: 'wall-wood-window-shutters', back: 'wall-wood' },
};

// Wall parts stand on a cell's +x edge; this turns them to face each way
const FACING = { E: 0, N: Math.PI / 2, W: Math.PI, S: - Math.PI / 2 };
const STEP = { E: [ 1, 0 ], N: [ 0, - 1 ], W: [ - 1, 0 ], S: [ 0, 1 ] };

function yRotation( angle ) {

	return [ 0, Math.sin( angle / 2 ), 0, Math.cos( angle / 2 ) ];

}

// Merge a part file into `document` under a new node at (x, y, z), turned
async function placePart( document, file, translation, angle = 0 ) {

	const part = await io.read( file );
	const roots = part.getRoot().listScenes()[ 0 ].listChildren();
	const map = mergeDocuments( document, part );
	const holder = document.createNode().setTranslation( translation ).setRotation( yRotation( angle ) );

	for ( const root of roots ) holder.addChild( map.get( root ) );
	document.getRoot().listScenes()[ 0 ].addChild( holder );

	for ( const scene of document.getRoot().listScenes() ) if ( scene !== document.getRoot().listScenes()[ 0 ] ) scene.dispose();

}

async function buildPrefab( spec ) {

	const document = new Document().setLogger( new Logger( Logger.Verbosity.WARN ) );
	document.createBuffer();
	document.createScene();

	const dir = resolve( SRC, 'fantasy' );
	const occupied = new Set( spec.cells.map( ( c ) => c + '' ) );
	const front = spec.cells.filter( ( [ x, z ] ) => ! occupied.has( [ x, z + 1 ] + '' ) );

	for ( let level = 0; level < spec.storeys.length; level ++ ) {

		const walls = WALLS[ spec.storeys[ level ] ];

		for ( const [ x, z ] of spec.cells ) {

			for ( const side of Object.keys( FACING ) ) {

				const [ dx, dz ] = STEP[ side ];
				if ( occupied.has( [ x + dx, z + dz ] + '' ) ) continue;

				let part = side === 'S' ? walls.front : side === 'N' ? walls.back : walls.side;
				if ( side === 'S' && level === 0 && x === front[ 0 ][ 0 ] && z === front[ 0 ][ 1 ] ) part = walls.door;

				await placePart( document, resolve( dir, part + '.glb' ), [ x, level, z ], FACING[ side ] );

			}

		}

	}

	const top = spec.storeys.length;

	// Gable roofs run their ridge along x, the long side
	for ( const [ x, z ] of spec.cells ) await placePart( document, resolve( dir, spec.roof + '.glb' ), [ x, top, z ] );
	if ( spec.chimney ) await placePart( document, resolve( dir, 'chimney.glb' ), [ spec.cells[ spec.cells.length - 1 ][ 0 ], top - 0.6, 0 ] );
	if ( spec.extra ) await placePart( document, resolve( dir, spec.extra[ 0 ] + '.glb' ), spec.extra[ 1 ], spec.extra[ 2 ] );

	await document.transform( unpartition() );
	return document;

}

// The Racing Kit colours each part with its own material. Bake every colour
// into one generated palette texture (a 16 px swatch each) so its props
// draw like the colormap kits: one material, one draw.
const PALETTE_SIZE = 128, SWATCH = 16;
const palette = [];

function linearToSRGB( c ) {

	return Math.round( 255 * ( c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow( c, 1 / 2.4 ) - 0.055 ) );

}

function paletteIndex( color ) {

	const key = color.slice( 0, 3 ).map( linearToSRGB ).join( ',' );
	let i = palette.indexOf( key );
	if ( i < 0 ) i = palette.push( key ) - 1;
	if ( i >= ( PALETTE_SIZE / SWATCH ) ** 2 ) throw new Error( 'racing palette is full' );
	return i;

}

function bakePalette( document ) {

	const root = document.getRoot();
	const buffer = root.listBuffers()[ 0 ];
	const texture = document.createTexture( 'colormap-racing' ).setImage( PLACEHOLDER_PNG ).setMimeType( 'image/png' );
	const material = document.createMaterial( 'colormap' ).setBaseColorTexture( texture ).setRoughnessFactor( 1 ).setMetallicFactor( 0 );
	const perRow = PALETTE_SIZE / SWATCH;

	for ( const mesh of root.listMeshes() ) {

		for ( const prim of mesh.listPrimitives() ) {

			const i = paletteIndex( prim.getMaterial().getBaseColorFactor() );
			const u = ( ( i % perRow ) + 0.5 ) / perRow, v = ( Math.floor( i / perRow ) + 0.5 ) / perRow;
			const count = prim.getAttribute( 'POSITION' ).getCount();
			const uvs = new Float32Array( count * 2 );
			for ( let k = 0; k < count; k ++ ) uvs.set( [ u, v ], k * 2 );

			prim.setAttribute( 'TEXCOORD_0', document.createAccessor().setType( 'VEC2' ).setArray( uvs ).setBuffer( buffer ) );
			prim.setMaterial( material );

		}

	}

	for ( const m of root.listMaterials() ) if ( m !== material ) m.dispose();
	for ( const t of root.listTextures() ) if ( t !== texture ) t.dispose();

}

function writePalette() {

	const pixels = new Uint8Array( PALETTE_SIZE * PALETTE_SIZE * 4 ).fill( 255 );
	const perRow = PALETTE_SIZE / SWATCH;

	palette.forEach( ( key, i ) => {

		const rgb = key.split( ',' ).map( Number );
		const x0 = ( i % perRow ) * SWATCH, y0 = Math.floor( i / perRow ) * SWATCH;

		for ( let y = y0; y < y0 + SWATCH; y ++ ) for ( let x = x0; x < x0 + SWATCH; x ++ ) pixels.set( rgb, ( y * PALETTE_SIZE + x ) * 4 );

	} );

	mkdirSync( resolve( SRC, 'racing/Textures' ), { recursive: true } );
	writeFileSync( resolve( SRC, 'racing/Textures/colormap.png' ), writePNG( PALETTE_SIZE, PALETTE_SIZE, pixels ) );

}

// One material and one mesh where the model allows, origin at the middle of
// its footprint on the ground. Returns the footprint (kit units).
async function prepareScenery( document ) {

	const root = document.getRoot();
	const keep = root.listMaterials()[ 0 ];

	// Kenney's "colormap" and "colormap-specular" differ only in name
	for ( const mesh of root.listMeshes() ) {

		for ( const prim of mesh.listPrimitives() ) {

			const m = prim.getMaterial();
			if ( m !== keep && m.getBaseColorTexture() && keep.getBaseColorTexture() && m.getRoughnessFactor() === keep.getRoughnessFactor() && m.getMetallicFactor() === keep.getMetallicFactor() ) prim.setMaterial( keep );

		}

	}

	await document.transform( dedup(), flatten(), join( { keepNamed: false } ), prune( { keepLeaves: true, keepSolidTextures: true } ) );

	const scene = root.listScenes()[ 0 ];
	const { min, max } = getBounds( scene );
	const holder = document.createNode( 'scenery' ).setTranslation( [ - ( min[ 0 ] + max[ 0 ] ) / 2, - min[ 1 ], - ( min[ 2 ] + max[ 2 ] ) / 2 ] );
	for ( const child of scene.listChildren() ) holder.addChild( child );
	scene.addChild( holder );

	const r = ( v ) => Math.round( v * 1000 ) / 1000;
	return { w: r( max[ 0 ] - min[ 0 ] ), d: r( max[ 2 ] - min[ 2 ] ), h: r( max[ 1 ] - min[ 1 ] ) };

}

// Gravel versions of the track pieces: no walls, asphalt → dirt, kerbs →
// a tan verge. Faces are picked by which colormap swatch (16 columns × 4
// rows) they sample.
const GRAVEL = {
	'2,3': [ 1, 2 ], '3,3': [ 1, 2 ], '4,3': [ 1, 2 ], '5,3': [ 1, 2 ],
	'11,2': [ 0, 2 ], '11,3': [ 0, 2 ], '10,2': [ 0, 2 ], '10,3': [ 0, 2 ],
	'6,2': [ 14, 3 ], '7,2': [ 14, 3 ],
};
const WALL_SWATCHES = new Set( [ '8,3', '9,3' ] );

function gravelize( document ) {

	for ( const mesh of document.getRoot().listMeshes() ) {

		for ( const prim of mesh.listPrimitives() ) {

			const uv = prim.getAttribute( 'TEXCOORD_0' );
			const indices = prim.getIndices();
			const swatch = ( i ) => {

				const [ u, v ] = uv.getElement( i, [] );
				return [ Math.min( 15, Math.floor( u * 16 ) ), Math.min( 3, Math.floor( v * 4 ) ) ];

			};

			const kept = [];

			for ( let t = 0; t < indices.getCount(); t += 3 ) {

				const tri = [ indices.getScalar( t ), indices.getScalar( t + 1 ), indices.getScalar( t + 2 ) ];
				if ( ! WALL_SWATCHES.has( swatch( tri[ 0 ] ) + '' ) ) kept.push( ...tri );

			}

			for ( let i = 0; i < uv.getCount(); i ++ ) {

				const [ col, row ] = swatch( i );
				const to = GRAVEL[ col + ',' + row ];
				if ( ! to ) continue;

				const [ u, v ] = uv.getElement( i, [] );
				uv.setElement( i, [ u + ( to[ 0 ] - col ) / 16, v + ( to[ 1 ] - row ) / 4 ] );

			}

			indices.setArray( new Uint32Array( kept ) );

		}

	}

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

// Gravel track pieces (the bounds shrink: no walls)

for ( const id of [ 'track-straight', 'track-corner' ] ) {

	const document = await io.read( resolve( SRC, id + '.glb' ) );
	gravelize( document );
	placeholderTextures( document, 'starter' );
	report.push( [ id + '-gravel.glb', await compress( document, id, resolve( OUT, id + '-gravel.glb' ), { checkBounds: false } ) ] );

}

// Scenery kits, the Racing Kit's palette and the Fantasy Town prefabs

const PREFAB_PARTS = new Set( KITS.fantasy.models.slice( KITS.fantasy.models.indexOf( 'windmill' ) ) );
const scenery = {};

for ( const [ kit, def ] of Object.entries( KITS ) ) {

	mkdirSync( resolve( OUT, kit ), { recursive: true } );

	for ( const name of def.models ) {

		if ( kit === 'fantasy' && PREFAB_PARTS.has( name ) ) continue;

		const document = await io.read( resolve( SRC, kit, name + '.glb' ) );
		if ( kit === 'racing' ) bakePalette( document );
		else placeholderTextures( document, kit );

		scenery[ kit + '/' + name ] = { kit, ...await prepareScenery( document ) };
		report.push( [ kit + '/' + name + '.glb', await compress( document, name, resolve( OUT, kit, name + '.glb' ) ) ] );

	}

}

writePalette();

for ( const [ name, spec ] of Object.entries( PREFABS ) ) {

	const document = await buildPrefab( spec );
	placeholderTextures( document, 'fantasy' );
	scenery[ 'fantasy/' + name ] = { kit: 'fantasy', ...await prepareScenery( document ) };
	report.push( [ 'fantasy/' + name + '.glb', await compress( document, name, resolve( OUT, 'fantasy', name + '.glb' ) ) ] );

}

writeFileSync( resolve( ROOT, 'js/SceneryList.js' ),
	'// Generated by scripts/models.mjs; don\'t edit. Each scenery model\'s\n' +
	'// footprint (w along x, d along z) and height in its kit\'s units, with its\n' +
	'// origin at the middle of the footprint on the ground.\n\n' +
	'export const SCENERY = {\n' +
	Object.entries( scenery ).map( ( [ id, s ] ) => `\t'${ id }': { kit: '${ s.kit }', w: ${ s.w }, d: ${ s.d }, h: ${ s.h } },` ).join( '\n' ) +
	'\n};\n'
);

const order = [ ...Object.keys( STARTER_CARS ), ...Object.keys( KIT_CARS ) ];
cars.sort( ( a, b ) => order.indexOf( a.id ) - order.indexOf( b.id ) );

writeFileSync( resolve( ROOT, 'js/CarList.js' ),
	'// Generated by scripts/models.mjs from the models\' bounds; don\'t edit.\n' +
	'// length / width / height / centerZ are in world units (after the 0.5\n' +
	'// vehicle scale); mass is relative to the yellow truck (from the volume);\n' +
	'// bodyY is the body node\'s resting height in model units.\n\n' +
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
