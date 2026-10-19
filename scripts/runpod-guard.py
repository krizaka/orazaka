#!/usr/bin/env python3
"""RunPod spend guard (ADR-078): stop a pod that idles or lives too long. Never terminates (the volume stays).

  runpod-guard.py status            pods, uptime, GPU use, $/h  (needs AI_GPU_RUNPOD_API_KEY in the env)
  runpod-guard.py once              one pass: stop the pods the rule below condemns
  runpod-guard.py loop [seconds]    `once` every 60 s (or the given interval) until interrupted
  runpod-guard.py decide FILE       the rule alone, on a JSON fixture (tests): prints the pods to stop

Rule: a RUNNING pod is stopped when its GPU stayed under IDLE_UTIL % for IDLE_MINUTES (default 5 % / 20 min),
or when it has run MAX_HOURS (default 6 h) whatever it does. The key comes from the environment, never an argument.
"""
import json
import os
import sys
import time
import urllib.request

GRAPHQL = "https://api.runpod.io/graphql"
REST = "https://rest.runpod.io/v1"
IDLE_MINUTES = float(os.environ.get("GPU_IDLE_MINUTES", "20"))
MAX_HOURS = float(os.environ.get("GPU_MAX_HOURS", "6"))
IDLE_UTIL = float(os.environ.get("GPU_IDLE_UTIL", "5"))
STATE = os.path.expanduser(os.environ.get("GPU_LOCAL_DIR", "~/.orazaka/gpu-dev")) + "/runpod-idle.json"


def decide(pods, idle_since, now):
    """pods: [{id, name, uptime, util}] RUNNING only. Returns (to_stop [(id, reason)], new idle_since)."""
    stop, kept = [], {}
    for pod in pods:
        pid = pod["id"]
        if pod["util"] >= IDLE_UTIL:
            kept.pop(pid, None)
        else:
            kept[pid] = idle_since.get(pid, now)
        if pod["uptime"] >= MAX_HOURS * 3600:
            stop.append((pid, f"lived {pod['uptime'] / 3600:.1f} h (max {MAX_HOURS:g})"))
        elif pid in kept and now - kept[pid] >= IDLE_MINUTES * 60:
            stop.append((pid, f"GPU under {IDLE_UTIL:g}% for {(now - kept[pid]) / 60:.0f} min"))
    return stop, kept


def call(url, key, body=None, method=None):
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, method=method,
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read() or b"{}")


def running(key):
    query = "query{myself{pods{id name costPerHr desiredStatus runtime{uptimeInSeconds gpus{gpuUtilPercent}}}}}"
    pods = call(GRAPHQL, key, {"query": query})["data"]["myself"]["pods"]
    out = []
    for pod in pods:
        if pod.get("desiredStatus") != "RUNNING":
            continue
        runtime = pod.get("runtime") or {}
        gpus = runtime.get("gpus") or []
        out.append({"id": pod["id"], "name": pod["name"], "cost": pod.get("costPerHr") or 0,
                    "uptime": runtime.get("uptimeInSeconds") or 0,
                    "util": max([g.get("gpuUtilPercent") or 0 for g in gpus] or [0])})
    return out


def load_state():
    try:
        return json.load(open(STATE))
    except (OSError, ValueError):
        return {}


def once(key):
    pods = running(key)
    to_stop, idle = decide(pods, load_state(), time.time())
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(idle, open(STATE, "w"))
    for pid, reason in to_stop:
        call(f"{REST}/pods/{pid}/stop", key, method="POST")
        print(f"runpod-guard: stopped {pid} — {reason}", flush=True)
    return len(to_stop)


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "status"
    if cmd == "decide":
        fixture = json.load(open(argv[2]))
        stop, _ = decide(fixture["pods"], fixture.get("idle_since", {}), fixture["now"])
        print(json.dumps(stop))
        return 0
    key = os.environ.get("AI_GPU_RUNPOD_API_KEY", "")
    if not key:
        print("runpod-guard: AI_GPU_RUNPOD_API_KEY is not in the environment", file=sys.stderr)
        return 1
    if cmd == "status":
        pods = running(key)
        for pod in pods:
            print(f"{pod['name']} {pod['id']} up {pod['uptime'] / 3600:.1f} h GPU {pod['util']:g}% ${pod['cost']}/h")
        print(f"{len(pods)} running, ${sum(p['cost'] for p in pods):.2f}/h")
    elif cmd == "once":
        once(key)
    elif cmd == "loop":
        every = float(argv[2]) if len(argv) > 2 else 60
        while True:
            try:
                once(key)
            except Exception as error:  # a network blip must not end the guard
                print(f"runpod-guard: {error}", file=sys.stderr, flush=True)
            time.sleep(every)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
