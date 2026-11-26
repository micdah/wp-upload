#!/usr/bin/env bash
# Tests for refresh_app_users_after_restore (dev/lib/wordpress.sh): after a snapshot restore,
# a new app or Author password is recorded and handed to the running app (or dev/.env.wp, with
# a restart hint), while a new administrator password (only the contract tests use it) is just
# recorded: no restart, no hint. wp-cli, compose and the state writers are stubbed.
# Run by `dev/run test unit` (in the runner); also runnable on the host: bash dev/tests/app-passwords.sh
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEV_DIR="$(cd "$TESTS_DIR/.." && pwd -P)"
REPO_ROOT="$(cd "$DEV_DIR/.." && pwd -P)"

# shellcheck source=dev/lib/common.sh
source "$DEV_DIR/lib/common.sh"
# shellcheck source=dev/lib/wordpress.sh
source "$DEV_DIR/lib/wordpress.sh"

FAILURES=0
CALLS=""
# The three passwords the stubbed users.php "prints".
STUB_APP_PASSWORD=""
STUB_AUTHOR_PASSWORD=""
STUB_ADMIN_PASSWORD=""

# ---- Stubs: record what was called instead of touching a stack ----------------------------

wpcli() {
  printf '%s\n%s\n%s\n' "$STUB_APP_PASSWORD" "$STUB_AUTHOR_PASSWORD" "$STUB_ADMIN_PASSWORD"
}

save_mode_state() {
  CALLS="$CALLS save"
}

write_env_wp_file() {
  CALLS="$CALLS env"
}

app_container_is_running() {
  return 0
}

compose() {
  CALLS="$CALLS restart-app"
}

log_info() {
  :
}

log_warn() {
  CALLS="$CALLS warn"
}

# Runs one restore with the passwords dev/run held and the ones WordPress now accepts.
restore_with() {
  local mode="$1"
  local held_app="$2"
  local held_admin="$3"
  local new_app="$4"
  local new_admin="$5"
  WPU_MODE="$mode"
  WPU_APP_PASSWORD="$held_app"
  WPU_AUTHOR_APP_PASSWORD="author-password"
  WPU_ADMIN_APP_PASSWORD="$held_admin"
  STUB_APP_PASSWORD="$new_app"
  STUB_AUTHOR_PASSWORD="author-password"
  STUB_ADMIN_PASSWORD="$new_admin"
  CALLS=""
  refresh_app_users_after_restore
}

check() {
  local description="$1"
  local expected="$2"
  local actual="${CALLS# }"
  if [ "$actual" = "$expected" ]; then
    echo "ok   $description"
  else
    echo "FAIL $description: expected '$expected', got '$actual'"
    FAILURES=$((FAILURES + 1))
  fi
}

main() {
  restore_with test app admin app admin
  check "nothing changed: nothing happens" ""

  restore_with test app "" app new-admin
  check "only the admin password is new (test): recorded, the app keeps running" "save"
  if [ "$WPU_ADMIN_APP_PASSWORD" != "new-admin" ]; then
    echo "FAIL the new admin password isn't exported"
    FAILURES=$((FAILURES + 1))
  fi

  restore_with dev app "" app new-admin
  check "only the admin password is new (dev): recorded and written to dev/.env.wp, no restart hint" "save env"

  restore_with test app admin new-app admin
  check "a new app password (test): recorded and the app restarted" "save restart-app"

  restore_with dev app admin new-app admin
  check "a new app password (dev): recorded, dev/.env.wp rewritten, restart hint" "save env warn"

  if [ "$FAILURES" -gt 0 ]; then
    echo "$FAILURES failure(s)"
    exit 1
  fi
  echo "app-passwords: all passed"
}

main
