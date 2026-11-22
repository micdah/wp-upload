#!/bin/sh
# Entrypoint wrapper for the `wordpress` service. Never shipped.
#
# Why: Docker creates the mount points for the uploads volume, the mu-plugin and the plugin
# source as root-owned directories inside the WordPress volume. The image's own entrypoint keeps
# existing directories as they are, so WordPress (www-data) could not write to wp-content.
# Hand those directories to www-data first, then continue with the image's entrypoint.
set -eu

wp_content_dir=/var/www/html/wp-content

give_directory_to_www_data() {
  directory_path="$1"
  if [ -d "$directory_path" ]; then
    chown www-data:www-data "$directory_path"
  fi
}

mkdir -p "$wp_content_dir/uploads"
give_directory_to_www_data "$wp_content_dir"
give_directory_to_www_data "$wp_content_dir/uploads"
give_directory_to_www_data "$wp_content_dir/plugins"
give_directory_to_www_data "$wp_content_dir/mu-plugins"

exec docker-entrypoint.sh "$@"
