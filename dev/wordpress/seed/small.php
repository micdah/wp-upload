<?php
/**
 * The `small` seed profile (implementation plan §5.4). Run by `dev/run seed small` through
 * `wp eval-file`, always on top of the freshly restored `base` snapshot. Never shipped.
 *
 * What it creates, deterministically (a fixed random seed with its own generator, fixed dates):
 * - 200 generated images (JPEG, PNG with alpha, WebP, GIF) in varied aspect ratios and sizes,
 *   including two above the 2560 px big-image threshold (`-scaled` originals), one smaller than
 *   a thumbnail, and repeated file names;
 * - the committed fixtures from dev/fixtures (mp4, mp3, pdf, svg), several times each;
 * - 15 nested FileBird folders, created and filled only through FileBird's own PHP functions
 *   (D17), with about 80 % of the files assigned;
 * - 30 posts and pages that use media in every usage context: featured image, image block,
 *   gallery block (nested and legacy), file block, cover, media-text, classic `wp-image-N`,
 *   the `[gallery]` shortcode, plus the site logo and site icon;
 * - media and two posts owned by the Author user (D26), for per-item permission checks;
 * - Visual Portfolio galleries and saved layouts in every form the usage index reads (D22,
 *   spike X10; seed/visual-portfolio.php).
 *
 * The last two are added after everything that draws from the random generator and draw
 * nothing themselves, so every earlier row is the same as before they existed.
 *
 * Arguments: <app user login> <author user login>
 */

if ( ! class_exists( '\FileBird\Model\Folder' ) ) {
	WP_CLI::error( 'FileBird must be active to seed folders. Run `dev/run variant filebird=on` or `dev/run up` first.' );
}

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

const WPU_SEED_RANDOM_SEED     = 20261122;
const WPU_SEED_IMAGE_COUNT     = 200;
const WPU_SEED_POST_COUNT      = 30;
const WPU_SEED_FIRST_MEDIA_UTC = '2024-01-03 08:00:00';
const WPU_SEED_FIRST_POST_UTC  = '2024-02-01 10:00:00';
const WPU_SEED_FIXTURES_DIR    = '/opt/wpu-fixtures';

$wpu_seed_app_login = $args[0] ?? '';
$wpu_seed_app_user  = get_user_by( 'login', $wpu_seed_app_login );
if ( ! $wpu_seed_app_user ) {
	WP_CLI::error( "Unknown app user '$wpu_seed_app_login'." );
}
$wpu_seed_author_login = $args[1] ?? '';
$wpu_seed_author_user  = get_user_by( 'login', $wpu_seed_author_login );
if ( ! $wpu_seed_author_user ) {
	WP_CLI::error( "Unknown Author user '$wpu_seed_author_login'." );
}
$wpu_seed_admin_id = 1;

require '/opt/wpu/seed/visual-portfolio.php';

/**
 * A generator of our own, so nothing else in WordPress that calls mt_rand() can shift the
 * sequence.
 */
function wpu_seed_random() {
	static $randomizer = null;
	if ( null === $randomizer ) {
		$randomizer = new \Random\Randomizer( new \Random\Engine\Mt19937( WPU_SEED_RANDOM_SEED ) );
	}
	return $randomizer;
}

function wpu_seed_int( $min, $max ) {
	return wpu_seed_random()->getInt( $min, $max );
}

function wpu_seed_pick( array $items ) {
	return $items[ wpu_seed_int( 0, count( $items ) - 1 ) ];
}

function wpu_seed_percent_chance( $percent ) {
	return wpu_seed_int( 0, 99 ) < $percent;
}

// ---------------------------------------------------------------------------------------------
// Media specs: decide everything up front, so the sequence never depends on WordPress.
// ---------------------------------------------------------------------------------------------

/**
 * The image specs: size, format, title, alt text and owner for each generated image.
 */
