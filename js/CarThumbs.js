// Car picker thumbnails: one sprite sheet (sprites/cars.webp, made by
// scripts/car-thumbs.mjs) with the cars of CarList.js in order, row by row.

import { CAR_THUMBS_URL } from './Assets.js';

export const THUMB = { width: 128, height: 96, columns: 6 };

// CSS background for car `index`, scaled to a `width`-px wide tile
export function thumbStyle( index, width ) {

	const scale = width / THUMB.width;
	const x = ( index % THUMB.columns ) * THUMB.width * scale;
	const y = Math.floor( index / THUMB.columns ) * THUMB.height * scale;

	return `background-image: url(${ CAR_THUMBS_URL }); background-size: ${ THUMB.width * THUMB.columns * scale }px auto; background-position: -${ x }px -${ y }px;`;

}
