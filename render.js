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
let rivalCarts = [], tunnelRoofs = [];
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
  const D = T.SLAB;

  rings.forEach((s) => {
    const c = v3(T.surfaceAt(s, 0));
    const { right, nrm } = basisAt(s);
    const grade = Math.sin(T.pitchAt(s));

    const W = T.halfWAt(s) + SHOULDER;          // the road pinches; so does the slab
    const l = c.clone().addScaledVector(right, -W);
    const r = c.clone().addScaledVector(right, W);
    /* The side walls run DOWN TO THE GROUND, not a fixed slab thickness. This
       is the strongest elevation cue in the whole build: on a fixed iso camera
       a 14 m drop viewed end-on is invisible, but an embankment whose visible
       face grows from 1 m to 14 m states the height directly, in screen space,
       without the player having to infer anything. World-down rather than
       along the road normal, so it reads as an embankment and not a wedge. */
    const dl = Math.max(D, Math.min(16, l.y - terrainY(tr, l.x, l.z) + 0.6));
    const dr = Math.max(D, Math.min(16, r.y - terrainY(tr, r.x, r.z) + 0.6));
    const ld = l.clone().add(new THREE.Vector3(0, -dl, 0));
    const rd = r.clone().add(new THREE.Vector3(0, -dr, 0));
    pos.push(l.x, l.y, l.z, r.x, r.y, r.z, ld.x, ld.y, ld.z, rd.x, rd.y, rd.z);

    /* DARK packed gravel. The first pass used a pale surface and the road
       vanished completely against snow — same value, same light, and after
       tone mapping both were simply white. The road must be the darkest large
       shape on the hill in every altitude band, because it is the one shape
       the player has to read. */
    /* Patchy tarmac. One flat colour over two kilometres of road is the single
       biggest reason it read as untextured; two octaves of noise on the
       vertex colour costs nothing and gives it repairs and wear. */
    const RT = TH.road.top, RW = TH.road.wall;
    const wear = 1 + fbm(s / 26, 0) * 0.30 + fbm(s / 6.5, 11.7) * 0.14;
    for (let k = 0; k < 2; k++) plain.push(RT[0] * wear, RT[1] * wear, RT[2] * wear);
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
  stripe(6.0, 0.0, 0.26, 'edges', 0.62);               // solid edge lines
  buildKerbs();
}

/* Red-and-white kerbs on the inside of every real corner. Nothing else says
   "racing circuit" so cheaply, and they double as a legible apex marker: the
   inside of the corner is now a thing you can aim at instead of a guess. */
function buildKerbs() {
  const red = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  const white = new THREE.MeshLambertMaterial({ color: 0xe8e2d4 });
  const posA = [], posB = [];
  const idxA = [], idxB = [];
  const W = 1.5, LIFT = 0.06, SEG = 2.6;
  let k = 0;
  for (let s0 = 4; s0 < T.LENGTH - SEG; s0 += SEG, k++) {
    const kh = T.khAt(s0 + SEG / 2);
    if (Math.abs(kh) < 0.010) continue;                // only real corners
    /* Both edges. Which side is the apex depends on a sign convention it is
       easy to get backwards, and karting circuits kerb both sides anyway. */
    for (const side of [-1, 1]) {
      const pos = (k % 2) ? posA : posB;
      const idx = (k % 2) ? idxA : idxB;
      const base = pos.length / 3;
      for (const s of [s0, s0 + SEG]) {
        const { right, nrm } = basisAt(s);
        const c = v3(T.surfaceAt(s, T.halfWAt(s) * side)).addScaledVector(nrm, LIFT);
        pos.push(...c.clone().addScaledVector(right, -side * W).toArray());
        pos.push(...c.toArray());
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  for (const [pos, idx, mat] of [[posA, idxA, red], [posB, idxB, white]]) {
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    courseRoot.add(new THREE.Mesh(g, mat));
  }
}

/* One ribbon builder for both. Loose quads rather than a texture so the paint
   follows the surface over crests and through banking without UV stretching. */
function stripe(DASH, GAP, W, offsets, dim) {
  const LIFT = 0.05;
  const pos = [], idx = [];
  let n = 0;
  for (let s0 = 4; s0 < T.LENGTH - DASH; s0 += DASH + GAP) {
   /* Edge lines track the pinch, so the painted line is always where the road
      actually ends rather than where it ends on average. */
   const list = offsets === 'edges'
     ? [-T.halfWAt(s0), T.halfWAt(s0)] : offsets;
   for (const off of list) {
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
  const nearest = new Int32Array((nx + 1) * (nz + 1));   // which stretch of road owns this cell
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = minX + i * CELL, z = minZ + j * CELL;
      /* Gaussian-weighted mean of the road's height. The result is the
         mountainside the road was cut into: it follows the descent but not the
         dips, crests or the step, so the road deviates from it and the pylons
         have something to stand on. */
      let wsum = 0, ysum = 0, near = 1e9, nearY = 0, nearI = 0;
      for (let ci = 0; ci < coarse.length; ci++) {
        const p = coarse[ci];
        const d2 = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d2 < near) { near = d2; nearY = p.y; nearI = ci; }
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
      /* A bridge is a hole, not a cut: refuse to carve a channel under the road
         and drop the ground away instead, so THE SPAN reads as a span. */
      heights[j * (nx + 1) + i] = coarse[nearI].bridge
        ? Math.min(smooth, nearY - 30 - Math.min(d * 0.5, 26))
        : Math.min(smooth, cut);
      bandY[j * (nx + 1) + i] = nearY;
      nearest[j * (nx + 1) + i] = nearI;
    }
  }

  /* Ground colour comes from the ZONE the nearest stretch of road is in,
     smoothed over about forty metres so one place becomes the next rather than
     switching. Colouring by altitude drifted with the terrain instead of with
     the course, which is how the player ended up permanently inside the band
     BELOW the one they were driving through. */
  const zoneCol = coarse.map((_, i) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = Math.max(0, i - 10); k <= Math.min(coarse.length - 1, i + 10); k++) {
      const Z = TH.zones[coarse[k].zone] || TH.zones.forest;
      r += Z.ground[0]; g += Z.ground[1]; b += Z.ground[2]; n++;
    }
    return [r / n, g / n, b / n];
  });

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

      /* Fake ambient occlusion: compare each vertex with the mean of its
         neighbours. Sitting below them means it is in a hollow, which is where
         light does not reach. Two lines, and it is most of what separates a
         lit scene from a field of flat polygons. */
      const mean = (gi(i + 1, j) + gi(i - 1, j) + gi(i, j + 1) + gi(i, j - 1)
                  + gi(i + 1, j + 1) + gi(i - 1, j - 1)) / 6;
      const ao = 1 - Math.max(0, Math.min(0.42, (mean - y) * 0.055));

      const base = zoneCol[nearest[j * (nx + 1) + i]];
      const t = Math.max(0, Math.min(1, (slope - 0.62) / 0.55));
      const rk = t * t * (3 - 2 * t);
      /* Two scales of variation: fine per-vertex grain, plus a broad drift so
         the hillside has weather in it rather than one flat albedo. */
      const sh = (0.86 + h2(i, j) * 0.16 + fbm(x / 90, z / 90) * TH.terrain.tint) * ao;
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
/* Bilinear, not nearest. The road's side wall is built every metre while the
   terrain grid is 4.5 m, so sampling the nearest cell made the wall meet the
   ground in a sawtooth that read as broken geometry. */
function terrainY(tr, x, z) {
  const fi = Math.max(0, Math.min(tr.nx - 1.001, (x - tr.minX) / tr.CELL));
  const fj = Math.max(0, Math.min(tr.nz - 1.001, (z - tr.minZ) / tr.CELL));
  const i = Math.floor(fi), j = Math.floor(fj);
  const u = fi - i, v = fj - j, W = tr.nx + 1;
  const h00 = tr.heights[j * W + i],     h10 = tr.heights[j * W + i + 1];
  const h01 = tr.heights[(j + 1) * W + i], h11 = tr.heights[(j + 1) * W + i + 1];
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
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
    /* Legs, not towers. Where the ground falls tens of metres away the road
       is on an embankment, and drawing a 30 m column every 13 m turned the
       verge into a picket fence of skyscrapers. */
    if (h > 1.6 && h < 13) legs.push({ x: c.x, z: c.z, y: g, h, right: basisAt(s).right });
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
      const c = v3(T.surfaceAt(s, side * (T.halfWAt(s) + SHOULDER * 0.5)));
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

  const N = Math.round(SC.trees * 1.35), NR = SC.rocks;
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
    /* Closer in, and biased toward the road. Scattering from 15 m out to 77 m
       put most of the wood outside a 60 m frame, so a pinewood with a thousand
       trees in it rendered as empty ground. */
    const off = (T.halfWAt(s) + SHOULDER + 2.5) + Math.pow(Math.random(), 1.7) * 42;
    const side = Math.random() < 0.5 ? -1 : 1;
    const c = T.surfaceAt(s, side * off);
    const gy = terrainY(tr, c.x, c.z);
    /* Altitude of the ROAD here, not of this patch of ground. The hillside
       falls away far below the course — measured down to 54 m under its lowest
       point — so testing ground height put almost every candidate 'below the
       treeline' and 99% of them were thrown away. */
    const alt = (T.surfaceAt(s, 0).y - T.BOT_Y) / (T.TOP_Y - T.BOT_Y);
    const sl = slopeAt(c.x, c.z);

    const Z = TH.zones[T.zoneAt(s)] || TH.zones.forest;
    if (sl > 0.72 && rk < NR && Math.random() < Z.rocks * 0.55) {  // scree and outcrops
      const sc = 0.6 + Math.random() * 2.3;
      mtx.compose(new THREE.Vector3(c.x, gy + sc * 0.35, c.z),
        q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6.28, Math.random())),
        new THREE.Vector3(sc, sc * 0.72, sc));
      ri.setMatrixAt(rk++, mtx);
      q.identity();
      continue;
    }
    if (a + b >= N) continue;
    /* Zone decides what grows here. An altitude gate could only ever say
       "high" or "low"; a zone can say pinewood, and then say village. */
    if (Math.random() > Z.trees * 0.62) continue;
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

  buildBuildings(tr, mtx, q);
  buildTunnels();
}

/* Houses, close to the road, in the zones that have any. They are the other
   half of the proximity problem the gantries and bunting started on: nothing
   sells speed like a wall two metres off your shoulder. */
function buildBuildings(tr, mtx, q) {
  const wallG = new THREE.BoxGeometry(1, 1, 1);
  const roofG = new THREE.ConeGeometry(0.78, 0.5, 4);
  const cols = TH.bld;
  const CAP = 220;
  const walls = cols.map((c) => new THREE.InstancedMesh(wallG,
    new THREE.MeshLambertMaterial({ color: c }), CAP));
  const roofs = new THREE.InstancedMesh(roofG,
    new THREE.MeshLambertMaterial({ color: TH.roof, flatShading: true }), CAP * cols.length);
  walls.forEach((w) => { w.castShadow = w.receiveShadow = true; });
  roofs.castShadow = true;
  const n = cols.map(() => 0);
  let nr = 0;

  /* WALK the building zones rather than sampling the whole course at random.
     Uniform sampling put 394 houses across 2.4 km, which is six within sight of
     the village street and reads as open ground with the odd shed. A street is
     a density, so it has to be authored as one. */
  for (let s0 = 8; s0 < T.LENGTH - 8; s0 += 5) {
    const Z = TH.zones[T.zoneAt(s0)] || TH.zones.forest;
    if (!Z.blds || T.tunnelAt(s0) || T.bridgeAt(s0)) continue;
    const { nrm, tan } = basisAt(s0);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(nrm, tan).normalize(), nrm,
      tan.clone().normalize()));
    for (const side of [-1, 1]) {
      if (Math.random() > Z.blds * 0.5) continue;
      const off = T.halfWAt(s0) + SHOULDER + 1.2 + Math.random() * 7;
      const c = T.surfaceAt(s0, side * off);
      const gy = terrainY(tr, c.x, c.z);
      const k = Math.floor(Math.random() * cols.length);
      if (n[k] >= CAP) continue;
      const w = 4.2 + Math.random() * 4.0;
      const d = 4.2 + Math.random() * 4.0;
      const h = 4.0 + Math.random() * 6.0;
      /* Stand them UP from the slope. Sitting every house on raw terrain put
         the village ten metres below an embanked road, where the embankment
         hid it — and made-up ground against the street is how hill villages
         are actually built. */
      const base = new THREE.Vector3(c.x, Math.max(gy, c.y - 2.5), c.z);
      mtx.compose(base.clone().addScaledVector(nrm, h / 2), q, new THREE.Vector3(w, h, d));
      walls[k].setMatrixAt(n[k]++, mtx);
      /* ConeGeometry's radius is 0.78, so scaling by w*1.5 gave a roof 2.3x
         the width of the house it sat on and the village rendered as a solid
         raft of red diamonds. Aim for a modest overhang instead. */
      mtx.compose(base.clone().addScaledVector(nrm, h + w * 0.225), q,
                  new THREE.Vector3(w * 0.95, w * 0.90, d * 0.95));
      roofs.setMatrixAt(nr++, mtx);
    }
  }
  walls.forEach((w, k) => { w.count = n[k]; courseRoot.add(w); });
  roofs.count = nr;
  courseRoot.add(roofs);
}

