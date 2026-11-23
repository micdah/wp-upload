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
set -eu

ca_root=/ca
server_names="DNS:wpu.test,DNS:wp.wpu.test,DNS:localhost"
validity_days=825

# Why: keep an existing CA, so containers that already trust it keep working.
ca_already_exists() {
  [ -s "$ca_root/public/ca.crt" ] && [ -s "$ca_root/private/ca.key" ] && [ -s "$ca_root/proxy/server.crt" ]
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

create_server_certificate() {
  extensions_file="$ca_root/private/server.ext"
  {
    echo "subjectAltName=$server_names"
    echo "basicConstraints=CA:FALSE"
    echo "keyUsage=digitalSignature,keyEncipherment"
    echo "extendedKeyUsage=serverAuth"
  } > "$extensions_file"

  openssl req \
    -newkey rsa:2048 \
    -nodes \
    -keyout "$ca_root/proxy/server.key" \
    -out "$ca_root/private/server.csr" \
    -subj "/CN=wpu.test" \
    2>/dev/null

  openssl x509 \
    -req \
    -in "$ca_root/private/server.csr" \
    -CA "$ca_root/public/ca.crt" \
    -CAkey "$ca_root/private/ca.key" \
    -CAcreateserial \
    -out "$ca_root/proxy/server.crt" \
    -days "$validity_days" \
    -extfile "$extensions_file" \
    2>/dev/null
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
  create_server_certificate
  echo "Created the dev CA and the proxy certificate."
fi
create_bundle
chmod 644 "$ca_root/public/ca.crt" "$ca_root/public/bundle.pem" "$ca_root/proxy/server.crt"
chmod 600 "$ca_root/proxy/server.key"
