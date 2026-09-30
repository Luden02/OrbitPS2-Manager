import assert from "node:assert/strict";
import { test } from "node:test";
import { normalisePs1GameIdFromTitleCfg } from "./game-id-patterns";

// This is the guard that keeps unrelated title.cfg `GameID=` data intact. A
// regression here silently rewrites homebrew ids, which is invisible until a
// homebrew game stops matching its own artwork.
test("a lowercase PS1 serial is normalised to canonical form", () => {
  assert.equal(normalisePs1GameIdFromTitleCfg("slus-123.45"), "SLUS_123.45");
});

test("an already-canonical PS1 serial is left alone", () => {
  assert.equal(normalisePs1GameIdFromTitleCfg("SLUS_123.45"), "SLUS_123.45");
});

test("a homebrew id is passed through unchanged", () => {
  // `ABCD` is not a PS1 prefix, so the shape matches but the guard must reject
  // it. The non-canonical spelling is the point: it is the one that a later
  // edit to the guard would silently rewrite, which is what breaks a homebrew
  // game's artwork match.
  assert.equal(normalisePs1GameIdFromTitleCfg("ABCD_001.23"), "ABCD_001.23");
  assert.equal(normalisePs1GameIdFromTitleCfg("abcd-001.23"), "abcd-001.23");
});
