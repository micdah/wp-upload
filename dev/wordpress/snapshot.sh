#!/bin/sh
# Takes or restores a snapshot of the database AND the uploads volume (plan §5.2).
# Runs inside the one-off `wpcli` container, as www-data. Never shipped.
#
#   snapshot.sh take <profile>      e.g. base, small, large
#   snapshot.sh restore <profile>
#   snapshot.sh exists <profile>    exit status only
#
# Why both: suites that edit, replace, regenerate, delete or upload change files as well as
# rows. Restoring only the database would leave the next suite with stale files.
set -eu

action="${1:-}"
profile="${2:-}"
snapshot_dir="/snapshots/$profile"
uploads_dir="/var/www/html/wp-content/uploads"

fail() {
  echo "snapshot: $*" >&2
  exit 1
}

check_profile_name() {
  case "$profile" in
    "" | *[!a-z0-9_-]*)
      fail "invalid snapshot name '$profile'"
      ;;
  esac
}

snapshot_exists() {
  [ -s "$snapshot_dir/db.sql" ] && [ -f "$snapshot_dir/uploads.tar" ]
}

# Writes into a temporary directory first, so an interrupted run never leaves a half snapshot.
take_snapshot() {
  partial_dir="$snapshot_dir.partial"
  rm -rf "$partial_dir"
  mkdir -p "$partial_dir"
  wp db export "$partial_dir/db.sql" --quiet
  tar -C "$uploads_dir" -cf "$partial_dir/uploads.tar" .
  rm -rf "$snapshot_dir"
  mv "$partial_dir" "$snapshot_dir"
  echo "Snapshot '$profile' taken."
}

# Drops every table first (wp db reset), so tables created after the snapshot (for example by
# the companion plugin) don't survive the restore.
restore_snapshot() {
  if ! snapshot_exists; then
    fail "no snapshot named '$profile'"
  fi
  wp db reset --yes --quiet
  wp db import "$snapshot_dir/db.sql" --quiet
  find "$uploads_dir" -mindepth 1 -delete
  tar -C "$uploads_dir" -xf "$snapshot_dir/uploads.tar"
  echo "Snapshot '$profile' restored."
}

check_profile_name
case "$action" in
  take)
    take_snapshot
    ;;
  restore)
    restore_snapshot
    ;;
  exists)
    snapshot_exists
    ;;
  *)
    fail "usage: snapshot.sh take|restore|exists <profile>"
    ;;
esac
