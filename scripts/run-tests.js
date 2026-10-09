const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function collectTests(dir) {
  const tests = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      tests.push(...collectTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      tests.push(fullPath);
    }
  }
  return tests;
}

const tests = collectTests(path.resolve(__dirname, "..", "src"));
if (tests.length === 0) {
  console.error("No TypeScript tests found under src/.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["-r", "ts-node/register/transpile-only", "--test", ...tests],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
