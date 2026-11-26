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

# Why: the browsers in the runner image must match @playwright/test exactly (plan §5.3).
# Checked on every run once the e2e workspace exists.
check_playwright_pin() {
  local e2e_manifest="$REPO_ROOT/e2e/package.json"
  if [ ! -f "$e2e_manifest" ]; then
    return 0
  fi
  local pinned_version
  pinned_version="$(sed -n 's/.*"@playwright\/test": *"\([^"]*\)".*/\1/p' "$e2e_manifest" | head -n 1)"
  if [ -z "$pinned_version" ]; then
    log_warn "e2e/package.json has no @playwright/test dependency; can't check the runner's pin."
    return 0
  fi
  if [ "$pinned_version" != "$PLAYWRIGHT_VERSION" ]; then
    die "e2e/package.json pins @playwright/test '$pinned_version', but the runner image is Playwright $PLAYWRIGHT_VERSION. Pin it exactly, or update PLAYWRIGHT_VERSION and PLAYWRIGHT_IMAGE (tag and digest) in dev/lib/common.sh."
  fi
}

RUNNER_READY=false

# Arguments after `--` on `dev/run test <suite> -- ...`, for the suite's test runner.
SUITE_EXTRA_ARGS=()

ensure_runner_ready() {
  if [ "$RUNNER_READY" = "true" ]; then
    return 0
  fi
  check_playwright_pin
  build_runner_image
  prepare_runner_volumes
  RUNNER_READY=true
}

# Extra `--env NAME=value` arguments for the next run_in_runner call (plugin-contract tells
# the tests which plugin install they face). Callers set and reset it.
RUNNER_EXTRA_ENV=()

# Runs a bash script in the runner, after `npm ci` when the lockfile changed since the last
# install into the node_modules volume. Output is also saved to test-results/<suite>/ (or
# test-results/<suite>/<subdirectory>/ when one is given), which is WPU_SUITE_RESULTS_DIR.
run_in_runner() {
  local suite="$1"
  local script="$2"
  local results_subdirectory="${3:-}"
  local results_dir
  results_dir="$(suite_results_dir "$suite")"
  if [ -n "$results_subdirectory" ]; then
    results_dir="$results_dir/$results_subdirectory"
  fi
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
  log_step "Suite $suite${results_subdirectory:+ ($results_subdirectory)}"
  compose_run \
    --env WPU_SUITE_RESULTS_DIR="$results_dir" \
    ${RUNNER_EXTRA_ENV[@]+"${RUNNER_EXTRA_ENV[@]}"} \
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

# The server tests read client/dist, so build first (as ci.yml does). dev/run's own tests
# (dev/tests/*.sh, dev/perf/*.test.mjs) run here too: they need no stack.
suite_unit() {
  run_in_runner unit '
    for dev_test in dev/tests/*.sh; do
      bash "$dev_test"
    done
    node --test "dev/perf/*.test.mjs"
    npm run build
    npm run test -w server
    if node -e "process.exit(require(\"./client/package.json\").scripts?.test ? 0 : 1)"; then
      npm run test -w client
    fi
  '
}

# ---- plugin-static ---------------------------------------------------------------------------

# Builds the plugin with P1's build script (plugin/scripts/build.mjs) in the runner, and checks
# that the single file D30 names exists.
build_plugin() {
  local suite="$1"
  local results_subdirectory="${2:-}"
  run_in_runner "$suite" 'node plugin/scripts/build.mjs' "$results_subdirectory"
  if [ ! -f "$PLUGIN_DIST_FILE" ]; then
    die "plugin/scripts/build.mjs didn't produce ${PLUGIN_DIST_FILE#"$REPO_ROOT"/} (D30)."
  fi
}

# php -l over everything under plugin/ (sources, scripts and, once built, the single file in
# plugin/dist/), on the oldest and newest supported PHP versions.
lint_plugin_php() {
  local php_service="$1"
  local results_dir="$2"
  local lint_script='
    set -eu
    php --version | head -n 1
    find plugin -name "*.php" -not -path "plugin/vendor/*" -not -path "*/node_modules/*" -print0 \
      | xargs -0 -n 1 php -l > /dev/null
    echo "php -l: no syntax errors"
  '
  log_step "plugin-static: php -l on $php_service"
  compose_run "$php_service" sh -c "$lint_script" 2>&1 | tee "$results_dir/$php_service-lint.log"
}

# php -l on PHP 7.4 over the shipped files only (the source and the built single file). The
# file can be dropped into mu-plugins, where WordPress doesn't check `Requires PHP`, so it must
# parse on old PHP for its minimum check to run and log (P1 handoff §2, CR-4). Tests and
# dev-only files may use newer syntax.
lint_shipped_plugin_php74() {
  local results_dir="$1"
  local lint_script='
    set -eu
    php --version | head -n 1
    find plugin/wp-upload-companion plugin/dist/wp-upload-companion -name "*.php" -print0 \
      | xargs -0 -n 1 php -l > /dev/null
    echo "php -l: no syntax errors in the shipped files"
  '
  log_step "plugin-static: php -l on php74 (shipped files)"
  compose_run php74 sh -c "$lint_script" 2>&1 | tee "$results_dir/php74-lint.log"
}

# PHPStan config files PHPStan itself picks up from plugin/.
plugin_phpstan_config() {
  local config_name
  for config_name in phpstan.neon phpstan.neon.dist phpstan.dist.neon; do
    if [ -f "$REPO_ROOT/plugin/$config_name" ]; then
      printf '%s' "$config_name"
      return 0
    fi
  done
  return 1
}

# PHPStan with WordPress stubs (D30): composer installs plugin/composer.lock from the pinned
# composer image into the plugin_vendor volume, then PHPStan runs on PHP 8.4.
run_plugin_phpstan() {
  local results_dir="$1"
  local config_name="$2"
  # The named volume starts out root-owned; composer runs as the host user.
  compose_run --user 0 --entrypoint chown composer "$WPU_UID:$WPU_GID" "$REPO_ROOT/plugin/vendor" >/dev/null

  log_step "plugin-static: composer install (plugin/composer.lock)"
  compose_run composer install --no-progress --prefer-dist 2>&1 | tee "$results_dir/composer.log"

  log_step "plugin-static: PHPStan ($config_name) on php84"
  compose_run \
    --workdir "$REPO_ROOT/plugin" \
    php84 php -d memory_limit=1G vendor/bin/phpstan analyse \
    --configuration="$config_name" \
    --no-progress \
    --no-interaction \
    2>&1 | tee "$results_dir/phpstan.log"
}

# plan §6: the single-file build and zip, `php -l` on PHP 8.1 and 8.4 (including the built
# file; the shipped files also on 7.4), and PHPStan. Everything that can run does; then a missing piece reports "not
# available yet", so the gate never passes without it.
suite_plugin_static() {
  if [ ! -d "$PLUGIN_SOURCE_DIR" ]; then
    not_available "plugin-static: plugin/wp-upload-companion/ doesn't exist yet (track P1)."
  fi
  local results_dir
  results_dir="$(suite_results_dir plugin-static)"
  mkdir -p "$results_dir"
  local missing=""

  if [ -f "$PLUGIN_BUILD_SCRIPT" ]; then
    build_plugin plugin-static
    lint_shipped_plugin_php74 "$results_dir"
  else
    missing="$missing plugin/scripts/build.mjs (track P1);"
  fi

  local php_service
  for php_service in php81 php84; do
    lint_plugin_php "$php_service" "$results_dir"
  done

  local config_name=""
  if [ ! -f "$REPO_ROOT/plugin/composer.lock" ]; then
    missing="$missing plugin/composer.json + composer.lock for PHPStan (track P1);"
  elif ! config_name="$(plugin_phpstan_config)"; then
    missing="$missing plugin/phpstan.neon(.dist) for PHPStan (track P1);"
  else
    run_plugin_phpstan "$results_dir" "$config_name"
  fi

  if [ -n "$missing" ]; then
    not_available "plugin-static: missing${missing%;}."
  fi
}

# ---- plugin-contract -------------------------------------------------------------------------

# The plugin API level the server requires (PLUGIN_API_REQUIRED in
# server/src/routes/library/bootstrap.ts), printed as "<major> <minMinor>". Why read the
# source: it is the one place the level is declared, so the oldest supported plugin follows
# it without a second number to keep in step (D48(4)).
server_required_plugin_api() {
  local declaration major min_minor
  declaration="$(grep -E 'PLUGIN_API_REQUIRED *= *\{' "$SERVER_PLUGIN_API_FILE" | head -n 1 || true)"
  major="$(printf '%s' "$declaration" | sed -n 's/.*major: *\([0-9][0-9]*\).*/\1/p')"
  min_minor="$(printf '%s' "$declaration" | sed -n 's/.*minMinor: *\([0-9][0-9]*\).*/\1/p')"
  if [ -z "$major" ] || [ -z "$min_minor" ]; then
    die "Could not read PLUGIN_API_REQUIRED = { major, minMinor } from ${SERVER_PLUGIN_API_FILE#"$REPO_ROOT"/}."
  fi
  printf '%s %s' "$major" "$min_minor"
}

# The contract level (WPU_API, "major.minor") of the plugin at a git ref, or nothing when that
# ref has no readable entry file.
plugin_api_at_ref() {
  local ref="$1"
  git -C "$REPO_ROOT" show "$ref:$PLUGIN_ENTRY_PATH" 2>/dev/null \
    | sed -n "s/^const WPU_API *= *'\([0-9][0-9]*\.[0-9][0-9]*\)'.*/\1/p" \
    | head -n 1
}

# True when a "major.minor" API level meets the server's required major and minMinor
# (contract §2.4: the same major, and at least that minor).
plugin_api_is_supported() {
  local api="$1"
  local required_major="$2"
  local required_min_minor="$3"
  local api_major="${api%%.*}"
  local api_minor="${api#*.}"
  if [ "$api_major" -ne "$required_major" ]; then
    return 1
  fi
  [ "$api_minor" -ge "$required_min_minor" ]
}

# The git ref of the oldest supported plugin release: the oldest `plugin-v*` tag whose WPU_API
# meets the server's PLUGIN_API_REQUIRED (D48(4)). Nothing before the first release, or when no
# release meets it (then the current build is the oldest). WPU_PLUGIN_OLDEST_REF overrides it
# with any git ref (for testing). Release tags are plain semver, so version order is enough.
oldest_supported_plugin_ref() {
  if [ -n "${WPU_PLUGIN_OLDEST_REF:-}" ]; then
    printf '%s' "$WPU_PLUGIN_OLDEST_REF"
    return 0
  fi
  local required required_major required_min_minor tag api
  required="$(server_required_plugin_api)"
  required_major="${required% *}"
  required_min_minor="${required#* }"
  for tag in $(git -C "$REPO_ROOT" tag --list 'plugin-v*' --sort=version:refname); do
    api="$(plugin_api_at_ref "$tag")"
    if [ -z "$api" ]; then
      continue
    fi
    if plugin_api_is_supported "$api" "$required_major" "$required_min_minor"; then
      printf '%s' "$tag"
      return 0
    fi
  done
}

# Builds the plugin as it was at a git ref, with that ref's own build script, into
# dev/.build/plugin-oldest/. Sets OLDEST_PLUGIN_DIST_DIR.
build_plugin_at_ref() {
  local ref="$1"
  log_step "plugin-contract: building the oldest supported plugin ($ref)"
  rm -rf "$OLDEST_PLUGIN_BUILD_ROOT"
  mkdir -p "$OLDEST_PLUGIN_BUILD_ROOT"
  git -C "$REPO_ROOT" archive "$ref" plugin | tar -x -C "$OLDEST_PLUGIN_BUILD_ROOT"
  local build_script="${OLDEST_PLUGIN_BUILD_ROOT#"$REPO_ROOT"/}/plugin/scripts/build.mjs"
  run_in_runner plugin-contract "node '$build_script'" oldest-build
  OLDEST_PLUGIN_DIST_DIR="$OLDEST_PLUGIN_BUILD_ROOT/plugin/dist/wp-upload-companion"
  if [ ! -f "$OLDEST_PLUGIN_DIST_DIR/wp-upload-companion.php" ]; then
    die "The build of $ref didn't produce plugin/dist/wp-upload-companion/wp-upload-companion.php."
  fi
}

# Puts the restored `small` stack into one of the three installs the contract tests run on
# (plan §2.6, D30):
#   plugin     the current build as a regular plugin (what every restore sets up)
#   oldest     the oldest supported build as a regular plugin, on a site without plugin state
#   mu-plugin  the current single file in mu-plugins/, on a site without plugin state
# "Without plugin state" runs the plugin's uninstall steps first, so schema creation without
# an activation hook (mu-plugins) and a fresh install of the old release are both exercised.
install_companion_for_contract_run() {
  local install_name="$1"
  restore_snapshot small
  after_restore
  case "$install_name" in
    plugin)
      ;;
    oldest)
      wpcli eval-file /opt/wpu/setup/companion-uninstall.php
      install_companion_build "$OLDEST_PLUGIN_DIST_DIR" plugin
      activate_plugin wp-upload-companion
      ;;
    mu-plugin)
      wpcli eval-file /opt/wpu/setup/companion-uninstall.php
      install_companion_build "$PLUGIN_DIST_DIR" mu-plugin
      ;;
    *)
      die "Unknown plugin install '$install_name'."
      ;;
  esac
}

