// Entry point. Loaded by index.html as a module. Loads JSON (glyphs + voice
// prose), restores the persisted meta-save from localStorage, then kicks off
// the first render.
import { loadData } from './data.js';
import { loadSave } from './save.js';
import { render } from './ui/render.js';
import { state } from './state.js';

await loadData();
state.save = loadSave();
state.screen = 'title';
render();
