#!/usr/bin/env bash
# ==============================================================================
# The RunPod MEASUREMENT pod's boot (scripts/gpu-dev.sh runpod measure): the same runtime as runpod-bootstrap.sh, but the pod
# never joins the dev broker — no relay, no tunnel, no consumer, no credential beyond the HF token for public weights. It runs
# `python -m app.measure …` (orazaka-worker-media) and writes one JSON line per measure to /models/measure/<epoch>/results.jsonl
# (also on the network volume), then waits MEASURE_GRACE_MINUTES (default 15) for `scp`, and ends itself.
#
# Settings (environment): WORKER_REF, PROFILE, MEASURE_ARGS (the app.measure commands, `;` separated, e.g.
# "load wan2.2-ti2v-5b --mode volume;load wan2.2-ti2v-5b --mode stage;render wan2.2-ti2v-5b --steps 20"), MEASURE_PIP (extra pip
# requirements, e.g. "sageattention torchao"), IDLE_MINUTES, MAX_HOURS, HF_TOKEN (optional).
# ==============================================================================
set -uo pipefail
LOG=/var/log/orazaka-boot.log
exec > >(tee -a "$LOG") 2>&1
step() { echo "orazaka-gpu: $*"; }
STATE=/var/lib/orazaka-gpu
mkdir -p "$STATE/state" /models
touch "$STATE/state/last-activity"
echo "$(date +%s)" > "$STATE/boot-epoch"

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
      code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer ${RUNPOD_API_KEY}" "https://api.runpod.io/v2/pods/${RUNPOD_POD_ID}")
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

# --- 1. the runtime (venv on the volume, as the worker's pod) ---------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq ffmpeg curl git ca-certificates >/dev/null 2>&1
VENV=/models/venv
if [[ ! -x $VENV/bin/python ]]; then
  step "building the worker runtime (venv on the volume, torch cu128)"
  python3 -m venv $VENV
  $VENV/bin/pip install -q --no-cache-dir --upgrade pip
  $VENV/bin/pip install -q --no-cache-dir torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
fi
ln -sfn /models/venv /opt/venv
rm -rf /app-src && git clone -q https://github.com/krizaka/orazaka-worker-media.git /app-src
git -C /app-src checkout -q "${WORKER_REF:-main}"
/opt/venv/bin/pip install -q --no-cache-dir -r /app-src/requirements-cuda.txt
# shellcheck disable=SC2086 # MEASURE_PIP is a list of requirement words
[[ -z "${MEASURE_PIP:-}" ]] || /opt/venv/bin/pip install -q --no-cache-dir $MEASURE_PIP

# --- 2. weights (the volume keeps them between pods), the local NVMe stage ---------------------------
export MEDIA_MODELS_DIR=/models HF_HOME=/models/hf HF_HUB_CACHE=/models/hf/hub HF_HUB_DISABLE_TELEMETRY=1
export MEDIA_SCRATCH_DIR=/var/lib/orazaka-scratch MEDIA_MODELS_STAGE_DIR=/var/lib/orazaka-scratch/stage PYTHONUNBUFFERED=1
mkdir -p "$MEDIA_SCRATCH_DIR" "$MEDIA_MODELS_STAGE_DIR"
touch "$STATE/state/last-activity"
(cd /app-src && /opt/venv/bin/python -m app.fetch_models "${PROFILE:-big}")
step "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1); local disk: $(df -h /var/lib/orazaka-scratch | tail -1)"
touch "$STATE/ready"

# --- 3. the measures ------------------------------------------------------------------------------
OUT=/models/measure/$(date +%s); mkdir -p "$OUT"
step "measuring into $OUT"
IFS=';' read -ra RUNS <<< "${MEASURE_ARGS:-}"
for run in "${RUNS[@]}"; do
  [[ -n "${run// }" ]] || continue
  step "measure: $run"
  touch "$STATE/state/last-activity"
  # shellcheck disable=SC2086 # the run is a list of app.measure words
  (cd /app-src && /opt/venv/bin/python -m app.measure $run 2>"$OUT/last.err" | tail -1 >> "$OUT/results.jsonl") \
    || { step "measure failed: $run"; tail -n 20 "$OUT/last.err"; echo "{\"failed\":\"$run\"}" >> "$OUT/results.jsonl"; }
done
cp "$LOG" "$OUT/boot.log" 2>/dev/null; echo done > "$OUT/DONE"
step "done: $OUT/results.jsonl — waiting ${MEASURE_GRACE_MINUTES:-15} min to be collected, then this pod ends"
sleep $(( ${MEASURE_GRACE_MINUTES:-15} * 60 ))
/usr/local/bin/orazaka-watchdog --destroy "measures done and collected"
