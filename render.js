/* ============================================================================
   FREEWHEEL — the look, and the readability experiment.

   An isometric camera cannot see height. Moving a metre up the screen is
   indistinguishable from moving a metre away, which means a ramp reads as flat
   ground and a jump reads as nothing at all. Everything in this file that is
   not "draw the road" exists to break that ambiguity, and every one of those
   cues is on a number key so a tester can turn it off and find out whether it
   was ever doing any work.
   ========================================================================== */

import * as THREE from './vendor/three.module.js';
import * as T from './track.js';
import * as THEME from './theme.js';

export const SHOULDER = 1.7;

export const opts = {
  shadow: true,      // 1  hard contact ellipse on the surface below the cart
  tether: true,      // 2  vertical line from cart to shadow while airborne
  slabs: true,       // 3  road thickness, side walls and pylons
  haze: true,        // 4  altitude fog
  sun: true,         // 5  low raking key light and its cast shadows
  slopeTint: false,  // 6  colour the road by gradient (warm down, cool up)
  posts: true,       // 7  roadside marker posts
  shake: true,
  dust: true,
  shadowMap: true,
};

export function setRes(scale) {
  renderer.setPixelRatio(Math.min(devicePixelRatio * scale, 3));
  resize();
}

let renderer, scene, camera, cart, rider, blob, reticle, tether, sun, hemi, fog;
let sky, dust, dustP = [], shakeT = 0;
let courseRoot, TH = THEME.get('alpine');
const hex = (c) => new THREE.Color(c[0], c[1], c[2]);
let roadMesh, roadPlain, roadTint, pylons, postGroup, treeGroup;
let camYaw = 0, camYawTarget = 0, camSize = 46;

const UP = new THREE.Vector3(0, 1, 0);
const CAM_PITCH = 40 * Math.PI / 180;   // steeper than a classic 2:1 iso, so
                                        // "up" and "away" are not the same
                                        // screen vector to begin with
const CAM_DIST = 220;
/* Sun direction is per theme; at 24 degrees the shadows were long enough to
   read as artefacts, so no theme should sit much below ~35. */
const SUN_DIR = new THREE.Vector3();

/* Road normal and basis at (s). Needed constantly: to sit the cart on the
   surface, to lie the contact shadow flat against a slope, and to build the
   slab. */
function basisAt(s) {
  const h = T.headAt(s), p = T.pitchAt(s), bank = T.bankAt(s);
  const tan = new THREE.Vector3(Math.cos(h) * Math.cos(p), Math.sin(p), Math.sin(h) * Math.cos(p));
  const flatR = new THREE.Vector3(-Math.sin(h), 0, Math.cos(h));
  const flatN = new THREE.Vector3().crossVectors(flatR, tan).normalize();
  if (flatN.y < 0) flatN.negate();
  if (!bank) return { tan, right: flatR, nrm: flatN };
  /* Roll the cross-section about the tangent. Built directly rather than by
     quaternion so the sign is visible: a positive bank tilts `right` upward,
     which matches surfaceAt raising the outside of the corner. */
  const c = Math.cos(bank), sn = Math.sin(bank);
  const right = flatR.clone().multiplyScalar(c).addScaledVector(flatN, sn).normalize();
  const nrm = flatN.clone().multiplyScalar(c).addScaledVector(flatR, -sn).normalize();
  return { tan, right, nrm };
}


/* Hashed value noise. Used for the hillside, for where trees clump and where
   they thin out, and for breaking up ground colour. Module scope because all
   three want the same field — clearings that do not line up with the terrain
   read as scattered rather than placed. */
const h2 = (i, j) => {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177 | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
};
const vn = (x, z) => {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};
const fbm = (x, z) =>
  (vn(x, z) + vn(x * 2.13, z * 2.13) * 0.5 + vn(x * 4.31, z * 4.31) * 0.25
   + vn(x * 8.7, z * 8.7) * 0.125) / 1.875 - 0.5;

const v3 = (o) => new THREE.Vector3(o.x, o.y, o.z);

