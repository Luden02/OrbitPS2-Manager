import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { materializeNightlyAssets, planNightlyAssets, run } from "./collect-nightly-assets";

const FIXTURES = [
  "artifacts/nightly-windows-latest/OrbitPS2Manager Nightly Setup 1.3.1.exe",
  "artifacts/nightly-windows-latest/OrbitPS2Manager Nightly Setup 1.3.1.exe.blockmap",
  "artifacts/nightly-windows-latest/OrbitPS2Manager Nightly-linux-1.3.1-x64.zip",
  "artifacts/nightly-macos-latest/OrbitPS2Manager Nightly-1.3.1-arm64.dmg",
  "artifacts/nightly-macos-latest/OrbitPS2Manager Nightly-1.3.1-x64.dmg",
  "artifacts/nightly-ubuntu-latest/OrbitPS2Manager Nightly-1.3.1.AppImage",
  "artifacts/nightly-ubuntu-latest/orbitps2-manager-nightly_1.3.1_amd64.deb",
  "artifacts/nightly-ubuntu-latest/orbitps2-manager-nightly-1.3.1.x86_64.rpm",
  "artifacts/nightly-ubuntu-latest/OrbitPS2Manager Nightly-linux-1.3.1-x64.zip",
  "artifacts/nightly-ubuntu-latest/builder-debug.yml",
];

test("maps builder output onto stable Nightly filenames", () => {
  const plan = planNightlyAssets(FIXTURES);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(
    Object.fromEntries(plan.outputs.map((item) => [item.name, item.source])),
    {
      "OrbitPS2Manager-Nightly-win-x64.exe":
        "artifacts/nightly-windows-latest/OrbitPS2Manager Nightly Setup 1.3.1.exe",
      "OrbitPS2Manager-Nightly-win-x64.zip":
        "artifacts/nightly-windows-latest/OrbitPS2Manager Nightly-linux-1.3.1-x64.zip",
      "OrbitPS2Manager-Nightly-mac-arm64.dmg":
        "artifacts/nightly-macos-latest/OrbitPS2Manager Nightly-1.3.1-arm64.dmg",
      "OrbitPS2Manager-Nightly-mac-x64.dmg":
        "artifacts/nightly-macos-latest/OrbitPS2Manager Nightly-1.3.1-x64.dmg",
      "OrbitPS2Manager-Nightly-linux-x64.AppImage":
        "artifacts/nightly-ubuntu-latest/OrbitPS2Manager Nightly-1.3.1.AppImage",
      "OrbitPS2Manager-Nightly-linux-x64.deb":
        "artifacts/nightly-ubuntu-latest/orbitps2-manager-nightly_1.3.1_amd64.deb",
      "OrbitPS2Manager-Nightly-linux-x64.rpm":
        "artifacts/nightly-ubuntu-latest/orbitps2-manager-nightly-1.3.1.x86_64.rpm",
      "OrbitPS2Manager-Nightly-linux-x64.zip":
        "artifacts/nightly-ubuntu-latest/OrbitPS2Manager Nightly-linux-1.3.1-x64.zip",
    },
  );
});

test("electron-builder's unsuffixed DMG is the x64 build", () => {
  const files = FIXTURES.map((file) =>
    file.endsWith("-x64.dmg")
      ? "artifacts/nightly-macos-latest/OrbitPS2Manager Nightly-1.3.1.dmg"
      : file,
  );
  const plan = planNightlyAssets(files);
  assert.deepEqual(plan.missing, []);
  assert.equal(
    plan.outputs.find((item) => item.name.endsWith("mac-x64.dmg"))?.source,
    "artifacts/nightly-macos-latest/OrbitPS2Manager Nightly-1.3.1.dmg",
  );
});

test("reports every required asset that did not show up", () => {
  const plan = planNightlyAssets(FIXTURES.filter((file) => !file.endsWith(".rpm") && !file.endsWith(".deb")));
  assert.deepEqual(plan.missing.sort(), [
    "OrbitPS2Manager-Nightly-linux-x64.deb",
    "OrbitPS2Manager-Nightly-linux-x64.rpm",
  ]);
});

