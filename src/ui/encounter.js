// The combat screen. State.enc holds everything: patient, player, turn, log.
// Re-renders on every state mutation; the combat engine drives it via
// pushLog + sleep + render.

import { el, app, attachLongPress } from './dom.js';
import { state, COMPOSURE_MAX, POSE_QUEUE_VISIBLE } from '../state.js';
import { isPlayerTurn, playerAct, STATUSES, advanceLog } from '../combat.js';
import { renderGlyph } from './glyphs.js';
import { parseProse } from './textCorrupt.js';
import { TRAITS } from '../traits.js';
import { WOUNDS } from '../wounds.js';

export function renderEncounter() {
  const enc = state.enc;
  if (!enc) return;
  const screen = el('div', { class: 'enc-screen' });

  screen.appendChild(encStripEl());
  screen.appendChild(dossierGridEl(enc));
  screen.appendChild(poseQueueEl(enc));
  screen.appendChild(narrativeOrActionsEl(enc));

  app().appendChild(screen);
}

// ── engagement strip ────────────────────────────────────────────────────
function encStripEl() {
  const enc = state.enc;
  const wing = Math.min(state.run ? Math.ceil((state.run.idx + 1) / 2) : 1, 5);
  const phase = enc.patient.phases[enc.patient.phaseIdx];
  const totalPhases = enc.patient.phases.length;
  const left = el('div', { class: 'enc-strip-left' }, [
    el('span', {}, '// engagement'),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, enc.patient.def.role === 'final' ? 'the final ward' : `wing ${wing}`),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, `file ${enc.patient.id}`),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, `phase ${'i'.repeat(enc.patient.phaseIdx + 1)} of ${'i'.repeat(totalPhases)} · ${phase.name}`),
  ]);
  const right = el('div', { class: 'enc-strip-right' }, [
    el('span', { class: 'doc-blot' }, '●'),
    ' they are here',
  ]);
  return el('div', { class: 'enc-strip' }, [left, right]);
}

// ── dossier grid (patient | player) ─────────────────────────────────────
function dossierGridEl(enc) {
  const grid = el('div', { class: 'enc-grid' });
  grid.appendChild(patientColEl(enc.patient));
  grid.appendChild(el('div', { class: 'enc-divider' }));
  grid.appendChild(playerColEl(enc.player));
  return grid;
}

function patientColEl(patient) {
  const col = el('div', { class: 'enc-col enc-col-patient' });
  // glyph + name + subtitle
  const head = el('div', { class: 'enc-head' });
  const g = el('div', { class: 'enc-glyph' });
  g.innerHTML = renderGlyph(patient.glyph);
  head.appendChild(g);
  const headText = el('div', { class: 'enc-head-text' });
  headText.appendChild(el('div', { class: 'enc-name', html: parseProse(patient.name) }));
  headText.appendChild(el('div', { class: 'enc-sub', html: parseProse(patient.subtitle || '') }));
  head.appendChild(headText);
  col.appendChild(head);
  // file
  const file = el('div', { class: 'enc-file' });
  for (const line of patient.file || []) {
    file.appendChild(el('div', { class: 'enc-file-line', html: parseProse(line) }));
  }
  col.appendChild(file);
  // hp
  col.appendChild(hpRowEl('phase hp', patient.hp, patient.maxHp));
  // conditions
  col.appendChild(conditionRowEl(patient.conditions || []));
  // statuses
  col.appendChild(statusRowEl(patient.statuses, 'them'));
  return col;
}

function playerColEl(player) {
  const col = el('div', { class: 'enc-col enc-col-player' });
  const w = player.wound ? WOUNDS[player.wound] : null;
  // head
  const head = el('div', { class: 'enc-head' });
  const g = el('div', { class: 'enc-glyph' });
  g.innerHTML = renderGlyph('Lumenpup');
  head.appendChild(g);
  const headText = el('div', { class: 'enc-head-text' });
  headText.appendChild(el('div', { class: 'enc-name' }, 'Patient 0413'));
  headText.appendChild(el('div', { class: 'enc-sub', html: parseProse(w ? w.one_liner : '') }));
  head.appendChild(headText);
  col.appendChild(head);
  // hp
  col.appendChild(hpRowEl('hp', player.hp, player.maxHp));
  // composure
  col.appendChild(composureRowEl(player.composure));
  // statuses
  col.appendChild(statusRowEl(player.statuses, 'me'));
  // traits (compact)
  col.appendChild(traitsRowEl(player));
  // signature
  if (player.signature) col.appendChild(signatureRowEl(player.signature));
  return col;
}

