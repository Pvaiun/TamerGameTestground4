// The duel. A single encounter between Patient 0413 (the player) and one
// other patient (the boss). Turn-based, 1v1, no spatial layer — pacing comes
// from the pose queue (the patient's visible next-three actions) and from the
// readable status interactions.
//
// The encounter object (state.enc) is the single source of truth while a
// fight is live. Outside callers (the encounter UI) read state.enc to render,
// and call playerAct(key) / chooseResolution(key) to advance.

import { state, pushLog, clearLog, COMPOSURE_MAX, POSE_QUEUE_VISIBLE } from './state.js';
import { sleep } from './rng.js';
import { sfx } from './audio.js';
import { render } from './ui/render.js';
import { sumMod, fireTraitHooks, TRAITS } from './traits.js';
import { WOUNDS } from './wounds.js';
import { spawnFloat, shakeStage, playLunge, playRecoil } from './ui/animations.js';

// ─── status registry ────────────────────────────────────────────────────
//
// All statuses are stored as a small integer count on `target.statuses[key]`.
// Some auto-decay each turn (timed); HELD is a stack count that doesn't decay.

export const STATUSES = {
  bleed: { label: 'bleeding', timed: true,  tickAtEndOfTurn: true,  desc: '−1 hp at the end of each turn' },
  hush:  { label: 'hushed',   timed: true,  tickAtEndOfTurn: false, desc: 'cannot speak' },
  know:  { label: 'known',    timed: true,  tickAtEndOfTurn: false, desc: 'you see further into their queue' },
  raw:   { label: 'raw',      timed: true,  tickAtEndOfTurn: false, desc: 'next damage taken is increased' },
  held:  { label: 'held',     timed: false, tickAtEndOfTurn: false, desc: 'a hand on your wrist' },
};

export function freshStatusBag() {
  return { bleed: 0, hush: 0, know: 0, raw: 0, held: 0 };
}

// ─── player setup ───────────────────────────────────────────────────────

export function makePlayer(wound, extraTraits = []) {
  const w = WOUNDS[wound];
  const player = {
    name: 'Patient 0413',
    wound,
    traits: [...extraTraits],
    maxHp: 10,
    hp:    10,
    composure: 0,
    statuses: freshStatusBag(),
    signature: null,
    // ephemeral per-encounter flags. Engines clear these between fights.
    _ghostUsed: false,
    _motheringPrimed: false,
  };
  // Apply wound base mods
  if (w) {
    player.maxHp += (w.mods.maxHp || 0);
    player.hp = player.maxHp;
    player.composure = w.mods.startComposure || 0;
    // attach signature
    if (w.signature && TRAITS[w.signature]) {
      player.signature = { id: w.signature, usesLeft: 1 };
    }
  }
  recomputePlayerStats(player);
  return player;
}

// Recompute maxHp / starting composure from current traits + wound.
export function recomputePlayerStats(player) {
  const w = player.wound ? WOUNDS[player.wound] : null;
  let baseMax = 10 + ((w && w.mods.maxHp) || 0);
  baseMax += sumMod(player, 'maxHp');
  player.maxHp = Math.max(1, baseMax);
  if (player.hp > player.maxHp) player.hp = player.maxHp;
}

export function addTrait(player, traitId) {
  if (!TRAITS[traitId]) return;
  if (!player.traits.includes(traitId)) player.traits.push(traitId);
  recomputePlayerStats(player);
}

// ─── encounter setup ────────────────────────────────────────────────────

