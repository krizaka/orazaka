#!/usr/bin/env bash
# ==============================================================================
# The GPU droplet's idle watchdog (docs/DEPLOY_DEV.md § GPU) — systemd timer, every minute, as root.
#
# Work is: a job started or ended (the worker touches state/last-activity), an image request reached
# sd-server, or the GPU is busy. Setup counts as work for at most SETUP_MAX_MINUTES. The droplet is
# DESTROYED (not stopped: a stopped droplet is still billed) when
#   * nothing happened for IDLE_MINUTES (30), or
#   * it has lived MAX_HOURS, whatever it is doing (the bound on a forgotten batch), or
#   * setup has not finished after SETUP_MAX_MINUTES (a broken boot must not bill for hours).
# The models volume is detached by the destruction and kept.
# ==============================================================================
set -uo pipefail
CONF=/etc/orazaka-gpu
STATE=/var/lib/orazaka-gpu
# shellcheck disable=SC1091
source "$CONF/host.env"
IDLE_MINUTES="${IDLE_MINUTES:-30}"
MAX_HOURS="${MAX_HOURS:-8}"
SETUP_MAX_MINUTES="${SETUP_MAX_MINUTES:-90}"
ACTIVITY="$STATE/state/last-activity"

log() { logger -t orazaka-gpu-watchdog "$*"; }
now=$(date +%s)
boot=$(( now - $(cut -d. -f1 /proc/uptime) ))

# Signals of work in the last two minutes, folded into the activity file.
if docker logs --since 2m sd-server 2>&1 | grep -qiE 'generate|/v1/images|sampling'; then touch "$ACTIVITY"; fi
if docker logs --since 2m ollama 2>&1 | grep -qE 'POST +"/api/(chat|generate)|/v1/chat'; then touch "$ACTIVITY"; fi
util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
if [[ "${util:-0}" =~ ^[0-9]+$ ]] && (( util >= 20 )); then touch "$ACTIVITY"; fi
if [[ ! -e "$STATE/ready" ]] && (( now - boot < SETUP_MAX_MINUTES * 60 )); then touch "$ACTIVITY"; fi

last=$(stat -c %Y "$ACTIVITY" 2>/dev/null || echo "$boot")
idle=$(( (now - last) / 60 ))
age=$(( (now - boot) / 60 ))

reason=""
if (( idle >= IDLE_MINUTES )); then reason="idle for ${idle} min"; fi
if (( age >= MAX_HOURS * 60 )); then reason="lifetime of ${MAX_HOURS} h reached"; fi
if [[ ! -e "$STATE/ready" ]] && (( age >= SETUP_MAX_MINUTES )); then reason="setup unfinished after ${age} min"; fi

if [[ -z "$reason" ]]; then
  (( age % 10 == 0 )) && log "alive ${age} min, idle ${idle} min, GPU ${util:-?}%"
  exit 0
fi

id=$(curl -fsS http://169.254.169.254/metadata/v1/id)
log "destroying droplet $id: $reason"
token=$(cat "$CONF/do-token")
for attempt in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE \
    -H "Authorization: Bearer ${token}" "https://api.digitalocean.com/v2/droplets/${id}")
  if [[ "$code" == "204" || "$code" == "404" ]]; then log "destroy accepted ($code)"; exit 0; fi
  log "destroy attempt $attempt answered $code"; sleep 10
done
log "could not destroy droplet $id — scripts/gpu-dev.sh stop will"
exit 1
