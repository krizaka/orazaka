#!/usr/bin/env node
// Before paying: will the model's weights fit, and what does fetching them cost?
//   node scripts/gpu-boot-preflight.mjs --download-gb 115 --disk-gb 120 --volume none|<name> --rate 5.29 [--cached]
// Exit 1 when the weights cannot fit (nothing is created); prints the estimated download time and cost otherwise.
import { bootBudgetMinutes, diskVerdict, downloadEstimate } from "./lib/boot-budget.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const downloadGb = Number(arg("download-gb", 0)), diskGb = Number(arg("disk-gb", 0)), rate = Number(arg("rate", 0));
const volume = arg("volume", "none");
const verdict = diskVerdict({ downloadGb, diskGb, volume });
if (!verdict.fits) { console.error(`gpu-boot-preflight: refused — ${verdict.reason}`); process.exit(1); }
if (downloadGb && !process.argv.includes("--cached")) {
  const { minutes, usd } = downloadEstimate({ downloadGb, rate });
  console.log(`gpu-boot-preflight: ${downloadGb} GB to download if the volume lacks them: about ${minutes} min, $${usd} of idle GPU; engine wait ${bootBudgetMinutes({ downloadGb })} min`);
}
