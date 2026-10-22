# shellcheck shell=bash
# ==============================================================================
# scripts/gpu-dev.sh runpod … — the same GPU worker on RunPod (a pod by the hour), sourced by gpu-dev.sh.
#
#   gpu-dev.sh runpod start [gpu]   create the pod (H100 80 GB by default; GPU_RUNPOD_GPUS overrides the priority list):
#                                    a network volume keeps the weights between pods, the worker is built in the pod from its
#                                    public repository (GHCR is private), the tunnel dials OUT to the relay of dev.orazaka.com
#   gpu-dev.sh runpod stop          destroy it — a pod is never left running; the ledger gets its end
#   gpu-dev.sh runpod status        what runs, since when, what it has cost so far
#   gpu-dev.sh runpod logs          the pod's boot and worker logs (ssh, read-only)
#
# The API key is AI_GPU_RUNPOD_API_KEY in the secrets file (ORAZAKA_DEV_ENV_FILE): never printed. Sessions go to the same
# ledger as the droplets (id "rp-<pod>"), so `gpu-dev.sh cost` adds them up. A budget guard refuses to start when the
# account balance is below GPU_RUNPOD_MIN_BALANCE (default 10 USD).
# ==============================================================================
RP_API="https://rest.runpod.io/v1"
RP_GQL="https://api.runpod.io/graphql"
RP_IMAGE="${GPU_RUNPOD_IMAGE:-runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04}"
RP_VOLUME="${GPU_RUNPOD_VOLUME:-orazaka-gpu-models}"
RP_VOLUME_GB="${GPU_RUNPOD_VOLUME_GB:-200}"
# Priority list: the 80 GB cards (H100, then A100), then the 48 GB L40S (5B only).
RP_GPUS="${GPU_RUNPOD_GPUS:-NVIDIA H100 80GB HBM3|NVIDIA H100 PCIe|NVIDIA A100-SXM4-80GB|NVIDIA A100 80GB PCIe|NVIDIA L40S}"
# Datacentres to try, nearest to Toronto (the app and the relay) first; the volume lives in one of them.
RP_DCS="${GPU_RUNPOD_DCS:-CA-MTL-1 CA-MTL-3 US-GA-2 US-MO-1 US-NE-1 US-KS-2 EU-NL-1}"

rp_key() { secret AI_GPU_RUNPOD_API_KEY; }

# One REST call: rp_call METHOD PATH [json body]; prints the body, fails on a non-2xx with the API's message.
rp_call() {
  local method="$1" path="$2" body="${3:-}" out code
  out=$(mktemp)
  if [[ -n "$body" ]]; then
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H "Authorization: Bearer $(rp_key)" -H 'Content-Type: application/json' -d "$body" "$RP_API$path")
  else
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H "Authorization: Bearer $(rp_key)" "$RP_API$path")
  fi
  cat "$out"; rm -f "$out"
  [[ "$code" =~ ^2 ]] || { echo "runpod: $method $path answered $code" >&2; return 1; }
}

rp_balance() {
  curl -sS -X POST "$RP_GQL" -H "Authorization: Bearer $(rp_key)" -H 'Content-Type: application/json' \
    -d '{"query":"{ myself { clientBalance currentSpendPerHr } }"}' \
    | python3 -c 'import json,sys; m=json.load(sys.stdin)["data"]["myself"]; print(m["clientBalance"], m["currentSpendPerHr"])'
}

rp_pods() { rp_call GET /pods 2>/dev/null || echo '[]'; }

rp_volume_id() {
  local dc="$1"
  rp_call GET /networkvolumes 2>/dev/null | python3 -c "
import json,sys
vs = json.load(sys.stdin) or []
print(next((v['id'] for v in vs if v.get('name') == '$RP_VOLUME' and v.get('dataCenterId') == '$dc'), ''))"
}