# One contract run. The tests get WPU_PLUGIN_INSTALL=plugin|oldest|mu-plugin, and their results
# go to test-results/plugin-contract/<install>/. Records a failed run in CONTRACT_FAILED_RUNS.
run_contract_tests_on() {
  local install_name="$1"
  local status
  log_step "plugin-contract: the '$install_name' install"
  set +e
  (
    set -e
    install_companion_for_contract_run "$install_name"
    RUNNER_EXTRA_ENV=(--env "WPU_PLUGIN_INSTALL=$install_name")
    run_in_runner plugin-contract \
      "cd plugin && npx vitest run --config vitest.config.ts $(quoted_extra_args)" \
      "$install_name"
  )
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    CONTRACT_FAILED_RUNS="$CONTRACT_FAILED_RUNS $install_name"
  fi
}

# plan §6 and contract §2.4: the contract tests (P1's plugin/vitest.config.ts, run from
# plugin/) against the current build as a regular plugin, against the oldest supported build,
# and once with the build in mu-plugins/. The plugin is built first, so the integration job
# needs no plugin-static run. All three run even after a failure; the stack ends on the
# regular install again.
suite_plugin_contract() {
  if [ ! -f "$REPO_ROOT/plugin/vitest.config.ts" ]; then
    not_available "plugin-contract: plugin/vitest.config.ts and plugin/tests/contract/ don't exist yet (track P1)."
  fi
  if [ ! -f "$PLUGIN_BUILD_SCRIPT" ]; then
    not_available "plugin-contract: plugin/scripts/build.mjs doesn't exist yet (track P1)."
  fi
  build_plugin plugin-contract build
  prepare_live_stack

  local oldest_ref
  oldest_ref="$(oldest_supported_plugin_ref)"
  if [ -n "$oldest_ref" ]; then
    build_plugin_at_ref "$oldest_ref"
  else
    log_info "No plugin-v* release meets the server's PLUGIN_API_REQUIRED yet: the oldest supported build is the current build."
    OLDEST_PLUGIN_DIST_DIR="$PLUGIN_DIST_DIR"
  fi

  CONTRACT_FAILED_RUNS=""
  local install_name
  for install_name in plugin oldest mu-plugin; do
    run_contract_tests_on "$install_name"
  done

  log_step "Back to the regular install"
  restore_snapshot small
  after_restore
  collect_stack_logs
  if [ -n "$CONTRACT_FAILED_RUNS" ]; then
    log_warn "plugin-contract failed on:$CONTRACT_FAILED_RUNS"
    return 1
  fi
}

