// How fast the opponents are. Their target lap times are spread around a
// reference pace: the player's best lap on this track, or before there is
// one, the track's par (an average keyboard player). From a bit quicker than
// the reference to somewhat slower, so a third of the field are faster than
// the player's best. Race laps include a standing start and traffic, so a
// player near their best fights for the podium, and as they improve the
// field speeds up with them (Race.aimField). The spread leans a little by
// how good that best lap is: a few % kinder to a novice, harder on an expert.
//
// Each NPC starts at the skill whose lap matches its target (the track's
// calibration), Race.js corrects the skill lap by lap, and adds a rubber
// band: NPCs the player has got ahead of push harder than leaders ease off.

export const SPREAD = [ 0.95, 1.12 ];
export const SKILL_LEAN = { novice: 0.06, expert: 0.03 };
const EXPERT_LAP = 0.78; // an expert's lap, as a share of par
export const RUBBER_BAND = { behind: 0.06, ahead: 0.03 };

// A first lap includes the standing start: this much of it counts as the
// flying lap the field is aimed at
export const FIRST_LAP = 0.92;

// A first race on a track is aimed this much slower than par until the
// player's first lap re-aims it (on a two-lap track that's half the race)
export const FIRST_RACE = 1.06;

// Except the two fastest of that field, the aces: held at the track's ace
// lap (Tracks.js) and 5% slower than it, whatever the player does (no rubber
// band; lap correction only toward that), so the first race takes a quick
// lap to win. They also race harder (AIDriver: ace).
export const ACES = [ 1, 1.05 ];

// Classic's ace lap (s); custom tracks scale it by centerline length
export const CLASSIC_ACE = 10.2;

// NPC lap at full pace by skill 0, 0.25, 0.5, 0.75, 1 on Classic, from
// `npm run sim -- --calibrate`. Tracks carry their own (Tracks.js); custom
// ones scale Classic's by centerline length.
export const CLASSIC_AI_LAPS = [ 16.17, 12.87, 10.72, 8.7, 8.07 ];

const clamp = ( v, lo, hi ) => Math.max( lo, Math.min( hi, v ) );

// Slowest an NPC's speeds go (pace) when even skill 0 is too quick
const PACE_MIN = 0.45;

// Pace for a lap this many times skill 0's: a skill-0 driver is held up
// in the corners, so cutting its top speed adds less than proportionally
// (the median over the tracks, `npm run sim -- --pace-curve`)
const PACE_CURVE = [ [ 1, 1 ], [ 1.045, 0.85 ], [ 1.21, 0.7 ], [ 1.39, 0.55 ], [ 1.6, 0.45 ] ];

function paceFor( ratio ) {

	if ( ratio <= 1 ) return 1;

	for ( let i = 1; i < PACE_CURVE.length; i ++ ) {

		const [ r1, p1 ] = PACE_CURVE[ i ], [ r0, p0 ] = PACE_CURVE[ i - 1 ];
		if ( ratio <= r1 ) return p0 + ( p1 - p0 ) * ( ratio - r0 ) / ( r1 - r0 );

	}

	return PACE_MIN;

}

// The skill whose full-pace lap is `target` (laps fall as skill rises)
export function skillFor( target, laps ) {

	if ( target >= laps[ 0 ] ) return 0;

	for ( let i = 1; i < laps.length; i ++ ) {

		if ( target >= laps[ i ] ) {

			const t = ( laps[ i - 1 ] - target ) / ( laps[ i - 1 ] - laps[ i ] );
			return ( i - 1 + t ) / ( laps.length - 1 );

		}

	}

	return 1;

}

// How much easier (+) or harder (−) the field is for this reference lap:
// up to +6% at the track's par (an average keyboard player) or slower, down
// to −3% at EXPERT_LAP of par or faster
export function lean( reference, par ) {

	const t = clamp( ( 1 - reference / par ) / ( 1 - EXPERT_LAP ), 0, 1 );
	return SKILL_LEAN.novice + ( - SKILL_LEAN.expert - SKILL_LEAN.novice ) * t;

}

// count NPCs → [ { factor, aggression } ], slowest first (the grid order,
// front to back). factor: the NPC's target lap as a multiple of the reference.
export function planField( count, random ) {

	const field = [];

	for ( let i = 0; i < count; i ++ ) {

		const f = count === 1 ? 1.04 : SPREAD[ 0 ] + ( SPREAD[ 1 ] - SPREAD[ 0 ] ) * i / ( count - 1 );
		field.push( { factor: f * ( 1 + ( random() - 0.5 ) * 0.04 ), aggression: random() } );

	}

	return field.sort( ( a, b ) => b.factor - a.factor );

}

// Where a driver aiming for `target` starts, from the track's calibration
// (see above). Targets slower than the slowest driver's lap get a lower pace
// instead.
export function startFor( target, laps ) {

	return { skill: skillFor( target, laps ), pace: clamp( paceFor( target / laps[ 0 ] ), PACE_MIN, 1 ) };

}

// Between laps: move skill toward the target lap time (the span of laps over
// the skill range is ~35%, so a 5% miss moves skill by ~0.13); once skill
// bottoms out, slow down with pace instead
export function correct( driver, lap, target ) {

	const error = ( lap - target ) / target;
	driver.setSkill( driver.skill + 2.5 * error );
	// (pace moves lap time about a third as much as it changes)
	if ( driver.skill === 0 && error < 0 ) driver.pace = clamp( driver.pace * ( 1 + 2.5 * error ), PACE_MIN, 1 );
	else if ( error > 0 ) driver.pace = clamp( driver.pace * ( 1 + 2.5 * error ), PACE_MIN, 1 );

}
