# shellcheck shell=bash
# Test suites for `dev/run test <suite>` (plan §5.2). Every suite runs inside `runner` (or the
# PHP services), always in a `test` mode project, so local runs and CI are identical.
# Output goes to test-results/<suite>/.

# What `dev/run test all` runs: everything except perf and version-bump.
GATE_SUITES="lint typecheck unit plugin-static plugin-contract server-live e2e-mock e2e-live"
ALL_SUITE_NAMES="$GATE_SUITES perf version-bump all"

suite_results_dir() {
  local suite="$1"
  printf '%s/%s' "$RESULTS_DIR" "$suite"
}

# Why: a named volume mounted at node_modules starts out root-owned, and Docker would create
# a missing mount point in the repo as root. Create it as the host user and hand the volume
# to the host user too.
prepare_runner_volumes() {
  mkdir -p "$REPO_ROOT/node_modules"
  compose_run \
    --user 0 \
    --entrypoint chown \
    runner "$WPU_UID:$WPU_GID" "$REPO_ROOT/node_modules" >/dev/null
}

# Builds the runner image (cached; in CI with the buildx GitHub Actions cache).
build_runner_image() {
  log_step "Building the runner image (Playwright $PLAYWRIGHT_VERSION + Node 24)"
  compose build runner
}

RUNNER_READY=false

ensure_runner_ready() {
  if [ "$RUNNER_READY" = "true" ]; then
    return 0
  fi
  build_runner_image
  prepare_runner_volumes
  RUNNER_READY=true
}

# Runs a bash script in the runner, after `npm ci` when the lockfile changed since the last
# install into the node_modules volume. Output is also saved to test-results/<suite>/.
run_in_runner() {
  local suite="$1"
  local script="$2"
  local results_dir
  results_dir="$(suite_results_dir "$suite")"
  mkdir -p "$results_dir"
  ensure_runner_ready

  # Single-quoted on purpose: it expands inside the runner.
  # shellcheck disable=SC2016
  local install_dependencies='
    set -euo pipefail
    lock_hash="$(sha256sum package-lock.json | cut -d" " -f1)"
    marker="node_modules/.wpu-lockfile-sha256"
    if [ "$(cat "$marker" 2>/dev/null || true)" != "$lock_hash" ]; then
      echo "==> npm ci (the lockfile changed)"
      npm ci --no-audit --no-fund
      echo "$lock_hash" > "$marker"
    fi
  '
  log_step "Suite $suite"
  compose_run \
    --env WPU_SUITE_RESULTS_DIR="$results_dir" \
    runner bash -c "$install_dependencies
$script" 2>&1 | tee "$results_dir/output.log"
}

# Live suites need the test stack with the seeded `small` profile, freshly restored.
prepare_live_stack() {
  if ! stack_is_running; then
    cmd_up test
    prepare_stack test
  fi
  if ! snapshot_exists small; then
    seed_small_profile
  fi
  log_step "Restoring the 'small' snapshot"
  restore_snapshot small
  after_restore
}

collect_stack_logs() {
  local logs_dir="$RESULTS_DIR/logs"
  mkdir -p "$logs_dir"
  compose logs --no-color --timestamps > "$logs_dir/$WPU_MODE-compose.log" 2>&1 || true
  wpcli_shell 'cat /var/www/html/wp-content/debug.log 2>/dev/null || true' > "$logs_dir/$WPU_MODE-wp-debug.log" || true
  log_info "Logs saved to ${logs_dir#"$REPO_ROOT"/}/"
}

# ---- Suites -----------------------------------------------------------------------------

suite_lint() {
  run_in_runner lint 'npm run check'
}

suite_typecheck() {
  run_in_runner typecheck 'npm run typecheck --workspaces --if-present'
}

# The server tests read client/dist, so build first (as ci.yml does).
suite_unit() {
  run_in_runner unit '
    npm run build
    npm run test -w server
    if node -e "process.exit(require(\"./client/package.json\").scripts?.test ? 0 : 1)"; then
      npm run test -w client
    fi
  '
}

suite_plugin_static() {
  if [ ! -d "$PLUGIN_SOURCE_DIR" ]; then
    not_available "plugin-static: plugin/wp-upload-companion/ doesn't exist yet (track P1)."
  fi
  local results_dir
  results_dir="$(suite_results_dir plugin-static)"
  mkdir -p "$results_dir"

  local lint_script='
    set -eu
    php --version | head -n 1
    find plugin -name "*.php" -not -path "*/vendor/*" -print0 | xargs -0 -n 1 php -l > /dev/null
    echo "php -l: no syntax errors"
  '
  local php_service
  for php_service in php81 php84; do
    log_step "plugin-static: php -l on $php_service"
    compose_run "$php_service" sh -c "$lint_script" 2>&1 | tee "$results_dir/$php_service-lint.log"
  done

  if [ -f "$REPO_ROOT/plugin/composer.lock" ]; then
    not_available "plugin-static: PHPStan needs a composer install step in dev/run (track D, M1)."
  fi
  if [ -f "$REPO_ROOT/plugin/scripts/build.mjs" ]; then
    run_in_runner plugin-static 'node plugin/scripts/build.mjs'
  else
    not_available "plugin-static: plugin/scripts/build.mjs doesn't exist yet (track P1)."
  fi
}

