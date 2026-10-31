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
// (`npm run sim -- --calibrate`; par is between the skill 0 and 0.25 laps:
// the best NPCs are now well beyond a keyboard player).
//
// ace: the first ace's lap in a first race here (Difficulty.ACES): 10%
// under plan_2's best NPC, which a player beat by 4 s, scaled down with
// everyone's laps on Suzuka and Bathurst when the ride got smooth (plan_4).
// The best NPC now laps 10–30% under that (ai[ 4 ]); lower ace toward it to
// make the aces harder.
//
// theme: the whole track's look (js/Scenery.js THEMES), its own: no two share
// one. Classic and the editor's tracks without a theme get the forest's
// landmarks only.
//
// heights: road height (m) at the centre of each layout cell, for hills (a
// crest is a cell higher than both neighbours). unsealed: [ first, last ]
// cell ranges of gravel road with no wall on the outside of the loop.
// Suzuka's back straight bridges its Degner–Hairpin link: the one place two
// passes share a cell (TrackPath.checkLayout).
//
// ramps: cells whose centre is a lip cars take off from (TakeOff.js): a crest
// with a straight after it, the longer the longer a flight can be. Suzuka's
// jumps its own crossing; Bathurst's kicks up near the top of Conrod Straight.

import { TRACK_CELLS, decodeCells } from './Track.js';
import { layoutCells, centerline } from './TrackPath.js';
import { CLASSIC_AI_LAPS, CLASSIC_ACE } from './Difficulty.js';

export const TRACKS = [
	{
		id: 'classic',
		name: 'Classic',
		inspiredBy: null,
		laps: 5,
		par: 14.8,
		ai: CLASSIC_AI_LAPS,
		ace: CLASSIC_ACE,
		cells: TRACK_CELLS,
		theme: 'forest',
	},
	{
		id: 'indianapolis',
		name: 'Indianapolis',
		inspiredBy: 'the Indianapolis oval: four left turns, two long straights, two short chutes',
		laps: 5,
		par: 16.4,
		ai: [ 20.07, 17.07, 14.1, 11.7, 11.42 ],
		ace: 12.4,
		layout: 'SSSL SSL SSSSSSSL SSL SSSS',
		heading: 'N',
		theme: 'stadium',
	},
	{
		id: 'monza',
		name: 'Monza',
		inspiredBy: 'Monza: the Rettifilo, Roggia and Ascari chicanes, Curva Grande, the Lesmos and Parabolica',
		laps: 3,
		par: 32.5,
		ai: [ 37.57, 33.27, 26.27, 20.18, 17.78 ],
		ace: 22.1,
		layout: 'SSSSS RL S R SS LR S R SS RL SSSS LR SS R SSSSS R SS',
		heading: 'N',
		theme: 'village',
	},
	{
		id: 'monaco',
		name: 'Monaco',
		inspiredBy: 'Monaco: Sainte Dévote, Casino, the Grand Hotel hairpin, the tunnel, the swimming pool and Rascasse',
		laps: 2,
		par: 37.2,
		ai: [ 40.48, 33.15, 26.87, 22.88, 19.33 ],
		ace: 22.7,
		layout: 'SS R S LR S R LSL SS R S R SSSSS LR S R SS RL SL R SSS R SS',
		heading: 'E',
		theme: 'suburb',
	},
	{
		id: 'suzuka',
		name: 'Suzuka',
		inspiredBy: 'Suzuka: the S-curves, Degner, the Hairpin, Spoon, 130R and the figure-8 crossover',
		laps: 2,
		par: 36.5,
		ai: [ 37.97, 32.83, 25.37, 21.18, 20.08 ],
		ace: 24.2,
		//       F  S  T1 S  T2 S-curves     Dunlop Degner 1        Degner 2  under the bridge  Hairpin   200R Spoon         back straight, over the bridge     130R chicane  last  S  S
		layout: 'S  S  R  S  R  L  R  S  S  S  L      R      S  S  S  R        S  S  S  S        L  S  L   R  S  L  S  L   S  S  S  S  S  S  L    R  L     R     S  S',
		heights: [ 0, 0, 0, 0, 0, 0.4, 0.9, 1.3, 1.5, 1.5, 1.3, 0.9, 0.5, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.6, 0.6, 0.6, 1.3, 2.6, 3.9, 3.5, 3.0, 2.1, 1.4, 0.7, 0.1, 0, 0, 0 ],
		ramps: [ 30 ],
		heading: 'E',
		theme: 'industrial',
	},
	{
		id: 'bathurst',
		name: 'Bathurst',
		inspiredBy: 'Mount Panorama, Bathurst: up the Mountain Straight and The Cutting, across the top past Skyline, down the Esses and the Dipper, and Conrod Straight',
		laps: 2,
		par: 29.5,
		ai: [ 34.33, 25.9, 21.48, 19.02, 17.6 ],
		ace: 21.5,
		//       F  S  Hell Mountain Straight  Griffins Cutting S  Reid Sulman McPhillamy Skyline S  Esses     Dipper S  Forrest  Conrod Straight          Chase Murray's S  S
		layout: 'S  S  L    S   S   S   S      R        L       S  L    R      L          R       S  L  R      L      S  L        S  S  S  S  S  S  S  S  R  L  S  L        S  S',
		heights: [ 0, 0, 0, 0.5, 1, 1.7, 2.4, 3, 3.8, 4.6, 5.2, 5.6, 5.9, 6, 6, 5, 4.2, 3.6, 3.2, 3, 2.2, 3.4, 2.4, 1.6, 1.0, 0.5, 0.2, 0, 0, 0, 0, 0, 0, 0 ],
		ramps: [ 21 ],
		unsealed: [ [ 12, 14 ] ],
		heading: 'E',
		theme: 'mountain',
	},
];

for ( const track of TRACKS ) {

	if ( track.layout ) track.cells = layoutCells( track.layout, track.heading );

}

// The centerline in driving order, with the height profile on hilly tracks
export function trackLine( track ) {

	return centerline( track.cells, undefined, { ordered: Boolean( track.layout ), heights: track.heights || null } );

}

// Scenery layouts committed for a track (the editor's "Copy layout"):
// js/layouts/<track id>.json, { "scenery": "…" }. These become that track's
// scenery for everyone. Vite only: Node's tools see the planner's.
const LAYOUTS = import.meta.glob ? import.meta.glob( './layouts/*.json', { eager: true, import: 'default' } ) : {};

const CLASSIC_LENGTH = centerline( TRACK_CELLS ).length;
const STORAGE_KEY = 'kerb.track';

export function getTrack( id ) {

	return TRACKS.find( ( t ) => t.id === id ) || null;

}

// The track for this page load: ?map= (a custom track from the editor), then
// ?track=, then the last one played. &scenery= is an edited layout (Scenery.js
// encodeLayout), on a built-in track it keeps the track and its records.
// &theme= is a custom track's.
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
				ace: CLASSIC_ACE * scale,
				raceable: line.closed && cells.length > 3,
				theme: params.get( 'theme' ) || undefined,
				scenery: params.get( 'scenery' ) || undefined,
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
	const committed = LAYOUTS[ `./layouts/${ track.id }.json` ];
	return { ...track, raceable: true, scenery: params.get( 'scenery' ) || ( committed && committed.scenery ) || undefined };

}

export function rememberTrack( id ) {

	try {

		localStorage.setItem( STORAGE_KEY, id );

	} catch {}

}
