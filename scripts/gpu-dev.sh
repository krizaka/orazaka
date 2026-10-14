#!/usr/bin/env bash
# ==============================================================================
# Orazaka dev — the image engine on an hourly GPU droplet (docs/DEPLOY_DEV.md § GPU).
#
#   scripts/gpu-dev.sh start    create the droplet, serve images on :8086, point gpu-dev.orazaka.com and
#                               the `localai-image` provider at it (≈ $0.76/hour while it exists)
#   scripts/gpu-dev.sh stop     destroy the droplet — billing stops; the image capability greys out again
#   scripts/gpu-dev.sh status   is one running, since when, what it has cost so far
#
# Never left on: nothing else in dev depends on it. Requires doctl (authenticated), psql, python3, and
# the local secrets file (ORAZAKA_DEV_ENV_FILE, default ~/Documents/krizaka/orazaka-dev.env) holding
# DATABASE_HOST, DATABASE_PORT, DATABASE_PASSWORD_ORAZAKA_DB. Secrets are never printed.
# A deployment exception to [ERR-125]: it drives a cloud resource, not the local workspace.
# ==============================================================================
set -euo pipefail

NAME="orazaka-gpu-dev"
TAG="orazaka-gpu-dev"
REGION="${GPU_REGION:-tor1}"
SIZE="${GPU_SIZE:-gpu-4000adax1-20gb}"           # NVIDIA RTX 4000 Ada, 20 GB — the cheapest GPU
IMAGE="${GPU_IMAGE:-gpu-h100x1-base}"             # DigitalOcean's AI/ML-ready image (NVIDIA drivers, Docker)
PRICE_PER_HOUR="${GPU_PRICE_PER_HOUR:-0.76}"
HOSTNAME_FQDN="gpu-dev.orazaka.com"
DNS_HELPER="${GPU_DNS_HELPER:-$HOME/.krizaka-worktrees/tools/pb.py}"
ENV_FILE="${ORAZAKA_DEV_ENV_FILE:-$HOME/Documents/krizaka/orazaka-dev.env}"
PROJECT="orazaka"
# The model name the job service asks for must be one LocalAI serves (orazaka_models, category image).
IMAGE_MODEL_NAME="${GPU_IMAGE_MODEL_NAME:-v1-5-pruned-emaonly}"
IMAGE_MODEL_REPO="${GPU_IMAGE_MODEL_REPO:-stable-diffusion-v1-5/stable-diffusion-v1-5}"
LOCALAI_IMAGE="${GPU_LOCALAI_IMAGE:-localai/localai:latest-gpu-nvidia-cuda-12}"

die() { echo "gpu-dev: $*" >&2; exit 1; }

droplet_json() { doctl compute droplet list --tag-name "$TAG" -o json; }
droplet_ids() { droplet_json | python3 -c 'import json,sys; print(" ".join(str(d["id"]) for d in json.load(sys.stdin) or []))'; }

load_env() {
  [[ -f "$ENV_FILE" ]] || die "no secrets file at $ENV_FILE"
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
}

