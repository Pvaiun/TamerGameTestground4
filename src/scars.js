// Scars are run-long debuffs (and occasional gifts) earned during patient
// encounters. Unlike traits — which are deliberate trophies of a resolution —
// scars are the leftover edge of an encounter you couldn't make clean. They
// persist across encounters, can affect starting state, and sometimes alter
// what verbs do.
//
// Each scar may declare:
//   composureCap: int           — caps the player's max composure to this
//   startComposureDelta: int    — added to starting composure each fight
//   verbDelta: (verbId, resp) → resp  — chance to mutate a verb's response
//   onCorridorEntry(player)     — called between encounters
//
// Patient verb implementations can read player.scars and branch their
// response: e.g., a patient may distrust someone marked "taken".

export const SCARS = {
  taken: {
    id: 'taken',
    name: 'Taken',
    file: 'I took something from someone. ~~she~~ they didn\'t put it down.',
    desc: 'patients sense you came in carrying something that wasn\'t yours.',
  },
  witnessed: {
    id: 'witnessed',
    name: 'Witnessed',
    file: 'I saw her go. I have not put down what I saw.',
    desc: 'max composure −1.',
    composureCap: 4,
  },
  named: {
    id: 'named',
    name: 'Named',
    file: 'she called me something. it has not quite let go.',
    desc: 'risky verbs cost +1 composure.',
  },
  abandoned: {
    id: 'abandoned',
    name: 'Abandoned',
    file: 'I left a door open. someone is still through it.',
    desc: 'starting composure −1 per fight.',
    startComposureDelta: -1,
  },
  failed: {
    id: 'failed',
    name: 'Failed',
    file: 'I ran out of time. she ran out with me.',
    desc: 'starting composure −1 per fight.',
    startComposureDelta: -1,
  },
  collapsed: {
    id: 'collapsed',
    name: 'Collapsed',
    file: 'I went under. I am not all the way back.',
    desc: 'max composure −1.',
    composureCap: 4,
  },
  wearing: {
    id: 'wearing',
    name: 'Wearing',
    file: 'the corridor is on me. the wallpaper, the wallpaper smell.',
    desc: 'minor: a vague heaviness. no mechanical effect, but the desk takes note.',
  },
};

export function applyScar(player, sid) {
  if (!SCARS[sid]) return;
  if (!player.scars) player.scars = [];
  if (!player.scars.includes(sid)) player.scars.push(sid);
}

export function getScar(id) { return SCARS[id] || null; }