function wpu_seed_image_specs( $app_user_id, $admin_id ) {
	$ratios      = array( array( 1, 1 ), array( 4, 3 ), array( 3, 4 ), array( 3, 2 ), array( 2, 3 ), array( 16, 9 ), array( 9, 16 ), array( 21, 9 ), array( 1, 2 ), array( 2, 1 ), array( 5, 4 ), array( 4, 5 ) );
	$long_edges  = array( 640, 960, 1280, 1600, 1920 );
	$adjectives  = array( 'Quiet', 'Golden', 'Misty', 'Bright', 'Hidden', 'Crimson', 'Silver', 'Wild', 'Calm', 'Distant', 'Frosty', 'Sunny', 'Blå', 'Grøn' );
	$nouns       = array( 'harbour', 'meadow', 'skyline', 'bicycle', 'lantern', 'orchard', 'bridge', 'forest', 'market', 'lighthouse', 'canyon', 'garden', 'studio', 'portrait', 'workshop', 'fjord', 'smørrebrød' );
	$specs       = array();

	for ( $index = 0; $index < WPU_SEED_IMAGE_COUNT; $index++ ) {
		$ratio     = wpu_seed_pick( $ratios );
		$long_edge = wpu_seed_pick( $long_edges );
		$roll      = wpu_seed_int( 0, 99 );
		if ( $roll < 78 ) {
			$format = 'jpg';
		} elseif ( $roll < 90 ) {
			$format = 'png';
		} elseif ( $roll < 97 ) {
			$format = 'webp';
		} else {
			$format = 'gif';
		}

		// Edge cases at fixed positions: the site icon (square, at least 512 px), the site logo,
		// two originals above the big-image threshold, and one image smaller than a thumbnail.
		if ( 0 === $index ) {
			$ratio     = array( 1, 1 );
			$long_edge = 960;
			$format    = 'png';
		} elseif ( 1 === $index ) {
			$ratio     = array( 21, 9 );
			$long_edge = 960;
			$format    = 'png';
		} elseif ( 37 === $index ) {
			$ratio     = array( 4, 3 );
			$long_edge = 3200;
			$format    = 'jpg';
		} elseif ( 151 === $index ) {
			$ratio     = array( 2, 3 );
			$long_edge = 3600;
			$format    = 'jpg';
		} elseif ( 88 === $index ) {
			$ratio     = array( 3, 2 );
			$long_edge = 120;
			$format    = 'jpg';
		}

		if ( $ratio[0] >= $ratio[1] ) {
			$width  = $long_edge;
			$height = (int) round( $long_edge * $ratio[1] / $ratio[0] );
		} else {
			$height = $long_edge;
			$width  = (int) round( $long_edge * $ratio[0] / $ratio[1] );
		}

		$adjective = wpu_seed_pick( $adjectives );
		$noun      = wpu_seed_pick( $nouns );
		$number    = sprintf( '%03d', $index + 1 );
		$title     = "$adjective $noun $number";
		$slug      = sanitize_title( remove_accents( "$adjective-$noun-$number" ) );

		// Repeated camera-style file names, for duplicate checks (two in the same month).
		if ( in_array( $index, array( 10, 11, 130 ), true ) ) {
			$slug = 'img-0001';
		}

		$specs[] = array(
			'kind'        => 'image',
			'index'       => $index,
			'width'       => $width,
			'height'      => $height,
			'format'      => $format,
			'title'       => $title,
			'filename'    => "$slug.$format",
			'alt'         => wpu_seed_percent_chance( 60 ) ? "$title, seen from the $noun" : '',
			'caption'     => wpu_seed_percent_chance( 30 ) ? "Caption for $title" : '',
			'description' => wpu_seed_percent_chance( 20 ) ? "A longer description of $title, for search tests." : '',
			'author'      => wpu_seed_percent_chance( 12 ) ? $app_user_id : $admin_id,
			'ratio_label' => $ratio[0] . ':' . $ratio[1],
		);
	}
	return $specs;
}

/**
 * The committed fixtures, each used several times under different titles.
 */
function wpu_seed_fixture_specs( $admin_id ) {
	$fixtures = array(
		array( 'sample.mp4', 'video/mp4', array( 'Product teaser', 'Interview clip', 'Drone flyover' ) ),
		array( 'sample.mp3', 'audio/mpeg', array( 'Podcast intro', 'Jingle', 'Ambient loop' ) ),
		array( 'sample.pdf', 'application/pdf', array( 'Price list 2024', 'Annual report', 'Press kit' ) ),
		array( 'sample.svg', 'image/svg+xml', array( 'Logo mark', 'Icon set' ) ),
	);
	$specs    = array();
	foreach ( $fixtures as $fixture ) {
		list( $file, $mime, $titles ) = $fixture;
		$extension                    = pathinfo( $file, PATHINFO_EXTENSION );
		foreach ( $titles as $title ) {
			$specs[] = array(
				'kind'        => 'fixture',
				'source'      => WPU_SEED_FIXTURES_DIR . '/' . $file,
				'mime'        => $mime,
				'title'       => $title,
				'filename'    => sanitize_title( $title ) . '.' . $extension,
				'alt'         => '',
				'caption'     => '',
				'description' => wpu_seed_percent_chance( 50 ) ? "Fixture file: $title." : '',
				'author'      => $admin_id,
			);
		}
	}
	return $specs;
}

