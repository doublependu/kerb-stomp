// Copy the scenery models the game uses from Kenney's kits (unzipped into
// ref/, which isn't committed) into models/src/<kit>/, with each kit's
// colormap, colour variations and licence. Run once per kit update, then
// `npm run models`.
//
//   npm run kits

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve( import.meta.dirname, '..' );

// models: placed on their own. parts: only built into the prefabs
// (scripts/models.mjs), not shipped.
export const KITS = {
	industrial: {
		dir: 'kenney_city-kit-industrial_2.0',
		models: [
			'building-a', 'building-b', 'building-c', 'building-d', 'building-g', 'building-k', 'building-m', 'building-p',
			'building-r', 'building-s', 'building-t', 'building-f', 'building-l', 'building-n', 'chimney-large', 'detail-tank',
			'shipping-container-a', 'shipping-container-b', 'shipping-container-c', 'solar-panel-landscape-group', 'water-tower',
		],
		parts: [ 'building-e', 'chimney-medium', 'chimney-small', 'detail-tank-large', 'windmill', 'windmill-low' ],
	},
	suburban: {
		dir: 'kenney_city-kit-suburban_20',
		models: [
			'building-type-a', 'building-type-b', 'building-type-c', 'building-type-d', 'building-type-e', 'building-type-f',
			'building-type-g', 'building-type-h', 'building-type-j', 'building-type-l', 'building-type-n', 'building-type-o',
			'building-type-q', 'building-type-s', 'building-type-t', 'building-type-u', 'fence-1x4', 'fence-2x3', 'planter',
			'tree-large', 'tree-small',
		],
		parts: [ 'building-type-k', 'building-type-m', 'building-type-r', 'path-stones-long', 'driveway-long', 'fence-low' ],
	},
	fantasy: {
		dir: 'kenney_fantasy-town-kit_2.0',
		models: [
			'stall-green', 'stall-red', 'cart', 'lantern', 'tree', 'tree-high', 'rock-large', 'hedge-large',
		],
		// The prefab houses, the market and the fountain square
		parts: [
			'windmill', 'watermill', 'wall', 'wall-door', 'wall-window-shutters', 'wall-window-small', 'wall-wood', 'wall-wood-window-shutters',
			'wall-wood-door', 'roof-gable', 'roof-point', 'chimney', 'stall', 'fountain-round', 'banner-red', 'banner-green',
		],
	},
	forest: {
		dir: 'kenney_mini-forest_1.0',
		models: [ 'tree', 'tree-high', 'rocks-low', 'stones', 'fence', 'plant' ],
		// The lookouts, the bridge, the camp, the archery range, the rocks
		parts: [ 'rocks-high', 'tent', 'flag', 'building-structure', 'building-platform', 'building-roof', 'ladder', 'bridge', 'target', 'patch-dirt', 'patch-grass' ],
	},
	// The 2018 Racing Kit has flat per-material colours instead of a colormap;
	// scripts/models.mjs bakes them into a generated palette
	racing: {
		dir: 'kenney_racing-kit',
		format: 'GLTF format',
		colormap: false,
		models: [
			'grandStand', 'grandStandCovered', 'grandStandAwning', 'grandStandCoveredRound', 'pitsGarage', 'pitsGarageClosed', 'pitsOffice',
			'bannerTowerRed', 'bannerTowerGreen', 'lightPostLarge', 'billboard', 'billboardLow', 'tentLong', 'flagCheckers', 'barrierWall',
			'treeLarge', 'treeSmall',
		],
		parts: [ 'pitsOfficeRoof', 'radarEquipment', 'flagRed', 'flagGreen', 'overheadRoundColored' ],
	},
};

function copyKit( id, kit ) {

	const source = resolve( ROOT, 'ref', kit.dir );
	if ( ! existsSync( source ) ) throw new Error( `${ id }: unzip ${ kit.dir } into ref/ first` );

	const models = join( source, 'Models', kit.format || 'GLB format' );
	const out = resolve( ROOT, 'models/src', id );
	mkdirSync( out, { recursive: true } );

	const names = [ ...kit.models, ...kit.parts || [] ];
	for ( const file of readdirSync( out ) ) if ( file.endsWith( '.glb' ) && ! names.includes( file.slice( 0, - 4 ) ) ) rmSync( join( out, file ) );
	for ( const name of names ) copyFileSync( join( models, name + '.glb' ), join( out, name + '.glb' ) );

	copyFileSync( join( source, 'License.txt' ), join( out, 'License.txt' ) );

	if ( kit.colormap !== false ) {

		mkdirSync( join( out, 'Textures' ), { recursive: true } );
		copyFileSync( join( models, 'Textures', 'colormap.png' ), join( out, 'Textures', 'colormap.png' ) );

		const variations = join( source, 'Models', 'Textures' );
		if ( existsSync( variations ) ) for ( const file of readdirSync( variations ) ) copyFileSync( join( variations, file ), join( out, 'Textures', file ) );

	}

	console.log( `${ id.padEnd( 11 ) } ${ kit.models.length } models, ${ ( kit.parts || [] ).length } parts` );

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	for ( const [ id, kit ] of Object.entries( KITS ) ) copyKit( id, kit );

}
