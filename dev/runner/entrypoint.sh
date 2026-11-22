#!/bin/bash
# Entrypoint of the `runner` image. It runs as the host user (dev/run passes
# --user "$(id -u):$(id -g)"), with a writable tmpfs HOME.
#
# Why: the dev CA must be trusted by everything that talks to the stack over TLS (plan §5.3),
# but the runner isn't root, so it can't touch the system store. Instead it builds a per-run
# bundle for Node, curl and git, and an NSS database for Chromium.
set -euo pipefail

dev_ca_certificate="${WPU_DEV_CA_CERT:-}"

# Chromium on Linux reads user certificates from ~/.pki/nssdb.
trust_dev_ca_in_chromium() {
  local nss_database="$HOME/.pki/nssdb"
  mkdir -p "$nss_database"
  if [ ! -f "$nss_database/cert9.db" ]; then
    certutil -d "sql:$nss_database" -N --empty-password
  fi
  certutil \
    -d "sql:$nss_database" \
    -A \
    -t "C,," \
    -n "wp-upload dev CA" \
    -i "$dev_ca_certificate"
}

# Node (NODE_EXTRA_CA_CERTS, set by compose) and OpenSSL-based tools (SSL_CERT_FILE) get the
# system roots plus the dev CA.
trust_dev_ca_in_system_bundle() {
  local bundle="$HOME/ca-bundle.pem"
  cat /etc/ssl/certs/ca-certificates.crt "$dev_ca_certificate" > "$bundle"
  export SSL_CERT_FILE="$bundle"
  export GIT_SSL_CAINFO="$bundle"
}

if [ -n "$dev_ca_certificate" ] && [ -r "$dev_ca_certificate" ]; then
  trust_dev_ca_in_chromium
  trust_dev_ca_in_system_bundle
fi

exec "$@"
