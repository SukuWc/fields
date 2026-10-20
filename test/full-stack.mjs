// Pin the pre-#86 boat refinement stack (every level of the mode, each
// level's own disk radius) for every Boltzmann built after this import.
// Engine tests that check the stack's mechanics or main-parity numbers use
// it; the app default (3 levels, 3 m) is checked in refine-settings.test.
import { Boltzmann } from '../src/boltzmann.js';
Boltzmann.defaultRefine = { maxLevel: null, boatRefineRadius: null };