/**
 * Interleaves fixtures into the images and gives every item a fixed timestamp, about every
 * 3.3 days from early 2024 to late 2025, so the month list has two years of data.
 */
function wpu_seed_schedule( array $images, array $fixtures ) {
	$all            = array();
	$fixture_cursor = 0;
	foreach ( $images as $position => $image ) {
		$all[] = $image;
		if ( 0 === ( $position + 1 ) % 18 && $fixture_cursor < count( $fixtures ) ) {
			$all[] = $fixtures[ $fixture_cursor++ ];
		}
	}
	while ( $fixture_cursor < count( $fixtures ) ) {
		$all[] = $fixtures[ $fixture_cursor++ ];
	}

	$start = strtotime( WPU_SEED_FIRST_MEDIA_UTC . ' UTC' );
	foreach ( $all as $position => &$spec ) {
		$spec['timestamp'] = $start + $position * 285120 + wpu_seed_int( 0, 7200 );
	}
	unset( $spec );
	return $all;
}

// ---------------------------------------------------------------------------------------------
// Image rendering with GD.
// ---------------------------------------------------------------------------------------------

/**
 * Renders a gradient with translucent shapes and a large label (number, ratio, format), so
 * every image is distinct and recognisable in the grid.
 */
function wpu_seed_render_image( array $spec ) {
	$width     = $spec['width'];
	$height    = $spec['height'];
	$has_alpha = 'png' === $spec['format'];
	$image     = imagecreatetruecolor( $width, $height );

	$from = array( wpu_seed_int( 0, 255 ), wpu_seed_int( 0, 255 ), wpu_seed_int( 0, 255 ) );
	$to   = array( wpu_seed_int( 0, 255 ), wpu_seed_int( 0, 255 ), wpu_seed_int( 0, 255 ) );

	if ( $has_alpha ) {
		imagealphablending( $image, false );
		imagesavealpha( $image, true );
	}
	for ( $y = 0; $y < $height; $y++ ) {
		$t     = $height > 1 ? $y / ( $height - 1 ) : 0;
		$alpha = $has_alpha ? (int) round( 90 * $t ) : 0;
		$color = imagecolorallocatealpha(
			$image,
			(int) round( $from[0] + ( $to[0] - $from[0] ) * $t ),
			(int) round( $from[1] + ( $to[1] - $from[1] ) * $t ),
			(int) round( $from[2] + ( $to[2] - $from[2] ) * $t ),
			$alpha
		);
		imageline( $image, 0, $y, $width - 1, $y, $color );
	}
	imagealphablending( $image, true );

	$shape_count = wpu_seed_int( 3, 7 );
	for ( $shape = 0; $shape < $shape_count; $shape++ ) {
		$color = imagecolorallocatealpha( $image, wpu_seed_int( 0, 255 ), wpu_seed_int( 0, 255 ), wpu_seed_int( 0, 255 ), wpu_seed_int( 30, 90 ) );
		$cx    = wpu_seed_int( 0, $width );
		$cy    = wpu_seed_int( 0, $height );
		$size  = wpu_seed_int( (int) ( min( $width, $height ) / 6 ), (int) max( 2, min( $width, $height ) / 1.5 ) );
		if ( wpu_seed_percent_chance( 50 ) ) {
			imagefilledellipse( $image, $cx, $cy, $size, $size, $color );
		} else {
			imagefilledrectangle( $image, $cx, $cy, $cx + $size, $cy + (int) ( $size / 2 ), $color );
		}
	}

	wpu_seed_draw_label( $image, sprintf( '#%03d %s %s', $spec['index'] + 1, $spec['ratio_label'], $spec['format'] ) );

	ob_start();
	switch ( $spec['format'] ) {
		case 'png':
			imagepng( $image, null, 6 );
			break;
		case 'webp':
			imagewebp( $image, null, 80 );
			break;
		case 'gif':
			imagegif( $image );
			break;
		default:
			imagejpeg( $image, null, 85 );
	}
	$bytes = ob_get_clean();
	imagedestroy( $image );
	return $bytes;
}

/**
 * Draws the label with GD's built-in font on a small canvas and scales it up, so no font file
 * is needed.
 */
