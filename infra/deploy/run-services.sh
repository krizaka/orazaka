#!/usr/bin/env bash
# ==============================================================================
# Orazaka dev runtime — starts the JVM services of the image side by side (docs/DEPLOY_DEV.md).
# One container, several JVMs: the cheapest way to run the platform in dev. If one JVM exits, the
# others are stopped and the container exits non-zero, so App Platform restarts the whole set.
# Each JVM gets its own heap (ORAZAKA_HEAP_<NAME>, MiB) inside the container's memory; the rest is
# metaspace, code cache and thread stacks (virtual threads keep those small).
# ==============================================================================
set -euo pipefail

# A pack worker is supervised, never fatal: when it exits it is restarted after a backoff that doubles up
# to ORAZAKA_WORKER_BACKOFF_MAX seconds (reset after a run longer than that), and the JVMs keep serving.
# Only the JVMs are fatal (below): they are the platform; a worker is one capability.
supervise() {
  local name="$1"; shift
  local delay="${ORAZAKA_WORKER_BACKOFF_START:-2}" max="${ORAZAKA_WORKER_BACKOFF_MAX:-300}" started rc child="" nap=""
  # When the container is stopped the supervisor goes with its worker. Without this the container's `wait` hung on the
  # supervisor until the platform's SIGKILL and the old deployment's worker kept consuming the broker's queue next to the
  # new deployment's: a stray consumer running old pack code took half the validation jobs of a rolling deploy.
  trap '[[ -n "$child" ]] && kill -TERM "$child" 2>/dev/null; [[ -n "$nap" ]] && kill "$nap" 2>/dev/null; exit 0' TERM INT
  while true; do
    started=$(date +%s)
    "$@" &
    child=$!
    wait "$child" && rc=0 || rc=$?
    child=""
    if (( $(date +%s) - started > max )); then delay="${ORAZAKA_WORKER_BACKOFF_START:-2}"; fi
    echo "[run-services] worker $name exited (status $rc) — restarting in ${delay}s"
    sleep "$delay" &
    nap=$!
    wait "$nap" || true
    nap=""
    delay=$(( delay * 2 > max ? max : delay * 2 ))
  done
}

# The library mode of the tests (scripts/test/run-services.test.mjs): define, start nothing.
if [[ "${RUN_SERVICES_LIB:-}" == "1" ]]; then return 0 2>/dev/null || exit 0; fi


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

# name:jar:default-heap-MiB, in start order (edge last: it is the public port). knowledge serves the
# recommender (ADR-078) on :8084, reached through the edge's /api/v1/recommendations route.
SERVICES="${ORAZAKA_SERVICES:-users:users.jar:160 billing:billing.jar:160 job:job.jar:256 conversation:conversation.jar:320 studio:studio.jar:160 knowledge:knowledge.jar:128 edge:edge.jar:96}"

pids=()
workers=()
stop_all() {
  for pid in "${pids[@]}" "${workers[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
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

# Runs in the supervisor's own background process (`"$@" &`), so `cd` stays local and `exec` makes the worker that very
# process: the supervisor's TERM reaches the Python process itself, not a shell around it.
run_validation_worker() {
  cd "${ORAZAKA_APP_DIR:-/app}/orazaka-packs/document-validation/worker" || return 1
  SPRING_RABBITMQ_SSL_CA_FILE="${ORAZAKA_APP_DIR:-/app}/var/broker-ca.pem" \
    exec "${ORAZAKA_VALIDATION_PYTHON:-/opt/validation-venv/bin/python3}" -u validation_worker.py
}

# The Python workers of the packs, after the JVMs (the job service declares the topology they bind to). The dev broker
# is TLS only: the worker reads the same RABBITMQ_* and SPRING_RABBITMQ_SSL_ENABLED as the services, and the CA file
# written above (orazaka-packs document-validation/worker/broker.py).
for worker in ${ORAZAKA_WORKERS-validation}; do
  case "$worker" in
    validation)
      echo "[run-services] starting the document-validation worker (supervised)"
      supervise validation run_validation_worker > >(sed -u "s/^/[validation] /") 2>&1 &
      workers+=("$!")
      ;;
    *) echo "[run-services] unknown worker: $worker" >&2 ;;
  esac
done

# The first JVM to exit takes the container down with it (App Platform restarts the set).
set +e
wait -n "${pids[@]}"
status=$?
echo "[run-services] a service exited (status $status) — stopping the others"
stop_all
exit $(( status == 0 ? 1 : status ))