/* A roof over the road. The only place on the course where the sky goes away,
   which is exactly why it is worth the forty lines. */
function buildTunnels() {
  tunnelRoofs = [];
  const roofs = tunnelRoofs;
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2724, side: THREE.DoubleSide });
  const H = 6.2;
  let run = null;
  const flush = () => {
    if (!run || run.b - run.a < 6) { run = null; return; }
    const pos = [], idx = [], ridx = [];
    let v = 0;
    for (let s0 = run.a; s0 <= run.b; s0 += 3) {
      const w = T.halfWAt(s0) + SHOULDER;
      const { nrm, right } = basisAt(s0);
      const c = v3(T.surfaceAt(s0, 0));
      const L = c.clone().addScaledVector(right, -w);
      const R = c.clone().addScaledVector(right, w);
      const LT = L.clone().addScaledVector(nrm, H);
      const RT = R.clone().addScaledVector(nrm, H);
      for (const p of [L, LT, RT, R]) pos.push(p.x, p.y, p.z);
      if (v > 0) {
        const q0 = v - 4;
        for (const [i0, i1] of [[0, 1], [2, 3]]) {          // the two side walls
          idx.push(q0 + i0, q0 + i1, v + i0, q0 + i1, v + i1, v + i0);
        }
        ridx.push(q0 + 1, q0 + 2, v + 1, q0 + 2, v + 2, v + 1);   // the roof
      }
      v += 4;
    }
    const mk = (indices, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos.slice(), 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true; m.receiveShadow = true;
      courseRoot.add(m);
      return m;
    };
    mk(idx, dark);
    /* The roof is its own mesh so it can get out of the way. On a camera fixed
       forty degrees above the road, a tunnel ceiling hides the road, the cart
       and every rival in it — the place is distinct and completely unplayable.
       It fades out while you are inside and closes again behind you. */
    const roof = mk(ridx, dark.clone());
    roof.material.transparent = true;
    roof.castShadow = false;
    roofs.push({ mesh: roof, a: run.a, b: run.b });
    run = null;
  };
  for (let s0 = 0; s0 < T.LENGTH; s0 += 2) {
    if (T.tunnelAt(s0)) { if (!run) run = { a: s0, b: s0 }; else run.b = s0; }
    else flush();
  }
  flush();
}


