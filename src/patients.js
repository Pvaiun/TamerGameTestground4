// Patient encounter definitions. Each patient is a self-contained boss with
// its own mechanic, phases, dossier writing, and three branching resolutions.
//
// A patient definition exposes:
//   id, name, glyph, subtitle, pronoun, pronounObj, file (lines), intro,
//   role: 'wing'|'final', phases: [{ name, intro, hp, conditions }],
//   produceNextPose(patient, player, turn) → pose,
//   onSpeak(patient, player, mult)         → optional, custom speak effect,
//   checkPatientWin(patient, player)        → optional, alternate loss condition,
//   makeExtras()                            → optional, initial patient.extras,
//   resolutions: { soothe|hold|listen: { label, prose, trait } },
//   flavor: { press, strike, endure, listen, speak } → optional per-patient action narration.

import { applyStatus, dealDamage, heal } from './combat.js';
import { state } from './state.js';

const POSES = {};

function makePose(name, tell, effect) {
  return { name, tell, effect };
}

// helpers used by many patients
function patientApply(status, n) { return ctx => applyStatus(ctx.player, status, n); }
function patientDamage(amount) { return ctx => dealDamage(ctx.player, amount); }
function patientHealSelf(amount) { return ctx => heal(ctx.patient, amount, ctx.patient.def.flavor?.selfHeal); }
function patientStatusSelf(status, n) { return ctx => applyStatus(ctx.patient, status, n); }

// rotate through a pattern array deterministically by turn count
function rotate(pattern, turn) { return pattern[turn % pattern.length]; }

// ─── 1. THE EMPTY PRAM ─────────────────────────────────────────────────
//
// Mechanic: dual targets. She holds a pram. The pram has its own (low) hp.
// • damaging her enrages the pram (it cries — damages you)
// • damaging the pram causes her to grieve (she heals — also calms)
// You can't really "win" by burning either alone; you have to walk a line.
//
// Phase 2 enters when the pram's hp hits 0: it goes silent. She becomes
// the only target but her poses change — she's looking for something.

const pram = {
  id: 'pram',
  name: '[The Empty Pram]',
  glyph: 'Emberkin',
  subtitle: 'the mother has not left.',
  pronoun: 'she', pronounObj: 'her',
  role: 'wing', tier: 1,
  file: [
    'subject was admitted with a pram. the pram is empty.',
    'staff have not informed her [[12]]. she has not asked.',
    'asked when *it* could leave. corrected herself. !!she meant herself.!!',
  ],
  intro: 'the room is too quiet. the pram is between us. she has not put it down.',
  flavor: {
    press: 'I touch her wrist. she does not flinch.',
    strike: 'I strike her, hard. her arms hold tighter.',
    endure: 'I plant. I let the room hold me.',
    listen: 'I listen for the pram. ~~it is not breathing~~ it is not crying.',
    speak: 'I say her name. the one she would not have answered to.',
    selfHeal: 'she rocks. quietly. she is restored a little.',
  },
  makeExtras() { return { pramHp: 6, pramSilent: false }; },

  phases: [
    {
      name: 'rocking',
      intro: 'phase i · she rocks. she is humming something I do not know.',
      hp: 10,
      conditions: ['rocking'],
    },
    {
      name: 'looking',
      intro: 'phase ii · the pram has stopped. !!she is looking around the room.!!',
      hp: 12,
      conditions: ['looking'],
    },
  ],

  produceNextPose(patient, player, turn) {
    if (patient.phaseIdx === 0) {
      // rocking phase: alternates ROCK / HUM / ROCK / TUCK
      const pattern = ['rock', 'hum', 'rock', 'tuck', 'rock', 'hum'];
      const key = rotate(pattern, turn);
      if (key === 'rock') return makePose('ROCK',
        'she rocks. the pram squeaks. ~~something~~ nothing in it stirs.',
        ctx => { /* no effect — telegraph turn for the player */ });
      if (key === 'hum') return makePose('HUM',
        'she hums a few bars. quietly. familiar.',
        ctx => applyStatus(ctx.player, 'hush', 1));
      if (key === 'tuck') return makePose('TUCK',
        'she tucks the blanket. the pram makes a small sound.',
        ctx => {
          dealDamage(ctx.player, 1);
        });
    }
    // phase 1: looking
    if (patient.phaseIdx === 1) {
      const pattern = ['scan', 'reach', 'fold', 'scan', 'reach'];
      const key = rotate(pattern, turn);
      if (key === 'scan') return makePose('SCAN',
        'she scans the corners. she has not seen me. yet.',
        ctx => { applyStatus(ctx.player, 'know', 1); });
      if (key === 'reach') return makePose('REACH',
        'she reaches out. her hand is cold. her hand is mine.',
        ctx => dealDamage(ctx.player, 3));
      if (key === 'fold') return makePose('FOLD',
        'she folds the blanket. she folds it again. she folds it small.',
        ctx => { applyStatus(ctx.player, 'held', 1); heal(ctx.patient, 1); });
    }
    return makePose('WAIT', 'she does not move.', () => {});
  },

  // custom hooks so the dual-target mechanic feels real:
  onDamageTakenByPatient(patient, amount) {
    // called by combat when patient takes damage. lets the pram react.
    if (patient.phaseIdx === 0 && !patient.extras.pramSilent) {
      patient.extras.pramHp = Math.max(0, patient.extras.pramHp - 0);
      // damaging her: pram cries → small damage to player after a beat
      patient._pramReactionPending = { type: 'cry' };
    }
  },

  onSpeak(patient, player, mult) {
    if (patient.phaseIdx === 0) {
      // saying her name softens her: heal yourself for a little
      heal(player, 2, 'she answers. softly. ~~unwillingly~~ as if remembering.');
      applyStatus(patient, 'know', 1 * mult);
    } else {
      // phase 1: speaking the child's name. it cuts both ways.
      dealDamage(patient, 3);
      dealDamage(player, 1);
    }
  },

  resolutions: {
    soothe: {
      label: 'I take the pram. gently.',
      prose: 'I take the pram from her arms. she does not resist. the room exhales.\n\nshe looks at the empty blanket. she ~~knows~~ accepts. she lets it be empty.',
      trait: 'mothering',
    },
    hold: {
      label: 'I take her hands away from it.',
      prose: 'I close her hands inside mine. her arms go slack. the pram tips on the floor — it is light enough not to ~~scream~~ break.\n\nshe weeps without sound. she will not look at me. she will not look at it.',
      trait: 'empty_arms',
    },
    listen: {
      label: 'I sit with her. I do not take it.',
      prose: 'I sit beside her on the floor. the pram is between us. she rocks. she hums.\n\nafter a long time she says a name. it is not the one on the file.\n\nI write it down.',
      trait: 'inherited',
    },
  },
};

