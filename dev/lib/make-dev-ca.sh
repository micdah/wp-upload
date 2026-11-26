#!/bin/sh
# Creates the `test` mode's dev CA and the proxy's server certificate (plan §5.3).
# Runs inside the `ca` one-off service (dev/compose.yml) as the host user, so `dev/run` needs
# nothing on the host but Docker. The CA is trusted only by containers in the stack.
#
# Layout under /ca (dev/.state/test/ca on the host):
#   private/ca.key            CA key, mounted nowhere
#   public/ca.crt             CA certificate, mounted into wordpress, wpcli, app and runner
#   public/bundle.pem         Mozilla roots plus the CA, for WordPress's HTTP API
#   proxy/server.{crt,key}    the proxy's certificate for wpu.test and wp.wpu.test
#   proxy/server.names        the subjectAltName the certificate was issued for
#
# WPU_BIND_ADDRESS (from dev/run): when the stack listens on one specific address (not
# 127.0.0.1 or 0.0.0.0), the proxy certificate also names that IP, so a device on the LAN
# (a tablet, say) can open the stack by IP once it trusts the dev CA.
set -eu

ca_root="${WPU_DEV_CA_ROOT:-/ca}"
base_server_names="DNS:wpu.test,DNS:wp.wpu.test,DNS:localhost"
validity_days=825

# Why: a dotted IPv4 address with four octets of 0-255, so nothing else reaches the
# certificate's extensions file.
is_ipv4_address() {
  candidate="$1"
  if ! printf '%s' "$candidate" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
    return 1
  fi
  old_ifs="$IFS"
  IFS=.
  # shellcheck disable=SC2086 # split on the dots on purpose
  set -- $candidate
  IFS="$old_ifs"
  for octet in "$@"; do
    if [ "$octet" -gt 255 ]; then
      return 1
    fi
  done
  return 0
}

# Why: an IPv6 address has at least one colon and only hex digits and colons (no zone id).
is_ipv6_address() {
  candidate="$1"
  case "$candidate" in
    *:*)
      printf '%s' "$candidate" | grep -Eq '^[0-9A-Fa-f:]+$'
      ;;
    *)
      return 1
      ;;
  esac
}

# Why: only a specific address is worth naming. Loopback is covered by `localhost` (and
# reached as wpu.test), and 0.0.0.0 is no address a client can open. Anything that isn't a
# plain IPv4 or IPv6 address is ignored, so it can't change the extensions file.
bind_address_san() {
  bind_address="${WPU_BIND_ADDRESS:-}"
  case "$bind_address" in
    "" | 127.0.0.1 | 0.0.0.0 | :: | ::1)
      return 0
      ;;
  esac
  if is_ipv4_address "$bind_address" || is_ipv6_address "$bind_address"; then
    printf ',IP:%s' "$bind_address"
  else
    echo "WPU_BIND_ADDRESS '$bind_address' is not an IP address; the proxy certificate won't name it." >&2
  fi
}

server_names="$base_server_names$(bind_address_san)"

# Why: keep an existing CA, so containers (and devices) that already trust it keep working.
ca_already_exists() {
  [ -s "$ca_root/public/ca.crt" ] && [ -s "$ca_root/private/ca.key" ]
}

# Why: the proxy certificate is re-issued (by the same CA) when the names it must carry
# changed, e.g. after WPU_BIND_ADDRESS was set.
server_certificate_is_current() {
  [ -s "$ca_root/proxy/server.crt" ] \
    && [ -s "$ca_root/proxy/server.names" ] \
    && [ "$(cat "$ca_root/proxy/server.names")" = "$server_names" ]
}

create_ca() {
  openssl req \
    -x509 \
    -newkey rsa:2048 \
    -nodes \
    -keyout "$ca_root/private/ca.key" \
    -out "$ca_root/public/ca.crt" \
    -days "$validity_days" \
    -subj "/CN=wp-upload dev CA (local test stack only)" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    2>/dev/null
}

# Why: openssl is quiet on success; on failure its own message is what explains it.
fail_with_openssl_errors() {
  step="$1"
  echo "error: openssl failed to $step:" >&2
  cat "$openssl_errors" >&2
  rm -f "$new_key" "$new_certificate" "$openssl_errors"
  exit 1
}

# Issues the key and certificate under temporary names and moves them into place only once
# both exist, so a failure never leaves a key that doesn't match the certificate (the proxy
# wouldn't start). server.names goes last: it says which names the files in place carry.
create_server_certificate() {
  extensions_file="$ca_root/private/server.ext"
  new_key="$ca_root/proxy/server.key.new"
  new_certificate="$ca_root/proxy/server.crt.new"
  openssl_errors="$ca_root/private/openssl.log"
  {
    echo "subjectAltName=$server_names"
    echo "basicConstraints=CA:FALSE"
    echo "keyUsage=digitalSignature,keyEncipherment"
    echo "extendedKeyUsage=serverAuth"
  } > "$extensions_file"

  if ! openssl req \
    -newkey rsa:2048 \
    -nodes \
    -keyout "$new_key" \
    -out "$ca_root/private/server.csr" \
    -subj "/CN=wpu.test" \
    2>"$openssl_errors"; then
    fail_with_openssl_errors "create the proxy key"
  fi

  if ! openssl x509 \
    -req \
    -in "$ca_root/private/server.csr" \
    -CA "$ca_root/public/ca.crt" \
    -CAkey "$ca_root/private/ca.key" \
    -CAcreateserial \
    -out "$new_certificate" \
    -days "$validity_days" \
    -extfile "$extensions_file" \
    2>"$openssl_errors"; then
    fail_with_openssl_errors "sign the proxy certificate"
  fi

  mv "$new_key" "$ca_root/proxy/server.key"
  mv "$new_certificate" "$ca_root/proxy/server.crt"
  printf '%s' "$server_names" > "$ca_root/proxy/server.names"
  rm -f "$openssl_errors"
}

# Why: WordPress's HTTP API takes one bundle file, so it needs the public roots too.
create_bundle() {
  cat /etc/ssl/certs/ca-certificates.crt "$ca_root/public/ca.crt" > "$ca_root/public/bundle.pem"
}

mkdir -p "$ca_root/private" "$ca_root/public" "$ca_root/proxy"
chmod 700 "$ca_root/private"

if ca_already_exists; then
  echo "Dev CA already exists."
else
  create_ca
  echo "Created the dev CA."
fi
if server_certificate_is_current; then
  echo "Proxy certificate already exists."
else
  create_server_certificate
  # dev/run restarts a running proxy when it sees this line.
  echo "Issued the proxy certificate for $server_names."
fi
create_bundle
chmod 644 "$ca_root/public/ca.crt" "$ca_root/public/bundle.pem" "$ca_root/proxy/server.crt"
chmod 600 "$ca_root/proxy/server.key"
