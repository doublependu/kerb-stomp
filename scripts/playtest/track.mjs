// Track geometry for the bot: the game's own centerline code (js/TrackPath.js)
// plus a helper to encode custom loops the way the editor would.

import { encodeCells } from '../../js/Track.js';
import { CELL, centerline, Polyline, wrapAngle, cellExits, loopCells } from '../../js/TrackPath.js';

export { CELL, centerline, Polyline, wrapAngle, cellExits, encodeCells };

// Encode a loop given as grid cells in driving order; the finish goes on
// `finishIndex` (must be a straight). Returns the ?map= value.
export function encodeLoop( path, finishIndex ) {

	return encodeCells( loopCells( path, finishIndex ) );

}
