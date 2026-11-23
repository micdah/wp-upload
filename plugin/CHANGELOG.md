# wp-upload companion plugin: changelog

The plugin follows semver (`WPU_VERSION`), and its REST contract has its own level (`WPU_API`). See
[the implementation plan](../docs/media-manager/implementation-plan.md) §2.6 for the update policy:
changes within a major are additive, and updates should be rare because users install them by hand.

## Unreleased

- 1.0.0-dev.1: scaffold. Every `wp-upload/v1` route is registered and answers 501
  `wpu_not_implemented`.
