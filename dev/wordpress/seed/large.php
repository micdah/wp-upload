<?php
/**
 * The `large` seed profile (implementation plan §5.4, spike X4). Run by `dev/run seed large`
 * through `wp eval-file`, always on top of the freshly restored `base` snapshot. Only the `perf`
 * suite uses it. Never shipped.
 *
 * What it creates, deterministically (its own random generator with a fixed seed, fixed dates,
 * explicit row ids):
 * - 36 real files (32 GD images in varied sizes and formats, plus the committed mp4, mp3, pdf and
 *   svg fixtures), each a regular attachment with generated sub-sizes;
 * - 50 000 attachments in total: the other 49 964 are synthetic rows inserted with SQL, each
 *   pointing at one of the real files (`_wp_attached_file` and `_wp_attachment_metadata` copied),
 *   with their own titles, dates from 2019 to mid-2026, alt text, captions, owners and parents;
 * - 300 FileBird folders (up to four levels deep), created through FileBird's own
 *   `Folder::newFolder()`, with about 70 % of the attachments assigned through
 *   `Folder::setFoldersForPosts()`, so FileBird's hooks fire (D17);
 * - 5 000 posts and pages, inserted with SQL, using the images in image blocks, galleries,
 *   classic `wp-image-N` markup and featured images.
 *
 * When the companion plugin is active, its maintenance step then runs until its indexes are
 * ready, so the snapshot holds a complete index and `perf` measures queries, not a backfill.
 *
 * The synthetic rows share files: never run a suite that deletes, replaces or edits files on
 * this profile.
 *
 * Arguments: <app user login> <author user login>
 */

if ( ! class_exists( '\FileBird\Model\Folder' ) ) {
	WP_CLI::error( 'FileBird must be active to seed folders. Run `dev/run variant filebird=on` or `dev/run up` first.' );
}

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

const WPU_LARGE_RANDOM_SEED       = 20261123;
const WPU_LARGE_ATTACHMENT_TOTAL  = 50000;
const WPU_LARGE_REAL_IMAGE_COUNT  = 32;
const WPU_LARGE_FOLDER_COUNT      = 300;
const WPU_LARGE_ASSIGNED_PERCENT  = 70;
const WPU_LARGE_POST_COUNT        = 5000;
const WPU_LARGE_FIRST_MEDIA_UTC   = '2019-01-02 08:00:00';
const WPU_LARGE_LAST_MEDIA_UTC    = '2026-06-28 18:00:00';
const WPU_LARGE_FIRST_POST_UTC    = '2019-02-01 09:00:00';
const WPU_LARGE_LAST_POST_UTC     = '2026-07-15 09:00:00';
const WPU_LARGE_INSERT_BATCH_ROWS = 500;
const WPU_LARGE_FIXTURES_DIR      = '/opt/wpu-fixtures';

$wpu_large_admin_id    = 1;
$wpu_large_app_user    = get_user_by( 'login', $args[0] ?? '' );
$wpu_large_author_user = get_user_by( 'login', $args[1] ?? '' );
if ( ! $wpu_large_app_user || ! $wpu_large_author_user ) {
	WP_CLI::error( 'Usage: wp eval-file large.php <app user login> <author user login>' );
}

/**
 * The seed's own generator, so nothing else in WordPress can shift the sequence.
 */
function wpu_large_random() {
	static $randomizer = null;
	if ( null === $randomizer ) {
		$randomizer = new \Random\Randomizer( new \Random\Engine\Mt19937( WPU_LARGE_RANDOM_SEED ) );
	}
	return $randomizer;
}

function wpu_large_int( $min, $max ) {
	return wpu_large_random()->getInt( $min, $max );
}

function wpu_large_pick( array $items ) {
	return $items[ wpu_large_int( 0, count( $items ) - 1 ) ];
}

function wpu_large_percent_chance( $percent ) {
	return wpu_large_int( 0, 99 ) < $percent;
}

/**
 * A timestamp at position $index of $count, spread evenly from $first to $last, plus jitter.
 */
function wpu_large_spread_timestamp( $index, $count, $first, $last ) {
	$start = strtotime( $first . ' UTC' );
	$span  = strtotime( $last . ' UTC' ) - $start;
	$step  = intdiv( $span, max( 1, $count ) );
	return $start + $index * $step + wpu_large_int( 0, max( 0, $step - 1 ) );
}

