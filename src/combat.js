// The encounter. Not a fight in the JRPG sense — a conversation with
// someone whose mind is its own weather.
//
// Each patient defines its own SCALES (hidden axes like "tenderness",
// "grip", "lucidity"), its own VERBS (the things you can do — patient-
// specific, with branched authored responses), its own DRIFT (what
// happens on a WAIT turn — the patient acts on its own), and its own
// ENDINGS (the first matching ending fires; that's the resolution).
//
// The engine here is small. It dispatches to the patient's hand-authored
// functions, applies their returned effects to encounter state, drains
// the log between every entry (click-to-advance), and checks endings.
// All the texture lives in src/patients.js.

import { state, pushLog, clearLog, COMPOSURE_MAX } from './state.js';
import { sleep, randi } from './rng.js';
import { sfx } from './audio.js';
import { render } from './ui/render.js';
import { sumMod, fireTraitHooks, TRAITS } from './traits.js';
import { WOUNDS } from './wounds.js';
import { SCARS, applyScar } from './scars.js';
import { shakeStage, spawnCallout } from './ui/animations.js';

// ─── player setup ───────────────────────────────────────────────────────

export function makePlayer(wound) {
  const w = WOUNDS[wound];
  const player = {
    name: 'Patient 0413',
    wound,
    traits: [],
    scars: [],
    composureMax: COMPOSURE_MAX,
    composure: 0,
    signature: null,
  };
  if (w && w.signature && TRAITS[w.signature]) {
    player.signature = { id: w.signature, usesLeft: 1 };
  }
  // recompute first so composureMax reflects wound mods, then seed composure
  // from the wound's startComposure (once-per-run, at admission).
  recomputePlayerStats(player);
  const initComposure = (w?.mods.startComposure || 0) + sumMod(player, 'startComposure');
  player.composure = Math.min(player.composureMax, Math.max(0, initComposure));
  return player;
}

export function recomputePlayerStats(player) {
  // composureMax: base + wound mod + trait/signature mods. (sumMod only sees
  // traits and signature — wound mods are separate and need to be added
  // explicitly, just like with startComposure.)
  const w = WOUNDS[player.wound];
  player.composureMax = COMPOSURE_MAX
    + (w?.mods.composureMax || 0)
    + sumMod(player, 'composureMax');
  // scars then cap the max from above (e.g. Witnessed caps at 4).
  for (const sid of player.scars || []) {
    const s = SCARS[sid];
    if (s && typeof s.composureCap === 'number') {
      player.composureMax = Math.min(player.composureMax, s.composureCap);
    }
  }
  if (player.composure > player.composureMax) player.composure = player.composureMax;
}

export function addTrait(player, traitId) {
  if (!TRAITS[traitId]) return;
  if (!player.traits.includes(traitId)) player.traits.push(traitId);
  recomputePlayerStats(player);
}

// ─── encounter setup ────────────────────────────────────────────────────

