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
    exposure: 1.12,
    sky:  { zenith: [0.34, 0.50, 0.70], horizon: [0.86, 0.79, 0.68],
            ground: [0.30, 0.28, 0.28], glow: [0.95, 0.72, 0.40], glowPow: 9 },
    fog:  { color: 0xc7bda9, near: -40, far: 290 },
    sun:  { color: 0xffd7a4, intensity: 2.0, dir: [-0.52, 0.72, -0.66] },
    /* Ground colour is BOUNCE light, and an alpine valley bounces a lot. At
   0x5c5240 every slope facing away from the sun rendered nearly black —
   which the old fog wall hid, and the long view exposed. */
    hemi: { sky: 0xa9cbe8, ground: 0x9c9078, intensity: 1.55 },

    road: { top: [0.115, 0.105, 0.098], wall: [0.150, 0.120, 0.090] },
    dash: 0xcfc4ab, dashOn: true,
    post: { a: 0xd8d2c4, b: 0xc2452e }, pylon: 0x6b5c4c, rail: 0xb9b2a4,

    terrain: { rock: [.30, .27, .25], relief: 1.0, tint: 0.34 },
    /* Ground and scatter per ZONE. Colouring by altitude drifted; colouring by
       zone means the world changes where the course says it should. */
    /* Daniel: "the track is still fairly bare". The reason was here and not in
       the scatter system: FARM, VILLAGE, SNOW and SHORE are most of the course
       by distance and all four were tuned to almost nothing, so the stretches
       between the named set pieces were empty ground. Roughly tripled, with
       rocks doing the work where trees would be wrong. */
    zones: {
      snow:    { ground: [.74, .77, .83], trees: 0.10, rocks: 2.2, blds: 0.0 },
      forest:  { ground: [.19, .30, .20], trees: 2.10, rocks: 0.5, blds: 0.0 },
      rock:    { ground: [.37, .35, .32], trees: 0.30, rocks: 2.6, blds: 0.0 },
      farm:    { ground: [.53, .45, .23], trees: 1.05, rocks: 0.9, blds: 0.5 },
      village: { ground: [.36, .35, .31], trees: 0.62, rocks: 0.5, blds: 2.4 },
      shore:   { ground: [.47, .47, .45], trees: 0.45, rocks: 1.9, blds: 0.9 },
    },
    bld: [0xcfc3ad, 0xb9a88e, 0x9c8b74, 0x8a6f56], roof: 0x7a3a2c,
    scatter: {
      trees: 1500, rocks: 620, clump: 0.36, altHi: 0.80, altLo: 0.14,
      coneA: 0x4d6b47, coneB: 0x63794f, trunk: 0x5a4634, rockCol: 0x6d6459,
      tallH: 7.5, tallR: 2.2, shortH: 5.2, shortR: 2.9,
    },
    /* The long view: a sea to reach and ridges behind it. Baked pale so
       they read as distant whatever the fog is doing. */
    sea: 0x2f4a5c, ridge: [0.26, 0.30, 0.36],
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
    sky:  { zenith: [0.40, 0.50, 0.64], horizon: [0.82, 0.76, 0.66],
            ground: [0.26, 0.24, 0.22], glow: [0.90, 0.76, 0.52], glowPow: 12 },
    fog:  { color: 0xb9b09e, near: -30, far: 320 },
    sun:  { color: 0xffe6bd, intensity: 1.85, dir: [-0.62, 0.60, -0.50] },
    hemi: { sky: 0xb4c8dc, ground: 0x9a9078, intensity: 1.40 },

    road: { top: [0.19, 0.190, 0.185], wall: [0.12, 0.120, 0.117] },
    dash: 0xd6d0be, dashOn: true,
    post: { a: 0xe0d29a, b: 0x33322e }, pylon: 0x8e887c, rail: 0x8e8477,

    terrain: { rock: [.56, .53, .47], relief: 1.05, tint: 0.30 },
    zones: {
      snow:    { ground: [.66, .62, .54], trees: 0.05, rocks: 1.4, blds: 0.0 },
      forest:  { ground: [.44, .45, .32], trees: 0.90, rocks: 0.6, blds: 0.0 },
      rock:    { ground: [.58, .53, .40], trees: 0.10, rocks: 2.4, blds: 0.0 },
      farm:    { ground: [.62, .53, .33], trees: 0.25, rocks: 0.5, blds: 0.4 },
      village: { ground: [.50, .48, .42], trees: 0.10, rocks: 0.3, blds: 1.8 },
      shore:   { ground: [.55, .53, .47], trees: 0.05, rocks: 1.0, blds: 0.7 },
    },
    bld: [0xb8ac96, 0xa1937c, 0x8b7f6a, 0x6f6353], roof: 0x5c5346,
    scatter: {
      trees: 210, rocks: 520, clump: 0.55, altHi: 0.74, altLo: 0.06,
      coneA: 0x4a4b32, coneB: 0x565638, trunk: 0x4a4034, rockCol: 0x8b8478,
      tallH: 4.6, tallR: 1.7, shortH: 3.0, shortR: 2.1,
    },
    /* The long view: a sea to reach and ridges behind it. Baked pale so
       they read as distant whatever the fog is doing. */
    sea: 0x46545e, ridge: [0.36, 0.36, 0.34],
    cart: { body: 0x1f6f86, nose: 0xc9542c, rider: 0xe8e2d4, skin: 0xd9bfa0 },
    dust: 0xcfc7b6,
  },

  /* ------------------------------------------------------------------ */
  /* Glazed ice reads darker and bluer than the snow around it, which is
     the only thing keeping the road visible on a white mountain.        */
  ice: {
    exposure: 0.90,
    sky:  { zenith: [0.28, 0.42, 0.66], horizon: [0.72, 0.78, 0.88],
            ground: [0.34, 0.38, 0.46], glow: [0.85, 0.72, 0.72], glowPow: 7 },
    fog:  { color: 0xc3ccdb, near: -60, far: 250 },
    sun:  { color: 0xffd0c0, intensity: 1.55, dir: [-0.42, 0.44, -0.79] },
    hemi: { sky: 0xaed0f2, ground: 0x9aa6b6, intensity: 1.85 },

    road: { top: [0.40, 0.47, 0.58], wall: [0.24, 0.29, 0.38] },
    dash: 0xf0a24a, dashOn: true,
    post: { a: 0xf0a24a, b: 0x2a3550 }, pylon: 0x5d6675, rail: 0x8d99ac,

    terrain: { rock: [.26, .28, .33], relief: 1.15, tint: 0.20 },
    zones: {
      snow:    { ground: [.80, .84, .90], trees: 0.05, rocks: 0.9, blds: 0.0 },
      forest:  { ground: [.58, .64, .72], trees: 1.20, rocks: 0.5, blds: 0.0 },
      rock:    { ground: [.50, .54, .62], trees: 0.15, rocks: 2.2, blds: 0.0 },
      farm:    { ground: [.68, .72, .80], trees: 0.30, rocks: 0.4, blds: 0.4 },
      village: { ground: [.62, .66, .74], trees: 0.15, rocks: 0.2, blds: 1.8 },
      shore:   { ground: [.56, .62, .72], trees: 0.05, rocks: 0.8, blds: 0.8 },
    },
    bld: [0x9aa6b4, 0x84909e, 0x6f7a88, 0x5b6674], roof: 0x3d4652,
    scatter: {
      trees: 430, rocks: 300, clump: 0.48, altHi: 0.66, altLo: 0.06,
      coneA: 0x2c4038, coneB: 0x36473c, trunk: 0x3a3630, rockCol: 0x545c68,
      tallH: 8.5, tallR: 2.0, shortH: 5.6, shortR: 2.6,
    },
    /* The long view: a sea to reach and ridges behind it. Baked pale so
       they read as distant whatever the fog is doing. */
    sea: 0x46607a, ridge: [0.34, 0.40, 0.52],
    cart: { body: 0xd8442e, nose: 0x8f2a1c, rider: 0x24303f, skin: 0xe8d2b4 },
    dust: 0xeaf1f8,
  },
};

