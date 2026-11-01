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
# RELAY_URL, RELAY_AUTH, RABBIT_PASSWORD, SERVICE_TOKEN, BROKER_CA_B64, IDLE_MINUTES, MAX_HOURS (and HF_TOKEN, optional).
#
# A profile that declares an image model (`cinema`, ADR-080) also serves sd-server (FLUX.2 klein keyframes) on :8086 — the
# address the platform's image provider already names (gpu-relay:8086) — built once for CUDA and kept on the volume. A
# profile that declares sound models enables the sound queue (ACE-Step music). Weights a model keeps on the host's own
# disk (`cache: scratch`) go to MEDIA_SCRATCH_DIR, on the pod's container disk.
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
# The lifetime in whole minutes: a batch gives fractional hours (0.6), which bash arithmetic refuses (the cap never fired).
MAXMIN=$(awk -v h="$MAX" 'BEGIN { printf "%d", h * 60 }')
boot=$(cat /var/lib/orazaka-gpu/boot-epoch)
while sleep 60; do
  now=$(date +%s)
  util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  [[ "${util:-0}" =~ ^[0-9]+$ ]] && (( util >= 20 )) && touch $STATE/state/last-activity
  [[ ! -e $STATE/ready ]] && (( now - boot < SETUP * 60 )) && touch $STATE/state/last-activity
  last=$(stat -c %Y $STATE/state/last-activity); idle=$(( (now - last) / 60 )); age=$(( (now - boot) / 60 ))
  reason=""
  (( idle >= IDLE )) && reason="idle for ${idle} min"
  (( age >= MAXMIN )) && reason="lifetime of ${MAX} h reached"
  [[ ! -e $STATE/ready ]] && (( age >= SETUP )) && reason="setup unfinished after ${age} min"
  [[ -z "$reason" ]] && continue
  destroy_pod "$reason" && exit 0
  sleep 120   # retried every few minutes: a pod that cannot end itself must not stay silent
done
WD
chmod +x /usr/local/bin/orazaka-watchdog
nohup /usr/local/bin/orazaka-watchdog > /var/log/orazaka-watchdog.log 2>&1 &
step "watchdog armed (idle ${IDLE_MINUTES:-30} min, lifetime ${MAX_HOURS:-10} h)"

# sd-server (stable-diffusion.cpp, the Dockerfile.cuda ref), built once per card onto /models for THIS card's compute capability:
# a fixed "80;89;90" list had no sm_100 kernels for a B200 and compiled three architectures for nothing. Prints the binary.
SDCPP_REF=a397e03488cc27e1a42da646b82dfce9f50741c0
build_sd_server() {
  local cc binary
  cc=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | tr -d ' .')
  binary="/models/bin/sd-server-${SDCPP_REF:0:12}-sm${cc}"
  if [[ ! -x "$binary" ]]; then
    step "building sd-server (stable-diffusion.cpp ${SDCPP_REF:0:12}, CUDA sm_${cc}) once onto /models" >&2
    apt-get install -y -qq cmake build-essential >/dev/null 2>&1
    rm -rf /tmp/sdcpp && git clone -q https://github.com/leejet/stable-diffusion.cpp /tmp/sdcpp \
      && git -C /tmp/sdcpp checkout -q "$SDCPP_REF" && git -C /tmp/sdcpp submodule update -q --init --recursive \
      && cmake -S /tmp/sdcpp -B /tmp/sdcpp/build -DCMAKE_BUILD_TYPE=Release -DSD_CUDA=ON \
           -DCMAKE_CUDA_ARCHITECTURES="$cc" -DSD_SERVER_BUILD_FRONTEND=OFF >/dev/null \
      && cmake --build /tmp/sdcpp/build --config Release -j"$(nproc)" --target sd-server >/dev/null \
      && mkdir -p /models/bin && cp "$(find /tmp/sdcpp/build -type f -name sd-server -perm -u+x | head -1)" "$binary" \
      || { step "sd-server build FAILED: images will not be served" >&2; return 1; }
  fi
  echo "$binary"
}

