import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderBuildInfo } from "./generate-build-info";

const base = {
  version: "1.3.1",
  buildNumber: "abc1234",
  buildDate: "2026-09-30T12:00:00.000Z",
  author: "Luden",
};

test("stable builds have no channel", () => {
  const source = renderBuildInfo({ ...base, channel: null });
  assert.match(source, /version: '1\.3\.1'/);
  assert.match(source, /channel: null/);
  assert.doesNotMatch(source, /channel: 'nightly'/);
});

test("a nightly build records the Nightly channel and keeps the real version", () => {
  const source = renderBuildInfo({ ...base, channel: "nightly" });
  assert.match(source, /version: '1\.3\.1'/);
  assert.match(source, /channel: 'nightly'/);
});

test("unknown channel names are dropped", () => {
  const source = renderBuildInfo({ ...base, channel: "canary" });
  assert.match(source, /channel: null/);
});

test("CLI stamps Nightly without changing the package version", () => {
  const script = "scripts/generate-build-info.js";
  const target = "angular/src/app/shared/build-info.ts";
  execFileSync(process.execPath, [script], {
    env: { ...process.env, ORBIT_CHANNEL: "nightly" },
  });
  const nightly = readFileSync(target, "utf8");
  assert.match(nightly, /version: '1\.3\.1'/);
  assert.match(nightly, /channel: 'nightly'/);

  const env = { ...process.env };
  delete env.ORBIT_CHANNEL;
  execFileSync(process.execPath, [script], { env });
  const stable = readFileSync(target, "utf8");
  assert.match(stable, /channel: null/);
});