// ─── 2. PYRELORD ────────────────────────────────────────────────────────
//
// Mechanic: a patriarch who summons his daughters (phase 2). During phase 2
// he gets two poses per turn — his own and one of the daughters'. Daughters
// are weaker but persistent. He has to be brought down through three phases:
// commands → daughters → grief.

const pyrelord = {
  id: 'pyrelord',
  name: '[Pyrelord]',
  glyph: 'Pyrelord',
  subtitle: 'he still presides.',
  pronoun: 'he', pronounObj: 'him',
  role: 'wing', tier: 2,
  file: [
    'subject occupies the room as if it remains his.',
    'family report he has been deceased since ~~1986~~ longer.',
    'daughters visit. he **knows their names**.',
  ],
  intro: 'he is sitting in the chair as if he chose it. !!I did not choose this room.!!',
  flavor: {
    press: 'I push at his shoulder. he does not move.',
    strike: 'I strike him. the chair groans. ~~he~~ does not.',
    endure: 'I stand at the door. I do not approach.',
    listen: 'I listen. there are voices in the hallway. only mine in the room.',
    speak: 'I call him by his given name. ~~he does not turn~~ he turns.',
    selfHeal: 'he resumes. straighter than before.',
  },

  phases: [
    { name: 'commands',  intro: 'phase i · he speaks. the room becomes a room he is speaking in.', hp: 10, conditions: ['presiding'] },
    { name: 'daughters', intro: 'phase ii · !!they are at the door.!! his daughters. they let themselves in.', hp: 14, conditions: ['attended'] },
    { name: 'alone',     intro: 'phase iii · the door has closed behind them. he is small in the chair.', hp: 6, conditions: ['alone'] },
  ],

  produceNextPose(patient, player, turn) {
    if (patient.phaseIdx === 0) {
      const k = rotate(['dictate', 'command', 'dismiss', 'command'], turn);
      if (k === 'dictate') return makePose('DICTATE',
        'he speaks over me. my voice is not invited.',
        ctx => applyStatus(ctx.player, 'hush', 2));
      if (k === 'command') return makePose('COMMAND',
        'he gestures. I step back. ~~I~~ feel that.',
        ctx => dealDamage(ctx.player, 3));
      if (k === 'dismiss') return makePose('DISMISS',
        'he waves the air. I am ~~smaller~~ further from him.',
        ctx => { applyStatus(ctx.player, 'raw', 1); });
    }
    if (patient.phaseIdx === 1) {
      const k = rotate(['daughter', 'preside', 'daughter', 'family'], turn);
      if (k === 'daughter') return makePose('A DAUGHTER',
        'a daughter steps forward. she has his eyes. she pours.',
        ctx => dealDamage(ctx.player, 2));
      if (k === 'preside') return makePose('PRESIDE',
        'he watches them. they are watching me.',
        ctx => { applyStatus(ctx.player, 'know', 2); });
      if (k === 'family') return makePose('FAMILY',
        'they speak in unison. a meal is being remembered around me.',
        ctx => { applyStatus(ctx.player, 'hush', 2); dealDamage(ctx.player, 1); });
    }
    // phase 2: alone, weeping
    const k = rotate(['weep', 'pause', 'hand'], turn);
    if (k === 'weep') return makePose('WEEP',
      'he weeps without sound. the chair is too large.',
      ctx => { /* nothing — he is small */ });
    if (k === 'pause') return makePose('PAUSE',
      'he looks up. !!he is looking at me.!! he does not know who I am.',
      ctx => { applyStatus(ctx.player, 'raw', 1); });
    return makePose('HAND',
      'he reaches out. small. it is shaking.',
      ctx => dealDamage(ctx.player, 2));
  },

  resolutions: {
    soothe: {
      label: 'I close his eyes.',
      prose: 'I close his eyes with my hand. they were dry. he goes still in the chair.\n\nthe room is a room again.',
      trait: 'vessel_for_ghosts',
    },
    hold: {
      label: 'I sit in his chair.',
      prose: 'I lift him from the chair. he weighs almost nothing. I set him on the floor and I sit.\n\nthe chair fits me. the room does ~~not~~ resist.',
      trait: 'dominion',
    },
    listen: {
      label: 'I ask him his name.',
      prose: 'I kneel beside him. I ask. he gives a name. it is not the family\'s.\n\nI write it on the wall. !!the wall keeps it.!!',
      trait: 'forgotten_name',
    },
  },
};

