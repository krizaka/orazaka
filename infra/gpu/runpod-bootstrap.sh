#!/usr/bin/env bash
# ==============================================================================
# The RunPod pod's boot (scripts/gpu-dev.sh runpod start) — the same worker as the DigitalOcean droplet, in one container.
#
# A RunPod pod is a single container (no Docker inside), on a base image that already has CUDA, Python and sshd. So the
# CUDA image of orazaka-worker-media (private on GHCR) is not pulled: this script builds the same runtime in place from the
# worker's public repository — the venv of Dockerfile.cuda, the requirements, the code at WORKER_REF — then fetches the
# weights ONCE onto the network volume (/models: a restart does not download them again), opens the chisel tunnel to the
# relay of dev.orazaka.com and runs the consumer. Nothing listens publicly but sshd (the key of this machine only).
#
# Settings come from the environment gpu-dev.sh gives the pod (credentials included, never printed): WORKER_REF, PROFILE,
# RELAY_URL, RELAY_AUTH, RABBIT_PASSWORD, SERVICE_TOKEN, BROKER_CA_B64, IDLE_MINUTES, MAX_HOURS.
# ==============================================================================
set -uo pipefail
LOG=/var/log/orazaka-boot.log
exec > >(tee -a "$LOG") 2>&1
step() { echo "orazaka-gpu: $*"; }
STATE=/var/lib/orazaka-gpu
mkdir -p "$STATE/state" "$STATE/uploads" /models
touch "$STATE/state/last-activity"
boot=$(date +%s)
echo "$boot" > "$STATE/boot-epoch"

# --- 0. the watchdog first: whatever fails below, this pod still ends --------------------------------
cat > /usr/local/bin/orazaka-watchdog <<'WD'
#!/usr/bin/env bash
# Ends THIS pod. RunPod injects RUNPOD_POD_ID and a pod-scoped RUNPOD_API_KEY into the container's first process; a shell
# started later (ssh) may not see them, so they are read from /proc/1/environ when absent. Two ways, in order: the REST
# API with that key, then `runpodctl remove pod` (installed on RunPod's images, it authenticates with the same key).
pod_env() { tr '\0' '\n' < /proc/1/environ 2>/dev/null | sed -n "s/^$1=//p" | head -1; }
RUNPOD_POD_ID="${RUNPOD_POD_ID:-$(pod_env RUNPOD_POD_ID)}"
RUNPOD_API_KEY="${RUNPOD_API_KEY:-$(pod_env RUNPOD_API_KEY)}"
destroy_pod() {
  echo "orazaka-gpu: destroying pod ${RUNPOD_POD_ID:-?}: $1"
  [[ -n "${RUNPOD_POD_ID:-}" ]] || { echo "orazaka-gpu: no RUNPOD_POD_ID: cannot destroy"; return 1; }
  local attempt code
  if [[ -n "${RUNPOD_API_KEY:-}" ]]; then
    for attempt in 1 2 3; do
      code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer ${RUNPOD_API_KEY}" "https://rest.runpod.io/v1/pods/${RUNPOD_POD_ID}")
      [[ "$code" == "200" || "$code" == "204" || "$code" == "404" ]] && { echo "orazaka-gpu: destroyed through the API ($code)"; return 0; }
      echo "orazaka-gpu: API answered $code (attempt $attempt)"; sleep 5
    done
  else
    echo "orazaka-gpu: no RUNPOD_API_KEY in the pod's environment"
  fi
  if command -v runpodctl >/dev/null 2>&1 && runpodctl remove pod "$RUNPOD_POD_ID"; then echo "orazaka-gpu: destroyed through runpodctl"; return 0; fi
  echo "orazaka-gpu: could not destroy the pod: the local guard (gpu-dev.sh runpod loop) is the backstop"
  return 1
}
if [[ "${1:-}" == "--destroy" ]]; then destroy_pod "${2:-requested}"; exit $?; fi
STATE=/var/lib/orazaka-gpu; IDLE=${IDLE_MINUTES:-30}; MAX=${MAX_HOURS:-10}; SETUP=${SETUP_MAX_MINUTES:-120}
boot=$(cat /var/lib/orazaka-gpu/boot-epoch)
while sleep 60; do
  now=$(date +%s)
  util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  [[ "${util:-0}" =~ ^[0-9]+$ ]] && (( util >= 20 )) && touch $STATE/state/last-activity
  [[ ! -e $STATE/ready ]] && (( now - boot < SETUP * 60 )) && touch $STATE/state/last-activity
  last=$(stat -c %Y $STATE/state/last-activity); idle=$(( (now - last) / 60 )); age=$(( (now - boot) / 60 ))
  reason=""
  (( idle >= IDLE )) && reason="idle for ${idle} min"
  (( age >= MAX * 60 )) && reason="lifetime of ${MAX} h reached"
  [[ ! -e $STATE/ready ]] && (( age >= SETUP )) && reason="setup unfinished after ${age} min"
  [[ -z "$reason" ]] && continue
  destroy_pod "$reason" && exit 0
  sleep 120   # retried every few minutes: a pod that cannot end itself must not stay silent
