import assert from "node:assert/strict";
import { test } from "node:test";
import { artRemoteFileNames } from "./artwork-filenames";

test("classic types keep a single remote filename", () => {
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "COV"), [
    "SLUS_208.51_COV.png",
  ]);
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "ICO"), [
    "SLUS_208.51_ICO.png",
  ]);
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "LAB"), [
    "SLUS_208.51_LAB.png",
  ]);
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "LGO"), [
    "SLUS_208.51_LGO.png",
  ]);
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "COV2"), [
    "SLUS_208.51_COV2.png",
  ]);
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "COV3"), [
    "SLUS_208.51_COV3.png",
  ]);
});

test("SCR prefers indexed SCR_00 then classic SCR", () => {
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "SCR"), [
    "SLUS_208.51_SCR_00.png",
    "SLUS_208.51_SCR.png",
  ]);
});

test("SCR2 prefers indexed SCR_01 then classic SCR2", () => {
  assert.deepEqual(artRemoteFileNames("SLUS_212.69", "SCR2"), [
    "SLUS_212.69_SCR_01.png",
    "SLUS_212.69_SCR2.png",
  ]);
});

test("SCR3 prefers indexed SCR_02 then classic SCR3", () => {
  assert.deepEqual(artRemoteFileNames("SCUS_974.72", "SCR3"), [
    "SCUS_974.72_SCR_02.png",
    "SCUS_974.72_SCR3.png",
  ]);
});

test("BG prefers indexed BG_00 then classic BG", () => {
  assert.deepEqual(artRemoteFileNames("SLUS_204.86", "BG"), [
    "SLUS_204.86_BG_00.png",
    "SLUS_204.86_BG.png",
  ]);
});

test("already-indexed types are not remapped again", () => {
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "SCR_00"), [
    "SLUS_208.51_SCR_00.png",
  ]);
  assert.deepEqual(artRemoteFileNames("SLUS_208.51", "BG_00"), [
    "SLUS_208.51_BG_00.png",
  ]);
});