function wpu_seed_draw_label( $image, $text ) {
	$label_width  = strlen( $text ) * 9 + 8;
	$label_height = 22;
	$label        = imagecreatetruecolor( $label_width, $label_height );
	imagefilledrectangle( $label, 0, 0, $label_width, $label_height, imagecolorallocate( $label, 20, 20, 24 ) );
	imagestring( $label, 5, 4, 3, $text, imagecolorallocate( $label, 245, 245, 245 ) );

	$width  = imagesx( $image );
	$height = imagesy( $image );
	$scale  = max( 1, (int) floor( $width * 0.6 / $label_width ) );
	$target_width  = $label_width * $scale;
	$target_height = $label_height * $scale;
	imagecopyresized(
		$image,
		$label,
		(int) ( ( $width - $target_width ) / 2 ),
		(int) ( ( $height - $target_height ) / 2 ),
		0,
		0,
		$target_width,
		$target_height,
		$label_width,
		$label_height
	);
	imagedestroy( $label );
}

// ---------------------------------------------------------------------------------------------
// Inserting media.
// ---------------------------------------------------------------------------------------------

/**
 * Writes the file into its year/month folder and creates the attachment with fixed dates.
 */
function wpu_seed_insert_media( array $spec, $bytes ) {
	$upload = wp_upload_bits( $spec['filename'], null, $bytes, gmdate( 'Y/m', $spec['timestamp'] ) );
	if ( ! empty( $upload['error'] ) ) {
		WP_CLI::error( "Could not write {$spec['filename']}: {$upload['error']}" );
	}

	$filetype = wp_check_filetype( $upload['file'] );
	$date     = gmdate( 'Y-m-d H:i:s', $spec['timestamp'] );
	$id       = wp_insert_attachment(
		array(
			'post_mime_type' => $spec['mime'] ?? $filetype['type'],
			'post_title'     => $spec['title'],
			'post_content'   => $spec['description'],
			'post_excerpt'   => $spec['caption'],
			'post_status'    => 'inherit',
			'post_author'    => $spec['author'],
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
	if ( '' !== $spec['alt'] ) {
		update_post_meta( $id, '_wp_attachment_image_alt', $spec['alt'] );
	}
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $upload['file'] ) );
	return $id;
}

// ---------------------------------------------------------------------------------------------
// Folders, through FileBird's own functions only (D17).
// ---------------------------------------------------------------------------------------------

/**
 * Creates the 15-folder tree and returns folder ids by path.
 */
function wpu_seed_create_folders() {
	$tree = array(
		'Events'                => null,
		'Events/Summer festival 2024' => 'Events',
		'Events/Winter gala 2024'     => 'Events',
		'Events/Conference'           => 'Events',
		'Events/Conference/Speakers'  => 'Events/Conference',
		'Products'              => null,
		'Products/Shoes'        => 'Products',
		'Products/Bags'         => 'Products',
		'Products/Accessories'  => 'Products',
		'Products/Accessories/Belts' => 'Products/Accessories',
		'Team'                  => null,
		'Team/Portraits'        => 'Team',
		'Blog'                  => null,
		'Press'                 => null,
		'Press/Logos'           => 'Press',
	);
	$ids  = array();
	foreach ( $tree as $path => $parent_path ) {
		$name      = basename( $path );
		$parent_id = null === $parent_path ? 0 : $ids[ $parent_path ];
		$created   = \FileBird\Model\Folder::newFolder( $name, $parent_id );
		if ( ! $created ) {
			WP_CLI::error( "FileBird could not create the folder '$path'." );
		}
		$ids[ $path ] = (int) $created['id'];
	}
	return $ids;
}

/**
 * Assigns about 80 % of the media to folders: fixtures by type, images at random.
 */
function wpu_seed_assign_folders( array $media, array $folder_ids ) {
	$paths     = array_keys( $folder_ids );
	$by_folder = array();
	foreach ( $media as $item ) {
		$spec = $item['spec'];
		if ( 'fixture' === $spec['kind'] ) {
			$by_type = array(
				'video/mp4'       => 'Events/Conference',
				'audio/mpeg'      => 'Blog',
				'application/pdf' => 'Press',
				'image/svg+xml'   => 'Press/Logos',
			);
			$path    = $by_type[ $spec['mime'] ];
		} elseif ( wpu_seed_percent_chance( 80 ) ) {
			$path = wpu_seed_pick( $paths );
		} else {
			continue;
		}
		$by_folder[ $folder_ids[ $path ] ][] = $item['id'];
	}
	ksort( $by_folder );
	foreach ( $by_folder as $folder_id => $attachment_ids ) {
		\FileBird\Model\Folder::setFoldersForPosts( $attachment_ids, $folder_id );
	}
}

