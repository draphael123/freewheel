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
    blurb: 'Snowline to sea in one run — pinewood, a gorge span, a rock adit, terraces and the village street.',
    owns: 'line choice',
    theme: 'alpine',
    halfW: 8.0, slab: 1.4, grip: 1.0,
    /* A journey, not a list of corners. `zone` is what makes a course feel like
       somewhere rather than a ribbon: it drives ground colour, what is scattered
       beside the road and where the buildings are, so the world changes under
       you at authored moments instead of drifting with altitude. */
    segments: [
      { name: 'THE GATE',     len:  90, turn:    0, grade: -0.10, w: 9.0, zone: 'snow' },
      { name: 'THE CORNICE',  len: 170, turn:   55, grade: -0.14, w: 9.5, zone: 'snow', grip: 0.72, bank: 6 },
      { name: 'THE CLOUD DECK',len: 170, turn:   30, grade: -0.06, w: 7.5, zone: 'snow', skyroad: true },
      { name: 'STEEP DROP',   len: 140, turn:  -35, grade: -0.34, w: 7.5, zone: 'snow' },
      { name: 'THE PINEWOOD', len: 200, turn:   70, grade: -0.18, w: 5.8, zone: 'forest' },
      { name: 'THE LEAP',     len: 120, turn:  -15, grade: -0.15, w: 7.0, zone: 'forest', step: 10.0 },
      { name: 'HAIRPIN L',    len: 110, turn: -165, grade: -0.19, w: 8.5, zone: 'forest', bank: 11 },
      { name: 'THE SPAN',     len: 150, turn:   20, grade: -0.09, w: 6.0, zone: 'rock', bridge: true },
      { name: 'THE ESSES',    len: 170, turn:   10, grade: -0.20, w: 6.6, zone: 'rock', esses: 3, essAmp: 24 },
      { name: 'THE ADIT',     len: 130, turn:  -40, grade: -0.16, w: 6.2, zone: 'rock', tunnel: true },
      { name: 'THE TERRACES', len: 190, turn:   60, grade: -0.21, w: 8.0, zone: 'farm', stairs: 3, stairH: 5.0 },
      { name: 'THE MILL',     len: 120, turn:  -20, grade: -0.15, w: 6.8, zone: 'farm', hall: true },
      { name: 'THE SWEEP',    len: 200, turn:   95, grade: -0.18, w: 9.5, zone: 'farm', bank: 13 },
      { name: 'THE PINCH',    len:  80, turn:  -25, grade: -0.11, w: 4.6, zone: 'village' },
      { name: 'THE VILLAGE',  len: 190, turn:   45, grade: -0.14, w: 6.4, zone: 'village' },
      { name: 'THE STEPS',    len: 130, turn:  -30, grade: -0.24, w: 7.0, zone: 'village', stairs: 3, stairH: 4.0 },
      { name: 'HAIRPIN R',    len: 110, turn:  155, grade: -0.15, w: 8.5, zone: 'village', bank: 11 },
      { name: 'THE QUAY',     len: 200, turn:  -45, grade: -0.07, w: 9.0, zone: 'shore' },
    ],
    /* Forks. A fork is a stretch of the SPINE where the road exists at two
       different lateral offsets. You drive one; the other is built as geometry
       you can see and not take.

       They are lateral deviations rather than separate centrelines for one
       reason: two independently-integrated branches end at different points in
       space and will not rejoin, and hand-authoring a displacement match is
       miserable. A raised-cosine offset returns to zero with zero slope at both
       ends, so the branches rejoin by construction. The load() pass bakes the
       chosen offset into the centreline and then RESAMPLES to true arc length,
       so a branch that swings wide really is longer to drive — without that the
       whole shorter-vs-longer trade would be a lie. */
    forks: [
      { id: 'cornice', from: 430, to: 570, prompt: 'the drop, or around it',
        branches: [
          { id: 'drop', name: 'THE DROP', side: -1, bulge: 4, w: 5.2,
            grip: 0.72, bank: 2, note: 'straight down the fall line' },
          { id: 'traverse', name: 'THE TRAVERSE', side: 1, bulge: 24, w: 10.5,
            grip: 1.10, bank: 15, note: 'long way round, but it holds' },
        ] },
      { id: 'terrace', from: 1450, to: 1640, prompt: 'over the terraces, or the flume',
        branches: [
          { id: 'terraces', name: 'THE TERRACES', side: 1, bulge: 6, w: 6.2,
            grip: 0.80, bank: 3, note: 'stepped, and it drops under you' },
          { id: 'flume', name: 'THE FLUME', side: -1, bulge: 19, w: 9.0,
            grip: 1.10, bank: 17, note: 'the old water channel — banked all the way' },
        ] },
      { id: 'wynd', from: 2230, to: 2360, prompt: 'the steps, or the wynd',
        branches: [
          { id: 'steps', name: 'THE STEPS', side: -1, bulge: 5, w: 5.6,
            grip: 0.76, bank: 3, note: 'straight down through the town' },
          { id: 'wynd', name: 'THE WYND', side: 1, bulge: 17, w: 9.2,
            grip: 1.08, bank: 12, note: 'round behind the houses' },
        ] },
    ],
    hazards: [
      { s: 480, u: -3.0 }, { s: 494, u: 0.6 },
      { s: 560, u:  2.0 },
      { s: 690, u: -2.4 }, { s: 702, u: 1.2 },
      { s: 940, u: 1.8 },
      { s: 1180, u: -2.2 }, { s: 1194, u: 1.4 },
      { s: 1470, u: 2.6 },
      { s: 1620, u: -3.4 },
      { s: 1880, u: 1.0 }, { s: 1892, u: -2.6 },
      { s: 2080, u: -1.2 },
    ],
  },

  spillway: {
    title: 'THE SPILLWAY',
    blurb: 'Concrete at scale. The banking is what lets you hold corners nothing else could — trust it, or brake for the pinches.',
    owns: 'banking',
    theme: 'concrete',
    halfW: 11.0, slab: 2.2, grip: 1.05,
    /* Identity: BANKING. Bank relieves the corner directly (push = v^2*kh -
       g*sin(bank)), so a heavily banked bowl can be carried at a speed that
       would be impossible flat. The course alternates huge banked sweeps with
       narrow UNBANKED pinches, so the decision is whether the next corner is
       one you can lean on or one you have to slow for.

       It used to own "the pump", a mechanic that no longer exists — the card
       in the picker was advertising something the game could not do. */
    segments: [
      { name: 'THE HEADRACE',   len: 110, turn:    0, grade: -0.10, w: 11.0, zone: 'rock' },
      { name: 'THE INTAKE',     len: 150, turn:   40, grade: -0.16, w:  9.0, zone: 'rock', bank: 16 },
      { name: 'FIRST BOWL',     len: 170, turn: -120, grade: -0.14, w: 12.0, zone: 'rock', bank: 30 },
      { name: 'THE CHANNEL',    len: 200, turn:   25, grade: -0.20, w:  7.5, zone: 'rock' },
      { name: 'THE WEIR',       len: 130, turn:    0, grade: -0.16, w: 10.0, zone: 'rock', step: 12.0 },
      { name: 'THE GREAT BEND', len: 220, turn:  150, grade: -0.15, w: 13.0, zone: 'village', bank: 32 },
      { name: 'THE SLUICE',     len: 100, turn:  -30, grade: -0.12, w:  5.0, zone: 'village' },
      { name: 'DROP SHAFT',     len: 150, turn:    0, grade: -0.24, w:  9.0, zone: 'rock', stairs: 3, stairH: 7.0 },
      { name: 'THE SPIRAL',     len: 240, turn: -190, grade: -0.18, w: 11.0, zone: 'rock', bank: 28 },
      { name: 'THE APRON',      len: 180, turn:   60, grade: -0.13, w: 12.0, zone: 'farm', bank: 10 },
      { name: 'THE CHUTE',      len: 140, turn:  -45, grade: -0.34, w:  8.0, zone: 'farm' },
      { name: 'STILLING BASIN', len: 200, turn:  110, grade: -0.09, w: 14.0, zone: 'shore', bank: 22 },
      { name: 'THE OUTFALL',    len: 190, turn:  -50, grade: -0.05, w: 10.0, zone: 'shore' },
    ],
    hazards: [
      { s: 300, u: -3.4 }, { s: 314, u: 1.2 },
      { s: 640, u: 2.6 },
      { s: 800, u: -2.0 }, { s: 814, u: 2.2 },
      { s: 1090, u: -1.4 },
      { s: 1300, u: 3.0 }, { s: 1316, u: -1.0 },
      { s: 1610, u: 2.4 },
      { s: 1790, u: -3.0 },
      { s: 2050, u: 1.6 },
    ],
  },

  coldline: {
    title: 'THE COLD LINE',
    blurb: 'Almost no grip, and less on the black ice. Braking barely works and the corners will not hold you — commit early.',
    owns: 'grip',
    theme: 'ice',
    halfW: 10.0, slab: 1.6, grip: 0.42,
    /* Identity: GRIP, varied along the course rather than set once. The
       treeline and the hamlet are the only places you can lean on the tyres;
       BLACK ICE and THE LAKE are where you find out what you have banked. */
    segments: [
      { name: 'THE CORNICE',  len: 130, turn:    0, grade: -0.14, w: 10.0, zone: 'snow',    grip: 0.46 },
      { name: 'THE FACE',     len: 180, turn:  -45, grade: -0.30, w:  9.0, zone: 'snow',    grip: 0.42 },
      { name: 'THE TRAVERSE', len: 240, turn:   90, grade: -0.10, w:  8.0, zone: 'snow',    grip: 0.40, bank: 8 },
      { name: 'THE SERACS',   len: 160, turn:  -25, grade: -0.19, w:  7.5, zone: 'snow',    stairs: 3, stairH: 5.5 },
      { name: 'THE TREELINE', len: 200, turn:   70, grade: -0.17, w:  6.5, zone: 'forest',  grip: 0.54 },
      { name: 'THE GULLY',    len: 150, turn: -140, grade: -0.22, w:  6.0, zone: 'forest',  grip: 0.44, bank: 9 },
      { name: 'THE HAMLET',   len: 170, turn:   55, grade: -0.12, w:  7.0, zone: 'village', grip: 0.52 },
      { name: 'BLACK ICE',    len: 140, turn:  -60, grade: -0.16, w:  9.0, zone: 'snow',    grip: 0.26 },
      { name: 'THE SHELF',    len: 130, turn:   35, grade: +0.04, w:  8.5, zone: 'snow',    grip: 0.44 },
      { name: 'THE DRIFT',    len: 220, turn:  -95, grade: -0.15, w:  9.5, zone: 'snow',    grip: 0.42, bank: 7 },
      { name: 'THE LAKE',     len: 260, turn:   45, grade: -0.04, w: 12.0, zone: 'shore',   grip: 0.30 },
    ],
    hazards: [
      { s: 260, u: 2.4 },
      { s: 470, u: -2.8 }, { s: 484, u: 0.8 },
      { s: 760, u: 2.0 },
      { s: 960, u: -1.6 }, { s: 974, u: 2.2 },
      { s: 1200, u: -2.4 },
      { s: 1420, u: 1.8 },
      { s: 1660, u: -2.6 }, { s: 1674, u: 1.0 },
      { s: 1880, u: 2.8 },
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
export let PTS, LENGTH, NAMES, TOP_Y, BOT_Y, HAZARDS;
/* The fork table for the loaded course, and the route actually driven. */
export let FORKS = [], ROUTE = {};
let SPINE = null;

/* The centreline of any branch, chosen or not, in world space. This is what
   lets the renderer show you the road you turned down. */
export function branchPolyline(forkId, branchId, step = 3) {
  const f = FORKS.find((k) => k.id === forkId);
  if (!f || !SPINE) return [];
  const b = branchOf(f, branchId);
  const span = f.to - f.from;
  const out = [];
  for (let t = f.from; t <= f.to; t += step) {
    const i = Math.round(t / STEP);
    const p = SPINE[Math.min(SPINE.length - 1, Math.max(0, i))];
    if (!p) continue;
    const k = bump((t - f.from) / span);
    const off = b.side * b.bulge * k;
    out.push({
      x: p.x + p.rx * off, y: p.y, z: p.z + p.rz * off,
      w: p.halfW + ((b.w != null ? b.w : p.halfW) - p.halfW) * k,
      k,
    });
  }
  return out;
}

export const forksOf = (id) => (COURSES[id] || {}).forks || [];
export const defaultRoute = (id) => {
  const r = {};
  for (const f of forksOf(id)) r[f.id] = f.branches[0].id;
  return r;
};
export const branchOf = (fork, bid) =>
  fork.branches.find((b) => b.id === bid) || fork.branches[0];

/* Raised cosine: 0 at a=0, 1 at a=0.5, 0 at a=1, with ZERO SLOPE at both ends.
   The zero slope is the point — a plain sine leaves a curvature step where the
   branch meets the spine, and the cart feels that as a kerb it cannot see. */
const bump = (a) => (a <= 0 || a >= 1) ? 0 : 0.5 * (1 - Math.cos(2 * Math.PI * a));

export function load(id, route) {
  const C = COURSES[id] || COURSES[COURSE_IDS[0]];
  ID = COURSES[id] ? id : COURSE_IDS[0];
  TITLE = C.title; BLURB = C.blurb; OWNS = C.owns; THEME = C.theme;
  SLAB = C.slab;
  HALF_W = Math.max(C.halfW, ...C.segments.map((g) => g.w ?? C.halfW));
  NAMES = C.segments.map((s) => s.name);
  HAZARDS = (C.hazards || []).map((h) => ({ ...h, hit: false }));

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
        zone: seg.zone || 'forest',
        tunnel: !!seg.tunnel, bridge: !!seg.bridge,
        skyroad: !!seg.skyroad, hall: !!seg.hall,
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
    zone: C.segments[C.segments.length - 1].zone || 'forest', tunnel: false, bridge: false,
    skyroad: false, hall: false,
  });

  /* ---- forks ------------------------------------------------------------
     Displace the spine laterally for the chosen branch, override its character
     over the same range, then resample. Frames are computed AFTER this, from
     finite differences on the points we actually kept, so the curvature of a
     bulging branch is real and the physics can never disagree with the mesh. */
  FORKS = C.forks || [];
  ROUTE = {};
  /* Right-of-travel for every point of the UNDISPLACED spine, computed up front.
     Deriving it from neighbours while displacing reads points that have already
     moved, so the offset compounds into itself — the first version of this made
     a 2670 m course measure 23 km. */
  const rgt = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(pts.length - 1, i + 1)];
    const hx = q1.x - q0.x, hz = q1.z - q0.z;
    const hl = Math.hypot(hx, hz) || 1e-6;
    rgt[i * 2] = -hz / hl; rgt[i * 2 + 1] = hx / hl;
  }
  /* Keep the undisplaced spine. The roads you did NOT take have to be drawn,
     and they cannot be recovered from PTS once a branch has been baked in and
     the whole thing resampled. */
  SPINE = pts.map((p, i) => ({
    x: p.x, y: p.y, z: p.z, s: p.s,
    rx: rgt[i * 2], rz: rgt[i * 2 + 1], halfW: p.halfW,
  }));
  for (const f of FORKS) {
    /* A route entry is either a branch id, or {id, grip, width} carrying the
       season's wear factors. track.js deliberately does not know what wear IS
       — season.js owns that curve — it only knows how to apply a multiplier. */
    const want = route && route[f.id];
    const wantId = typeof want === 'string' ? want : (want && want.id);
    const wGrip = (want && want.grip != null) ? want.grip : 1;
    const wWide = (want && want.width != null) ? want.width : 1;
    const b = branchOf(f, wantId);
    ROUTE[f.id] = b.id;

    const span = f.to - f.from;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.s < f.from || p.s > f.to) continue;
      const k = bump((p.s - f.from) / span);
      const rx = rgt[i * 2], rz = rgt[i * 2 + 1];
      const off = b.side * b.bulge * k;
      p.x += rx * off; p.z += rz * off;
      /* Character. Blended in on the same bump so a branch does not snap to a
         different grip halfway through the join. */
      const bw = (b.w != null ? b.w : p.halfW) * wWide;
      const bg = (b.grip != null ? b.grip : p.grip) * wGrip;
      p.halfW = p.halfW + (bw - p.halfW) * k;
      p.grip = p.grip + (bg - p.grip) * k;
      if (b.bank != null) p.bankMag = p.bankMag + (b.bank * Math.PI / 180 - p.bankMag) * k;
      if (k > 0.02) p.label = b.name;
    }
  }

  /* ---- resample to true arc length --------------------------------------
     Displacing the centreline changes how far there is to drive, and the whole
     point of a fork is that the wide line COSTS you something. Leaving s as the
     spine parameter would have made the long way round free. */
  if (FORKS.length) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(
        pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    }
    const total = cum[cum.length - 1];
    const out = [];
    let j = 0;
    for (let t = 0; t <= total; t += STEP) {
      while (j < cum.length - 2 && cum[j + 1] < t) j++;
      const seg = (cum[j + 1] - cum[j]) || 1e-6;
      const u = Math.min(1, Math.max(0, (t - cum[j]) / seg));
      const A = pts[j], B = pts[Math.min(pts.length - 1, j + 1)];
      const mix = (k) => A[k] + (B[k] - A[k]) * u;
      out.push({
        x: mix('x'), y: mix('y'), z: mix('z'), s: t,
        seg: u < 0.5 ? A.seg : B.seg,
        grip: mix('grip'), bankMag: mix('bankMag'), halfW: mix('halfW'),
        zone: u < 0.5 ? A.zone : B.zone,
        tunnel: u < 0.5 ? A.tunnel : B.tunnel,
        bridge: u < 0.5 ? A.bridge : B.bridge,
        skyroad: u < 0.5 ? A.skyroad : B.skyroad,
        hall: u < 0.5 ? A.hall : B.hall,
        label: u < 0.5 ? A.label : B.label,
      });
    }
    pts.length = 0;
    Array.prototype.push.apply(pts, out);
  }

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
const at = (s) => PTS[Math.round(Math.min(PTS.length - 1, Math.max(0, s / STEP)))];
export const zoneAt   = (s) => at(s).zone;
export const tunnelAt = (s) => at(s).tunnel;
export const bridgeAt  = (s) => at(s).bridge;
export const skyroadAt = (s) => at(s).skyroad;
export const hallAt    = (s) => at(s).hall;

