// The encounter screen. No HP bars, no pose queue. The patient's column
// shows: name, glyph, file, a composed "presented state" sentence (derived
// from her hidden scales), and the set of scales by NAME (revealed values
// hidden unless the player has a trait like unblinking/witness).
//
// The action menu is patient-specific: each patient defines its own verbs.
// WAIT and LEAVE are universal. The wound-given SIGNATURE sits below the
// rest.

import { el, app } from './dom.js';
import { state, COMPOSURE_MAX } from '../state.js';
import { isPlayerTurn, playerVerb, advanceLog } from '../combat.js';
import { renderGlyph } from './glyphs.js';
import { parseProse } from './textCorrupt.js';
import { TRAITS } from '../traits.js';
import { WOUNDS } from '../wounds.js';
import { SCARS } from '../scars.js';

export function renderEncounter() {
  const enc = state.enc;
  if (!enc) return;
  const screen = el('div', { class: 'enc-screen' });
  screen.appendChild(encStripEl());
  screen.appendChild(dossierGridEl(enc));
  screen.appendChild(narrativeOrActionsEl(enc));
  app().appendChild(screen);
}

function encStripEl() {
  const enc = state.enc;
  const wing = Math.min(state.run ? Math.ceil((state.run.idx + 1) / 2) : 1, 5);
  const left = el('div', { class: 'enc-strip-left' }, [
    el('span', {}, '// engagement'),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, enc.patient.def.role === 'final' ? 'the final ward' : `wing ${wing}`),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, `file ${enc.patient.id}`),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, `turn ${enc.patient.turn + 1}`),
  ]);
  const right = el('div', { class: 'enc-strip-right' }, [
    el('span', { class: 'doc-blot' }, '●'),
    ' they are here',
  ]);
  return el('div', { class: 'enc-strip' }, [left, right]);
}

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

  // file (small, 3 lines)
  const file = el('div', { class: 'enc-file' });
  for (const line of patient.file || []) {
    file.appendChild(el('div', { class: 'enc-file-line', html: parseProse(line) }));
  }
  col.appendChild(file);

  // presented state — the heart of the read. Composed from scales by the
  // patient's own presented(patient) function.
  const presented = (typeof patient.def.presented === 'function')
    ? patient.def.presented(patient)
    : '';
  if (presented) {
    col.appendChild(el('div', { class: 'enc-section-label' }, '─ she presents as ─'));
    col.appendChild(el('div', { class: 'enc-presented', html: parseProse(presented) }));
  }

  // scale names (always shown). Values are hidden unless revealed.
  col.appendChild(scaleListEl(patient));

  // effects on the patient herself (named, not numeric, e.g. nothing yet)
  // — left out by default; patients can flag specific effects via prose.

  return col;
}

function playerColEl(player) {
  const col = el('div', { class: 'enc-col enc-col-player' });
  const w = player.wound ? WOUNDS[player.wound] : null;
  const head = el('div', { class: 'enc-head' });
  const g = el('div', { class: 'enc-glyph' });
  g.innerHTML = renderGlyph('Lumenpup');
  head.appendChild(g);
  const headText = el('div', { class: 'enc-head-text' });
  headText.appendChild(el('div', { class: 'enc-name' }, 'Patient 0413'));
  headText.appendChild(el('div', { class: 'enc-sub', html: parseProse(w ? w.one_liner : '') }));
  head.appendChild(headText);
  col.appendChild(head);

  // composure pips
  col.appendChild(composureRowEl(player));

  // patient-applied effects on the player (e.g. drowsing from Soothlick)
  col.appendChild(playerEffectsRowEl());

  // scars (run-long)
  col.appendChild(scarRowEl(player));

  // traits (with descriptions — discoverability)
  col.appendChild(traitListEl(player));

  // signature (always visible)
  if (player.signature) col.appendChild(signatureBlockEl(player.signature));

  return col;
}