export function beginEncounter(patientDef, player) {
  // Build the live patient instance. patient.scales is the per-encounter
  // hidden state; the patient definition's initialize() (if present) sets
  // the starting values (often with small RNG variance).
  const patient = {
    id: patientDef.id,
    name: patientDef.name,
    glyph: patientDef.glyph,
    subtitle: patientDef.subtitle,
    file: [...(patientDef.file || [])],
    def: patientDef,
    scales: {},
    effects: {},
    playerEffects: {},
    flags: {},
    turn: 0,
  };
  for (const [k, def] of Object.entries(patientDef.scales || {})) {
    patient.scales[k] = clamp(def.initial ?? 0, def.min ?? 0, def.max ?? 5);
  }
  if (typeof patientDef.initialize === 'function') {
    try { patientDef.initialize(patient, player); } catch (e) { console.error('initialize error', e); }
  }

  // Composure CARRIES across encounters — corridor events and trait heals
  // accumulate. The wound's startComposure is a per-fight BASELINE: composure
  // can carry above it from events, but is raised TO it at fight start if
  // depleted. Scar startComposureDeltas reduce the baseline (Abandoned: -1),
  // never below an absolute floor of 1 so the player can always do at least
  // one cost-1 verb (and WAIT / 0-cost verbs are always available).
  recomputePlayerStats(player);
  const w = WOUNDS[player.wound];
  const ABS_FLOOR = 1;
  let baseline = (w?.mods.startComposure || 0) + sumMod(player, 'startComposure');
  for (const sid of player.scars || []) {
    const s = SCARS[sid];
    if (s && typeof s.startComposureDelta === 'number') baseline += s.startComposureDelta;
  }
  baseline = Math.max(ABS_FLOOR, Math.min(player.composureMax, baseline));
  player.composure = Math.max(baseline, player.composure);
  player.composure = Math.min(player.composureMax, player.composure);
  if (player.signature) player.signature.usesLeft = 1;

  state.enc = {
    patient,
    player,
    awaitingPlayer: false,
    awaitingResolution: false,
    over: false,
    outcome: null,
    endingId: null,
    pendingTrait: null,
    pendingScars: [],
  };
  clearLog();
  state.screen = 'encounter';

  fireTraitHooks(player, 'onEncounterStart', { player, patient });
  runEncounterIntro();
}

async function runEncounterIntro() {
  const enc = state.enc;
  state.acting = true;
  render();
  await sleep(180);
  const intro = enc.patient.def.intro;
  const lines = Array.isArray(intro) ? intro : [intro || 'a door.'];
  for (const l of lines) {
    pushLog({ text: l, cls: 'intro' });
    await drainLog();
  }
  // a patient may interject immediately if their opening condition matches.
  await maybeFireInterjection();
  state.acting = false;
  enc.awaitingPlayer = true;
  render();
}

// ─── verb / interjection dispatch ──────────────────────────────────────
//
// Verbs are no longer gated by composure cost. Composure is your run-long
// health track; you lose it as a CONSEQUENCE of risky verbs or patient
// reactions, never as a precondition to act.
//
// Verbs can declare a `when(patient, player)` predicate; the UI hides
// verbs whose predicate returns false. So the available action set shifts
// as the patient changes state — different scales surface different
// possibilities.
//
// Interjections are patient-initiated turns. Each patient may declare a
// list of interjections (`{ id, when, once?, prose: [...], responses: [...] }`).
// When the player would normally act, we check interjections first; if
// one fires, its responses replace the verb menu for that turn.
//
// `patient.flags.lastVerb` and `patient.flags.streak` are tracked by the
// engine so authored responses can branch when the player repeats a verb.

export async function playerVerb(verbId) {
  const enc = state.enc;
  if (!enc || !enc.awaitingPlayer || state.acting) return;
  state.acting = true;
  enc.awaitingPlayer = false;
  if (enc.activeInterjection) {
    await runInterjectionResponse(parseInt(verbId, 10));
  } else {
    await runPlayerVerb(verbId);
  }
}

async function runPlayerVerb(verbId) {
  const enc = state.enc;
  const p = enc.player;
  const pat = enc.patient;

  // streak tracking — authored responses can read pat.flags.lastVerb and
  // pat.flags.streak to make repeated verbs land differently.
  if (pat.flags.lastVerb === verbId) {
    pat.flags.streak = (pat.flags.streak || 1) + 1;
  } else {
    pat.flags.streak = 1;
  }
  pat.flags.lastVerb = verbId;

  if (verbId === 'wait') {
    await applyResponse(callDrift(pat, p));
  } else if (verbId === 'leave') {
    pat.flags.left = true;
    const resp = (typeof pat.def.onLeave === 'function')
      ? pat.def.onLeave(pat, p)
      : { lines: ['I walk out. I leave the door open behind me.', '(I am farther from her than I came.)'], composure: -2, scars: ['abandoned'] };
    await applyResponse(resp);
  } else if (verbId === 'signature') {
    await runSignature();
  } else {
    const verb = (pat.def.verbs || {})[verbId];
    if (!verb) {
      pushLog({ text: 'I cannot do that here.', cls: 'flavor' });
      await drainLog();
      state.acting = false; enc.awaitingPlayer = true; render(); return;
    }
    const resp = (typeof verb.respond === 'function')
      ? verb.respond(pat, p)
      : { lines: ['nothing happens.'] };
    await applyResponse(resp);
  }

  fireTraitHooks(p, 'onPlayerVerb', {
    enc, player: p, patient: pat, verbId,
    composure(delta) { p.composure = clamp(p.composure + delta, 0, p.composureMax); },
    log(s, opts = {}) { pushLog({ text: s, cls: opts.cls || 'flavor' }); },
  });
  if (state.shownLogIdx < state.log.length - 1) await drainLog();

  pat.turn++;
  await postTurn();
}