/* -------------------------------------------------------------------------- */
/* road                                                                       */
/* -------------------------------------------------------------------------- */
function buildRoad(tr) {
  const EVERY = 2;                                  // one ring per metre
  const rings = [];
  for (let i = 0; i < T.PTS.length; i += EVERY) rings.push(i * T.STEP);
  if (rings[rings.length - 1] < T.LENGTH) rings.push(T.LENGTH);

  const pos = [], plain = [], tint = [], idx = [];
  /* The slab is built WIDER than the drivable width. Marker posts used to be
     placed 1 m outside T.HALF_W, where surfaceAt merely extrapolates the road
     plane — so they stood in mid-air off the edge of the world. A shoulder
     gives them somewhere real to stand, and the painted edge lines below are
     what actually tell the player where the road ends. */
  const W = T.HALF_W + SHOULDER, D = T.SLAB;

  rings.forEach((s) => {
    const c = v3(T.surfaceAt(s, 0));
    const { right, nrm } = basisAt(s);
    const grade = Math.sin(T.pitchAt(s));

    const l = c.clone().addScaledVector(right, -W);
    const r = c.clone().addScaledVector(right, W);
    /* The side walls run DOWN TO THE GROUND, not a fixed slab thickness. This
       is the strongest elevation cue in the whole build: on a fixed iso camera
       a 14 m drop viewed end-on is invisible, but an embankment whose visible
       face grows from 1 m to 14 m states the height directly, in screen space,
       without the player having to infer anything. World-down rather than
       along the road normal, so it reads as an embankment and not a wedge. */
    const dl = Math.max(D, Math.min(34, l.y - terrainY(tr, l.x, l.z) + 0.6));
    const dr = Math.max(D, Math.min(34, r.y - terrainY(tr, r.x, r.z) + 0.6));
    const ld = l.clone().add(new THREE.Vector3(0, -dl, 0));
    const rd = r.clone().add(new THREE.Vector3(0, -dr, 0));
    pos.push(l.x, l.y, l.z, r.x, r.y, r.z, ld.x, ld.y, ld.z, rd.x, rd.y, rd.z);

    /* DARK packed gravel. The first pass used a pale surface and the road
       vanished completely against snow — same value, same light, and after
       tone mapping both were simply white. The road must be the darkest large
       shape on the hill in every altitude band, because it is the one shape
       the player has to read. */
    const RT = TH.road.top, RW = TH.road.wall;
    for (let k = 0; k < 2; k++) plain.push(RT[0], RT[1], RT[2]);
    for (let k = 0; k < 2; k++) plain.push(RW[0], RW[1], RW[2]);

    /* Slope tint: warm where the road falls away, cool where it climbs. This
       is the cheapest possible answer to "which way is downhill" and the one
       most likely to look like a debug view rather than a game. */
    const dn = Math.max(0, -grade), up = Math.max(0, grade);
    const cr = 0.52 + dn * 1.5 - up * 0.25;
    const cg = 0.48 - dn * 0.15 + up * 0.20;
    const cb = 0.44 - dn * 0.42 + up * 0.75;
    for (let k = 0; k < 2; k++) tint.push(cr, cg, cb);
    for (let k = 0; k < 2; k++) tint.push(cr * 0.4, cg * 0.4, cb * 0.4);
  });

  /* Winding matters twice over: three.js back-face culls, and
     computeVertexNormals derives lighting from the same order. Get it wrong
     and the road does not merely shade oddly, it disappears completely and you
     see through it to the hillside below — which looks exactly like a mesh
     that was never built. Verified: each of these three faces now has an
     outward normal (top +Y, left -right, right +right). */
  for (let i = 0; i < rings.length - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    idx.push(a, a + 1, b, a + 1, b + 1, b);             // top, normal +up
    idx.push(a, b, a + 2, b, b + 2, a + 2);             // left wall, normal -right
    idx.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1); // right wall, normal +right
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(plain.slice(), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  roadPlain = new Float32Array(plain);
  roadTint = new Float32Array(tint);

  roadMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  roadMesh.receiveShadow = true;
  roadMesh.castShadow = true;
  courseRoot.add(roadMesh);
}

/* Dashed centre line. Two jobs for almost no cost: it is the only thing that
   describes the road's twist and camber at a glance, and a regular rhythm of
   marks streaming under the cart communicates speed far better than any blur
   effect. Built as loose quads rather than a texture so it follows the surface
   over crests without any UV stretching. */
function buildCentreLine() {
  stripe(4.5, 4.0, 0.42, [0], 1.0);                    // centre dashes
  stripe(6.0, 0.0, 0.26, [-T.HALF_W, T.HALF_W], 0.62); // solid edge lines
}

/* One ribbon builder for both. Loose quads rather than a texture so the paint
   follows the surface over crests and through banking without UV stretching. */
function stripe(DASH, GAP, W, offsets, dim) {
  const LIFT = 0.05;
  const pos = [], idx = [];
  let n = 0;
  for (let s0 = 4; s0 < T.LENGTH - DASH; s0 += DASH + GAP) {
   for (const off of offsets) {
    const a = [];
    for (const s of [s0, s0 + DASH]) {
      const c = v3(T.surfaceAt(s, off));
      const { right, nrm } = basisAt(s);
      c.addScaledVector(nrm, LIFT);
      a.push(c.clone().addScaledVector(right, -W), c.clone().addScaledVector(right, W));
    }
    for (const p of a) pos.push(p.x, p.y, p.z);
    idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);   // normal +up; see buildRoad
    n += 4;
   }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const c = new THREE.Color(TH.dash).multiplyScalar(dim);
  courseRoot.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c })));
}

