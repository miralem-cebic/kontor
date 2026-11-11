#!/usr/bin/env bash
# Smoke test of the container image (ADR 0007): starts it the way compose.yaml does and checks what a browser needs.
# Usage: scripts/docker-smoke.sh [image]      (default: kontor:test, built with: docker build -t kontor:test .)
set -euo pipefail

IMAGE="${1:-kontor:test}"
NAME="kontor-smoke-$$"
PORT="${KONTOR_SMOKE_PORT:-18080}"
URL="http://127.0.0.1:${PORT}"
failed=0

cleanup() { docker rm -f "$NAME" > /dev/null 2>&1 || true; }
trap cleanup EXIT

check() { # check "what" command...
  local what="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "ok    $what"
  else
    echo "FAIL  $what"
    failed=1
  fi
}

docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8080" --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges:true "$IMAGE" > /dev/null

for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$URL/" 2> /dev/null && break
  sleep 1
done

headers="$(curl -sS -D - -o /dev/null "$URL/")"
script_headers="$(curl -sS -D - -o /dev/null "$URL/assets/app.js")"
gzip_headers="$(curl -sS -H 'Accept-Encoding: gzip' -D - -o /dev/null "$URL/assets/app.js")"
page="$(curl -sS "$URL/")"

status_of() { curl -s -o /dev/null -w '%{http_code}' "$URL$1"; }
csp() { grep -i '^content-security-policy:' <<< "$headers"; }
health() { docker inspect -f '{{.State.Health.Status}}' "$NAME"; }

page_is_app() { grep -q '<div id="root">' <<< "$page"; }
script_is_js() { grep -qi '^content-type: .*javascript' <<< "$script_headers"; }
page_has_no_module() { ! grep -q 'type="module"' <<< "$page"; }
csp_is_closed() { csp | grep -q "connect-src 'none'" && csp | grep -q "frame-ancestors 'none'"; }
no_sniffing() { grep -qi '^x-content-type-options: nosniff' <<< "$headers"; }
asks_again() { grep -qi '^cache-control: no-cache' <<< "$headers"; }
script_is_gzipped() { grep -qi '^content-encoding: gzip' <<< "$gzip_headers"; }
unknown_is_404() { [ "$(status_of /nope)" = 404 ]; }
no_listing() { [ "$(status_of /assets/)" != 200 ]; }
not_root() { [ "$(docker exec "$NAME" id -u)" != 0 ]; }
is_healthy() { [ "$(health)" = healthy ]; }

check "the page is served" curl -fsS -o /dev/null "$URL/"
check "the page is the app" page_is_app
check "the script is served as JavaScript" script_is_js
check "the page is a classic script, no module" page_has_no_module
check "Content-Security-Policy has connect-src 'none' and frame-ancestors 'none'" csp_is_closed
check "X-Content-Type-Options is nosniff" no_sniffing
check "Cache-Control is no-cache" asks_again
check "the script is compressed" script_is_gzipped
check "an unknown path is 404, not the page" unknown_is_404
check "no directory listing" no_listing
check "the container does not run as root" not_root

for _ in $(seq 1 20); do
  is_healthy && break
  sleep 2
done
check "the health check passes" is_healthy

exit "$failed"