/* -------------------------------------------------------------------------- */
/* furniture — the things that whip past close to the camera                   */
/* -------------------------------------------------------------------------- */
/* Sense of speed comes from PROXIMITY. An open hillside has nothing near you,
   which is why 55 mph read as a stroll no matter what the number said. Gantries
   pass directly overhead, bunting runs a metre off your shoulder, and bales sit
   on the road itself. */
function buildBarriers() {
  /* A CONTINUOUS rail down both verges. Sparse posts left the road edge as a
     dotted suggestion; an unbroken line at knee height reads as a boundary from
     any distance, gives the whole course a silhouette, and puts something solid
     a metre off your shoulder for the entire run. */
  const H = 0.95, TH_ = 0.22;
  const pos = [], col = [], idx = [];
  const rail = new THREE.Color(TH.rail), dim = rail.clone().multiplyScalar(0.62);
  let v = 0;
  for (const side of [-1, 1]) {
    let first = true;
    for (let s0 = 2; s0 <= T.LENGTH - 2; s0 += 2.5) {
      if (T.tunnelAt(s0)) { first = true; continue; }
      const { right, nrm } = basisAt(s0);
      const c = v3(T.surfaceAt(s0, side * (T.halfWAt(s0) + SHOULDER * 0.72)));
      const lo = c.clone().addScaledVector(nrm, H - TH_);
      const hi = c.clone().addScaledVector(nrm, H);
      const out = right.clone().multiplyScalar(side * 0.09);
      for (const p of [lo.clone().add(out), hi.clone().add(out), hi.clone().sub(out)]) {
        pos.push(p.x, p.y, p.z);
      }
      col.push(dim.r, dim.g, dim.b, rail.r, rail.g, rail.b, rail.r, rail.g, rail.b);
      if (!first) {
        const q = v - 3;
        idx.push(q, q + 1, v, q + 1, v + 1, v);        // outer face
        idx.push(q + 1, q + 2, v + 1, q + 2, v + 2, v + 1); // top
      }
      first = false;
      v += 3;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide,
  }));
  m.castShadow = true;
  courseRoot.add(m);
}