export function beginEncounter(patientDef, player) {
  // build a fresh enc object from the patient definition.
  const patient = {
    id: patientDef.id,
    name: patientDef.name,
    glyph: patientDef.glyph,
    subtitle: patientDef.subtitle,
    file: [...(patientDef.file || [])],
    phaseIdx: 0,
    phases: patientDef.phases,
    statuses: freshStatusBag(),
    extras: patientDef.makeExtras ? patientDef.makeExtras() : {},
    queue: [],   // visible upcoming poses
    hp: 0,       // initialized below
    maxHp: 0,
    def: patientDef,
  };
  // initialize first phase
  applyPhaseEntry(patient, player, 0, /*silent*/true);

  // reset player ephemera
  player.composure = sumMod(player, 'startComposure');
  const w = player.wound ? WOUNDS[player.wound] : null;
  if (w) player.composure += (w.mods.startComposure || 0);
  player.composure = clamp(player.composure, 0, COMPOSURE_MAX);
  player.hp = player.maxHp;
  player.statuses = freshStatusBag();
  player._ghostUsed = false;
  player._motheringPrimed = false;
  if (player.signature) player.signature.usesLeft = 1;

  state.enc = {
    patient,
    player,
    turn: 0,
    awaitingPlayer: false,    // becomes true once intro plays
    awaitingResolution: false,
    extraActionAvailable: false,
    over: false,
    outcome: null,            // 'won' | 'lost' | 'fled'
  };
  clearLog();
  state.screen = 'encounter';

  // fire traits onEncounterStart
  fireTraitHooks(player, 'onEncounterStart', mkCtx());
  // populate initial queue
  refillQueue(patient, player);

  // begin intro narration
  runEncounterIntro();
}

function applyPhaseEntry(patient, player, phaseIdx, silent) {
  const phase = patient.phases[phaseIdx];
  patient.phaseIdx = phaseIdx;
  patient.hp = phase.hp;
  patient.maxHp = phase.hp;
  patient.conditions = [...(phase.conditions || [])];
  patient.queue = [];
}

// Run a small async cinematic when an encounter starts.
async function runEncounterIntro() {
  const { patient, player } = state.enc;
  state.acting = true;
  render();
  await sleep(220);
  const intro = patient.def.intro || `a door. her file is on the desk. ${patient.name} is in the room.`;
  pushLog({ text: intro, cls: 'intro', pause: 700 });
  await drainLog();
  // Phase 0 intro
  const phase0 = patient.phases[0];
  if (phase0.intro) {
    pushLog({ text: phase0.intro, cls: 'intro', pause: 600 });
    await drainLog();
  }
  state.acting = false;
  state.enc.awaitingPlayer = true;
  render();
}

// ─── core context the engine passes into hooks / pose effects ───────────

function mkCtx() {
  const enc = state.enc;
  return {
    enc,
    patient: enc.patient,
    player:  enc.player,
    // mutators (these are bound to enc.player / enc.patient)
    applyStatus,
    dealDamage,
    heal,
    log: (entry) => pushLog(entry),
    // hook fields engine may read after call:
    prevent: false,
    bonus: 0,
    grantExtraAction: false,
    cancelNextPose: false,
    cancelLethal: false,
    revealAll: false,
    speakMult: 1,
    healOutOfCombat: () => {},
  };
}

// ─── primitives ─────────────────────────────────────────────────────────

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function whom(target) {
  const enc = state.enc;
  return target === enc.player ? 'self' : 'patient';
}

function targetName(target) {
  const enc = state.enc;
  return target === enc.player ? 'I' : 'she';   // fallback; patients can override via def.pronoun
}

function pronoun(target) {
  const enc = state.enc;
  if (target === enc.player) return 'I';
  return enc.patient.def.pronoun || 'she';
}

function pronounObj(target) {
  const enc = state.enc;
  if (target === enc.player) return 'me';
  return enc.patient.def.pronounObj || 'her';
}

