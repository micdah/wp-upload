<?php
/**
 * Baseline timings of FileBird's own queries on the `large` seed (spike X4). Run by
 * `dev/run test perf` through `wp eval-file`, as the admin. Never shipped.
 *
 * FileBird Lite filters media lists through its `fbv` WP_Query variable (its `posts_clauses`
 * filter), which core REST `/wp/v2/media` never sets, so its Uncategorized and folder queries
 * can't be timed over REST. They run here in-process instead, exactly as FileBird builds them
 * for the media library: no HTTP, no TLS, no REST overhead.
 *
 * Arguments: <runs>
 * Prints one JSON document: {"folderId": N, "results": [{name, runs, p50, p95, max, mean, rows}]}.
 */

global $wpdb;

$wpu_perf_runs    = max( 1, (int) ( $args[0] ?? 20 ) );
$wpu_perf_warmups = 2;
// The folder with the most items (a read-only query of FileBird's relation table, D17).
$wpu_perf_folder_id = (int) $wpdb->get_var( "SELECT folder_id FROM {$wpdb->prefix}fbv_attachment_folder GROUP BY folder_id ORDER BY COUNT(*) DESC, folder_id ASC LIMIT 1" );

wp_set_current_user( 1 );

/**
 * Times a callable: warm-up runs, then $runs timed runs. The callable returns a row count.
 */
function wpu_perf_time( $name, $runs, $warmups, callable $query ) {
	for ( $run = 0; $run < $warmups; $run++ ) {
		$query();
	}
	$timings = array();
	$rows    = 0;
	for ( $run = 0; $run < $runs; $run++ ) {
		wp_cache_flush();
		$started   = hrtime( true );
		$rows      = $query();
		$timings[] = ( hrtime( true ) - $started ) / 1e6;
	}
	sort( $timings );
	$at = function ( $fraction ) use ( $timings ) {
		$index = (int) ceil( $fraction * count( $timings ) ) - 1;
		return round( $timings[ max( 0, min( count( $timings ) - 1, $index ) ) ], 1 );
	};
	return array(
		'name' => $name,
		'runs' => $runs,
		'p50'  => $at( 0.5 ),
		'p95'  => $at( 0.95 ),
		'max'  => round( end( $timings ), 1 ),
		'mean' => round( array_sum( $timings ) / count( $timings ), 1 ),
		'rows' => $rows,
	);
}

/**
 * The media-library list query (first page of 100, newest first, with the total count), with
 * FileBird's `fbv` variable when a folder is given: -1 all, 0 Uncategorized, N a folder.
 */
function wpu_perf_media_query( $fbv ) {
	$query_args = array(
		'post_type'      => 'attachment',
		'post_status'    => 'inherit',
		'posts_per_page' => 100,
		'orderby'        => 'date',
		'order'          => 'DESC',
		'fields'         => 'ids',
	);
	if ( null !== $fbv ) {
		$query_args['fbv'] = $fbv;
	}
	$query = new WP_Query( $query_args );
	return (int) $query->found_posts;
}

$wpu_perf_results = array(
	wpu_perf_time( 'WP_Query media list (all, 100)', $wpu_perf_runs, $wpu_perf_warmups, fn () => wpu_perf_media_query( null ) ),
	wpu_perf_time( 'FileBird Uncategorized (fbv=0, 100)', $wpu_perf_runs, $wpu_perf_warmups, fn () => wpu_perf_media_query( 0 ) ),
);
if ( $wpu_perf_folder_id > 0 ) {
	$wpu_perf_results[] = wpu_perf_time( "FileBird one folder (fbv=$wpu_perf_folder_id, 100)", $wpu_perf_runs, $wpu_perf_warmups, fn () => wpu_perf_media_query( $wpu_perf_folder_id ) );
}
$wpu_perf_results[] = wpu_perf_time( 'FileBird count of all (Tree::getCount)', $wpu_perf_runs, $wpu_perf_warmups, fn () => (int) \FileBird\Classes\Tree::getCount( -1 ) );
$wpu_perf_results[] = wpu_perf_time(
	'FileBird per-folder counts (countAttachments)',
	$wpu_perf_runs,
	$wpu_perf_warmups,
	function () {
		$counts = \FileBird\Model\Folder::countAttachments();
		return is_array( $counts['display'] ?? null ) ? count( $counts['display'] ) : 0;
	}
);

echo wp_json_encode(
	array(
		'folderId' => $wpu_perf_folder_id,
		'results'  => $wpu_perf_results,
	),
	JSON_PRETTY_PRINT
), "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
