// Wall-clock timing test: run serially after the parallel suite (npm run test:timing).
// Re-runs test/amr.test.mjs with AMR_STEP_TIMING=1 so the "scenario 0 step stays cheap"
// check (mean step < 12 ms) is measured without other test files competing for CPU.
import { execFileSync } from 'node:child_process';
try {
  const out = execFileSync(process.execPath, ['--import', './test/register.mjs', 'test/amr.test.mjs'],
    { env: { ...process.env, AMR_STEP_TIMING: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  console.log(out.split('\n').filter((l) => /step stays cheap|all checks passed/.test(l)).join('\n'));
  process.exit(0);
} catch (e) {
  console.log(String(e.stdout || '').split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
  process.exit(1);
}
