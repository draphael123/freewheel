/* ============================================================================
   FREEWHEEL — themes.

   Every colour, light and scatter rule the renderer uses, as data. The point is
   not tidiness: it is that adding a venue should cost one array in track.js and
   one entry here, and nothing else. If a value is hardcoded in render.js then
   it is a value no future theme can change, so it does not belong there.

   The one rule that survived measurement: THE ROAD MUST CONTRAST WITH THE
   GROUND, in whichever direction. Alpine puts dark tarmac on a pale hillside;
   the spillway inverts it and puts pale concrete on dark scrub. Both work. What
   does not work is a road the same value as its surroundings — that is how the
   first build rendered a road nobody could see.
   ========================================================================== */

export const THEMES = {
  /* ------------------------------------------------------------------ */
  alpine: {
    exposure: 0.95,
    sky:  { zenith: [0.13, 0.23, 0.40], horizon: [0.80, 0.71, 0.60],
            ground: [0.30, 0.28, 0.28], glow: [0.95, 0.72, 0.40], glowPow: 9 },
    fog:  { color: 0xc7bda9, near: -40, far: 290 },
    sun:  { color: 0xffd7a4, intensity: 2.0, dir: [-0.52, 0.72, -0.66] },
    hemi: { sky: 0x9dc0e2, ground: 0x5c5240, intensity: 1.15 },

    road: { top: [0.115, 0.105, 0.098], wall: [0.150, 0.120, 0.090] },
    dash: 0xcfc4ab, dashOn: true,
    post: { a: 0xd8d2c4, b: 0xc2452e }, pylon: 0x6b5c4c,

    terrain: {
      stops: [
        [0.00, [.34, .33, .30]], [0.19, [.34, .33, .30]],
        [0.26, [.52, .41, .20]], [0.42, [.52, .41, .20]],
        [0.50, [.22, .34, .23]], [0.74, [.22, .34, .23]],
        [0.81, [.74, .77, .82]], [1.00, [.74, .77, .82]],
      ],
      rock: [.30, .27, .25], relief: 1.0, tint: 0.34,
    },
    scatter: {
      trees: 820, rocks: 190, clump: 0.36, altHi: 0.80, altLo: 0.14,
      coneA: 0x4d6b47, coneB: 0x63794f, trunk: 0x5a4634, rockCol: 0x6d6459,
      tallH: 7.5, tallR: 2.2, shortH: 5.2, shortR: 2.9,
    },
    cart: { body: 0xb8452c, nose: 0x8d3320, rider: 0x2f4f6d, skin: 0xe0c9a6 },
    dust: 0xbfae95,
  },

  /* ------------------------------------------------------------------ */
  /* Dry dusty basin. The first pass INVERTED the alpine arrangement — pale
     concrete on dark scrub — and it half worked: the road was legible, but the
     hillside went dead. Measured, the terrain carried the same 1.7 m of relief
     per cell as the alpine hill; it simply had too little value contrast for
     shading to show any of it, so a faceted mountain rendered as a flat olive
     field. Dark ground is not a palette choice on a lit surface, it is a
     decision to throw the geometry away. Road darker than ground, again.     */
  concrete: {
    exposure: 0.92,
    sky:  { zenith: [0.20, 0.26, 0.36], horizon: [0.74, 0.68, 0.58],
            ground: [0.26, 0.24, 0.22], glow: [0.90, 0.76, 0.52], glowPow: 12 },
    fog:  { color: 0xb9b09e, near: -30, far: 320 },
    sun:  { color: 0xffe6bd, intensity: 1.85, dir: [-0.62, 0.60, -0.50] },
    hemi: { sky: 0xa8bed4, ground: 0x4f4739, intensity: 0.95 },

    road: { top: [0.19, 0.190, 0.185], wall: [0.12, 0.120, 0.117] },
    dash: 0xd6d0be, dashOn: true,
    post: { a: 0xe0d29a, b: 0x33322e }, pylon: 0x8e887c,

    terrain: {
      stops: [
        [0.00, [.44, .42, .35]], [0.20, [.44, .42, .35]],
        [0.30, [.62, .53, .33]], [0.52, [.62, .53, .33]],
        [0.62, [.50, .48, .34]], [0.82, [.50, .48, .34]],
        [0.90, [.66, .62, .54]], [1.00, [.66, .62, .54]],
      ],
      rock: [.56, .53, .47], relief: 1.05, tint: 0.30,
    },
    scatter: {
      trees: 210, rocks: 520, clump: 0.55, altHi: 0.74, altLo: 0.06,
      coneA: 0x4a4b32, coneB: 0x565638, trunk: 0x4a4034, rockCol: 0x8b8478,
      tallH: 4.6, tallR: 1.7, shortH: 3.0, shortR: 2.1,
    },
    cart: { body: 0x1f6f86, nose: 0xc9542c, rider: 0xe8e2d4, skin: 0xd9bfa0 },
    dust: 0xcfc7b6,
  },

  /* ------------------------------------------------------------------ */
  /* Glazed ice reads darker and bluer than the snow around it, which is
     the only thing keeping the road visible on a white mountain.        */
  ice: {
    exposure: 0.90,
    sky:  { zenith: [0.09, 0.15, 0.32], horizon: [0.62, 0.66, 0.80],
            ground: [0.34, 0.38, 0.46], glow: [0.85, 0.72, 0.72], glowPow: 7 },
    fog:  { color: 0xc3ccdb, near: -60, far: 250 },
    sun:  { color: 0xffd0c0, intensity: 1.55, dir: [-0.42, 0.44, -0.79] },
    hemi: { sky: 0x9fc4ea, ground: 0x6d7686, intensity: 1.55 },

    road: { top: [0.40, 0.47, 0.58], wall: [0.24, 0.29, 0.38] },
    dash: 0xf0a24a, dashOn: true,
    post: { a: 0xf0a24a, b: 0x2a3550 }, pylon: 0x5d6675,

    terrain: {
      stops: [
        [0.00, [.56, .62, .72]], [0.22, [.56, .62, .72]],
        [0.32, [.70, .75, .84]], [0.58, [.70, .75, .84]],
        [0.68, [.80, .84, .90]], [1.00, [.80, .84, .90]],
      ],
      rock: [.26, .28, .33], relief: 1.15, tint: 0.20,
    },
    scatter: {
      trees: 430, rocks: 300, clump: 0.48, altHi: 0.66, altLo: 0.06,
      coneA: 0x2c4038, coneB: 0x36473c, trunk: 0x3a3630, rockCol: 0x545c68,
      tallH: 8.5, tallR: 2.0, shortH: 5.6, shortR: 2.6,
    },
    cart: { body: 0xd8442e, nose: 0x8f2a1c, rider: 0x24303f, skin: 0xe8d2b4 },
    dust: 0xeaf1f8,
  },
};

export const get = (name) => THEMES[name] || THEMES.alpine;
