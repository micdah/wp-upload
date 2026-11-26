#!/usr/bin/env bash
# Makes a TLS certificate for the mock dev server at this machine's LAN
# address, signed by the test stack's dev CA, so another device on the same
# network (the owner's iPad, D47) can open the mock over HTTPS.
#
# Why HTTPS: the mock backend runs in a service worker (MSW), and browsers
# only allow service workers in a secure context: https, or localhost.
#
# Usage (from the repo root):
#   dev/run up test                            # once: creates the dev CA
#   client/scripts/mock-lan-cert.sh 192.0.2.10 # your machine's LAN address
# It prints the exact command that starts the HTTPS mock dev server, and the
# CA file to install on the other device (iPad: open the file, install the
# profile in Settings, then turn on full trust under General → About →
# Certificate Trust Settings).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ca_dir="$repo_root/dev/.state/test/ca"
out_dir="$repo_root/dev/.build/mock-lan"
validity_days=90

# Why: say what is missing instead of failing inside openssl.
require_prerequisites() {
  local address="$1"
  if [ -z "$address" ]; then
    echo "Usage: $0 <LAN IP address of this machine>" >&2
    exit 2
  fi
  if ! command -v openssl >/dev/null; then
    echo "openssl is needed on the host." >&2
    exit 1
  fi
  if [ ! -s "$ca_dir/public/ca.crt" ] || [ ! -s "$ca_dir/private/ca.key" ]; then
    echo "No dev CA yet: run 'dev/run up test' once first." >&2
    exit 1
  fi
}

# Why: the certificate must name the address the other device types in.
write_extensions() {
  local address="$1"
  local extensions_file="$2"
  {
    echo "subjectAltName=IP:$address,DNS:localhost"
    echo "basicConstraints=CA:FALSE"
    echo "keyUsage=digitalSignature,keyEncipherment"
    echo "extendedKeyUsage=serverAuth"
  } > "$extensions_file"
}

# Why: openssl is chatty on success, so its output goes to a log that is
# shown only when a step fails.
fail_with_log() {
  local step="$1"
  echo "openssl failed while $step:" >&2
  cat "$out_dir/openssl.log" >&2
  exit 1
}

# Why: a fresh key and a certificate signed by the dev CA the device trusts.
sign_certificate() {
  local address="$1"
  local extensions_file="$2"
  openssl req \
    -newkey rsa:2048 \
    -nodes \
    -keyout "$out_dir/server.key" \
    -out "$out_dir/server.csr" \
    -subj "/CN=$address" \
    2>"$out_dir/openssl.log" || fail_with_log "creating the key and request"
  openssl x509 \
    -req \
    -in "$out_dir/server.csr" \
    -CA "$ca_dir/public/ca.crt" \
    -CAkey "$ca_dir/private/ca.key" \
    -CAcreateserial \
    -CAserial "$out_dir/ca.srl" \
    -out "$out_dir/server.crt" \
    -days "$validity_days" \
    -extfile "$extensions_file" \
    2>"$out_dir/openssl.log" || fail_with_log "signing the certificate"
}

# Why: absolute paths, so the commands work from any directory.
print_next_steps() {
  local address="$1"
  cat <<EOF
Wrote $out_dir/server.crt and server.key for $address.

Start the mock dev server over HTTPS:
  cd $repo_root
  WPU_MOCK_HTTPS_CERT=$out_dir/server.crt WPU_MOCK_HTTPS_KEY=$out_dir/server.key npm run dev:mock -w client

Install this CA on the other device and trust it fully:
  $ca_dir/public/ca.crt

Then open https://$address:<port Vite prints>/?view=library&mock-scenario=large&mock-images=picsum
EOF
}

main() {
  local address="${1:-}"
  require_prerequisites "$address"
  mkdir -p "$out_dir"
  local extensions_file="$out_dir/server.ext"
  write_extensions "$address" "$extensions_file"
  sign_certificate "$address" "$extensions_file"
  print_next_steps "$address"
}

main "$@"
