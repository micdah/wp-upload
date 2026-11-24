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

# Downloads a pinned plugin zip once into dev/.cache/downloads and checks its SHA-256.
# Runs as the host user, so the cache stays deletable without root.
# shellcheck disable=SC2016
download_plugin_zip() {
  local zip_name="$1"
  local zip_url="$2"
  local zip_sha256="$3"
  local download_script='
    set -eu
    zip_path="/cache/downloads/$1"
    if [ ! -s "$zip_path" ]; then
      curl --fail --silent --show-error --location --output "$zip_path.partial" "$2"
      mv "$zip_path.partial" "$zip_path"
    fi
    if ! echo "$3  $zip_path" | sha256sum -c - >/dev/null; then
      rm -f "$zip_path"
      echo "$1: checksum mismatch; the download was removed." >&2
      exit 1
    fi
  '
  compose_run \
    --user "$WPU_UID:$WPU_GID" \
    wpcli sh -c "$download_script" sh "$zip_name" "$zip_url" "$zip_sha256"
}

# Installs a plugin from a pinned, checksum-verified zip unless that version is installed.
# Plugins live in the WordPress volume, not in snapshots, so this survives every restore.
install_pinned_plugin() {
  local plugin_slug="$1"
  local plugin_label="$2"
  local plugin_version="$3"
  local zip_url="$4"
  local zip_sha256="$5"
  local zip_name="${plugin_slug}.${plugin_version}.zip"
  local installed_version
  installed_version="$(wpcli plugin get "$plugin_slug" --field=version 2>/dev/null | tr -d '\r' || true)"
  if [ "$installed_version" = "$plugin_version" ]; then
    log_info "$plugin_label $plugin_version is installed."
    return 0
  fi
  log_step "Installing $plugin_label $plugin_version (checksum verified)"
  download_plugin_zip "$zip_name" "$zip_url" "$zip_sha256"
  wpcli plugin install "/cache/downloads/$zip_name" --force
}

# FileBird Lite at the pinned version. Never touches its data (D17).
install_filebird() {
  install_pinned_plugin filebird "FileBird Lite" \
    "$FILEBIRD_VERSION" "$FILEBIRD_ZIP_URL" "$FILEBIRD_ZIP_SHA256"
}

# Visual Portfolio (D22), active by default; `dev/run variant vp=off` hides it.
install_visual_portfolio() {
  install_pinned_plugin visual-portfolio "Visual Portfolio" \
    "$VISUAL_PORTFOLIO_VERSION" "$VISUAL_PORTFOLIO_ZIP_URL" "$VISUAL_PORTFOLIO_ZIP_SHA256"
}

# Activates FileBird and Visual Portfolio in one wp-cli call. A snapshot taken before Visual
# Portfolio joined the stack doesn't have it active, so this also runs after every restore.
# Activation hooks leave a short-lived welcome-redirect transient; it is removed, so seeds and
# snapshots don't carry a timestamp.
activate_third_party_plugins() {
  wpcli eval-file /opt/wpu/setup/activate-plugins.php filebird visual-portfolio
}

# Activates a plugin unless it is active already (wp-cli would warn about that).
activate_plugin() {
  local plugin_slug="$1"
  if ! wpcli plugin is-active "$plugin_slug"; then
    wpcli plugin activate "$plugin_slug"
  fi
}

# Test mode installs the built plugin by copying it into the WordPress volume instead of
# bind-mounting plugin/dist/:
# - a rebuild that replaces plugin/dist/ would leave a bind mount pointing at a deleted
#   directory, while a copy taken before each suite is always the current build;
# - plugin-contract can swap in the oldest supported build, or the mu-plugins install (D30),
#   without recreating containers.
#   install_as=plugin     plugins/wp-upload-companion/ (a regular plugin; activate it after)
#   install_as=mu-plugin  mu-plugins/wp-upload-companion.php (the single file only)
# shellcheck disable=SC2016
install_companion_build() {
  local build_dir="$1"
  local install_as="$2"
  local install_script='
    set -eu
    plugin_dir=/var/www/html/wp-content/plugins/wp-upload-companion
    mu_plugin_file=/var/www/html/wp-content/mu-plugins/wp-upload-companion.php
    rm -rf "$plugin_dir" "$mu_plugin_file"
    if [ "$1" = "plugin" ]; then
      cp -R /opt/wpu-companion-build "$plugin_dir"
    else
      cp /opt/wpu-companion-build/wp-upload-companion.php "$mu_plugin_file"
    fi
  '
  compose_run \
    --volume "$build_dir:/opt/wpu-companion-build:ro" \
    wpcli sh -c "$install_script" sh "$install_as"
}