export const get = (name) => THEMES[name] || THEMES.alpine;

/* ============================================================================
   The descent as a day.

   A single run drops 460 m from a snowline to a harbour, and until now it did
   that under one unchanging light — which is most of why every part of the
   course looked like every other part. The light now runs a continuous arc
   keyed to how far DOWN you are, so you can tell your progress from the colour
   alone before you read a single number:

       0.00  the summit    cold, blue, the sun barely up behind you
       0.45  the treeline  the sun clears the ridge; warm, long shadows
       0.75  the terraces  low gold, the richest light of the run
       1.00  the quay      dusk coming off the water

   `late` is the season's own arc laid on top: run 8 is later in the year than
   run 1, so the same descent finishes darker. The road failing and the light
   going are the same story told twice.
   ========================================================================== */
const KEYS = [
  /* Desaturated after playtest. At [0.62,0.72,0.95] with a matching blue hemi
     the summit tinted EVERYTHING the same blue-grey — tarmac, snow and all five
     karts — so the whole opening read as one colour. The value arc is the point
     of this table; the hue swing only has to hint. */
  { at: 0.00, sun: [0.82, 0.87, 0.99], sunI: 1.35, elev: 0.94, az: -0.52,
    skyZen: [0.20, 0.32, 0.55], skyHor: [0.70, 0.75, 0.83],
    hemiSky: 0xbcccdd, hemiGnd: 0x9c9c9e, fog: 0xc2c8d2, expo: 1.04 },
  { at: 0.45, sun: [1.00, 0.90, 0.74], sunI: 2.15, elev: 0.66, az: -0.60,
    skyZen: [0.34, 0.50, 0.70], skyHor: [0.86, 0.79, 0.68],
    hemiSky: 0xa9cbe8, hemiGnd: 0x9c9078, fog: 0xc7bda9, expo: 1.12 },
  { at: 0.78, sun: [1.00, 0.84, 0.63], sunI: 2.30, elev: 0.34, az: -0.72,
    skyZen: [0.30, 0.42, 0.64], skyHor: [0.98, 0.76, 0.52],
    hemiSky: 0xb8cbe0, hemiGnd: 0xb09274, fog: 0xd8b894, expo: 1.14 },
  /* Dusk, but a dusk you can still DRIVE. The first pass at 1.45/0x8a7864 put
     the quay's tarmac near black — atmospheric, and unreadable at 58 mph. */
  { at: 1.00, sun: [1.00, 0.78, 0.62], sunI: 1.95, elev: 0.21, az: -0.86,
    skyZen: [0.19, 0.26, 0.44], skyHor: [0.94, 0.68, 0.54],
    hemiSky: 0xa8bacf, hemiGnd: 0xa89684, fog: 0xc9b0a0, expo: 1.14 },
];