psql_bin() {
  if command -v psql >/dev/null; then echo psql; return; fi
  local p; p=$(ls /opt/homebrew/Cellar/libpq/*/bin/psql 2>/dev/null | tail -1)
  [[ -n "$p" ]] || die "psql not found"; echo "$p"
}

# Sets the image provider's key (the base URL is the stable gpu-dev.orazaka.com, dev-data.sql).
set_provider_key() {
  local key="$1"
  PGPASSWORD="$DATABASE_PASSWORD_ORAZAKA_DB" "$(psql_bin)" \
    "host=$DATABASE_HOST port=$DATABASE_PORT dbname=orazaka_db user=orazaka_db sslmode=require" \
    -X -q -v ON_ERROR_STOP=1 -v key="$key" <<'SQL'
UPDATE ai_providers SET base_url = 'http://gpu-dev.orazaka.com:8086/v1', api_key = :'key' WHERE name = 'localai-image';
SQL
}

point_dns() {
  local ip="$1"
  [[ -f "$DNS_HELPER" ]] || { echo "gpu-dev: no DNS helper — set A $HOSTNAME_FQDN → $ip by hand"; return; }
  python3 - "$DNS_HELPER" "$ip" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("pb", sys.argv[1]); pb = importlib.util.module_from_spec(spec); spec.loader.exec_module(pb)
ip = sys.argv[2]
r = pb.call("dns/editByNameType/orazaka.com/A/gpu-dev", {"content": ip, "ttl": "600"})
if r.get("status") != "SUCCESS":
    r = pb.call("dns/create/orazaka.com", {"name": "gpu-dev", "type": "A", "content": ip, "ttl": "600"})
print("gpu-dev: DNS", r.get("status"))
PY
}

start() {
  [[ -z "$(droplet_ids)" ]] || die "already running — scripts/gpu-dev.sh status"
  load_env
  local key; key=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  local userdata; userdata=$(mktemp); trap 'rm -f "$userdata"' RETURN
  cat >"$userdata" <<EOF
#cloud-config
write_files:
  - path: /opt/localai/models/${IMAGE_MODEL_NAME}.yaml
    content: |
      name: ${IMAGE_MODEL_NAME}
      backend: diffusers
      f16: true
      parameters:
        model: ${IMAGE_MODEL_REPO}
      diffusers:
        cuda: true
        pipeline_type: StableDiffusionPipeline
        scheduler_type: k_dpmpp_2m
runcmd:
  - ufw allow 8086/tcp || true
  - docker run -d --restart unless-stopped --gpus all -p 8086:8080 -e API_KEY=${key} -e THREADS=8 -v /opt/localai/models:/build/models ${LOCALAI_IMAGE}
EOF
  echo "gpu-dev: creating $SIZE in $REGION (≈ \$$PRICE_PER_HOUR/hour until stop)"
  local id
  id=$(doctl compute droplet create "$NAME" --region "$REGION" --size "$SIZE" --image "$IMAGE" \
        --tag-name "$TAG" --user-data-file "$userdata" --wait --format ID --no-header)
  local project_id; project_id=$(doctl projects list -o json | python3 -c "import json,sys; print(next(p['id'] for p in json.load(sys.stdin) if p['name']=='$PROJECT'))")
  doctl projects resources assign "$project_id" --resource="do:droplet:$id" >/dev/null
  local ip; ip=$(doctl compute droplet get "$id" --format PublicIPv4 --no-header)
  point_dns "$ip"
  set_provider_key "$key"
  echo "gpu-dev: droplet $id at $ip — LocalAI pulls its image and the model on first boot (several minutes);"
  echo "gpu-dev: the image capability turns on by itself once :8086 answers. Stop with: scripts/gpu-dev.sh stop"
}

stop() {
  local ids; ids=$(droplet_ids)
  [[ -n "$ids" ]] || { echo "gpu-dev: nothing running"; return; }
  status
  # shellcheck disable=SC2086
  doctl compute droplet delete $ids --force
  load_env; set_provider_key "stopped"
  echo "gpu-dev: destroyed — billing stopped"
}

status() {
  droplet_json | python3 -c "
import json, sys, datetime
ds = json.load(sys.stdin) or []
if not ds: print('gpu-dev: off — \$0/hour'); sys.exit()
for d in ds:
    created = datetime.datetime.fromisoformat(d['created_at'].replace('Z', '+00:00'))
    hours = (datetime.datetime.now(datetime.timezone.utc) - created).total_seconds() / 3600
    ip = next((n['ip_address'] for n in d['networks']['v4'] if n['type'] == 'public'), '?')
    print(f\"gpu-dev: {d['name']} {d['size_slug']} {d['status']} at {ip}, up {hours:.2f} h ≈ \${hours * $PRICE_PER_HOUR:.2f} so far (\$$PRICE_PER_HOUR/hour)\")
"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: scripts/gpu-dev.sh start|stop|status" >&2; exit 2 ;;
esac