# --- STILLS=1 (runpod batch): the image engine only, up in minutes ------------------------------------
# krizaka-internal#138: a render batch's pod fetched every video weight of its profile (~49 GB for `small`, onto a 60 GB disk
# without a volume), installed torch and the upscaler, then compiled sd-server — and its image engine never listened inside the
# batch's boot window. A stills pod needs none of that: the worker's manifest, the image files, sd-server, the tunnel to :8086.
if [[ -n "${STILLS:-}" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq curl git ca-certificates >/dev/null 2>&1
  rm -rf /app-src && git clone -q https://github.com/krizaka/orazaka-worker-media.git /app-src && git -C /app-src checkout -q "${WORKER_REF:-main}"
  python3 -m venv /opt/stills && /opt/stills/bin/pip install -q --no-cache-dir pyyaml
  export MEDIA_MODELS_DIR=/models
  IMAGE_MODEL=$(cd /app-src && /opt/stills/bin/python -c "from app.video_models import load_manifest; print(load_manifest()['profiles']['${PROFILE:-big}'].get('image') or '')")
  [[ -n "$IMAGE_MODEL" ]] || { step "profile ${PROFILE:-big} declares no image model: nothing to serve"; exit 1; }
  started=$(date +%s)
  (cd /app-src && /opt/stills/bin/python -c "
from pathlib import Path
from app.fetch_models import fetch_file
from app.video_models import load_manifest
for spec in load_manifest()['image']['$IMAGE_MODEL']['files']:
    fetch_file(spec, Path('/models') / 'sd')") || { step "image weights FAILED"; exit 1; }
  step "image weights ready in $(( $(date +%s) - started ))s"
  binary=$(build_sd_server) || exit 1
  if ! command -v chisel >/dev/null; then
    curl -fsSL "https://github.com/jpillora/chisel/releases/download/v1.10.1/chisel_1.10.1_linux_amd64.gz" | gunzip > /usr/local/bin/chisel && chmod +x /usr/local/bin/chisel
  fi
  (cd /app-src && MEDIA_SD_SERVER="$binary" MEDIA_IMAGE_PORT=8086 MEDIA_IMAGE_LISTEN_IP=127.0.0.1 \
    nohup /opt/stills/bin/python -m app.sd_server "$IMAGE_MODEL" > /var/log/orazaka-sd-server.log 2>&1 < /dev/null &)
  for _ in $(seq 1 60); do curl -s -o /dev/null --max-time 2 http://127.0.0.1:8086/ && break; sleep 5; done
  curl -s -o /dev/null --max-time 2 http://127.0.0.1:8086/ || { step "sd-server did not listen on :8086"; tail -n 20 /var/log/orazaka-sd-server.log; exit 1; }
  AUTH="$RELAY_AUTH" nohup chisel client --keepalive 25s --max-retry-interval 30s "$RELAY_URL" R:0.0.0.0:8086:127.0.0.1:8086 \
    > /var/log/orazaka-relay.log 2>&1 &
  touch "$STATE/ready" "$STATE/state/last-activity"
  step "serving: images $IMAGE_MODEL on :8086 (stills), relay → ${RELAY_URL}, $(( $(date +%s) - boot ))s after boot"
  wait
fi

# --- 1. the runtime (once per container disk; the weights are on the volume) --------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq ffmpeg curl git ca-certificates fonts-dejavu-core >/dev/null 2>&1
# The venv is on the network volume: a later pod finds it in place (a rebuild is ~15 min of idle GPU billed at the hourly rate).
VENV=/models/venv
if [[ ! -x $VENV/bin/python ]]; then
  step "building the worker runtime (venv on the volume, torch cu128, requirements)"
  python3 -m venv $VENV
  $VENV/bin/pip install -q --no-cache-dir --upgrade pip
  $VENV/bin/pip install -q --no-cache-dir torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
fi
ln -sfn /models/venv /opt/venv
rm -rf /app-src && git clone -q https://github.com/krizaka/orazaka-worker-media.git /app-src
git -C /app-src checkout -q "${WORKER_REF:-main}"
/opt/venv/bin/pip install -q --no-cache-dir -r /app-src/requirements-cuda.txt
# The optional video upscaler (Studio `upscale`: SeedVR2 3B, Apache-2.0): a pinned checkout and its own venv, both on the volume, so a
# later pod finds them in place; its weights (7 GB) are fetched by its CLI at the first upscale into /models/seedvr2.
UP=/models/up
SEEDVR2_REF=4490bd1f482e026674543386bb2a4d176da245b9
if [[ ! -x $UP/venv/bin/python ]]; then
  step "installing the video upscaler (SeedVR2 3B)"
  python3 -m venv $UP/venv
  echo /models/venv/lib/python3.11/site-packages > $UP/venv/lib/python3.11/site-packages/base.pth   # torch from the worker's venv
  $UP/venv/bin/pip install -q --no-cache-dir --no-deps torchvision --index-url https://download.pytorch.org/whl/cu128
  $UP/venv/bin/pip install -q --no-cache-dir omegaconf rotary_embedding_torch peft gguf matplotlib psutil einops opencv-python-headless
fi
[[ -d $UP/seedvr2/.git ]] || git clone -q https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler $UP/seedvr2
git -C $UP/seedvr2 checkout -q "$SEEDVR2_REF" 2>/dev/null || { git -C $UP/seedvr2 fetch -q origin && git -C $UP/seedvr2 checkout -q "$SEEDVR2_REF"; }
mkdir -p $UP/seedvr; [[ -e /models/seedvr2 ]] || ln -sfn $UP/seedvr /models/seedvr2   # the worker looks for the weights in <models>/seedvr2
step "worker runtime ready: orazaka-worker-media@$(git -C /app-src rev-parse --short=12 HEAD)"

# --- 2. chisel, the tunnel client ---------------------------------------------------------------------
if ! command -v chisel >/dev/null; then
  curl -fsSL "https://github.com/jpillora/chisel/releases/download/v1.10.1/chisel_1.10.1_linux_amd64.gz" | gunzip > /usr/local/bin/chisel && chmod +x /usr/local/bin/chisel
fi
mkdir -p /etc/orazaka && printf '%s' "$BROKER_CA_B64" | base64 -d > /etc/orazaka/broker-ca.pem

# --- 3. weights, once, onto the network volume (or the container disk: `cache: scratch`) -------------
export MEDIA_MODELS_DIR=/models HF_HOME=/models/hf HF_HUB_CACHE=/models/hf/hub HF_HUB_DISABLE_TELEMETRY=1
export MEDIA_SCRATCH_DIR=/var/lib/orazaka-scratch
mkdir -p "$MEDIA_SCRATCH_DIR"
touch "$STATE/state/last-activity"
started=$(date +%s)
(cd /app-src && /opt/venv/bin/python -m app.fetch_models "${PROFILE:-big}")
step "weights ready in $(( $(date +%s) - started ))s"
step "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
# What the profile declares beside video: an image engine, sound models (models.yaml `profiles`).
IMAGE_MODEL=$(cd /app-src && /opt/venv/bin/python -c "from app.video_models import load_manifest; print(load_manifest()['profiles']['${PROFILE:-big}'].get('image') or '')")
SOUND_MODELS=$(cd /app-src && /opt/venv/bin/python -c "from app.video_models import load_manifest; print(','.join(load_manifest()['profiles']['${PROFILE:-big}'].get('sound') or []))")

# --- 3b. sd-server for the profile's image model: built once for CUDA (stable-diffusion.cpp, the Dockerfile.cuda ref) --
IMAGE_REMOTE=""
if [[ -n "$IMAGE_MODEL" ]]; then
  binary=$(build_sd_server) || binary=""
  if [[ -x "$binary" ]]; then
    # A profile with a speech model puts the speech server on the relay's engine port (8086) and sd-server behind it.
    SPEECH_MODEL=$(cd /app-src && /opt/venv/bin/python -c "from app.video_models import load_manifest; print(load_manifest()['profiles']['${PROFILE:-big}'].get('speech') or '')")
    IMAGE_PORT=8086; [[ -n "$SPEECH_MODEL" ]] && IMAGE_PORT=8089
    (cd /app-src && MEDIA_SD_SERVER="$binary" MEDIA_IMAGE_PORT=$IMAGE_PORT MEDIA_IMAGE_LISTEN_IP=127.0.0.1 \
      nohup /opt/venv/bin/python -m app.sd_server "$IMAGE_MODEL" > /var/log/orazaka-sd-server.log 2>&1 < /dev/null &)
    if [[ -n "$SPEECH_MODEL" ]]; then
      apt-get install -y -qq espeak-ng >/dev/null 2>&1
      (cd /app-src && MEDIA_SPEECH_PORT=8086 MEDIA_IMAGE_UPSTREAM=127.0.0.1:8089 \
        nohup /opt/venv/bin/python -m app.speech_server > /var/log/orazaka-speech.log 2>&1 < /dev/null &)
      step "speech ($SPEECH_MODEL) on :8086, sd-server ($IMAGE_MODEL) behind it on :8089"
    else
      step "sd-server ($IMAGE_MODEL) on :8086"
    fi
    IMAGE_REMOTE="R:0.0.0.0:8086:127.0.0.1:8086"
  fi
fi
# The Krizaka type for a cut's titles (@krizaka/fonts, OFL), once onto the volume.
FONT=/models/fonts/PlusJakartaSans-ExtraBold.ttf
if [[ ! -f "$FONT" ]]; then
  mkdir -p /models/fonts && curl -fsSL https://registry.npmjs.org/@krizaka/fonts/-/fonts-0.2.1.tgz | tar -xz -C /tmp \
    && cp /tmp/package/files/native/PlusJakartaSans-ExtraBold.ttf /tmp/package/licenses/PlusJakartaSans-OFL.txt /models/fonts/
fi
SOUND_FLAG=false; [[ -n "$SOUND_MODELS" ]] && SOUND_FLAG=true
# The video upscaler (SeedVR2 3B, Apache-2.0) where the volume holds it (/models/up: a pinned checkout and its venv; weights
# under /models/seedvr2): the cut of a cinematic short upscales every shot with it (ADR-080).
UPSCALER_ENV=""
[[ -x /models/up/venv/bin/python && -f /models/up/seedvr2/inference_cli.py ]] && UPSCALER_ENV="SEEDVR2_HOME=/models/up/seedvr2 SEEDVR2_PYTHON=/models/up/venv/bin/python"

# --- 4. the tunnel and the worker ---------------------------------------------------------------------
# The same remotes as the droplet: the broker and the job service IN, the worker's pipeline back into the app.
AUTH="$RELAY_AUTH" nohup chisel client --keepalive 25s --max-retry-interval 30s "$RELAY_URL" \
  127.0.0.1:15671:broker-dev.orazaka.com:5671 127.0.0.1:18090:core:8090 R:0.0.0.0:8188:127.0.0.1:8188 $IMAGE_REMOTE \
  > /var/log/orazaka-relay.log 2>&1 &
cd /app-src
export SPRING_RABBITMQ_HOST=127.0.0.1 SPRING_RABBITMQ_PORT=15671 SPRING_RABBITMQ_USERNAME=gpu-worker \
  SPRING_RABBITMQ_SSL_ENABLED=true SPRING_RABBITMQ_SSL_CA_FILE=/etc/orazaka/broker-ca.pem \
  SPRING_RABBITMQ_SSL_SERVER_NAME=broker-dev.orazaka.com \
  MEDIA_ASSET_SINK_URL=http://127.0.0.1:18090 JOB_SERVICE_INTERNAL_URL=http://127.0.0.1:18090 \
  UPLOAD_DIR="$STATE/uploads" MEDIA_ACTIVITY_FILE="$STATE/state/last-activity" MEDIA_GPU_PROFILE="${PROFILE:-big}" \
  ORAZAKA_MEDIA_MEM_HEADROOM_GB=4 PYTHONUNBUFFERED=1 MEDIA_WORKER_PORT=8188 MEDIA_SOUND_ENABLED="$SOUND_FLAG" MEDIA_FONT_FILE="$FONT"
# shellcheck disable=SC2086 # UPSCALER_ENV is a list of NAME=value words
env $UPSCALER_ENV SPRING_RABBITMQ_PASSWORD="$RABBIT_PASSWORD" ORAZAKA_SERVICE_TOKEN="$SERVICE_TOKEN" \
  nohup /opt/venv/bin/python -u -m app.consumer > /var/log/orazaka-worker.log 2>&1 &
touch "$STATE/ready" "$STATE/state/last-activity"
step "serving: worker (${PROFILE:-big}${IMAGE_MODEL:+, images $IMAGE_MODEL}${SOUND_MODELS:+, sound $SOUND_MODELS}), relay → ${RELAY_URL}"
wait
