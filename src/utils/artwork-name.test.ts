import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArtworkBaseName } from "./artwork-name";

test("parses classic artwork suffixes", () => {
  assert.deepEqual(parseArtworkBaseName("SCUS_944.25_COV"), {
    identity: "SCUS_944.25",
    type: "COV",
  });
  assert.deepEqual(parseArtworkBaseName("SPYRO 2 - RIPTO'S RAGE_COV3"), {
    identity: "SPYRO 2 - RIPTO'S RAGE",
    type: "COV3",
  });
});

test("keeps indexed screenshot/background suffixes intact", () => {
  assert.deepEqual(parseArtworkBaseName("SCUS_944.25_SCR_00"), {
    identity: "SCUS_944.25",
    type: "SCR_00",
  });
  assert.deepEqual(parseArtworkBaseName("Spyro4_BG_02"), {
    identity: "Spyro4",
    type: "BG_02",
  });
});