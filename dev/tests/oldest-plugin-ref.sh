#!/usr/bin/env bash
# Tests for oldest_supported_plugin_ref (dev/lib/suites.sh, D48(4)): plugin-contract's
# "oldest supported build" is the oldest `plugin-v*` tag whose WPU_API meets the server's
# PLUGIN_API_REQUIRED. Runs in a throwaway git repository, so no tag ever reaches the real one.
# Run by `dev/run test unit` (in the runner); also runnable on the host: bash dev/tests/oldest-plugin-ref.sh
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REAL_DEV_DIR="$(cd "$TESTS_DIR/.." && pwd -P)"
SCRATCH_REPO="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_REPO"' EXIT

FAILURES=0

# dev/run's libraries, pointed at the scratch repository.
load_dev_libraries() {
  DEV_DIR="$REAL_DEV_DIR"
  REPO_ROOT="$SCRATCH_REPO"
  # shellcheck source=dev/lib/common.sh
  source "$REAL_DEV_DIR/lib/common.sh"
  # shellcheck source=dev/lib/suites.sh
  source "$REAL_DEV_DIR/lib/suites.sh"
}

# Git in the scratch repository, with a fixed identity (CI has none configured).
scratch_git() {
  git -C "$SCRATCH_REPO" \
    -c user.name=dev-tests \
    -c user.email=dev-tests@example.com \
    -c commit.gpgsign=false \
    -c tag.gpgsign=false \
    "$@"
}

# Writes the server's required level, as server/src/routes/library/bootstrap.ts declares it.
write_server_requirement() {
  local major="$1"
  local min_minor="$2"
  mkdir -p "$SCRATCH_REPO/server/src/routes/library"
  printf 'export const PLUGIN_API_REQUIRED = { major: %s, minMinor: %s } as const\n' \
    "$major" "$min_minor" > "$SCRATCH_REPO/server/src/routes/library/bootstrap.ts"
}

# Commits a plugin entry file with this WPU_API and tags it as a release.
release_plugin() {
  local tag="$1"
  local api="$2"
  mkdir -p "$SCRATCH_REPO/plugin/wp-upload-companion"
  printf "<?php\nconst WPU_VERSION = '%s';\nconst WPU_API = '%s';\n" \
    "${tag#plugin-v}" "$api" > "$SCRATCH_REPO/plugin/wp-upload-companion/wp-upload-companion.php"
  scratch_git add --all
  scratch_git commit --quiet --message "release $tag"
  scratch_git tag "$tag"
}

expect_oldest() {
  local description="$1"
  local expected="$2"
  local actual
  actual="$(oldest_supported_plugin_ref)"
  if [ "$actual" = "$expected" ]; then
    echo "ok   $description"
  else
    echo "FAIL $description: expected '${expected:-<current build>}', got '${actual:-<current build>}'"
    FAILURES=$((FAILURES + 1))
  fi
}

main() {
  scratch_git init --quiet
  load_dev_libraries
  unset WPU_PLUGIN_OLDEST_REF

  write_server_requirement 1 0
  scratch_git add --all
  scratch_git commit --quiet --message "server"
  expect_oldest "no release yet: the current build" ""

  release_plugin plugin-v0.9.0 0.9
  expect_oldest "a release of an older major doesn't count" ""

  release_plugin plugin-v1.0.0 1.0
  release_plugin plugin-v1.9.0 1.1
  release_plugin plugin-v1.10.0 1.2
  expect_oldest "minMinor 0: the oldest 1.x release" "plugin-v1.0.0"

  write_server_requirement 1 1
  expect_oldest "minMinor 1: the oldest release with API 1.1 or later" "plugin-v1.9.0"

  write_server_requirement 1 2
  expect_oldest "minMinor 2: version order, not text order (1.10.0 after 1.9.0)" "plugin-v1.10.0"

  write_server_requirement 1 3
  expect_oldest "no release meets the level: the current build" ""

  write_server_requirement 2 0
  expect_oldest "a new major: the current build" ""

  WPU_PLUGIN_OLDEST_REF="plugin-v1.0.0"
  expect_oldest "WPU_PLUGIN_OLDEST_REF overrides the derivation" "plugin-v1.0.0"
  unset WPU_PLUGIN_OLDEST_REF

  if [ "$FAILURES" -gt 0 ]; then
    echo "$FAILURES failure(s)"
    exit 1
  fi
  echo "oldest-plugin-ref: all passed"
}

main
