// Built-in tracks. Classic is the Starter Kit layout; the others are loosely
// modelled on real circuits, squeezed onto 90° pieces, in the real running
// direction and with the corners in the real order where the grid allows:
// Monza is exact up to the Lesmos, then has an extra kink before Ascari and
// a Parabolica split around the back straight; Monaco is exact up to the
// tunnel chicane, then Tabac turns the wrong way. Layout letters: see
// TrackPath.layoutPath (S straight, L / R corner, starting on the finish).
//
// laps: race length (aiming for 60–90 s races). par: an average keyboard
// player's lap (s), the NPCs' reference pace before the player has a best lap
// on the track. ai: an NPC's lap at full pace by skill 0, 0.25, 0.5, 0.75, 1
// (`npm run sim -- --calibrate`; par is about the skill 0.5 lap).
//
// aiLine: how much of the racing line NPCs take (RacingLine.js); on the
// oval, holding the tight inside line flat out costs them more than it saves.
//
// scenery: [ first cell, zone ] along the lap (js/Scenery.js), so each
// stretch looks like nowhere else on the track; variations: a kit's
// alternative colormap for this track.
//
// heights: road height (m) at the centre of each layout cell, for hills (a
// crest is a cell higher than both neighbours). unsealed: [ first, last ]
// cell ranges of gravel road with no wall on the outside of the loop.
// Suzuka's back straight bridges its Degner–Hairpin link: the one place two
// passes share a cell (TrackPath.checkLayout).

import { TRACK_CELLS, decodeCells } from './Track.js';
import { layoutCells, centerline } from './TrackPath.js';
import { CLASSIC_AI_LAPS } from './Difficulty.js';

