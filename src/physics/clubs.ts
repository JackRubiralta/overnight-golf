/**
 * Club definitions. Lofts/lengths are typical modern specs. `smash` is the
 * maximum ball-speed / club-speed ratio for a centred strike (TrackMan-like).
 * `refSpeedMph` is a typical amateur-good full swing clubhead speed and is used
 * only for UI expectations / the practice HUD, never to drive the physics.
 */
export type ClubKind = 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';

export interface Club {
  id: string;
  name: string;
  short: string;
  kind: ClubKind;
  /** Static loft, degrees. */
  loft: number;
  /** Lie angle, degrees. */
  lie: number;
  /** Shaft length, metres (drives clubhead radius in the swing model). */
  length: number;
  /** Head mass, kg. */
  headMass: number;
  /** Max smash factor at the club's nominal spin loft. */
  smash: number;
  /** Effective COR "gear effect" strength for off-centre strikes (woods high, irons low). */
  gear: number;
  /** Sweet spot forgiveness: millimetres of offset before strong losses. */
  forgiveness: number;
  /** Typical amateur clubhead speed (mph) for UI expectations. */
  refSpeedMph: number;
}

export const CLUBS: Club[] = [
  { id: 'D', name: 'Driver', short: 'Dr', kind: 'driver', loft: 10.5, lie: 58, length: 1.150, headMass: 0.200, smash: 1.49, gear: 1.0, forgiveness: 14, refSpeedMph: 105 },
  { id: '3W', name: '3 Wood', short: '3W', kind: 'wood', loft: 15, lie: 58.5, length: 1.080, headMass: 0.215, smash: 1.47, gear: 0.8, forgiveness: 11, refSpeedMph: 100 },
  { id: '5W', name: '5 Wood', short: '5W', kind: 'wood', loft: 18, lie: 59, length: 1.055, headMass: 0.22, smash: 1.45, gear: 0.7, forgiveness: 11, refSpeedMph: 97 },
  { id: '4H', name: '4 Hybrid', short: '4H', kind: 'hybrid', loft: 22, lie: 60, length: 1.020, headMass: 0.235, smash: 1.42, gear: 0.5, forgiveness: 10, refSpeedMph: 94 },
  { id: '5I', name: '5 Iron', short: '5i', kind: 'iron', loft: 26, lie: 61.5, length: 0.965, headMass: 0.245, smash: 1.38, gear: 0.25, forgiveness: 8, refSpeedMph: 91 },
  { id: '6I', name: '6 Iron', short: '6i', kind: 'iron', loft: 29, lie: 62, length: 0.953, headMass: 0.252, smash: 1.36, gear: 0.25, forgiveness: 8, refSpeedMph: 89 },
  { id: '7I', name: '7 Iron', short: '7i', kind: 'iron', loft: 33, lie: 62.5, length: 0.940, headMass: 0.259, smash: 1.33, gear: 0.2, forgiveness: 8, refSpeedMph: 87 },
  { id: '8I', name: '8 Iron', short: '8i', kind: 'iron', loft: 37, lie: 63, length: 0.927, headMass: 0.266, smash: 1.31, gear: 0.2, forgiveness: 8, refSpeedMph: 85 },
  { id: '9I', name: '9 Iron', short: '9i', kind: 'iron', loft: 41, lie: 63.5, length: 0.914, headMass: 0.273, smash: 1.28, gear: 0.2, forgiveness: 8, refSpeedMph: 83 },
  { id: 'PW', name: 'Pitching Wedge', short: 'PW', kind: 'wedge', loft: 46, lie: 64, length: 0.902, headMass: 0.285, smash: 1.25, gear: 0.15, forgiveness: 7, refSpeedMph: 81 },
  { id: 'GW', name: 'Gap Wedge', short: 'GW', kind: 'wedge', loft: 50, lie: 64, length: 0.895, headMass: 0.29, smash: 1.22, gear: 0.15, forgiveness: 7, refSpeedMph: 79 },
  { id: 'SW', name: 'Sand Wedge', short: 'SW', kind: 'wedge', loft: 56, lie: 64, length: 0.889, headMass: 0.295, smash: 1.18, gear: 0.15, forgiveness: 7, refSpeedMph: 77 },
  { id: 'LW', name: 'Lob Wedge', short: 'LW', kind: 'wedge', loft: 60, lie: 64, length: 0.883, headMass: 0.3, smash: 1.14, gear: 0.15, forgiveness: 7, refSpeedMph: 75 },
  { id: 'P', name: 'Putter', short: 'Pt', kind: 'putter', loft: 3, lie: 70, length: 0.864, headMass: 0.35, smash: 1.4, gear: 0, forgiveness: 12, refSpeedMph: 5 },
];

export function clubById(id: string): Club {
  const c = CLUBS.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown club ${id}`);
  return c;
}