// ---------------------------------------------------------------------------------------------
// Posts that use media in every usage context.
// ---------------------------------------------------------------------------------------------

function wpu_seed_image_url( $id ) {
	return esc_url( wp_get_attachment_image_url( $id, 'large' ) );
}

function wpu_seed_paragraph( $text ) {
	return "<!-- wp:paragraph -->\n<p>" . esc_html( $text ) . "</p>\n<!-- /wp:paragraph -->";
}

function wpu_seed_image_inner( $id ) {
	return '<!-- wp:image {"id":' . $id . ',"sizeSlug":"large","linkDestination":"none"} -->' . "\n"
		. '<figure class="wp-block-image size-large"><img src="' . wpu_seed_image_url( $id ) . '" alt="" class="wp-image-' . $id . '"/></figure>' . "\n"
		. '<!-- /wp:image -->';
}

function wpu_seed_block_image( array $ids ) {
	return wpu_seed_image_inner( $ids[0] );
}

function wpu_seed_block_gallery( array $ids ) {
	$inner = implode( "\n\n", array_map( 'wpu_seed_image_inner', $ids ) );
	return '<!-- wp:gallery {"linkTo":"none"} -->' . "\n"
		. '<figure class="wp-block-gallery has-nested-images columns-default is-cropped">' . $inner . '</figure>' . "\n"
		. '<!-- /wp:gallery -->';
}

/** The pre-5.9 gallery format (an `ids` attribute), still found in older content. */
function wpu_seed_block_legacy_gallery( array $ids ) {
	$items = '';
	foreach ( $ids as $id ) {
		$items .= '<li class="blocks-gallery-item"><figure><img src="' . wpu_seed_image_url( $id ) . '" alt="" data-id="' . $id . '" class="wp-image-' . $id . '"/></figure></li>';
	}
	return '<!-- wp:gallery {"ids":[' . implode( ',', $ids ) . ']} -->' . "\n"
		. '<figure class="wp-block-gallery columns-3 is-cropped"><ul class="blocks-gallery-grid">' . $items . '</ul></figure>' . "\n"
		. '<!-- /wp:gallery -->';
}

function wpu_seed_block_file( array $ids ) {
	$id    = $ids[0];
	$url   = esc_url( wp_get_attachment_url( $id ) );
	$title = esc_html( get_the_title( $id ) );
	return '<!-- wp:file {"id":' . $id . ',"href":"' . $url . '"} -->' . "\n"
		. '<div class="wp-block-file"><a href="' . $url . '">' . $title . '</a><a href="' . $url . '" class="wp-block-file__button wp-element-button" download>Download</a></div>' . "\n"
		. '<!-- /wp:file -->';
}

function wpu_seed_block_cover( array $ids ) {
	$id  = $ids[0];
	$url = wpu_seed_image_url( $id );
	return '<!-- wp:cover {"url":"' . $url . '","id":' . $id . ',"dimRatio":50} -->' . "\n"
		. '<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span>'
		. '<img class="wp-block-cover__image-background wp-image-' . $id . '" alt="" src="' . $url . '" data-object-fit="cover"/>'
		. '<div class="wp-block-cover__inner-container">' . wpu_seed_paragraph( 'Cover text' ) . '</div></div>' . "\n"
		. '<!-- /wp:cover -->';
}

function wpu_seed_block_media_text( array $ids ) {
	$id  = $ids[0];
	$url = wpu_seed_image_url( $id );
	return '<!-- wp:media-text {"mediaId":' . $id . ',"mediaLink":"' . $url . '","mediaType":"image"} -->' . "\n"
		. '<div class="wp-block-media-text is-stacked-on-mobile"><figure class="wp-block-media-text__media"><img src="' . $url . '" alt="" class="wp-image-' . $id . ' size-full"/></figure>'
		. '<div class="wp-block-media-text__content">' . wpu_seed_paragraph( 'Media and text' ) . '</div></div>' . "\n"
		. '<!-- /wp:media-text -->';
}

function wpu_seed_block_video( $id ) {
	return '<!-- wp:video {"id":' . $id . '} -->' . "\n"
		. '<figure class="wp-block-video"><video controls src="' . esc_url( wp_get_attachment_url( $id ) ) . '"></video></figure>' . "\n"
		. '<!-- /wp:video -->';
}

