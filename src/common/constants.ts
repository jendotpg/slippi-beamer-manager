import { BeamerHealth } from './types';

export const unknownCharacterId = 31;

// Character external ID to short name
export const characterNames = new Map([
  [0, 'Falcon'],
  [1, 'DK'],
  [2, 'Fox'],
  [3, 'GW'],
  [4, 'Kirby'],
  [5, 'Bowser'],
  [6, 'Link'],
  [7, 'Luigi'],
  [8, 'Mario'],
  [9, 'Marth'],
  [10, 'Mewtwo'],
  [11, 'Ness'],
  [12, 'Peach'],
  [13, 'Pikachu'],
  [14, 'ICs'],
  [15, 'Puff'],
  [16, 'Samus'],
  [17, 'Yoshi'],
  [18, 'Zelda'],
  [19, 'Sheik'],
  [20, 'Falco'],
  [21, 'YL'],
  [22, 'Doc'],
  [23, 'Roy'],
  [24, 'Pichu'],
  [25, 'Ganon'],
]);

export const characterColorIndexLength = new Map([
  [0, 6], // Falcon
  [1, 5], // DK
  [2, 4], // Fox
  [3, 4], // GW
  [4, 6], // Kirby
  [5, 4], // Bowser
  [6, 5], // Link
  [7, 4], // Luigi
  [8, 5], // Mario
  [9, 5], // Marth
  [10, 4], // Mewtwo
  [11, 4], // Ness
  [12, 5], // Peach
  [13, 4], // Pikachu
  [14, 4], // ICs
  [15, 5], // Puff
  [16, 5], // Samus
  [17, 6], // Yoshi
  [18, 5], // Zelda
  [19, 5], // Sheik
  [20, 4], // Falco
  [21, 5], // YL
  [22, 5], // Doc
  [23, 5], // Roy
  [24, 4], // Pichu
  [25, 5], // Ganon
]);

export const beamerHealthColor: Record<BeamerHealth, string> = {
  ok: '#31d158',
  starting: '#8a8a8e',
  warn: '#f5a623',
  error: '#f04438',
  unknown: '#8a8a8e',
};

export const beamerDeadColor: Partial<Record<BeamerHealth, string>> = {
  ok: '#062E03',
  warn: '#2E1D03',
};

export const githubRepo = 'jendotpg/slippi-beamer-manager';

export const MAX_DOWNLOAD_ATTEMPTS = 3;