# Removes any copy of the built plugin from the test stack (when there is no build).
remove_companion_build() {
  wpcli_shell 'rm -rf /var/www/html/wp-content/plugins/wp-upload-companion /var/www/html/wp-content/mu-plugins/wp-upload-companion.php'
}

# The companion plugin (track P1), when it exists: in dev mode its source is mounted
# (compose.plugin-source.yml), in test mode the current build is copied in first.
activate_companion_plugin_if_present() {
  local plugin_dir="$PLUGIN_SOURCE_DIR"
  if [ "$WPU_MODE" = "test" ]; then
    plugin_dir="$PLUGIN_DIST_DIR"
  fi
  if [ ! -d "$plugin_dir" ]; then
    log_info "Companion plugin not found at ${plugin_dir#"$REPO_ROOT"/}; skipping it."
    if [ "$WPU_MODE" = "test" ]; then
      remove_companion_build
    fi
    return 0
  fi
  if [ "$WPU_MODE" = "test" ]; then
    install_companion_build "$PLUGIN_DIST_DIR" plugin
  fi
  if ! activate_plugin wp-upload-companion; then
    log_warn "Could not activate the companion plugin from ${plugin_dir#"$REPO_ROOT"/}."
  fi
}

# Creates the app user (Editor) and the Author user (D26) with their app passwords, keeping
# passwords that still work. One wp-cli call for both, because it also runs after every
# snapshot restore.
# Sets WPU_APP_PASSWORD and WPU_AUTHOR_APP_PASSWORD, and APP_PASSWORDS_CHANGED=true|false.
ensure_app_users() {
  local output app_password author_password
  output="$(wpcli eval-file /opt/wpu/setup/users.php \
    "$APP_USER_LOGIN" "$WPU_APP_PASSWORD" \
    "$AUTHOR_USER_LOGIN" "$WPU_AUTHOR_APP_PASSWORD" | tr -d '\r')"
  app_password="$(printf '%s\n' "$output" | sed -n 1p)"
  author_password="$(printf '%s\n' "$output" | sed -n 2p)"
  if [ -z "$app_password" ] || [ -z "$author_password" ]; then
    die "Could not create the Application Passwords for $APP_USER_LOGIN and $AUTHOR_USER_LOGIN."
  fi

  APP_PASSWORDS_CHANGED=false
  if [ "$app_password" != "$WPU_APP_PASSWORD" ] || [ "$author_password" != "$WPU_AUTHOR_APP_PASSWORD" ]; then
    APP_PASSWORDS_CHANGED=true
  fi
  export WPU_APP_PASSWORD="$app_password"
  export WPU_AUTHOR_APP_PASSWORD="$author_password"
}

# A restored snapshot holds the password hashes from when it was taken. Usually they match
# what dev/run holds; if not, record the new passwords, and give the running `app` container
# (test mode) and dev/.env.wp (dev mode) the new app password.
refresh_app_users_after_restore() {
  ensure_app_users
  if [ "$APP_PASSWORDS_CHANGED" != "true" ]; then
    return 0
  fi
  log_info "The restored snapshot had other app passwords; recorded new ones."
  save_mode_state "$WPU_MODE"
  if [ "$WPU_MODE" = "dev" ]; then
    write_env_wp_file
    log_warn "dev/.env.wp changed: restart 'npm run dev' to pick up the new app password."
  elif app_container_is_running; then
    compose --profile app up --detach --wait app
  fi
}

app_container_is_running() {
  [ -n "$(compose --profile app ps --status running --quiet app 2>/dev/null)" ]
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

# A snapshot can predate the companion plugin (track P1 adds it later), Visual Portfolio or the
# Author user, so activate the plugins and check the users after every restore. Variants come
# back as they were when the snapshot was taken: the defaults.
after_restore() {
  refresh_app_users_after_restore
  activate_third_party_plugins
  activate_companion_plugin_if_present
}

seed_small_profile() {
  log_step "Seeding the 'small' profile (deterministic; about a minute)"
  restore_snapshot base
  after_restore
  wpcli eval-file /opt/wpu/seed/small.php "$APP_USER_LOGIN" "$AUTHOR_USER_LOGIN"
  take_snapshot small
}

# The perf profile (plan §5.4, spike X4): 50k attachments, 300 folders, 5k posts. The wp-cli
# image's PHP has a 128 MB memory limit; the seed gets more headroom. It ends by running the
# companion plugin's maintenance until its index is complete, so the snapshot holds it.
seed_large_profile() {
  log_step "Seeding the 'large' profile (50k attachments; several minutes)"
  restore_snapshot base
  after_restore
  compose_run wpcli php -d memory_limit=1G /usr/local/bin/wp \
    eval-file /opt/wpu/seed/large.php "$APP_USER_LOGIN" "$AUTHOR_USER_LOGIN"
  take_snapshot large
}

apply_variant() {
  wpcli wpu-dev variant "$@"
}