function wpu_seed_block_audio( $id ) {
	return '<!-- wp:audio {"id":' . $id . '} -->' . "\n"
		. '<figure class="wp-block-audio"><audio controls src="' . esc_url( wp_get_attachment_url( $id ) ) . '"></audio></figure>' . "\n"
		. '<!-- /wp:audio -->';
}

/** Classic-editor content: an inline image with the `wp-image-N` class, optionally a shortcode. */
function wpu_seed_classic_content( $image_id, array $gallery_ids ) {
	$url     = esc_url( wp_get_attachment_image_url( $image_id, 'medium' ) );
	$content = "<p>Classic editor content.</p>\n\n<p><img class=\"alignnone size-medium wp-image-$image_id\" src=\"$url\" alt=\"\" /></p>";
	if ( $gallery_ids ) {
		$content .= "\n\n[gallery ids=\"" . implode( ',', $gallery_ids ) . '"]';
	}
	return $content;
}

/**
 * Hands out images for posts from a shuffled pool of 120 of the 200 images, wrapping around,
 * so some images are used several times and about 80 are never used.
 */
function wpu_seed_image_pool( array $image_ids ) {
	$pool = wpu_seed_random()->shuffleArray( $image_ids );
	return array_slice( $pool, 0, 120 );
}

function wpu_seed_take_images( array &$pool, &$cursor, $count ) {
	$taken = array();
	for ( $i = 0; $i < $count; $i++ ) {
		$taken[] = $pool[ $cursor % count( $pool ) ];
		$cursor++;
	}
	return $taken;
}

/**
 * Creates the 30 posts and pages. Every usage context occurs several times; a few posts are
 * drafts, private or pending, and some belong to the app user (for Author-role checks).
 */