/* -------------------------------------------------------------------------- */
/* terrain — a smoothed copy of the road's own descent                        */
/* -------------------------------------------------------------------------- */
function buildTerrain() {
  const coarse = [];
  for (let i = 0; i < T.PTS.length; i += 8) coarse.push(T.PTS[i]);    // every 4 m

  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of coarse) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const M = 90;
  minX -= M; maxX += M; minZ -= M; maxZ += M;

  const CELL = 4.5;
  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const pos = [], col = [], idx = [];
  const SIG2 = 2 * 46 * 46;

  const heights = new Float32Array((nx + 1) * (nz + 1));
  const bandY  = new Float32Array((nx + 1) * (nz + 1));   // road height, not ground height
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = minX + i * CELL, z = minZ + j * CELL;
      /* Gaussian-weighted mean of the road's height. The result is the
         mountainside the road was cut into: it follows the descent but not the
         dips, crests or the step, so the road deviates from it and the pylons
         have something to stand on. */
      let wsum = 0, ysum = 0, near = 1e9, nearY = 0;
      for (const p of coarse) {
        const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d2 < near) { near = d2; nearY = p.y; }
        const w = Math.exp(-d2 / SIG2);
        wsum += w; ysum += w * p.y;
      }
      const d = Math.sqrt(near);
      /* Relief grows with distance from the road: graded verges close in,
         real mountain further out. */
      /* Two scales of landform. The fine field gives the verge some shape;
         the ridge field is deliberately LARGER than the camera's view and is
         independent of the road, so the mountain has topography the course
         cuts across rather than topography derived from the course. Without
         it every hillside is a smooth ramp parallel to the tarmac. */
      const amp = (3.0 + Math.min(d, 120) * 0.11) * TH.terrain.relief;
      const n = fbm(x / 46, z / 46) * amp * 2
              + fbm(x / 205 + 11.3, z / 205 - 7.1) * 44;
      const smooth = ysum / wsum - 3.0 - Math.min(d * 0.20, 24) + n;

      /* Cut the road into the hillside. The smoothed surface deliberately does
         not know about the dips, the crest or the 14 m step — that is what
         makes it a mountainside rather than a copy of the road — but it means
         that wherever the road drops sharply it dives straight under the
         terrain and vanishes, taking its contact shadow with it. Measured on
         THE STEP: the entire road beyond the drop was buried.

         So carve, never fill: take the lower of the mountainside and a channel
         that runs flat under the road out past its edge and then climbs away
         as a cut wall. Where the road instead rides ABOVE the hillside the
         min() leaves the mountain alone and the pylons appear on their own. */
      /* A steep, short cut wall. At 0.55 the graded cone reached ~40 m from
         the road and swallowed the whole inside of every hairpin, leaving a
         billiard-table green where a mountainside should be. Rise fast, stop
         early, let the mountain take over. */
      const cut = nearY - 2.2 + Math.max(0, d - (T.HALF_W + 2.0)) * 1.15;
      heights[j * (nx + 1) + i] = Math.min(smooth, cut);
      bandY[j * (nx + 1) + i] = nearY;
    }
  }

  /* Altitude ramp with tight transitions: distinct bands, but not aliased.
     Rock is painted by SLOPE rather than height, which is what stops a
     low-poly hillside reading as felt. */
  const STOPS = TH.terrain.stops;
  const ramp = (a) => {
    for (let k = 0; k < STOPS.length - 1; k++) {
      const [p0, c0] = STOPS[k], [p1, c1] = STOPS[k + 1];
      if (a <= p1 || k === STOPS.length - 2) {
        const t = p1 === p0 ? 0 : Math.max(0, Math.min(1, (a - p0) / (p1 - p0)));
        return [0, 1, 2].map((q) => c0[q] + (c1[q] - c0[q]) * t);
      }
    }
    return STOPS[0][1];
  };
  const ROCK = TH.terrain.rock;

  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = minX + i * CELL, z = minZ + j * CELL;
      const y = heights[j * (nx + 1) + i];
      pos.push(x, y, z);

      const gi = (ii, jj) => heights[Math.max(0, Math.min(nz, jj)) * (nx + 1)
                                   + Math.max(0, Math.min(nx, ii))];
      const dx = (gi(i + 1, j) - gi(i - 1, j)) / (2 * CELL);
      const dz = (gi(i, j + 1) - gi(i, j - 1)) / (2 * CELL);
      const slope = Math.hypot(dx, dz);

      /* Band by the height of the ROAD nearby, not by this vertex's own
         height. The hillside falls away 20-plus metres from the verge, so
         colouring by ground height put the player permanently inside the band
         BELOW the one they were driving through — green road, ochre world.
         Banding by the road makes the palette track progress down the
         mountain, which is the entire point of having bands. */
      const a = (bandY[j * (nx + 1) + i] - T.BOT_Y) / (T.TOP_Y - T.BOT_Y);
      const base = ramp(a);
      const t = Math.max(0, Math.min(1, (slope - 0.62) / 0.55));
      const rk = t * t * (3 - 2 * t);
      /* Two scales of variation: fine per-vertex grain, plus a broad drift so
         the hillside has weather in it rather than one flat albedo. */
      const sh = 0.86 + h2(i, j) * 0.16 + fbm(x / 90, z / 90) * TH.terrain.tint;
      col.push((base[0] + (ROCK[0] - base[0]) * rk) * sh,
               (base[1] + (ROCK[1] - base[1]) * rk) * sh,
               (base[2] + (ROCK[2] - base[2]) * rk) * sh);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  /* FLAT shaded. The hillside always had 1.6 m of relief between adjacent
     4.5 m cells — measured, not assumed — but smooth vertex normals averaged
     it into a soft gradient that read as an empty field. Faceting it makes the
     same geometry legible, and suits the rest of the art direction. */
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true,
  }));
  m.receiveShadow = true;
  courseRoot.add(m);

  return { minX, minZ, CELL, nx, nz, heights };
}