function hpRowEl(label, cur, max) {
  const row = el('div', { class: 'enc-stat-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, label));
  const bar = el('span', { class: 'enc-bar' });
  const fill = el('span', { class: 'enc-bar-fill' });
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  fill.style.width = `${pct}%`;
  if (pct < 25) fill.classList.add('low');
  bar.appendChild(fill);
  row.appendChild(bar);
  row.appendChild(el('span', { class: 'enc-stat-num' }, `${cur}/${max}`));
  return row;
}

function composureRowEl(comp) {
  const row = el('div', { class: 'enc-stat-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, 'composure'));
  const pips = el('span', { class: 'enc-pips' });
  for (let i = 0; i < COMPOSURE_MAX; i++) {
    pips.appendChild(el('span', { class: 'enc-pip' + (i < comp ? ' lit' : '') }, i < comp ? '●' : '○'));
  }
  row.appendChild(pips);
  row.appendChild(el('span', { class: 'enc-stat-num' }, `${comp}/${COMPOSURE_MAX}`));
  return row;
}

function conditionRowEl(conds) {
  const row = el('div', { class: 'enc-cond-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, 'condition'));
  if (!conds.length) {
    row.appendChild(el('span', { class: 'enc-cond-empty' }, '— '));
    return row;
  }
  const inner = el('span', { class: 'enc-cond-list' });
  conds.forEach((c, i) => {
    if (i > 0) inner.appendChild(el('span', { class: 'enc-cond-sep' }, ' · '));
    inner.appendChild(el('span', { class: 'enc-cond' }, c));
  });
  row.appendChild(inner);
  return row;
}

function statusRowEl(statuses, who) {
  const items = [];
  for (const [k, v] of Object.entries(statuses || {})) {
    if (!v || v <= 0) continue;
    const s = STATUSES[k];
    if (!s) continue;
    items.push({ label: s.label, val: v, timed: s.timed });
  }
  const row = el('div', { class: 'enc-status-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, 'afflictions'));
  const list = el('span', { class: 'enc-status-list' });
  if (!items.length) {
    list.appendChild(el('span', { class: 'enc-status-empty' }, '— '));
  } else {
    items.forEach((s, i) => {
      if (i > 0) list.appendChild(el('span', { class: 'enc-cond-sep' }, ' · '));
      const cls = 'enc-status enc-status-' + (s.timed ? 'timed' : 'stacked');
      list.appendChild(el('span', { class: cls }, [
        el('span', { class: 'doc-blot' }, '●'),
        ' ',
        s.label,
        ' ',
        el('span', { class: 'enc-status-num' }, s.timed ? `${s.val}t` : `×${s.val}`),
      ]));
    });
  }
  row.appendChild(list);
  return row;
}

function traitsRowEl(player) {
  const traits = (player.traits || []).filter(t => TRAITS[t]);
  const row = el('div', { class: 'enc-trait-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, 'traits'));
  if (!traits.length) {
    row.appendChild(el('span', { class: 'enc-status-empty' }, '— '));
    return row;
  }
  const list = el('span', { class: 'enc-trait-list' });
  traits.forEach((tid, i) => {
    const t = TRAITS[tid];
    if (i > 0) list.appendChild(el('span', { class: 'enc-cond-sep' }, ' · '));
    const span = el('span', { class: 'enc-trait', title: t.desc }, t.name);
    list.appendChild(span);
  });
  row.appendChild(list);
  return row;
}

function signatureRowEl(sig) {
  const t = TRAITS[sig.id];
  const row = el('div', { class: 'enc-sig-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, 'signature'));
  row.appendChild(el('span', { class: 'enc-sig-name', title: t ? t.desc : '' }, t ? t.name : sig.id));
  row.appendChild(el('span', { class: 'enc-stat-num' }, sig.usesLeft > 0 ? `${sig.usesLeft} use` : 'spent'));
  return row;
}

// ── pose queue (what's coming) ──────────────────────────────────────────
function poseQueueEl(enc) {
  const wrap = el('div', { class: 'enc-queue' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ what she will do ─'));
  const queue = enc.patient.queue.slice(0, Math.max(POSE_QUEUE_VISIBLE, enc.revealCount || 0));
  // Base visibility: now + next. LISTEN extends. KNOW on patient also reveals
  // additional poses. Players never have to LISTEN to make a reasonable
  // first-turn read — the rhythm is the puzzle, not the lookup.
  const knowStacks = (enc.patient.statuses.know || 0);
  const baseVisible = 2 + knowStacks + Math.max(0, (enc.revealCount || 0) - 2);
  const visible = Math.max(1, Math.min(queue.length, baseVisible));
  const list = el('div', { class: 'enc-queue-list' });
  for (let i = 0; i < queue.length; i++) {
    const pose = queue[i];
    const item = el('div', { class: 'enc-queue-item' + (i === 0 ? ' now' : '') + (i >= visible ? ' hidden-pose' : '') });
    item.appendChild(el('span', { class: 'enc-queue-marker' }, i === 0 ? '▶' : '·'));
    item.appendChild(el('span', { class: 'enc-queue-when' }, i === 0 ? 'now' : (i === 1 ? 'next' : 'after')));
    if (i < visible) {
      item.appendChild(el('span', { class: 'enc-queue-name' }, pose.name));
      item.appendChild(el('span', { class: 'enc-queue-tell', html: parseProse(pose.tell || '') }));
    } else {
      item.appendChild(el('span', { class: 'enc-queue-name dim' }, '~~?~~'));
      item.appendChild(el('span', { class: 'enc-queue-tell dim' }, 'not yet legible.'));
    }
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

// ── narrative + actions ─────────────────────────────────────────────────
function narrativeOrActionsEl(enc) {
  const box = el('div', { class: 'enc-bottom' });
  box.appendChild(narrativeWindowEl());
  // While the log still has unread entries, suppress both the action menu
  // and the loss panel — the player should finish reading first.
  const logBusy = state.typingIdx >= 0 || state.logAwaitingClick;
  if (logBusy) return box;
  if (enc.awaitingPlayer && !state.acting) {
    box.appendChild(actionMenuEl(enc));
  } else if (enc.over && enc.outcome === 'lost') {
    box.appendChild(lossPanelEl());
  }
  return box;
}

function narrativeWindowEl() {
  // The window shows the entry at state.shownLogIdx — NOT the latest. The
  // combat engine drives shownLogIdx forward as the player clicks through
  // each log entry. Typewriter animates while state.typingIdx === shownLogIdx.
  const clickable = state.typingIdx >= 0 || state.logAwaitingClick;
  const wrap = el('div', { class: 'enc-narr' + (clickable ? ' clickable' : '') });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ the room ─'));

  const idx = state.shownLogIdx;
  const entry = idx >= 0 ? state.log[idx] : null;
  const line = el('div', { class: 'enc-narr-line' + (entry ? ' ' + (entry.cls || '') : '') });
  if (!entry) {
    line.appendChild(el('span', {}, '—'));
  } else {
    const text = el('span', { class: 'enc-narr-text' });
    const html = parseProse(entry.text || '');
    const typing = idx === state.typingIdx;
    if (typing) text.innerHTML = typewriterize(html, 22);
    else        text.innerHTML = html;
    line.appendChild(text);
    if (entry.damage > 0)    line.appendChild(el('span', { class: 'enc-narr-dmg' },  `−${entry.damage}`));
    else if (entry.heal > 0) line.appendChild(el('span', { class: 'enc-narr-heal' }, `+${entry.heal}`));
  }
  wrap.appendChild(line);

  // continue prompt — shown when typing is done and we're waiting for click.
  // While typing, clicking skips the typewriter; once done, clicking advances.
  if (clickable) {
    const prompt = el('div', { class: 'enc-narr-prompt' });
    prompt.appendChild(el('span', { class: 'enc-narr-prompt-cursor' }, '▸ '));
    prompt.appendChild(el('span', {}, state.typingIdx >= 0 ? 'skip' : 'continue'));
    wrap.appendChild(prompt);
    wrap.addEventListener('click', advanceLog);
  }
  return wrap;
}

function actionMenuEl(enc) {
  const wrap = el('div', { class: 'enc-actions' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ what I may do ─'));
  const grid = el('div', { class: 'enc-actions-grid' });

  const acts = playerActions(enc);
  for (const a of acts) grid.appendChild(actionButton(a));
  wrap.appendChild(grid);
  return wrap;
}

function playerActions(enc) {
  const p = enc.player;
  const acts = [];
  acts.push({ key: 'press',  label: 'PRESS',   tag: '2 dmg',                       desc: enc.patient.def.flavor?.press  || 'a hand to her arm.' });
  const strikeCost = Math.max(0, 2 + (p.composure < 0 ? 0 : 0)); // base cost shown
  acts.push({ key: 'strike', label: 'STRIKE',  tag: `cost ${effectiveStrikeCost(p)}`, desc: enc.patient.def.flavor?.strike || 'her, hard.', disabled: p.composure < effectiveStrikeCost(p) });
  acts.push({ key: 'endure', label: 'ENDURE',  tag: '+comp · ½ dmg next',           desc: enc.patient.def.flavor?.endure || 'the room.' });
  acts.push({ key: 'listen', label: 'LISTEN',  tag: 'reveal queue',                 desc: enc.patient.def.flavor?.listen || 'for further.' });
  acts.push({ key: 'speak',  label: 'SPEAK',   tag: p.statuses.hush > 0 ? 'hushed' : 'her name', desc: enc.patient.def.flavor?.speak || 'her name.', disabled: p.statuses.hush > 0 });
  if (p.signature && p.signature.usesLeft > 0) {
    const t = TRAITS[p.signature.id];
    acts.push({ key: 'signature', label: t ? t.name.toUpperCase() : 'SIGNATURE', tag: `${p.signature.usesLeft} use`, desc: t ? t.desc : '', signature: true });
  }
  return acts;
}

function effectiveStrikeCost(player) {
  let cost = 2;
  for (const tid of player.traits || []) {
    const t = TRAITS[tid];
    if (t && t.mods && t.mods.strikeCost) cost += t.mods.strikeCost;
  }
  return Math.max(0, cost);
}

function actionButton(act) {
  const cls = 'enc-act' + (act.disabled ? ' disabled' : '') + (act.signature ? ' sig' : '');
  const btn = el('button', { class: cls });
  if (act.disabled) btn.disabled = true;
  else btn.addEventListener('click', () => playerAct(act.key));
  btn.appendChild(el('span', { class: 'enc-act-marker' }, '▸'));
  btn.appendChild(el('span', { class: 'enc-act-label' }, act.label));
  if (act.tag) btn.appendChild(el('span', { class: 'enc-act-tag' }, act.tag));
  btn.appendChild(el('span', { class: 'enc-act-desc', html: parseProse(act.desc || '') }));
  return btn;
}

function lossPanelEl() {
  const wrap = el('div', { class: 'enc-loss' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ the page ends here ─'));
  const prose = el('div', { class: 'enc-loss-prose' });
  prose.innerHTML = parseProse('I close my eyes. the room ~~closes~~ closes. the file stays.');
  wrap.appendChild(prose);
  const btn = el('button', { class: 'doc-button', onclick: () => {
    // dispatch to run handler
    import('../run.js').then(m => m.reportEncounterLost());
  } }, [
    el('span', { class: 'doc-button-marker' }, '▸ '),
    el('span', {}, 'close the file'),
  ]);
  const row = el('div', { class: 'doc-action-row' }, [btn]);
  wrap.appendChild(row);
  return wrap;
}

// ── helpers ─────────────────────────────────────────────────────────────
function typewriterize(html, msPerChar) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  let charIdx = 0;
  function walk(node) {
    if (node.nodeType === 3) {
      const text = node.textContent;
      const frag = document.createDocumentFragment();
      for (const ch of text) {
        const span = document.createElement('span');
        span.className = 'tw-char';
        span.style.animationDelay = (charIdx++ * msPerChar) + 'ms';
        span.textContent = ch;
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === 1) {
      const children = Array.from(node.childNodes);
      for (const c of children) walk(c);
    }
  }
  walk(tmp);
  return tmp.innerHTML;
}