export const TRACKS = [
	{
		id: 'classic',
		name: 'Classic',
		inspiredBy: null,
		laps: 5,
		par: 14.8,
		ai: CLASSIC_AI_LAPS,
		cells: TRACK_CELLS,
	},
	{
		id: 'indianapolis',
		name: 'Indianapolis',
		inspiredBy: 'the Indianapolis oval: four left turns, two long straights, two short chutes',
		laps: 5,
		par: 16.4,
		ai: [ 16.9, 15.33, 14.58, 14.07, 13.8 ],
		layout: 'SSSL SSL SSSSSSSL SSL SSSS',
		heading: 'N',
		aiLine: 0,
		scenery: [ [ 0, 'paddock' ], [ 3, 'suburb' ], [ 7, 'industrial' ], [ 14, 'forest' ], [ 18, 'paddock' ] ],
	},
	{
		id: 'monza',
		name: 'Monza',
		inspiredBy: 'Monza: the Rettifilo, Roggia and Ascari chicanes, Curva Grande, the Lesmos and Parabolica',
		laps: 3,
		par: 32.5,
		ai: [ 35.75, 31.87, 29.43, 27.9, 24.6 ],
		layout: 'SSSSS RL S R SS LR S R SS RL SSSS LR SS R SSSSS R SS',
		heading: 'N',
		scenery: [ [ 0, 'paddock' ], [ 5, 'forest' ], [ 11, 'village' ], [ 17, 'forest' ], [ 23, 'industrial' ], [ 28, 'forest' ], [ 33, 'paddock' ] ],
		variations: { fantasy: 'a' },
	},
	{
		id: 'monaco',
		name: 'Monaco',
		inspiredBy: 'Monaco: Sainte Dévote, Casino, the Grand Hotel hairpin, the tunnel, the swimming pool and Rascasse',
		laps: 2,
		par: 37.2,
		ai: [ 41.93, 38.0, 33.37, 27.32, 25.18 ],
		layout: 'SS R S LR S R LSL SS R S R SSSSS LR S R SS RL SL R SSS R SS',
		heading: 'E',
		scenery: [ [ 0, 'paddock' ], [ 2, 'suburb' ], [ 7, 'village' ], [ 13, 'suburb' ], [ 16, 'industrial' ], [ 27, 'village' ], [ 32, 'suburb' ] ],
		variations: { suburban: 'b', industrial: 'a' },
	},
	{
		id: 'suzuka',
		name: 'Suzuka',
		inspiredBy: 'Suzuka: the S-curves, Degner, the Hairpin, Spoon, 130R and the figure-8 crossover',
		laps: 2,
		par: 40.2,
		ai: [ 43.97, 39.03, 33.47, 32.15, 29.67 ],
		//       F  S  T1 S  T2 S-curves     Dunlop Degner 1        Degner 2  under the bridge  Hairpin   200R Spoon         back straight, over the bridge     130R chicane  last  S  S
		layout: 'S  S  R  S  R  L  R  S  S  S  L      R      S  S  S  R        S  S  S  S        L  S  L   R  S  L  S  L   S  S  S  S  S  S  L    R  L     R     S  S',
		heights: [ 0, 0, 0, 0, 0, 0.4, 0.9, 1.3, 1.5, 1.5, 1.3, 0.9, 0.5, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.6, 0.6, 0.6, 1.1, 1.9, 2.8, 3.5, 4.0, 2.6, 1.6, 0.7, 0.1, 0, 0, 0 ],
		heading: 'E',
		scenery: [ [ 0, 'paddock' ], [ 2, 'village' ], [ 10, 'forest' ], [ 16, 'industrial' ], [ 23, 'forest' ], [ 28, 'suburb' ], [ 34, 'paddock' ] ],
		variations: { suburban: 'c', industrial: 'c' },
	},
	{
		id: 'bathurst',
		name: 'Bathurst',
		inspiredBy: 'Mount Panorama, Bathurst: up the Mountain Straight and The Cutting, across the top past Skyline, down the Esses and the Dipper, and Conrod Straight',
		laps: 2,
		par: 33.6,
		ai: [ 40.97, 36.5, 34.45, 31.08, 27.27 ],
		//       F  S  Hell Mountain Straight  Griffins Cutting S  Reid Sulman McPhillamy Skyline S  Esses     Dipper S  Forrest  Conrod Straight          Chase Murray's S  S
		layout: 'S  S  L    S   S   S   S      R        L       S  L    R      L          R       S  L  R      L      S  L        S  S  S  S  S  S  S  S  R  L  S  L        S  S',
		heights: [ 0, 0, 0, 0.5, 1, 1.7, 2.4, 3, 3.8, 4.6, 5.2, 5.6, 5.9, 6, 6, 5, 4.2, 3.6, 3.2, 3, 2.8, 2.2, 1, 2.2, 0.8, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0 ],
		unsealed: [ [ 12, 14 ] ],
		heading: 'E',
		scenery: [ [ 0, 'paddock' ], [ 2, 'suburb' ], [ 7, 'forest' ], [ 20, 'industrial' ], [ 28, 'suburb' ] ],
		variations: { suburban: 'a' },
	},
];

for ( const track of TRACKS ) {

	if ( track.layout ) track.cells = layoutCells( track.layout, track.heading );

}

// The centerline in driving order, with the height profile on hilly tracks
export function trackLine( track ) {

	return centerline( track.cells, undefined, { ordered: Boolean( track.layout ), heights: track.heights || null } );

}

const CLASSIC_LENGTH = centerline( TRACK_CELLS ).length;
const STORAGE_KEY = 'kerb.track';

export function getTrack( id ) {

	return TRACKS.find( ( t ) => t.id === id ) || null;

}

// The track for this page load: ?map= (a custom track from the editor), then
// ?track=, then the last one played
export function resolveTrack( params ) {

	const map = params.get( 'map' );

	if ( map ) {

		try {

			const cells = decodeCells( map );
			const line = centerline( cells );

			// Scale Classic's times by length; a dead-end track has no race
			const scale = line.length / CLASSIC_LENGTH;

			return {
				id: map,
				name: 'Custom',
				custom: true,
				cells,
				laps: 3,
				par: TRACKS[ 0 ].par * scale,
				ai: CLASSIC_AI_LAPS.map( ( t ) => t * scale ),
				raceable: line.closed && cells.length > 3,
			};

		} catch {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	let id = params.get( 'track' );

	if ( ! getTrack( id ) ) {

		try {

			id = localStorage.getItem( STORAGE_KEY );

		} catch {}

	}

	const track = getTrack( id ) || TRACKS[ 0 ];
	return { ...track, raceable: true };

}

export function rememberTrack( id ) {

	try {

		localStorage.setItem( STORAGE_KEY, id );

	} catch {}

}
