/* ============================================================================
   FREEWHEEL — wiring, screens and the main loop.
   ========================================================================== */

/* Imported WITHOUT a cache-busting query, deliberately.

   A different URL is a different module instance. render.js and sim.js import
   './track.js' plainly, so importing './track.js?v=N' here created a SECOND
   copy of the track module with its own state: switching venue moved the HUD
   and the physics to the new course while the renderer quietly kept building
   the old one. Freshness is handled where it belongs — the dev server sends
   no-store and vercel.json sends must-revalidate on every .js. */
const [T, SIM, R, THEME] = await Promise.all([
  import('./track.js'),
  import('./sim.js'),
  import('./render.js'),
  import('./theme.js'),
]);

const el = (id) => document.getElementById(id);
R.init(el('c'));
el('boot').remove();

let S = SIM.create();
let mode = 'intro';          // intro | play | settings | done
let prevMode = 'intro';
/* Records are per venue. One global best across courses of different lengths
   would be meaningless, and per-hill is the number a player actually wants. */
const bestKey = (id) => `fw.best.${id}`;
const bestFor = (id) => +(localStorage.getItem(bestKey(id)) || 0) || null;

/* -------------------------------- settings -------------------------------- */
const SAVED = 'fw.opts';
let res = +(localStorage.getItem('fw.res') || 1);

function loadOpts() {
  try {
    const o = JSON.parse(localStorage.getItem(SAVED) || '{}');
    for (const k of Object.keys(R.opts)) if (k in o) R.opts[k] = !!o[k];
  } catch { /* a corrupt blob is not worth a crash; defaults are fine */ }
}
function saveOpts() {
  localStorage.setItem(SAVED, JSON.stringify(R.opts));
  localStorage.setItem('fw.res', String(res));
}
function syncSettingsUI() {
  document.querySelectorAll('[data-opt]').forEach((row) => {
    row.classList.toggle('on', !!R.opts[row.dataset.opt]);
  });
  document.querySelectorAll('#resSeg button').forEach((b) => {
    b.classList.toggle('on', +b.dataset.res === res);
  });
}
document.querySelectorAll('[data-opt]').forEach((row) => {
  row.addEventListener('click', () => {
    R.opts[row.dataset.opt] = !R.opts[row.dataset.opt];
    syncSettingsUI(); saveOpts();
  });
});
document.querySelectorAll('#resSeg button').forEach((b) => {
  b.addEventListener('click', () => { res = +b.dataset.res; R.setRes(res); syncSettingsUI(); saveOpts(); });
});
loadOpts();
R.setRes(res);
syncSettingsUI();

/* --------------------------------- screens -------------------------------- */
function show(next) {
  if (next === 'settings' && mode !== 'settings') prevMode = mode;
  mode = next;
  for (const id of ['intro', 'venues', 'settings', 'done']) {
    el(id).classList.toggle('on', id === next);
  }
  el('hudWrap').classList.toggle('on', next === 'play');
  if (next === 'settings') syncSettingsUI();
  if (next === 'venues') drawVenues();
}

function startRun(courseId) {
  if (courseId && courseId !== T.ID) { T.load(courseId); R.build(); drawProfile(); }
  S = SIM.create();
  lastPumpShown = 0;
  show('play');
}

/* The picker is generated from the course table, so a new venue appears here
   the moment it exists in track.js — there is no second list to keep in step. */