// ─── 3. SOOTHLICK — THE NIGHT NURSE ────────────────────────────────────
//
// Mechanic: alternate loss condition. Most of her poses do little damage,
// but each one applies HELD. If HELD reaches 3, you sleep — and you lose.
// You can win by damaging her, but she heals. The combat is about staying
// awake.

const soothlick = {
  id: 'soothlick',
  name: '[Soothlick]',
  glyph: 'Soothlick',
  subtitle: 'other patients have stopped reporting it.',
  pronoun: 'she', pronounObj: 'her',
  role: 'wing', tier: 3,
  file: [
    'patient was a night nurse for ~~thirty~~ thirty-eight years.',
    'found in other patients\' rooms after lights-out. she does not turn the door handle.',
    'patients she has tended report **sleeping better**. they do not wake all the way.',
  ],
  intro: 'the lights have gone down. she is at the foot of the bed I do not remember lying in.',
  flavor: {
    press: 'I push her gently away. she yields a step.',
    strike: 'I strike her tray. vials. the sound is wrong.',
    endure: 'I sit up straighter. I count the ceiling tiles.',
    listen: 'I listen for her shoes. they make no sound.',
    speak: 'I say a name. not mine. !!hers.!!',
    selfHeal: 'she straightens her sleeves. she is restored.',
  },

  phases: [
    { name: 'pacing',  intro: 'phase i · she paces. it is a rhythm I want to follow.', hp: 8,  conditions: ['pacing'] },
    { name: 'tending', intro: 'phase ii · she is at my bedside.',                       hp: 10, conditions: ['tending'] },
  ],

  produceNextPose(patient, player, turn) {
    if (patient.phaseIdx === 0) {
      const k = rotate(['pace', 'hum', 'tend', 'pace'], turn);
      if (k === 'pace') return makePose('PACE',
        'she paces. ~~her shoes~~ the floor does not make a sound.',
        ctx => { heal(ctx.patient, 1, ''); });
      if (k === 'hum') return makePose('HUM',
        'she hums. the song is familiar in the wrong way.',
        ctx => applyStatus(ctx.player, 'hush', 2));
      if (k === 'tend') return makePose('TEND',
        'she pauses at my arm. she adjusts something.',
        ctx => applyStatus(ctx.player, 'held', 1));
    }
    const k = rotate(['tuck', 'tend', 'tuck', 'whisper', 'tend'], turn);
    if (k === 'tuck') return makePose('TUCK IN',
      'she pulls the blanket up to my shoulders. ~~I~~ welcome it.',
      ctx => { applyStatus(ctx.player, 'held', 1); dealDamage(ctx.player, 1); });
    if (k === 'tend') return makePose('TEND',
      'she straightens the sheet. she is very close.',
      ctx => applyStatus(ctx.player, 'held', 1));
    return makePose('WHISPER',
      'she whispers. ~~"sleep well."~~ "sleep."',
      ctx => { applyStatus(ctx.player, 'hush', 2); applyStatus(ctx.player, 'held', 1); });
  },

  checkPatientWin(patient, player) {
    if (player.statuses.held >= 3) {
      return { text: 'her hand on my forehead is cool. the room is going. ~~I am going~~ I am going.' };
    }
    return null;
  },

  onSpeak(patient, player, mult) {
    // saying her name wakes her — clears your HELD
    player.statuses.held = 0;
    applyStatus(patient, 'raw', 1 * mult);
  },

  resolutions: {
    soothe: {
      label: 'I let her tend me.',
      prose: 'I close my eyes. her hand is cool. I sleep — but in the sleep, I learn the rhythm of her hand.\n\nshe is in my fingers when I wake.',
      trait: 'calming',
    },
    hold: {
      label: 'I wake her.',
      prose: 'I take her hand from my face. I say her name. !!the one she does not answer to.!!\n\nshe looks up. she has been awake. she does not appear to know it.',
      trait: 'sleepless',
    },
    listen: {
      label: 'I ask her shift.',
      prose: 'I ask her when she came on. she says: ~~at seven~~ when I was needed.\n\nshe has been needed for a long time.',
      trait: 'vigilant',
    },
  },
};