async function runInterjectionResponse(idx) {
  const enc = state.enc;
  const pat = enc.patient;
  const intr = enc.activeInterjection;
  const resp = intr.responses[idx];
  enc.activeInterjection = null;
  pat.flags.lastVerb = `interjection:${intr.id}`;
  pat.flags.streak = 1;
  if (resp) await applyResponse(resp);
  fireTraitHooks(enc.player, 'onPlayerVerb', {
    enc, player: enc.player, patient: pat, verbId: `interjection:${intr.id}`,
    composure(delta) { enc.player.composure = clamp(enc.player.composure + delta, 0, enc.player.composureMax); },
    log(s, opts = {}) { pushLog({ text: s, cls: opts.cls || 'flavor' }); },
  });
  if (state.shownLogIdx < state.log.length - 1) await drainLog();
  pat.turn++;
  await postTurn();
}

// Common end-of-turn handler: check endings, then composure, then maybe
// fire an interjection before handing back to the player.
async function postTurn() {
  const enc = state.enc;
  const p = enc.player;
  const pat = enc.patient;
  const ending = checkEndings(pat, p);
  if (ending) { await fireEnding(ending); return; }
  if (p.composure <= 0) {
    const cctx = {
      enc, player: p, patient: pat, cancel: false,
      composure(delta) { p.composure = clamp(p.composure + delta, 0, p.composureMax); },
      log(s, opts = {}) { pushLog({ text: s, cls: opts.cls || 'flavor' }); },
    };
    fireTraitHooks(p, 'onCollapse', cctx);
    if (state.shownLogIdx < state.log.length - 1) await drainLog();
    if (!cctx.cancel) { await fireCollapse(); return; }
  }
  // Look for an interjection to fire before the next player turn.
  await maybeFireInterjection();
  state.acting = false;
  enc.awaitingPlayer = true;
  render();
}

async function maybeFireInterjection() {
  const enc = state.enc;
  const pat = enc.patient;
  const player = enc.player;
  for (const intr of pat.def.interjections || []) {
    if (intr.once && pat.flags['_fired_' + intr.id]) continue;
    let matches = false;
    try { matches = !!intr.when(pat, player); } catch (e) { console.error('interjection when', intr.id, e); }
    if (!matches) continue;
    enc.activeInterjection = intr;
    pat.flags['_fired_' + intr.id] = true;
    const proseLines = Array.isArray(intr.prose) ? intr.prose : (intr.prose ? [intr.prose] : []);
    for (const l of proseLines) {
      pushLog({ text: l, cls: 'interjection' });
      await drainLog();
    }
    return true;
  }
  return false;
}

function callDrift(pat, player) {
  if (typeof pat.def.drift === 'function') {
    try { return pat.def.drift(pat, player) || { lines: ['nothing happens, for a while.'] }; }
    catch (e) { console.error('drift error', e); }
  }
  return { lines: ['the room holds.'] };
}