export function dealDamage(target, amount, opts = {}) {
  if (amount <= 0) return 0;
  const enc = state.enc;
  if (!enc) return 0;

  // bracing halves incoming damage for the player (ENDURE)
  if (target === enc.player && target._bracing) {
    amount = Math.max(0, Math.floor(amount / 2));
    if (amount === 0) {
      pushLog({ text: 'I planted. it skidded off.', cls: 'flavor' });
    }
  }

  // raw doubles next damage
  if (target.statuses && target.statuses.raw > 0) {
    amount = Math.round(amount * 1.5);
    target.statuses.raw = 0;
    pushLog({ text: 'the page was raw. it parts.', cls: 'flavor' });
  }

  // trait hook: damage taken (only for player; patients are simpler)
  if (target === enc.player) {
    const ctx = mkCtx();
    ctx.amount = amount;
    ctx.source = opts.source || 'patient';
    fireTraitHooks(enc.player, 'onDamageTaken', ctx);
    amount = Math.max(0, ctx.amount);
  }

  target.hp = Math.max(0, target.hp - amount);

  // lethal handler
  if (target === enc.player && target.hp === 0) {
    const ctx = mkCtx();
    fireTraitHooks(enc.player, 'onLethalDamage', ctx);
    // cancelLethal hook may restore hp to 1 directly via ctx.player.hp = 1
  }

  if (!opts.silent) {
    const side = target === enc.player ? 'player' : 'patient';
    spawnFloat(side, `-${amount}`, 'dmg');
    if (side === 'patient') playLunge('player');
    else                    { playRecoil('player'); shakeStage(); }
    sfx('hit');
  }
  return amount;
}

export function heal(target, amount, sourceLine) {
  if (amount <= 0) return 0;
  const enc = state.enc;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  const real = target.hp - before;
  if (real > 0) {
    const side = target === enc.player ? 'player' : 'patient';
    spawnFloat(side, `+${real}`, 'heal');
    sfx('heal');
    if (sourceLine) pushLog({ text: sourceLine, heal: real, cls: 'mend' });
  }
  return real;
}

export function applyStatus(target, key, amount) {
  const enc = state.enc;
  if (!STATUSES[key] || amount <= 0) return false;
  // trait hook: status applied (only for player target; patients accept all)
  if (target === enc.player) {
    const ctx = mkCtx();
    ctx.statusKey = key; ctx.target = target; ctx.amount = amount;
    fireTraitHooks(enc.player, 'beforeStatusApplied', ctx);
    if (ctx.prevent) return false;
    amount = Math.max(0, ctx.amount);
  }
  if (!target.statuses) target.statuses = freshStatusBag();
  target.statuses[key] = (target.statuses[key] || 0) + amount;
  return true;
}

// ─── pose queue ─────────────────────────────────────────────────────────

function refillQueue(patient, player) {
  while (patient.queue.length < POSE_QUEUE_VISIBLE) {
    const next = patient.def.produceNextPose(patient, player, state.enc.turn + patient.queue.length);
    patient.queue.push(next);
  }
}

// ─── player input ───────────────────────────────────────────────────────

export async function playerAct(key) {
  const enc = state.enc;
  if (!enc || !enc.awaitingPlayer || state.acting) return;
  state.acting = true;
  enc.awaitingPlayer = false;
  await runPlayerTurn(key);
}

