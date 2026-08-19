/* ============================================================================
   FREEWHEEL — the course.

   A diagnostic hill, not a level. Every segment exists to answer one question
   about whether an isometric camera can read elevation, or whether pumping a
   slope feels like a skill. Segment names are printed on the HUD so a tester
   can say "the read fails on THE STEP" instead of "somewhere near the end".

   The centreline is integrated at a fixed arc step rather than fitted to a
   spline: grade is the subject of this game, so grade is the thing we author
   directly. Pitch and curvature then fall out of finite differences on the
   points we actually built, which means the physics can never disagree with
   the mesh.
   ========================================================================== */

export const STEP = 0.5;                       // metres between centreline samples
export const HALF_W = 5.0;                     // road half width, metres
export const SLAB = 1.4;                       // road slab thickness, metres

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* Each segment: len metres, turn degrees over the whole segment, grade as
   rise/run (negative descends). Optional profile modifiers ride on top. */
const SEGMENTS = [
  { name: 'THE GATE',    len:  60, turn:    0, grade: -0.06 },
  { name: 'STEEP DROP',  len: 110, turn:    0, grade: -0.30 },
  { name: 'THE DIP',     len:  90, turn:    0, grade: -0.04, dip:    8.0 },
  { name: 'THE CREST',   len:  80, turn:    0, grade: -0.12, crest:  7.0 },
  { name: 'HAIRPIN L',   len: 130, turn: -150, grade: -0.16 },
  { name: 'THE ROLLERS', len: 240, turn:   20, grade: -0.10, rollers: 5, rollAmp: 3.6 },
  { name: 'THE CLIMB',   len: 100, turn:    0, grade: +0.07 },
  { name: 'HAIRPIN R',   len: 130, turn:  160, grade: -0.14 },
  { name: 'THE STEP',    len: 140, turn:    0, grade: -0.10, step:  14.0 },
  { name: 'THE RUNOUT',  len: 200, turn:  -25, grade: -0.03 },
];

/* What each modifier adds to the base height, as a function of a = t/len.

   Every shape here is a raised cosine, because a raised cosine is zero AND
   flat at both ends. A plain sine is zero at the ends but arrives at full
   slope, which welds a kink into the road exactly where two segments meet —
   and a kink is an infinite curvature spike, which the pump physics reads as
   an enormous load and the cart reads as being fired into the sky.

   Modifiers that do not return to zero at a=1 (the step) are carried into the
   running base height so the surface still joins. */
function extraY(seg, a) {
  const hump = (n) => 0.5 * (1 - Math.cos(2 * Math.PI * n * a));
  let y = 0;
  if (seg.dip)     y += -seg.dip   * hump(1);
  if (seg.crest)   y +=  seg.crest * hump(1);
  if (seg.rollers) y += -seg.rollAmp * hump(seg.rollers);
  if (seg.step)    y += -seg.step  * smoothstep(0.44, 0.56, a);
  return y;
}

/* Grade is blended over the first BLEND of a segment so a change of gradient
   is a transition rather than a hinge. Same reason as above. */
const BLEND = 0.14;
function gradeAtSeg(seg, prevGrade, a) {
  if (a >= BLEND) return seg.grade;
  return prevGrade + (seg.grade - prevGrade) * smoothstep(0, 1, a / BLEND);
}

function build() {
  const pts = [];            // {x,y,z,s,seg}
  let x = 0, z = 0, heading = 0, s = 0, base = 0, prevGrade = 0;

  SEGMENTS.forEach((seg, si) => {
    const turnPerM = (seg.turn * Math.PI / 180) / seg.len;
    const n = Math.round(seg.len / STEP);
    for (let i = 0; i < n; i++) {
      const a = i / n;
      pts.push({ x, y: base + extraY(seg, a), z, s, seg: si });
      heading += turnPerM * STEP;
      base += gradeAtSeg(seg, prevGrade, a) * STEP;
      x += Math.cos(heading) * STEP;
      z += Math.sin(heading) * STEP;
      s += STEP;
    }
    base += extraY(seg, 1);                    // carry any net drop forward
    prevGrade = seg.grade;
  });
  pts.push({ x, y: base, z, s, seg: SEGMENTS.length - 1 });

  /* Frames. Pitch is signed: negative descends. Vertical curvature is the
     rate of change of pitch along the road — positive means the road is
     bending upward under you, which is a compression, which is load. That
     sign is the whole pump mechanic, so it is worth naming loudly. */
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
  return pts;
}

export const PTS = build();
export const LENGTH = PTS[PTS.length - 1].s;
export const NAMES = SEGMENTS.map(s => s.name);

const lastIdx = PTS.length - 1;
const idxAt = s => Math.min(lastIdx, Math.max(0, s / STEP));

/* Linear interpolation between samples. At 0.5 m spacing the error is far
   below anything the player can feel, and it keeps queries branch-free. */
function lerpField(s, key) {
  const f = idxAt(s), i = Math.floor(f), t = f - i;
  const j = Math.min(lastIdx, i + 1);
  if (key === 'head') {                        // angles need wrap-safe blending
    let d = PTS[j].head - PTS[i].head;
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return PTS[i].head + d * t;
  }
  return PTS[i][key] + (PTS[j][key] - PTS[i][key]) * t;
}

export const pitchAt = s => lerpField(s, 'pitch');
export const headAt  = s => lerpField(s, 'head');
export const kvAt    = s => lerpField(s, 'kv');
export const khAt    = s => lerpField(s, 'kh');
export const segAt   = s => PTS[Math.round(idxAt(s))].seg;

/* World position of the road surface at distance s, offset u metres to the
   rider's right. The road is not banked in this build — banking is a tuning
   knob we have deliberately not spent yet. */
export function surfaceAt(s, u = 0) {
  const f = idxAt(s), i = Math.floor(f), t = f - i;
  const j = Math.min(lastIdx, i + 1);
  const A = PTS[i], B = PTS[j];
  const h = headAt(s);
  return {
    x: A.x + (B.x - A.x) * t - Math.sin(h) * u,
    y: A.y + (B.y - A.y) * t,
    z: A.z + (B.z - A.z) * t + Math.cos(h) * u,
  };
}

/* Height extremes, for the elevation strip in the HUD. */
export const TOP_Y = Math.max(...PTS.map(p => p.y));
export const BOT_Y = Math.min(...PTS.map(p => p.y));