// ---------------------------------------------------------------------------------------------
// The real files.
// ---------------------------------------------------------------------------------------------

/**
 * Renders a simple gradient image with a large label, so each real file is recognisable.
 */
function wpu_large_render_image( $width, $height, $format, $label ) {
	$image = imagecreatetruecolor( $width, $height );
	$from  = array( wpu_large_int( 0, 255 ), wpu_large_int( 0, 255 ), wpu_large_int( 0, 255 ) );
	$to    = array( wpu_large_int( 0, 255 ), wpu_large_int( 0, 255 ), wpu_large_int( 0, 255 ) );
	for ( $y = 0; $y < $height; $y++ ) {
		$t     = $height > 1 ? $y / ( $height - 1 ) : 0;
		$color = imagecolorallocate(
			$image,
			(int) round( $from[0] + ( $to[0] - $from[0] ) * $t ),
			(int) round( $from[1] + ( $to[1] - $from[1] ) * $t ),
			(int) round( $from[2] + ( $to[2] - $from[2] ) * $t )
		);
		imageline( $image, 0, $y, $width - 1, $y, $color );
	}

	$label_width  = strlen( $label ) * 9 + 8;
	$label_height = 22;
	$label_image  = imagecreatetruecolor( $label_width, $label_height );
	imagefilledrectangle( $label_image, 0, 0, $label_width, $label_height, imagecolorallocate( $label_image, 20, 20, 24 ) );
	imagestring( $label_image, 5, 4, 3, $label, imagecolorallocate( $label_image, 245, 245, 245 ) );
	$scale = max( 1, (int) floor( $width * 0.6 / $label_width ) );
	imagecopyresized(
		$image,
		$label_image,
		(int) ( ( $width - $label_width * $scale ) / 2 ),
		(int) ( ( $height - $label_height * $scale ) / 2 ),
		0,
		0,
		$label_width * $scale,
		$label_height * $scale,
		$label_width,
		$label_height
	);
	imagedestroy( $label_image );

	ob_start();
	if ( 'png' === $format ) {
		imagepng( $image, null, 6 );
	} elseif ( 'webp' === $format ) {
		imagewebp( $image, null, 80 );
	} else {
		imagejpeg( $image, null, 85 );
	}
	imagedestroy( $image );
	return ob_get_clean();
}

/**
 * Writes one real file and inserts it as a regular attachment with sub-sizes.
 *
 * @return array{id: int, mime: string, kind: string}
 */
function wpu_large_insert_real_file( $filename, $bytes, $title, $timestamp ) {
	$upload = wp_upload_bits( $filename, null, $bytes, gmdate( 'Y/m', $timestamp ) );
	if ( ! empty( $upload['error'] ) ) {
		WP_CLI::error( "Could not write $filename: {$upload['error']}" );
	}
	$filetype = wp_check_filetype( $upload['file'] );
	$date     = gmdate( 'Y-m-d H:i:s', $timestamp );
	$id       = wp_insert_attachment(
		array(
			'post_mime_type' => $filetype['type'],
			'post_title'     => $title,
			'post_status'    => 'inherit',
			'post_author'    => 1,
			'post_date'      => $date,
			'post_date_gmt'  => $date,
			'guid'           => $upload['url'],
		),
		$upload['file'],
		0,
		true
	);
	if ( is_wp_error( $id ) ) {
		WP_CLI::error( $id );
	}
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $upload['file'] ) );
	return array(
		'id'   => $id,
		'mime' => $filetype['type'],
	);
}

/**
 * The 36 real files, in a fixed order. Returns their attachment ids by kind.
 *
 * @return array<string, int[]> kind => attachment ids
 */
