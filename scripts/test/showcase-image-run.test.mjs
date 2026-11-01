// node --test scripts/test — the showcase's image step: the Studio's own inputs, at the clip's own size (the still is made at the video's aspect).
import assert from "node:assert/strict";
import { test } from "node:test";
import { imageInputs } from "../showcase-image-run.mjs";

test("a clip's still is made at its own size and model, else at the run's defaults", () => {
  assert.deepEqual(imageInputs({ scene: "a cable car" }, "flux-2-klein-4b", "1360x768"), { prompt: "a cable car", size: "1360x768", model: "flux-2-klein-4b" });
  assert.deepEqual(imageInputs({ scene: "a walk", size: "768x1360", imageSeed: 7 }, "flux-2-klein-4b", "1360x768"), { prompt: "a walk", size: "768x1360", model: "flux-2-klein-4b", seed: "7" });
  assert.equal(imageInputs({ scene: "x", imageModel: "stable-diffusion-3.5-large" }, "flux-2-klein-4b", "1024x1024").model, "stable-diffusion-3.5-large");
});

test("references are passed as the Studio's list, and only when the clip has some", () => {
  assert.deepEqual(imageInputs({ scene: "x", references: ["a1", "b2"] }, "flux-2-klein-4b", "1360x768").references, ["a1", "b2"]);
  assert.equal("references" in imageInputs({ scene: "x", references: [] }, "flux-2-klein-4b", "1360x768"), false);
});
