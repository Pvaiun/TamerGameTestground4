// The trait registry. Traits are small, named modifications to the player's
// combat behavior. Most are acquired from a patient resolution; a few are
// granted by the player's wound at admission.
//
// Each trait may declare any subset of:
//   mods: { maxHp, startComposure, pressDmg, strikeDmg, strikeCost,
//           listenReveal, listenCompGain, endureCompGain, endureHeal,
//           bleedTickDmg, knowDuration }
//   hooks: object of named functions called by the combat engine.
//
// Hooks receive ctx (combat context). They may set ctx.consumed = true,
// ctx.bonus = N, etc. Engine reads these after the hook returns.

export const TRAITS = {

  // ─── from patient resolutions ────────────────────────────────────────

  mothering: {
    id: 'mothering',
    name: 'Mothering',
    desc: 'When the patient is at 1 HP, your next action heals you for 3.',
    voice: 'There is a way of ~~holding~~ keeping. I learned it from her.',
    hooks: {
      afterAnyResolve(ctx) {
        if (ctx.patient.hp === 1 && !ctx.player._motheringPrimed) {
          ctx.player._motheringPrimed = true;
        }
      },
      beforePlayerResolve(ctx) {
        if (ctx.player._motheringPrimed) {
          ctx._motheringFire = true;
        }
      },
      afterPlayerResolve(ctx) {
        if (ctx._motheringFire) {
          ctx.heal(ctx.player, 3, 'a way of holding');
          ctx.player._motheringPrimed = false;
        }
      },
    },
  },

  empty_arms: {
    id: 'empty_arms',
    name: 'Empty Arms',
    desc: 'STRIKE costs 1 less composure but deals 1 less damage.',
    voice: 'I gave it back. I still feel its weight.',
    mods: { strikeCost: -1, strikeDmg: -1 },
  },

  inherited: {
    id: 'inherited',
    name: 'Inherited',
    desc: '+2 maximum HP. You start each fight with 1 BLEED.',
    voice: 'I took the bundle. It was not light.',
    mods: { maxHp: 2 },
    hooks: {
      onEncounterStart(ctx) { ctx.applyStatus(ctx.player, 'bleed', 1); },
    },
  },

  dominion: {
    id: 'dominion',
    name: 'Dominion',
    desc: 'PRESS deals +1 damage.',
    voice: 'I sat in his chair. The room composed itself.',
    mods: { pressDmg: 1 },
  },

  vessel_for_ghosts: {
    id: 'vessel_for_ghosts',
    name: 'Vessel for Ghosts',
    desc: 'When you would die, survive at 1 HP. Once per run.',
    voice: 'He is here, somewhere ~~behind~~ inside.',
    hooks: {
      onLethalDamage(ctx) {
        if (!ctx.player._ghostUsed) {
          ctx.player._ghostUsed = true;
          ctx.cancelLethal = true;
          ctx.player.hp = 1;
          ctx.log({ text: 'a hand on my shoulder. it is not mine.', cls: 'flavor', pause: 700 });
        }
      },
    },
  },

  forgotten_name: {
    id: 'forgotten_name',
    name: 'A Name He Kept',
    desc: 'LISTEN reveals 4 upcoming poses instead of 2.',
    voice: 'He told me his name. !!I have already forgotten it.!!',
    mods: { listenReveal: 2 },
  },

  calming: {
    id: 'calming',
    name: 'Calming Hands',
    desc: 'You start each encounter with 2 composure.',
    voice: 'She moved without sound. I caught the rhythm.',
    mods: { startComposure: 2 },
  },

  sleepless: {
    id: 'sleepless',
    name: 'Sleepless',
    desc: 'Immune to HELD. ENDURE no longer grants composure.',
    voice: 'I will not lie down here.',
    mods: { endureCompGain: -2 },
    hooks: {
      beforeStatusApplied(ctx) {
        if (ctx.statusKey === 'held' && ctx.target === ctx.player) ctx.prevent = true;
      },
    },
  },

  vigilant: {
    id: 'vigilant',
    name: 'Vigilant',
    desc: 'LISTEN heals you for 1.',
    voice: 'I keep watch. I do not look away.',
    hooks: {
      onListen(ctx) { ctx.heal(ctx.player, 1, 'I keep watch.'); },
    },
  },

  unblinking: {
    id: 'unblinking',
    name: 'Unblinking',
    desc: 'You see the patient\'s next pose at all times. KNOW lasts +2 turns.',
    voice: 'He showed me how to look.',
    mods: { listenReveal: 1, knowDuration: 2 },
    hooks: {
      onEncounterStart(ctx) { ctx.applyStatus(ctx.patient, 'know', 2); },
    },
  },

  small_warmth: {
    id: 'small_warmth',
    name: 'A Small Warmth',
    desc: 'Heals 2 HP between encounters (does not stack).',
    voice: 'The dog\'s breath at my hand. ~~I remember a dog.~~',
    hooks: {
      onCorridorEntry(ctx) { ctx.healOutOfCombat(2); },
    },
  },

  cold_hands: {
    id: 'cold_hands',
    name: 'Cold Hands',
    desc: 'STRIKE applies 2 BLEED to the patient.',
    voice: 'She did not warm. I learned to be that way.',
    hooks: {
      onStrikeHit(ctx) { ctx.applyStatus(ctx.patient, 'bleed', 2); },
    },
  },

  patience: {
    id: 'patience',
    name: 'Patience',
    desc: 'ENDURE heals 2 instead of granting composure.',
    voice: 'A bench. A station. A son who would come.',
    mods: { endureCompGain: -2, endureHeal: 2 },
  },

  remembered: {
    id: 'remembered',
    name: 'Remembered',
    desc: 'SPEAK\'s effect is doubled.',
    voice: 'I say the name. It answers to me.',
    hooks: {
      onSpeakEffect(ctx) { ctx.speakMult = 2; },
    },
  },

  rooted: {
    id: 'rooted',
    name: 'Rooted',
    desc: '+3 maximum HP. You move slowly: patient always acts first.',
    voice: 'I will be where I was.',
    mods: { maxHp: 3 },
    hooks: {
      onTurnOrder(ctx) { ctx.playerFirst = false; },
    },
  },

  unfinished: {
    id: 'unfinished',
    name: 'Unfinished',
    desc: 'Heals 1 HP each turn you do not deal damage.',
    voice: 'I have not yet ~~finished~~ closed.',
    hooks: {
      onTurnEnd(ctx) {
        if (!ctx.tookDamageAction) ctx.heal(ctx.player, 1, 'a small mending');
      },
    },
  },

  thornlike: {
    id: 'thornlike',
    name: 'Thornlike',
    desc: 'When you take damage, the patient takes 1 back.',
    voice: 'I apologized. ~~Still.~~ It did not help.',
    hooks: {
      onDamageTaken(ctx) {
        if (ctx.amount > 0 && ctx.source === 'patient') {
          ctx.dealDamage(ctx.patient, 1, { source: 'thorn', silent: false });
        }
      },
    },
  },

  redacted: {
    id: 'redacted',
    name: '[[8]]',
    desc: 'You cannot be afflicted with KNOW. Damage you take is reduced by 1.',
    voice: 'The page is missing. I keep going.',
    hooks: {
      beforeStatusApplied(ctx) {
        if (ctx.statusKey === 'know' && ctx.target === ctx.player) ctx.prevent = true;
      },
      onDamageTaken(ctx) {
        if (ctx.amount > 0) ctx.amount = Math.max(0, ctx.amount - 1);
      },
    },
  },

  faithful: {
    id: 'faithful',
    name: 'Faithful',
    desc: 'Your signature can be used one additional time.',
    voice: 'I came here for a reason. ~~I forgot it.~~ I remember it.',
    hooks: {
      onEncounterStart(ctx) { if (ctx.player.signature) ctx.player.signature.usesLeft++; },
    },
  },

  bound: {
    id: 'bound',
    name: 'Bound',
    desc: 'BLEED you suffer ticks 1 less. BLEED you inflict ticks 1 more.',
    voice: 'I learned what holds. I learned what loosens.',
    hooks: {
      onBleedTick(ctx) {
        if (ctx.target === ctx.player) ctx.amount = Math.max(0, ctx.amount - 1);
        else                            ctx.amount += 1;
      },
    },
  },

  // signatures granted by wounds — kept in the same registry so the
  // engine can resolve them uniformly. Marked with isSignature: true.

  sig_amnesia: {
    id: 'sig_amnesia', name: 'I do not remember',
    desc: 'Once per fight: cleanse all your statuses, deal 0 damage.',
    voice: 'I forget what was being done to me.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        for (const k of Object.keys(ctx.player.statuses)) ctx.player.statuses[k] = 0;
        ctx.log({ text: 'I do not remember being held.', cls: 'flavor' });
      },
    },
  },

  sig_insomnia: {
    id: 'sig_insomnia', name: 'I have been awake',
    desc: 'Once per fight: take 2 actions this turn.',
    voice: 'I keep moving. I do not stop.',
    isSignature: true,
    hooks: {
      onSignature(ctx) { ctx.grantExtraAction = true; },
    },
  },

  sig_absence: {
    id: 'sig_absence', name: 'I was not there',
    desc: 'Once per fight: the patient\'s next pose fails outright.',
    voice: 'I close the door from the inside.',
    isSignature: true,
    hooks: {
      onSignature(ctx) { ctx.cancelNextPose = true; },
    },
  },

  sig_witness: {
    id: 'sig_witness', name: 'I see what is here',
    desc: 'Once per fight: reveal all of the patient\'s remaining queue + apply KNOW for 3 turns.',
    voice: 'I write it down. ~~It writes back.~~',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        ctx.revealAll = true;
        ctx.applyStatus(ctx.patient, 'know', 3);
      },
    },
  },

  sig_devotion: {
    id: 'sig_devotion', name: 'I am for them',
    desc: 'Once per fight: take 4 damage, deal 6 damage.',
    voice: 'I came here on purpose. I will leave on purpose.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        ctx.dealDamage(ctx.player,  4, { source: 'devotion' });
        ctx.dealDamage(ctx.patient, 6, { source: 'devotion' });
      },
    },
  },

  sig_hollow: {
    id: 'sig_hollow', name: 'I am hollow',
    desc: 'Once per fight: refill composure to 5 and heal 1.',
    voice: 'I empty out. The room rushes in.',
    isSignature: true,
    hooks: {
      onSignature(ctx) {
        ctx.player.composure = 5;
        ctx.heal(ctx.player, 1, 'the room rushes in');
      },
    },
  },
};

// Helpers used by the engine.
export function traitMods(trait) { return trait.mods || {}; }
export function traitHooks(trait) { return trait.hooks || {}; }
export function getTrait(id) { return TRAITS[id] || null; }

// Sum a numeric modifier across all the player's traits + wound.
export function sumMod(player, key) {
  let total = 0;
  for (const tid of player.traits || []) {
    const t = TRAITS[tid]; if (!t) continue;
    total += (t.mods && t.mods[key]) || 0;
  }
  // signature mods (rare; most signatures use hooks)
  if (player.signature && TRAITS[player.signature.id]) {
    total += (TRAITS[player.signature.id].mods && TRAITS[player.signature.id].mods[key]) || 0;
  }
  return total;
}

// Fire a named hook across all the player's traits + signature. Returns the
// (possibly mutated) ctx. Engine reads ctx.* after calling.
export function fireTraitHooks(player, hookName, ctx) {
  for (const tid of player.traits || []) {
    const t = TRAITS[tid]; if (!t || !t.hooks || !t.hooks[hookName]) continue;
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