/* -------------------------------------------------------------------------- */
/* pylons, posts, trees                                                       */
/* -------------------------------------------------------------------------- */
function terrainY(tr, x, z) {
  const fi = (x - tr.minX) / tr.CELL, fj = (z - tr.minZ) / tr.CELL;
  const i = Math.max(0, Math.min(tr.nx - 1, Math.floor(fi)));
  const j = Math.max(0, Math.min(tr.nz - 1, Math.floor(fj)));
  return tr.heights[j * (tr.nx + 1) + i];
}

function buildProps(tr) {
  /* Pylons. Where the road runs above the hillside its legs are the only
     honest statement of how high it is; leg length is an altitude readout the
     player reads without knowing they are reading it. */
  const legs = [];
  for (let s = 6; s < T.LENGTH - 6; s += 13) {
    const c = T.surfaceAt(s, 0);
    const g = terrainY(tr, c.x, c.z);
    const h = c.y - T.SLAB - g;
    if (h > 1.6) legs.push({ x: c.x, z: c.z, y: g, h, right: basisAt(s).right });
  }
  const pg = new THREE.BoxGeometry(1, 1, 1);
  pylons = new THREE.InstancedMesh(pg,
    new THREE.MeshLambertMaterial({ color: TH.pylon }), Math.max(1, legs.length * 2));
  pylons.castShadow = true; pylons.receiveShadow = true;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
  let n = 0;
  for (const L of legs) {
    for (const side of [-1, 1]) {
      mtx.compose(
        new THREE.Vector3(L.x + L.right.x * side * (T.HALF_W - 0.7), L.y + L.h / 2,
                          L.z + L.right.z * side * (T.HALF_W - 0.7)),
        q, new THREE.Vector3(0.55, L.h, 0.55));
      pylons.setMatrixAt(n++, mtx);
    }
  }
  pylons.count = n;
  courseRoot.add(pylons);

  /* Marker posts. Cheap, and they do most of the work of communicating speed:
     a regular rhythm of verticals streaming past is more legible than any
     amount of blur. */
  postGroup = new THREE.Group();
  const bg = new THREE.BoxGeometry(0.3, 2.0, 0.3);
  const mA = new THREE.MeshLambertMaterial({ color: TH.post.a });
  const mB = new THREE.MeshLambertMaterial({ color: TH.post.b });
  let k = 0;
  for (let s = 10; s < T.LENGTH - 10; s += 22, k++) {
    const { right, nrm } = basisAt(s);
    for (const side of [-1, 1]) {
      const c = v3(T.surfaceAt(s, side * (T.HALF_W + SHOULDER * 0.5)));
      const p = new THREE.Mesh(bg, k % 2 ? mA : mB);
      p.position.copy(c).addScaledVector(nrm, 1.0);
      p.castShadow = true;
      postGroup.add(p);
    }
  }
  courseRoot.add(postGroup);

  /* Scatter. Two rules do almost all of the work of making a hillside look
     placed rather than sprinkled: trees CLUMP (a noise field decides where the
     wood is and where the clearings are, and the same field drives ground
     colour so clearings actually read as clearings), and nothing is the same
     size twice. Boulders go on the steep ground the trees refuse. */
  treeGroup = new THREE.Group();
  const SC = TH.scatter;
  const cone = new THREE.ConeGeometry(SC.tallR, SC.tallH, 7);
  const cone2 = new THREE.ConeGeometry(SC.shortR, SC.shortH, 6);
  const trunk = new THREE.CylinderGeometry(0.35, 0.45, 2.2, 5);
  const rock = new THREE.IcosahedronGeometry(1.0, 0);
  /* Dark green plus a raised ambient: at 0x2b4230 with the key light behind
     them every conifer rendered as a pure black cutout. */
  const cm = new THREE.MeshLambertMaterial({ color: SC.coneA });
  const cm2 = new THREE.MeshLambertMaterial({ color: SC.coneB });
  const tm = new THREE.MeshLambertMaterial({ color: SC.trunk });
  const rm = new THREE.MeshLambertMaterial({ color: SC.rockCol, flatShading: true });

  const N = SC.trees, NR = SC.rocks;
  const ci = new THREE.InstancedMesh(cone, cm, N);
  const ci2 = new THREE.InstancedMesh(cone2, cm2, N);
  const ti = new THREE.InstancedMesh(trunk, tm, N);
  const ri = new THREE.InstancedMesh(rock, rm, NR);
  ci.castShadow = ci2.castShadow = ti.castShadow = ri.castShadow = true;
  ri.receiveShadow = true;

  const slopeAt = (x, z) => {
    const e = 6;
    return Math.hypot(terrainY(tr, x + e, z) - terrainY(tr, x - e, z),
                      terrainY(tr, x, z + e) - terrainY(tr, x, z - e)) / (2 * e);
  };

  let a = 0, b = 0, rk = 0, guard = 0;
  while ((a + b < N || rk < NR) && guard++ < N * 40) {
    const s = Math.random() * T.LENGTH;
    const off = (T.HALF_W + 6) + Math.random() * 62;
    const side = Math.random() < 0.5 ? -1 : 1;
    const c = T.surfaceAt(s, side * off);
    const gy = terrainY(tr, c.x, c.z);
    /* Altitude of the ROAD here, not of this patch of ground. The hillside
       falls away far below the course — measured down to 54 m under its lowest
       point — so testing ground height put almost every candidate 'below the
       treeline' and 99% of them were thrown away. */
    const alt = (T.surfaceAt(s, 0).y - T.BOT_Y) / (T.TOP_Y - T.BOT_Y);
    const sl = slopeAt(c.x, c.z);

    if (sl > 0.72 && rk < NR) {                       // scree and outcrops
      const sc = 0.6 + Math.random() * 2.3;
      mtx.compose(new THREE.Vector3(c.x, gy + sc * 0.35, c.z),
        q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6.28, Math.random())),
        new THREE.Vector3(sc, sc * 0.72, sc));
      ri.setMatrixAt(rk++, mtx);
      q.identity();
      continue;
    }
    if (a + b >= N) continue;
    if (alt > SC.altHi || alt < SC.altLo) continue;
    if (vn(c.x / 58, c.z / 58) < SC.clump) continue;  // the clearings
    const sc = 0.55 + Math.random() * 0.95;
    const tall = Math.random() < 0.72;
    const y = gy + 2.2 + (tall ? SC.tallH / 2 : SC.shortH / 2) * sc;
    mtx.compose(new THREE.Vector3(c.x, y, c.z), q, new THREE.Vector3(sc, sc, sc));
    (tall ? ci : ci2).setMatrixAt(tall ? a : b, mtx);
    mtx.compose(new THREE.Vector3(c.x, gy + 1.1 * sc, c.z), q, new THREE.Vector3(sc, sc, sc));
    ti.setMatrixAt(a + b, mtx);
    if (tall) a++; else b++;
  }
  ci.count = a; ci2.count = b; ti.count = a + b; ri.count = rk;
  treeGroup.add(ci, ci2, ti, ri);
  courseRoot.add(treeGroup);
}