done
WD
chmod +x /usr/local/bin/orazaka-watchdog
nohup /usr/local/bin/orazaka-watchdog > /var/log/orazaka-watchdog.log 2>&1 &
step "watchdog armed (idle ${IDLE_MINUTES:-30} min, lifetime ${MAX_HOURS:-10} h)"

# --- 1. the runtime (once per container disk; the weights are on the volume) --------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq ffmpeg curl git ca-certificates >/dev/null 2>&1
if [[ ! -x /opt/venv/bin/python ]]; then
  step "building the worker runtime (venv, torch cu128, requirements)"
  python3 -m venv /opt/venv
  /opt/venv/bin/pip install -q --no-cache-dir --upgrade pip
  /opt/venv/bin/pip install -q --no-cache-dir torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
fi
rm -rf /app-src && git clone -q https://github.com/krizaka/orazaka-worker-media.git /app-src
git -C /app-src checkout -q "${WORKER_REF:-main}"
/opt/venv/bin/pip install -q --no-cache-dir -r /app-src/requirements-cuda.txt
step "worker runtime ready: orazaka-worker-media@$(git -C /app-src rev-parse --short=12 HEAD)"

# --- 2. chisel, the tunnel client ---------------------------------------------------------------------
if ! command -v chisel >/dev/null; then
  curl -fsSL "https://github.com/jpillora/chisel/releases/download/v1.10.1/chisel_1.10.1_linux_amd64.gz" | gunzip > /usr/local/bin/chisel && chmod +x /usr/local/bin/chisel
fi
mkdir -p /etc/orazaka && printf '%s' "$BROKER_CA_B64" | base64 -d > /etc/orazaka/broker-ca.pem

# --- 3. weights, once, onto the network volume --------------------------------------------------------
export MEDIA_MODELS_DIR=/models HF_HOME=/models/hf HF_HUB_CACHE=/models/hf/hub HF_HUB_DISABLE_TELEMETRY=1
touch "$STATE/state/last-activity"
started=$(date +%s)
(cd /app-src && /opt/venv/bin/python -m app.fetch_models "${PROFILE:-big}")
step "weights ready in $(( $(date +%s) - started ))s"
step "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"

# --- 4. the tunnel and the worker ---------------------------------------------------------------------
# The same remotes as the droplet: the broker and the job service IN, the worker's pipeline back into the app.
AUTH="$RELAY_AUTH" nohup chisel client --keepalive 25s --max-retry-interval 30s "$RELAY_URL" \
  127.0.0.1:15671:broker-dev.orazaka.com:5671 127.0.0.1:18090:core:8090 R:0.0.0.0:8188:127.0.0.1:8188 \
  > /var/log/orazaka-relay.log 2>&1 &
cd /app-src
export SPRING_RABBITMQ_HOST=127.0.0.1 SPRING_RABBITMQ_PORT=15671 SPRING_RABBITMQ_USERNAME=gpu-worker \
  SPRING_RABBITMQ_SSL_ENABLED=true SPRING_RABBITMQ_SSL_CA_FILE=/etc/orazaka/broker-ca.pem \
  SPRING_RABBITMQ_SSL_SERVER_NAME=broker-dev.orazaka.com \
  MEDIA_ASSET_SINK_URL=http://127.0.0.1:18090 JOB_SERVICE_INTERNAL_URL=http://127.0.0.1:18090 \
  UPLOAD_DIR="$STATE/uploads" MEDIA_ACTIVITY_FILE="$STATE/state/last-activity" MEDIA_GPU_PROFILE="${PROFILE:-big}" \
  ORAZAKA_MEDIA_MEM_HEADROOM_GB=4 PYTHONUNBUFFERED=1 MEDIA_WORKER_PORT=8188
SPRING_RABBITMQ_PASSWORD="$RABBIT_PASSWORD" ORAZAKA_SERVICE_TOKEN="$SERVICE_TOKEN" \
  nohup /opt/venv/bin/python -u -m app.consumer > /var/log/orazaka-worker.log 2>&1 &
touch "$STATE/ready" "$STATE/state/last-activity"
step "serving: worker (${PROFILE:-big}), relay → ${RELAY_URL}"
wait
