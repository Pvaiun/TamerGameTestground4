// Traits earned from patient resolutions. Each trait modifies the player's
// engagement with the next encounters — either passively (mods read by the
// engine) or via named hooks (onCorridorEntry, onEncounterStart,
// onPlayerVerb, onSignature, onCollapse).
//
// Patients themselves can also read `player.traits` and branch their
// responses, so some traits manifest as bespoke alterations to specific
// patients (e.g. "cold hands" warms the room faster for the woman at the
// bench). That logic lives in src/patients.js.

export const TRAITS = {

  // ─── from patient resolutions ─────────────────────────────────────────

  mothering: {
    id: 'mothering',
    name: 'Mothering',
    desc: 'restore 2 composure between encounters.',
    voice: 'there is a way of ~~holding~~ keeping. I learned it from her.',
    hooks: {
      onCorridorEntry(ctx) { ctx.healOutOfCombat(2); },
    },
  },

  empty_arms: {
    id: 'empty_arms',
    name: 'Empty Arms',
    desc: 'every verb costs 1 less composure (minimum 0).',
    voice: 'I gave it back. I still feel its weight.',
    mods: { verbCostMod: -1 },
  },

  inherited: {
    id: 'inherited',
    name: 'Inherited',
    desc: '+1 max composure.',
    voice: 'I took the bundle. it was not light. ~~it~~ it was something.',
    mods: { composureMax: 1, startComposure: 1 },
  },

  vessel_for_ghosts: {
    id: 'vessel_for_ghosts',
    name: 'Vessel for Ghosts',
    desc: 'if you would collapse, survive at 1 composure. once per run.',
    voice: 'he is here, somewhere ~~behind~~ inside.',
    hooks: {
      onCollapse(ctx) {
        if (!ctx.player._ghostUsed) {
          ctx.player._ghostUsed = true;
          ctx.player.composure = 1;
          ctx.cancel = true;
          ctx.log('a hand on my shoulder. it is not mine.', { cls: 'flavor' });
        }
      },
    },
  },

  dominion: {
    id: 'dominion',
    name: 'Dominion',
    desc: '+1 starting composure each fight.',
    voice: 'I sat in his chair. the room composed itself.',
    mods: { startComposure: 1 },
  },

  forgotten_name: {
    id: 'forgotten_name',
    name: 'A Name He Kept',
    desc: 'your signature has 2 uses per fight.',
    voice: 'he told me his name. !!I have already forgotten it.!!',
    hooks: {
      onEncounterStart(ctx) {
        if (ctx.player.signature) ctx.player.signature.usesLeft = 2;
      },
    },
  },

  calming: {
    id: 'calming',
    name: 'Calming Hands',
    desc: 'WAIT restores 1 composure.',
    voice: 'she moved without sound. I caught the rhythm.',
    hooks: {
      onPlayerVerb(ctx) {
        if (ctx.verbId === 'wait') ctx.composure(+1);
      },
    },
  },

  sleepless: {
    id: 'sleepless',
    name: 'Sleepless',
    desc: 'sleep / drowsing effects against you are halved.',
    voice: 'I will not lie down here.',
    // patient logic (e.g. soothlick) reads player.traits.includes('sleepless')
  },

  vigilant: {
    id: 'vigilant',
    name: 'Vigilant',
    desc: 'each time you WAIT, reveal one of the patient\'s scales for this fight.',
    voice: 'I keep watch. I do not look away.',
    hooks: {
      onPlayerVerb(ctx) {
        if (ctx.verbId !== 'wait') return;
        const keys = Object.keys(ctx.patient.def.scales || {});
        ctx.enc._revealed = ctx.enc._revealed || [];
        const unseen = keys.find(k => !ctx.enc._revealed.includes(k));
        if (unseen) {
          ctx.enc._revealed.push(unseen);
          const label = ctx.patient.def.scales[unseen]?.label || unseen;
          ctx.log(`I watched her ${label}, while I waited.`, { cls: 'flavor' });
        }
      },
    },
  },

  unblinking: {
    id: 'unblinking',
    name: 'Unblinking',
    desc: 'see the value of one of the patient\'s scales for the whole fight.',
    voice: 'he showed me how to look.',
    hooks: {
      onEncounterStart(ctx) {
        const scaleKeys = Object.keys(ctx.patient.def.scales || {});
        if (scaleKeys.length) ctx.revealScale(scaleKeys[0]);
      },
    },
  },

  small_warmth: {
    id: 'small_warmth',
    name: 'A Small Warmth',
    desc: 'restore 1 composure between encounters.',
    voice: 'the dog\'s breath at my hand. ~~I remember a dog.~~',
    hooks: {
      onCorridorEntry(ctx) { ctx.healOutOfCombat(1); },
    },
  },

  cold_hands: {
    id: 'cold_hands',
    name: 'Cold Hands',
    desc: 'you start each fight with +1 composure.',
    voice: 'she did not warm. I learned to be that way.',
    mods: { startComposure: 1 },
  },

  patience: {
    id: 'patience',
    name: 'Patience',
    desc: 'every other WAIT restores 1 composure.',
    voice: 'a bench. a station. a son who would come.',
    hooks: {
      onPlayerVerb(ctx) {
        if (ctx.verbId === 'wait') {
          ctx.player._patienceTick = ((ctx.player._patienceTick || 0) + 1) % 2;
          if (ctx.player._patienceTick === 0) ctx.composure(+1);
        }
      },
    },
  },

  remembered: {
    id: 'remembered',
    name: 'Remembered',
    desc: 'verbs that name or speak resonate further. (patient-specific.)',
    voice: 'I say the name. it answers to me.',
    // patient code (hollow, mire, frostfin) checks for this trait
  },

  redacted: {
    id: 'redacted',
    name: '[[8]]',
    desc: 'you cannot acquire new WITNESSED scars.',
    voice: 'the page is missing. I keep going.',
    hooks: {
      onScar(ctx) {
        if (ctx.scarId === 'witnessed') ctx.prevent = true;
      },
    },
  },

  faithful: {
    id: 'faithful',
    name: 'Faithful',
    desc: 'your signature has 2 uses per fight.',
    voice: 'I came here for a reason. ~~I forgot it.~~ I remember it.',
    hooks: {
      onEncounterStart(ctx) {
        if (ctx.player.signature) ctx.player.signature.usesLeft = 2;
      },
    },
  },

  bound: {
    id: 'bound',
    name: 'Bound',
    desc: 'at fight start, one of the patient\'s scales reveals itself.',
    voice: 'I learned what holds. I learned what loosens.',
    hooks: {
      onEncounterStart(ctx) {
        const scaleKeys = Object.keys(ctx.patient.def.scales || {});
        if (scaleKeys.length) ctx.revealScale(scaleKeys[scaleKeys.length - 1]);
      },
    },
  },

  unfinished: {
    id: 'unfinished',
    name: 'Unfinished',
    desc: 'at the end of every fight, restore 2 composure.',
    voice: 'I have not yet ~~finished~~ closed.',
    hooks: {
      onEncounterEnd(ctx) {
        ctx.composure(+2);
      },
    },
  },

  // ─── signatures (granted by wounds) ───────────────────────────────────

  sig_amnesia: {
    id: 'sig_amnesia',
    name: 'I do not remember',
    desc: 'once per fight: reset every player effect the patient has put on you, and restore 1 composure.',
    voice: 'I forget what was being done to me.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        for (const k of Object.keys(ctx.patient.playerEffects || {})) ctx.patient.playerEffects[k] = 0;
        ctx.composure(+1);
        ctx.log('I do not remember what was being done to me. ~~she does not~~ she does not either.', { cls: 'flavor' });
      },
    },
  },

  sig_insomnia: {
    id: 'sig_insomnia',
    name: 'I have been awake',
    desc: 'once per fight: reveal one of the patient\'s scales for this fight.',
    voice: 'I keep moving. I do not stop.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        const keys = Object.keys(ctx.patient.def.scales || {});
        const unseen = keys.find(k => !(ctx.enc._revealed || []).includes(k));
        if (unseen) {
          ctx.revealScale(unseen);
          ctx.log(`I have been awake. ~~I~~ I see her ${unseen}, now.`, { cls: 'flavor' });
        } else {
          ctx.log('I have been awake. ~~I see her~~ I see her whole.', { cls: 'flavor' });
        }
      },
    },
  },

  sig_absence: {
    id: 'sig_absence',
    name: 'I was not there',
    desc: 'once per fight: undo the last shift in one scale of your choice. ~~the room~~ no one remembers.',
    voice: 'I close the door from the inside.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        // simple version — restore composure to max and clear playerEffects.
        ctx.composure(ctx.player.composureMax);
        for (const k of Object.keys(ctx.patient.playerEffects || {})) ctx.patient.playerEffects[k] = 0;
        ctx.log('I close the door from the inside. ~~for a moment~~ for a moment, I was never in.', { cls: 'flavor' });
      },
    },
  },

  sig_witness: {
    id: 'sig_witness',
    name: 'I see what is here',
    desc: 'once per fight: reveal ALL of the patient\'s scales for this fight.',
    voice: 'I write it down. ~~it writes back.~~',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        for (const k of Object.keys(ctx.patient.def.scales || {})) ctx.revealScale(k);
        ctx.log('I see her whole. ~~the page~~ the page is full.', { cls: 'flavor' });
      },
    },
  },

  sig_devotion: {
    id: 'sig_devotion',
    name: 'I am for them',
    desc: 'once per fight: lose 2 composure, but shift one of the patient\'s scales toward release.',
    voice: 'I came here on purpose. I will leave on purpose.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        ctx.composure(-2);
        // shift a "stuck" scale: pick the scale at its max and reduce it by 2.
        const scaleKeys = Object.keys(ctx.patient.def.scales || {});
        const maxedKey = scaleKeys.find(k => ctx.patient.scales[k] >= (ctx.patient.def.scales[k]?.max ?? 5) - 1);
        if (maxedKey) {
          ctx.shift(maxedKey, -2);
          ctx.log(`I take her ${maxedKey} into my hands. ~~it~~ it eases.`, { cls: 'flavor' });
        } else {
          ctx.log('I am here. I am for her. ~~it~~ it costs.', { cls: 'flavor' });
        }
      },
    },
  },

  sig_hollow: {
    id: 'sig_hollow',
    name: 'I am hollow',
    desc: 'once per fight: refill composure to maximum.',
    voice: 'I empty out. the room rushes in.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        ctx.composure(ctx.player.composureMax);
        ctx.log('I empty out. the room rushes in. ~~I~~ I am almost full again.', { cls: 'flavor' });
      },
    },
  },
};

