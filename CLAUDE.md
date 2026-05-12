# Bloodlines — Codebase Map

A document-horror conversation roguelite. You are Patient 0413; each "wing" is a one-on-one encounter with a tragic patient — a *conversation*, not a fight. Vanilla ES modules, no build step, no deps. Open `index.html` to run.

## Narrative concept

You wake admitted to a hospital that isn't what it seems. Five wings, one patient per wing, then a final ward. Each patient is a self-contained tragedy held in an institutional file. The combat is reading them: their hidden state, what they hold onto, what they need. You leave each room with something kept (a trait) or something carried (a scar). Some patients see who you are; some see who they were waiting for; some see a child or a husband or a chord. Most don't see you at all unless you make them.

## Style guide

**Three voice registers, kept strictly separate.**
- **Patient files** — third-person clinical, sentence case, `[Bracketed]` nicknames. The dossier on the desk.
- **Combat narration / pose tells / drift lines** — protagonist's first-person `I`. The conversation as the protagonist experiences it.
- **Patient direct speech inside narration** — appears inside the same `I` paragraphs, often quoted via `~~strike~~` (corrected) or `!!red!!` (urgent).

**Markup, parsed by `src/ui/textCorrupt.js`** — usable in *any* authored prose (files, intros, verbs, interjections, endings, traits, scars, events):
- `~~text~~` → strikethrough/overwrite (text crossed out, replacement read)
- `[[N]]` → red redaction bar of N chars (used sparingly, on the most charged words)
- `**text**` → gold accent (rare; quietly charged words)
- `!!text!!` → blood-red text (warnings, refusals, the most charged moments)

**Lowercase as default voice.** Sentence case is the institutional tone (file lines); protagonist narration is mostly lowercase. Capitalize ALL CAPS only for verb labels, status names, screen tags.

**No emojis. No comments unless non-obvious.** Identifiers carry intent.

**Glyphs, not portraits.** Each patient gets one 16×16 hand-authored bitmap (`data/glyphs.json`). Asymmetric, freehand pixel placement. Renderer is `src/ui/glyphs.js` → crisp-edged SVG.

## Tech / architecture in one paragraph

`src/main.js` awaits `loadData()` (fetches `data/glyphs.json` and `data/voiceprose.json` into named exports on `src/data.js`), restores the persistent meta-save from `localStorage`, then calls `render()`. The whole app is **state mutation + re-render**: modules import `state` from `src/state.js`, mutate it directly, then call `render()` from `src/ui/render.js`. `render()` clears `#app` and dispatches on `state.screen` to a screen renderer in `src/ui/screens.js` (or `src/ui/encounter.js` for the live conversation screen). No virtual DOM, no framework, no router. UI builds DOM via `el(tag, props, children)` in `src/ui/dom.js`. The combat engine is async — it interleaves `pushLog`, `drainLog` (typewriter + click-to-advance) and `render()` so each line lands in beat with the conversation.

## Run shape

ADMISSION (pick a wound) → 5 wings, each = 1 corridor event + 1 patient → FINAL ward (the Choir) → ARCHIVE. The corridor map shows progress as a thin row of nodes. The patient pool grows as runs complete (`save.js` `UNLOCK_LADDER`).

## The encounter — combat as conversation

Each patient is a hand-authored conversation puzzle. **No HP, no damage, no attacks.** You read their state from a composed sentence; you pick from a verb menu; they react.

**Patient scales** — every patient has 3–4 hidden axes (0–10) tagged `kind: 'positive' | 'negative'`. e.g. the Pram has *tenderness* and *lucidity* (positive — fill them to reach a graceful ending) and *grip* and *agitation* (negative — keep low, or fill toward a tragic ending). Values are hidden by default; traits like Unblinking / Bound / Witness reveal one. UI pip colors: gold for positive, red for negative.

**`presented(patient)` → sentence.** Each patient renders a composed sentence each turn — three clauses, each tied to one or two scales. This is the player's read. (`her arms are tight. she does not look up. she hums under her breath.`)

**Verbs are contextual.** Each verb can declare `when(patient, player): boolean`. The UI filters live; verbs appear and disappear as the patient changes state. Most patients have 2–3 baseline verbs always available + 3–5 contextual ones. `WAIT` and `LEAVE` are universal. The wound's `SIGNATURE` is once per fight.

**No verb costs.** Composure is pure health. Risky verbs *consequence* composure inside their response (`composure: -1`), they never gate up front.