function wpu_large_create_real_files() {
	$ratios     = array( array( 1, 1 ), array( 4, 3 ), array( 3, 4 ), array( 3, 2 ), array( 2, 3 ), array( 16, 9 ), array( 9, 16 ), array( 21, 9 ) );
	$long_edges = array( 800, 1200, 1600 );
	$formats    = array( 'jpg', 'jpg', 'jpg', 'png', 'webp' );
	$by_kind    = array(
		'image'    => array(),
		'video'    => array(),
		'audio'    => array(),
		'document' => array(),
		'svg'      => array(),
	);
	$first      = strtotime( '2018-12-01 08:00:00 UTC' );

	for ( $index = 0; $index < WPU_LARGE_REAL_IMAGE_COUNT; $index++ ) {
		$ratio     = $ratios[ $index % count( $ratios ) ];
		$long_edge = $long_edges[ $index % count( $long_edges ) ];
		$format    = $formats[ $index % count( $formats ) ];
		if ( $ratio[0] >= $ratio[1] ) {
			$width  = $long_edge;
			$height = (int) round( $long_edge * $ratio[1] / $ratio[0] );
		} else {
			$height = $long_edge;
			$width  = (int) round( $long_edge * $ratio[0] / $ratio[1] );
		}
		$number = sprintf( '%02d', $index + 1 );
		$bytes  = wpu_large_render_image( $width, $height, $format, "large #$number {$ratio[0]}:{$ratio[1]} $format" );
		$file   = wpu_large_insert_real_file( "large-source-$number.$format", $bytes, "Large source $number", $first + $index * 3600 );
		$by_kind['image'][] = $file['id'];
	}

	$fixtures = array(
		array( 'sample.mp4', 'video' ),
		array( 'sample.mp3', 'audio' ),
		array( 'sample.pdf', 'document' ),
		array( 'sample.svg', 'svg' ),
	);
	foreach ( $fixtures as $position => $fixture ) {
		list( $file_name, $kind ) = $fixture;
		$bytes                    = file_get_contents( WPU_LARGE_FIXTURES_DIR . '/' . $file_name ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		$extension                = pathinfo( $file_name, PATHINFO_EXTENSION );
		$file                     = wpu_large_insert_real_file( "large-source-$kind.$extension", $bytes, "Large source $kind", $first + ( 100 + $position ) * 3600 );
		$by_kind[ $kind ][]       = $file['id'];
	}
	return $by_kind;
}

// ---------------------------------------------------------------------------------------------
// Bulk inserts.
// ---------------------------------------------------------------------------------------------

/**
 * Inserts rows with multi-row INSERT statements, in batches.
 *
 * @param string   $table   Table name.
 * @param string[] $columns Column names.
 * @param string[] $formats One $wpdb placeholder per column.
 * @param array[]  $rows    Rows, each a list of values in column order.
 */
function wpu_large_insert_rows( $table, array $columns, array $formats, array $rows ) {
	global $wpdb;
	$row_placeholder = '(' . implode( ',', $formats ) . ')';
	$column_list     = '`' . implode( '`,`', $columns ) . '`';
	foreach ( array_chunk( $rows, WPU_LARGE_INSERT_BATCH_ROWS ) as $batch ) {
		$values = array();
		foreach ( $batch as $row ) {
			$values[] = $wpdb->prepare( $row_placeholder, $row ); // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
		$result = $wpdb->query( "INSERT INTO `$table` ($column_list) VALUES " . implode( ',', $values ) );
		if ( false === $result ) {
			WP_CLI::error( "Insert into $table failed: {$wpdb->last_error}" );
		}
	}
}

/**
 * The wp_posts columns every inserted row sets, with their placeholders.
 */
function wpu_large_post_columns() {
	return array(
		'columns' => array( 'ID', 'post_author', 'post_date', 'post_date_gmt', 'post_content', 'post_title', 'post_excerpt', 'post_status', 'comment_status', 'ping_status', 'post_password', 'post_name', 'to_ping', 'pinged', 'post_modified', 'post_modified_gmt', 'post_content_filtered', 'post_parent', 'guid', 'menu_order', 'post_type', 'post_mime_type', 'comment_count' ),
		'formats' => array( '%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%d', '%s', '%s', '%d' ),
	);
}

function wpu_large_post_row( $id, $author, $timestamp, $content, $title, $excerpt, $status, $name, $parent, $guid, $type, $mime ) {
	$date = gmdate( 'Y-m-d H:i:s', $timestamp );
	return array( $id, $author, $date, $date, $content, $title, $excerpt, $status, 'attachment' === $type ? 'open' : 'closed', 'closed', '', $name, '', '', $date, $date, '', $parent, $guid, 0, $type, $mime, 0 );
}

// ---------------------------------------------------------------------------------------------
// Synthetic attachments.
// ---------------------------------------------------------------------------------------------

/**
 * Picks which real file a synthetic attachment points at: mostly images.
 */
function wpu_large_pick_source_kind() {
	$roll = wpu_large_int( 0, 99 );
	if ( $roll < 88 ) {
		return 'image';
	}
	if ( $roll < 92 ) {
		return 'video';
	}
	if ( $roll < 95 ) {
		return 'audio';
	}
	if ( $roll < 99 ) {
		return 'document';
	}
	return 'svg';
}

/**
 * Inserts the synthetic attachments and their meta. Returns their ids by kind.
 *
 * @return array<string, int[]>
 */
function wpu_large_create_synthetic_attachments( array $real_by_kind, $first_id, $count, $first_post_id, array $owners ) {
	global $wpdb;
	$adjectives = array( 'Quiet', 'Golden', 'Misty', 'Bright', 'Hidden', 'Crimson', 'Silver', 'Wild', 'Calm', 'Distant', 'Frosty', 'Sunny', 'Blå', 'Grøn', 'Rusty', 'Velvet' );
	$nouns      = array( 'harbour', 'meadow', 'skyline', 'bicycle', 'lantern', 'orchard', 'bridge', 'forest', 'market', 'lighthouse', 'canyon', 'garden', 'studio', 'portrait', 'workshop', 'fjord', 'smørrebrød', 'invoice', 'brochure', 'podcast' );

	$sources = array();
	foreach ( $real_by_kind as $kind => $ids ) {
		foreach ( $ids as $id ) {
			$sources[ $kind ][] = array(
				'id'       => $id,
				'file'     => get_post_meta( $id, '_wp_attached_file', true ),
				// The raw serialized value, copied as it is.
				'metadata' => $wpdb->get_var( $wpdb->prepare( "SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id = %d AND meta_key = '_wp_attachment_metadata'", $id ) ),
				'mime'     => get_post_mime_type( $id ),
				'guid'     => get_post_field( 'guid', $id ),
			);
		}
	}

	$post_columns = wpu_large_post_columns();
	$ids_by_kind  = array();
	$progress     = WP_CLI\Utils\make_progress_bar( 'Inserting synthetic attachments', $count );
	for ( $offset = 0; $offset < $count; $offset += WPU_LARGE_INSERT_BATCH_ROWS ) {
		$post_rows = array();
		$meta_rows = array();
		$end       = min( $count, $offset + WPU_LARGE_INSERT_BATCH_ROWS );
		for ( $index = $offset; $index < $end; $index++ ) {
			$id     = $first_id + $index;
			$kind   = wpu_large_pick_source_kind();
			$source = wpu_large_pick( $sources[ $kind ] );
			$number = sprintf( '%05d', $index + 1 );
			$title  = wpu_large_pick( $adjectives ) . ' ' . wpu_large_pick( $nouns ) . ' ' . $number;
			$roll   = wpu_large_int( 0, 99 );
			$owner  = $roll < 93 ? $owners['admin'] : ( $roll < 98 ? $owners['app'] : $owners['author'] );
			$parent = wpu_large_percent_chance( 15 ) ? $first_post_id + wpu_large_int( 0, WPU_LARGE_POST_COUNT - 1 ) : 0;
			$is_pic = 'image' === $kind || 'svg' === $kind;

			$post_rows[] = wpu_large_post_row(
				$id,
				$owner,
				wpu_large_spread_timestamp( $index, $count, WPU_LARGE_FIRST_MEDIA_UTC, WPU_LARGE_LAST_MEDIA_UTC ),
				wpu_large_percent_chance( 10 ) ? "A longer description of $title, for search tests." : '',
				$title,
				wpu_large_percent_chance( 20 ) ? "Caption for $title" : '',
				'inherit',
				'large-media-' . $number,
				$parent,
				$source['guid'],
				'attachment',
				$source['mime']
			);
			$meta_rows[] = array( $id, '_wp_attached_file', $source['file'] );
			$meta_rows[] = array( $id, '_wp_attachment_metadata', $source['metadata'] );
			if ( $is_pic && wpu_large_percent_chance( 60 ) ) {
				$meta_rows[] = array( $id, '_wp_attachment_image_alt', "$title, seen up close" );
			}
			$ids_by_kind[ $kind ][] = $id;
		}
		wpu_large_insert_rows( $wpdb->posts, $post_columns['columns'], $post_columns['formats'], $post_rows );
		wpu_large_insert_rows( $wpdb->postmeta, array( 'post_id', 'meta_key', 'meta_value' ), array( '%d', '%s', '%s' ), $meta_rows );
		$progress->tick( $end - $offset );
	}
	$progress->finish();
	return $ids_by_kind;
}

// ---------------------------------------------------------------------------------------------
// Folders, through FileBird's own functions only (D17).
// ---------------------------------------------------------------------------------------------

/**
 * Creates 300 folders: 20 top-level folders, each with child folders, some with grandchildren
 * and a few great-grandchildren. Names repeat across branches, as on real sites.
 *
 * @return int[] Folder ids, in creation order.
 */
function wpu_large_create_folders() {
	$top_names   = array( 'Events', 'Products', 'Team', 'Blog', 'Press', 'Campaigns', 'Clients', 'Archive', 'Stock', 'Social', 'Web', 'Print', 'Video', 'Brand', 'Interiors', 'Travel', 'Food', 'Nature', 'Sport', 'Misc' );
	$child_names = array( '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026', 'Drafts', 'Selects', 'Raw', 'Final', 'Logos', 'Portraits', 'Details', 'Wide shots' );
	$folder_ids  = array();
	$parents     = array();

	foreach ( $top_names as $name ) {
		$created      = \FileBird\Model\Folder::newFolder( $name, 0 );
		$folder_ids[] = (int) $created['id'];
		$parents[]    = array( (int) $created['id'], 1 );
	}
	// Breadth-first: each new folder goes under a random existing folder of depth 1-3.
	while ( count( $folder_ids ) < WPU_LARGE_FOLDER_COUNT ) {
		list( $parent_id, $depth ) = wpu_large_pick( $parents );
		$name                      = wpu_large_pick( $child_names );
		$suffix                    = 1;
		$candidate                 = $name;
		// FileBird refuses a duplicate name under the same parent.
		while ( \FileBird\Model\Folder::detail( $candidate, $parent_id ) ) {
			$suffix++;
			$candidate = "$name ($suffix)";
		}
		$created = \FileBird\Model\Folder::newFolder( $candidate, $parent_id );
		if ( ! $created ) {
			WP_CLI::error( "FileBird could not create the folder '$candidate'." );
		}
		$folder_ids[] = (int) $created['id'];
		if ( $depth < 4 ) {
			$parents[] = array( (int) $created['id'], $depth + 1 );
		}
	}
	return $folder_ids;
}

/**
 * Assigns about 70 % of all attachments to folders. Folder sizes are skewed (a few big folders,
 * many small ones), like real libraries.
 */
function wpu_large_assign_folders( array $attachment_ids, array $folder_ids ) {
	$by_folder   = array();
	$folder_count = count( $folder_ids );
	foreach ( $attachment_ids as $attachment_id ) {
		if ( ! wpu_large_percent_chance( WPU_LARGE_ASSIGNED_PERCENT ) ) {
			continue;
		}
		// Squaring a uniform draw favours the first folders.
		$draw                                   = wpu_large_int( 0, 9999 ) / 10000;
		$position                               = (int) floor( $draw * $draw * $folder_count );
		$by_folder[ $folder_ids[ $position ] ][] = $attachment_id;
	}
	ksort( $by_folder );
	$progress = WP_CLI\Utils\make_progress_bar( 'Assigning folders through FileBird', count( $by_folder ) );
	foreach ( $by_folder as $folder_id => $ids ) {
		\FileBird\Model\Folder::setFoldersForPosts( $ids, $folder_id );
		$progress->tick();
	}
	$progress->finish();
	return array_sum( array_map( 'count', $by_folder ) );
}

// ---------------------------------------------------------------------------------------------
// Posts.
// ---------------------------------------------------------------------------------------------

function wpu_large_image_block( $id, $url ) {
	return '<!-- wp:image {"id":' . $id . ',"sizeSlug":"large","linkDestination":"none"} -->' . "\n"
		. '<figure class="wp-block-image size-large"><img src="' . esc_url( $url ) . '" alt="" class="wp-image-' . $id . '"/></figure>' . "\n"
		. '<!-- /wp:image -->';
}

function wpu_large_gallery_block( array $ids, array $urls ) {
	$inner = array();
	foreach ( $ids as $id ) {
		$inner[] = wpu_large_image_block( $id, $urls[ $id ] );
	}
	return '<!-- wp:gallery {"linkTo":"none"} -->' . "\n"
		. '<figure class="wp-block-gallery has-nested-images columns-default is-cropped">' . implode( "\n\n", $inner ) . '</figure>' . "\n"
		. '<!-- /wp:gallery -->';
}

/**
 * Inserts the posts and pages with SQL, plus their featured images.
 */
function wpu_large_create_posts( $first_id, array $image_ids, array $owners ) {
	global $wpdb;
	$post_columns = wpu_large_post_columns();
	$post_rows    = array();
	$meta_rows    = array();
	$url_cache    = array();
	$url_of       = function ( $id ) use ( &$url_cache ) {
		if ( ! isset( $url_cache[ $id ] ) ) {
			$url_cache[ $id ] = get_post_field( 'guid', $id );
		}
		return $url_cache[ $id ];
	};

	for ( $index = 0; $index < WPU_LARGE_POST_COUNT; $index++ ) {
		$id      = $first_id + $index;
		$is_page = 9 === $index % 10;
		$blocks  = array( "<!-- wp:paragraph -->\n<p>Post number $index.</p>\n<!-- /wp:paragraph -->" );
		$roll    = wpu_large_int( 0, 99 );
		if ( $roll < 10 ) {
			$gallery = array();
			$size    = wpu_large_int( 3, 6 );
			for ( $i = 0; $i < $size; $i++ ) {
				$gallery[] = wpu_large_pick( $image_ids );
			}
			$urls = array();
			foreach ( $gallery as $gallery_id ) {
				$urls[ $gallery_id ] = $url_of( $gallery_id );
			}
			$blocks[] = wpu_large_gallery_block( $gallery, $urls );
		} elseif ( $roll < 15 ) {
			$inline   = wpu_large_pick( $image_ids );
			$blocks   = array( '<p>Classic content.</p><p><img class="alignnone size-medium wp-image-' . $inline . '" src="' . esc_url( $url_of( $inline ) ) . '" alt="" /></p>' );
		} else {
			$image_count = wpu_large_int( 1, 3 );
			for ( $i = 0; $i < $image_count; $i++ ) {
				$image_id = wpu_large_pick( $image_ids );
				$blocks[] = wpu_large_image_block( $image_id, $url_of( $image_id ) );
			}
		}

		$status_roll = wpu_large_int( 0, 99 );
		$status      = $status_roll < 92 ? 'publish' : ( $status_roll < 97 ? 'draft' : 'private' );
		$owner_roll  = wpu_large_int( 0, 99 );
		$owner       = $owner_roll < 90 ? $owners['admin'] : ( $owner_roll < 97 ? $owners['app'] : $owners['author'] );
		$number      = sprintf( '%04d', $index + 1 );
		$post_rows[] = wpu_large_post_row(
			$id,
			$owner,
			wpu_large_spread_timestamp( $index, WPU_LARGE_POST_COUNT, WPU_LARGE_FIRST_POST_UTC, WPU_LARGE_LAST_POST_UTC ),
			implode( "\n\n", $blocks ),
			( $is_page ? 'Large page ' : 'Large post ' ) . $number,
			'',
			$status,
			( $is_page ? 'large-page-' : 'large-post-' ) . $number,
			0,
			home_url( '/?p=' . $id ),
			$is_page ? 'page' : 'post',
			''
		);
		if ( wpu_large_percent_chance( 60 ) ) {
			$meta_rows[] = array( $id, '_thumbnail_id', (string) wpu_large_pick( $image_ids ) );
		}
	}
	wpu_large_insert_rows( $wpdb->posts, $post_columns['columns'], $post_columns['formats'], $post_rows );
	wpu_large_insert_rows( $wpdb->postmeta, array( 'post_id', 'meta_key', 'meta_value' ), array( '%d', '%s', '%s' ), $meta_rows );
}

// ---------------------------------------------------------------------------------------------
// The companion plugin's index.
// ---------------------------------------------------------------------------------------------

/**
 * Runs the companion plugin's maintenance step (contract §5.21) until it reports no more work,
 * when the plugin is active. Returns the number of steps, or null without the plugin.
 */
function wpu_large_build_companion_index() {
	$routes = rest_get_server()->get_routes();
	if ( ! isset( $routes['/wp-upload/v1/maintenance/step'] ) ) {
		return null;
	}
	$steps = 0;
	do {
		$request = new WP_REST_Request( 'POST', '/wp-upload/v1/maintenance/step' );
		$request->set_header( 'content-type', 'application/json' );
		$request->set_body( wp_json_encode( array( 'budgetMs' => 20000 ) ) );
		$response = rest_do_request( $request );
		if ( $response->is_error() ) {
			WP_CLI::warning( 'The companion maintenance step failed: ' . wp_json_encode( $response->get_data() ) );
			return $steps;
		}
		$data = $response->get_data();
		++$steps;
		WP_CLI::log( sprintf( 'Maintenance step %d: %s', $steps, wp_json_encode( $data['index'] ?? array() ) ) );
	} while ( ! empty( $data['more'] ) && $steps < 500 );
	return $steps;
}

// ---------------------------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------------------------

// wp eval-file runs this file inside a function, so globals must be declared.
global $wpdb;

wp_set_current_user( $wpu_large_admin_id );
kses_remove_filters();
add_filter(
	'upload_mimes',
	function ( $mimes ) {
		$mimes['svg'] = 'image/svg+xml';
		return $mimes;
	}
);
// Nothing below needs WordPress's query caches, and 50k rows would only fill them.
wp_suspend_cache_addition( true );

$wpu_large_owners = array(
	'admin'  => $wpu_large_admin_id,
	'app'    => $wpu_large_app_user->ID,
	'author' => $wpu_large_author_user->ID,
);

WP_CLI::log( 'Creating the real files...' );
$wpu_large_real = wpu_large_create_real_files();
$wpu_large_real_count = array_sum( array_map( 'count', $wpu_large_real ) );

// Explicit ids: synthetic attachments first, then the posts, both after everything that exists.
$wpu_large_first_attachment_id = (int) $wpdb->get_var( "SELECT MAX(ID) FROM {$wpdb->posts}" ) + 1;
$wpu_large_synthetic_count     = WPU_LARGE_ATTACHMENT_TOTAL - $wpu_large_real_count;
$wpu_large_first_post_id       = $wpu_large_first_attachment_id + $wpu_large_synthetic_count;

$wpu_large_synthetic = wpu_large_create_synthetic_attachments(
	$wpu_large_real,
	$wpu_large_first_attachment_id,
	$wpu_large_synthetic_count,
	$wpu_large_first_post_id,
	$wpu_large_owners
);

WP_CLI::log( 'Creating posts...' );
$wpu_large_image_ids = array_merge( $wpu_large_real['image'], $wpu_large_synthetic['image'] ?? array() );
wpu_large_create_posts( $wpu_large_first_post_id, $wpu_large_image_ids, $wpu_large_owners );

WP_CLI::log( 'Creating folders through FileBird...' );
$wpu_large_all_attachments = array();
foreach ( array( $wpu_large_real, $wpu_large_synthetic ) as $wpu_large_group ) {
	foreach ( $wpu_large_group as $wpu_large_ids ) {
		$wpu_large_all_attachments = array_merge( $wpu_large_all_attachments, $wpu_large_ids );
	}
}
sort( $wpu_large_all_attachments );
$wpu_large_folders  = wpu_large_create_folders();
$wpu_large_assigned = wpu_large_assign_folders( $wpu_large_all_attachments, $wpu_large_folders );

// The real files' modified dates, stamped "now" by wp_update_attachment_metadata(), go back to
// their publish dates, so the seed is the same on every run.
$wpdb->query(
	$wpdb->prepare(
		"UPDATE {$wpdb->posts} SET post_modified = post_date, post_modified_gmt = post_date_gmt WHERE ID IN (" . implode( ',', array_fill( 0, $wpu_large_real_count, '%d' ) ) . ')',
		array_merge( ...array_values( $wpu_large_real ) )
	)
);
// Visual Portfolio's lazy first run, now, at a fixed point (see mu-plugins/wpu-dev.php).
wpu_dev_finish_visual_portfolio_setup();
wp_suspend_cache_addition( false );
wp_cache_flush();

$wpu_large_steps = wpu_large_build_companion_index();
if ( null === $wpu_large_steps ) {
	WP_CLI::log( 'The companion plugin is not active: no index to build.' );
}

WP_CLI::success(
	sprintf(
		'Seeded %d attachments (%d real files), %d FileBird folders with %d assignments (%.0f %%), and %d posts and pages.',
		$wpu_large_real_count + $wpu_large_synthetic_count,
		$wpu_large_real_count,
		count( $wpu_large_folders ),
		$wpu_large_assigned,
		100 * $wpu_large_assigned / max( 1, $wpu_large_real_count + $wpu_large_synthetic_count ),
		WPU_LARGE_POST_COUNT
	)
);