// ─── 4. GLIMMER — the eight-year-old ───────────────────────────────────
//
// Mechanic: he stares at you. Each turn applies RAW. If you don't answer
// (SPEAK) often enough, his question comes due — a huge spike scaled by
// accumulated RAW stacks. SPEAK clears RAW.

const glimmer = {
  id: 'glimmer',
  name: '[Glimmerfox]',
  glyph: 'Glimmerfox',
  subtitle: 'he was eight. he doesn\'t blink.',
  pronoun: 'he', pronounObj: 'him',
  role: 'wing', tier: 3,
  file: [
    'patient was eight when it ran into the road.',
    'he watched. the rest of the family looked away. he ~~has not~~ cannot stop.',
    'subject sits at his feet. he pets it. **it has been forty years.**',
  ],
  intro: 'he is sitting on the floor of the room with his back to the wall. he has not blinked. he has not since I entered.',
  flavor: {
    press: 'I crouch and touch his shoulder.',
    strike: 'I strike at the air beside him. it is wrong to strike him. !!I cannot strike him.!!',
    endure: 'I sit on the floor. I match his eyes.',
    listen: 'I listen for whatever he is hearing. ~~the dog~~ a small breathing.',
    speak: 'I answer his question.',
    selfHeal: '',
  },

  phases: [
    { name: 'watching', intro: 'phase i · he is watching me. the question hasn\'t come yet.',   hp: 12, conditions: ['watching'] },
    { name: 'asking',   intro: 'phase ii · he asks: !!"will you stop me from looking?"!!',     hp: 8,  conditions: ['asking'] },
  ],

  makeExtras() { return { unanswered: 0 }; },

  produceNextPose(patient, player, turn) {
    if (patient.phaseIdx === 0) {
      const k = rotate(['stare', 'stare', 'lean', 'tilt'], turn);
      if (k === 'stare') return makePose('STARE',
        'he does not blink. ~~I~~ blink.',
        ctx => applyStatus(ctx.player, 'raw', 1));
      if (k === 'lean') return makePose('LEAN',
        'he leans forward. very slightly.',
        ctx => { applyStatus(ctx.player, 'raw', 1); dealDamage(ctx.player, 1); });
      return makePose('TILT',
        'he tilts his head. it is the question, almost.',
        ctx => applyStatus(ctx.player, 'know', 1));
    }
    // phase 1: he asks. each turn the question presses harder.
    patient.extras.unanswered = (patient.extras.unanswered || 0) + 1;
    const u = patient.extras.unanswered;
    return makePose('ASK',
      'he asks. ~~the same~~ a slightly different question. I have not answered.',
      ctx => {
        const stacks = ctx.player.statuses.raw || 0;
        const dmg = 1 + stacks;
        dealDamage(ctx.player, dmg);
        applyStatus(ctx.player, 'raw', 1);
      });
  },

  onSpeak(patient, player, mult) {
    // answering him calms him; clears your RAW; he loses HP
    const stacks = player.statuses.raw || 0;
    player.statuses.raw = 0;
    dealDamage(patient, 2 + stacks);
    patient.extras.unanswered = 0;
  },

  resolutions: {
    soothe: {
      label: 'I look away.',
      prose: 'I let my eyes go. I look at the floor where his dog is sitting.\n\nthe dog is not there. ~~he~~ I know it is not there.\n\nhe blinks. ~~once.~~',
      trait: 'unblinking',
    },
    hold: {
      label: 'I cover his eyes.',
      prose: 'I crouch and put my hand over his eyes. his eyelids close under my palm.\n\nthe room is suddenly larger. !!there is more of it.!!',
      trait: 'redacted',
    },
    listen: {
      label: 'I answer the question.',
      prose: 'I say: I will not stop you. I say: you are not at fault.\n\nI do not know if it is true. he accepts it as if it were.',
      trait: 'remembered',
    },
  },
};

// ─── 5. FROSTFIN — the bench ───────────────────────────────────────────
//
// Mechanic: she's mostly catatonic. Her presence drains your composure each
// turn (the room is cold). She rarely attacks. Phase 2: she begins to thaw —
// her poses are sharp. Phase 3: she takes your hand.

