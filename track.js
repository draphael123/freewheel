/* ============================================================================
   FREEWHEEL — courses.

   A course is a declarative array of segments and nothing else. Everything the
   world needs is derived from the centreline it produces: the hillside, the cut
   walls, the pylons, where trees clump, the altitude bands. That is the whole
   reason a new venue is cheap — it is one array and one palette, not a level.

   The centreline is integrated at a fixed arc step rather than fitted to a
   spline: grade is the subject of this game, so grade is authored directly.
   Pitch and curvature then fall out of finite differences on the points we
   actually built, which means the physics can never disagree with the mesh.

   Module state is rebuilt in place by load(). The exports are `let`, so ES
   module live bindings hand importers the current course without anyone having
   to thread a track object through every call.
   ========================================================================== */

export const STEP = 0.5;                       // metres between samples

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* --------------------------------------------------------------------------
   The venues. Each owns a MECHANICAL identity, not a palette — if two courses
   ask the same thing of the player they are the same course wearing different
   paint, however different the screenshots look.
   -------------------------------------------------------------------------- */
export const COURSES = {
  vale: {
    title: 'THE VALE',
    blurb: 'A real road. Pinches, a chicane and two hairpins — lift out of the tuck or you will run wide.',
    owns: 'line choice',
    theme: 'alpine',
    halfW: 8.0, slab: 1.4, grip: 1.0,
    segments: [
      { name: 'THE GATE',    len:  60, turn:    0, grade: -0.12, w: 8.0 },
      { name: 'FIRST DROP',  len: 100, turn:  -30, grade: -0.32, w: 7.5 },
      { name: 'THE NARROWS', len:  90, turn:   45, grade: -0.16, w: 5.2 },
      { name: 'THE LEAP',    len: 110, turn:    0, grade: -0.14, w: 7.5, step: 9.0 },
      { name: 'HAIRPIN L',   len: 100, turn: -160, grade: -0.18, w: 8.5, bank: 10 },
      { name: 'THE ESSES',   len: 150, turn:   10, grade: -0.20, w: 6.4, esses: 3, essAmp: 26 },
      { name: 'THE SWEEP',   len: 170, turn:   85, grade: -0.19, w: 9.0, bank: 12 },
      { name: 'THE PINCH',   len:  70, turn:  -20, grade: -0.10, w: 4.6 },
      { name: 'THE STAIRS',  len: 120, turn:   25, grade: -0.22, w: 7.5, stairs: 3, stairH: 4.5 },
      { name: 'HAIRPIN R',   len: 100, turn:  150, grade: -0.16, w: 8.5, bank: 10 },
      { name: 'THE RUN IN',  len: 140, turn:  -35, grade: -0.13, w: 8.0 },
    ],
  },

  spillway: {
    title: 'THE SPILLWAY',
    blurb: 'Concrete at bowl scale. The curvature is tight enough to pump for real — work the transitions.',
    owns: 'the pump',
    theme: 'concrete',
    halfW: 11.0, slab: 2.2, grip: 1.05,
    segments: [
      { name: 'THE HEADRACE',  len:  90, turn:    0, grade: -0.12 },
      { name: 'FIRST BOWL',    len: 120, turn:   10, grade: -0.10, dip: 5.5 },
      { name: 'THE WASHBOARD', len: 220, turn:  -12, grade: -0.13, bowls: 7, bowlAmp: 0.85 },
      { name: 'THE WEIR',      len: 110, turn:    0, grade: -0.14, step: 9.0 },
      { name: 'THE BEND',      len: 140, turn:  -95, grade: -0.16, bank: 22 },
      { name: 'THE COMBS',     len: 240, turn:   15, grade: -0.14, bowls: 8, bowlAmp: 0.80 },
      { name: 'THE SIPHON',    len:  90, turn:   60, grade: +0.04, bank: 14 },
      { name: 'DROP SHAFT',    len: 130, turn:    0, grade: -0.20, stairs: 3, stairH: 7.0 },
      { name: 'THE FLUME',     len: 260, turn:  -70, grade: -0.18, bank: 18, bowls: 6, bowlAmp: 0.90 },
      { name: 'THE OUTFALL',   len: 160, turn:   25, grade: -0.05 },
    ],
  },

  coldline: {
    title: 'THE COLD LINE',
    blurb: 'Almost no grip. Braking barely works and the corners will not hold you — commit early.',
    owns: 'grip',
    theme: 'ice',
    halfW: 10.0, slab: 1.6, grip: 0.42,
    segments: [
      { name: 'THE CORNICE',  len: 110, turn:    0, grade: -0.16 },
      { name: 'THE FACE',     len: 160, turn:  -40, grade: -0.30 },
      { name: 'THE TRAVERSE', len: 260, turn:   85, grade: -0.11, bank: 5 },
      { name: 'THE SERACS',   len: 140, turn:  -20, grade: -0.18, stairs: 3, stairH: 5.5 },
      { name: 'THE BOWL',     len: 200, turn:  120, grade: -0.15, bank: 12, dip: 7.0 },
      { name: 'THE NARROWS',  len: 150, turn:  -60, grade: -0.22, grip: 0.34 },
      { name: 'THE SHELF',    len: 120, turn:   30, grade: +0.05 },
      { name: 'THE DRIFT',    len: 240, turn:  -80, grade: -0.12, bank: 6, rollers: 3, rollAmp: 3.0 },
      { name: 'THE LAKE',     len: 200, turn:   20, grade: -0.04, grip: 0.28 },
    ],
  },
};