suite_server_live() {
  if [ ! -f "$REPO_ROOT/server/vitest.live.config.ts" ]; then
    not_available "server-live: server/vitest.live.config.ts doesn't exist yet (track S1)."
  fi
  prepare_live_stack
  run_in_runner server-live 'cd server && npx vitest run --config vitest.live.config.ts'
  collect_stack_logs
}

require_e2e_workspace() {
  local suite="$1"
  if [ ! -f "$REPO_ROOT/e2e/package.json" ] || [ ! -f "$REPO_ROOT/e2e/playwright.config.ts" ]; then
    not_available "$suite: the e2e/ workspace or e2e/playwright.config.ts doesn't exist yet."
  fi
}

# Arguments after `--` on the dev/run command line, shell-quoted for a runner script.
quoted_extra_args() {
  local quoted=""
  local argument
  for argument in ${SUITE_EXTRA_ARGS[@]+"${SUITE_EXTRA_ARGS[@]}"}; do
    quoted="$quoted $(printf '%q' "$argument")"
  done
  printf '%s' "$quoted"
}

# The VITE_MOCK build the proxy serves under /wp-upload-mock/ (CR-6 in the M0 handoff).
# Track F2's client/vite.mock.config.ts makes it (MSW and its worker included) and writes it
# to dev/.build/mock-dist/ (F2's CR-F2-6). Vite empties that directory but keeps it, so the
# proxy's mount stays valid.
mock_build_script() {
  printf '%s\n' 'npm run build:mock -w client'
}