async function runPlayerTurn(actionKey) {
  const enc = state.enc;
  const ctx = mkCtx();
  ctx.tookDamageAction = false;

  // pre-action hooks
  fireTraitHooks(enc.player, 'beforePlayerResolve', ctx);

  let valid = await executePlayerAction(actionKey, ctx);

  if (!valid) {
    state.acting = false;
    enc.awaitingPlayer = true;
    render();
    return;
  }

  // post-action hook (e.g. mothering trigger after resolving)
  fireTraitHooks(enc.player, 'afterPlayerResolve', ctx);

  // propagate signature-flagged engine effects
  if (ctx.cancelNextPose) enc._cancelNextPose = true;
  if (ctx.revealAll) {
    while (enc.patient.queue.length < 8) {
      enc.patient.queue.push(enc.patient.def.produceNextPose(enc.patient, enc.player, enc.turn + enc.patient.queue.length));
    }
    enc.revealCount = enc.patient.queue.length;
  }

  // check if player died from a self-harming action (e.g. devotion signature)
  if (enc.player.hp <= 0) {
    enc.over = true; enc.outcome = 'lost';
    state.acting = false;
    pushLog({ text: 'the page ~~goes~~ stays blank.', cls: 'fatal', pause: 800 });
    await drainLog();
    sfx('faint');
    render();
    return;
  }

  await sleep(120);

  // check if patient died this turn
  if (enc.patient.hp <= 0) {
    await onPatientPhaseDown();
    if (enc.over) return;
    state.acting = false;
    enc.awaitingPlayer = true;
    render();
    return;
  }

  // extra action grant (from signatures like sig_insomnia)
  if (ctx.grantExtraAction) {
    pushLog({ text: 'I move again. the room has not caught up.', cls: 'flavor', pause: 360 });
    await drainLog();
    state.acting = false;
    enc.awaitingPlayer = true;
    enc.extraActionAvailable = true;
    render();
    return;
  }

  // patient turn (unless first-strike check skipped them)
  await runPatientTurn();
  if (enc.over) return;

  // end-of-turn ticks
  await endOfTurnTicks();
  if (enc.over) return;

  enc.turn++;
  state.acting = false;
  enc.awaitingPlayer = true;
  enc.extraActionAvailable = false;
  render();
}

async function executePlayerAction(key, ctx) {
  const enc = state.enc;
  const p = enc.player;
  const pat = enc.patient;

  if (key === 'press') {
    const dmg = 2 + sumMod(p, 'pressDmg');
    pushLog({ text: pat.def.flavor?.press || `I press a hand to ${pronounObj(pat)} arm.`, cls: 'narr' });
    await drainLog(/*intra-action*/true);
    dealDamage(pat, Math.max(0, dmg));
    ctx.tookDamageAction = true;
    return true;
  }

  if (key === 'strike') {
    const cost = Math.max(0, 2 + sumMod(p, 'strikeCost'));
    if (p.composure < cost) {
      pushLog({ text: 'I am not composed enough. nothing happens.', cls: 'flavor' });
      await drainLog();
      return false;
    }
    p.composure -= cost;
    const dmg = Math.max(0, 5 + sumMod(p, 'strikeDmg'));
    pushLog({ text: pat.def.flavor?.strike || `I strike at ${pronounObj(pat)}, hard.`, cls: 'narr' });
    await drainLog(true);
    dealDamage(pat, dmg);
    sfx('crit');
    // fire hooks
    const sctx = mkCtx();
    fireTraitHooks(p, 'onStrikeHit', sctx);
    ctx.tookDamageAction = true;
    return true;
  }

  if (key === 'endure') {
    const compGain = Math.max(0, 2 + sumMod(p, 'endureCompGain'));
    const healGain = sumMod(p, 'endureHeal');
    p.composure = clamp(p.composure + compGain, 0, COMPOSURE_MAX);
    pushLog({ text: pat.def.flavor?.endure || `I plant my feet. I do not look away.`, cls: 'narr' });
    await drainLog(true);
    if (healGain > 0) heal(p, healGain, 'a small steadiness');
    // mark this player as bracing — patient's next hit deals half
    p._bracing = true;
    // (the patient's damage code reads p._bracing to halve damage)
    return true;
  }

  if (key === 'listen') {
    const baseN = 2 + sumMod(p, 'listenReveal');
    const compGain = Math.max(0, 1 + sumMod(p, 'listenCompGain'));
    p.composure = clamp(p.composure + compGain, 0, COMPOSURE_MAX);
    pushLog({ text: pat.def.flavor?.listen || `I listen. I count the breaths between.`, cls: 'narr' });
    await drainLog(true);
    // reveal: ensure queue has at least baseN poses
    while (pat.queue.length < baseN) {
      pat.queue.push(pat.def.produceNextPose(pat, p, state.enc.turn + pat.queue.length));
    }
    enc.revealCount = baseN;
    const lctx = mkCtx();
    fireTraitHooks(p, 'onListen', lctx);
    return true;
  }

  if (key === 'speak') {
    if (p.statuses.hush > 0) {
      pushLog({ text: 'my voice does not arrive. I have been ~~unmade~~ hushed.', cls: 'flavor' });
      await drainLog();
      return false;
    }
    pushLog({ text: pat.def.flavor?.speak || `I say her name. the room narrows.`, cls: 'narr' });
    await drainLog(true);
    // speak's mechanical effect is patient-defined: each patient's def can
    // implement onSpeak(ctx) returning an effect described in their own
    // vocabulary. Default: apply 1 KNOW to the patient.
    const ectx = mkCtx();
    fireTraitHooks(p, 'onSpeakEffect', ectx);
    const mult = ectx.speakMult || 1;
    if (pat.def.onSpeak) {
      pat.def.onSpeak(pat, p, mult);
    } else {
      applyStatus(pat, 'know', 1 * mult);
      pushLog({ text: `she hears it. she ~~recognizes~~ acknowledges.`, cls: 'flavor' });
    }
    await drainLog(true);
    return true;
  }

  if (key === 'signature') {
    const sig = p.signature;
    if (!sig || sig.usesLeft <= 0) {
      pushLog({ text: 'not now. not yet.', cls: 'flavor' });
      await drainLog();
      return false;
    }
    sig.usesLeft--;
    const t = TRAITS[sig.id];
    pushLog({ text: t.voice || `(${t.name})`, cls: 'sig' });
    await drainLog(true);
    const sctx = mkCtx();
    fireTraitHooks(p, 'onSignature', sctx);
    // propagate flags to the outer ctx
    Object.assign(ctx, sctx);
    return true;
  }

  pushLog({ text: 'I do not know how to do that.', cls: 'flavor' });
  await drainLog();
  return false;
}

