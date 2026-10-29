// How fast the opponents are. Their target lap times are spread around a
// reference pace: the player's best lap on this track, or before there is
// one, the track's par (an average keyboard player). From a little quicker
// than the reference to a fair bit slower, so a few of the field are faster
// than the player's best and most are slower. Race laps include a standing
// start and traffic, so a player near their best usually fights for 1st–2nd,
// and as they improve the field speeds up with them, mid-race included
// (Race.aimField): a fast player's first race isn't a walkover.
//
// Each NPC starts at the skill whose lap matches its target (the track's
// calibration), Race.js corrects the skill lap by lap (pace is the coarse
// knob: on tight tracks a lower top speed barely changes lap time), and adds
// a mild rubber band.

export const SPREAD = [ 1.0, 1.18 ];
export const RUBBER_BAND = 0.04;

// NPC lap at full pace by skill 0, 0.25, 0.5, 0.75, 1 on Classic, from
// `npm run sim -- --calibrate`. Tracks carry their own (Tracks.js); custom
// ones scale Classic's by centerline length.
export const CLASSIC_AI_LAPS = [ 16.5, 15.55, 14.33, 12.67, 11.58 ];

const clamp = ( v, lo, hi ) => Math.max( lo, Math.min( hi, v ) );

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

	return { skill: skillFor( target, laps ), pace: clamp( laps[ 0 ] / target, 0.6, 1 ) };

}

// Between laps: move skill toward the target lap time (the span of laps over
// the skill range is ~35%, so a 5% miss moves skill by ~0.13); once skill
// bottoms out, slow down with pace instead
export function correct( driver, lap, target ) {

	const error = ( lap - target ) / target;
	driver.setSkill( driver.skill + 2.5 * error );
	if ( driver.skill === 0 && error < 0 ) driver.pace = clamp( driver.pace * ( 1 + error ), 0.6, 1 );
	else if ( error > 0 ) driver.pace = clamp( driver.pace * ( 1 + error ), 0.6, 1 );

}