const frostfin = {
  id: 'frostfin',
  name: '[Frostfin]',
  glyph: 'Frostfin',
  subtitle: 'she was found on the bench after.',
  pronoun: 'she', pronounObj: 'her',
  role: 'wing', tier: 1,
  file: [
    'patient was located on the bench outside the train station.',
    'she had been there since her ~~husband~~ son said he would come.',
    'her hands have not warmed since. **staff do not hold them long.**',
  ],
  intro: 'the room is colder than the corridor was. she is sitting by the window. the window is dark.',
  flavor: {
    press: 'I touch her sleeve. it crackles.',
    strike: 'I strike at her — quickly, before I think. she does not turn.',
    endure: 'I stand by the door. I do not approach.',
    listen: 'I listen for what she is listening for.',
    speak: 'I say a name. !!I do not know whose.!!',
    selfHeal: 'she shifts her weight on the bench. she is restored, slightly.',
  },

  phases: [
    { name: 'waiting',  intro: 'phase i · she waits. the cold is a kind of patience.', hp: 8,  conditions: ['waiting'] },
    { name: 'noticing', intro: 'phase ii · !!she has noticed me.!!',                  hp: 10, conditions: ['noticing'] },
  ],

  produceNextPose(patient, player, turn) {
    if (patient.phaseIdx === 0) {
      const k = rotate(['cold', 'cold', 'wait', 'breath'], turn);
      if (k === 'cold') return makePose('THE COLD',
        'the room is colder. ~~my breath~~ is visible.',
        ctx => {
          ctx.player.composure = Math.max(0, ctx.player.composure - 1);
        });
      if (k === 'wait') return makePose('WAIT',
        'she waits. for him. ~~not me~~ not me.',
        ctx => { /* nothing */ });
      return makePose('BREATH',
        'she breathes out. small cloud. she does not breathe in.',
        ctx => applyStatus(ctx.player, 'hush', 1));
    }
    const k = rotate(['hand', 'look', 'turn', 'reach'], turn);
    if (k === 'hand') return makePose('HER HAND',
      'her hand is in mine. ~~I~~ did not offer it.',
      ctx => { dealDamage(ctx.player, 3); applyStatus(ctx.player, 'hush', 1); });
    if (k === 'look') return makePose('LOOK',
      'she looks at me. she is asking something with her face.',
      ctx => applyStatus(ctx.player, 'raw', 1));
    if (k === 'turn') return makePose('TURN',
      'she turns her head. her neck makes a small sound.',
      ctx => { applyStatus(ctx.player, 'know', 2); });
    return makePose('REACH',
      'she reaches. ~~she is reaching for him~~ she is reaching for me.',
      ctx => dealDamage(ctx.player, 4));
  },

  resolutions: {
    soothe: {
      label: 'I sit on the bench beside her.',
      prose: 'I sit. I do not speak. after a while she leans on me. she is heavy.\n\neventually I am also waiting. eventually I do not mind.',
      trait: 'patience',
    },
    hold: {
      label: 'I take her by the wrist.',
      prose: 'I get her up. she comes with me. she does not look back at the window.\n\nthe room warms by a degree.',
      trait: 'cold_hands',
    },
    listen: {
      label: 'I ask who she is waiting for.',
      prose: 'I ask. she says a name. ~~it is not the one in the file.~~ it is the one in the file.\n\nshe asks me if I have seen him. I have not.\n\nI say I will tell him.',
      trait: 'unfinished',
    },
  },
};

// ─── 6. MIRELING — the pond ────────────────────────────────────────────
//
// Mechanic: an approach counter. Each turn she gets one step closer. At step
// 4 she pulls you under. You can repel her with STRIKE (sets her back 1) or
// SPEAK (sets her back 2). LISTEN reveals her approach pattern.