/* Rubber laid down where everyone brakes and slides. Two dark streaks into
   every real corner — free, and it tells you a corner has been taken hard
   before you arrive at it. */
function buildMarks() {
  const pos = [], idx = [];
  let v = 0;
  for (let s0 = 6; s0 < T.LENGTH - 8; s0 += 3) {
    const kh = T.khAt(s0 + 1.5);
    if (Math.abs(kh) < 0.014) continue;
    const lean = -Math.sign(kh) * T.halfWAt(s0) * 0.34;
    for (const lane of [lean - 0.85, lean + 0.85]) {
      const base = v;
      for (const s of [s0, s0 + 3]) {
        const { right, nrm } = basisAt(s);
        const c = v3(T.surfaceAt(s, lane)).addScaledVector(nrm, 0.035);
        pos.push(...c.clone().addScaledVector(right, -0.22).toArray());
        pos.push(...c.clone().addScaledVector(right, 0.22).toArray());
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      v += 4;
    }
  }
  if (!idx.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  courseRoot.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false,
  })));
}

function buildFurniture(tr) {
  const q = new THREE.Quaternion(), mtx = new THREE.Matrix4();

  /* ---- bales: the hazards, drawn where the physics says they are ---------- */
  const baleG = new THREE.CylinderGeometry(T.HAZARD_R * 0.85, T.HAZARD_R * 0.85, 2.2, 10);
  baleG.rotateZ(Math.PI / 2);
  const baleM = new THREE.MeshLambertMaterial({ color: 0xd8c48a });
  const bales = new THREE.InstancedMesh(baleG, baleM, Math.max(1, T.HAZARDS.length));
  bales.castShadow = bales.receiveShadow = true;
  T.HAZARDS.forEach((h, i) => {
    const c = v3(T.surfaceAt(h.s, h.u));
    const { nrm, tan } = basisAt(h.s);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(nrm, tan).normalize(), nrm, tan.clone().normalize()));
    mtx.compose(c.addScaledVector(nrm, 0.85), q, new THREE.Vector3(1, 1, 1));
    bales.setMatrixAt(i, mtx);
  });
  courseRoot.add(bales);

  /* ---- gantries ---------------------------------------------------------- */
  const postM = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
  const bannerM = new THREE.MeshLambertMaterial({
    color: TH.post.b, side: THREE.DoubleSide,
  });
  for (let s0 = 120; s0 < T.LENGTH - 60; s0 += 190) {
    const w = T.halfWAt(s0) + SHOULDER;
    const { nrm, right, tan } = basisAt(s0);
    const c = v3(T.surfaceAt(s0, 0));
    const H = 6.4;
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, H, 0.34), postM);
      p.position.copy(c).addScaledVector(right, side * w).addScaledVector(nrm, H / 2);
      p.castShadow = true;
      courseRoot.add(p);
    }
    /* One basis for both, and it must be the RIGHT-HANDED one. setFromUnitVectors
       pins a single axis and leaves the roll arbitrary, which put the crossbeam
       at a jaunty angle; {right, nrm, tan} then fixed the angle but has
       determinant -1, so setFromRotationMatrix returned nonsense and the banner
       rendered as a thin vertical strip. Same trap as the cart. */
    const B = new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(nrm, tan).normalize(),
      nrm, tan.clone().normalize());
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.5, 0.36, 0.42), postM);
    beam.position.copy(c).addScaledVector(nrm, H);
    beam.quaternion.setFromRotationMatrix(B);
    beam.castShadow = true;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.7, 1.6), bannerM);
    banner.position.copy(c).addScaledVector(nrm, H - 1.0);
    banner.quaternion.setFromRotationMatrix(B);
    courseRoot.add(beam, banner);
  }

  /* ---- corner warning signs ---------------------------------------------- */
  /* Placed where a corner is genuinely tight, far enough back to be read. They
     are scenery and they are also the only thing on the course that warns you
     about a corner before the corner. */
  const signPost = new THREE.MeshLambertMaterial({ color: 0x6f6a62 });
  const signFace = new THREE.MeshLambertMaterial({
    color: 0xe8c34a, side: THREE.DoubleSide,
  });
  const signBack = new THREE.MeshLambertMaterial({ color: 0x2b2926 });
  for (let s0 = 60; s0 < T.LENGTH - 40; s0 += 6) {
    const kh = T.khAt(s0 + 34);
    if (Math.abs(kh) < 0.024) continue;
    if (T.tunnelAt(s0)) continue;
    if (Math.abs(T.khAt(s0 - 6 + 34)) >= 0.024) continue;   // only the first
    const { nrm, right, tan } = basisAt(s0);
    const side = Math.sign(kh) || 1;                         // outside of the bend
    const c = v3(T.surfaceAt(s0, side * (T.halfWAt(s0) + SHOULDER + 1.4)));
    const B = new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(nrm, tan).normalize(), nrm,
      tan.clone().normalize());
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), signPost);
    post.position.copy(c).addScaledVector(nrm, 1.2);
    post.castShadow = true;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), signFace);
    plate.position.copy(c).addScaledVector(nrm, 2.6);
    plate.quaternion.setFromRotationMatrix(B);
    plate.rotation.z += Math.PI / 4;                         // a diamond
    const chev = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.22), signBack);
    chev.position.copy(c).addScaledVector(nrm, 2.6).addScaledVector(tan, 0.04);
    chev.quaternion.setFromRotationMatrix(B);
    chev.rotation.z += side * 0.5;
    courseRoot.add(post, plate, chev);
  }

  /* ---- spectators --------------------------------------------------------- */
  /* Behind the rail, in the zones people would actually stand in. Nothing
     expensive: a coloured capsule reads as a person at this distance, and a
     crowd is the difference between a road and an event. */
  const crowdG = new THREE.CapsuleGeometry(0.22, 0.62, 3, 6);
  const crowdCols = [0xc2452e, 0x2f6f9e, 0xd9a13a, 0x4d7f6a, 0x7a4f9c, 0xe0d6c2];
  const crowds = crowdCols.map((c) => new THREE.InstancedMesh(crowdG,
    new THREE.MeshLambertMaterial({ color: c }), 120));
  crowds.forEach((m) => { m.castShadow = true; });
  const cn = crowdCols.map(() => 0);
  for (let s0 = 12; s0 < T.LENGTH - 12; s0 += 2.2) {
    const Z = TH.zones[T.zoneAt(s0)] || TH.zones.forest;
    const want = Math.min(1, Z.blds * 0.30 + 0.05);
    if (Math.random() > want || T.tunnelAt(s0)) continue;
    const { nrm } = basisAt(s0);
    const side = Math.random() < 0.5 ? -1 : 1;
    const c = v3(T.surfaceAt(s0, side * (T.halfWAt(s0) + SHOULDER + 1.1 + Math.random() * 2.4)));
    const k = Math.floor(Math.random() * crowdCols.length);
    if (cn[k] >= 120) continue;
    mtx.compose(c.addScaledVector(nrm, 0.55), q.identity(),
                new THREE.Vector3(1, 0.9 + Math.random() * 0.3, 1));
    crowds[k].setMatrixAt(cn[k]++, mtx);
  }
  crowds.forEach((m, k) => { m.count = cn[k]; if (cn[k]) courseRoot.add(m); });

  /* ---- bunting: cheap, dense, and always within a metre of the verge ------ */
  const flagG = new THREE.PlaneGeometry(0.9, 0.62);
  const flags = new THREE.InstancedMesh(flagG,
    new THREE.MeshLambertMaterial({ color: TH.post.a, side: THREE.DoubleSide }), 700);
  let n = 0;
  for (let s0 = 20; s0 < T.LENGTH - 20 && n < 700; s0 += 3.2) {
    const { nrm, right, tan } = basisAt(s0);
    /* Face ACROSS the road, not along it. Oriented like the banners the flags
       were edge-on to a camera that sits beside the road, and 700 of them
       rendered as a faint dotted line. */
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      tan.clone().normalize(), nrm, right));
    for (const side of [-1, 1]) {
      if (n >= 700) break;
      const c = v3(T.surfaceAt(s0, side * (T.halfWAt(s0) + SHOULDER * 0.85)));
      const sway = 0.25 + 0.25 * Math.sin(s0 * 0.9);
      mtx.compose(c.addScaledVector(nrm, 2.3 + sway * 0.4), q,
                  new THREE.Vector3(1, 1, 1));
      flags.setMatrixAt(n++, mtx);
    }
  }
  flags.count = n;
  courseRoot.add(flags);
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
    /* Clouds, painted straight into the dome. Banded by height and broken up
       by noise, so they read as weather rather than as a gradient — and they
       cannot pop, drift or cost a draw call. */
    if (v.y > 0.04) {
      const band = Math.max(0, 1 - Math.abs(v.y - 0.30) / 0.30);
      const f = fbm(v.x * 3.4 + 9.1, v.z * 3.4 - 4.3)
              + fbm(v.x * 9.0, v.z * 9.0) * 0.45;
      const cloud = Math.max(0, Math.min(1, (f + 0.22) * 2.4)) * band;
      c = [0, 1, 2].map((k) => c[k] + (0.92 - c[k]) * cloud * 0.72);
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
/* One cart, built to order. Rivals are the same object as yours in a different
   colour — nothing about them is cheaper or faked, because the moment they are
   they stop reading as cars in the race and start reading as scenery. */
function makeCart(col) {
  const cart = new THREE.Group();
  const G = new THREE.Group();                 // body group: rolls and pitches
  cart.add(G);
  cart.userData.body = G;

  /* Silhouette first. Three clearly different masses — a long low shell, a
     rider sat high in it, and small wheels — because equal-sized lumps read as
     a pile whatever detail you bolt on. The helmet is the brightest thing on
     the cart on purpose: at this camera distance it is the dot your eye tracks. */
  const shell = new THREE.BoxGeometry(1.5, 0.46, 3.0);
  const pos = shell.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > 0) {                               // taper toward the nose
      pos.setX(i, pos.getX(i) * 0.62);
      pos.setY(i, pos.getY(i) * 0.72 - 0.05);
    }
  }
  shell.computeVertexNormals();
  const paint = new THREE.MeshPhongMaterial({
    color: col.body, shininess: 26, specular: 0x2a2a2a, flatShading: true,
  });
  const body = new THREE.Mesh(shell, paint);
  body.position.y = 0.44; body.castShadow = true;
  G.add(body);

  const dark = new THREE.MeshLambertMaterial({ color: 0x191b1e });
  const pan = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.16, 2.7), dark);
  pan.position.y = 0.24; pan.castShadow = true;
  G.add(pan);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 4), paint);
  nose.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  nose.position.set(0, 0.40, 1.85); nose.castShadow = true;
  G.add(nose);

  /* A tail fin. Pure silhouette — it costs six triangles and it is what tells
     you which way a cart is pointing when it is forty metres away. */
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.46, 0.62),
    new THREE.MeshLambertMaterial({ color: col.nose }));
  fin.position.set(0, 0.80, -1.28); fin.castShadow = true;
  G.add(fin);

  /* Big at the back, small at the front: a hot-rod stance reads instantly and
     gives the shape somewhere to sit. */
  const wheels = [];
  const tyre = new THREE.MeshLambertMaterial({ color: 0x141416 });
  const hub = new THREE.MeshLambertMaterial({ color: 0x8d8f93 });
  for (const [x, z, r, steers] of [[-0.84, 1.12, 0.30, 1], [0.84, 1.12, 0.30, 1],
                                   [-0.88, -1.12, 0.42, 0], [0.88, -1.12, 0.42, 0]]) {
    const pivot = new THREE.Group();            // steering
    pivot.position.set(x, r, z);
    const spin = new THREE.Group();             // rolling
    const g = new THREE.CylinderGeometry(r, r, 0.26, 12);
    g.rotateZ(Math.PI / 2);
    const w = new THREE.Mesh(g, tyre);
    w.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.30, r * 0.9, r * 0.9), hub);
    spin.add(w, cap);
    pivot.add(spin);
    G.add(pivot);
    wheels.push({ pivot, spin, r, steers });
  }
  cart.userData.wheels = wheels;

  const rider = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.30, 0.52, 3, 8),
    new THREE.MeshLambertMaterial({ color: col.rider }));
  torso.name = 'torso'; torso.position.y = 0.46; torso.castShadow = true;
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.20, 0.34),
    new THREE.MeshLambertMaterial({ color: col.rider }));
  shoulders.position.y = 0.76; shoulders.castShadow = true;
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshPhongMaterial({ color: col.skin, shininess: 40, specular: 0x333333 }));
  helmet.name = 'head'; helmet.position.y = 1.06; helmet.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.11, 0.22),
    new THREE.MeshLambertMaterial({ color: 0x14181f }));
  visor.position.set(0, 1.07, 0.20);
  rider.add(torso, shoulders, helmet, visor);
  rider.position.set(0, 0.50, -0.30);
  G.add(rider);

  scene.add(cart);
  cart.userData.rider = rider;
  cart.userData.anim = { roll: 0, pitch: 0, spin: 0, susp: 0, prevV: 0, steer: 0 };
  return cart;
}