// ─── patient turn ───────────────────────────────────────────────────────

async function runPatientTurn() {
  const enc = state.enc;
  if (!enc.patient.queue.length) refillQueue(enc.patient, enc.player);
  const pose = enc.patient.queue.shift();
  // hook: check if a player effect cancelled the pose (e.g. sig_absence)
  if (enc._cancelNextPose) {
    enc._cancelNextPose = false;
    pushLog({ text: `she begins to ${pose.name.toLowerCase()}. ~~she~~ the moment does not arrive.`, cls: 'flavor', pause: 500 });
    await drainLog();
    refillQueue(enc.patient, enc.player);
    return;
  }
  // run pose effect
  if (pose.tell) {
    pushLog({ text: pose.tell, cls: 'pose' });
    await drainLog(true);
  }
  if (typeof pose.effect === 'function') {
    const ctx = mkCtx();
    ctx.pose = pose;
    try { pose.effect(ctx); } catch (e) { console.error('pose effect error', pose.name, e); }
  }
  // clear bracing after patient acts
  enc.player._bracing = false;
  refillQueue(enc.patient, enc.player);
}

// ─── end-of-turn ────────────────────────────────────────────────────────

async function endOfTurnTicks() {
  const enc = state.enc;
  // bleed ticks first
  for (const target of [enc.player, enc.patient]) {
    if (target.statuses.bleed > 0) {
      const ctx = mkCtx();
      ctx.target = target;
      ctx.amount = 1;
      fireTraitHooks(enc.player, 'onBleedTick', ctx);
      const dmg = Math.max(0, ctx.amount);
      if (dmg > 0) {
        pushLog({ text: target === enc.player ? `I am bleeding.` : `she is ~~bleeding~~ leaving.`, damage: dmg, cls: 'tick' });
        await drainLog(true);
        dealDamage(target, dmg, { source: 'bleed', silent: true });
        spawnFloat(target === enc.player ? 'player' : 'patient', `-${dmg}`, 'dmg');
      }
      target.statuses.bleed = Math.max(0, target.statuses.bleed - 1);
      if (target.hp === 0) break;
    }
  }
  // generic tick-down for timed statuses
  for (const target of [enc.player, enc.patient]) {
    for (const key of Object.keys(STATUSES)) {
      if (key === 'bleed') continue;
      if (STATUSES[key].timed && target.statuses[key] > 0) {
        target.statuses[key] = Math.max(0, target.statuses[key] - 1);
      }
    }
  }
  // fire onTurnEnd hooks
  const ctx = mkCtx();
  ctx.tookDamageAction = false; // not used here
  fireTraitHooks(enc.player, 'onTurnEnd', ctx);

  // game-end checks
  if (enc.player.hp <= 0) {
    enc.over = true; enc.outcome = 'lost';
    state.acting = false;
    pushLog({ text: 'the page ~~goes~~ stays blank.', cls: 'fatal', pause: 800 });
    await drainLog();
    sfx('faint');
    render();
    return;
  }
  if (enc.patient.hp <= 0) {
    await onPatientPhaseDown();
    return;
  }
  // patient-specific end-of-turn check (e.g. soothlick: held >= 3 wins for her)
  if (enc.patient.def.checkPatientWin) {
    const win = enc.patient.def.checkPatientWin(enc.patient, enc.player);
    if (win) {
      enc.over = true; enc.outcome = 'lost';
      state.acting = false;
      pushLog({ text: win.text || 'she has put me down.', cls: 'fatal', pause: 800 });
      await drainLog();
      sfx('faint');
      render();
    }
  }
}

