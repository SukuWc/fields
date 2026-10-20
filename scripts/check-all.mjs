// Runs every scripts/*-check.mjs (node --import ./test/register.mjs) one by
// one and exits nonzero if any of them fails. Usage: npm run check:all
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const checks = readdirSync(dir).filter((f) => f.endsWith("-check.mjs")).sort();
const failed = [];
for (const f of checks) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--import", "./test/register.mjs", path.join("scripts", f)], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const ok = r.status === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${f} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!ok) { failed.push(f); process.stdout.write((r.stdout || "").split("\n").slice(-30).join("\n") + (r.stderr || "").split("\n").slice(-30).join("\n") + "\n"); }
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) { console.log("failed:", failed.join(", ")); process.exit(1); }