test("rejects two files that claim the same Nightly slot", () => {
  assert.throws(
    () => planNightlyAssets([
      ...FIXTURES,
      "artifacts/nightly-windows-latest/OrbitPS2Manager Nightly Setup 1.3.1 (2).exe",
    ]),
    /duplicate win-exe/,
  );
});

test("classifies zips by name when the artifact directory is not a platform folder", () => {
  const plan = planNightlyAssets([
    "drop\\OrbitPS2Manager Nightly Setup 1.3.1.exe",
    "drop/OrbitPS2Manager-win-x64.zip",
    "drop/OrbitPS2Manager-1.3.1-aarch64.dmg",
    "drop/OrbitPS2Manager-1.3.1-amd64.dmg",
    "drop/OrbitPS2Manager.dmg",
    "drop/OrbitPS2Manager-linux-1.3.1-x64.zip",
    "drop/OrbitPS2Manager.AppImage",
    "drop/orbitps2-manager-nightly_1.3.1_amd64.deb",
    "drop/orbitps2-manager-nightly-1.3.1.x86_64.rpm",
    "notes.yaml",
  ]);
  assert.deepEqual(plan.missing, []);
  assert.equal(
    plan.outputs.find((item) => item.name.endsWith("win-x64.zip"))?.source,
    "drop/OrbitPS2Manager-win-x64.zip",
  );
  assert.equal(
    plan.outputs.find((item) => item.name.endsWith("linux-x64.zip"))?.source,
    "drop/OrbitPS2Manager-linux-1.3.1-x64.zip",
  );
});

test("refuses to publish a partial Nightly", async () => {
  await assert.rejects(
    () => materializeNightlyAssets(["only.exe"], path.join(tmpdir(), "unused-nightly")),
    /missing nightly assets/,
  );
});

test("CLI walks an artifact tree and fails closed when a file is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nightly-cli-"));
  try {
    const sources: string[] = [];
    for (const relative of FIXTURES.filter((file) => !file.endsWith(".rpm"))) {
      const absolute = path.join(root, "artifacts", relative.replace(/^artifacts\//, ""));
      await mkdirParent(absolute);
      await writeFile(absolute, "x");
      sources.push(absolute);
    }
    const dest = path.join(root, "out");
    const missing = await run([path.join(root, "artifacts"), dest]);
    assert.equal(missing.code, 1);
    assert.match(missing.error ?? "", /rpm/);

    await writeFile(path.join(root, "artifacts", "nightly-ubuntu-latest", "app.rpm"), "rpm");
    const ok = await run([path.join(root, "artifacts"), dest]);
    assert.equal(ok.code, 0);
    assert.equal(await readFile(path.join(dest, "OrbitPS2Manager-Nightly-linux-x64.rpm"), "utf8"), "rpm");

    const usage = await run([]);
    assert.equal(usage.code, 2);
    assert.match(usage.error ?? "", /usage:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes renamed files and SHA256SUMS", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nightly-assets-"));
  try {
    const sources: string[] = [];
    for (const relative of FIXTURES) {
      const absolute = path.join(root, relative);
      await mkdirParent(absolute);
      await writeFile(absolute, `bytes:${path.basename(relative)}`);
      sources.push(absolute);
    }
    const dest = path.join(root, "dist-nightly");
    await materializeNightlyAssets(sources, dest);
    const sums = await readFile(path.join(dest, "SHA256SUMS"), "utf8");
    assert.match(sums, /^[0-9a-f]{64}  OrbitPS2Manager-Nightly-linux-x64.AppImage$/m);
    assert.equal(sums.trim().split("\n").length, 8);
    const exe = await readFile(path.join(dest, "OrbitPS2Manager-Nightly-win-x64.exe"), "utf8");
    assert.equal(exe, "bytes:OrbitPS2Manager Nightly Setup 1.3.1.exe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function mkdirParent(file: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(file), { recursive: true });
}
