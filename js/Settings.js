// Player choices that persist between visits: car, number of opponents and
// the touch control scheme. Storage can be unavailable (private windows,
// blocked site data), so every access is guarded and defaults stand in.

import { CARS, DEFAULT_CAR } from './CarList.js';

export const MAX_NPCS = 8;
const DEFAULT_NPCS = 4;

function read( key ) {

	try {

		return localStorage.getItem( key );

	} catch {

		return null;

	}

}

function write( key, value ) {

	try {

		localStorage.setItem( key, String( value ) );

	} catch {}

}

export class Settings {

	constructor() {

		const car = read( 'kerb.car' );
		this.hasCar = CARS.some( ( c ) => c.id === car );
		this.car = this.hasCar ? car : DEFAULT_CAR;

		const npcs = Number( read( 'kerb.npcs' ) ?? DEFAULT_NPCS );
		this.npcs = Number.isInteger( npcs ) && npcs >= 0 && npcs <= MAX_NPCS ? npcs : DEFAULT_NPCS;

		this.touch = read( 'kerb.touch' ) === 'pads' ? 'pads' : 'joystick';

	}

	setCar( id ) {

		this.car = id;
		this.hasCar = true;
		write( 'kerb.car', id );

	}

	setNpcs( count ) {

		this.npcs = Math.max( 0, Math.min( MAX_NPCS, count ) );
		write( 'kerb.npcs', this.npcs );

	}

	setTouch( scheme ) {

		this.touch = scheme;
		write( 'kerb.touch', scheme );

	}

}

// Best medal won per track (1 gold, 2 silver, 3 bronze), for the picker
export function loadMedals() {

	try {

		return JSON.parse( read( 'kerb.medals' ) || '{}' ) || {};

	} catch {

		return {};

	}

}

export function saveMedal( trackId, place ) {

	const medals = loadMedals();
	if ( medals[ trackId ] && medals[ trackId ] <= place ) return medals;
	medals[ trackId ] = place;
	write( 'kerb.medals', JSON.stringify( medals ) );
	return medals;

}