**Interjections — the patient takes a turn.** Each patient has 1–3 `interjections: [{ id, when, once?, prose, responses }]`. When the player's turn would start, the engine checks interjections; if one fires, its prose drains as log lines and the player picks from the authored responses instead of the verb menu. Pram's `are you here for me?`, Pyrelord's `what do you want me to say?`, Glimmer's `did you see?`, Choir's `are you one of us yet?`.

**Drift on WAIT.** When the player WAITS, the patient acts on its own — `drift(patient, player)` returns a response. Often the most surprising thing in the fight.

**Spam-resistance.** The engine auto-tracks `patient.flags.lastVerb` and `patient.flags.streak`. Authored responses check `streakCount(p, verbId)` and branch — repeating a verb produces diminishing returns or escalating consequences. Spam is never gated; it just stops working.

**Endings.** First matching ending fires. Each is `{ id, when, title, lines, trait?, scars? }`. Conditions reference scales / flags / turn. Multiple paths reach each ending. Several endings per patient (typically 5: a positive resolution, a forced one, a tragic one, a stalled one, an abandoned one). `lines`, `trait`, and `scars` may be **functions** of patient/player state (e.g. Pram's `forced` ending reads differently if she was tender vs spiked when you took the pram).

**Run end.** Composure → 0 = collapse, run ends. Reaching the Choir's final ending = discharge.

## Player state

- **Composure** (0–`composureMax`) — the only health resource. Carries between encounters. The wound's `startComposure` is a per-fight baseline floor: composure is raised back up to it at fight start if depleted. Absolute floor of 1 so one cost-1 verb (and WAIT / cost-0 verbs) are always possible.
- **Traits** — gifts earned from patient resolutions. Universal mods (`composureMax`, `startComposure`, `verbCostMod`) or hooks (`onEncounterStart`, `onPlayerVerb`, `onCorridorEntry`, `onSignature`, `onCollapse`, `onScar`, `onEncounterEnd`). Some patients read `player.traits.includes('remembered')` etc. to branch their responses.
- **Scars** — run-long debuffs earned from bad outcomes. Some affect `composureMax` (cap), some affect per-fight starting composure (`startComposureDelta`), some declare `verbCostMod` functions. Patients read `player.scars` to adjust initial state (a scar may make a patient less trusting).
- **Wound** — the admission reason, chosen at run start. Provides `startComposure`, possibly `composureMax`, and a `signature` trait (`sig_*`). One per run.
- **Signature** — wound-given, once per fight (sometimes twice if you have Faithful / Forgotten Name). Has `onSignature(ctx)` hook in its trait def.

## File map

### `src/`
- `main.js` — entry. Loads data, loads save, kicks off render. Binds space/enter for log-advance.
- `state.js` — `state` singleton, `pushLog`, `clearLog`, constants (`RUN_DEPTH=5`, `COMPOSURE_MAX=5`). State includes click-to-advance fields: `shownLogIdx`, `typingIdx`, `logAwaitingClick`, `_logClickResolve`, `_typeSkipResolve`.
- `data.js` — `loadData()`; named exports `GLYPHS`, `VOICE`.
- `save.js` — localStorage meta-progression. `defaultSave()`, `loadSave()`, `writeSave()`, `recordRunOutcome(save, payload)`, `UNLOCK_LADDER` (extra wounds + patients unlock by run count). Choir is in `STARTING_PATIENTS` (it's the final, always available).
- `rng.js` — `rand`, `randi`, `pick`, `pickN`, `sleep`.
- `audio.js` — WebAudio bleeps: `hit, crit, heal, select, faint, victory, capture, levelup`.
- `version.js` — single-line version string.
- `run.js` — run lifecycle. `startNewRun(wound)` builds the corridor (alternates event-patient, sorts wing patients by tier, appends Choir final). `enterCurrentNode()` dispatches into an event or encounter. `advanceRun()` fires `onCorridorEntry` trait hooks then renders corridor. `applyResolutionAndAdvance()` calls `combat.acknowledgeResolution()` and pushes to `resolutionsTaken`. `endRun({outcome})` writes the run to save and shows the archive. `reportEncounterLost()` for collapse path.
- `combat.js` — the conversation engine. `makePlayer(wound)`, `recomputePlayerStats(player)`, `addTrait`, `beginEncounter(patientDef, player)`, `playerVerb(verbId)` (entry from UI; dispatches verb or interjection response), `advanceLog()` (click-to-advance), `acknowledgeResolution()` (applies trait + scars filtered by `onScar` hooks, fires `onEncounterEnd`), `isPlayerTurn()`. Internal: `runPlayerVerb`, `runInterjectionResponse`, `postTurn`, `maybeFireInterjection`, `applyResponse`, `shiftScale`, `checkEndings`, `fireEnding`, `fireCollapse`, `drainLog`. The streak / `lastVerb` flags are auto-managed here.
- `traits.js` — `TRAITS` registry. Each trait may declare `mods` (numeric, read via `sumMod`) and/or `hooks` (named functions: `onEncounterStart`, `onCorridorEntry`, `onPlayerVerb`, `onSignature`, `onCollapse`, `onScar`, `onEncounterEnd`). Signatures are also traits, prefixed `sig_`. `fireTraitHooks(player, hookName, ctx)` runs all matching hooks.
- `scars.js` — `SCARS` registry. Each scar may declare `composureCap` (max-composure cap), `startComposureDelta` (per-fight baseline reduction), or `verbCostMod(cost, verb)` function. `applyScar(player, id)` dedupes.
- `wounds.js` — `WOUNDS` registry. Each has `file` (3 dossier lines), `one_liner`, `mods` (`startComposure`, `composureMax`), `signature` (a `sig_*` trait id).
- `events.js` — corridor vignettes. Each has `tag`, `glyph`, `prose` (lines), `choices` (each `{ key, label, prose, effect(player, run) }`). `pickEventPool(n)` samples without replacement.
- `patients.js` — all 9 patients, full bespoke modules (~4250 lines). Registry at the bottom: `PATIENTS = { pram, pyrelord, soothlick, glimmer, frostfin, hollow, mire, composer, choir }`.

### `src/ui/`
- `render.js` — dispatcher. Reads `state.screen`, routes to a renderer.
- `screens.js` — title, admission, corridor, event, event_after, resolution, archive. The archive renders per-fight cards with ending title + ending prose lines + trait + scars.
- `encounter.js` — the live conversation screen. Patient column (glyph, file, presented sentence, scales) and player column (composure, on-me effects, scars, traits, signature). Bottom: narrative window with click-to-advance prompt, then either the verb menu (filtered by `when()`) or the interjection response menu (when `enc.activeInterjection` is set).
- `dom.js` — `el(tag, props, children)`, `attachLongPress`.
- `glyphs.js` — bitmap glyph → SVG.
- `textCorrupt.js` — `parseProse(string)` parses the four markup forms.
- `animations.js` — float numbers, column shake / lunge / recoil, callouts.

### `data/`
- `glyphs.json` — 16×16 hand-authored bitmaps. `#` filled, `.` empty.
- `voiceprose.json` — mostly legacy now. Most authoring lives inline in `src/patients.js` / `src/wounds.js` / `src/events.js` / `src/traits.js` / `src/scars.js`.

## Patient definition contract

A patient is a plain object in `src/patients.js`:

```js
{
  id, name, glyph, subtitle, role: 'wing'|'final', tier: 1|2|3,
  file: [3 lines],
  intro: [N lines],          // pushed at encounter start
  scales: {
    [key]: { initial, min, max, label, kind: 'positive'|'negative' }
  },
  initialize(patient, player),    // set starting values, often with RNG. May read player.scars / player.traits.
  presented(patient): string,     // composed sentence read every turn. 3 clauses tied to scales.
  verbs: {
    [verbId]: {
      label, desc,
      when?(patient, player): bool,    // contextual gating
      respond(patient, player): Response
    }
  },
  interjections: [
    { id, when, once?, prose: [...], responses: [{ label, desc?, lines, scales, composure, scars, flags }] }
  ],
  drift(patient, player): Response,
  endings: [
    { id, when, title, lines, trait?, scars? }
    // lines, scars, trait may be functions of (patient, player)
  ],
  onLeave?(patient, player): Response,   // optional override for the LEAVE verb
}
```

**Response shape** (returned by verb / interjection / drift / onLeave):

```js
{
  lines: string[] | string,           // each becomes a log entry; parseProse'd
  scales: { [key]: delta },           // signed integer
  composure: int,                     // signed delta to player
  scars: string[],                    // adds to player.scars (filtered by onScar hooks)
  effects: { [key]: delta },          // patient.effects (rarely used)
  playerEffects: { [key]: delta },    // patient-applied effects on player (e.g. drowsing)
  flags: { [key]: bool },             // patient.flags — read by endings / when() predicates
  callout?: string,                   // animations.spawnCallout
  shake?: bool,                       // animations.shakeStage
}
```

**Authoring conventions inside a patient:**
- 2–3 always-available baseline verbs (no `when`).
- 3–5 contextual verbs each gated by a `when()` predicate that reads scales / flags.
- Verb responses branch on `streakCount(p, verbId)` and on scale values. Repeating produces diminishing returns or different consequences.
- Drift varies with state — high-grip patients escalate on their own; soft patients drift toward lucidity.
- 4–6 endings: at least one positive (high positive scales), one forced (a flag set by a "take" verb), one tragic (a negative scale fills), one stalled (`p.turn >= N`), one abandoned (`p.flags.left`).

## Conventions

- **`state` is global and mutated directly.** Don't pass as a parameter; import it.
- **Re-render after mutation.** Any user-visible change ends with `render()`. Async combat flows in `combat.js` interleave `render()` and `await sleep(ms)` for pacing.
- **No build step.** Browser-native ES modules.
- **No comments unless non-obvious.** Identifiers carry intent. Inline JSDoc-like comments are used at the top of each major file to explain *why*.
- **Patients are bossfights, not fodder.** Each is hand-crafted; each appears once per run, drawn from a growing pool.
- **Composure carries.** It is not reset between encounters. Events between fights are how you recover; the wound's `startComposure` is a per-fight FLOOR.
- **Click-to-advance log.** Every log entry types out, then a `▸ continue` prompt; click the narrative box (or press space / enter) to advance. The encounter UI suppresses the action menu while anything is unread.

## Adding things — checklists

**New patient:** add an object to `src/patients.js` following the contract above. `glyph` must exist in `glyphs.json` (16×16 bitmap). Set `tier` (1–3, controls wing order). Reference trait ids in `endings[*].trait` that exist in `TRAITS`. Reference scar ids in `endings[*].scars` that exist in `SCARS`. Register in `PATIENTS` at the bottom. If the patient should be locked behind run count, add to `save.js` `UNLOCK_LADDER`.

**New trait:** add an entry to `TRAITS` in `src/traits.js` with `name`, `desc`, `voice`, optional `mods` and `hooks`. Available hooks: `onEncounterStart`, `onCorridorEntry`, `onPlayerVerb` (ctx has `verbId`), `onSignature`, `onCollapse` (set `ctx.cancel = true` to save the player), `onScar` (set `ctx.prevent = true` to filter it out), `onEncounterEnd`. Reference the trait id from a patient ending or an event.

**New wound:** add an entry to `WOUNDS` in `src/wounds.js` with `file` (3 lines), `one_liner`, `mods` (`startComposure`, `composureMax`), and a `signature` (`sig_*` trait id). Add the corresponding `sig_*` trait to `TRAITS`. Add to `STARTING_WOUNDS` in `save.js` if it should be available from run 0; otherwise wire it into `UNLOCK_LADDER`.

**New scar:** add an entry to `SCARS` in `src/scars.js` with `name`, `file` (one line), `desc`, and optionally `composureCap`, `startComposureDelta`, or `verbCostMod(cost, verb)`. Apply via `applyScar(player, id)` from response objects or events.

**New event:** add an entry to `EVENTS` in `src/events.js` with `tag` (the `// corridor · X` header), `glyph`, `prose` (lines), and `choices` (each `{ key, label, prose, effect(player, run) }`). The effect can call `bumpComposure(p, n)`, `addTrait(p, id)`, `applyScar(p, id)`, or mutate `run` flags.

**New interjection for an existing patient:** add to that patient's `interjections` array. `when(patient, player)` predicate should reference scales / flags / turn. Mark `once: true` if it should fire only once per fight. Provide 2–4 authored `responses` with `label`, `desc?`, `lines`, and scale/composure/scar/flag effects.

**New screen:** add a renderer in `src/ui/screens.js`, register in the `switch` in `src/ui/render.js`, set `state.screen = 'name'` to enter.

## Test / verify

No automated tests. Manual: open `index.html` (any static server works). Combat changes are easiest to verify by playing through a fight and watching the in-encounter narrative box (`state.log`) and the scale movement in the parenthetical readouts.

Playwright is available in the sandbox for headless smoke tests if needed (`/opt/node22/lib/node_modules/playwright`). Past playtest scripts have driven full fights to ending and verified no JS errors. None are checked in — they're written ad hoc.