/* The height cues. Built once and never rebuilt, unlike the cart, which is
   recreated whenever the theme changes. */
function buildCues() {
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

  buildCues();
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
  buildBarriers();
  buildMarks();
  buildFurniture(tr);

  /* Rebuild the cart rather than reaching into it to repaint. The old code
     poked cart.children[0].material, which stopped being a Mesh the moment the
     body gained a group to roll and pitch inside. */
  if (cart) dispose(cart);
  cart = makeCart(TH.cart);
  rider = cart.userData.rider;
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
/* GPU buffers are not garbage collected with the scene graph. */
function dispose(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material])
      .forEach((m) => m.dispose());
  });
  scene.remove(root);
}

/* Rivals get their own meshes on demand, keyed to the field. Called whenever a
   race starts; safe to call repeatedly. */
export function setField(carts) {
  for (const m of rivalCarts) dispose(m);
  rivalCarts = [];
  for (const c of carts) {
    if (c.isPlayer) continue;
    const m = makeCart({ body: c.color, nose: c.color, rider: 0x22262b,
                         skin: TH.cart.skin });
    m.userData.cart = c;
    rivalCarts.push(m);
  }
}

/* Sit one cart on the road. Shared by you and by every rival, so a rival can
   never be placed by different rules than you are. */
function placeCart(group, St, dt) {
  const { tan, right, nrm } = basisAt(St.s);
  const surf = v3(T.surfaceAt(St.s, St.u));
  const y = St.air ? St.yAir : surf.y;
  const pos = new THREE.Vector3(surf.x, y, surf.z).addScaledVector(nrm, 0.02);
  group.position.copy(pos).addScaledVector(nrm, 0.34);
  /* setFromRotationMatrix assumes a pure rotation. {right, nrm, tan} has
     determinant -1 at EVERY heading — it is a reflection, because nrm is built
     as right x tan, so the handed order is (Z x X) not (X x Z). Feeding a
     reflection in returns a meaningless quaternion, and the cart sat broadside
     across the road. Build X from nrm x tan instead. */
  const bx = new THREE.Vector3().crossVectors(nrm, tan).normalize();
  group.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(bx, nrm, tan.clone().normalize()));

  /* ---- the part that actually makes it look like a car ------------------- */
  const A = group.userData.anim, G = group.userData.body;
  const k = Math.min(1, dt * 8);

  /* Body rolls OUT of the corner, rider leans IN. Two objects disagreeing is
     what sells weight; a rigid model at any level of detail does not. */
  const latG = (St.v * St.v * T.khAt(St.s)) / 9.81;
  const wantRoll = Math.max(-0.30, Math.min(0.30, latG * 0.055));
  A.roll += (wantRoll - A.roll) * k;

  /* Squat under power, dive under braking. Read from the speed the physics
     actually produced rather than from the inputs, so it never lies. */
  const accel = dt > 0 ? (St.v - A.prevV) / dt : 0;
  A.prevV = St.v;
  const wantPitch = Math.max(-0.14, Math.min(0.14, -accel * 0.012));
  A.pitch += (wantPitch - A.pitch) * Math.min(1, dt * 6);

  if (A.wasAir && !St.air) A.susp = Math.min(0.34, (St.lastLanding || 0) * 0.035);
  A.wasAir = St.air;
  A.susp *= Math.max(0, 1 - dt * 6);

  G.rotation.z = A.roll;
  G.rotation.x = A.pitch + (St.air ? -0.06 : 0);
  G.position.y = -A.susp;
  group.userData.rider.rotation.z = -A.roll * 0.75;

  A.spin += St.v * dt;
  A.steer += (((St.input && St.input.steer) || 0) * 0.42 - A.steer) * Math.min(1, dt * 10);
  for (const w of group.userData.wheels) {
    w.spin.rotation.x = -A.spin / w.r;
    if (w.steers) w.pivot.rotation.y = -A.steer;
  }

  const r = group.userData.rider, c = St.c;
  r.position.y = 0.30 + c * 0.42;
  r.getObjectByName('torso').scale.set(1 + (1 - c) * 0.22, 0.66 + c * 0.34, 1 + (1 - c) * 0.22);
  r.rotation.x = (1 - c) * 0.62;
  return { tan, right, nrm, surf, pos };
}