const mire = {
  id: 'mire',
  name: '[Mireling]',
  glyph: 'Mireling',
  subtitle: 'there is no pond on the grounds.',
  pronoun: 'she', pronounObj: 'her',
  role: 'wing', tier: 3,
  file: [
    'patient asks staff about the pond on the grounds. there is no pond.',
    'she specifies a ~~stone~~ statue at the edge. none on file.',
    'family report she put **something** in a pond, once. they will not say what.',
  ],
  intro: 'the floor is wet. she is at the far wall. she is asking me about the pond.',
  flavor: {
    press: 'I push her shoulder. it is cold and wet.',
    strike: 'I strike, fast. she takes a step back.',
    endure: 'I stand my ground. the floor is wet.',
    listen: 'I listen for the pond. ~~I can hear it~~ I cannot hear it.',
    speak: 'I say the statue\'s name. ~~she does not know it~~ she remembers it.',
    selfHeal: 'she takes a step forward.',
  },
  makeExtras() { return { step: 0 }; },

  phases: [
    { name: 'approaching', intro: 'phase i · she is asking. she is also stepping closer.', hp: 14, conditions: ['approaching'] },
  ],

  produceNextPose(patient, player, turn) {
    patient.extras.step = (patient.extras.step || 0) + 1;
    const step = patient.extras.step;
    if (step >= 4) {
      return makePose('THE POND',
        '!!she is here. her hand is on my collar. the floor opens.!!',
        ctx => { dealDamage(ctx.player, 99); });
    }
    if (step === 3) {
      return makePose('STEP · iii',
        'she is very close. ~~I can feel~~ I cannot feel the floor under me.',
        ctx => { dealDamage(ctx.player, 3); applyStatus(ctx.player, 'raw', 1); });
    }
    if (step === 2) {
      return makePose('STEP · ii',
        'she is closer. she is asking again. ~~where is the pond?~~',
        ctx => { dealDamage(ctx.player, 2); applyStatus(ctx.player, 'hush', 1); });
    }
    return makePose('STEP · i',
      'she takes a step. it is patient. she has time.',
      ctx => { dealDamage(ctx.player, 1); });
  },

  onSpeak(patient, player, mult) {
    patient.extras.step = Math.max(0, (patient.extras.step || 0) - (2 * mult));
    dealDamage(patient, 3);
  },

  resolutions: {
    soothe: {
      label: 'I tell her where the pond is.',
      prose: 'I take her to the window. I show her the lawn. I say: !!it is here!!. she looks for a long time.\n\neventually she nods. she remembers it being there. she lets it be there.',
      trait: 'remembered',
    },
    hold: {
      label: 'I bar the door.',
      prose: 'I close the door behind us. I stand with my back to it. she does not push.\n\nafter a long time her shoes are dry.',
      trait: 'small_warmth',
    },
    listen: {
      label: 'I ask what she put in.',
      prose: 'I ask. she does not answer.\n\nI sit on the wet floor. I wait.\n\neventually, she tells me. ~~it is what I expected~~ it is not what I expected.\n\nI keep it.',
      trait: 'bound',
    },
  },
};

// ─── 7. HOLLOW — the lost daughter ─────────────────────────────────────
//
// Mechanic: each turn she asks "are you her?" — if you SPEAK she calms; if
// you don't, she escalates. Two phases.

const hollow = {
  id: 'hollow',
  name: '[Hollowoak]',
  glyph: 'Hollowoak',
  subtitle: 'she is sure she had a daughter.',
  pronoun: 'she', pronounObj: 'her',
  role: 'wing', tier: 2,
  file: [
    'patient cannot recall the name of ~~her daughter~~ the one she came in with.',
    'she has been told the room next door is empty. she continues to thank the staff for *the visits*.',
    'when asked her own name, she gave the orderly\'s. ~~**I** told her it was hers.~~',
  ],
  intro: 'she is at the door before I am inside. she has been waiting. ~~for me?~~ for me.',
  flavor: {
    press: 'I touch her hand. she catches it.',
    strike: 'I strike — gently. she does not perceive it.',
    endure: 'I take a half step back. I let her see me whole.',
    listen: 'I listen to what she is calling me.',
    speak: 'I say: !!yes. I am.!!',
    selfHeal: 'she resumes. she has not stopped.',
  },
  makeExtras() { return { silentTurns: 0 }; },

  phases: [
    { name: 'asking',     intro: 'phase i · she asks: ~~are you her?~~',                 hp: 9,  conditions: ['asking'] },
    { name: 'insisting',  intro: 'phase ii · !!she has decided I am.!!',                hp: 9,  conditions: ['insisting'] },
  ],

  produceNextPose(patient, player, turn) {
    const silent = patient.extras.silentTurns || 0;
    if (patient.phaseIdx === 0) {
      patient.extras.silentTurns = silent + 1;
      const k = rotate(['ask', 'reach', 'ask', 'wait'], turn);
      if (k === 'ask') return makePose('ASK',
        'she asks. softly. ~~are you her?~~',
        ctx => { dealDamage(ctx.player, silent); });
      if (k === 'reach') return makePose('REACH',
        'she lifts a hand to my face. her hand is paper.',
        ctx => { applyStatus(ctx.player, 'raw', 1); dealDamage(ctx.player, 1); });
      return makePose('WAIT',
        'she waits for me to answer. she has been patient.',
        ctx => { /* nothing */ });
    }
    const k = rotate(['embrace', 'speak', 'call', 'embrace'], turn);
    if (k === 'embrace') return makePose('EMBRACE',
      'she pulls me to her. she is stronger than I thought.',
      ctx => { dealDamage(ctx.player, 3); applyStatus(ctx.player, 'held', 1); });
    if (k === 'speak') return makePose('SPEAK',
      'she speaks the daughter\'s name. ~~it is~~ becomes mine.',
      ctx => { applyStatus(ctx.player, 'hush', 2); });
    return makePose('CALL',
      'she calls down the hallway. she is calling someone who is here.',
      ctx => { dealDamage(ctx.player, 2); });
  },

  onSpeak(patient, player, mult) {
    // saying yes calms her — clears your statuses, deals damage to her
    player.statuses.held = 0;
    player.statuses.raw = 0;
    patient.extras.silentTurns = 0;
    dealDamage(patient, 3);
  },

  resolutions: {
    soothe: {
      label: 'I am her. for as long as it takes.',
      prose: 'I am. I sit with her. she tells me about my childhood. I do not correct her.\n\nshe knows everything I have done. ~~I have done none of it.~~ I have done it all.',
      trait: 'faithful',
    },
    hold: {
      label: 'I tell her I am not.',
      prose: 'I say: I am not her. I say: she is not here.\n\nshe looks at me a long time. she does not weep. she does not argue.\n\nshe says: ~~I knew that~~. she sits down.',
      trait: 'redacted',
    },
    listen: {
      label: 'I ask about her.',
      prose: 'I ask: what was she like? she tells me. it takes a long time. some of it is happy.\n\nat the end she says her name. !!I write it down.!!',
      trait: 'remembered',
    },
  },
};

