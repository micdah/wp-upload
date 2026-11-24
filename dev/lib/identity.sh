# shellcheck shell=bash
# Per-worktree stack identity: the compose project name and the host port block (plan §5.3).
#
# Why: parallel worktrees and parallel CI jobs must never share a stack. Variant toggles and
# resets are global to a stack, each worktree mounts its own plugin source, and fixed names or
# ports would collide. Both the name and the ports derive from a hash of the worktree path.
#
# WPU_WORKTREE_PATH overrides the path that is hashed (for tests of the derivation, or to give
# a checkout a stable identity after moving it).

PORT_RANGE_START=20000
PORT_BLOCK_SIZE=20
PORT_BLOCK_COUNT=400

# Offsets inside a block. `dev` and `test` use separate halves, so both modes of one worktree
# can run at the same time.
PORT_OFFSET_DEV_WORDPRESS=0
PORT_OFFSET_DEV_SERVER=1
PORT_OFFSET_DEV_VITE=2
PORT_OFFSET_TEST_PROXY=10

identity_path() {
  printf '%s' "${WPU_WORKTREE_PATH:-$REPO_ROOT}"
}

sha256_of_text() {
  local text="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$text" | sha256sum | cut -c1-64
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$text" | shasum -a 256 | cut -c1-64
  else
    die "Neither sha256sum nor shasum is available."
  fi
}

worktree_hash() {
  sha256_of_text "$(identity_path)" | cut -c1-10
}

# A readable prefix from the directory name, so `docker ps` shows which worktree a stack
# belongs to. Compose project names allow only lowercase letters, digits, '-' and '_'.
worktree_slug() {
  local directory_name
  directory_name="$(basename "$(identity_path)")"
  printf '%s' "$directory_name" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]/-/g' -e 's/--*/-/g' -e 's/^-//' \
    | cut -c1-16 \
    | sed -e 's/-$//'
}

project_name_for_mode() {
  local mode="$1"
  local slug
  slug="$(worktree_slug)"
  if [ -z "$slug" ]; then
    slug="worktree"
  fi
  printf 'wpu-%s-%s-%s' "$slug" "$(worktree_hash)" "$mode"
}

# The block the hash points at; the start of the search for a free block.
preferred_port_block_index() {
  local hash
  hash="$(worktree_hash)"
  echo $(( 16#${hash:0:8} % PORT_BLOCK_COUNT ))
}

port_block_start() {
  local block_index="$1"
  echo $(( PORT_RANGE_START + block_index * PORT_BLOCK_SIZE ))
}

port_block_index_of() {
  local block_start="$1"
  echo $(( (block_start - PORT_RANGE_START) / PORT_BLOCK_SIZE ))
}

# The ports a mode publishes or that its host processes (server, Vite) listen on.
mode_port_offsets() {
  local mode="$1"
  case "$mode" in
    dev)
      echo "$PORT_OFFSET_DEV_WORDPRESS $PORT_OFFSET_DEV_SERVER $PORT_OFFSET_DEV_VITE"
      ;;
    test)
      echo "$PORT_OFFSET_TEST_PROXY"
      ;;
    *)
      die "Unknown mode '$mode'."
      ;;
  esac
}

# The one port Docker publishes for the mode.
mode_docker_port_offset() {
  local mode="$1"
  case "$mode" in
    dev)
      echo "$PORT_OFFSET_DEV_WORDPRESS"
      ;;
    test)
      echo "$PORT_OFFSET_TEST_PROXY"
      ;;
  esac
}

# True when nothing accepts connections on the port.
port_is_free() {
  local port="$1"
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    return 1
  fi
  return 0
}

block_is_free_for_mode() {
  local mode="$1"
  local block_start="$2"
  local offset
  for offset in $(mode_port_offsets "$mode"); do
    if ! port_is_free $(( block_start + offset )); then
      return 1
    fi
  done
  return 0
}

# Only service containers count: a one-off (`compose run`, e.g. the runner building the
# plugin) that is still exiting must not make a stopped stack look like it runs.
project_has_running_containers() {
  local project_name="$1"
  local container_ids
  container_ids="$(docker ps --quiet \
    --filter "label=com.docker.compose.project=$project_name" \
    --filter "label=com.docker.compose.oneoff=False")"
  [ -n "$container_ids" ]
}

# Picks the port block for a mode:
# - keep the recorded block while our stack runs, or while its Docker port is still free
#   (so URLs in .env.wp, browser tabs and seeded content stay valid);
# - otherwise walk from the hash's preferred block to the next block whose ports are all free.
choose_port_block() {
  local mode="$1"
  local recorded_block_start="$2"
  local project_name="$3"

  if [ -n "$recorded_block_start" ]; then
    local docker_port=$(( recorded_block_start + $(mode_docker_port_offset "$mode") ))
    if project_has_running_containers "$project_name"; then
      echo "$recorded_block_start"
      return 0
    fi
    if port_is_free "$docker_port"; then
      echo "$recorded_block_start"
      return 0
    fi
    log_warn "Port $docker_port of the recorded block is taken; choosing another block."
  fi

  local start_index attempt block_index block_start
  start_index="$(preferred_port_block_index)"
  for (( attempt = 0; attempt < PORT_BLOCK_COUNT; attempt++ )); do
    block_index=$(( (start_index + attempt) % PORT_BLOCK_COUNT ))
    block_start="$(port_block_start "$block_index")"
    if block_is_free_for_mode "$mode" "$block_start"; then
      echo "$block_start"
      return 0
    fi
  done
  die "No free port block between $PORT_RANGE_START and $(( PORT_RANGE_START + PORT_BLOCK_SIZE * PORT_BLOCK_COUNT - 1 ))."
}
