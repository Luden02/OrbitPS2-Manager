import assert from "node:assert/strict";
import { test } from "node:test";
import { checkForUpdates, isNewerVersion } from "./update.service";

function release(tag: string, extra: { draft?: boolean; name?: string } = {}) {
  return {
    tag_name: tag,
    name: extra.name ?? tag,
    html_url: `https://github.com/Luden02/OrbitPS2-Manager/releases/tag/${tag}`,
    draft: extra.draft ?? false,
  };
}

async function withReleases(
  body: unknown,
  run: () => Promise<void>,
  response: { ok?: boolean; status?: number } = {}
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => body,
    }) as Response;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("a nightly prerelease channel does not hide the stable release behind it", async () => {
  await withReleases([release("v1.3.2-nightly.1"), release("v1.3.1")], async () => {
    const result = await checkForUpdates();
    assert.equal(result.latestVersion, "1.3.1");
    assert.equal(result.updateAvailable, false);
  });
});

test("a rolling nightly release does not hide the stable release behind it", async () => {
  let requested = "";
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested = String(input);
    return {
      ok: true,
      status: 200,
      json: async () => [release("nightly"), release("v1.3.2", { name: "1.3.2" })],
    } as Response;
  };
  try {
    const result = await checkForUpdates();
    assert.equal(requested, "https://api.github.com/repos/Luden02/OrbitPS2-Manager/releases?per_page=10");
    assert.equal(result.updateAvailable, true);
    assert.equal(result.latestVersion, "1.3.2");
    assert.equal(result.releaseName, "1.3.2");
    assert.equal(
      result.releaseUrl,
      "https://github.com/Luden02/OrbitPS2-Manager/releases/tag/v1.3.2"
    );
    assert.equal(result.currentVersion, "1.3.1");
    assert.equal(result.error, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("the same stable version behind a nightly tag is not an update", async () => {
  await withReleases([release("vNightly"), release("v1.3.1", { name: "" })], async () => {
    const result = await checkForUpdates();
    assert.equal(result.updateAvailable, false);
    assert.equal(result.latestVersion, "1.3.1");
    assert.equal(result.releaseName, "v1.3.1");
  });
});

test("nightly-rc is ignored the same way shipped clients already ignore rc tags", async () => {
  await withReleases([release("nightly-rc"), release("v1.3.2")], async () => {
    const result = await checkForUpdates();
    assert.equal(result.latestVersion, "1.3.2");
    assert.equal(result.updateAvailable, true);
  });
});

test("drafts and the other prerelease channels are skipped", async () => {
  await withReleases(
    [
      release("v9.0.0", { draft: true }),
      release("v1.3.2-alpha.1"),
      release("v1.3.2-beta.1"),
      release("v1.3.2-rc.1"),
      release("v1.3.2-release-candidate.1"),
      release("v1.3.2-indev.1"),
      release("v1.2.0"),
    ],
    async () => {
      const result = await checkForUpdates();
      assert.equal(result.latestVersion, "1.2.0");
      assert.equal(result.updateAvailable, false);
    }
  );
});

test("no published release means there is nothing to install", async () => {
  await withReleases([release("nightly", { draft: true })], async () => {
    const result = await checkForUpdates();
    assert.deepEqual(result, { updateAvailable: false, currentVersion: "1.3.1" });
  });
});

test("a GitHub error is reported and offers no update", async () => {
  await withReleases([], async () => {
    const result = await checkForUpdates();
    assert.equal(result.updateAvailable, false);
    assert.equal(result.currentVersion, "1.3.1");
    assert.equal(result.error, "GitHub responded with 403");
  }, { ok: false, status: 403 });
});

test("a network failure is reported and offers no update", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const result = await checkForUpdates();
    assert.equal(result.updateAvailable, false);
    assert.equal(result.error, "network down");
  } finally {
    globalThis.fetch = original;
  }
});

test("a non-Error failure is still reported", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw "offline";
  };
  try {
    const result = await checkForUpdates();
    assert.equal(result.error, "offline");
  } finally {
    globalThis.fetch = original;
  }
});

test("isNewerVersion compares the numeric core, then the prerelease", () => {
  assert.equal(isNewerVersion("2.0.0", "1.3.1"), true);
  assert.equal(isNewerVersion("1.2.0", "1.3.1"), false);
  assert.equal(isNewerVersion("1.3.2", "1.3.1"), true);
  assert.equal(isNewerVersion("1.3.0", "1.3.1"), false);
  assert.equal(isNewerVersion("v1.3.1", "1.3.1"), false);
  assert.equal(isNewerVersion("1.4", "1.3.9"), true);
  assert.equal(isNewerVersion("1.3.foo", "1.3.0"), false);
  assert.equal(isNewerVersion("1.3.1", "1.3.1-beta.1"), true);
  assert.equal(isNewerVersion("1.3.1-zzz", "1.3.1"), false);
  assert.equal(isNewerVersion("1.3.1-rc.2", "1.3.1-rc.1"), true);
  assert.equal(isNewerVersion("1.3.1-rc.1", "1.3.1-rc.2"), false);
  assert.equal(isNewerVersion("v1.3.1-beta.1", "1.3.1-beta.1"), false);
});
