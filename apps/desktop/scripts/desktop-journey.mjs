#!/usr/bin/env node
// The Mac app's journey (krizaka-internal#230): the control panel opens, a local folder is shared, one automation summarises a PDF
// of that folder with a stand-in model, the run and its summary note are shown. Filmed from WebDriver screenshots of the window
// (the shared tooling of krizaka-tauri-kit `film/`; no screen recording, no macOS permission).
//
//   KRIZAKA_FILM_DIR=<krizaka-tauri-kit>/film node apps/desktop/scripts/desktop-journey.mjs \
//     --app apps/desktop/src-tauri/target/debug/orazaka-desktop --out desktop-journey [--film]
//
// The Orazaka Mac app has no account of its own (it controls the stack and connects to a hosted Orazaka by address), so there is no
// sign-in to drive and no credential: the model is a stand-in server on loopback. The native folder dialog cannot be driven by a
// WebDriver: the folder is granted the way the dialog would, by writing the kit's `scope.json` before the launch (the kit re-checks
// every root on load). The build is `tauri build --debug --no-bundle --features webdriver`: the driver is never in a release.
import { spawn } from "node:child_process";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { minimalPdf, scopeFile, scopeJson, startModel } from "./desktop-journey-lib.mjs";

const filmDir = process.env.KRIZAKA_FILM_DIR;
if (!filmDir) throw new Error("KRIZAKA_FILM_DIR is required (the output `dir` of krizaka-tauri-kit/.github/actions/film)");
const { createFilm } = await import(pathToFileURL(join(resolve(filmDir), "film.mjs")).href);
const { client, until } = await import(pathToFileURL(join(resolve(filmDir), "webdriver.mjs")).href);

const { values } = parseArgs({ options: { app: { type: "string" }, out: { type: "string", default: "desktop-journey" }, film: { type: "boolean", default: false } } });
if (!values.app) throw new Error("--app <path to the debug binary> is required");

const home = homedir();
const out = resolve(values.out);
// @fixed: a launch that does not answer in a minute is a build that crashed at start
const LAUNCH_MS = 60_000;
// @fixed: a screen of the app that is not there in 30 s is not coming
const SCREEN_MS = 30_000;
// @fixed: long enough to read a screen of the app, short enough for a clip under 30 s in all
const READ_MS = 2500;
const hold = (ms = READ_MS) => new Promise((done) => setTimeout(done, ms));

const SUMMARY = "Quarterly report: revenue is up 12 %, two risks are flagged for the board.";

/** The fixture: a folder under the home (the kit refuses the home itself, `/`, `/tmp`, `/var`) holding one PDF. */
async function fixtureFolder() {
  const folder = join(home, "Orazaka journey", "Reports");
  await rm(dirname(folder), { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "quarterly-report.pdf"), minimalPdf("Quarterly report. Revenue is up 12 percent. Two risks are flagged for the board."));
  return realpath(folder);
}

function launch() {
  const child = spawn(values.app, [], { stdio: ["ignore", "inherit", "inherit"] });
  child.on("error", (error) => {
    console.error(`desktop journey: cannot start the app: ${error.message}`);
    process.exit(1);
  });
  return child;
}

async function shot(driver, name) {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `${name}.png`), Buffer.from(await driver.screenshot(), "base64"));
}

const waitFor = (driver, what, css, timeoutMs = SCREEN_MS) => until(what, () => driver.exists(css), { timeoutMs });
const clickTestId = async (driver, id) => driver.click(await driver.find(`[data-testid=${id}]`));
// A React-controlled input takes the value through the native setter and an input event.
const setValue = (driver, css, value) =>
  driver.run("const el = document.querySelector(arguments[0]); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, arguments[1]); el.dispatchEvent(new Event('input', { bubbles: true }));", css, value);

let app;
let driver;
let model;
const film = createFilm({ dir: values.film ? out : undefined, shoot: () => driver.screenshot() });
try {
  const folder = await fixtureFolder();
  model = await startModel(SUMMARY);
  const scope = scopeFile(home);
  await rm(dirname(scope), { recursive: true, force: true });
  await mkdir(dirname(scope), { recursive: true });
  await writeFile(scope, scopeJson([folder]));

  // 1. The control panel opens on the stack.
  app = launch();
  driver = await until("the app's WebDriver", () => client().start(), { timeoutMs: LAUNCH_MS, everyMs: 1000 });
  await waitFor(driver, "the control panel", "[data-testid=tab-stack]");
  await mkdir(out, { recursive: true });
  await shot(driver, "1-stack");
  film.start();
  await hold();

  // 2. The folder shared with Orazaka is listed in Files.
  await clickTestId(driver, "tab-files");
  await until("the shared folder in Files", async () => (await driver.run("return document.body.innerText")).includes("Reports"), { timeoutMs: SCREEN_MS });
  await shot(driver, "2-files");
  await hold();

  // 3. An automation on that folder, with the stand-in model.
  await clickTestId(driver, "tab-automations");
  await waitFor(driver, "the new-automation button", "[data-testid=automation-new]");
  await clickTestId(driver, "automation-new");
  await waitFor(driver, "the new-automation form", "[data-testid=new-automation]");
  await setValue(driver, "#auto-base", model.baseUrl);
  await hold(1500);
  await shot(driver, "3-form");
  await clickTestId(driver, "automation-create");
  await waitFor(driver, "the automation card", "[data-testid=automation]");
  await hold();

  // 4. One run: the PDF is read and summarised by the model, the steps are shown.
  await clickTestId(driver, "automation-run");
  await waitFor(driver, "the run in the history", "[data-testid=run]", 90_000);
  await hold();
  // The trace of the run: its steps (the new automation starts in dry-run, so the note is a draft until a write is granted).
  await clickTestId(driver, "run-trace");
  await waitFor(driver, "the steps of the run", "[data-testid=run] li");
  await shot(driver, "4-run");
  await hold(4000);
  await film.stop();
  film.finish(); // too few frames: the journey fails loudly, no empty clip
  console.log("desktop journey: ok");
} catch (error) {
  await film.stop().catch(() => undefined);
  if (driver) await shot(driver, "failure").catch(() => undefined);
  console.error(`desktop journey: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (driver) await driver.quit().catch(() => undefined);
  app?.kill();
  await model?.close();
}