function scaleListEl(patient) {
  const wrap = el('div', { class: 'enc-scales' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ what shifts ─'));
  const enc = state.enc;
  const revealed = enc._revealed || [];
  const entries = Object.entries(patient.def.scales || {});
  if (!entries.length) {
    wrap.appendChild(el('div', { class: 'enc-scale-empty' }, '— nothing the file tracks —'));
    return wrap;
  }
  const list = el('div', { class: 'enc-scale-list' });
  for (const [key, def] of entries) {
    const row = el('div', { class: 'enc-scale-row' });
    row.appendChild(el('span', { class: 'enc-scale-name' }, def.label || key));
    if (revealed.includes(key)) {
      const max = def.max ?? 5;
      const val = patient.scales[key] ?? 0;
      const pips = el('span', { class: 'enc-scale-pips' });
      for (let i = 0; i < max; i++) {
        pips.appendChild(el('span', { class: 'enc-scale-pip' + (i < val ? ' lit' : '') }, i < val ? '●' : '○'));
      }
      row.appendChild(pips);
    } else {
      row.appendChild(el('span', { class: 'enc-scale-veil' }, '~~?~~'));
      const veil = row.querySelector('.enc-scale-veil');
      veil.innerHTML = parseProse('~~?~~');
    }
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function composureRowEl(player) {
  const row = el('div', { class: 'enc-stat-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, 'composure'));
  const pips = el('span', { class: 'enc-pips' });
  const max = player.composureMax || COMPOSURE_MAX;
  for (let i = 0; i < max; i++) {
    pips.appendChild(el('span', { class: 'enc-pip' + (i < player.composure ? ' lit' : '') }, i < player.composure ? '●' : '○'));
  }
  row.appendChild(pips);
  row.appendChild(el('span', { class: 'enc-stat-num' }, `${player.composure}/${max}`));
  return row;
}

function playerEffectsRowEl() {
  const enc = state.enc;
  const eff = enc.patient.playerEffects || {};
  const items = Object.entries(eff).filter(([_, v]) => v > 0);
  const wrap = el('div', { class: 'enc-stat-row' });
  wrap.appendChild(el('span', { class: 'enc-stat-label' }, 'on me'));
  if (!items.length) {
    wrap.appendChild(el('span', { class: 'enc-status-empty' }, '— '));
    return wrap;
  }
  const list = el('span', { class: 'enc-status-list' });
  items.forEach(([k, v], i) => {
    if (i > 0) list.appendChild(el('span', { class: 'enc-cond-sep' }, ' · '));
    list.appendChild(el('span', { class: 'enc-status' }, [
      el('span', { class: 'doc-blot' }, '●'),
      ' ',
      k,
      ' ',
      el('span', { class: 'enc-status-num' }, `×${v}`),
    ]));
  });
  wrap.appendChild(list);
  return wrap;
}

function scarRowEl(player) {
  const wrap = el('div', { class: 'enc-stat-row' });
  wrap.appendChild(el('span', { class: 'enc-stat-label' }, 'scars'));
  const scars = (player.scars || []).filter(s => SCARS[s]);
  if (!scars.length) {
    wrap.appendChild(el('span', { class: 'enc-status-empty' }, '— '));
    return wrap;
  }
  const list = el('span', { class: 'enc-scar-list' });
  scars.forEach((sid, i) => {
    if (i > 0) list.appendChild(el('span', { class: 'enc-cond-sep' }, ' · '));
    list.appendChild(el('span', { class: 'enc-scar', title: SCARS[sid].desc }, SCARS[sid].name));
  });
  wrap.appendChild(list);
  return wrap;
}

function traitListEl(player) {
  const wrap = el('div', { class: 'enc-trait-block' });
  wrap.appendChild(el('div', { class: 'enc-stat-label' }, 'traits'));
  const traits = (player.traits || []).filter(t => TRAITS[t]);
  if (!traits.length) {
    wrap.appendChild(el('div', { class: 'enc-status-empty' }, '— none yet —'));
    return wrap;
  }
  const list = el('div', { class: 'enc-trait-stack' });
  for (const tid of traits) {
    const t = TRAITS[tid];
    const row = el('div', { class: 'enc-trait-line' });
    row.appendChild(el('span', { class: 'enc-trait-name' }, t.name));
    row.appendChild(el('span', { class: 'enc-trait-desc' }, t.desc));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function signatureBlockEl(sig) {
  const t = TRAITS[sig.id];
  const wrap = el('div', { class: 'enc-trait-block enc-sig-block' });
  wrap.appendChild(el('div', { class: 'enc-stat-label' },
    `signature · ${sig.usesLeft > 0 ? `${sig.usesLeft} use` : 'spent'}`));
  const row = el('div', { class: 'enc-trait-line sig' });
  row.appendChild(el('span', { class: 'enc-trait-name' }, t ? t.name : sig.id));
  row.appendChild(el('span', { class: 'enc-trait-desc' }, t ? t.desc : ''));
  wrap.appendChild(row);
  return wrap;
}

function narrativeOrActionsEl(enc) {
  const box = el('div', { class: 'enc-bottom' });
  box.appendChild(narrativeWindowEl());
  const logBusy = state.typingIdx >= 0 || state.logAwaitingClick;
  if (logBusy) return box;
  if (enc.awaitingPlayer && !state.acting) {
    box.appendChild(verbMenuEl(enc));
  } else if (enc.over && enc.outcome === 'collapsed') {
    box.appendChild(collapsePanelEl());
  }
  return box;
}

function narrativeWindowEl() {
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
  if (clickable) {
    const prompt = el('div', { class: 'enc-narr-prompt' });
    prompt.appendChild(el('span', { class: 'enc-narr-prompt-cursor' }, '▸ '));
    prompt.appendChild(el('span', {}, state.typingIdx >= 0 ? 'skip' : 'continue'));
    wrap.appendChild(prompt);
    wrap.addEventListener('click', advanceLog);
  }
  return wrap;
}

function verbMenuEl(enc) {
  const wrap = el('div', { class: 'enc-actions' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ what I may do ─'));
  const grid = el('div', { class: 'enc-actions-grid' });
  const acts = listVerbs(enc);
  for (const a of acts) grid.appendChild(verbButton(a));
  wrap.appendChild(grid);
  return wrap;
}

function listVerbs(enc) {
  const p = enc.player;
  const pat = enc.patient;
  const acts = [];
  // patient-specific verbs first
  for (const [id, v] of Object.entries(pat.def.verbs || {})) {
    const cost = Math.max(0, (v.cost || 0) + sumVerbCostMod(p));
    const disabled = cost > p.composure;
    acts.push({
      id, label: v.label.toUpperCase(),
      desc: v.desc || '',
      cost,
      disabled,
    });
  }
  // universal verbs
  acts.push({ id: 'wait', label: 'WAIT', desc: 'let the room move on its own.', cost: 0 });
  acts.push({ id: 'leave', label: 'LEAVE', desc: 'close the door behind you. ~~it has a cost.~~', cost: 0, danger: true });
  // signature
  if (p.signature && p.signature.usesLeft > 0) {
    const t = TRAITS[p.signature.id];
    acts.push({
      id: 'signature',
      label: (t ? t.name : 'SIGNATURE').toUpperCase(),
      desc: t ? t.desc : '',
      cost: 0,
      signature: true,
    });
  }
  return acts;
}

function sumVerbCostMod(player) {
  let total = 0;
  for (const tid of player.traits || []) {
    const t = TRAITS[tid];
    if (t && t.mods && t.mods.verbCostMod) total += t.mods.verbCostMod;
  }
  return total;
}

function verbButton(act) {
  const cls = 'enc-act'
    + (act.disabled ? ' disabled' : '')
    + (act.signature ? ' sig' : '')
    + (act.danger ? ' danger' : '');
  const btn = el('button', { class: cls });
  if (act.disabled) btn.disabled = true;
  else btn.addEventListener('click', () => playerVerb(act.id));
  btn.appendChild(el('span', { class: 'enc-act-marker' }, '▸'));
  btn.appendChild(el('span', { class: 'enc-act-label' }, act.label));
  const tag = act.cost > 0 ? `cost ${act.cost}` : (act.signature ? 'once' : '');
  if (tag) btn.appendChild(el('span', { class: 'enc-act-tag' }, tag));
  btn.appendChild(el('span', { class: 'enc-act-desc', html: parseProse(act.desc || '') }));
  return btn;
}

function collapsePanelEl() {
  const wrap = el('div', { class: 'enc-loss' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ the page ends here ─'));
  const prose = el('div', { class: 'enc-loss-prose' });
  prose.innerHTML = parseProse('I have no more of myself to spend. ~~the room~~ the room keeps the rest.');
  wrap.appendChild(prose);
  const btn = el('button', { class: 'doc-button', onclick: () => {
    import('../run.js').then(m => m.reportEncounterLost());
  } }, [
    el('span', { class: 'doc-button-marker' }, '▸ '),
    el('span', {}, 'close the file'),
  ]);
  wrap.appendChild(el('div', { class: 'doc-action-row' }, [btn]));
  return wrap;
}

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