async function onPatientPhaseDown() {
  const enc = state.enc;
  const pat = enc.patient;
  const last = pat.phaseIdx >= pat.phases.length - 1;
  if (!last) {
    // advance phase
    const nextIdx = pat.phaseIdx + 1;
    const nextPhase = pat.phases[nextIdx];
    pushLog({ text: `// phase shift · ${nextPhase.name}`, cls: 'phase' });
    await drainLog();
    if (nextPhase.intro) {
      pushLog({ text: nextPhase.intro, cls: 'intro', pause: 600 });
      await drainLog();
    }
    applyPhaseEntry(pat, enc.player, nextIdx, false);
    refillQueue(pat, enc.player);
    return;
  }
  // final phase done → resolution
  enc.over = true;
  enc.outcome = 'won';
  enc.awaitingResolution = true;
  state.acting = false;
  state.screen = 'resolution';
  sfx('victory');
  render();
}

// ─── log draining ───────────────────────────────────────────────────────

// Each pushed log entry has a pause (default depends on length). We render
// once per entry, advance state.typingIdx so the UI typewriter-animates the
// latest, then sleep enough for the player to read.
async function drainLog(intra) {
  // The most recent entry is the one to type.
  const idx = state.log.length - 1;
  if (idx < 0) return;
  state.typingIdx = idx;
  render();
  const entry = state.log[idx];
  const txtLen = (entry.text || '').length;
  // typewriter pacing: a moderate-length line types in under a second; intra-
  // action restMs is small so combat flows briskly.
  const typeMs = Math.min(txtLen * 14, 1400);
  const restMs = entry.pause != null ? entry.pause : (intra ? 140 : 280);
  await sleep(typeMs + restMs);
  state.typingIdx = -1;
}

// ─── resolution selection ──────────────────────────────────────────────

export function chooseResolution(key) {
  const enc = state.enc;
  if (!enc || !enc.awaitingResolution) return;
  const res = enc.patient.def.resolutions[key];
  if (!res) return;
  enc.awaitingResolution = false;
  enc.resolution = { key, res };
  // grant trait happens via the run module after the resolution screen ends
  render();
}

// ─── exposed for UI ─────────────────────────────────────────────────────

export function isPlayerTurn() {
  return !!(state.enc && state.enc.awaitingPlayer && !state.acting);
}