/* -------------------------------------------------------------------------- */
/* sky                                                                        */
/* -------------------------------------------------------------------------- */
/* A vertex-coloured dome rather than a flat clear colour. Two things it buys:
   a horizon for the hillside to sit against, and a warm bloom around the sun
   that makes the low key light look motivated instead of arbitrary. Baked into
   vertex colours because the sun never moves, so a shader would be a cost with
   no benefit. */
function buildSky() {
  const g = new THREE.SphereGeometry(600, 32, 20);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const ZEN = TH.sky.zenith, HOR = TH.sky.horizon, GND = TH.sky.ground;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let c;
    if (v.y >= 0) {
      const t = Math.pow(Math.min(1, v.y / 0.55), 0.8);
      c = [0, 1, 2].map((k) => HOR[k] + (ZEN[k] - HOR[k]) * t);
    } else {
      const t = Math.min(1, -v.y / 0.35);
      c = [0, 1, 2].map((k) => HOR[k] + (GND[k] - HOR[k]) * t);
    }
    const glow = Math.pow(Math.max(0, v.dot(SUN_DIR)), TH.sky.glowPow) * 1.1;
    col[i * 3]     = c[0] + glow * TH.sky.glow[0];
    col[i * 3 + 1] = c[1] + glow * TH.sky.glow[1];
    col[i * 3 + 2] = c[2] + glow * TH.sky.glow[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  sky.renderOrder = -1;
  scene.add(sky);
}

/* -------------------------------------------------------------------------- */
/* dust                                                                       */
/* -------------------------------------------------------------------------- */
/* Kicked up off the rear wheels. Grit thrown from under the cart is the
   cheapest honest statement that the wheels are touching gravel and that the
   gravel is moving past quickly. */
function buildDust() {
  const N = 90;
  dust = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.30,
      depthWrite: false, side: THREE.DoubleSide,
    }), N);
  dust.frustumCulled = false;
  for (let i = 0; i < N; i++) dustP.push({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), sz: 0 });
  scene.add(dust);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _z = new THREE.Vector3();
