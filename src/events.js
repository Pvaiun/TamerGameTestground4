// Corridor events — short vignettes between patient encounters. Each event
// presents a scene and 2-3 choices. Each choice carries an `effect(player,
// run)` that mutates the player (composure, scars, traits, signature uses).
//
// The new combat has no HP — composure and scars are the only durable
// run-scale resources. Events shape both.

import { pick, pickN } from './rng.js';
import { addTrait } from './combat.js';
import { applyScar } from './scars.js';
import { COMPOSURE_MAX } from './state.js';

function bumpComposure(p, n) {
  p.composure = Math.max(0, Math.min(p.composureMax || COMPOSURE_MAX, (p.composure || 0) + n));
}

export const EVENTS = {

  nurse: {
    id: 'nurse',
    tag: '// corridor · nurses\' station',
    glyph: 'Soothlick',
    prose: [
      'the station is lit from below. a nurse i have not seen before is behind the desk.',
      'she does not look up. she says my name in a voice that is mostly air. she has a tray.',
      'on the tray: !!a small thing!!. she does not push it forward.',
    ],
    choices: [
      {
        key: 'take',
        label: 'Take what she offers',
        prose: 'I take it. it is warm. it does not weigh much. ~~I~~ I feel restored, somewhere.',
        effect(p) { bumpComposure(p, 3); },
      },
      {
        key: 'refuse',
        label: 'Refuse',
        prose: 'I keep my hands at my sides. she does not look up. the tray stays.',
        effect() {},
      },
      {
        key: 'sign',
        label: 'Sign the page she has not turned',
        prose: 'I sign. the page is mine. the pen is ~~hers~~ mine. I feel resolved. !!and a little less my own.!!',
        effect(p) { bumpComposure(p, 2); applyScar(p, 'named'); },
      },
    ],
  },

  empty_room: {
    id: 'empty_room',
    tag: '// corridor · room 0202 · empty',
    glyph: 'Loamback',
    prose: [
      'this room is empty. the bed is made. there is a file on the dresser, open to the third page.',
      'the third page says: ~~Patient 0413~~ Patient 0413.',
      'I close it. it is a little heavier than I expected.',
    ],
    choices: [
      {
        key: 'read',
        label: 'Read the file',
        prose: 'I read it through. some of it is true. some of it is becoming true.',
        effect(p, run) { run._readSelf = true; bumpComposure(p, 1); },
      },
      {
        key: 'leave',
        label: 'Leave the file',
        prose: 'I leave the file open. ~~I close~~ I leave the door open.',
        effect() {},
      },
      {
        key: 'rewrite',
        label: 'Rewrite the third page',
        prose: 'I scratch out the line. I write another. the page does not ~~object~~ resist. !!I do not recognize my own hand.!!',
        effect(p) { addTrait(p, 'unfinished'); applyScar(p, 'witnessed'); },
      },
    ],
  },

  mirror: {
    id: 'mirror',
    tag: '// corridor · mirror at the end',
    glyph: 'Lumenpup',
    prose: [
      'a mirror at the end of the corridor. the angle is wrong. it shows the corridor behind me, and also a corridor I have not been in.',
      'in the other corridor, !!I am already past the mirror!!. I have not been ~~looking~~ left.',
    ],
    choices: [
      {
        key: 'wait',
        label: 'Wait for myself',
        prose: 'I wait. the other me passes. we do not nod.',
        effect(p) { bumpComposure(p, 3); },
      },
      {
        key: 'follow',
        label: 'Step through',
        prose: 'I step through. the room composes itself behind me. ~~the corridor I came from is gone~~ I am where I was.',
        effect(p) {
          if (p.signature) p.signature.usesLeft++;
          applyScar(p, 'witnessed');
        },
      },
      {
        key: 'shatter',
        label: 'Strike it',
        prose: 'I strike the glass. it does not break. !!my hand does.!!',
        effect(p) { bumpComposure(p, -1); applyScar(p, 'collapsed'); },
      },
    ],
  },

  ward_case: {
    id: 'ward_case',
    tag: '// corridor · ward iii · a file passing by',
    glyph: 'Mireling',
    prose: [
      'a file passes me in the hall. it is not mine. someone is carrying it briskly.',
      'I read the first line as it goes by. ~~Patient~~ 02[[2]]. ~~refuses water~~. !!the room smells of pond.!!',
      'I do not stop. I do not look back. I keep what I read.',
    ],
    choices: [
      {
        key: 'remember',
        label: 'Remember it',
        prose: 'I write it down. it adds to what I have.',
        effect(p) { addTrait(p, 'remembered'); },
      },
      {
        key: 'forget',
        label: 'Forget it on purpose',
        prose: 'I let it go before I am asked to. the corridor is cleaner. ~~I~~ I am calmer for it.',
        effect(p) { bumpComposure(p, 3); },
      },
    ],
  },

  desk: {
    id: 'desk',
    tag: '// corridor · the writing desk',
    glyph: 'Aurabeast',
    prose: [
      'there is a desk in the hallway. it should not be in the hallway. it has a pen, a lamp, and a file.',
      'the file has my name on it. it is open to a page I have not yet ~~lived~~ filled.',
    ],
    choices: [
      {
        key: 'write',
        label: 'Write something true',
        prose: 'I write it. the page accepts it. I am ~~smaller~~ more here.',
        effect(p) { addTrait(p, 'unfinished'); },
      },
      {
        key: 'lie',
        label: 'Write something better',
        prose: 'I write something kinder than the truth. the page accepts it more readily. !!I am more here than I should be.!!',
        effect(p) { bumpComposure(p, 4); applyScar(p, 'named'); },
      },
      {
        key: 'leave_blank',
        label: 'Leave the page blank',
        prose: 'I leave it blank. the lamp ~~goes out~~ stays bright.',
        effect() {},
      },
    ],
  },

  garden: {
    id: 'garden',
    tag: '// corridor · a window onto the garden',
    glyph: 'Sproutkin',
    prose: [
      'a window. there is a garden out there. !!there is no garden on the grounds.!!',
      'someone is kneeling in the garden. they have my hands.',
    ],
    choices: [
      {
        key: 'wave',
        label: 'Wave',
        prose: 'they wave back. exactly. ~~I am being copied~~ I am being mirrored. I feel held.',
        effect(p) { addTrait(p, 'small_warmth'); },
      },
      {
        key: 'turn',
        label: 'Turn away',
        prose: 'I do not look long. the window is clean.',
        effect(p) { bumpComposure(p, 2); },
      },
      {
        key: 'open',
        label: 'Open the window',
        prose: 'cold. a wind comes in from outside. ~~I~~ I am thinner for it. !!I am also stronger.!!',
        effect(p) { bumpComposure(p, -2); addTrait(p, 'cold_hands'); },
      },
    ],
  },
};

export function pickEventPool(n) {
  const keys = Object.keys(EVENTS);
  const out = pickN(keys, Math.min(n, keys.length));
  while (out.length < n) out.push(pick(keys));
  return out;
}

export function getEvent(id) { return EVENTS[id] || null; }
