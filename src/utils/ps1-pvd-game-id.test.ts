import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupPs1GameIdByPvdTimestamp } from "./ps1-pvd-game-id";

test("looks up a known PVD creation timestamp", () => {
  assert.equal(lookupPs1GameIdByPvdTimestamp("1994111009000000"), "SLPS_000.01");
  assert.equal(
    lookupPs1GameIdByPvdTimestamp("1995103122331500"),
    "SCPS_100.16",
  );
});

test("returns null for unknown or malformed timestamps", () => {
  assert.equal(lookupPs1GameIdByPvdTimestamp("1999123123595900"), null);
  assert.equal(lookupPs1GameIdByPvdTimestamp(""), null);
  assert.equal(lookupPs1GameIdByPvdTimestamp("not-a-timestamp"), null);
});