function updateDust(S, dt, at, right) {
  const emit = !S.air && S.v > 6;
  let budget = emit ? Math.min(4, Math.floor(S.v * dt * 2.2)) : 0;
  for (const d of dustP) {
    if (d.life <= 0 && budget > 0) {
      budget--;
      d.life = 0.45 + Math.random() * 0.35;
      d.pos.copy(at).addScaledVector(right, (Math.random() - 0.5) * 2.0);
      d.vel.set((Math.random() - 0.5) * 1.6, 1.0 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6);
      d.sz = 0.5 + Math.random() * 0.9;
    }
    if (d.life > 0) {
      d.life -= dt;
      d.pos.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(1 - dt * 1.8);
    }
  }
  camera.getWorldQuaternion(_q);
  dustP.forEach((d, i) => {
    const k = Math.max(0, d.life);
    const sc = d.sz * (0.35 + k * 1.7);
    _m.compose(d.pos, _q, _z.set(k > 0 ? sc : 0, k > 0 ? sc : 0, 1));
    dust.setMatrixAt(i, _m);
  });
  dust.instanceMatrix.needsUpdate = true;
}

/* -------------------------------------------------------------------------- */
/* the cart                                                                    */
/* -------------------------------------------------------------------------- */
function buildCart() {
  cart = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.42, 2.9),
    new THREE.MeshLambertMaterial({ color: 0xb8452c }));  // recoloured in build()
  body.position.y = 0.46; body.castShadow = true;
  cart.add(body);

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.30, 0.9),
    new THREE.MeshLambertMaterial({ color: 0x8d3320 }));
  nose.position.set(0, 0.42, 1.75); nose.castShadow = true;
  cart.add(nose);

  const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10);
  wg.rotateZ(Math.PI / 2);
  const wm = new THREE.MeshLambertMaterial({ color: 0x1d1b19 });
  for (const [x, z] of [[-0.86, 1.05], [0.86, 1.05], [-0.86, -1.05], [0.86, -1.05]]) {
    const w = new THREE.Mesh(wg, wm);
    w.position.set(x, 0.36, z); w.castShadow = true;
    cart.add(w);
  }

  /* The rider IS the pump gauge. Whether the mechanic is legible without a
     HUD comes down entirely to whether this silhouette reads as crouched or
     standing from a fixed camera 220 m away. */
  rider = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.33, 0.62, 3, 8),
    new THREE.MeshLambertMaterial({ color: 0x2f4f6d }));
  torso.name = 'torso'; torso.position.y = 0.52; torso.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xe0c9a6 }));
  head.name = 'head'; head.position.y = 1.12; head.castShadow = true;
  rider.add(torso, head);
  rider.position.set(0, 0.55, -0.35);
  cart.add(rider);
  scene.add(cart);

  /* Contact shadow. The single most important object in this file: it is the
     only thing that says how far above the road the cart is, and the only
     thing that says where it is going to land. */
  const bg = new THREE.CircleGeometry(1.35, 22);
  bg.rotateX(-Math.PI / 2);
  blob = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({
    color: 0x0a0c10, transparent: true, opacity: 0.55,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
  }));
  blob.renderOrder = 3;
  scene.add(blob);

  /* A BRIGHT ring, because the dark contact ellipse turned out to be useless
     the moment the road became dark asphalt: a black shadow on a black surface
     communicates nothing. The ring is the airborne height readout and the
     landing mark; the dark ellipse below stays only for the grounded case,
     where it sells contact rather than height. */
  const rg = new THREE.RingGeometry(1.15, 1.45, 26);
  rg.rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
    color: 0xffd489, transparent: true, opacity: 0.95,
    depthTest: false, depthWrite: false,
  }));
  reticle.renderOrder = 5;
  scene.add(reticle);

  const tg = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(), new THREE.Vector3()]);
  tether = new THREE.Line(tg, new THREE.LineDashedMaterial({
    color: 0xf0e6d2, dashSize: 0.55, gapSize: 0.45,
    transparent: true, opacity: 0.75, depthTest: false,
  }));
  tether.renderOrder = 4;
  scene.add(tether);
}