# The mock project needs only the proxy (which serves the mock build), but the proxy is part
# of the test stack, so the stack must be up. No WordPress data is involved.
suite_e2e_mock() {
  require_e2e_workspace e2e-mock
  if ! stack_is_running; then
    cmd_up test
    prepare_stack test
  fi
  run_in_runner e2e-mock "
    ( $(mock_build_script) )
    npx playwright test --config e2e/playwright.config.ts --project=mock $(quoted_extra_args)
  "
}

# The live project drives the production image under /wp-upload/ against the restored
# `small` seed. The app is rebuilt first (cached layers), so it always runs this worktree's
# code. Live specs share one WordPress, so they run one at a time.
suite_e2e_live() {
  require_e2e_workspace e2e-live
  prepare_live_stack
  start_test_app
  run_in_runner e2e-live "
    npx playwright test --config e2e/playwright.config.ts --project=live --workers=1 $(quoted_extra_args)
  "
  collect_stack_logs
}

# plan §9 and spike X4: times the plugin's /collection, /facets and Uncategorized query (p95
# over 20 runs, budget 300 ms) on the `large` seed, plus core REST and FileBird's own queries
# as a baseline (dev/perf/measure.mjs). Seeds `large` first when there is no snapshot. The
# current plugin build is installed, so it measures this worktree's code.
# D46: a run over budget fails, unless WPU_PERF_REPORT_ONLY=true (the `[perf]` CI job: GitHub's
# runners are slower than the reference machine), which records and reports it only.
suite_perf() {
  if [ -f "$PLUGIN_BUILD_SCRIPT" ]; then
    build_plugin perf build
  fi
  if ! stack_is_running; then
    cmd_up test
    prepare_stack test
  fi
  if ! snapshot_exists large; then
    seed_large_profile
  fi
  log_step "Restoring the 'large' snapshot"
  restore_snapshot large
  after_restore

  local results_dir
  results_dir="$(suite_results_dir perf)"
  mkdir -p "$results_dir"
  log_step "perf: FileBird's own queries, in-process"
  wpcli eval-file /opt/wpu/perf/filebird-queries.php "${WPU_PERF_RUNS:-20}" \
    > "$results_dir/filebird-in-process.json"
  RUNNER_EXTRA_ENV=(
    --env "WPU_PERF_RUNS=${WPU_PERF_RUNS:-20}"
    --env "WPU_PERF_REPORT_ONLY=${WPU_PERF_REPORT_ONLY:-false}"
  )
  run_in_runner perf "node dev/perf/measure.mjs $(quoted_extra_args)"
  RUNNER_EXTRA_ENV=()
  collect_stack_logs
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
