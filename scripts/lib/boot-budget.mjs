// A pod's boot budget, from the catalogue (models.yaml `downloadGb`) instead of a flat idle limit (krizaka-internal#2101).
// Pure: no clock, no network. Used by scripts/runpod-batch.mjs (the engine wait) and scripts/gpu-boot-preflight.mjs (before paying).

/** @fixed: Hugging Face shards reach a RunPod pod at 100 to 300 MB/s (not measured on the incident pods): the slow end is assumed, the cap still holds. */
export const DEFAULT_MB_PER_SECOND = 100;
/** @fixed: venv + torch + upscaler + the worker, measured on a pod without a volume (~15 min). */
export const RUNTIME_SETUP_MINUTES = 15;
/** @fixed: headroom for the model load after the download and for a slow shard. */
export const BOOT_MARGIN = 1.25;
/** @fixed: the python venv, torch, the upscaler and sd-server share the disk with the weights. */
export const RUNTIME_DISK_GB = 25;

/** Minutes the download alone takes. */
export function downloadMinutes(downloadGb, mbPerSecond = DEFAULT_MB_PER_SECOND) {
  return Math.ceil((downloadGb * 1024) / mbPerSecond / 60);
}

/** The engine-wait budget in minutes: setup + download, with margin. Never below `floor` (the flat limit of a pod with nothing to fetch). */
export function bootBudgetMinutes({ downloadGb = 0, mbPerSecond = DEFAULT_MB_PER_SECOND, floor = 15 }) {
  return Math.max(floor, Math.ceil((RUNTIME_SETUP_MINUTES + downloadMinutes(downloadGb, mbPerSecond)) * BOOT_MARGIN));
}

/** Will the weights fit? `volume` is "none" (or empty) for a container disk only. */
export function diskVerdict({ downloadGb, diskGb, volume = "none" }) {
  if ((volume && volume !== "none") || !downloadGb) return { fits: true };
  const free = diskGb - RUNTIME_DISK_GB;
  return downloadGb > free
    ? { fits: false, reason: `the weights need about ${downloadGb} GB, a ${diskGb} GB disk leaves ${Math.max(0, free)} GB after the runtime: attach a network volume or raise GPU_RUNPOD_DISK_GB to ${Math.ceil(downloadGb + RUNTIME_DISK_GB)}` }
    : { fits: true };
}

/** What the download costs when the volume of the datacentre lacks the weights. */
export function downloadEstimate({ downloadGb, rate, mbPerSecond = DEFAULT_MB_PER_SECOND }) {
  const minutes = downloadMinutes(downloadGb, mbPerSecond);
  return { minutes, usd: Math.round((minutes / 60) * rate * 100) / 100 };
}

/** The line the batch prints when the engine is still not there: the download's progress, not « gone ». */
export function progressLine(progress) {
  const m = /^(\d+)\s+(\d+)\s*$/.exec(progress ?? "");
  return m ? `still downloading ${m[1]} / ${m[2]} GB` : "the pod gave no download progress";
}
