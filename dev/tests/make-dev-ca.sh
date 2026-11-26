#!/usr/bin/env bash
# Tests for dev/lib/make-dev-ca.sh: the proxy certificate names WPU_BIND_ADDRESS when the stack
# listens on one specific address (LAN access by IP), and a changed address re-issues the
# certificate from the same CA, so a device that trusts the CA keeps trusting the stack.
# Runs in a scratch directory. Run by `dev/run test unit` (in the runner); also runnable on the
# host: bash dev/tests/make-dev-ca.sh
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MAKE_DEV_CA="$TESTS_DIR/../lib/make-dev-ca.sh"
SCRATCH_CA_ROOT="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_CA_ROOT"' EXIT

FAILURES=0

# Runs the CA script against the scratch directory with this bind address.
run_make_dev_ca() {
  local bind_address="$1"
  WPU_DEV_CA_ROOT="$SCRATCH_CA_ROOT" WPU_BIND_ADDRESS="$bind_address" sh "$MAKE_DEV_CA" 2>&1
}

proxy_certificate_names() {
  openssl x509 -in "$SCRATCH_CA_ROOT/proxy/server.crt" -noout -ext subjectAltName | tail -n 1 | tr -d ' '
}

ca_fingerprint() {
  openssl x509 -in "$SCRATCH_CA_ROOT/public/ca.crt" -noout -fingerprint -sha256
}

check() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok   $description"
  else
    echo "FAIL $description: expected '$expected', got '$actual'"
    FAILURES=$((FAILURES + 1))
  fi
}

check_issued() {
  local description="$1"
  local expected_issued="$2"
  local output="$3"
  local issued=false
  if printf '%s\n' "$output" | grep -q '^Issued the proxy certificate'; then
    issued=true
  fi
  check "$description" "$expected_issued" "$issued"
}

openssl_verifies() {
  if openssl verify -CAfile "$SCRATCH_CA_ROOT/public/ca.crt" "$SCRATCH_CA_ROOT/proxy/server.crt" >/dev/null 2>&1; then
    echo true
  else
    echo false
  fi
}

file_digest() {
  sha256sum "$1" | cut -d ' ' -f 1
}

# A failed signature (here: a damaged CA key) must leave the working key and certificate as
# they were, say why, and fail.
check_failed_issue_keeps_old_files() {
  local key_before certificate_before names_before status=0 output
  key_before="$(file_digest "$SCRATCH_CA_ROOT/proxy/server.key")"
  certificate_before="$(file_digest "$SCRATCH_CA_ROOT/proxy/server.crt")"
  names_before="$(cat "$SCRATCH_CA_ROOT/proxy/server.names")"
  cp "$SCRATCH_CA_ROOT/private/ca.key" "$SCRATCH_CA_ROOT/ca.key.saved"
  echo "not a key" > "$SCRATCH_CA_ROOT/private/ca.key"

  output="$(run_make_dev_ca 192.168.1.60)" || status=$?
  check "a failed signature fails the script" true "$([ "$status" -ne 0 ] && echo true || echo false)"
  check "it shows openssl's error" true \
    "$(printf '%s' "$output" | grep -q 'openssl failed to sign the proxy certificate' && echo true || echo false)"
  check "the key in place is unchanged" "$key_before" "$(file_digest "$SCRATCH_CA_ROOT/proxy/server.key")"
  check "the certificate in place is unchanged" "$certificate_before" "$(file_digest "$SCRATCH_CA_ROOT/proxy/server.crt")"
  check "server.names still describes them" "$names_before" "$(cat "$SCRATCH_CA_ROOT/proxy/server.names")"
  check "no temporary files are left" "" "$(find "$SCRATCH_CA_ROOT/proxy" -name '*.new')"

  mv "$SCRATCH_CA_ROOT/ca.key.saved" "$SCRATCH_CA_ROOT/private/ca.key"
}

main() {
  local output first_ca

  output="$(run_make_dev_ca 127.0.0.1)"
  check_issued "a new CA issues the proxy certificate" true "$output"
  check "loopback adds no IP" "DNS:wpu.test,DNS:wp.wpu.test,DNS:localhost" "$(proxy_certificate_names)"
  first_ca="$(ca_fingerprint)"

  output="$(run_make_dev_ca 127.0.0.1)"
  check_issued "the same names: nothing is re-issued" false "$output"

  output="$(run_make_dev_ca 0.0.0.0)"
  check_issued "0.0.0.0 names nothing new" false "$output"

  output="$(run_make_dev_ca 192.168.1.50)"
  check_issued "a specific address re-issues the certificate" true "$output"
  check "the certificate names the address" \
    "DNS:wpu.test,DNS:wp.wpu.test,DNS:localhost,IPAddress:192.168.1.50" "$(proxy_certificate_names)"
  check "the CA stays the same" "$first_ca" "$(ca_fingerprint)"
  check "the CA signed it" true "$(openssl_verifies)"

  output="$(run_make_dev_ca 'not-an-ip;DNS:evil')"
  check_issued "a value that isn't an IP is ignored (back to the plain names)" true "$output"
  check "nothing of it reaches the certificate" "DNS:wpu.test,DNS:wp.wpu.test,DNS:localhost" "$(proxy_certificate_names)"

  local not_an_address
  for not_an_address in beef 300.1.1.1 1.2.3 1.2.3.4.5; do
    run_make_dev_ca "$not_an_address" >/dev/null
    check "'$not_an_address' is not an IP address" "DNS:wpu.test,DNS:wp.wpu.test,DNS:localhost" "$(proxy_certificate_names)"
  done

  output="$(run_make_dev_ca fd00::5)"
  check_issued "an IPv6 address re-issues the certificate" true "$output"
  # openssl versions spell IPv6 addresses differently (FD00:0:…:5, fd00::5): compare loosely.
  check "the certificate names the IPv6 address" true \
    "$(proxy_certificate_names | grep -Eiq ',IPAddress:fd00(:0)*::?5$' && echo true || echo false)"

  check_failed_issue_keeps_old_files

  if [ "$FAILURES" -gt 0 ]; then
    echo "$FAILURES failure(s)"
    exit 1
  fi
  echo "make-dev-ca: all passed"
}

main
