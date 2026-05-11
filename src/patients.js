// Each patient is a small hand-authored module: their scales (hidden axes),
// their verbs (with branched authored responses), their drift (what happens
// when the player WAITS), their endings (the first matching one fires).
//
// The combat engine in src/combat.js dispatches to these. All texture lives
// here.

import { randi, pick } from './rng.js';

// utilities used by every patient — keeps the per-patient code lean.
function r(min, max) { return randi(min, max); }

// ════════════════════════════════════════════════════════════════════════
// THE EMPTY PRAM — Patient 0028
// ════════════════════════════════════════════════════════════════════════
//
// Scales:
//   tenderness — how much warmth she lets in (0-5)
//   grip — how tightly she holds the pram (0-5, starts high)
//   lucidity — how present she is, vs. somewhere else (0-5)
//
// Verbs feel different at different scale combinations. Rocking with her
// builds tenderness slowly. Touching the blanket interrupts: if grip is
// high, it spikes her (tenderness drops); if grip is loose, she lets you
// closer. Naming the child can shatter her if grip is high — or let her
// see the present if grip has eased. Taking the pram is force; how she
// took it determines what trait you carry from the room.

const pram = {
  id: 'pram',
  name: '[The Empty Pram]',
  glyph: 'Emberkin',
  subtitle: 'the mother has not left.',
  role: 'wing', tier: 1,
  file: [
    'subject was admitted with a pram. the pram is empty.',
    'staff have not informed her [[12]]. she has not asked.',
    'asked when *it* could leave. corrected herself. !!she meant herself.!!',
  ],
  intro: [
    'the door is half-open. she does not look up when I come in. she is sitting on the chair by the window with the pram between her knees.',
    'I close the door. she rocks the pram by the handle. the wheels do not turn.',
  ],

  scales: {
    tenderness: { initial: 1, min: 0, max: 5, label: 'tenderness' },
    grip:       { initial: 4, min: 0, max: 5, label: 'grip' },
    lucidity:   { initial: 0, min: 0, max: 5, label: 'lucidity' },
  },
  initialize(patient, player) {
    // slight variance so the optimal path shifts run to run
    patient.scales.tenderness = r(0, 2);
    patient.scales.grip       = r(3, 5);
    patient.scales.lucidity   = 0;
    // scar interactions: if the player took the pram from someone before,
    // she starts colder.
    if (player.scars?.includes('taken')) patient.scales.tenderness = Math.max(0, patient.scales.tenderness - 1);
    if (player.scars?.includes('abandoned')) patient.scales.grip = Math.min(5, patient.scales.grip + 1);
  },

  // presented(): a short composed sentence summarizing how she looks right
  // now. Three clauses, each tied to one scale. The player reads this each
  // turn — there is no pose preview.
  presented(p) {
    const t = p.scales.tenderness;
    const g = p.scales.grip;
    const l = p.scales.lucidity;
    const rockClause =
      g >= 4 ? 'she rocks the pram quickly. her arms are tight.' :
      g >= 2 ? 'she rocks the pram. steady. the wheels do not turn.' :
      g >= 1 ? 'her hands rest on the pram. she has stopped rocking.' :
               'her hands are open. the pram is between her feet.';
    const handsClause =
      l >= 4 ? 'her eyes are on me. on me.' :
      l >= 2 ? 'her eyes find the middle distance.' :
               'she does not look up.';
    const warmthClause =
      t >= 4 ? 'she has been waiting for someone. ~~me~~ for someone.' :
      t >= 2 ? 'her shoulders are not so tight.' :
      t >= 1 ? 'she hums, sometimes. quietly.' : null;
    return [rockClause, handsClause, warmthClause].filter(Boolean).join(' ');
  },

  verbs: {
    rock_with_her: {
      label: 'rock with her',
      desc: 'sit on the floor and match her tempo.',
      cost: 0,
      respond(p, player) {
        const g = p.scales.grip;
        const t = p.scales.tenderness;
        if (g >= 4) {
          return {
            lines: [
              'I sit on the floor beside her. I match her tempo.',
              'she does not slow. she does not speed. she does not look at me.',
              'minutes pass. then more.',
              '(I have given her some of my quiet. she has not yet given any back.)',
            ],
            scales: { tenderness: +1 },
            composure: -1,
          };
        }
        if (t >= 3) {
          return {
            lines: [
              'I sit. I rock alongside her.',
              'her shoulders drop. her humming finds my shoulder. she lets me in a little.',
              '(tenderness rises. her grip eases.)',
            ],
            scales: { tenderness: +1, grip: -1 },
          };
        }
        return {
          lines: [
            'I sit. the rhythm catches me before I find it.',
            'she does not stop. she does not slow. but after a while she is rocking with me, not despite me.',
            '(tenderness rises.)',
          ],
          scales: { tenderness: +1 },
        };
      },
    },

    touch_blanket: {
      label: 'touch the blanket',
      desc: 'lay a hand on the bundle. gentle.',
      cost: 0,
      respond(p, player) {
        const g = p.scales.grip;
        const t = p.scales.tenderness;
        if (g >= 4 && t <= 1) {
          return {
            lines: [
              '!!she snatches my hand away.!!',
              'she pulls the pram against her chest. she will not look at me. her humming is gone now.',
              '(tenderness falls. her grip whitens.)',
            ],
            scales: { tenderness: -1, grip: +1 },
            composure: -1,
          };
        }
        if (g >= 3) {
          return {
            lines: [
              'my hand rests on the blanket. it is cold under my palm.',
              'she stiffens. she does not lift her own hands away — but she watches mine. carefully.',
              '(she is paying attention now.)',
            ],
            scales: { grip: -1 },
          };
        }
        // grip is loose. an intimate moment.
        return {
          lines: [
            'my hand on the blanket. the blanket is folded over what is not there.',
            'she looks at my hand. then at me. she does not pull away.',
            '(her grip eases. she is seeing me, briefly.)',
          ],
          scales: { grip: -1, lucidity: +1 },
        };
      },
    },

    name_the_child: {
      label: 'name the child',
      desc: 'speak a name. ~~yours.~~ someone\'s.',
      cost: 1,
      respond(p, player) {
        const g = p.scales.grip;
        const l = p.scales.lucidity;
        const t = p.scales.tenderness;
        if (g >= 4) {
          // catastrophic — naming the child before she has loosened her grip
          // forces her further away.
          return {
            lines: [
              'I say a name. ~~mine.~~ a name.',
              'she does not look at me. her arms cinch. her humming stops. somewhere behind her eyes she is leaving the room.',
              '!!she will not come back from this soon.!!',
              '(her grip locks. tenderness falls. she is gone from me.)',
            ],
            scales: { grip: +1, tenderness: -2, lucidity: -1 },
            composure: -1,
            flags: { spiked: true },
          };
        }
        if (l >= 2 || t >= 3) {
          // she can hear it
          return {
            lines: [
              'I say a name. it is one I half-remember.',
              'she repeats it. quietly. she turns it in her mouth like a stone.',
              'she looks at the pram. she looks at me. ~~she sees~~ she sees.',
              '(lucidity surges. her grip eases. tenderness holds.)',
            ],
            scales: { lucidity: +2, grip: -1 },
          };
        }
        // intermediate — she hears, partly
        return {
          lines: [
            'I say a name. she does not answer to it. but she looks up.',
            'her eyes are not all the way here. but they are not all the way gone, either.',
            '(lucidity rises. she does not let go.)',
          ],
          scales: { lucidity: +1 },
        };
      },
    },

    look_inside: {
      label: 'look inside',
      desc: 'lift the blanket. see what is there.',
      cost: 2,
      respond(p, player) {
        const g = p.scales.grip;
        const t = p.scales.tenderness;
        if (g >= 3) {
          // she will not let you. composure already spent. small backlash.
          return {
            lines: [
              'I reach. she puts her hand on top of mine. she says: !!not yet.!!',
              'she says it as if she has said it before, to someone else. her eyes have not changed.',
              '(her grip holds. she is still in the past somewhere.)',
            ],
            scales: { grip: -1 },
            composure: -1,
          };
        }
        // she lets you. you both see.
        return {
          lines: [
            'I lift the corner of the blanket. she does not stop me.',
            'the blanket has been folded over itself. neatly. there is nothing else under it.',
            'she watches my face. she is watching to see if I will pretend.',
            '~~I do not pretend.~~ I do not pretend.',
            '(lucidity rises. her grip falls. tenderness holds.)',
          ],
          scales: { lucidity: +2, grip: -1 },
        };
      },
    },

    take_pram: {
      label: 'take the pram',
      desc: 'lift it out of her hands.',
      cost: 2,
      respond(p, player) {
        // This verb commits immediately. It doesn't end the encounter on
        // its own — the endings registry reads the scales after.
        return {
          lines: [
            'I close my hands over the handle. her hands are over the handle. I lift.',
            'she resists, for a moment. then her hands let go.',
            '(I am holding the pram now. she is not.)',
          ],
          scales: { grip: -5 },          // forcibly broken
          flags: { took_pram: true },
        };
      },
    },
  },

  // WAIT drift. She acts on her own. The drift varies with her state.
  drift(p, player) {
    const g = p.scales.grip;
    const t = p.scales.tenderness;
    const l = p.scales.lucidity;
    // If grip is loose and tenderness mid, lucidity stirs on its own.
    if (g <= 2 && t >= 2 && l < 4) {
      return {
        lines: [
          'I wait. she rocks. she hums a half-bar. she stops.',
          'her eyes leave the pram. she watches the wall. her hands forget the rhythm, briefly.',
          '(lucidity stirs.)',
        ],
        scales: { lucidity: +1 },
      };
    }
    // If high grip, she settles further in.
    if (g >= 4) {
      const variants = [
        ['I wait. she rocks faster. she sees nothing in the room — not me, not the wall.', '(her grip holds.)'],
        ['I wait. she begins to hum. the same few bars, over and over. her arms do not tire.', '(her grip holds.)'],
        ['I wait. she tucks the blanket in. she tucks it in again.', '(her grip holds.)'],
      ];
      return { lines: pick(variants) };
    }
    // Mid state — small drift either way.
    const choices = [
      {
        lines: ['I wait. she rocks. nothing changes. ~~a long time~~ a while passes.'],
        scales: {},
      },
      {
        lines: ['she pauses. she looks at the pram, sidelong, like she has just remembered something.', '(lucidity stirs.)'],
        scales: { lucidity: +1 },
      },
      {
        lines: ['she rocks faster. then slower. her arms are stiff.', '(her grip rises.)'],
        scales: { grip: +1 },
      },
    ];
    return pick(choices);
  },

  // Endings — first matching fires. Order matters.
  endings: [
    {
      id: 'broke',
      when: (p) => p.flags.spiked && p.scales.tenderness <= 0 && p.scales.lucidity <= 0,
      title: 'she breaks',
      lines: [
        'she is rocking and rocking. she does not see me. she does not see the room.',
        'she has gone somewhere I cannot follow. the pram is in her arms still.',
        '!!I close the door behind me. softly. she does not notice.!!',
      ],
      trait: null,
      scars: ['witnessed'],
    },
    {
      id: 'lets_go',
      when: (p) => p.scales.lucidity >= 4,
      title: 'she lets it go herself',
      lines: [
        'she looks at the pram. she looks at me. ~~she sees~~ she sees what is there.',
        'she lifts the blanket. she folds it. she folds it again. she sets it on the seat of the pram.',
        'she puts her hands in her lap. she does not weep. she sits a long time without rocking.',
      ],
      trait: 'inherited',
    },
    {
      id: 'lets_take',
      when: (p) => p.scales.tenderness >= 4 && p.scales.grip <= 1 && !p.flags.took_pram,
      title: 'she lets you take it',
      lines: [
        'she lifts the bundle out of the pram. she puts it in my arms. she is careful with what is not there.',
        'her hands stay open for a long time after. she does not put them down.',
        '!!the room is very quiet.!!',
      ],
      trait: 'mothering',
    },
    {
      id: 'forced',
      when: (p) => p.flags.took_pram,
      title: 'you take it from her',
      // What this becomes depends on whether she was already calm or you ripped it from her.
      lines(p) {
        if (p.scales.tenderness >= 3) {
          return [
            'I have the pram. she lets me. she does not look at me.',
            'her hands are open. she does not know what to do with them.',
            '(she will be alright. ~~probably.~~ she will be.)',
          ];
        }
        return [
          'I have the pram. she did not let me. her hands are still in the shape of the handle.',
          'she weeps without sound. she will not look at me.',
          '!!I close the door behind me. she does not stop rocking.!!',
        ];
      },
      trait: 'empty_arms',
      scars(p) { return p.scales.tenderness >= 3 ? [] : ['taken']; },
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: [
        'I close the door. she keeps rocking. I do not know if she ever knew I was in the room.',
      ],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// PYRELORD — Patient 0091
// ════════════════════════════════════════════════════════════════════════
//
// The patriarch in the chair. Scales:
//   presence — whose room this is (0-5; high = his, low = yours)
//   grief    — unexpressed grief building up (0-5)
//   recognition — does he see you, or the daughter / son / wife? (0-5)

const pyrelord = {
  id: 'pyrelord',
  name: '[Pyrelord]',
  glyph: 'Pyrelord',
  subtitle: 'he still presides.',
  role: 'wing', tier: 2,
  file: [
    'subject occupies the room as if it remains his.',
    'family report he has been deceased since ~~1986~~ longer.',
    'daughters visit. he **knows their names**.',
  ],
  intro: [
    'he is in the chair. he was in the chair when I came in. ~~he chose it~~ I did not choose this room.',
    'he is looking at the door. he is waiting for someone. he does not seem to see me yet.',
  ],

  scales: {
    presence:    { initial: 4, min: 0, max: 5, label: 'presence' },
    grief:       { initial: 1, min: 0, max: 5, label: 'grief' },
    recognition: { initial: 0, min: 0, max: 5, label: 'recognition' },
  },
  initialize(p) {
    p.scales.presence    = r(3, 5);
    p.scales.grief       = r(0, 2);
    p.scales.recognition = 0;
  },

  presented(p) {
    const pr = p.scales.presence;
    const g  = p.scales.grief;
    const r  = p.scales.recognition;
    const chair =
      pr >= 4 ? 'he sits in the chair as if it has always been his.' :
      pr >= 2 ? 'he sits in the chair. less easily than before.' :
                'he is small in the chair. it does not fit him.';
    const eyes =
      r >= 4 ? 'his eyes are on me. he knows it is me.' :
      r >= 2 ? 'his eyes find me, sometimes. then leave.' :
               'he is looking at someone who is not in the room.';
    const hands =
      g >= 4 ? 'his hands are clasped, knuckles white.' :
      g >= 2 ? 'his hands are folded in his lap.' :
               'his hands are at rest on the arms of the chair.';
    return `${chair} ${eyes} ${hands}`;
  },

  verbs: {
    kneel: {
      label: 'kneel',
      desc: 'put yourself lower than him. acknowledge.',
      cost: 1,
      respond(p) {
        if (p.scales.presence >= 4) {
          return {
            lines: [
              'I kneel beside the chair. I look up at him.',
              'he does not look down. he is satisfied this is the correct shape of a room.',
              '(presence rises. ~~his~~ his right to it is reinforced.)',
            ],
            scales: { presence: +1 },
            composure: -1,
          };
        }
        return {
          lines: [
            'I kneel. he does not understand why.',
            'after a moment he reaches out and pats my shoulder. he calls me by a name. ~~it is not mine.~~',
            '(recognition wavers. grief stirs.)',
          ],
          scales: { recognition: +1, grief: +1 },
        };
      },
    },

    interrupt: {
      label: 'speak over him',
      desc: 'cut into whatever he is saying. take the air.',
      cost: 1,
      respond(p) {
        if (p.scales.presence >= 4) {
          return {
            lines: [
              'I speak over him. !!loudly.!!',
              'he stops. he looks at me. for the first time he is not above the room. for a moment he is just in it.',
              '(presence drops. recognition rises.)',
            ],
            scales: { presence: -1, recognition: +1 },
          };
        }
        return {
          lines: [
            'I speak over him. he does not protest.',
            'he was not saying anything I had not heard. he was saying it to no one in particular.',
            '(presence drops. grief stirs.)',
          ],
          scales: { presence: -1, grief: +1 },
        };
      },
    },

    call_by_name: {
      label: 'call him by name',
      desc: 'use his given name. not "father", not "sir".',
      cost: 2,
      respond(p) {
        if (p.scales.recognition >= 2) {
          return {
            lines: [
              'I say it. his given name. the one his mother used.',
              'he turns toward me. all the way. ~~he is here.~~ he is here.',
              'his eyes fill. he does not speak.',
              '(recognition surges. grief surges. presence falls.)',
            ],
            scales: { recognition: +2, grief: +2, presence: -1 },
          };
        }
        return {
          lines: [
            'I say it. his given name.',
            'he frowns. he is trying to remember if anyone calls him that.',
            'something passes through him.',
            '(recognition rises. grief stirs.)',
          ],
          scales: { recognition: +1, grief: +1 },
        };
      },
    },

    sit_in_chair: {
      label: 'sit in the chair',
      desc: 'claim the room. lift him out if you have to.',
      cost: 2,
      respond(p) {
        if (p.scales.presence <= 1) {
          return {
            lines: [
              'I help him out of the chair. he is light. he goes without protest.',
              'I sit. the chair fits. the room composes itself around me.',
              'he stands a while, then sits on the floor at my feet, like a guest.',
              '!!the room is mine now.!!',
            ],
            scales: { presence: -5 },
            flags: { sat_in_chair: true },
          };
        }
        return {
          lines: [
            'I take his arm to lift him. he plants his weight.',
            'his hand on my wrist is very cold.',
            '~~I do not~~ I do not force it. not yet.',
            '(presence holds. his grip on the chair holds.)',
          ],
          composure: -1,
        };
      },
    },

    close_his_eyes: {
      label: 'close his eyes',
      desc: 'lay a hand over them. let him stop watching the door.',
      cost: 2,
      respond(p) {
        if (p.scales.grief >= 3) {
          return {
            lines: [
              'I close his eyes with my palm. his lashes are dry.',
              'he does not resist. ~~he~~ a long held breath leaves him.',
              'the chair is suddenly too large.',
              '!!the room is a room again.!!',
            ],
            flags: { closed_eyes: true },
            scales: { presence: -3, grief: -2 },
          };
        }
        return {
          lines: [
            'I reach. he flinches. he is still watching the door for someone.',
            'I lower my hand. !!not yet.!!',
            '(grief stirs.)',
          ],
          scales: { grief: +1 },
          composure: -1,
        };
      },
    },
  },

  drift(p) {
    const pr = p.scales.presence;
    const r = p.scales.recognition;
    if (pr >= 4) {
      const variants = [
        ['I wait. he is speaking. he is dictating something to a clerk who is not in the room.', '(presence holds.)'],
        ['I wait. someone (a daughter?) knocks at the door, briefly. she does not come in. he nods, as if she had.', '(presence holds.)'],
        ['I wait. he is recounting a victory. it is one I have not heard before. it might be true.', '(presence holds.)'],
      ];
      return { lines: pick(variants) };
    }
    if (r >= 3) {
      return {
        lines: [
          'I wait. he turns slowly to look at me.',
          'he says: ~~when did you come in?~~ when did you come in?',
          '(recognition holds. grief stirs.)',
        ],
        scales: { grief: +1 },
      };
    }
    return {
      lines: [
        'I wait. the room is still. ~~someone is~~ no one is at the door.',
      ],
      scales: { presence: -1 },
    };
  },

  endings: [
    {
      id: 'close_eyes',
      when: (p) => p.flags.closed_eyes && p.scales.grief <= 2,
      title: 'you let him rest',
      lines: [
        'he is gone. his hands are open in his lap.',
        'the room is a room. the chair is just a chair.',
        '!!the door does not need to be watched.!!',
      ],
      trait: 'vessel_for_ghosts',
    },
    {
      id: 'took_chair',
      when: (p) => p.flags.sat_in_chair,
      title: 'you take his place',
      lines: [
        'the chair fits. the room is mine. he is on the floor still.',
        'he calls me sir, once, without irony. ~~I do not~~ I do not correct him.',
      ],
      trait: 'dominion',
      scars: ['named'],
    },
    {
      id: 'name_kept',
      when: (p) => p.scales.recognition >= 4 && p.scales.grief >= 3,
      title: 'you keep his name',
      lines: [
        'I write his name on the wall. he watches me do it. he does not stop me.',
        'I leave the room with the name in my mouth. he sits very still in the chair.',
        '!!the wall keeps it.!!',
      ],
      trait: 'forgotten_name',
    },
    {
      id: 'walks_out',
      when: (p) => p.scales.presence >= 5 && p.turn > 5,
      title: 'he outlasts you',
      lines: [
        'he is in the chair. he has always been in the chair. I cannot find an edge to begin from.',
        '!!I leave him to it. the door is heavier than I expected.!!',
      ],
      trait: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. he was speaking when I left. ~~he kept speaking.~~ he kept speaking.'],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// SOOTHLICK — Patient 0042 (the night nurse)
// ════════════════════════════════════════════════════════════════════════
//
// She wants to tend you. Her tending is sleep — your sleep — which is also
// a kind of staying-here. The danger is on the player side: drowsing rises
// from her attention, your inattention, your willingness to be tended.
//
//   tending — how committed she is to her ministrations (0-5)
//   sight   — how clearly she sees that this is now, not 1972 (0-5)
//   drowsing — player effect, in patient.playerEffects.drowsing. at 3 you sleep.

const soothlick = {
  id: 'soothlick',
  name: '[Soothlick]',
  glyph: 'Soothlick',
  subtitle: 'other patients have stopped reporting it.',
  role: 'wing', tier: 2,
  file: [
    'patient was a night nurse for ~~thirty~~ thirty-eight years.',
    'found in other patients\' rooms after lights-out. she does not turn the door handle.',
    'patients she has tended report **sleeping better**. they do not wake all the way.',
  ],
  intro: [
    'the lights have gone down. the room is dim in a way I do not remember being dim a minute ago.',
    'she is at the foot of a bed. ~~mine~~ a bed. she is straightening a sheet. she has not looked at me yet.',
  ],

  scales: {
    tending: { initial: 2, min: 0, max: 5, label: 'tending' },
    sight:   { initial: 0, min: 0, max: 5, label: 'sight' },
  },
  initialize(p, player) {
    p.scales.tending = r(1, 3);
    p.scales.sight = 0;
    p.playerEffects.drowsing = 0;
    if (player.scars?.includes('witnessed')) p.scales.tending = Math.min(5, p.scales.tending + 1);
  },

  presented(p) {
    const t = p.scales.tending;
    const s = p.scales.sight;
    const dr = p.playerEffects.drowsing || 0;
    const work =
      t >= 4 ? 'she is at the bedside. she is doing the work she came to do.' :
      t >= 2 ? 'she is pacing. her hands keep finding things to fix.' :
               'she has stopped. she is at the door.';
    const eyes =
      s >= 4 ? 'her eyes are on me. she knows what year it is now.' :
      s >= 2 ? 'her eyes find me sometimes. she is not sure who she is tending.' :
               'her eyes are on her work. they are not on me.';
    const sleep =
      dr >= 2 ? '~~the room is~~ the room is heavier than it was.' :
      dr >= 1 ? 'the room is very warm.' :
                'the room is cold.';
    return `${work} ${eyes} ${sleep}`;
  },

  verbs: {
    accept_tending: {
      label: 'accept her tending',
      desc: 'let her straighten you. close your eyes a moment.',
      cost: 0,
      respond(p, player) {
        const t = p.scales.tending;
        return {
          lines: [
            'I let her hand cool my forehead. her fingers smell of paper and bleach.',
            t >= 3
              ? 'she hums something soft. she has done this a long time. she is good at it.'
              : 'her hand is unsteady. she is not sure she remembers how this part goes.',
            '(drowsing rises. tenderness — hers — rises.)',
          ],
          playerEffects: { drowsing: +1 },
          scales: { tending: +1 },
        };
      },
    },

    refuse_tray: {
      label: 'refuse the tray',
      desc: 'wave her off. push it back.',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I wave her off. I say: !!I do not need this.!!',
            'she sets the tray down anyway. her face does not change.',
            'but she does not press. her hands go back to her sides.',
            '(tending falls. drowsing eases.)',
          ],
          scales: { tending: -1 },
          playerEffects: { drowsing: -1 },
          composure: -1,
        };
      },
    },

    ask_about_shift: {
      label: 'ask about her shift',
      desc: 'ground her in now. ask when she came on.',
      cost: 1,
      respond(p) {
        if (p.scales.sight >= 2) {
          return {
            lines: [
              'I ask: when did you come on?',
              'she answers without thinking: !!seven.!! then she stops. she looks at the dark window. ~~a long time ago~~ a long time ago.',
              '(sight surges. tending falters.)',
            ],
            scales: { sight: +2, tending: -1 },
          };
        }
        return {
          lines: [
            'I ask: when did you come on?',
            'she says: at seven. she says it the way she always says it. she does not look at the clock.',
            'something passes behind her eyes — briefly.',
            '(sight stirs.)',
          ],
          scales: { sight: +1 },
        };
      },
    },

    break_a_vial: {
      label: 'break a vial',
      desc: 'sweep the tray. shock her.',
      cost: 2,
      respond(p) {
        return {
          lines: [
            'I sweep my hand across her tray. a vial breaks. the noise is very loud in the room.',
            'she stares at the floor. her hands shake. her face is the face of someone who has lost something irreplaceable.',
            '!!I should not have done this.!!',
            '(sight surges. tending surges. drowsing eases.)',
          ],
          scales: { sight: +2, tending: +1 },
          playerEffects: { drowsing: -1 },
          composure: -1,
          shake: true,
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: 'use the name on her file. not "nurse".',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I say her name. ~~the one she does not~~ the one on her file.',
            p.scales.sight >= 3
              ? 'she answers to it. she says: yes? she has not been spoken to in a while.'
              : 'she does not turn. she goes on straightening the sheet, but slowly. it is a name she half-recognizes.',
            '(sight rises.)',
          ],
          scales: { sight: +1 },
        };
      },
    },
  },

  drift(p) {
    p.playerEffects.drowsing = Math.min(3, (p.playerEffects.drowsing || 0) + 1);
    const dr = p.playerEffects.drowsing;
    if (dr >= 3) {
      return {
        lines: [
          'I wait. her hand finds my forehead. ~~I close~~ I close my eyes.',
          'I am very warm. the room is very dim. the bed is very soft. I have been awake a long time.',
        ],
      };
    }
    if (dr >= 2) {
      return {
        lines: [
          'I wait. she straightens the sheet under my chin. her humming is the sound the room makes.',
          '(drowsing rises.)',
        ],
      };
    }
    return {
      lines: [
        'I wait. her shoes make no sound on the floor.',
        '(drowsing rises.)',
      ],
    };
  },

  endings: [
    {
      id: 'sleep',
      when: (p) => (p.playerEffects.drowsing || 0) >= 3,
      title: 'she tends you to sleep',
      lines: [
        'her hand is cool on my forehead. her humming is the sound the room makes.',
        '~~I~~ I close my eyes. when I open them I am still here. ~~but I have~~ but I have lost something I cannot find again.',
        '!!I do not know how long I was gone.!!',
      ],
      trait: 'calming',
      scars: ['witnessed'],
    },
    {
      id: 'woken',
      when: (p) => p.scales.sight >= 4 && p.scales.tending <= 1,
      title: 'you wake her',
      lines: [
        'she looks at the clock. she looks at me. her face is a face that has been awake too long.',
        'she says: ~~I should have gone home~~ I should have gone home.',
        'she sits down on the floor. she does not put down the tray.',
      ],
      trait: 'sleepless',
    },
    {
      id: 'vigil_kept',
      when: (p) => p.scales.sight >= 3 && p.scales.tending >= 3,
      title: 'you keep her vigil',
      lines: [
        'I sit with her at the bedside. she shows me how to do it.',
        'we straighten sheets for someone who is not in the bed. it takes a long time. ~~hours.~~ hours.',
        '!!she lets me leave when the light comes back.!!',
      ],
      trait: 'vigilant',
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: [
        'I close the door. she is still straightening the sheet. ~~for someone who is not~~ for someone.',
      ],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// GLIMMER — Patient 0157 (the eight-year-old)
// ════════════════════════════════════════════════════════════════════════
//
//   stare — his fixed look (0-5)
//   question — the unasked thing pressing forward (0-5)
//   present — does he see you, or the dog, or his sister? (0-5)

const glimmer = {
  id: 'glimmer',
  name: '[Glimmerfox]',
  glyph: 'Glimmerfox',
  subtitle: 'he was eight. he doesn\'t blink.',
  role: 'wing', tier: 3,
  file: [
    'patient was eight when it ran into the road.',
    'he watched. the rest of the family looked away. he ~~has not~~ cannot stop.',
    'subject sits at his feet. he pets it. **it has been forty years.**',
  ],
  intro: [
    'he is on the floor by the wall. he has not stood up. his hand is on something at his side that is not there.',
    'his eyes are open. they have been open since I came in. they have been open since he was eight.',
  ],

  scales: {
    stare:    { initial: 4, min: 0, max: 5, label: 'stare' },
    question: { initial: 1, min: 0, max: 5, label: 'question' },
    present:  { initial: 0, min: 0, max: 5, label: 'present' },
  },
  initialize(p) {
    p.scales.stare = r(3, 5);
    p.scales.question = r(0, 2);
    p.scales.present = 0;
  },

  presented(p) {
    const s = p.scales.stare;
    const q = p.scales.question;
    const pr = p.scales.present;
    const eyes =
      s >= 4 ? 'his eyes are open. he has not blinked.' :
      s >= 2 ? 'his eyes track me, slowly.' :
               'his eyes are closed. his shoulders are loose.';
    const mouth =
      q >= 4 ? 'his mouth is shaping a word he has not said yet.' :
      q >= 2 ? 'his lips are parted, slightly.' :
               'his face is empty.';
    const hands =
      pr >= 3 ? 'his hand is on his own knee.' :
                'his hand is on the floor beside him, on something that is not there.';
    return `${eyes} ${mouth} ${hands}`;
  },

  verbs: {
    sit_with_him: {
      label: 'sit with him',
      desc: 'lower yourself to the floor. match his level.',
      cost: 0,
      respond(p) {
        if (p.scales.stare >= 4) {
          return {
            lines: [
              'I sit on the floor against the wall, beside him.',
              'he does not turn. he does not blink.',
              'after a while my eyes hurt for him.',
              '(present rises, faintly.)',
            ],
            scales: { present: +1 },
            composure: -1,
          };
        }
        return {
          lines: [
            'I sit beside him. our shoulders are not touching but they are at the same height.',
            'he looks at the floor between us. there is nothing on the floor between us.',
            '(present rises. stare eases.)',
          ],
          scales: { present: +1, stare: -1 },
        };
      },
    },

    cover_his_eyes: {
      label: 'cover his eyes',
      desc: 'put your hand over them. let him stop seeing it.',
      cost: 2,
      respond(p) {
        if (p.scales.present >= 2) {
          return {
            lines: [
              'I crouch and put my hand over his eyes. his lashes brush my palm.',
              'his eyes close. for the first time today, they close.',
              '~~he breathes out.~~ he breathes out. it has been forty years of holding.',
              '!!he leans his forehead against my wrist.!!',
              '(stare drops sharply. present holds. question eases.)',
            ],
            scales: { stare: -3, question: -1 },
          };
        }
        return {
          lines: [
            'I reach. his eyes flinch but do not close. he does not let me take it from him.',
            'I lower my hand. ~~not yet.~~ not yet.',
            '(stare holds. question stirs.)',
          ],
          scales: { question: +1 },
          composure: -1,
        };
      },
    },

    answer_him: {
      label: 'answer his question',
      desc: 'say what he cannot ask. you may not know it yet.',
      cost: 2,
      respond(p) {
        const q = p.scales.question;
        const pr = p.scales.present;
        if (q >= 3 && pr >= 2) {
          return {
            lines: [
              'I say: you could not have stopped it.',
              'I say: you did not look away.',
              'I say: it was not your fault. it has never been your fault.',
              'he begins to cry. ~~he~~ he is eight. he is eight. he is eight.',
              '!!I have given him something I cannot take back.!!',
              '(present surges. question falls. stare eases.)',
            ],
            scales: { present: +2, question: -2, stare: -2 },
          };
        }
        return {
          lines: [
            'I try to answer. but I am answering nothing. the room does not change.',
            'he does not stop staring. I do not know if I am too early or too late.',
            '(composure spent. nothing else moves.)',
          ],
        };
      },
    },

    look_at_what_he_sees: {
      label: 'look at what he sees',
      desc: 'turn your head where his eyes go. see what he sees.',
      cost: 2,
      respond(p) {
        return {
          lines: [
            'I follow his eyes. they are pointed at the door. ~~at the street through the door~~ at the street.',
            'I see a road. I see a small dog. I see a car.',
            '!!I see what he saw.!!',
            '~~I~~ I do not look away. I make myself not look away.',
            '(present surges. stare holds. question rises.)',
          ],
          scales: { present: +2, question: +1 },
          composure: -1,
          scars: ['witnessed'],
        };
      },
    },

    tell_him_about_yours: {
      label: 'tell him about yours',
      desc: 'tell him something you saw, that you cannot stop seeing.',
      cost: 2,
      respond(p, player) {
        const has = (player.scars || []).length > 0;
        if (has) {
          return {
            lines: [
              'I tell him about something I have seen.',
              'I tell him the part where I should have looked away and did not.',
              'he listens. his eyes do not move. but his hand finds the hem of my sleeve.',
              '(present surges. he is here. stare eases.)',
            ],
            scales: { present: +2, stare: -1 },
          };
        }
        return {
          lines: [
            'I try to tell him about something. ~~I have not~~ I have not seen anything yet.',
            'he does not respond. I have not given him anything.',
            '(composure spent. nothing else moves.)',
          ],
          composure: -1,
        };
      },
    },
  },

  drift(p) {
    p.scales.question = Math.min(5, p.scales.question + 1);
    const q = p.scales.question;
    if (q >= 4) {
      return {
        lines: [
          'I wait. his lips part. ~~he is going to ask~~ he is going to ask.',
          'he closes his mouth again. but the question is louder now.',
          '(question rises.)',
        ],
      };
    }
    if (q >= 2) {
      return {
        lines: [
          'I wait. his hand is on the floor. it is doing the shape of petting.',
          'his fingers are very small.',
          '(question rises.)',
        ],
      };
    }
    return {
      lines: [
        'I wait. he stares. nothing else happens for a long time.',
        '(question rises.)',
      ],
    };
  },

  endings: [
    {
      id: 'eyes_closed',
      when: (p) => p.scales.stare <= 1 && p.scales.present >= 2,
      title: 'you close his eyes',
      lines: [
        'he is leaning against my arm. his eyes are closed. it is the first time in a long time.',
        'I do not move. I do not want to be the one who makes him open them.',
      ],
      trait: 'unblinking',
    },
    {
      id: 'answered',
      when: (p) => p.scales.question <= 1 && p.scales.present >= 3,
      title: 'you give him an answer',
      lines: [
        'he is crying. he is eight. eight, finally. ~~for the first time~~ for the first time.',
        '!!the room has aged forty years in a minute.!!',
      ],
      trait: 'remembered',
    },
    {
      id: 'broke',
      when: (p) => p.scales.question >= 5 && p.scales.present <= 1,
      title: 'the question outlasts you',
      lines: [
        'the question is the loudest thing in the room. it is louder than I am.',
        '!!I have to leave before he asks it out loud.!!',
      ],
      trait: null,
      scars: ['witnessed'],
    },
    {
      id: 'redacted',
      when: (p) => p.scales.present >= 4 && p.scales.stare >= 3,
      title: 'you see for him',
      lines: [
        'I sit beside him. we look at the door together. ~~we do not~~ we do not look away.',
        'I do not know how long. I keep what we saw. he sets his head against my arm.',
        '!!I am the one who saw it now. it is in me.!!',
      ],
      trait: 'redacted',
      scars: ['witnessed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door behind me. ~~he was watching~~ he is watching the door I came through.'],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// FROSTFIN — the bench
// ════════════════════════════════════════════════════════════════════════
//
//   cold — the room's temperature; high cold drains your composure (0-5)
//   waiting — how committed she is to the wait (0-5)
//   recognition — does she see you or him (0-5)

const frostfin = {
  id: 'frostfin',
  name: '[Frostfin]',
  glyph: 'Frostfin',
  subtitle: 'she was found on the bench after.',
  role: 'wing', tier: 1,
  file: [
    'patient was located on the bench outside the train station.',
    'she had been there since her ~~husband~~ son said he would come.',
    'her hands have not warmed since. **staff do not hold them long.**',
  ],
  intro: [
    'the room is much colder than the corridor was. the window is dark. there is a bench in the room. she is sitting on the bench.',
    'her coat is buttoned to the throat. she is waiting for someone. she has been waiting a long time.',
  ],

  scales: {
    cold:        { initial: 3, min: 0, max: 5, label: 'cold' },
    waiting:     { initial: 4, min: 0, max: 5, label: 'waiting' },
    recognition: { initial: 0, min: 0, max: 5, label: 'recognition' },
  },
  initialize(p) {
    p.scales.cold = r(2, 4);
    p.scales.waiting = r(3, 5);
    p.scales.recognition = 0;
  },

  presented(p) {
    const c = p.scales.cold;
    const w = p.scales.waiting;
    const r = p.scales.recognition;
    const temp =
      c >= 4 ? 'my breath is visible. her breath is not.' :
      c >= 2 ? 'the room is cold.' :
               'the room is warming, slowly.';
    const posture =
      w >= 4 ? 'she is upright. she is watching the door.' :
      w >= 2 ? 'her hands are folded in her lap.' :
               'her shoulders have dropped.';
    const eyes =
      r >= 3 ? 'her eyes are on me. she has decided I am here.' :
      r >= 1 ? 'her eyes move to me, sometimes. then away.' :
               'her eyes are on the door.';
    return `${temp} ${posture} ${eyes}`;
  },

  verbs: {
    sit_with_her: {
      label: 'sit with her',
      desc: 'on the bench. be the second person who waited.',
      cost: 1,
      respond(p) {
        if (p.scales.waiting >= 4) {
          return {
            lines: [
              'I sit on the bench beside her. she does not move.',
              'after a while I am also waiting. it is not entirely unpleasant.',
              '(waiting eases. cold holds.)',
            ],
            scales: { waiting: -1 },
            composure: -1,
          };
        }
        return {
          lines: [
            'I sit beside her. she shifts, slightly, to make room.',
            'her shoulder almost touches mine. ~~she is~~ she is warmer than the room.',
            '(recognition rises. cold falls.)',
          ],
          scales: { recognition: +1, cold: -1 },
        };
      },
    },

    take_her_hand: {
      label: 'take her hand',
      desc: 'her hands are cold. take one anyway.',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I take her hand. it is colder than I expected. ~~as cold as~~ as cold as a hand can be.',
            p.scales.waiting >= 3
              ? 'she does not let go. her hand stays in mine like an object set down.'
              : 'she squeezes back. ~~once.~~ once.',
            '(cold holds. waiting eases. recognition rises.)',
          ],
          scales: { cold: 0, waiting: -1, recognition: +1 },
          composure: -1,
        };
      },
    },

    say_his_name: {
      label: 'say his name',
      desc: 'the one she is waiting for. the file gives it.',
      cost: 2,
      respond(p) {
        if (p.scales.recognition >= 2) {
          return {
            lines: [
              'I say his name. her name for him.',
              'she turns. all the way. ~~she does not~~ she does not believe it is me, but she is willing to be wrong.',
              'her eyes are very bright. she says: where have you been?',
              '!!I am not him. I do not say so.!!',
              '(recognition surges. waiting collapses.)',
            ],
            scales: { recognition: +2, waiting: -3 },
            composure: -1,
          };
        }
        return {
          lines: [
            'I say his name. she stiffens.',
            'she is not sure who is saying it. she looks at me, sidelong.',
            '(recognition rises. waiting holds.)',
          ],
          scales: { recognition: +1 },
        };
      },
    },

    say_you_came: {
      label: 'say you came',
      desc: 'lie. say you are him. take her home.',
      cost: 2,
      respond(p) {
        return {
          lines: [
            'I say: !!I am sorry I am late.!!',
            'she nods. she does not check. she stands up. she takes my arm.',
            'she walks me to the door of the room. ~~she does not~~ she does not look back at the bench.',
            '(waiting drops. recognition holds. but it is built on a lie.)',
          ],
          scales: { waiting: -3, recognition: +1 },
          composure: -2,
          scars: ['named'],
          flags: { lied: true },
        };
      },
    },

    warm_the_room: {
      label: 'warm the room',
      desc: 'find something to do. light something. move.',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I find a lamp. I find the radiator. I find a small thing to do.',
            'the room warms a degree. she does not seem to notice. but her hands are less cold than they were.',
            '(cold drops.)',
          ],
          scales: { cold: -1 },
        };
      },
    },
  },

  drift(p, player) {
    if (p.scales.cold >= 3) {
      player.composure = Math.max(0, player.composure - 1);
      return {
        lines: [
          'I wait. the cold has not lessened. ~~I~~ I am tired in a way I do not understand.',
          '(composure −1. cold rises.)',
        ],
        scales: { cold: +1 },
      };
    }
    return {
      lines: [
        'I wait. she shifts on the bench. she watches the door. nothing else happens.',
        '(waiting holds.)',
      ],
    };
  },

  endings: [
    {
      id: 'walked_out',
      when: (p) => p.flags.lied && p.scales.waiting <= 1,
      title: 'she lets you walk her out',
      lines: [
        'she lets me walk her out of the room. she takes my arm tighter when we reach the door.',
        '!!she does not look at me close. she does not look close at all.!!',
      ],
      trait: 'cold_hands',
      scars: ['named'],
    },
    {
      id: 'truth_kept',
      when: (p) => p.scales.recognition >= 4 && p.scales.waiting <= 2,
      title: 'she lets you sit with her',
      lines: [
        'she does not need him to come. she has decided I will do.',
        'we sit a long time. the room warms by a degree. ~~the door does not~~ the door does not open.',
      ],
      trait: 'patience',
    },
    {
      id: 'frozen',
      when: (p, player) => player.composure <= 0,
      title: 'the cold takes you',
      lines: [
        'the room is very cold. ~~I am~~ I am very tired. I sit down on the bench. she does not look at me.',
        '!!I do not know which of us is waiting now.!!',
      ],
      trait: null,
      scars: ['collapsed'],
    },
    {
      id: 'still_waiting',
      when: (p) => p.turn >= 7 && p.scales.waiting >= 4,
      title: 'she outlasts you',
      lines: [
        'she has been waiting longer than I can be a guest. ~~he~~ he is not coming.',
        '!!I leave her on the bench.!!',
      ],
      trait: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. she is on the bench. ~~she does not~~ she does not look up.'],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// CHOIR — the final
// ════════════════════════════════════════════════════════════════════════
//
//   chord — the song's completeness (0-5)
//   voice — your voice in their song (0-5)
//   self  — what's left of you (0-5; STARTS HIGH, only goes down)

const choir = {
  id: 'choir',
  name: '[The Choir]',
  glyph: 'Lumenpup',
  subtitle: 'they were here when I arrived. ~~they are~~ I am.',
  role: 'final',
  file: [
    'the door at the top of the ward is open. there is a room I have not been in.',
    'inside: a long bench. on the bench, every patient I have met. and others I have not.',
    'they are singing. they are not singing for me. !!they have been singing the whole time.!!',
  ],
  intro: [
    'the choir is at the door of the room.',
    'they are all looking at me. ~~one of them is me.~~',
    'one of them is me.',
  ],

  scales: {
    chord: { initial: 1, min: 0, max: 5, label: 'chord' },
    voice: { initial: 0, min: 0, max: 5, label: 'voice' },
    self:  { initial: 5, min: 0, max: 5, label: 'self' },
  },
  initialize(p, player) {
    p.scales.chord = 1 + (player.traits?.length || 0) > 5 ? 2 : 1;
    p.scales.voice = 0;
    p.scales.self = 5;
  },

  presented(p) {
    const ch = p.scales.chord;
    const v = p.scales.voice;
    const s = p.scales.self;
    const song =
      ch >= 4 ? 'the chord is full. it has been full a while.' :
      ch >= 2 ? 'the choir is singing. several parts. familiar parts.' :
                'the choir is humming. it has not yet found its key.';
    const me =
      v >= 4 ? '~~my voice~~ my voice is in the chord. I can hear it from outside.' :
      v >= 2 ? 'I am humming. I did not start.' :
               'my mouth is closed.';
    const left =
      s >= 4 ? 'I am still mostly here.' :
      s >= 2 ? '~~I am~~ I am thinner than I was.' :
               'I am hard to see, even to me.';
    return `${song} ${me} ${left}`;
  },

  verbs: {
    sing: {
      label: 'sing with them',
      desc: 'join the chord. let your voice in.',
      cost: 0,
      respond(p) {
        return {
          lines: [
            'I open my mouth. a note comes out. it fits.',
            'the chord widens to make room. ~~or I~~ or I narrow to fit.',
            '(voice rises. chord rises. self falls.)',
          ],
          scales: { voice: +2, chord: +1, self: -1 },
        };
      },
    },

    name_yourself: {
      label: 'name yourself',
      desc: 'say your number. out loud.',
      cost: 2,
      respond(p) {
        return {
          lines: [
            'I say: !!Patient 0413.!!',
            'the chord falters. one voice loses its place. ~~it might be~~ it might be mine.',
            '(voice falls. self rises. chord falters.)',
          ],
          scales: { voice: -2, self: +2, chord: -1 },
        };
      },
    },

    listen_for_yours: {
      label: 'listen for your voice',
      desc: 'pick out your own voice in the chord. find where it is.',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I listen. I am there. I have been there. I have been singing for longer than I have been listening.',
            '~~for how long~~ for how long.',
            '(voice revealed. self falls.)',
          ],
          scales: { self: -1 },
          flags: { found_voice: true },
        };
      },
    },

    take_yours_out: {
      label: 'take your voice out',
      desc: 'reach into the chord. pull yourself free of it.',
      cost: 3,
      respond(p) {
        if (!p.flags.found_voice) {
          return {
            lines: [
              'I reach for what I think is my voice. ~~I find~~ I find someone else\'s.',
              'I pull it. they go quiet. ~~I do not~~ I do not know who.',
              '(self falls. composure spent.)',
            ],
            scales: { self: -1 },
            composure: -1,
            scars: ['witnessed'],
          };
        }
        return {
          lines: [
            'I reach into the chord. my voice is there, exactly where I left it.',
            'I pull it out. the chord is poorer for it. I am ~~smaller~~ louder for it.',
            '!!I have me again.!!',
            '(voice removed. self restored. chord falters.)',
          ],
          scales: { voice: -5, self: +2, chord: -2 },
          flags: { excised: true },
        };
      },
    },

    close_door: {
      label: 'close the door',
      desc: 'shut it from the inside. or the outside. you decide.',
      cost: 2,
      respond(p) {
        return {
          lines: [
            'I close the door. ~~from the inside.~~ from the outside.',
            'the chord goes on without me. I can hear it down the corridor.',
            '(I am out. ~~mostly.~~)',
          ],
          flags: { shut_door: true },
        };
      },
    },
  },

  drift(p) {
    if (p.scales.chord >= 4) {
      return {
        lines: [
          'I wait. the chord deepens. one voice rises — ~~rocking, quietly~~ rocking, quietly. another — humming. another, ~~staring~~ staring.',
          'they have learned the whole ward. they are singing it.',
          '(chord holds. self falls.)',
        ],
        scales: { self: -1 },
      };
    }
    return {
      lines: [
        'I wait. the choir hums. ~~one voice~~ one voice sounds like mine. it always has.',
        '(chord rises. voice rises.)',
      ],
      scales: { chord: +1, voice: +1 },
    };
  },

  endings: [
    {
      id: 'joined',
      when: (p) => p.scales.voice >= 4 && p.scales.self <= 1,
      title: 'you join them',
      lines: [
        'my voice is in the chord. it has always been in the chord. ~~I am~~ I am in the chord.',
        'the room is full of me. there are many of me. I am no longer ~~looking out from~~ I am no longer looking out.',
        '!!the door is open. someone outside is being admitted.!!',
      ],
      trait: null,
      scars: ['collapsed'],
    },
    {
      id: 'excised',
      when: (p) => p.flags.excised,
      title: 'you take yourself out',
      lines: [
        'I leave the room with my voice in my hand. the chord is poorer. ~~I am~~ I am poorer.',
        'I walk past them down the corridor. they continue without me. they always did.',
        'I take the stairs.',
      ],
      trait: 'sleepless',
    },
    {
      id: 'shut_out',
      when: (p) => p.flags.shut_door,
      title: 'you shut the door',
      lines: [
        'I close it from the outside. the choir is muffled by an inch of wood.',
        'I walk back the way I came. ~~the corridor is~~ a different corridor.',
        'I leave my file at the desk. the nurse takes it without looking up.',
      ],
      trait: 'unfinished',
    },
    {
      id: 'outlasted',
      when: (p) => p.scales.self <= 0,
      title: 'the chord finishes you',
      lines: [
        'I am thinner than I should be. the choir has not noticed I am gone. ~~or that I was ever~~ or that I was ever here.',
      ],
      trait: null,
      scars: ['collapsed'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// HOLLOWOAK — the woman who is sure she had a daughter
// ════════════════════════════════════════════════════════════════════════
//
//   insistence — her commitment to "you are her" (0-5)
//   longing    — her grief (0-5)
//   recognition — clarity about who you actually are (0-5)

const hollow = {
  id: 'hollow',
  name: '[Hollowoak]',
  glyph: 'Hollowoak',
  subtitle: 'she is sure she had a daughter.',
  role: 'wing', tier: 2,
  file: [
    'patient cannot recall the name of ~~her daughter~~ the one she came in with.',
    'she has been told the room next door is empty. she continues to thank the staff for *the visits*.',
    'when asked her own name, she gave the orderly\'s. ~~**I** told her it was hers.~~',
  ],
  intro: [
    'she is at the door before I am all the way through it. she takes my hand. she has been waiting.',
    '~~she says: there you are.~~ she says: there you are.',
  ],

  scales: {
    insistence:  { initial: 3, min: 0, max: 5, label: 'insistence' },
    longing:     { initial: 2, min: 0, max: 5, label: 'longing' },
    recognition: { initial: 0, min: 0, max: 5, label: 'recognition' },
  },
  initialize(p, player) {
    p.scales.insistence = r(2, 4);
    p.scales.longing    = r(1, 3);
    p.scales.recognition = 0;
    if (player.scars?.includes('named')) p.scales.insistence = Math.min(5, p.scales.insistence + 1);
  },

  presented(p) {
    const i = p.scales.insistence;
    const l = p.scales.longing;
    const r = p.scales.recognition;
    const grip =
      i >= 4 ? 'her hand is on my arm. she has not let go since I came in.' :
      i >= 2 ? 'her hand finds my sleeve, sometimes.' :
               'her hands are her own again. they are folded in her lap.';
    const eyes =
      r >= 4 ? 'her eyes are on me. she has seen me. she has seen who I am.' :
      r >= 2 ? 'her eyes are searching my face. she is looking for someone in it.' :
               'her eyes are on me without seeing me. she is somewhere else, behind them.';
    const mouth =
      l >= 4 ? 'she keeps starting a sentence and stopping.' :
      l >= 2 ? 'her lips are moving without sound.' :
               'her mouth is at rest.';
    return `${grip} ${eyes} ${mouth}`;
  },

  verbs: {
    let_her: {
      label: 'let her',
      desc: 'be who she thinks you are. for a while.',
      cost: 1,
      respond(p) {
        if (p.scales.insistence >= 4) {
          return {
            lines: [
              'I let her tell me what I have been doing this week.',
              'I have been at school. I have been seeing a young man. I have been thinking of cutting my hair.',
              'she is glad for me. it is a long monologue. ~~she~~ she has been waiting to give it.',
              '(insistence holds. longing eases. her shoulders drop.)',
            ],
            scales: { longing: -1 },
            composure: -1,
          };
        }
        return {
          lines: [
            'I let her hold my hand. I let her look at my face.',
            'she breathes out. ~~she has been~~ she has been afraid I would not come.',
            '(insistence rises. longing eases.)',
          ],
          scales: { insistence: +1, longing: -1 },
        };
      },
    },

    correct_her: {
      label: 'correct her',
      desc: 'say: I am not her.',
      cost: 2,
      respond(p) {
        if (p.scales.recognition >= 2) {
          return {
            lines: [
              'I say: I am not your daughter.',
              'she looks at me a long time. she does not argue. she lets go of my arm.',
              'she says: ~~I knew that.~~ I knew that.',
              'she sits down. she is suddenly very small.',
              '(insistence collapses. recognition rises. longing surges.)',
            ],
            scales: { insistence: -2, recognition: +2, longing: +1 },
            composure: -1,
          };
        }
        return {
          lines: [
            'I say: I am not your daughter.',
            'she does not hear me. or she hears but it is a fact she has already decided does not apply.',
            'her hand stays on my arm.',
            '(recognition rises faintly. insistence holds.)',
          ],
          scales: { recognition: +1 },
          composure: -1,
        };
      },
    },

    ask_about_her: {
      label: 'ask about her',
      desc: 'ask: what was she like? — and listen.',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I ask: what was she like?',
            'she answers. she answers for a long time. she remembers a great deal. some of it is happy.',
            'at the end she says a name. ~~the name~~ a name.',
            'I write it down. I will keep it.',
            '(longing surges. recognition stirs.)',
          ],
          scales: { longing: +2, recognition: +1 },
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: 'use her own — the one she gave the orderly. the one that is hers.',
      cost: 2,
      respond(p) {
        return {
          lines: [
            'I say her name. her own. the one on her file. she has not been called by it in a long time.',
            p.scales.recognition >= 2
              ? 'she answers. yes? she says it like a question she had stopped asking.'
              : 'she frowns. she is trying to decide if I am talking to her, or to someone else with the same name.',
            '(recognition rises.)',
          ],
          scales: { recognition: +1 },
        };
      },
    },
  },

  drift(p) {
    if (p.scales.insistence >= 4) {
      return {
        lines: [
          'I wait. she is telling me about a birthday party. it was for me. I was eight.',
          '~~it was a long time ago.~~ it was a long time ago.',
          '(insistence holds.)',
        ],
      };
    }
    if (p.scales.recognition >= 2) {
      return {
        lines: [
          'I wait. she is quiet. she watches my face like she might find something she has misplaced.',
          '(recognition rises.)',
        ],
        scales: { recognition: +1 },
      };
    }
    return {
      lines: [
        'I wait. she is humming. she is humming something I do not recognize. it sounds like an old song.',
      ],
    };
  },

  endings: [
    {
      id: 'i_am_her',
      when: (p) => p.scales.insistence >= 5 && p.scales.recognition <= 1,
      title: 'you are her, for as long as it takes',
      lines: [
        'I let her tell me my history. I let her tell me what I am about to do with my life.',
        '!!she is at peace.!! she has not been at peace since.',
        'I leave the room with the things she has given me. ~~they are not~~ they are mine now.',
      ],
      trait: 'faithful',
      scars: ['named'],
    },
    {
      id: 'truth_told',
      when: (p) => p.scales.recognition >= 4,
      title: 'you tell her the truth',
      lines: [
        'she has heard me. she has known a while. she sits with it.',
        'she says her own name out loud. ~~one~~ once. softly. she has not said it in a long time.',
      ],
      trait: 'redacted',
    },
    {
      id: 'her_name_kept',
      when: (p) => p.scales.recognition >= 3 && p.scales.longing >= 3,
      title: 'you keep her daughter\'s name',
      lines: [
        'I write the name in my file. I will say it to other people who ought to know it.',
        '~~it is mine~~ it is hers. it is mine to carry.',
      ],
      trait: 'remembered',
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. ~~she does not~~ she is still saying the name she calls me.'],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// MIRELING — the pond
// ════════════════════════════════════════════════════════════════════════
//
//   approach — how close she is to you (0-5; she advances on drift)
//   pond     — how vivid the memory is in the room (0-5)
//   weight   — what she put in. hidden. only matters when high. (0-5)

const mire = {
  id: 'mire',
  name: '[Mireling]',
  glyph: 'Mireling',
  subtitle: 'there is no pond on the grounds.',
  role: 'wing', tier: 3,
  file: [
    'patient asks staff about the pond on the grounds. there is no pond.',
    'she specifies a ~~stone~~ statue at the edge. none on file.',
    'family report she put **something** in a pond, once. they will not say what.',
  ],
  intro: [
    'the floor of the room is wet. it is not raining outside. it has not rained.',
    'she is at the far wall. she does not turn. she is asking, into the wall:',
    'where is the pond. you know the one. the one with the statue.',
  ],

  scales: {
    approach: { initial: 0, min: 0, max: 5, label: 'approach' },
    pond:     { initial: 1, min: 0, max: 5, label: 'pond' },
    weight:   { initial: 3, min: 0, max: 5, label: 'weight' },
  },
  initialize(p) {
    p.scales.approach = 0;
    p.scales.pond = r(1, 2);
    p.scales.weight = r(2, 4);
  },

  presented(p) {
    const a = p.scales.approach;
    const pd = p.scales.pond;
    const dist =
      a >= 4 ? '!!she is in front of me. she is very close.!!' :
      a >= 2 ? 'she has crossed half the room. she is between me and the door now.' :
               'she is at the far wall. she is asking the wall.';
    const water =
      pd >= 4 ? 'the floor is wet to the ankles.' :
      pd >= 2 ? 'the floor is wet. my shoes leave prints on it.' :
                'the floor is damp. there is no water source.';
    const looking =
      a >= 3 ? 'she is looking at me, sidelong.' :
               'she is asking the wall about the pond. she has not turned.';
    return `${dist} ${water} ${looking}`;
  },

  verbs: {
    answer_about_pond: {
      label: 'answer her',
      desc: 'tell her where the pond is. or where it was.',
      cost: 1,
      respond(p) {
        if (p.scales.pond <= 2) {
          return {
            lines: [
              'I say: it is out by the east lawn. the one with the statue.',
              'she nods slowly. she does not turn. but the room dries by a degree.',
              'her approach stops. she is waiting.',
              '(pond rises. approach holds.)',
            ],
            scales: { pond: +1, approach: 0 },
          };
        }
        return {
          lines: [
            'I say: it is out by the east lawn.',
            'she answers — without turning — !!I have been there. I have been there recently.!!',
            'she takes a step closer.',
            '(approach rises. pond rises.)',
          ],
          scales: { approach: +1, pond: +1 },
        };
      },
    },

    ask_about_statue: {
      label: 'ask about the statue',
      desc: 'what was at the edge of the pond? a stone? a person?',
      cost: 1,
      respond(p) {
        if (p.scales.pond >= 3) {
          return {
            lines: [
              'I ask: what does the statue look like?',
              'she begins to describe it. she describes it in great detail. ~~it is a person~~ it is a person.',
              'her voice breaks at the end. she does not turn.',
              '(weight stirs. pond rises.)',
            ],
            scales: { weight: +1, pond: +1 },
          };
        }
        return {
          lines: [
            'I ask: what does the statue look like?',
            'she pauses. she is trying to remember. it is a slow remembering.',
            '(pond rises. approach holds.)',
          ],
          scales: { pond: +1 },
        };
      },
    },

    bar_the_door: {
      label: 'stand by the door',
      desc: 'close yourself off from the room. wait it out.',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I move to the door. I put my back to it.',
            'she does not advance. she has stopped, mid-step. her face is on the wall still.',
            '(approach drops. the room is colder.)',
          ],
          scales: { approach: -2 },
          composure: -1,
        };
      },
    },

    ask_what_she_put_in: {
      label: 'ask what she put in',
      desc: 'gently. say: what did you put in the pond?',
      cost: 2,
      respond(p) {
        if (p.scales.weight <= 2) {
          return {
            lines: [
              'I ask: what did you put in the pond.',
              'she does not answer. she does not turn. but she stops asking about the pond.',
              'we are quiet a long time.',
              '(weight eases. approach drops. pond drops.)',
            ],
            scales: { weight: -1, approach: -1, pond: -1 },
          };
        }
        return {
          lines: [
            'I ask: what did you put in the pond.',
            'she is silent. she does not turn. her hands are flat against the wall.',
            'after a long time she says: ~~something~~ something I should not have.',
            '!!she does not say what.!!',
            '(weight surges. she is here now.)',
          ],
          scales: { weight: +1, pond: +2 },
        };
      },
    },

    take_her_hand_from_wall: {
      label: 'turn her around',
      desc: 'gently. take her by the wrist. turn her toward you.',
      cost: 2,
      respond(p) {
        if (p.scales.approach >= 3) {
          return {
            lines: [
              'I take her by the wrist. she is closer than I thought. her hand is on my collar before I finish turning her.',
              '!!the floor is opening, under us, somehow.!!',
              'I let go.',
              '(approach surges. composure spent.)',
            ],
            scales: { approach: +1 },
            composure: -2,
          };
        }
        return {
          lines: [
            'I take her by the wrist. I turn her around slowly. she lets me.',
            'her eyes are very tired. she looks at me. she does not look at the wall.',
            '(approach holds. pond drops. she is here.)',
          ],
          scales: { pond: -1 },
        };
      },
    },
  },

  drift(p) {
    // The pond rises on its own when you wait. She advances on its own.
    if (p.scales.approach >= 3) {
      return {
        lines: [
          'I wait. she takes another step toward me. the floor is wet to my ankles now.',
          '(approach rises. pond rises.)',
        ],
        scales: { approach: +1, pond: +1 },
      };
    }
    return {
      lines: [
        'I wait. she is asking the wall about the pond. she does not advance, but the floor is wetter than it was.',
        '(pond rises.)',
      ],
      scales: { pond: +1 },
    };
  },

  endings: [
    {
      id: 'pulled_in',
      when: (p) => p.scales.approach >= 5,
      title: 'she takes you to the pond',
      lines: [
        'her hand on my collar. the floor opens.',
        '!!I do not know what was at the bottom. I do not know whose name she spoke as I went under.!!',
      ],
      trait: null,
      scars: ['witnessed', 'collapsed'],
    },
    {
      id: 'pond_acknowledged',
      when: (p) => p.scales.pond >= 4 && p.scales.weight <= 2,
      title: 'you let her remember it was real',
      lines: [
        'we sit on the wet floor a long time. she does not ask about the pond again.',
        'she gives me the name of what she put in. !!she has not said it out loud in years.!!',
        'I take it with me.',
      ],
      trait: 'bound',
    },
    {
      id: 'denial_held',
      when: (p) => p.scales.pond <= 1 && p.scales.approach <= 1 && p.turn >= 5,
      title: 'you hold the room from her',
      lines: [
        'she has not turned. the floor is barely damp now. the pond is somewhere else, where it always was.',
        'she does not look at me when I leave.',
      ],
      trait: 'small_warmth',
    },
    {
      id: 'weight_named',
      when: (p) => p.scales.weight >= 4,
      title: 'she names the weight',
      lines: [
        '!!she names it. she gives me the name.!!',
        'I close my hands around it. she lets me. ~~I have~~ I have a thing now I did not come in with.',
      ],
      trait: 'remembered',
      scars: ['witnessed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I leave the room. the corridor is dry. ~~for now.~~'],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// COMPOSER — Halowyrm in a different room
// ════════════════════════════════════════════════════════════════════════
//
//   chord — how many notes have been added to the unfinished thing (0-5)
//   silence — your contribution; she is composing with your quiet (0-5)
//   completion — whether the chord wants to complete or be abandoned (0-5)

const composer = {
  id: 'composer',
  name: '[The Composer]',
  glyph: 'Halowyrm',
  subtitle: 'she has been writing the same chord for years.',
  role: 'wing', tier: 3,
  file: [
    'patient has been composing in the day room since admission.',
    'staff have noticed: she does not write notes down. she ~~hums them~~ holds them.',
    'when interrupted she stares at the spot the music was in. !!she does not look up.!!',
  ],
  intro: [
    'the upright piano is in the corner of the room. she is at the bench. her hands are above the keys but she is not playing.',
    'she is humming. ~~the chord~~ a chord. she has been writing it a long time.',
  ],

  scales: {
    chord:      { initial: 2, min: 0, max: 5, label: 'chord' },
    silence:    { initial: 0, min: 0, max: 5, label: 'silence' },
    completion: { initial: 2, min: 0, max: 5, label: 'completion' },
  },
  initialize(p) {
    p.scales.chord = r(1, 3);
    p.scales.silence = 0;
    p.scales.completion = r(1, 3);
  },

  presented(p) {
    const c = p.scales.chord;
    const s = p.scales.silence;
    const co = p.scales.completion;
    const sound =
      c >= 4 ? 'the chord is almost there. it is several notes thick.' :
      c >= 2 ? 'the chord is forming. a few notes are stacked, humming.' :
               'the room is mostly quiet. only one note at a time.';
    const hands =
      co >= 4 ? 'her hands are trembling above the keys. ready to land.' :
      co >= 2 ? 'her hands are over the keys. she has not pressed any of them.' :
                'her hands are folded in her lap. she has stopped.';
    const me =
      s >= 3 ? 'I am holding my breath without meaning to.' :
      s >= 1 ? 'I am very quiet in the corner.' :
               'I am breathing normally. it is loud, in here.';
    return `${sound} ${hands} ${me}`;
  },

  verbs: {
    add_a_note: {
      label: 'hum a note',
      desc: 'add to the chord. quietly. low.',
      cost: 1,
      respond(p) {
        if (p.scales.chord >= 4) {
          return {
            lines: [
              'I hum a low note. it does not fit. ~~the chord~~ the chord winces around it.',
              'she stops humming. she looks at me. !!she is angry, briefly.!!',
              '(chord falters. completion drops.)',
            ],
            scales: { chord: -1, completion: -1 },
            composure: -1,
          };
        }
        return {
          lines: [
            'I hum a note. it fits. ~~it is~~ it is one she had been waiting for.',
            'she nods, almost.',
            '(chord rises. completion rises.)',
          ],
          scales: { chord: +1, completion: +1 },
        };
      },
    },

    stay_quiet: {
      label: 'stay quiet',
      desc: 'do not add. do not interrupt. let her work.',
      cost: 0,
      respond(p) {
        return {
          lines: [
            'I do not breathe loudly. I do not shift. I let her have the room.',
            'she adds a note. she leaves it alone. she adds another.',
            '(silence rises. chord rises.)',
          ],
          scales: { silence: +1, chord: +1 },
        };
      },
    },

    close_the_lid: {
      label: 'close the piano lid',
      desc: 'reach past her. close it. gently.',
      cost: 2,
      respond(p) {
        if (p.scales.completion <= 2) {
          return {
            lines: [
              'I reach past her. her shoulder is warm. I lower the lid over the keys.',
              'the chord stops in the air. ~~it~~ it does not finish.',
              'she lowers her hands. she rests them on the closed lid. she breathes out.',
              '!!she has been waiting for someone to do this.!!',
            ],
            flags: { closed_lid: true },
            scales: { chord: -3, completion: -2 },
          };
        }
        return {
          lines: [
            'I reach to close it. her hand is on the lid first. she does not push me away.',
            'she says: !!not yet.!! she is firm.',
            '(completion holds. chord holds.)',
          ],
          composure: -1,
        };
      },
    },

    let_her_finish: {
      label: 'let her finish',
      desc: 'lay your hands on the keys with hers. press together.',
      cost: 2,
      respond(p) {
        if (p.scales.chord >= 4 && p.scales.completion >= 3) {
          return {
            lines: [
              'I sit on the bench beside her. I find her shoulder with my shoulder.',
              'I lay my hands on the keys where hers are.',
              'we press. the chord lands. the room composes itself around it.',
              '!!she sets her hands in her lap. she has finished.!!',
              '(chord released. completion released.)',
            ],
            flags: { finished_chord: true },
            scales: { completion: -5, chord: -5 },
          };
        }
        return {
          lines: [
            'I sit beside her. I lay my hands on the keys. she shakes her head. ~~not now.~~ not yet.',
            'she lifts my hands off the keys gently.',
            '(silence rises. composure spent.)',
          ],
          scales: { silence: +1 },
          composure: -1,
        };
      },
    },

    play_wrong_note: {
      label: 'play a wrong note',
      desc: 'sing a note that does not fit. break the chord.',
      cost: 1,
      respond(p) {
        return {
          lines: [
            'I sing a note that does not fit. it is wrong. it is obviously wrong.',
            'she stops humming. she stares at the spot the chord was in.',
            'one of the notes has dropped out of it. the others are leaning.',
            '(chord drops. completion drops.)',
          ],
          scales: { chord: -2, completion: -1 },
        };
      },
    },
  },

  drift(p) {
    if (p.scales.completion >= 4 && p.scales.chord >= 4) {
      return {
        lines: [
          'I wait. she adds the final note. the chord lands without me.',
          '!!the room composes itself.!!',
          '(chord released. completion released.)',
        ],
        scales: { chord: -5, completion: -5 },
        flags: { finished_alone: true },
      };
    }
    return {
      lines: [
        'I wait. she adds a note. then another. the chord deepens.',
        '(chord rises. completion rises.)',
      ],
      scales: { chord: +1, completion: +1 },
    };
  },

  endings: [
    {
      id: 'finished_together',
      when: (p) => p.flags.finished_chord,
      title: 'you finish the chord with her',
      lines: [
        'her hands are in her lap. mine are still on the keys. she puts hers over mine.',
        'we do not say anything. ~~for a long time.~~ for a long time.',
      ],
      trait: 'remembered',
    },
    {
      id: 'closed_lid',
      when: (p) => p.flags.closed_lid,
      title: 'you close the lid',
      lines: [
        'the lid is closed. she rests her hands on the wood. the room is quiet for the first time.',
        '!!she lets it be quiet.!!',
      ],
      trait: 'sleepless',
    },
    {
      id: 'finished_alone',
      when: (p) => p.flags.finished_alone,
      title: 'she finishes it without you',
      lines: [
        'the chord arrives. she does not look at me. she has finished what she came in to finish.',
        'I leave the room. ~~the chord follows me~~ the chord follows me for some hours.',
      ],
      trait: 'unblinking',
      scars: ['witnessed'],
    },
    {
      id: 'broken',
      when: (p) => p.scales.completion <= 0,
      title: 'the chord falls apart',
      lines: [
        'her hands drop. she stares at the keys. the chord is in pieces around her.',
        '!!she has lost the place she was holding it from.!!',
      ],
      trait: null,
      scars: ['witnessed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. the chord is humming behind me. ~~it always was.~~'],
      trait: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// registry
// ════════════════════════════════════════════════════════════════════════

export const PATIENTS = {
  pram, pyrelord, soothlick, glimmer, frostfin, hollow, mire, composer, choir,
};

export function getPatient(id) { return PATIENTS[id] || null; }
