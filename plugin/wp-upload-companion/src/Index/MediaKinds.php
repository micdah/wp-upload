<?php
/**
 * MIME type → media kind (server-api.md §5). The numeric code is the position
 * in `MEDIA_KINDS` (shared/library-api.ts), so the order is frozen.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Index;

final class MediaKinds {

	public const IMAGE    = 0;
	public const SVG      = 1;
	public const VIDEO    = 2;
	public const AUDIO    = 3;
	public const DOCUMENT = 4;
	public const ARCHIVE  = 5;
	public const OTHER    = 6;

	public const NAMES = array( 'image', 'svg', 'video', 'audio', 'document', 'archive', 'other' );

	/** `type` filter → kind codes (TYPE_FILTER_KINDS). */
	public const TYPE_FILTER_CODES = array(
		'image'    => array( self::IMAGE, self::SVG ),
		'video'    => array( self::VIDEO ),
		'audio'    => array( self::AUDIO ),
		'document' => array( self::DOCUMENT, self::ARCHIVE, self::OTHER ),
	);

	private const DOCUMENT_EXACT = array( 'application/pdf', 'application/rtf', 'application/msword' );

	private const DOCUMENT_PREFIXES = array(
		'text/',
		'application/vnd.ms-',
		'application/vnd.openxmlformats-officedocument.',
		'application/vnd.oasis.opendocument.',
		'application/vnd.apple.',
	);

	private const ARCHIVES = array(
		'application/zip',
		'application/x-zip-compressed',
		'application/x-rar-compressed',
		'application/vnd.rar',
		'application/x-7z-compressed',
		'application/gzip',
		'application/x-gzip',
		'application/x-tar',
	);

	public static function from_mime( string $mime ): int {
		$mime = strtolower( trim( $mime ) );
		if ( 'image/svg+xml' === $mime ) {
			return self::SVG;
		}
		if ( 0 === strpos( $mime, 'image/' ) ) {
			return self::IMAGE;
		}
		if ( 0 === strpos( $mime, 'video/' ) ) {
			return self::VIDEO;
		}
		if ( 0 === strpos( $mime, 'audio/' ) ) {
			return self::AUDIO;
		}
		if ( in_array( $mime, self::DOCUMENT_EXACT, true ) ) {
			return self::DOCUMENT;
		}
		foreach ( self::DOCUMENT_PREFIXES as $prefix ) {
			if ( 0 === strpos( $mime, $prefix ) ) {
				return self::DOCUMENT;
			}
		}
		if ( in_array( $mime, self::ARCHIVES, true ) ) {
			return self::ARCHIVE;
		}
		return self::OTHER;
	}

	public static function name( int $code ): string {
		return self::NAMES[ $code ] ?? 'other';
	}

	public static function is_image_like( int $code ): bool {
		return self::IMAGE === $code || self::SVG === $code;
	}

	/**
	 * The same mapping as a SQL CASE over a MIME column, for items that have
	 * no index row yet (plugin-api.md §5.2, `indexComplete: false`).
	 */
	public static function sql_case( string $mime_column ): string {
		$quote = static function ( array $values ): string {
			return "'" . implode( "','", $values ) . "'";
		};
		$document_prefixes = array();
		foreach ( self::DOCUMENT_PREFIXES as $prefix ) {
			$document_prefixes[] = "LOWER({$mime_column}) LIKE '{$prefix}%'";
		}
		return 'CASE'
			. " WHEN LOWER({$mime_column}) = 'image/svg+xml' THEN " . self::SVG
			. " WHEN LOWER({$mime_column}) LIKE 'image/%' THEN " . self::IMAGE
			. " WHEN LOWER({$mime_column}) LIKE 'video/%' THEN " . self::VIDEO
			. " WHEN LOWER({$mime_column}) LIKE 'audio/%' THEN " . self::AUDIO
			. " WHEN LOWER({$mime_column}) IN (" . $quote( self::DOCUMENT_EXACT ) . ') OR ' . implode( ' OR ', $document_prefixes ) . ' THEN ' . self::DOCUMENT
			. " WHEN LOWER({$mime_column}) IN (" . $quote( self::ARCHIVES ) . ') THEN ' . self::ARCHIVE
			. ' ELSE ' . self::OTHER . ' END';
	}
}
