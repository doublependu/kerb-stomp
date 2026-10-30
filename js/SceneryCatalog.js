import { SCENERY } from './SceneryList.js';

// What each scenery model is, read off the contact sheets (`npm run catalog`):
// its role, its height in metres at one scale across the kits, and its front.
// Every model that has a front has it on +z (seats, doors, shop fronts);
// 'any' is one that reads the same from every side.
//
// Heights: a truck is 0.7 m tall and a house 3–5 m, so a tree is 4–6 m, a
// grandstand 5–7.5 m (5.5 m wide, so a row joins up) and nothing but a
// landmark tops 8 m.
//
// The order is the model numbers in an edited layout's link (Scenery.js
// encodeLayout): append new models, never reorder or remove one.

const ROLES = {
	stand: [ [ 'racing/grandStand', 4.9 ], [ 'racing/grandStandCovered', 6.5 ], [ 'racing/grandStandAwning', 7.6 ], [ 'racing/grandStandCoveredRound', 6.5 ] ],
	pit: [ [ 'racing/pitsGarage', 3.8 ], [ 'racing/pitsGarageClosed', 3.8 ], [ 'racing/pitsOffice', 2.8 ] ],
	tower: [
		[ 'racing/control-tower', 11 ], [ 'racing/gantry', 6.9 ], [ 'industrial/chimney-large', 6.1, 'any' ], [ 'industrial/water-tower', 7.7, 'any' ],
		[ 'industrial/wind-farm', 8.3 ], [ 'fantasy/house-tower', 9.1 ], [ 'fantasy/house-windmill', 10.3 ],
	],
	building: [
		...[ 'a', 'b', 'c', 'd', 'g', 'k', 'm', 'p', 'r', 's', 't', 'f', 'l', 'n' ].map( ( l ) => [ 'industrial/building-' + l ] ),
		[ 'industrial/works' ], [ 'industrial/tank-farm' ],
		...[ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'l', 'n', 'o', 'q', 's', 't', 'u' ].map( ( l ) => [ 'suburban/building-type-' + l ] ),
		[ 'suburban/terrace' ], [ 'suburban/garden' ], [ 'suburban/park' ],
		[ 'fantasy/house-cottage' ], [ 'fantasy/house-tall' ], [ 'fantasy/house-long' ], [ 'fantasy/house-long-tall' ], [ 'fantasy/house-watermill' ],
		[ 'fantasy/market' ], [ 'fantasy/fountain-square' ],
		[ 'forest/lookout' ], [ 'forest/treehouse' ], [ 'forest/rope-bridge' ], [ 'forest/camp' ], [ 'forest/archery' ], [ 'forest/rock-pile' ],
	],
	tree: [
		[ 'racing/treeLarge', 5.5, 'any' ], [ 'racing/treeSmall', 4.2, 'any' ], [ 'suburban/tree-large', 4.5, 'any' ], [ 'suburban/tree-small', 3.4, 'any' ],
		[ 'fantasy/tree', 5, 'any' ], [ 'fantasy/tree-high', 5.8, 'any' ], [ 'forest/tree', 4.4, 'any' ], [ 'forest/tree-high', 5.9, 'any' ],
	],
	rock: [ [ 'fantasy/rock-large', 3, 'any' ], [ 'forest/rocks-low', 1.4, 'any' ], [ 'forest/stones', 1.2, 'any' ], [ 'forest/plant', 0.5, 'any' ] ],
	prop: [
		[ 'racing/tentLong', 3.2 ], [ 'industrial/detail-tank', 1.5 ], [ 'industrial/shipping-container-a', 1.3 ], [ 'industrial/shipping-container-b', 1.3 ],
		[ 'industrial/shipping-container-c', 1.3 ], [ 'industrial/solar-panel-landscape-group', 0.9 ], [ 'suburban/planter', 0.7 ],
		[ 'fantasy/stall-green', 3.2 ], [ 'fantasy/stall-red', 3.2 ], [ 'fantasy/cart', 1.4 ],
	],
	fence: [ [ 'suburban/fence-1x4', 1.1 ], [ 'suburban/fence-2x3', 1.1 ], [ 'fantasy/hedge-large', 1.6 ], [ 'forest/fence', 1 ], [ 'racing/barrierWall', 0.7 ] ],
	sign: [ [ 'racing/billboard', 4.2 ], [ 'racing/billboardLow', 2.6 ], [ 'racing/flagCheckers', 4.5 ], [ 'racing/bannerTowerRed', 5.5 ], [ 'racing/bannerTowerGreen', 5.5 ] ],
	light: [ [ 'racing/lightPostLarge', 5 ], [ 'fantasy/lantern', 3 ] ],
};

export const CATALOG = {};

for ( const [ role, models ] of Object.entries( ROLES ) ) {

	for ( const [ id, height = null, front = 'z' ] of models ) CATALOG[ id ] = { role, height, front };

}

// Metres tall in the game. Buildings without their own height stand at their
// kit's scale, in which the kit's parts fit each other.
const KIT_SCALE = { industrial: 3.6, suburban: 4.2, fantasy: 2.6, forest: 2.6, racing: 5.5 };

export const heightOf = ( id ) => ( CATALOG[ id ] && CATALOG[ id ].height ) || SCENERY[ id ].h * KIT_SCALE[ SCENERY[ id ].kit ];

// Metres per model unit
export const scaleOf = ( id ) => heightOf( id ) / SCENERY[ id ].h;

// A fixed number per model, for layouts in links
export const MODEL_IDS = Object.keys( CATALOG );