suite_plugin_contract() {
  if [ ! -f "$REPO_ROOT/plugin/vitest.config.ts" ]; then
    not_available "plugin-contract: plugin/vitest.config.ts and plugin/tests/contract/ don't exist yet (track P1)."
  fi
  if [ ! -d "$PLUGIN_DIST_DIR" ]; then
    not_available "plugin-contract: no built plugin at plugin/dist/wp-upload-companion/ (run 'dev/run test plugin-static' first)."
  fi
  prepare_live_stack
  run_in_runner plugin-contract 'npx vitest run --config plugin/vitest.config.ts'
  collect_stack_logs
}

suite_server_live() {
  if [ ! -f "$REPO_ROOT/server/vitest.live.config.ts" ]; then
    not_available "server-live: server/vitest.live.config.ts doesn't exist yet (track S1)."
  fi
  prepare_live_stack
  run_in_runner server-live 'cd server && npx vitest run --config vitest.live.config.ts'
  collect_stack_logs
}

suite_e2e_mock() {
  if [ ! -f "$REPO_ROOT/e2e/package.json" ]; then
    not_available "e2e-mock: the e2e/ workspace doesn't exist yet (orchestrator, M0)."
  fi
  not_available "e2e-mock: the VITE_MOCK build and its Playwright project aren't defined yet (tracks F2 and D)."
}

suite_e2e_live() {
  if [ ! -f "$REPO_ROOT/e2e/package.json" ]; then
    not_available "e2e-live: the e2e/ workspace doesn't exist yet (orchestrator, M0)."
  fi
  not_available "e2e-live: the live Playwright project isn't defined yet (track D, after the e2e workspace lands)."
}

suite_perf() {
  not_available "perf: needs the 'large' seed and the perf e2e suite (track D, M1, spike X4)."
}

# Compares shipped plugin source against a base commit (plan §2.6). The base comes from
# --base <sha> (CI passes github.event.before). An empty or all-zero base (a branch's first
# push) falls back to the merge base with origin/master.
suite_version_bump() {
  local base_commit="${1:-}"
  if [ ! -f "$REPO_ROOT/plugin/scripts/check-version-bump.mjs" ]; then
    not_available "version-bump: plugin/scripts/check-version-bump.mjs doesn't exist yet (orchestrator)."
  fi
  if [ -z "$base_commit" ] || [ -z "${base_commit//0/}" ]; then
    base_commit="$(git -C "$REPO_ROOT" merge-base HEAD origin/master)"
    log_info "No base commit given; using the merge base with origin/master ($base_commit)."
  fi
  run_in_runner version-bump "node plugin/scripts/check-version-bump.mjs --base '$base_commit'"
}

# Runs every gate suite, even after a failure, then prints a summary. Fails when any suite
# failed or isn't available yet: a gate must never pass with suites missing.
suite_all() {
  local suite status
  local failed_suites=""
  local unavailable_suites=""
  local passed_suites=""

  # Each suite runs in a subshell, so build the runner image once up front.
  ensure_runner_ready

  for suite in $GATE_SUITES; do
    set +e
    (set -e; run_suite "$suite")
    status=$?
    set -e
    if [ "$status" -eq 0 ]; then
      passed_suites="$passed_suites $suite"
    elif [ "$status" -eq "$EXIT_NOT_AVAILABLE" ]; then
      unavailable_suites="$unavailable_suites $suite"
    else
      failed_suites="$failed_suites $suite"
    fi
  done

  log_step "Summary of 'dev/run test all'"
  log_info "passed:            ${passed_suites:- none}"
  log_info "failed:            ${failed_suites:- none}"
  log_info "not available yet: ${unavailable_suites:- none}"
  if [ -n "$failed_suites" ] || [ -n "$unavailable_suites" ]; then
    return 1
  fi
}

run_suite() {
  local suite="$1"
  shift
  case "$suite" in
    lint)
      suite_lint
      ;;
    typecheck)
      suite_typecheck
      ;;
    unit)
      suite_unit
      ;;
    plugin-static)
      suite_plugin_static
      ;;
    plugin-contract)
      suite_plugin_contract
      ;;
    server-live)
      suite_server_live
      ;;
    e2e-mock)
      suite_e2e_mock
      ;;
    e2e-live)
      suite_e2e_live
      ;;
    perf)
      suite_perf
      ;;
    version-bump)
      suite_version_bump "$@"
      ;;
    all)
      suite_all
      ;;
    *)
      die "Unknown suite '$suite'. Suites: $ALL_SUITE_NAMES"
      ;;
  esac
}
