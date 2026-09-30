import assert from "node:assert/strict";
import { test } from "node:test";
import { findPs1GameName } from "./games-list";

test("unique PS1 serial returns its canonical title", async () => {
  assert.equal(
    await findPs1GameName("SCUS-94425"),
    "SPYRO 2 - RIPTO'S RAGE"
  );
});

test("ambiguous PS1 serial does not choose a destructive canonical title", async () => {
  assert.equal(await findPs1GameName("SLES-00250"), undefined);
  assert.equal(await findPs1GameName("SLPM-86621"), undefined);
});
