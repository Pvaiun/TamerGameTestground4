// Global mutable game state. Imported by every module that needs to read or
// write state; the renderer reads state.screen and dispatches.
//
// The whole app is one document. A "run" is a single descent from admission
// to discharge (or to whatever takes you). state.run holds the per-run state;
// state.save holds persistent meta progression (loaded from localStorage).

export const RUN_DEPTH = 5;          // number of wings before the final encounter
export const COMPOSURE_MAX = 5;
export const POSE_QUEUE_VISIBLE = 3; // how many of the patient's upcoming poses we show

// The single state object. All modules mutate it directly.
export const state = {
  screen: 'title',
  save: null,   // loaded from localStorage on boot
  run:   null,  // null between runs

  // ── encounter live state (set by combat engine while screen === 'encounter')
  enc:   null,

  // ── narration / typing
  log: [],
  typingIdx: -1,

  // ── pending UI gates
  acting: false,
};

// pushLog accepts either a string or a structured object. The combat engine
// drains the log between actions, animating each line in beat. Fields:
//   text       — required, parsed via parseProse
//   cls        — extra css class on the line
//   damage     — number to render as -N in red
//   heal       — number to render as +N
//   pause      — ms to pause after typing finishes (default depends on length)
//   anim       — { kind: 'shake'|'lunge'|'recoil'|'callout', side?, text? }
export function pushLog(text, opts) {
  let entry;
  if (text && typeof text === 'object' && !Array.isArray(text)) entry = { ...text };
  else entry = { text: String(text || ''), ...(opts || {}) };
  entry.text   = String(entry.text || '');
  entry.cls    = entry.cls || '';
  entry.damage = entry.damage || 0;
  entry.heal   = entry.heal   || 0;
  state.log.push(entry);
  if (state.log.length > 80) state.log.shift();
}

export function clearLog() { state.log.length = 0; state.typingIdx = -1; }

let _idCounter = 1;
export function nextId() { return _idCounter++; }
