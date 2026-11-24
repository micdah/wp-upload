<?php
/**
 * Permission callbacks. They always return a WP_Error with status 403 instead
 * of `false`, because WordPress turns `false` into 401 for logged-out requests,
 * and a 401 must only ever mean "WordPress rejected the Application Password"
 * (plugin-api.md §1.4).
 *
 * Shared by tracks P1 and P2. Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Support;

final class Permissions {

	/**
	 * The baseline for every route (plugin-api.md §1.3).
	 *
	 * @return true|\WP_Error
	 */
	public static function upload_files() {
		if ( current_user_can( 'upload_files' ) ) {
			return true;
		}
		return Errors::forbidden();
	}

	/**
	 * `GET /info`: the 403 still identifies the plugin (plugin-api.md §3.3).
	 *
	 * @return true|\WP_Error
	 */
	public static function info() {
		if ( current_user_can( 'upload_files' ) ) {
			return true;
		}
		return Errors::make(
			'wpu_forbidden',
			'You need the upload_files capability (Author role or higher).',
			403,
			array(
				'plugin'  => 'wp-upload-companion',
				'version' => WPU_VERSION,
				'api'     => WPU_API,
			)
		);
	}
}
