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
# Before any self-destroy the pod leaves its end reason and its boot log OFF the pod (Bunny, layout v2: apps/orazaka/gpu-pods/<pod>/),
# so a pod that is gone is still explained (krizaka-internal#2121). Best effort: a failure here never blocks the destroy.
for v in MEDIA_STORAGE_API_KEY MEDIA_STORAGE_ZONE MEDIA_STORAGE_ENDPOINT; do
  [[ -n "${!v:-}" ]] || export "$v=$(pod_env "$v")"
done
leave_trace() {
  local st=${ORAZAKA_STATE:-/var/lib/orazaka-gpu} base
  if [[ -z "${MEDIA_STORAGE_API_KEY:-}" || -z "${MEDIA_STORAGE_ZONE:-}" ]]; then echo "orazaka-gpu: no storage settings: the end reason stays on the pod"; return 0; fi
  base="https://${MEDIA_STORAGE_ENDPOINT:-storage.bunnycdn.com}/${MEDIA_STORAGE_ZONE}/apps/orazaka/gpu-pods/${RUNPOD_POD_ID:-unknown}"
  local boot_epoch=0 now beat=-1 free progress="" ready=false
  now=$(date +%s)
  [[ -r "$st/boot-epoch" ]] && boot_epoch=$(cat "$st/boot-epoch")
  [[ -e "$st/state/heartbeat" ]] && beat=$(( now - $(stat -c %Y "$st/state/heartbeat" 2>/dev/null || echo "$now") ))
  free=$(df -BG --output=avail /models 2>/dev/null | tail -1 | tr -dc 0-9)
  [[ -r "$st/state/progress" ]] && progress=$(cat "$st/state/progress")
  [[ -e "$st/ready" ]] && ready=true
  REASON="$1" POD="${RUNPOD_POD_ID:-unknown}" NOW="$now" AGE=$(( (now - boot_epoch) / 60 )) BEAT="$beat" FREE="${free:-}" PROGRESS="$progress" READY="$ready" \
    python3 -c 'import json,os; e=os.environ; print(json.dumps({"pod":e["POD"],"reason":e["REASON"],"endedAt":int(e["NOW"]),"ageMinutes":int(e["AGE"]),"ready":e["READY"]=="true","heartbeatAgeSeconds":int(e["BEAT"]),"diskFreeGb":e["FREE"],"downloadProgress":e["PROGRESS"]}))' > "$st/end.json" 2>/dev/null || return 0
  tail -n 2000 /var/log/orazaka-boot.log > "$st/boot-tail.log" 2>/dev/null
  if curl -fsS -m 20 -X PUT -H "AccessKey: ${MEDIA_STORAGE_API_KEY}" -H "Content-Type: application/json" --data-binary "@$st/end.json" "$base/end.json" >/dev/null 2>&1 \
    && curl -fsS -m 30 -X PUT -H "AccessKey: ${MEDIA_STORAGE_API_KEY}" -H "Content-Type: text/plain" --data-binary "@$st/boot-tail.log" "$base/boot.log" >/dev/null 2>&1; then
    echo "orazaka-gpu: end reason left at apps/orazaka/gpu-pods/${RUNPOD_POD_ID:-unknown}/"
  else
    echo "orazaka-gpu: could not leave the end reason off the pod"
  fi
  return 0
}
destroy_pod() {
  echo "orazaka-gpu: destroying pod ${RUNPOD_POD_ID:-?}: $1"
  leave_trace "$1"
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
# The decision, one pure function (tested by scripts/test/gpu-boot-watchdog.test.mjs through `--decide`):
#   decide <idle min> <age min> <ready 0|1> <busy 0|1> <idle limit> <max min> <setup min>  →  the reason to end the pod, or nothing.
# « busy » = a download or a model load is in progress, or a job is running (the worker's heartbeat): the GPU is idle but the pod works.
decide() {
  local idle=$1 age=$2 ready=$3 busy=$4 limit=$5 max=$6 setup=$7 reason=""
  (( busy == 0 && idle >= limit )) && reason="idle for ${idle} min"
  (( age >= max )) && reason="lifetime of ${max} min reached"
  (( ready == 0 && age >= setup )) && reason="setup unfinished after ${age} min"
  [[ -n "$reason" ]] && echo "$reason"
  return 0
}
if [[ "${1:-}" == "--decide" ]]; then shift; decide "$@"; exit 0; fi
STATE=${ORAZAKA_STATE:-/var/lib/orazaka-gpu}; IDLE=${IDLE_MINUTES:-30}; MAX=${MAX_HOURS:-10}; SETUP=${SETUP_MAX_MINUTES:-120}
HEARTBEAT_SECONDS=${HEARTBEAT_SECONDS:-180}
# The lifetime in whole minutes: a batch gives fractional hours (0.6), which bash arithmetic refuses (the cap never fired).
MAXMIN=$(awk -v h="$MAX" 'BEGIN { printf "%d", h * 60 }')
boot=$(cat $STATE/boot-epoch)
# busy: the heartbeat file (touched by the weights download, and by the worker while it loads a model or runs a job) is fresh.
is_busy() { local t; t=$(stat -c %Y $STATE/state/heartbeat 2>/dev/null) || return 1; (( $(date +%s) - t < HEARTBEAT_SECONDS )); }
while sleep "${WATCHDOG_TICK:-60}"; do
  now=$(date +%s)
  util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  [[ "${util:-0}" =~ ^[0-9]+$ ]] && (( util >= 20 )) && touch $STATE/state/last-activity
  [[ ! -e $STATE/ready ]] && (( now - boot < SETUP * 60 )) && touch $STATE/state/last-activity
  busy=0; is_busy && busy=1
  last=$(stat -c %Y $STATE/state/last-activity); idle=$(( (now - last) / 60 )); age=$(( (now - boot) / 60 ))
  ready=0; [[ -e $STATE/ready ]] && ready=1
  reason=$(decide "$idle" "$age" "$ready" "$busy" "$IDLE" "$MAXMIN" "$SETUP")
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
