// A run goes: ADMISSION → 5 wings (event + patient each) → FINAL → ARCHIVE.
// run.js manages that lifecycle: builds the corridor map at start, advances
// between nodes, grants traits from patient resolutions, and writes the
// run-end record to the persistent save.

import { state, RUN_DEPTH } from './state.js';
import { pick, pickN, randi } from './rng.js';
import { makePlayer, beginEncounter, addTrait, recomputePlayerStats, acknowledgeResolution } from './combat.js';
import { COMPOSURE_MAX } from './state.js';
import { PATIENTS, getPatient } from './patients.js';
import { EVENTS, pickEventPool } from './events.js';
import { recordRunOutcome } from './save.js';
import { TRAITS } from './traits.js';
import { render } from './ui/render.js';

// A node is one stop on the corridor.
//   kind: 'event' | 'patient' | 'final'
//   id:   for event/patient lookup
//   wing: 1..RUN_DEPTH (decoration only)
//   visited: false until consumed
function newNode(kind, id, wing) {
  return { kind, id, wing, visited: false };
}

export function startNewRun(wound) {
  const save = state.save;
  const player = makePlayer(wound);
  // build the corridor: alternate event-patient through RUN_DEPTH wings,
  // ending with the final boss.
  const patientPool = save.unlocked.patients.filter(id => PATIENTS[id]);
  const finalId = save.unlocked.patients.includes('choir') ? 'choir' : 'choir';   // final is fixed; falls back gracefully
  // exclude the final from the wing patient pool. Sample without replacement,
  // then sort by tier ascending so easier patients arrive first. (Wing 1 is
  // the player's onboarding fight.)
  const wingCandidates = patientPool.filter(id => id !== finalId && PATIENTS[id].role !== 'final');
  const chosenPatients = pickN(wingCandidates, Math.min(RUN_DEPTH, wingCandidates.length));
  while (chosenPatients.length < RUN_DEPTH) chosenPatients.push(pick(wingCandidates));
  chosenPatients.sort((a, b) => (PATIENTS[a]?.tier ?? 2) - (PATIENTS[b]?.tier ?? 2));

  const eventPool = pickEventPool(RUN_DEPTH);

  const nodes = [];
  for (let i = 0; i < RUN_DEPTH; i++) {
    nodes.push(newNode('event',   eventPool[i],   i + 1));
    nodes.push(newNode('patient', chosenPatients[i], i + 1));
  }
  nodes.push(newNode('final', finalId, RUN_DEPTH + 1));

  state.run = {
    wound,
    player,
    nodes,
    idx: 0,
    log: [],            // run-level event log (becomes part of archive)
    resolutionsTaken: [],
    startedAt: Date.now(),
  };
  state.screen = 'corridor';
}

export function currentNode() {
  if (!state.run) return null;
  const r = state.run;
  return r.nodes[r.idx] || null;
}

// Enter the current node. Sets the screen as appropriate and dispatches.
export function enterCurrentNode() {
  const n = currentNode();
  if (!n) return;
  if (n.kind === 'event') {
    state.screen = 'event';
    render();
    return;
  }
  if (n.kind === 'patient' || n.kind === 'final') {
    const def = getPatient(n.id);
    if (!def) {
      // missing patient definition — skip
      advanceRun();
      return;
    }
    beginEncounter(def, state.run.player);
    return;
  }
}

// Move to the next node. Called after a resolution / event finishes. Fires
// onCorridorEntry trait hooks (so e.g. small_warmth heals between rooms).
export function advanceRun() {
  if (!state.run) return;
  state.run.idx++;
  if (state.run.idx >= state.run.nodes.length) {
    return endRun({ outcome: 'finished' });
  }
  fireCorridorHooks(state.run.player);
  state.screen = 'corridor';
  render();
}

function fireCorridorHooks(player) {
  for (const tid of player.traits || []) {
    const t = TRAITS[tid];
    if (!t || !t.hooks || !t.hooks.onCorridorEntry) continue;
    const ctx = {
      player,
      healOutOfCombat: (n) => {
        player.composure = Math.min(player.composureMax, (player.composure || 0) + n);
      },
    };
    try { t.hooks.onCorridorEntry(ctx); } catch (e) { console.error('trait corridor hook', tid, e); }
  }
}

// The encounter resolved with an ending. acknowledgeResolution applies the
// pending trait + scars to the player (filtered by trait hooks like
// redacted), and we record the resolution for the archive.
export function applyResolutionAndAdvance() {
  const enc = state.enc;
  if (!enc) return;
  const trait = enc.pendingTrait;
  const ending = enc.endingId;
  acknowledgeResolution();
  state.run.resolutionsTaken.push({
    patient: enc.patient.id,
    ending,
    trait,
  });
  state.enc = null;
  advanceRun();
}

// Apply an event's effect, push to run log, and advance.
export function applyEventEffect(eventDef, choiceKey) {
  const choice = eventDef.choices.find(c => c.key === choiceKey);
  if (!choice) return;
  if (choice.effect) {
    try { choice.effect(state.run.player, state.run); } catch (e) { console.error(e); }
  }
  state.run.log.push({ event: eventDef.id, choice: choice.key });
  recomputePlayerStats(state.run.player);
  advanceRun();
}

// End the run (lost, fled, or finished). Writes to save.
export function endRun(payload) {
  const run = state.run;
  if (!run) return;
  const reachedFinal = run.idx >= run.nodes.length - 1;
  const archiveLine = buildArchiveLine(run, payload);
  const fragment = buildFragment(run, payload);
  recordRunOutcome(state.save, { reachedFinal, archiveLine, fragment });
  state.screen = 'archive';
  state.lastRunSummary = {
    wound: run.wound,
    resolutions: run.resolutionsTaken,
    archiveLine,
    payload,
  };
  state.run = null;
  state.enc = null;
  render();
}

function buildArchiveLine(run, payload) {
  const tag = (payload.outcome === 'finished') ? 'discharged' :
              (payload.outcome === 'lost')     ? 'expired'    :
              (payload.outcome === 'fled')     ? 'walked out' : 'closed';
  return `Patient 0413 · file ${tag} · wing ${Math.ceil((run.idx || 1) / 2)}`;
}

function buildFragment(run, payload) {
  if (payload.outcome === 'finished') return 'fragment.discharge';
  if (payload.outcome === 'lost')     return `fragment.lost.wing${Math.ceil((run.idx || 1) / 2)}`;
  return null;
}

// Called by the encounter UI when the player loses.
export function reportEncounterLost() {
  endRun({ outcome: 'lost' });
}