export const COURSE_IDS = Object.keys(COURSES);

/* What each modifier adds to the base height, as a function of a = t/len.

   Every shape here is a raised cosine, because a raised cosine is zero AND
   flat at both ends. A plain sine is zero at the ends but arrives at full
   slope, which welds a kink into the road exactly where two segments meet —
   and a kink is an infinite curvature spike, which the pump physics reads as
   an enormous load and the cart reads as being fired into the sky.

   Modifiers that do not return to zero at a=1 (steps and stairs) are carried
   into the running base height so the surface still joins. */
function extraY(seg, a) {
  const hump = (n) => 0.5 * (1 - Math.cos(2 * Math.PI * n * a));
  let y = 0;
  if (seg.dip)     y += -seg.dip   * hump(1);
  if (seg.crest)   y +=  seg.crest * hump(1);
  if (seg.rollers) y += -seg.rollAmp * hump(seg.rollers);
  /* Bowls: tight compressions with FLAT road between them, which is what a
     skatepark actually is. A sinusoid's crests are exactly as tight as its
     compressions, so a washboard fast enough to pump hard is also a washboard
     that throws you into the air on every other metre — measured at 25% of the
     course airborne, where you can neither pump nor steer. */
  if (seg.bowls) {
    const n = seg.bowls, w = seg.bowlWidth ?? 0.55;
    const t = (a * n) % 1, lo = 0.5 - w / 2;
    if (t > lo && t < lo + w) {
      y += -seg.bowlAmp * 0.5 * (1 - Math.cos(2 * Math.PI * (t - lo) / w));
    }
  }
  if (seg.step)    y += -seg.step  * smoothstep(0.44, 0.56, a);
  if (seg.stairs) {                       // a flight of drops, not one cliff
    for (let k = 0; k < seg.stairs; k++) {
      y += -seg.stairH * smoothstep((k + 0.34) / seg.stairs, (k + 0.62) / seg.stairs, a);
    }
  }
  return y;
}

/* Grade is blended over the first BLEND of a segment so a change of gradient is
   a transition rather than a hinge. Same reason as the raised cosines above.
   Grip and bank are blended the same way — an instant change of either reads
   as the cart hitting a wall it cannot see. */
const BLEND = 0.14;
const ramp = (from, to, a) => (a >= BLEND ? to : from + (to - from) * smoothstep(0, 1, a / BLEND));

/* --------------------------------------------------------------------------
   Live bindings. Reassigned by load(); importers see the current course.
   -------------------------------------------------------------------------- */
export let ID, TITLE, BLURB, OWNS, THEME, HALF_W, SLAB;
export let PTS, LENGTH, NAMES, TOP_Y, BOT_Y;

