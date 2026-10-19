#!/bin/sh
# The relay's only configuration is its credential and the allow-list below (docs/DEPLOY_DEV.md § GPU).
# A client authenticated as `gpu` may open these remotes and no other: chisel matches each requested
# remote against the regular expressions of its user and refuses the connection otherwise.
set -eu
: "${AI_GPU_RELAY_PASSWORD:?AI_GPU_RELAY_PASSWORD is required}"
if [ "${#AI_GPU_RELAY_PASSWORD}" -lt 32 ]; then
  echo "gpu-relay: AI_GPU_RELAY_PASSWORD must be at least 32 characters" >&2
  exit 1
fi
case "$AI_GPU_RELAY_PASSWORD" in
  *[\"\\:]*) echo "gpu-relay: AI_GPU_RELAY_PASSWORD may not contain a quote, a backslash or a colon" >&2; exit 1 ;;
esac
umask 077
AUTHFILE=/tmp/gpu-relay-users.json
cat > "$AUTHFILE" <<JSON
{
  "gpu:${AI_GPU_RELAY_PASSWORD}": [
    "^broker-dev\\\\.orazaka\\\\.com:5671\$",
    "^core:8090\$",
    "^R:0\\\\.0\\\\.0\\\\.0:(8085|8086|8188|11434)\$"
  ]
}
JSON
exec chisel server --host 0.0.0.0 --port 8080 --reverse --authfile "$AUTHFILE" --keepalive 25s