function wpu_seed_create_posts( array $image_ids, array $fixture_ids_by_mime, $app_user_id, $admin_id ) {
	$pool         = wpu_seed_image_pool( $image_ids );
	$cursor       = 0;
	$block_kinds  = array( 'image', 'gallery', 'file', 'cover', 'media-text' );
	$page_indexes = array( 5, 11, 17, 23, 29 );
	$classic      = array( 3, 9, 15, 21, 27 );
	$statuses     = array(
		7  => 'draft',
		19 => 'draft',
		13 => 'private',
		25 => 'pending',
	);
	$file_sources = array_merge( $fixture_ids_by_mime['application/pdf'], $fixture_ids_by_mime['audio/mpeg'], $fixture_ids_by_mime['video/mp4'] );
	$start        = strtotime( WPU_SEED_FIRST_POST_UTC . ' UTC' );
	$created      = array();
	$hero_image   = $pool[0];

	for ( $index = 0; $index < WPU_SEED_POST_COUNT; $index++ ) {
		$is_page = in_array( $index, $page_indexes, true );
		$used    = array();

		if ( in_array( $index, $classic, true ) ) {
			$inline  = wpu_seed_take_images( $pool, $cursor, 1 );
			$gallery = in_array( $index, array( 9, 21, 27 ), true ) ? wpu_seed_take_images( $pool, $cursor, 4 ) : array();
			$content = wpu_seed_classic_content( $inline[0], $gallery );
			$used    = array_merge( $inline, $gallery );
		} else {
			$blocks = array( wpu_seed_paragraph( "Post number $index." ) );
			foreach ( array( $block_kinds[ ( $index * 2 ) % 5 ], $block_kinds[ ( $index * 2 + 1 ) % 5 ] ) as $kind ) {
				switch ( $kind ) {
					case 'image':
						$ids      = wpu_seed_take_images( $pool, $cursor, 1 );
						$blocks[] = wpu_seed_block_image( $ids );
						break;
					case 'gallery':
						$ids      = wpu_seed_take_images( $pool, $cursor, wpu_seed_int( 3, 6 ) );
						$blocks[] = 13 === $index ? wpu_seed_block_legacy_gallery( $ids ) : wpu_seed_block_gallery( $ids );
						break;
					case 'file':
						$ids      = array( $file_sources[ $index % count( $file_sources ) ] );
						$blocks[] = wpu_seed_block_file( $ids );
						break;
					case 'cover':
						$ids      = wpu_seed_take_images( $pool, $cursor, 1 );
						$blocks[] = wpu_seed_block_cover( $ids );
						break;
					default:
						$ids      = wpu_seed_take_images( $pool, $cursor, 1 );
						$blocks[] = wpu_seed_block_media_text( $ids );
				}
				$used = array_merge( $used, $ids );
			}
			if ( 4 === $index ) {
				$blocks[] = wpu_seed_block_video( $fixture_ids_by_mime['video/mp4'][0] );
				$used[]   = $fixture_ids_by_mime['video/mp4'][0];
			}
			if ( 8 === $index ) {
				$blocks[] = wpu_seed_block_audio( $fixture_ids_by_mime['audio/mpeg'][0] );
				$used[]   = $fixture_ids_by_mime['audio/mpeg'][0];
			}
			$content = implode( "\n\n", $blocks );
		}

		$date    = gmdate( 'Y-m-d H:i:s', $start + $index * 23 * DAY_IN_SECONDS );
		$post_id = wp_insert_post(
			array(
				'post_type'     => $is_page ? 'page' : 'post',
				'post_status'   => $statuses[ $index ] ?? 'publish',
				'post_title'    => ( $is_page ? 'Page ' : 'Post ' ) . sprintf( '%02d', $index + 1 ),
				'post_content'  => $content,
				'post_author'   => 4 === $index % 6 ? $app_user_id : $admin_id,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			WP_CLI::error( $post_id );
		}

		// Featured images on three of four posts; the "hero" image is shared by several.
		if ( 3 !== $index % 4 ) {
			$featured = 0 === $index % 5 ? $hero_image : wpu_seed_take_images( $pool, $cursor, 1 )[0];
			set_post_thumbnail( $post_id, $featured );
			array_unshift( $used, $featured );
		}

		$created[] = array(
			'id'   => $post_id,
			'used' => $used,
		);
	}
	return $created;
}

/**
 * Attaches each post's first image to it (post_parent), unless that image is attached already,
 * so the data has attached and unattached media.
 */
function wpu_seed_attach_media( array $posts ) {
	foreach ( $posts as $post ) {
		foreach ( $post['used'] as $media_id ) {
			if ( 0 === (int) get_post_field( 'post_parent', $media_id ) ) {
				wp_update_post(
					array(
						'ID'          => $media_id,
						'post_parent' => $post['id'],
					)
				);
				break;
			}
		}
	}
}

/**
 * wp_update_post() and set_post_thumbnail() stamp "now" as the modified date. Put every seeded
 * row's modified date back to its fixed publish date, so the seed is the same on every run.
 */
function wpu_seed_fix_modified_dates( array $ids ) {
	global $wpdb;
	$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->posts} SET post_modified = post_date, post_modified_gmt = post_date_gmt WHERE ID IN ($placeholders)", $ids ) );
	foreach ( $ids as $id ) {
		clean_post_cache( $id );
	}
}

// ---------------------------------------------------------------------------------------------
// The Author user's content (D26).
// ---------------------------------------------------------------------------------------------

/**
 * Gives the Author user every 25th media item (from the 13th) that the admin owns, plus a
 * published post and a draft that use the first two of them. Picked by position, without the
 * random generator, so nothing else in the seed moves. The ownership is set with SQL, so no
 * modified date is stamped.
 *
 * @return array{media: int[], posts: int[]}
 */