export function load(id) {
  const C = COURSES[id] || COURSES[COURSE_IDS[0]];
  ID = COURSES[id] ? id : COURSE_IDS[0];
  TITLE = C.title; BLURB = C.blurb; OWNS = C.owns; THEME = C.theme;
  SLAB = C.slab;
  HALF_W = Math.max(C.halfW, ...C.segments.map((g) => g.w ?? C.halfW));
  NAMES = C.segments.map((s) => s.name);

  const pts = [];
  let x = 0, z = 0, heading = 0, s = 0, base = 0;
  /* Esses snake the HEADING rather than the position, windowed so both the
     offset and its rate vanish at the segment ends — an un-windowed sine leaves
     a curvature step at the join, which the cart feels as a kerb it cannot
     see. */
  const essAt = (seg, a) => (!seg.esses ? 0
    : (seg.essAmp * Math.PI / 180)
      * Math.sin(2 * Math.PI * seg.esses * a)
      * 0.5 * (1 - Math.cos(2 * Math.PI * a)));
  let prevGrade = 0, prevGrip = C.grip, prevBank = 0, prevW = C.halfW;

  C.segments.forEach((seg, si) => {
    const turnPerM = (seg.turn * Math.PI / 180) / seg.len;
    const grip = seg.grip ?? C.grip;
    const bank = (seg.bank ?? 0) * Math.PI / 180;
    const w = seg.w ?? C.halfW;
    const n = Math.round(seg.len / STEP);
    for (let i = 0; i < n; i++) {
      const a = i / n;
      pts.push({
        x, y: base + extraY(seg, a), z, s, seg: si,
        grip: ramp(prevGrip, grip, a),
        bankMag: ramp(prevBank, bank, a),
        halfW: ramp(prevW, w, a),
      });
      const hd = heading + essAt(seg, a);
      heading += turnPerM * STEP;
      base += ramp(prevGrade, seg.grade, a) * STEP;
      x += Math.cos(hd) * STEP;
      z += Math.sin(hd) * STEP;
      s += STEP;
    }
    base += extraY(seg, 1);                    // carry any net drop forward
    prevGrade = seg.grade; prevGrip = grip; prevBank = bank; prevW = w;
  });
  pts.push({
    x, y: base, z, s, seg: C.segments.length - 1,
    grip: prevGrip, bankMag: prevBank, halfW: prevW,
  });

  /* Frames. Pitch is signed: negative descends. Vertical curvature is the rate
     of change of pitch along the road — positive means the road is bending
     upward under you, which is a compression, which is load. That sign is the
     whole pump mechanic, so it is worth naming loudly. */
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const flat = Math.hypot(dx, dz) || 1e-6;
    pts[i].pitch = Math.atan2(dy, flat);
    pts[i].head = Math.atan2(dz, dx);
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const span = (Math.min(pts.length - 1, i + 1) - Math.max(0, i - 1)) * STEP || STEP;
    let dh = b.head - a.head;
    while (dh >  Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    pts[i].kv = (b.pitch - a.pitch) / span;    // + = compression
    pts[i].kh = dh / span;                     // + = left turn
  }
  /* Banking is authored as a magnitude and signed here by the corner it sits
     in, so a course author can never accidentally bank a corner the wrong way
     — which is the one mistake that would make a track actively hostile. */
  for (const p of pts) p.bank = p.bankMag * Math.sign(p.kh);

  PTS = pts;
  LENGTH = pts[pts.length - 1].s;
  TOP_Y = Math.max(...pts.map((p) => p.y));
  BOT_Y = Math.min(...pts.map((p) => p.y));
  return ID;
}

/* --------------------------------------------------------------------------
   Queries. Linear interpolation between samples; at 0.5 m spacing the error is
   far below anything the player can feel and it keeps them branch-free.
   -------------------------------------------------------------------------- */
const idxAt = (s) => Math.min(PTS.length - 1, Math.max(0, s / STEP));

function lerpField(s, key) {
  const f = idxAt(s), i = Math.floor(f), t = f - i;
  const j = Math.min(PTS.length - 1, i + 1);
  if (key === 'head') {                        // angles need wrap-safe blending
    let d = PTS[j].head - PTS[i].head;
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return PTS[i].head + d * t;
  }
  return PTS[i][key] + (PTS[j][key] - PTS[i][key]) * t;
}

export const pitchAt = (s) => lerpField(s, 'pitch');
export const headAt  = (s) => lerpField(s, 'head');
export const kvAt    = (s) => lerpField(s, 'kv');
export const khAt    = (s) => lerpField(s, 'kh');
export const gripAt  = (s) => lerpField(s, 'grip');
export const bankAt  = (s) => lerpField(s, 'bank');
/* Road half-width VARIES along a course. A pinch is the cheapest way to turn a
   corner into a decision, and it costs one number per segment. HALF_W is kept
   as the course maximum, for anything that needs a fixed envelope. */
export const halfWAt = (s) => lerpField(s, 'halfW');
export const segAt   = (s) => PTS[Math.round(idxAt(s))].seg;

/* World position of the road surface at distance s, offset u metres to the
   rider's right. Banking raises the outside of the corner, so the surface the
   cart sits on is not flat across the road. */
export function surfaceAt(s, u = 0) {
  const f = idxAt(s), i = Math.floor(f), t = f - i;
  const j = Math.min(PTS.length - 1, i + 1);
  const A = PTS[i], B = PTS[j];
  const h = headAt(s);
  return {
    x: A.x + (B.x - A.x) * t - Math.sin(h) * u,
    y: A.y + (B.y - A.y) * t + u * Math.sin(bankAt(s)),
    z: A.z + (B.z - A.z) * t + Math.cos(h) * u,
  };
}

load(COURSE_IDS[0]);
