// Just enough PNG for the model pipeline: read 8-bit RGB / RGBA images
// (Kenney's colormaps) and write RGBA ones (the generated palettes).

import { inflateSync, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] );

export function readPNG( buffer ) {

	let width = 0, height = 0, channels = 0;
	const data = [];

	for ( let o = 8; o < buffer.length; ) {

		const length = buffer.readUInt32BE( o );
		const type = buffer.toString( 'latin1', o + 4, o + 8 );
		const chunk = buffer.subarray( o + 8, o + 8 + length );

		if ( type === 'IHDR' ) {

			width = chunk.readUInt32BE( 0 );
			height = chunk.readUInt32BE( 4 );
			if ( chunk[ 8 ] !== 8 || chunk[ 12 ] !== 0 ) throw new Error( 'only 8-bit, non-interlaced PNGs' );
			channels = { 2: 3, 6: 4 }[ chunk[ 9 ] ];
			if ( ! channels ) throw new Error( 'only RGB / RGBA PNGs' );

		} else if ( type === 'IDAT' ) {

			data.push( chunk );

		}

		o += 12 + length;

	}

	const raw = inflateSync( Buffer.concat( data ) );
	const stride = width * channels;
	const pixels = new Uint8Array( width * height * 4 );
	const prev = new Uint8Array( stride ), line = new Uint8Array( stride );

	for ( let y = 0; y < height; y ++ ) {

		const filter = raw[ y * ( stride + 1 ) ];

		for ( let x = 0; x < stride; x ++ ) {

			const v = raw[ y * ( stride + 1 ) + 1 + x ];
			const a = x >= channels ? line[ x - channels ] : 0, b = prev[ x ], c = x >= channels ? prev[ x - channels ] : 0;
			let p = 0;

			if ( filter === 1 ) p = a;
			else if ( filter === 2 ) p = b;
			else if ( filter === 3 ) p = ( a + b ) >> 1;
			else if ( filter === 4 ) {

				const pa = Math.abs( b - c ), pb = Math.abs( a - c ), pc = Math.abs( a + b - 2 * c );
				p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;

			}

			line[ x ] = ( v + p ) & 255;

		}

		for ( let x = 0; x < width; x ++ ) {

			for ( let k = 0; k < 4; k ++ ) pixels[ ( y * width + x ) * 4 + k ] = k < channels ? line[ x * channels + k ] : 255;

		}

		prev.set( line );

	}

	return { width, height, pixels };

}

const CRC_TABLE = new Uint32Array( 256 ).map( ( _, n ) => {

	let c = n;
	for ( let k = 0; k < 8; k ++ ) c = c & 1 ? 0xedb88320 ^ ( c >>> 1 ) : c >>> 1;
	return c >>> 0;

} );

function crc32( buffer ) {

	let c = 0xffffffff;
	for ( const byte of buffer ) c = CRC_TABLE[ ( c ^ byte ) & 255 ] ^ ( c >>> 8 );
	return ( c ^ 0xffffffff ) >>> 0;

}

function chunk( type, data ) {

	const head = Buffer.alloc( 8 );
	head.writeUInt32BE( data.length, 0 );
	head.write( type, 4, 'latin1' );
	const crc = Buffer.alloc( 4 );
	crc.writeUInt32BE( crc32( Buffer.concat( [ head.subarray( 4 ), data ] ) ) );
	return Buffer.concat( [ head, data, crc ] );

}

export function writePNG( width, height, pixels ) {

	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( width, 0 );
	header.writeUInt32BE( height, 4 );
	header[ 8 ] = 8; // bit depth
	header[ 9 ] = 6; // RGBA

	const raw = Buffer.alloc( height * ( width * 4 + 1 ) );

	for ( let y = 0; y < height; y ++ ) {

		raw[ y * ( width * 4 + 1 ) ] = 0;
		Buffer.from( pixels.buffer, pixels.byteOffset + y * width * 4, width * 4 ).copy( raw, y * ( width * 4 + 1 ) + 1 );

	}

	return Buffer.concat( [ SIGNATURE, chunk( 'IHDR', header ), chunk( 'IDAT', deflateSync( raw, { level: 9 } ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] );

}