// ─── helpers used by the engine ────────────────────────────────────────

export function traitMods(trait) { return trait.mods || {}; }
export function traitHooks(trait) { return trait.hooks || {}; }
export function getTrait(id) { return TRAITS[id] || null; }

// Sum a numeric modifier across all traits + signature.
export function sumMod(player, key) {
  let total = 0;
  for (const tid of player.traits || []) {
    const t = TRAITS[tid]; if (!t) continue;
    total += (t.mods && t.mods[key]) || 0;
  }
  if (player.signature && TRAITS[player.signature.id]) {
    total += (TRAITS[player.signature.id].mods && TRAITS[player.signature.id].mods[key]) || 0;
  }
  return total;
}

// Fire a named hook across all traits + signature.
export function fireTraitHooks(player, hookName, ctx) {
  for (const tid of player.traits || []) {
    const t = TRAITS[tid];
    if (!t || !t.hooks || !t.hooks[hookName]) continue;
    try { t.hooks[hookName](ctx); } catch (e) { console.error('trait hook error', tid, hookName, e); }
  }
  if (player.signature) {
    const t = TRAITS[player.signature.id];
    if (t && t.hooks && t.hooks[hookName]) {
      try { t.hooks[hookName](ctx); } catch (e) { console.error('sig hook error', e); }
    }
  }
  return ctx;
}