export function frame(S, dt) {
  const { tan, right, nrm, surf, pos } = placeCart(cart, S, dt);
  const y = S.air ? S.yAir : surf.y;

  for (const m of rivalCarts) {
    const c = m.userData.cart;
    m.visible = !c.done;
    if (m.visible) placeCart(m, c, dt);
  }

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
  /* Yaw follows the road CONTINUOUSLY and slowly. It used to snap to eight
     compass points, which frames a straight nicely and is miserable on a
     course with sixteen corners: every turn fired a re-frame and the whole
     view lurched. Smooth and lazy beats composed and jerky. */
  const desired = T.headAt(Math.min(T.LENGTH - 1, S.s + 22));
  let e = desired - camYaw;
  while (e > Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  camYaw += e * Math.min(1, dt * 1.5);

  /* Look ahead of the cart so it sits low in frame. On a fixed iso camera the
     sightline is short and the cart must never be centred, or the player is
     reacting to road they can barely see. */
  const lead = 15 + S.v * 0.75;
  const ahead = v3(T.surfaceAt(Math.min(T.LENGTH, S.s + lead), S.u * 0.5));
  const tgt = pos.clone().lerp(ahead, 0.62);

  /* Widening the road is pointless if the view widens with it — the road has
     to occupy MORE of the frame, not the same fraction of a bigger one. The
     boost punches IN rather than out: a camera that tightens under power is
     the oldest trick for selling acceleration and it still works. */
  const punch = (S.input && S.input.boost && S.charge > 0.02) ? -4.0 : 0;
  camSize += ((46 + S.v * 0.50 + punch) - camSize) * Math.min(1, dt * 2.6);
  applyCamSize(camSize);

  /* Shake, applied to the look target rather than the camera alone, so the
     whole frame translates instead of the view swinging. Scales with the
     square of speed so it is absent at a crawl and unmistakable at 50. */
  shakeT += dt * 43;
  /* A tenth of what it was. At 0.30 the frame never settled. */
  const amp = opts.shake ? Math.pow(Math.min(1, S.v / 30), 2) * (S.air ? 0.01 : 0.05) : 0;
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

  /* Open the roof while the cart is under it, with a margin so it is already
     clear by the time you arrive. */
  for (const r of tunnelRoofs) {
    const inside = S.s > r.a - 26 && S.s < r.b + 14;
    const want = inside ? 0.0 : 1.0;
    r.mesh.material.opacity += (want - r.mesh.material.opacity) * Math.min(1, dt * 5);
    r.mesh.visible = r.mesh.material.opacity > 0.02;
  }

  dust.visible = opts.dust;
  if (opts.dust) {
    updateDust(S, dt, surf.clone().addScaledVector(tan, -1.1).addScaledVector(nrm, 0.25), right);
  }

  renderer.render(scene, camera);
}

export function cameraYaw() { return camYaw; }
export const _dbg = () => ({ scene, camera, roadMesh, cart, blob, sun });
