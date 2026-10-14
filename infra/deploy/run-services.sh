#!/usr/bin/env bash
# ==============================================================================
# Orazaka dev runtime — starts the JVM services of the image side by side (docs/DEPLOY_DEV.md).
# One container, several JVMs: the cheapest way to run the platform in dev. If one JVM exits, the
# others are stopped and the container exits non-zero, so App Platform restarts the whole set.
# Each JVM gets its own heap (ORAZAKA_HEAP_<NAME>, MiB) inside the container's memory; the rest is
# metaspace, code cache and thread stacks (virtual threads keep those small).
# ==============================================================================
set -euo pipefail

# The asset keyring (FileMasterKeyProvider): written from the MEDIA_ENCRYPTION_KEY secret, mode 0600,
# never logged. Without it the services that read or write assets refuse to start.
if [[ -n "${MEDIA_ENCRYPTION_KEY:-}" ]]; then
  mkdir -p "$HOME/.orazaka"
  umask 077
  printf '# orazaka master keyring v1\nactive = k1\nk1 = %s\n' "$MEDIA_ENCRYPTION_KEY" > "$HOME/.orazaka/master.key"
  chmod 0600 "$HOME/.orazaka/master.key"
  umask 022
fi
unset MEDIA_ENCRYPTION_KEY

# The broker's CA (TLS to the broker Droplet): Spring's SSL bundle `broker` reads this file.
if [[ -n "${RABBITMQ_CA_CERT_BASE64:-}" ]]; then
  mkdir -p "${ORAZAKA_APP_DIR:-/app}/var"
  printf '%s' "$RABBITMQ_CA_CERT_BASE64" | base64 -d > "${ORAZAKA_APP_DIR:-/app}/var/broker-ca.pem"
fi

# Shared JVM settings: small footprint first (serial GC, C1 only, bounded code cache), heap per service.
COMMON_OPTS="${ORAZAKA_JAVA_OPTS:--XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:ReservedCodeCacheSize=48m -XX:MaxDirectMemorySize=64m -Xss512k -XX:+ExitOnOutOfMemoryError -Djava.security.egd=file:/dev/./urandom}"

# name:jar:default-heap-MiB, in start order (edge last: it is the public port).
SERVICES="${ORAZAKA_SERVICES:-users:users.jar:160 job:job.jar:256 conversation:conversation.jar:320 studio:studio.jar:160 edge:edge.jar:96}"

pids=()
stop_all() {
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  wait || true
}
trap 'stop_all; exit 143' TERM INT

for entry in $SERVICES; do
  IFS=: read -r name jar heap <<<"$entry"
  var="ORAZAKA_HEAP_${name^^}"
  heap="${!var:-$heap}"
  echo "[run-services] starting $name (heap ${heap}m)"
  # shellcheck disable=SC2086
  java $COMMON_OPTS -Xms64m -Xmx"${heap}"m -jar "${ORAZAKA_APP_DIR:-/app}/$jar" \
    > >(sed -u "s/^/[$name] /") 2>&1 &
  pids+=("$!")
  sleep "${ORAZAKA_START_STAGGER_SECONDS:-5}"
done

# The first JVM to exit takes the container down with it.
set +e
wait -n
status=$?
echo "[run-services] a service exited (status $status) — stopping the others"
stop_all
exit $(( status == 0 ? 1 : status ))