runpod_start() {
  [[ -n "$(secret AI_GPU_RUNPOD_API_KEY || true)" ]] || die "no AI_GPU_RUNPOD_API_KEY in $ENV_FILE"
  # MEASURE=1 (gpu-dev.sh runpod measure): a pod that measures and ends, with no relay, no broker, no service token.
  [[ -n "${MEASURE:-}" || -n "$(secret AI_GPU_RELAY_PASSWORD || true)" ]] || die "no relay credential — scripts/gpu-dev.sh relay-secret"
  local running; running=$(rp_pods | python3 -c 'import json,sys; print(len([p for p in (json.load(sys.stdin) or []) if p.get("name","").startswith("orazaka-gpu") and p.get("desiredStatus") != "EXITED"]))')
  [[ "$running" == "0" ]] || die "a RunPod pod already runs — scripts/gpu-dev.sh runpod status (or stop)"
  local balance spend; read -r balance spend <<<"$(rp_balance)"
  python3 -c "import sys; sys.exit(0 if float('$balance') >= float('${GPU_RUNPOD_MIN_BALANCE:-10}') else 1)" \
    || die "RunPod balance is \$$balance, below the guard (GPU_RUNPOD_MIN_BALANCE)"
  say "RunPod balance \$$balance, spending \$$spend/hour now"

  local max_hours="${GPU_MAX_HOURS:-8}" worker_ref
  # GPU_WORKER_REF runs a worker commit not yet on main (a branch under review), else main's head.
  worker_ref="${GPU_WORKER_REF:-$(git ls-remote https://github.com/krizaka/orazaka-worker-media.git refs/heads/main | cut -c1-40)}"
  mkdir -p "$LOCAL"; chmod 700 "$LOCAL"
  [[ -f "$LOCAL/id_ed25519" ]] || ssh-keygen -q -t ed25519 -N "" -C "orazaka-gpu-dev" -f "$LOCAL/id_ed25519"
  local body="$LOCAL/runpod-body.json"
  local dc id="" pod="" gpu_list; gpu_list="$RP_GPUS"
  [[ -z "${1:-}" ]] || gpu_list="$1"
  for dc in $RP_DCS; do
    local volume; volume=$(rp_volume_id "$dc")
    if [[ -z "$volume" ]]; then
      # Created only in a datacentre the GPU is in stock in right now (a volume pins the pod to its datacentre).
      curl -sS -X POST "$RP_GQL" -H "Authorization: Bearer $(rp_key)" -H 'Content-Type: application/json' \
        -d '{"query":"{ dataCenters { id gpuAvailability { displayName stockStatus } } }"}' \
        | python3 -c "
import json,sys
dc='$dc'; want=[g.lower() for g in '''$gpu_list'''.split('|')]
for d in json.load(sys.stdin)['data']['dataCenters']:
    if d['id']==dc and any(a['stockStatus'] for a in d['gpuAvailability']): sys.exit(0)
sys.exit(1)" || { say "  $dc: no stock"; continue; }
      say "creating the models volume $RP_VOLUME (${RP_VOLUME_GB} GB in $dc, kept between pods)"
      volume=$(rp_call POST /networkvolumes "{\"name\":\"$RP_VOLUME\",\"size\":$RP_VOLUME_GB,\"dataCenterId\":\"$dc\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])') || continue
    fi
    # Every credential reaches the pod as an environment variable (RunPod's own, visible to this account only).
    WORKER_REF="$worker_ref" PROFILE="${GPU_RUNPOD_PROFILE:-big}" GPU_LIST="$gpu_list" DC="$dc" VOLUME="$volume" MAX_HOURS="$max_hours" \
    IDLE_MINUTES="${GPU_IDLE_MINUTES:-30}" DISK_GB="${GPU_RUNPOD_DISK_GB:-60}" RP_IMAGE="$RP_IMAGE" PUBKEY="$(cat "$LOCAL/id_ed25519.pub")" \
    RELAY_URL="$RELAY_URL" RELAY_AUTH="${MEASURE:+x}${MEASURE:-gpu:$(secret AI_GPU_RELAY_PASSWORD)}" \
    RABBIT_PASSWORD="${MEASURE:+x}${MEASURE:-$(secret RABBITMQ_PASS_GPU)}" \
    SERVICE_TOKEN="${MEASURE:+x}${MEASURE:-$(mint_service_token "$max_hours")}" BROKER_CA_B64="${MEASURE:+x}${MEASURE:-$(broker_ca_b64)}" \
    MEASURE="${MEASURE:-}" MEASURE_ARGS="${MEASURE_ARGS:-}" MEASURE_PIP="${MEASURE_PIP:-}" \
    BOOT="$ROOT/infra/gpu/$([[ -n "${MEASURE:-}" ]] && echo runpod-measure.sh || echo runpod-bootstrap.sh)" \
    HF_TOKEN="$(secret AI_HUGGINGFACE_TOKEN 2>/dev/null || true)" DISK_GB="${GPU_RUNPOD_DISK_GB:-}" \
    python3 - "$body" <<'PY'
import base64, json, os, sys
e = os.environ
boot = base64.b64encode(open(e["BOOT"], "rb").read()).decode()
if e.get("MEASURE"):
    # Measurement only: the pod never learns the relay, the broker or a service token.
    env = {k: e[k] for k in ("WORKER_REF", "PROFILE", "MAX_HOURS", "IDLE_MINUTES", "MEASURE_ARGS", "MEASURE_PIP")}
else:
    env = {k: e[k] for k in ("WORKER_REF", "PROFILE", "RELAY_URL", "RELAY_AUTH", "RABBIT_PASSWORD", "SERVICE_TOKEN", "BROKER_CA_B64", "MAX_HOURS", "IDLE_MINUTES")}
if e.get("HF_TOKEN"):
    env["HF_TOKEN"] = e["HF_TOKEN"]  # downloads of public weights, faster and not rate-limited
env["PUBLIC_KEY"] = e["PUBKEY"]
env["ORAZAKA_BOOT_B64"] = boot
body = {
    "name": "orazaka-gpu-" + ("measure" if e.get("MEASURE") else e["PROFILE"]),
    "imageName": e["RP_IMAGE"],
    "cloudType": "SECURE",
    "computeType": "GPU",
    "gpuCount": 1,
    "gpuTypeIds": e["GPU_LIST"].split("|"),
    "gpuTypePriority": "custom",
    "dataCenterIds": [e["DC"]],
    "networkVolumeId": e["VOLUME"],
    "volumeMountPath": "/models",
    # A model kept on the host's own disk (`cache: scratch`: the I2V A14B, 115 GB) needs room: GPU_RUNPOD_DISK_GB.
    "containerDiskInGb": int(e.get("DISK_GB") or 60),
    "ports": ["22/tcp"],
    "supportPublicIp": True,
    "env": env,
    # The image's own start script (sshd with PUBLIC_KEY), then this worker's boot beside it.
    "dockerStartCmd": ["bash", "-c", "echo \"$ORAZAKA_BOOT_B64\" | base64 -d > /orazaka-boot.sh; (bash /orazaka-boot.sh &) ; exec /start.sh"],
}
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as handle:
    json.dump(body, handle)
PY
    say "trying $dc ($gpu_list)…"
    if pod=$(curl -sS -X POST -H "Authorization: Bearer $(rp_key)" -H 'Content-Type: application/json' -d @"$body" "$RP_API/pods" -w '\n%{http_code}' | python3 -c "
import json,sys
raw=sys.stdin.read().rsplit('\n',1); code=raw[1].strip(); data=raw[0]
if code.startswith('2'):
    d=json.loads(data); print(d['id'], d.get('costPerHr',''), (d.get('machine') or {}).get('gpuTypeId') or (d.get('gpu') or {}).get('displayName',''))
else:
    print(data[:200], file=sys.stderr); sys.exit(1)"); then
      rm -f "$body"
      local pid rate gpu; read -r pid rate gpu <<<"$pod"
      ledger_add "$(printf 'rp-%s\t%s\t%s\t%s\t%s\t\t%s' "$pid" "$gpu" "$dc" "$rate" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" runpod)"
      say "pod $pid ($gpu, $dc) — \$$rate/hour; it destroys itself after ${GPU_IDLE_MINUTES:-30} min without a job (or $max_hours h); gpu-dev.sh runpod stop ends it now"
      return 0
    fi
  done
  rm -f "$body"
  die "no RunPod datacentre had the GPU in stock — nothing was created"
}

runpod_stop() {
  local ids; ids=$(rp_pods | python3 -c 'import json,sys; print(" ".join(p["id"] for p in (json.load(sys.stdin) or []) if p.get("name","").startswith("orazaka-gpu")))')
  if [[ -z "$ids" ]]; then say "no RunPod pod running — \$0/hour"; runpod_ledger_close; return; fi
  local id; for id in $ids; do rp_call DELETE "/pods/$id" >/dev/null && say "destroyed RunPod pod $id — billing stopped (the models volume is kept)"; done
  runpod_ledger_close
}

# Closes the ledger rows of pods that no longer exist (stopped here, or by the pod's own watchdog), "now" as their end.
runpod_ledger_close() {
  [[ -f "$LEDGER" ]] || return 0
  local live; live=$(rp_pods | python3 -c 'import json,sys; print(" ".join("rp-"+p["id"] for p in (json.load(sys.stdin) or [])))')
  LIVE="$live" python3 - "$LEDGER" <<'PY'
import datetime as dt, os, sys
path = sys.argv[1]; live = set(os.environ.get("LIVE", "").split())
now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
rows = [l.rstrip("\n").split("\t") for l in open(path, encoding="utf-8")]
out = [rows[0]]
for r in rows[1:]:
    r += [""] * (7 - len(r))
    if r[0].startswith("rp-") and not r[5] and r[0] not in live:
        r[5] = now
    out.append(r)
open(path, "w", encoding="utf-8").write("".join("\t".join(r) + "\n" for r in out))
PY
}

runpod_status() {
  rp_pods | python3 -c "
import json, sys, datetime as dt
ps = [p for p in (json.load(sys.stdin) or []) if p.get('name','').startswith('orazaka-gpu')]
if not ps: print('gpu-dev: RunPod off — \$0/hour')
for p in ps:
    started = p.get('lastStartedAt') or p.get('createdAt')
    try: hours = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(started.replace(' +0000 UTC','+00:00').replace('Z','+00:00'))).total_seconds()/3600
    except Exception: hours = 0
    rate = float(p.get('costPerHr') or 0)
    print(f\"gpu-dev: RunPod {p['id']} {p['name']} {(p.get('machine') or {}).get('gpuTypeId','?')} {p.get('desiredStatus')} up {hours:.2f} h ≈ \${hours*rate:.2f} (\${rate}/hour) ip {p.get('publicIp','?')}\")
"
  local balance spend; read -r balance spend <<<"$(rp_balance)"; say "RunPod balance \$$balance, spending \$$spend/hour"
}

runpod_ssh_target() {
  rp_pods | python3 -c "
import json,sys
ps=[p for p in (json.load(sys.stdin) or []) if p.get('name','').startswith('orazaka-gpu')]
if not ps: sys.exit(1)
p=ps[0]; print(p.get('publicIp',''), (p.get('portMappings') or {}).get('22',''))"
}

runpod_logs() {
  local ip port; read -r ip port <<<"$(runpod_ssh_target)" || die "no RunPod pod running"
  [[ -n "$ip" && -n "$port" ]] || die "the pod has no public ssh yet"
  ssh -i "$LOCAL/id_ed25519" -p "$port" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$LOCAL/known_hosts" "root@$ip" \
    'tail -n 25 /var/log/orazaka-boot.log; for f in orazaka-worker orazaka-relay orazaka-watchdog; do echo "== $f"; tail -n 20 /var/log/$f.log 2>&1; done; nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv'
}

runpod() {
  case "${1:-}" in
    start) shift; runpod_start "$@" ;;
    # A pod that only measures (infra/gpu/runpod-measure.sh): MEASURE_ARGS="load wan2.2-ti2v-5b" … ; it ends itself.
    measure) shift; MEASURE=1 runpod_start "$@" ;;
    stop) runpod_stop ;;
    status) runpod_status ;;
    logs) runpod_logs ;;
    # The spend guard (ADR-078): stops a pod idle GPU_IDLE_MINUTES (20) or older than GPU_MAX_HOURS (6), once or in a loop.
    once|loop)
      AI_GPU_RUNPOD_API_KEY="${AI_GPU_RUNPOD_API_KEY:-$(rp_key)}" python3 "$ROOT/scripts/runpod-guard.py" "$1" "${@:2}" ;;
    *) echo "usage: scripts/gpu-dev.sh runpod start [gpu] | measure [gpu] | stop | status | logs | once | loop" >&2; exit 2 ;;
  esac
}