const mixN = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mixHex = (a, b, t) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16 | (ag + (bg - ag) * t) << 8 | (ab + (bb - ab) * t)) & 0xffffff;
};

export function daylight(t, late = 0) {
  const u = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < KEYS.length - 2 && u > KEYS[i + 1].at) i++;
  const A = KEYS[i], B = KEYS[i + 1];
  const k = Math.max(0, Math.min(1, (u - A.at) / (B.at - A.at || 1)));
  /* Smoothstep between keys: a linear blend of light shows a visible crease at
     every keyframe, and there is nothing in the world to hide it behind. */
  const f = k * k * (3 - 2 * k);
  /* The season's dimming. Kept gentle — this is a mood, and a run you cannot
     see is not atmospheric, it is broken. */
  const dim = 1 - 0.20 * Math.max(0, Math.min(1, late));
  const warm = 0.10 * Math.max(0, Math.min(1, late));
  return {
    sun: mixN(A.sun, B.sun, f),
    sunI: (A.sunI + (B.sunI - A.sunI) * f) * dim,
    elev: A.elev + (B.elev - A.elev) * f - 0.10 * late,
    az: A.az + (B.az - A.az) * f,
    skyZen: mixN(A.skyZen, B.skyZen, f).map((v) => v * dim),
    skyHor: mixN(A.skyHor, B.skyHor, f),
    hemiSky: mixHex(A.hemiSky, B.hemiSky, f),
    hemiGnd: mixHex(A.hemiGnd, B.hemiGnd, f),
    fog: mixHex(A.fog, B.fog, f),
    expo: (A.expo + (B.expo - A.expo) * f) * (1 - 0.06 * late) + warm * 0,
  };
}
