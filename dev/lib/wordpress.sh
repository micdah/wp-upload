# shellcheck shell=bash
# WordPress setup, seeding, snapshots and variants. Everything runs through wp-cli in a
# one-off container, so the host needs nothing but Docker.

# Named volumes start out root-owned; wp-cli runs as www-data (33) and must write snapshots.
give_snapshot_volume_to_www_data() {
  compose_run --user 0 wpcli chown 33:33 /snapshots >/dev/null
}

wordpress_is_installed() {
  wpcli core is-installed >/dev/null 2>&1
}

install_wordpress() {
  log_step "Installing WordPress at $WPU_SITE_URL"
  wpcli core install \
    --url="$WPU_SITE_URL" \
    --title="wp-upload dev" \
    --admin_user="$ADMIN_USER" \
    --admin_password="$ADMIN_PASSWORD" \
    --admin_email="admin@example.com" \
    --skip-email
  wpcli eval-file /opt/wpu/setup/site.php
}

# Why: the WordPress files live in a volume, so a newer image digest doesn't update them.
warn_on_wordpress_version_drift() {
  local installed_version
  installed_version="$(wpcli core version 2>/dev/null | tr -d '\r' || true)"
  if [ "$installed_version" != "$EXPECTED_WORDPRESS_VERSION" ]; then
    log_warn "WordPress $installed_version is installed, but the stack pins $EXPECTED_WORDPRESS_VERSION."
    log_warn "Run 'dev/run down --volumes' and 'dev/run up $WPU_MODE' to rebuild it."
  fi
}

# Downloads the pinned FileBird zip once into dev/.cache/downloads and checks its SHA-256.
# Runs as the host user, so the cache stays deletable without root.
# shellcheck disable=SC2016
download_filebird_zip() {
  local zip_name="filebird.${FILEBIRD_VERSION}.zip"
  local download_script='
    set -eu
    zip_path="/cache/downloads/$1"
    if [ ! -s "$zip_path" ]; then
      curl --fail --silent --show-error --location --output "$zip_path.partial" "$2"
      mv "$zip_path.partial" "$zip_path"
    fi
    if ! echo "$3  $zip_path" | sha256sum -c - >/dev/null; then
      rm -f "$zip_path"
      echo "FileBird zip checksum mismatch; the download was removed." >&2
      exit 1
    fi
  '
  compose_run \
    --user "$WPU_UID:$WPU_GID" \
    wpcli sh -c "$download_script" sh "$zip_name" "$FILEBIRD_ZIP_URL" "$FILEBIRD_ZIP_SHA256"
}

# Installs FileBird Lite at the pinned version and activates it. Never touches its data (D17).
install_filebird() {
  local installed_version
  installed_version="$(wpcli plugin get filebird --field=version 2>/dev/null | tr -d '\r' || true)"
  if [ "$installed_version" = "$FILEBIRD_VERSION" ]; then
    log_info "FileBird Lite $FILEBIRD_VERSION is installed."
  else
    log_step "Installing FileBird Lite $FILEBIRD_VERSION (checksum verified)"
    download_filebird_zip
    wpcli plugin install "/cache/downloads/filebird.${FILEBIRD_VERSION}.zip" --force
  fi
  activate_plugin filebird
}

# Activates a plugin unless it is active already (wp-cli would warn about that).
activate_plugin() {
  local plugin_slug="$1"
  if ! wpcli plugin is-active "$plugin_slug"; then
    wpcli plugin activate "$plugin_slug"
  fi
}

# The companion plugin (track P1) is mounted only when its folder exists.
activate_companion_plugin_if_present() {
  local plugin_dir="$PLUGIN_SOURCE_DIR"
  if [ "$WPU_MODE" = "test" ]; then
    plugin_dir="$PLUGIN_DIST_DIR"
  fi
  if [ ! -d "$plugin_dir" ]; then
    log_info "Companion plugin not found at ${plugin_dir#"$REPO_ROOT"/}; skipping it."
    return 0
  fi
  if ! activate_plugin wp-upload-companion; then
    log_warn "Could not activate the companion plugin from ${plugin_dir#"$REPO_ROOT"/}."
  fi
}

# Creates the Editor app user and its app password, keeping a password that still works.
ensure_app_user() {
  local password
  password="$(wpcli eval-file /opt/wpu/setup/app-user.php "$APP_USER_LOGIN" "$WPU_APP_PASSWORD" | tr -d '\r\n')"
  if [ -z "$password" ]; then
    die "Could not create an Application Password for $APP_USER_LOGIN."
  fi
  export WPU_APP_PASSWORD="$password"
}

# The scripts below are single-quoted on purpose: "$1" expands inside the container.
# shellcheck disable=SC2016
snapshot_exists() {
  local profile="$1"
  wpcli_shell 'sh /opt/wpu/snapshot.sh exists "$1"' "$profile" >/dev/null 2>&1
}

# shellcheck disable=SC2016
take_snapshot() {
  local profile="$1"
  wpcli_shell 'sh /opt/wpu/snapshot.sh take "$1"' "$profile"
}

# shellcheck disable=SC2016
restore_snapshot() {
  local profile="$1"
  wpcli_shell 'sh /opt/wpu/snapshot.sh restore "$1"' "$profile"
}

# A snapshot can predate the companion plugin (track P1 adds it later), so activate it after
# every restore. Variants come back as they were when the snapshot was taken: the defaults.
after_restore() {
  activate_companion_plugin_if_present
}

seed_small_profile() {
  log_step "Seeding the 'small' profile (deterministic; about a minute)"
  restore_snapshot base
  after_restore
  wpcli eval-file /opt/wpu/seed/small.php "$APP_USER_LOGIN"
  take_snapshot small
}

apply_variant() {
  wpcli wpu-dev variant "$@"
}