// ─── 8. COMPOSER ───────────────────────────────────────────────────────
//
// Mechanic: she queues a chord. Each turn a NOTE is added. After 4 notes,
// the chord releases — massive damage. SPEAK breaks one note (delays). STRIKE
// hits her but doesn't disrupt the chord. The trick: control the tempo.
//
// Phase 2: silent phase. The chord is in your head. You can finish her quick.

const composer = {
  id: 'composer',
  name: '[The Composer]',
  glyph: 'Halowyrm',
  subtitle: 'she has been writing the same chord for years.',
  pronoun: 'she', pronounObj: 'her',
  role: 'wing', tier: 3,
  file: [
    'patient has been composing in the day room since admission.',
    'staff have noticed: she does not write notes down. she ~~hums them~~ holds them.',
    'when interrupted she stares at the spot the music was in. !!she does not look up.!!',
  ],
  intro: 'she is at the upright piano. she has not touched the keys. she is humming.',
  flavor: {
    press: 'I touch her wrist. quietly. she does not stop humming.',
    strike: 'I strike at the piano. the lid drops. the room is suddenly louder.',
    endure: 'I stand at the side. I let the chord build around me.',
    listen: 'I listen for the chord. ~~I know it~~. !!I have always known it.!!',
    speak: 'I sing a note that does not fit.',
    selfHeal: 'she adds a note. the chord deepens.',
  },
  makeExtras() { return { notes: 0 }; },

  phases: [
    { name: 'composing', intro: 'phase i · she is composing. each turn the chord deepens.', hp: 12, conditions: ['composing'] },
    { name: 'silence',   intro: 'phase ii · she stops. the chord is in my head.',           hp: 6,  conditions: ['silence'] },
  ],

  produceNextPose(patient, player, turn) {
    if (patient.phaseIdx === 1) {
      const k = rotate(['ring', 'ring', 'pause'], turn);
      if (k === 'ring') return makePose('RING',
        'the chord plays. ~~in my head~~ everywhere.',
        ctx => { dealDamage(ctx.player, 2); applyStatus(ctx.player, 'raw', 1); });
      return makePose('PAUSE',
        'she breathes. she watches me. she is waiting for me to finish.',
        ctx => { /* free turn */ });
    }
    patient.extras.notes = (patient.extras.notes || 0) + 1;
    const n = patient.extras.notes;
    if (n >= 4) {
      patient.extras.notes = 0;
      return makePose('CHORD',
        '!!the chord lands. the room arranges itself around it.!!',
        ctx => { dealDamage(ctx.player, 6); applyStatus(ctx.player, 'hush', 2); });
    }
    return makePose(`NOTE · ${'i'.repeat(n)}`,
      `she adds a note. the room narrows by ${n}.`,
      ctx => { applyStatus(ctx.player, 'hush', 1); });
  },

  onSpeak(patient, player, mult) {
    // singing a wrong note: removes 2 notes from the chord
    patient.extras.notes = Math.max(0, (patient.extras.notes || 0) - 2 * mult);
    applyStatus(patient, 'raw', 1);
  },

  resolutions: {
    soothe: {
      label: 'I press the chord with her.',
      prose: 'I sit on the bench. I press the keys. she hums along.\n\nthe chord arrives. it is what she had been writing toward. she rests her hands.',
      trait: 'remembered',
    },
    hold: {
      label: 'I close the piano.',
      prose: 'I close the lid. her hands are still in the air. she leaves them there a while.\n\neventually she lets them down. ~~the chord~~ the room is quiet.',
      trait: 'sleepless',
    },
    listen: {
      label: 'I let her finish.',
      prose: 'I wait. she completes the chord. the room composes itself.\n\nshe nods. she has been waiting for someone to listen. she is also waiting to be done.',
      trait: 'unblinking',
    },
  },
};

// ─── FINAL — CHOIR ─────────────────────────────────────────────────────
//
// Mechanic: a synthesis fight. The choir performs poses borrowed from the
// patients you've already met. Phase 2: silence. Phase 3: only you.