/* -------------------------------------------------------------------------- */
export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8f9fb0);   // only seen if the dome is off
  /* LINEAR fog bracketing the camera standoff, not exponential. An ortho
     camera sits an arbitrary distance back — 220 units here — and fog is
     measured from the camera, so FogExp2 greyed the entire scene uniformly
     (43% haze on every pixel including the cart) and read as a broken
     renderer. Linear fog anchored to CAM_DIST leaves the foreground clean and
     only fades things genuinely further down the hill. */
  fog = new THREE.Fog(0xc7bda9, CAM_DIST - 40, CAM_DIST + 290);
  scene.fog = fog;

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);

  /* One warm key raking across the slope and one cool sky fill. Long shadows
     describe the shape of ground that flat shading leaves ambiguous, and two
     colours of light is the whole lighting model. */
  sun = new THREE.DirectionalLight(0xffd7a4, 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  hemi = new THREE.HemisphereLight(0x9dc0e2, 0x5c5240, 1.15);
  scene.add(hemi);

  buildCart();
  buildDust();
  build();
  resize();
  addEventListener('resize', resize);
}

/* Tear down and regenerate everything that belongs to a course. Called on boot
   and whenever the venue changes. The cart, the sky dome, the dust and the
   lights persist and are simply recoloured — only the world is rebuilt. */
export function build() {
  TH = THEME.get(T.THEME);
  SUN_DIR.set(...TH.sun.dir).normalize();

  renderer.toneMappingExposure = TH.exposure;
  fog.color.set(TH.fog.color);
  fog.near = CAM_DIST + TH.fog.near;
  fog.far = CAM_DIST + TH.fog.far;
  sun.color.set(TH.sun.color);
  hemi.color.set(TH.hemi.sky);
  hemi.groundColor.set(TH.hemi.ground);

  if (courseRoot) {
    /* GPU buffers are not garbage collected with the scene graph. Rebuilding a
       course without disposing leaks a full terrain and road every switch. */
    courseRoot.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material])
        .forEach((m) => m.dispose());
    });
    scene.remove(courseRoot);
  }
  courseRoot = new THREE.Group();
  scene.add(courseRoot);

  if (sky) { sky.geometry.dispose(); sky.material.dispose(); scene.remove(sky); }
  buildSky();

  /* Terrain first: the road needs to know where the ground is before it can
     build walls down to it. */
  const tr = buildTerrain();
  buildRoad(tr);
  buildCentreLine();
  buildProps(tr);

  cart.children[0].material.color.set(TH.cart.body);
  cart.children[1].material.color.set(TH.cart.nose);
  rider.getObjectByName('torso').material.color.set(TH.cart.rider);
  rider.getObjectByName('head').material.color.set(TH.cart.skin);
  dust.material.color.set(TH.dust);

  camSize = 54;
  camYaw = camYawTarget = T.headAt(0);
}

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  applyCamSize(camSize);
}

function applyCamSize(size) {
  const a = innerWidth / innerHeight;
  camera.left = -size * a / 2; camera.right = size * a / 2;
  camera.top = size / 2; camera.bottom = -size / 2;
  camera.updateProjectionMatrix();
}

