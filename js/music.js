// Conversões entre frequência, nota MIDI e nomes de notas em português.

// em inglês e alemão as notas são letras (C D E...); nas outras línguas fica Dó Ré Mi
const NAMES = /^(en|de)/.test((globalThis.scI18n && globalThis.scI18n.lang) || '') ? ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] : ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];

// Sílabas do solfejo de dó móvel, por distância em semitons da tônica
const SOLFEGE = {
  0: 'dó', 1: 'dó#', 2: 'ré', 3: 'mi♭', 4: 'mi', 5: 'fá', 6: 'fá#', 7: 'sol',
  8: 'lá♭', 9: 'lá', 10: 'si♭', 11: 'si', 12: 'dó',
};

// Graus que se escrevem com bemol no dó móvel (mi♭, lá♭, si♭)
export const prefersFlat = (offset) => [3, 8, 10].includes(((offset % 12) + 12) % 12);

export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function noteName(midi, withOctave = true) {
  const m = Math.round(midi);
  const name = NAMES[((m % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(m / 12) - 1}` : name;
}

export const isNatural = (midi) => !NAMES[((Math.round(midi) % 12) + 12) % 12].includes('#');

export function solfegeFor(offset, midi) {
  return SOLFEGE[((offset % 12) + 12) % 12] ?? noteName(midi, false);
}

// Sugestão de classificação pelo meio da extensão. É só um ponto de partida.
export function classifyVoice(low, high) {
  const mid = (low + high) / 2;
  if (mid < 51) return 'baixo';
  if (mid < 55) return 'barítono';
  if (mid < 59) return 'tenor';
  if (mid < 63) return 'contralto';
  if (mid < 66) return 'mezzo-soprano';
  return 'soprano';
}