function drawVenues() {
  const list = el('venueList');
  list.innerHTML = '';
  for (const id of T.COURSE_IDS) {
    const C = T.COURSES[id];
    const th = THEME.get(C.theme);
    const stops = th.terrain.stops;
    const css = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, v * 1.25) * 255)).join(',')})`;
    const b = bestFor(id);
    const node = document.createElement('button');
    node.className = 'venue';
    node.style.setProperty('--c1', css(stops[stops.length - 1][1]));
    node.style.setProperty('--c2', css(stops[1][1]));
    node.innerHTML = `<div class="sw"></div>
      <div><div class="vt">${C.title}</div>
      <div class="vo">owns &mdash; ${C.owns}</div>
      <div class="vb">${C.blurb}</div></div>
      <div class="vr">${b ? `<div class="n">${b.toFixed(2)}</div><div class="l">best</div>`
                          : '<div class="l">unrun</div>'}</div>`;
    node.onclick = () => startRun(id);
    list.appendChild(node);
  }
}

el('go').onclick = () => show('venues');
el('again').onclick = () => startRun();
el('doneVen').onclick = () => show('venues');
el('venBack').onclick = () => show('intro');
el('venSet').onclick = () => show('settings');
el('openSet').onclick = () => show('settings');
el('doneSet').onclick = () => show('settings');
el('closeSet').onclick = () => show(prevMode === 'settings' ? 'intro' : prevMode);
el('toIntro').onclick = () => show('intro');

/* --------------------------------- input ---------------------------------- */
const keys = new Set();
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'a', 'd', 's', 'w', 'arrowleft', 'arrowright', 'arrowdown', 'arrowup']
      .includes(k)) e.preventDefault();
  if (keys.has(k)) return;
  keys.add(k);

  if (k === 'escape') {
    if (mode === 'settings') el('closeSet').click();
    else if (mode === 'play' || mode === 'done') show('settings');
    return;
  }
  if (mode !== 'play') {
    if (k === 'enter' || (k === ' ' && mode === 'intro')) show('venues');
    return;
  }
  if (k === 'r') startRun();
  if (k === 'v') show('venues');
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function readInput() {
  S.input.tuck = keys.has(' ');
  S.input.brake = keys.has('s') || keys.has('arrowdown');
  S.input.thrust = keys.has('w') || keys.has('arrowup') || keys.has('shift');
  S.input.steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0)
                - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
}

/* ------------------------------ elevation strip ---------------------------- */
/* Drawn once. It is the progress bar and the fuel gauge at the same time,
   because on this hill those are literally the same quantity. */
let PROF = [];
function drawProfile() {
  const W = 112, H = 340, pad = 8;
  PROF = [];
  for (let s = 0; s <= T.LENGTH; s += 8) {
    const y = T.surfaceAt(s).y;
    PROF.push([pad + (s / T.LENGTH) * (W - pad * 2),
               pad + (1 - (y - T.BOT_Y) / (T.TOP_Y - T.BOT_Y)) * (H - pad * 2)]);
  }
  el('profline').setAttribute('points', PROF.map((p) => p.join(',')).join(' '));
}
drawProfile();

/* ---------------------------------- HUD ----------------------------------- */
let flashT = 0, lastPumpShown = 0;

function updateHUD(dt) {
  el('mph').textContent = Math.round(S.v * 2.2369);
  el('seg').textContent = T.NAMES[T.segAt(S.s)];

  /* Load is what the pump is paid in, so show it plainly: past 1 g the road is
     pushing back, and standing up converts that push into speed. */
  const load = S.air ? 0 : S.N;
  el('loadfill').style.width = Math.min(100, load * 33.3) + '%';
  el('loadfill').style.background = load > 1.25 ? 'var(--warm)' : 'var(--cold)';
  /* Flywheel. Shown in seconds because that is what you spend. */
  const ch = S.charge / SIM.tune.chargeMax;
  el('chgfill').style.width = (ch * 100) + '%';
  el('chgnum').textContent = S.charge.toFixed(1) + 's';
  el('chg').classList.toggle('spent', S.input.thrust && S.charge > 0);
  el('chg').classList.toggle('ready', S.charge > 0.25);

  const want = S.air ? 'airborne' : (load > 1.25 ? 'stand up' : 'tuck');
  el('cue').textContent = want;
  el('cue').classList.toggle('on', want === 'stand up');

  const i = Math.min(PROF.length - 1, Math.floor((S.s / T.LENGTH) * (PROF.length - 1)));
  el('profdone').setAttribute('points', PROF.slice(0, i + 1).map((p) => p.join(',')).join(' '));
  el('profdot').setAttribute('cx', PROF[i][0]);
  el('profdot').setAttribute('cy', PROF[i][1]);

  if (S.pumpTotal - lastPumpShown > 0.18) {
    el('flashn').textContent = '+' + ((S.pumpTotal - lastPumpShown) * 2.2369).toFixed(1);
    lastPumpShown = S.pumpTotal;
    flashT = 0.55;
  }
  if (flashT > 0) {
    flashT -= dt;
    el('flash').style.opacity = Math.max(0, Math.min(1, flashT / 0.35));
    el('flash').style.transform = `translateX(-50%) translateY(${-(0.55 - flashT) * 26}px)`;
  } else el('flash').style.opacity = 0;
}

function finish() {
  el('dtime').textContent = S.t.toFixed(2);
  el('dtop').textContent = Math.round(S.vMax * 2.2369);
  el('dpump').textContent = (S.pumpTotal * 2.2369).toFixed(1);
  el('dair').textContent = S.airTotal.toFixed(1);
  el('dthrust').textContent = (S.thrustTotal * 2.2369).toFixed(1);
  el('dcourse').textContent = T.TITLE;
  const b = bestFor(T.ID);
  if (b === null || S.t < b) {
    localStorage.setItem(bestKey(T.ID), String(S.t));
    el('dbest').textContent = 'a new best';
  } else {
    el('dbest').textContent = `best ${b.toFixed(2)}s`;
  }
  show('done');
}

/* --------------------------------- the loop -------------------------------- */
/* Fixed 120 Hz physics with an accumulator, so sim() and the game agree, and so
   a slow frame changes how much is simulated rather than what happens. */
const HZ = 1 / 120;
let acc = 0, last = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;         // a backgrounded tab must not teleport

  if (mode === 'play') {
    acc += dt;
    readInput();
    let guard = 0;
    while (acc >= HZ && guard++ < 60) { SIM.step(S, HZ); acc -= HZ; }
    updateHUD(dt);
    if (S.done) finish();
  } else {
    acc = 0;
  }

  R.frame(S, dt);                    // menus render the live scene behind them
}
requestAnimationFrame(tick);

/* A hidden or occluded panel never fires rAF, and the symptom is a black canvas
   that looks exactly like a broken renderer. Draw from a timer as well. */
setInterval(() => {
  if (document.hidden) return;
  if (performance.now() - last > 400) { last = performance.now(); R.frame(S, 1 / 60); }
}, 500);

show('intro');

/* --------------------------------- console -------------------------------- */
window.FW = {
  get S() { return S; }, set S(x) { S = x; },
  tune: SIM.tune, opts: R.opts, T, SIM, R, THEME,
  simAll: (o) => { const r = SIM.simAll(o); console.table(r); return r; },
  course: (id) => { startRun(id); return T.TITLE; },
  sim: (o) => { const r = SIM.sim(o); console.table(r); return r; },
  step: (n = 1) => { for (let i = 0; i < n; i++) SIM.step(S, HZ); return S; },
  play: startRun,
  seek: (s) => { S.s = Math.max(0, Math.min(T.LENGTH - 1, s)); return S; },
};
console.log('%cFREEWHEEL', 'font:600 14px system-ui',
  '— FW.sim() compares policies, FW.tune retunes live, FW.seek(m) jumps.');