async function runSignature() {
  const enc = state.enc;
  const p = enc.player;
  const sig = p.signature;
  if (!sig || sig.usesLeft <= 0) {
    pushLog({ text: 'not now. not yet.', cls: 'flavor' });
    await drainLog();
    return;
  }
  sig.usesLeft--;
  const t = TRAITS[sig.id];
  pushLog({ text: t?.voice || `(${t?.name || sig.id})`, cls: 'sig' });
  await drainLog();
  const ctx = {
    enc, player: p, patient: enc.patient,
    shift(scaleKey, delta) { shiftScale(enc.patient, scaleKey, delta); },
    composure(delta) { p.composure = clamp(p.composure + delta, 0, p.composureMax); },
    log(s, opts = {}) { pushLog({ text: s, cls: opts.cls || 'flavor' }); },
    clearScars() { p.scars.length = 0; },
    setFlag(k, v = true) { enc.patient.flags[k] = v; },
    revealScale(key) { enc._revealed = enc._revealed || []; if (!enc._revealed.includes(key)) enc._revealed.push(key); },
  };
  fireTraitHooks(p, 'onSignature', ctx);
  await drainLog();
}

// A response is the contract between patient definitions and the engine.
// All shapes:
//   { lines: string[]|string, scales: {key:delta}, composure: int,
//     scars: string[], effects: {key:delta}, playerEffects: {key:delta},
//     flags: {key:bool}, callout?: string, shake?: bool }
async function applyResponse(resp) {
  if (!resp) return;
  const enc = state.enc;
  const pat = enc.patient;
  const p = enc.player;
  const lines = Array.isArray(resp.lines) ? resp.lines : (resp.lines ? [resp.lines] : []);

  if (resp.scales) {
    for (const [k, dv] of Object.entries(resp.scales)) shiftScale(pat, k, dv);
  }
  if (resp.effects) {
    for (const [k, dv] of Object.entries(resp.effects)) {
      pat.effects[k] = Math.max(0, (pat.effects[k] || 0) + dv);
    }
  }
  if (resp.playerEffects) {
    for (const [k, dv] of Object.entries(resp.playerEffects)) {
      pat.playerEffects[k] = Math.max(0, (pat.playerEffects[k] || 0) + dv);
    }
  }
  if (resp.flags) {
    for (const [k, v] of Object.entries(resp.flags)) pat.flags[k] = v;
  }
  if (typeof resp.composure === 'number') {
    p.composure = clamp(p.composure + resp.composure, 0, p.composureMax);
  }
  if (Array.isArray(resp.scars)) {
    for (const sid of resp.scars) {
      if (!p.scars.includes(sid)) p.scars.push(sid);
    }
    recomputePlayerStats(p);
  }
  if (resp.callout) spawnCallout(resp.callout);
  if (resp.shake) shakeStage();

  for (const l of lines) {
    pushLog({ text: l, cls: 'narr' });
    await drainLog();
  }
}

function shiftScale(pat, key, delta) {
  if (delta === 0) return;
  const def = pat.def.scales?.[key];
  const min = def?.min ?? 0;
  const max = def?.max ?? 5;
  pat.scales[key] = clamp((pat.scales[key] || 0) + delta, min, max);
}

// ─── endings ────────────────────────────────────────────────────────────

function checkEndings(pat, player) {
  for (const e of pat.def.endings || []) {
    try {
      if (e.when(pat, player)) return e;
    } catch (err) { console.error('ending check error', err); }
  }
  return null;
}