/* Hazards within reach of a cart. A linear scan is fine — a course has a dozen
   of these, and an index would cost more to keep honest than it saves. */
/* Where the BARRIER actually is. The painted road is halfW wide; the guard rail
   is built 1.16 m beyond that, on the shoulder. The physics used to stop you at
   halfW, so you were held by nothing a metre short of the rail you could see —
   which read as an invisible wall, and meant the roadside posts out on the
   shoulder could never be touched. One number, two complaints. */
export const VERGE = 1.16;
export const wallAt = (s) => lerpField(s, 'halfW') + VERGE;

export const HAZARD_R = 1.9;
export function hazardsNear(s, span = 4) {
  const out = [];
  for (const h of HAZARDS) if (Math.abs(h.s - s) < span) out.push(h);
  return out;
}
export const segAt   = (s) => PTS[Math.round(idxAt(s))].seg;
/* The name of where you are. Not NAMES[segAt(s)] any more: a fork branch is a
   place with its own name that does not correspond to a spine segment. */
export const placeAt = (s) => {
  const p = PTS[Math.round(idxAt(s))];
  return p.label || NAMES[p.seg];
};
/* Which fork, if any, you are approaching — for the route prompt. */
export const forkAhead = (s, look = 120) =>
  FORKS.find((f) => s < f.from && s > f.from - look) || null;

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
