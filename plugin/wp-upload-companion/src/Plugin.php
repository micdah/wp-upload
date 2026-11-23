<?php
/**
 * Wires every component of the plugin. Each class registers its own hooks
 * and routes in register(); this list is pre-wired by the M0 scaffold so
 * tracks P1 and P2 only fill in their own classes (implementation plan §2.5).
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion;

final class Plugin {

	public const REST_NAMESPACE = 'wp-upload/v1';

	/** @var list<class-string> Components, each with a static register(). */
	private const COMPONENTS = array(
		// Track P1.
		FileBird\Adapter::class,
		Index\MediaIndex::class,
		Field\WpuField::class,
		Rest\InfoController::class,
		Rest\CollectionController::class,
		Rest\FoldersController::class,
		Rest\MaintenanceController::class,
		// Track P2.
		Index\UsageIndex::class,
		Rest\MediaController::class,
		Rest\TrashController::class,
		Rest\UsageController::class,
		Rest\ImagesController::class,
	);

	public static function boot(): void {
		foreach ( self::COMPONENTS as $component ) {
			$component::register();
		}
	}
}
