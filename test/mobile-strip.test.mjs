// Mobile readout strip (src/mobile-strip.js): tack chip and cell texts.
import { tackOf, stripTexts } from '../src/mobile-strip.js';
let n = 0;
const check = (name, ok) => { if (!ok) throw new Error('failed: ' + name); n++; };
check('positive twa is port', tackOf(45) === 'port');
check('negative twa is starboard', tackOf(-45) === 'stbd');
check('head to wind / dead downwind: no tack', tackOf(0) === null && tackOf(180) === null && tackOf(-180) === null);
check('wraps', tackOf(315) === 'stbd' && tackOf(-315) === 'port');
check('no value', tackOf(null) === null && tackOf(NaN) === null);
const t = stripTexts({ bs: 2.94, vmg: 1.86, twa: -49.4, tws: 4.12 });
check('cells formatted', t.bs === '2.9' && t.vmg === '1.9' && t.tws === '4.1');
check('twa shown off the wind with a tack', t.twa === '49' && t.tack === 'stbd');
const d = stripTexts(null);
check('dashes without a boat', d.bs === '–' && d.twa === '–' && d.tack === null);
console.log(`all ${n} mobile strip checks passed`);
