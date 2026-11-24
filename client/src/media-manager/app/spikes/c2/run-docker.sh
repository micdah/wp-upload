#!/usr/bin/env bash
# Runs run-c2.mjs inside the Playwright runner image, which has Chromium,
# Firefox and WebKit for Playwright 1.65.1 (the host may only have Chromium).
# Vite must already serve client/ on port 5371 on the host.
#
#   client/src/media-manager/app/spikes/c2/run-docker.sh [chromium] [firefox] [webkit]
set -euo pipefail

readonly runner_image='wpu-runner:playwright-1.65.1'

# The repository root, mounted at the same path so file paths match.
repo_root() {
  local spike_dir
  spike_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  (cd "${spike_dir}/../../../../../.." && pwd)
}

main() {
  local root
  root="$(repo_root)"
  # --network host: the browsers reach Vite on the host's localhost.
  docker run \
    --rm \
    --network host \
    --volume "${root}:${root}" \
    --workdir "${root}" \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp \
    --env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    "${runner_image}" \
    node client/src/media-manager/app/spikes/c2/run-c2.mjs "$@"
}

main "$@"