const choir = {
  id: 'choir',
  name: '[The Choir]',
  glyph: 'Lumenpup',
  subtitle: 'they were here when I arrived. ~~they are~~ I am.',
  pronoun: 'they', pronounObj: 'them',
  role: 'final',
  file: [
    'the door at the top of the ward is open. there is a room I have not been in.',
    'inside: a long bench. on the bench, every patient I have met. and others I have not.',
    'they are singing. they are not singing for me. !!they have been singing the whole time.!!',
  ],
  intro: 'the choir is at the door. they are all looking at me. ~~one of them is me~~.',
  flavor: {
    press: 'I press a hand to the nearest. it does not flinch.',
    strike: 'I strike. one of them stops singing.',
    endure: 'I stand still. I let the chord move through me.',
    listen: 'I listen. ~~I hear myself in it~~ I hear myself in it.',
    speak: 'I sing.',
    selfHeal: 'one of them stands up. the choir straightens.',
  },

  phases: [
    { name: 'chorus',  intro: 'phase i · they sing in many voices. !!one of them is mine.!!', hp: 16, conditions: ['singing'] },
    { name: 'unison',  intro: 'phase ii · they sing in one voice. ~~it~~ is mine.',           hp: 12, conditions: ['unison'] },
    { name: 'silence', intro: 'phase iii · they have stopped. I am alone in the room.',       hp: 8,  conditions: ['alone'] },
  ],

  produceNextPose(patient, player, turn) {
    if (patient.phaseIdx === 0) {
      const k = rotate(['borrow_rock', 'borrow_dictate', 'borrow_hum', 'borrow_stare', 'borrow_cold'], turn);
      if (k === 'borrow_rock')    return makePose('ROCKING',  'a voice in the chorus is rocking. she has not put it down.',                  ctx => dealDamage(ctx.player, 2));
      if (k === 'borrow_dictate') return makePose('DICTATE',  'a voice is speaking over the others. he has not stopped.',                    ctx => applyStatus(ctx.player, 'hush', 2));
      if (k === 'borrow_hum')     return makePose('HUMMING',  'a voice is humming. ~~familiarly~~. I do not want to know.',                  ctx => applyStatus(ctx.player, 'held', 1));
      if (k === 'borrow_stare')   return makePose('STARING',  'a voice is staring. ~~at me~~ at me.',                                        ctx => applyStatus(ctx.player, 'raw', 1));
      return makePose('COLD',     'the room cools. one of them is from the bench.',                                                          ctx => { ctx.player.composure = Math.max(0, ctx.player.composure - 1); });
    }
    if (patient.phaseIdx === 1) {
      const k = rotate(['unison_a', 'unison_b', 'unison_c'], turn);
      if (k === 'unison_a') return makePose('UNISON · A',
        '!!they sing my name.!!',
        ctx => { dealDamage(ctx.player, 4); applyStatus(ctx.player, 'raw', 1); });
      if (k === 'unison_b') return makePose('UNISON · B',
        'they sing a name I am not sure is mine.',
        ctx => { dealDamage(ctx.player, 3); applyStatus(ctx.player, 'hush', 2); });
      return makePose('UNISON · C',
        'they sing my own voice back to me.',
        ctx => { dealDamage(ctx.player, 3); applyStatus(ctx.player, 'held', 1); });
    }
    const k = rotate(['echo', 'wait', 'echo'], turn);
    if (k === 'echo') return makePose('ECHO',
      'my voice. ~~not mine~~ mine. coming back from the wall.',
      ctx => dealDamage(ctx.player, 2));
    return makePose('WAIT',
      'the room is quiet. ~~I am quiet~~ I am quiet.',
      ctx => { /* nothing */ });
  },

  resolutions: {
    soothe: {
      label: 'I sing with them.',
      prose: 'I sing. the chord widens to include me. it has been waiting.\n\nI am the choir. the door is open. ~~I leave~~ I stay.\n\n!!I am discharged.!!',
      trait: 'remembered',
    },
    hold: {
      label: 'I shut the door.',
      prose: 'I take the door by its handle and I close it. the choir is on the other side. I can still hear them.\n\nI walk back the way I came. ~~the corridor~~ a different corridor. I leave my file at the desk.\n\nthe nurse takes it without looking.',
      trait: 'sleepless',
    },
    listen: {
      label: 'I take my voice out of it.',
      prose: 'I find my voice in the choir. I take it out. the chord is poorer for it.\n\nI walk past them with it. ~~they continue without me~~. they continue.\n\nI take the stairs.',
      trait: 'unfinished',
    },
  },
};

// ─── registry ──────────────────────────────────────────────────────────

export const PATIENTS = {
  pram, pyrelord, soothlick, glimmer, frostfin, mire, hollow, composer, choir,
};

export function getPatient(id) { return PATIENTS[id] || null; }