/* -------------------------------------------------------------------------- */
export function frame(S, dt) {
  const { tan, right, nrm } = basisAt(S.s);
  const surf = v3(T.surfaceAt(S.s, S.u));
  const y = S.air ? S.yAir : surf.y;
  const pos = new THREE.Vector3(surf.x, y, surf.z).addScaledVector(nrm, 0.02);

  cart.position.copy(pos).addScaledVector(nrm, 0.34);
  /* setFromRotationMatrix assumes a pure rotation. {right, nrm, tan} has
     determinant -1 at EVERY heading — it is a reflection, because nrm is built
     as right x tan, so the handed order is (Z x X) not (X x Z). Feeding a
     reflection in returns a meaningless quaternion, and the cart sat broadside
     across the road at all times. Build X from nrm x tan instead. */
  const bx = new THREE.Vector3().crossVectors(nrm, tan).normalize();
  const m = new THREE.Matrix4().makeBasis(bx, nrm, tan.clone().normalize());
  cart.quaternion.setFromRotationMatrix(m);

  /* Crouch. The rider drops crouchTravel metres and folds; the aim is that
     you can tell tucked from standing at gameplay distance without the HUD. */
  const c = S.c;
  rider.position.y = 0.30 + c * 0.45;
  rider.getObjectByName('torso').scale.set(1 + (1 - c) * 0.30, 0.62 + c * 0.38, 1 + (1 - c) * 0.30);
  rider.getObjectByName('head').position.y = 0.80 + c * 0.36;
  rider.rotation.x = (1 - c) * 0.55;

  /* ---- the contact shadow ---------------------------------------------- */
  const height = Math.max(0, y - surf.y);
  blob.visible = opts.shadow && height < 2.5;
  if (blob.visible) {
    blob.position.copy(surf).addScaledVector(nrm, 0.05);
    blob.quaternion.setFromUnitVectors(UP, nrm);
    const sc = 1 + height * 0.10;
    blob.scale.set(sc, 1, sc);
    blob.material.opacity = 0.5 * (1 - height / 2.5);
  }
  reticle.visible = opts.shadow && height > 0.8;
  if (reticle.visible) {
    reticle.position.copy(surf).addScaledVector(nrm, 0.10);
    reticle.quaternion.setFromUnitVectors(UP, nrm);
    const sc = 1 + Math.min(height, 22) * 0.055;
    reticle.scale.set(sc, 1, sc);
    reticle.material.opacity = 0.55 + 0.45 * Math.min(1, height / 6);
  }
  tether.visible = opts.tether && height > 0.6;
  if (tether.visible) {
    const p = tether.geometry.attributes.position;
    p.setXYZ(0, cart.position.x, cart.position.y - 0.2, cart.position.z);
    p.setXYZ(1, surf.x, surf.y + 0.06, surf.z);
    p.needsUpdate = true;
    tether.computeLineDistances();   // on the Line, not the geometry
  }

  /* ---- toggles ---------------------------------------------------------- */
  scene.fog = opts.haze ? fog : null;
  sun.intensity = opts.sun ? TH.sun.intensity : 0.30;
  sun.castShadow = opts.sun && opts.shadowMap;
  if (renderer.shadowMap.enabled !== (opts.sun && opts.shadowMap)) {
    renderer.shadowMap.enabled = opts.sun && opts.shadowMap;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
  hemi.intensity = opts.sun ? TH.hemi.intensity : 2.1;
  pylons.visible = opts.slabs;
  postGroup.visible = opts.posts;
  const want = opts.slopeTint ? roadTint : roadPlain;
  const attr = roadMesh.geometry.attributes.color;
  if (attr.array !== want) { attr.array.set(want); attr.needsUpdate = true; }

  /* ---- camera ----------------------------------------------------------- */
  /* Yaw snaps to eight compass directions with hysteresis, so each stretch of
     road is framed from a known angle and can be composed rather than merely
     rendered. Hysteresis matters: without it the camera flips back and forth
     for the whole length of any road that sits on a boundary. */
  const desired = T.headAt(S.s);
  const OCT = Math.PI / 4;
  const snapped = Math.round(desired / OCT) * OCT;
  let delta = snapped - camYawTarget;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  if (Math.abs(delta) > OCT * 0.62) camYawTarget += delta;
  let e = camYawTarget - camYaw;
  while (e > Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  camYaw += e * Math.min(1, dt * 3.2);

  /* Look ahead of the cart so it sits low in frame. On a fixed iso camera the
     sightline is short and the cart must never be centred, or the player is
     reacting to road they can barely see. */
  const lead = 15 + S.v * 0.75;
  const ahead = v3(T.surfaceAt(Math.min(T.LENGTH, S.s + lead), S.u * 0.5));
  const tgt = pos.clone().lerp(ahead, 0.62);

  /* Widening the road is pointless if the view widens with it — the road has
     to occupy MORE of the frame, not the same fraction of a bigger one. */
  camSize += ((54 + S.v * 0.55) - camSize) * Math.min(1, dt * 1.8);
  applyCamSize(camSize);

  /* Shake, applied to the look target rather than the camera alone, so the
     whole frame translates instead of the view swinging. Scales with the
     square of speed so it is absent at a crawl and unmistakable at 50. */
  shakeT += dt * 43;
  const amp = opts.shake ? Math.pow(Math.min(1, S.v / 30), 2) * (S.air ? 0.06 : 0.30) : 0;
  tgt.x += Math.sin(shakeT * 1.7) * amp;
  tgt.y += Math.cos(shakeT * 2.31) * amp * 0.8;
  const dir = new THREE.Vector3(
    Math.cos(CAM_PITCH) * Math.cos(camYaw + Math.PI),
    Math.sin(CAM_PITCH),
    Math.cos(CAM_PITCH) * Math.sin(camYaw + Math.PI));
  camera.position.copy(tgt).addScaledVector(dir, CAM_DIST);
  camera.lookAt(tgt);

  sun.position.copy(tgt).addScaledVector(SUN_DIR, 200);
  sun.target.position.copy(tgt);
  sun.target.updateMatrixWorld();

  /* The dome rides with the view: an ortho camera has no perspective to sell
     distance, so a sky that stayed put would slide across the frame. */
  sky.position.copy(tgt);

  dust.visible = opts.dust;
  if (opts.dust) {
    updateDust(S, dt, surf.clone().addScaledVector(tan, -1.1).addScaledVector(nrm, 0.25), right);
  }

  renderer.render(scene, camera);
}

export function cameraYaw() { return camYaw; }
export const _dbg = () => ({ scene, camera, roadMesh, cart, blob, sun });
