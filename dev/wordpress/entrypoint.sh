#!/bin/sh
# Entrypoint wrapper for the `wordpress` service. Never shipped.
#
# Why: Docker creates the mount points for the uploads volume and the plugin source as
# root-owned directories inside the WordPress volume. The image's own entrypoint keeps existing
# directories as they are, so WordPress (www-data) could not write to wp-content. Hand those
# directories to www-data first, install the dev mu-plugin's loader, then continue with the
# image's entrypoint.
set -eu

wp_content_dir=/var/www/html/wp-content
dev_mu_plugin_loader="$wp_content_dir/mu-plugins/wpu-dev.php"

give_directory_to_www_data() {
  directory_path="$1"
  if [ -d "$directory_path" ]; then
    chown www-data:www-data "$directory_path"
  fi
}

# The dev mu-plugin lives in /opt/wpu, a directory bind mount, so edits show up at once. This
# loader in the WordPress volume points at it, and the wp-cli containers share the volume.
# Stacks from before the loader had a single-file mount point here; `rm -f` clears it.
install_dev_mu_plugin_loader() {
  mkdir -p "$wp_content_dir/mu-plugins"
  rm -f "$dev_mu_plugin_loader"
  printf '%s\n' \
    '<?php' \
    '// Written by dev/wordpress/entrypoint.sh: the dev-only mu-plugin. Never shipped.' \
    "require '/opt/wpu/mu-plugins/wpu-dev.php';" \
    > "$dev_mu_plugin_loader"
  chown www-data:www-data "$dev_mu_plugin_loader"
}

mkdir -p "$wp_content_dir/uploads"
give_directory_to_www_data "$wp_content_dir"
give_directory_to_www_data "$wp_content_dir/uploads"
give_directory_to_www_data "$wp_content_dir/plugins"
install_dev_mu_plugin_loader
give_directory_to_www_data "$wp_content_dir/mu-plugins"

exec docker-entrypoint.sh "$@"
