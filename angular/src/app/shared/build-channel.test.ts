import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBuildChannel, versionBadge } from "./build-channel";

test("an explicit nightly channel wins over the stable version", () => {
  assert.equal(resolveBuildChannel("1.3.1", false, "nightly"), "nightly");
});

test("stable releases keep today's version parsing", () => {
  assert.equal(resolveBuildChannel("1.3.1", false, null), null);
  assert.equal(resolveBuildChannel("1.4.0-alpha.0", false, null), "alpha");
  assert.equal(resolveBuildChannel("1.3.1", true, null), "dev");
});

test("the Nightly badge is the word Nightly, not a version", () => {
  assert.equal(versionBadge("1.3.1", "nightly"), "Nightly");
  assert.equal(versionBadge("1.3.1", null), "v1.3.1");
  assert.equal(versionBadge("1.4.0-beta.1", "beta"), "v1.4.0-beta.1");
});