async function fireEnding(ending) {
  const enc = state.enc;
  // lines / scars / trait may be authored as functions of (patient, player)
  // for endings whose prose depends on how you got there.
  const rawLines = (typeof ending.lines === 'function')
    ? ending.lines(enc.patient, enc.player)
    : ending.lines;
  const lines = Array.isArray(rawLines) ? rawLines : (rawLines ? [rawLines] : []);
  for (const l of lines) {
    pushLog({ text: l, cls: 'ending' });
    await drainLog();
  }
  const rawScars = (typeof ending.scars === 'function')
    ? ending.scars(enc.patient, enc.player)
    : ending.scars;
  const scars = Array.isArray(rawScars) ? rawScars : (rawScars ? [rawScars] : []);
  // Filter through onScar hooks now (so e.g. Redacted prevents Witnessed)
  // before the resolution screen displays them — so what the player sees is
  // what they actually receive.
  const filteredScars = scars.filter(sid => {
    const sctx = { player: enc.player, scarId: sid, prevent: false };
    fireTraitHooks(enc.player, 'onScar', sctx);
    return !sctx.prevent;
  });
  const trait = (typeof ending.trait === 'function')
    ? ending.trait(enc.patient, enc.player)
    : (ending.trait || null);

  enc.over = true;
  enc.outcome = 'resolved';
  enc.endingId = ending.id;
  enc.endingTitle = ending.title;
  enc.endingLines = lines;       // stored for archive recap
  enc.pendingTrait = trait;
  enc.pendingScars = filteredScars;
  enc.awaitingResolution = true;
  state.acting = false;
  state.screen = 'resolution';
  sfx('victory');
  render();
}

async function fireCollapse() {
  const enc = state.enc;
  pushLog({ text: 'I have no more of myself to spend. the room runs me out.', cls: 'fatal' });
  await drainLog();
  enc.over = true;
  enc.outcome = 'collapsed';
  enc.endingId = 'collapsed';
  enc.pendingTrait = null;
  enc.pendingScars = ['collapsed'];
  state.acting = false;
  sfx('faint');
  render();
}

// ─── log draining (click-to-advance) ────────────────────────────────────

async function drainLog() {
  while (state.shownLogIdx < state.log.length - 1) {
    const idx = state.shownLogIdx + 1;
    state.shownLogIdx = idx;
    state.typingIdx = idx;
    state.logAwaitingClick = false;
    render();

    const entry = state.log[idx];
    const txtLen = (entry.text || '').length;
    const typeMs = Math.min(txtLen * 14, 1200);

    await Promise.race([
      sleep(typeMs),
      new Promise(r => { state._typeSkipResolve = r; }),
    ]);
    state._typeSkipResolve = null;
    state.typingIdx = -1;
    state.logAwaitingClick = true;
    render();

    await new Promise(resolve => { state._logClickResolve = resolve; });
    state._logClickResolve = null;
    state.logAwaitingClick = false;
  }
  render();
}

export function advanceLog() {
  if (state._typeSkipResolve) {
    const r = state._typeSkipResolve;
    state._typeSkipResolve = null;
    r();
    return;
  }
  if (state._logClickResolve) {
    const r = state._logClickResolve;
    state._logClickResolve = null;
    r();
  }
}

// ─── resolution ─────────────────────────────────────────────────────────

export function acknowledgeResolution() {
  const enc = state.enc;
  if (!enc) return;
  if (enc.pendingTrait && TRAITS[enc.pendingTrait]) {
    addTrait(enc.player, enc.pendingTrait);
  }
  for (const sid of enc.pendingScars) {
    // give redacted (and any other guard) a chance to refuse the scar
    const sctx = { player: enc.player, scarId: sid, prevent: false };
    fireTraitHooks(enc.player, 'onScar', sctx);
    if (!sctx.prevent) applyScar(enc.player, sid);
  }
  // onEncounterEnd trait hooks — used by `unfinished` to refill composure
  fireTraitHooks(enc.player, 'onEncounterEnd', {
    enc, player: enc.player, patient: enc.patient,
    composure(delta) { enc.player.composure = clamp(enc.player.composure + delta, 0, enc.player.composureMax); },
  });
  recomputePlayerStats(enc.player);
}

// ─── public introspection ───────────────────────────────────────────────

export function isPlayerTurn() {
  return !!(state.enc && state.enc.awaitingPlayer && !state.acting);
}

// Legacy: verbs no longer have an upfront composure cost. Composure
// changes happen inside the verb's response (composure: -N), as a
// consequence of context, not a precondition. Kept exported for any
// remaining callers; always returns 0 now.
export function effectiveVerbCost(_player, _verb) { return 0; }

// ─── helpers ────────────────────────────────────────────────────────────

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
