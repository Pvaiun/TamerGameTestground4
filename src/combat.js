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
  player.composureMax = COMPOSURE_MAX + sumMod(player, 'composureMax');
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
  // accumulate. At fight start we apply only scar deltas (e.g. Abandoned: -1)
  // and clamp to the (possibly trait-modified) max.
  recomputePlayerStats(player);
  for (const sid of player.scars || []) {
    const s = SCARS[sid];
    if (s && typeof s.startComposureDelta === 'number') {
      player.composure = Math.max(0, player.composure + s.startComposureDelta);
    }
  }
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
  state.acting = false;
  enc.awaitingPlayer = true;
  render();
}

// ─── verb dispatch ──────────────────────────────────────────────────────

export async function playerVerb(verbId) {
  const enc = state.enc;
  if (!enc || !enc.awaitingPlayer || state.acting) return;
  state.acting = true;
  enc.awaitingPlayer = false;
  await runPlayerVerb(verbId);
}

async function runPlayerVerb(verbId) {
  const enc = state.enc;
  const p = enc.player;
  const pat = enc.patient;

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
    const cost = effectiveVerbCost(p, verb);
    if (cost > 0 && p.composure < cost) {
      pushLog({ text: `I cannot. ~~I am~~ I am not composed enough.  (needed ${cost}, had ${p.composure})`, cls: 'flavor' });
      await drainLog();
      state.acting = false; enc.awaitingPlayer = true; render(); return;
    }
    if (cost > 0) p.composure = Math.max(0, p.composure - cost);
    const resp = (typeof verb.respond === 'function')
      ? verb.respond(pat, p)
      : { lines: ['nothing happens.'] };
    await applyResponse(resp);
  }

  // post-verb trait hooks (e.g. calming/vigilant/patience all hook onPlayerVerb)
  fireTraitHooks(p, 'onPlayerVerb', {
    enc, player: p, patient: pat, verbId,
    composure(delta) { p.composure = clamp(p.composure + delta, 0, p.composureMax); },
    log(s, opts = {}) { pushLog({ text: s, cls: opts.cls || 'flavor' }); },
  });
  // drain any extra log lines those hooks pushed (e.g. composure +1)
  if (state.shownLogIdx < state.log.length - 1) await drainLog();

  pat.turn++;
  const ending = checkEndings(pat, p);
  if (ending) { await fireEnding(ending); return; }
  if (p.composure <= 0) {
    // give vessel_for_ghosts a chance to catch the collapse
    const cctx = {
      enc, player: p, patient: pat,
      cancel: false,
      composure(delta) { p.composure = clamp(p.composure + delta, 0, p.composureMax); },
      log(s, opts = {}) { pushLog({ text: s, cls: opts.cls || 'flavor' }); },
    };
    fireTraitHooks(p, 'onCollapse', cctx);
    if (state.shownLogIdx < state.log.length - 1) await drainLog();
    if (!cctx.cancel) { await fireCollapse(); return; }
  }
  state.acting = false;
  enc.awaitingPlayer = true;
  render();
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

// Effective cost of a verb after trait mods + scar verbCostMod functions.
// Exported so the UI can display the actual cost (after Empty Arms / Named).
export function effectiveVerbCost(player, verb) {
  let cost = (verb.cost || 0) + sumMod(player, 'verbCostMod');
  for (const sid of player.scars || []) {
    const s = SCARS[sid];
    if (s && typeof s.verbCostMod === 'function') {
      cost = s.verbCostMod(cost, verb);
    }
  }
  return Math.max(0, cost);
}

// ─── helpers ────────────────────────────────────────────────────────────

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
