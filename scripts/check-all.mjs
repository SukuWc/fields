// Runs every scripts/*-check.mjs (node --import ./test/register.mjs) in a pool
// and exits nonzero if any of them fails. Usage: npm run check:all
// CHECK_CONCURRENCY=N sets the pool size (default: available CPUs; 1 = serial).
// Slowest checks start first; each child's output is printed when it finishes.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");
const SLOW_FIRST = ["budget-check", "amr-auto-check", "fast-wind-check"];
// Checks that must not share the CPU (wall-clock assertions): run alone after the pool.
const SERIAL = [];

const all = readdirSync(dir).filter((f) => f.endsWith("-check.mjs")).sort();
const rank = (f) => { const i = SLOW_FIRST.indexOf(f.replace(/\.mjs$/, "")); return i < 0 ? SLOW_FIRST.length : i; };
const ordered = [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const poolChecks = ordered.filter((f) => !SERIAL.includes(f.replace(/\.mjs$/, "")));
const serialChecks = ordered.filter((f) => SERIAL.includes(f.replace(/\.mjs$/, "")));
const concurrency = Math.max(1, Number(process.env.CHECK_CONCURRENCY) || availableParallelism());
const failed = [];

function runOne(f) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const chunks = [];
    const child = spawn(process.execPath, ["--import", "./test/register.mjs", path.join("scripts", f)], { cwd: root });
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));
    let finished = false;
    const done = (ok, extra = "") => {
      if (finished) return;
      finished = true;
      console.log(`${ok ? "PASS" : "FAIL"} ${f} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      if (!ok) {
        failed.push(f);
        process.stdout.write(Buffer.concat(chunks).toString().split("\n").slice(-30).join("\n") + extra + "\n");
      }
      resolve();
    };
    child.on("error", (e) => done(false, `\nspawn error: ${e.message}`));
    child.on("close", (code) => done(code === 0));
  });
}

async function pool(list, n) {
  const queue = [...list];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await runOne(queue.shift());
  }));
}

const t0 = Date.now();
await pool(poolChecks, concurrency);
await pool(serialChecks, 1);
console.log(`\n${all.length - failed.length}/${all.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)} s (concurrency ${concurrency})`);
if (failed.length) { console.log("failed:", failed.join(", ")); process.exit(1); }
