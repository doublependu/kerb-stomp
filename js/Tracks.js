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

import { TRACK_CELLS, decodeCells } from './Track.js';
import { layoutCells, centerline } from './TrackPath.js';
import { CLASSIC_AI_LAPS } from './Difficulty.js';

export const TRACKS = [
	{
		id: 'classic',
		name: 'Classic',
		inspiredBy: null,
		laps: 5,
		par: 14.5,
		ai: CLASSIC_AI_LAPS,
		cells: TRACK_CELLS,
	},
	{
		id: 'indianapolis',
		name: 'Indianapolis',
		inspiredBy: 'the Indianapolis oval: four left turns, two long straights, two short chutes',
		laps: 5,
		par: 16.3,
		ai: [ 19.33, 16.98, 16.28, 15.25, 14.05 ],
		layout: 'SSSL SSL SSSSSSSL SSL SSSS',
		heading: 'N',
	},
	{
		id: 'monza',
		name: 'Monza',
		inspiredBy: 'Monza: the Rettifilo, Roggia and Ascari chicanes, Curva Grande, the Lesmos and Parabolica',
		laps: 3,
		par: 30,
		ai: [ 38.63, 34.05, 30.02, 28.32, 26.05 ],
		layout: 'SSSSS RL S R SS LR S R SS RL SSSS LR SS R SSSSS R SS',
		heading: 'N',
	},
	{
		id: 'monaco',
		name: 'Monaco',
		inspiredBy: 'Monaco: Sainte Dévote, Casino, the Grand Hotel hairpin, the tunnel, the swimming pool and Rascasse',
		laps: 2,
		par: 35,
		ai: [ 47.7, 39.85, 34.93, 31.53, 28.42 ],
		layout: 'SS R S LR S R LSL SS R S R SSSSS LR S R SS RL SL R SSS R SS',
		heading: 'E',
	},
];

for ( const track of TRACKS ) {

	if ( track.layout ) track.cells = layoutCells( track.layout, track.heading );

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