function wpu_seed_author_content( array $media, $author_id, $admin_id ) {
	global $wpdb;
	$author_media = array();
	foreach ( $media as $position => $item ) {
		if ( 12 === $position % 25 && $admin_id === $item['spec']['author'] ) {
			$author_media[] = $item['id'];
		}
	}
	foreach ( $author_media as $media_id ) {
		$wpdb->update( $wpdb->posts, array( 'post_author' => $author_id ), array( 'ID' => $media_id ) );
		clean_post_cache( $media_id );
	}

	$posts = array();
	foreach ( array( 'publish', 'draft' ) as $index => $status ) {
		$date    = gmdate( 'Y-m-d H:i:s', strtotime( '2026-02-02 10:00:00 UTC' ) + $index * DAY_IN_SECONDS );
		$post_id = wp_insert_post(
			array(
				'post_type'     => 'post',
				'post_status'   => $status,
				'post_title'    => 'publish' === $status ? 'Author post' : 'Author draft',
				'post_content'  => wpu_seed_paragraph( 'Written by the Author user.' ) . "\n\n" . wpu_seed_block_image( array( $author_media[ $index ] ) ),
				'post_author'   => $author_id,
				'post_date'     => $date,
				'post_date_gmt' => $date,
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			WP_CLI::error( $post_id );
		}
		set_post_thumbnail( $post_id, $author_media[ $index ] );
		$posts[] = $post_id;
	}

	return array(
		'media' => $author_media,
		'posts' => $posts,
	);
}

// ---------------------------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------------------------

// The admin may store unfiltered block markup; without a current user kses would strip some
// attributes. SVG isn't an allowed upload type by default, so allow it for the seed only.
wp_set_current_user( $wpu_seed_admin_id );
kses_remove_filters();
add_filter(
	'upload_mimes',
	function ( $mimes ) {
		$mimes['svg'] = 'image/svg+xml';
		return $mimes;
	}
);

$wpu_seed_schedule = wpu_seed_schedule(
	wpu_seed_image_specs( $wpu_seed_app_user->ID, $wpu_seed_admin_id ),
	wpu_seed_fixture_specs( $wpu_seed_admin_id )
);

$wpu_seed_media    = array();
$wpu_seed_progress = WP_CLI\Utils\make_progress_bar( 'Creating media', count( $wpu_seed_schedule ) );
foreach ( $wpu_seed_schedule as $wpu_seed_spec ) {
	$wpu_seed_bytes   = 'image' === $wpu_seed_spec['kind']
		? wpu_seed_render_image( $wpu_seed_spec )
		: file_get_contents( $wpu_seed_spec['source'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	$wpu_seed_media[] = array(
		'id'   => wpu_seed_insert_media( $wpu_seed_spec, $wpu_seed_bytes ),
		'spec' => $wpu_seed_spec,
	);
	$wpu_seed_progress->tick();
}
$wpu_seed_progress->finish();

$wpu_seed_image_ids       = array();
$wpu_seed_fixture_by_mime = array();
foreach ( $wpu_seed_media as $wpu_seed_item ) {
	if ( 'image' === $wpu_seed_item['spec']['kind'] ) {
		$wpu_seed_image_ids[] = $wpu_seed_item['id'];
	} else {
		$wpu_seed_fixture_by_mime[ $wpu_seed_item['spec']['mime'] ][] = $wpu_seed_item['id'];
	}
}

WP_CLI::log( 'Creating folders through FileBird...' );
wpu_seed_assign_folders( $wpu_seed_media, wpu_seed_create_folders() );

WP_CLI::log( 'Creating posts...' );
$wpu_seed_posts = wpu_seed_create_posts( $wpu_seed_image_ids, $wpu_seed_fixture_by_mime, $wpu_seed_app_user->ID, $wpu_seed_admin_id );
wpu_seed_attach_media( $wpu_seed_posts );

// Site logo (classic themes read the theme mod, block themes the option) and site icon.
set_theme_mod( 'custom_logo', $wpu_seed_image_ids[1] );
update_option( 'site_logo', $wpu_seed_image_ids[1] );
update_option( 'site_icon', $wpu_seed_image_ids[0] );

WP_CLI::log( 'Giving media and posts to the Author user...' );
$wpu_seed_author_content = wpu_seed_author_content( $wpu_seed_media, $wpu_seed_author_user->ID, $wpu_seed_admin_id );

WP_CLI::log( 'Creating Visual Portfolio galleries and saved layouts...' );
$wpu_seed_vp = wpu_seed_visual_portfolio( $wpu_seed_image_ids );

// Visual Portfolio's lazy first run, now, at a fixed point (see mu-plugins/wpu-dev.php).
wpu_dev_finish_visual_portfolio_setup();
wpu_seed_fix_modified_dates(
	array_merge(
		array_column( $wpu_seed_media, 'id' ),
		array_column( $wpu_seed_posts, 'id' ),
		$wpu_seed_author_content['posts'],
		array_column( $wpu_seed_vp['posts'], 'id' ),
		array_column( $wpu_seed_vp['layouts'], 'id' )
	)
);

WP_CLI::log( 'Author media: ' . implode( ',', $wpu_seed_author_content['media'] ) . '; Author posts: ' . implode( ',', $wpu_seed_author_content['posts'] ) );
WP_CLI::log( 'Visual Portfolio: ' . wp_json_encode( $wpu_seed_vp ) );
WP_CLI::success(
	sprintf(
		'Seeded %d media items, 15 folders, %d posts, 2 Author posts, 4 Visual Portfolio posts and 2 saved layouts.',
		count( $wpu_seed_media ),
		count( $wpu_seed_posts )
	)
);
