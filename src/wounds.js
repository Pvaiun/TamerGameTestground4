// Wounds are admission reasons. Each is a starting state for a run: a small
// handicap, a small gift, and a SIGNATURE action. The signature is a named
// trait (id starting with `sig_`) from src/traits.js.
//
// At admission the player picks a wound. It becomes the seed of their file.

export const WOUNDS = {
  amnesia: {
    id: 'amnesia',
    name: 'Amnesia',
    one_liner: 'I do not remember the address.',
    file: [
      'Subject arrived unaccompanied. No identification.',
      'Vitals normal. Responds to questions. !!Does not remember the address.!!',
      'Settled in room without resistance.',
    ],
    // mods are read by sumMod / engine. composureMax adds to your cap;
    // startComposure is your initial composure each fight.
    mods: { startComposure: 2 },
    signature: 'sig_amnesia',
  },

  insomnia: {
    id: 'insomnia',
    name: 'Insomnia',
    one_liner: 'I have been awake for a while now.',
    file: [
      'Subject has not slept since admission. Reports last sleep was [[5]] days prior.',
      'Pupils normal. Pulse elevated.',
      'When asked to lie down: !!declines.!!',
    ],
    mods: { startComposure: 1, composureMax: 1 },
    signature: 'sig_insomnia',
  },

  absence: {
    id: 'absence',
    name: 'Absence',
    one_liner: 'I left a chair pulled out at home. ~~No one~~ Someone is sitting in it.',
    file: [
      'Subject reports a previous self still active at the residence.',
      'Subject is calm about this. Staff are not.',
      'Asked which is here, in this chair: !!I do not know.!!',
    ],
    mods: { startComposure: 1 },
    signature: 'sig_absence',
  },

  witness: {
    id: 'witness',
    name: 'Witness',
    one_liner: 'I saw something. I wrote it down. The paper is in my coat.',
    file: [
      'Subject was found at the address with a written account in their coat.',
      'The account is [[12]]. The handwriting matches.',
      'Subject does not remember writing it.',
    ],
    mods: { startComposure: 0, composureMax: 0 },
    signature: 'sig_witness',
  },

  devotion: {
    id: 'devotion',
    name: 'Devotion',
    one_liner: 'I came here on purpose. I think.',
    file: [
      'Subject presented at admissions with a list of names.',
      'Two of the names are staff. The others are !!not yet on file.!!',
      'Subject asks to be brought to one of them daily.',
    ],
    mods: { startComposure: 3 },
    signature: 'sig_devotion',
  },

  hollow: {
    id: 'hollow',
    name: 'Hollow',
    one_liner: 'I am not full of much.',
    file: [
      'Subject reports an internal emptiness. Imaging unremarkable.',
      'Will not eat without prompting. Eats slowly when reminded.',
      'When asked what is missing, answers: ~~everything~~ I will know when it comes back.',
    ],
    mods: { startComposure: 0, composureMax: 2 },
    signature: 'sig_hollow',
  },
};

export function getWound(id) { return WOUNDS[id] || null; }
