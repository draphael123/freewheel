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
const [T, SIM, R, THEME, RACE, AUDIO, SEASON] = await Promise.all([
  import('./track.js'),
  import('./sim.js'),
  import('./render.js'),
  import('./theme.js'),
  import('./race.js'),
  import('./audio.js'),
  import('./season.js'),
]);

const el = (id) => document.getElementById(id);
R.init(el('c'));
el('boot').remove();

let field = null;
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
/* Declared up here because syncSettingsUI runs during module init, and a `let`
   further down is still in its temporal dead zone at that point. */
let muted = localStorage.getItem('fw.mute') === '1';

/* Sound has to be created on a real gesture, so arm it from the first one of
   any kind rather than only from the button that starts a race. */
function armAudio() { AUDIO.unlock(); AUDIO.setMuted(muted); }
addEventListener('pointerdown', armAudio, { once: true });
addEventListener('keydown', armAudio, { once: true });

/* Post-chain toggles are NUMBERS, not booleans — a strength of 0 is "off". The
   defaults are captured once at boot so a toggle can restore the tuned value
   rather than some hardcoded guess that drifts out of step with post.js. */
const POST_ON = { ...R.post };
/* Only these are user toggles. threshold/contrast/saturation are tuning, not
   preferences, and persisting them as booleans would let a stale save clobber
   a retune. */
const POST_KEYS = ['bloom', 'grain', 'vignette', 'aberration', 'speedLines', 'tilt'];
let units = localStorage.getItem('fw.units') === 'kmh' ? 'kmh' : 'mph';
let fov = +(localStorage.getItem('fw.fov') || 62);
const hudShow = { order: true, prof: true, tip: true };

function applyHud() {
  for (const k of Object.keys(hudShow)) {
    const n = el(k);
    if (n) n.style.display = hudShow[k] ? '' : 'none';
  }
}

function loadOpts() {
  try {
    const o = JSON.parse(localStorage.getItem(SAVED) || '{}');
    for (const k of Object.keys(R.opts)) if (k in o) R.opts[k] = !!o[k];
  } catch { /* a corrupt blob is not worth a crash; defaults are fine */ }
  try {
    const q = JSON.parse(localStorage.getItem('fw.post') || '{}');
    for (const k of POST_KEYS) {
      if (k in q) R.post[k] = q[k] ? POST_ON[k] : 0;
    }
  } catch { /* ditto */ }
  try {
    const hv = JSON.parse(localStorage.getItem('fw.hud') || '{}');
    for (const k of Object.keys(hudShow)) if (k in hv) hudShow[k] = !!hv[k];
  } catch { /* ditto */ }
  R.setFov(fov);
  applyHud();
}
function saveOpts() {
  localStorage.setItem(SAVED, JSON.stringify(R.opts));
  localStorage.setItem('fw.res', String(res));
  localStorage.setItem('fw.diff', RACE.difficulty);
  localStorage.setItem('fw.view', R.getView());
  localStorage.setItem('fw.mute', muted ? '1' : '0');
  localStorage.setItem('fw.units', units);
  localStorage.setItem('fw.fov', String(fov));
  const q = {};
  for (const k of POST_KEYS) q[k] = R.post[k] > 0;
  localStorage.setItem('fw.post', JSON.stringify(q));
  localStorage.setItem('fw.hud', JSON.stringify(hudShow));
}
function syncSettingsUI() {
  document.querySelectorAll('[data-opt]').forEach((row) => {
    row.classList.toggle('on', !!R.opts[row.dataset.opt]);
  });
  document.querySelectorAll('#resSeg button').forEach((b) => {
    b.classList.toggle('on', +b.dataset.res === res);
  });
  document.querySelectorAll('#diffSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.diff === RACE.difficulty);
  });
  document.querySelectorAll('#viewSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === R.getView());
  });
  document.querySelectorAll('[data-post]').forEach((row) => {
    row.classList.toggle('on', R.post[row.dataset.post] > 0);
  });
  document.querySelectorAll('[data-hud]').forEach((row) => {
    row.classList.toggle('on', !!hudShow[row.dataset.hud]);
  });
  document.querySelectorAll('#fovSeg button').forEach((b) => {
    b.classList.toggle('on', +b.dataset.fov === fov);
  });
  document.querySelectorAll('#unitSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.unit === units);
  });
  el('muteRow').classList.toggle('on', !muted);
}
document.querySelectorAll('[data-opt]').forEach((row) => {
  row.addEventListener('click', () => {
    R.opts[row.dataset.opt] = !R.opts[row.dataset.opt];
    syncSettingsUI(); saveOpts();
  });
});
document.querySelectorAll('[data-post]').forEach((row) => {
  row.addEventListener('click', () => {
    const k = row.dataset.post;
    R.post[k] = R.post[k] > 0 ? 0 : POST_ON[k];
    syncSettingsUI(); saveOpts();
  });
});
document.querySelectorAll('[data-hud]').forEach((row) => {
  row.addEventListener('click', () => {
    hudShow[row.dataset.hud] = !hudShow[row.dataset.hud];
    applyHud(); syncSettingsUI(); saveOpts();
  });
});
document.querySelectorAll('#fovSeg button').forEach((b) => {
  b.addEventListener('click', () => { fov = +b.dataset.fov; R.setFov(fov); syncSettingsUI(); saveOpts(); });
});
document.querySelectorAll('#unitSeg button').forEach((b) => {
  b.addEventListener('click', () => { units = b.dataset.unit; syncSettingsUI(); saveOpts(); });
});
document.querySelectorAll('#resSeg button').forEach((b) => {
  b.addEventListener('click', () => { res = +b.dataset.res; R.setRes(res); syncSettingsUI(); saveOpts(); });
});
document.querySelectorAll('#diffSeg button').forEach((b) => {
  b.addEventListener('click', () => { RACE.setDifficulty(b.dataset.diff); syncSettingsUI(); saveOpts(); });
});
document.querySelectorAll('#viewSeg button').forEach((b) => {
  b.addEventListener('click', () => { R.setView(b.dataset.view); syncSettingsUI(); saveOpts(); });
});
el('muteRow').addEventListener('click', () => {
  muted = !muted; AUDIO.setMuted(muted); syncSettingsUI(); saveOpts();
});
loadOpts();
RACE.setDifficulty(localStorage.getItem('fw.diff') || 'normal');
R.setView(localStorage.getItem('fw.view') || 'iso');
R.setRes(res);
syncSettingsUI();

/* --------------------------------- screens -------------------------------- */
function show(next) {
  if (next === 'settings' && mode !== 'settings') prevMode = mode;
  mode = next;
  for (const id of ['intro', 'venues', 'route', 'settings', 'done']) {
    el(id).classList.toggle('on', id === next);
  }
  el('hudWrap').classList.toggle('on', next === 'play');
  if (next === 'settings') syncSettingsUI();
  if (next === 'venues') drawVenues();
  if (next === 'route') drawRoute();
}

/* --------------------------------- season --------------------------------
   The hook's control surface. Picking a venue opens its season rather than
   starting a race, because the interesting unit of play is now the SEASON: a
   run is one decision inside it. */
let seasonCourse = null;
let pickedRoute = {};
let pickedLoad = SIM.loadById('std');
let lastClosed = [];
let rivalRoutes = [];

function openSeason(courseId) {
  const forks = T.forksOf(courseId);
  if (!forks.length) { startRun(courseId, null); return; }   // venues without forks still race
  seasonCourse = courseId;
  SEASON.begin(courseId, forks);
  pickedRoute = SEASON.legalRoute(forks, T.defaultRoute(courseId));
  lastClosed = [];
  show('route');
}

/* Wear does two things and they are NOT the same: it eventually closes a road,
   and long before that it makes it worse to drive. The second is the half you
   feel, so it is baked into the course as grip and width factors. */
function routeWithWear(courseId, picked) {
  const out = {};
  for (const f of T.forksOf(courseId)) {
    const bid = picked[f.id];
    const c = SEASON.conditionOf(f.id, bid);
    const w = SEASON.wearEffect(c);
    out[f.id] = { id: bid, grip: w.grip, width: w.width };
  }
  return out;
}

function drawRoute() {
  const forks = T.forksOf(seasonCourse);
  const st = SEASON.state();
  el('rRun').textContent = Math.min(st.run, SEASON.RUNS);
  el('rOf').textContent = SEASON.RUNS;
  el('rPts').textContent = st.points;
  el('rCourse').textContent = T.COURSES[seasonCourse].title;

  el('rClosed').innerHTML = lastClosed.length
    ? lastClosed.map((c) => `&mdash; ${c.branch.name} has gone`
        + `${c.by === 'you' ? ', under your load' : ''}.`).join('<br>')
    : '';

  /* The load picker. Pay and wear are stated as plain multipliers because the
     whole decision is "how much of the road am I willing to spend for this". */
  el('rLoads').innerHTML = SIM.LOADS.map((l) => {
    const on = pickedLoad.id === l.id;
    return `<button class="opt${on ? ' on' : ''}" data-load="${l.id}">
      <div class="on1">${l.name}</div>
      <div class="on2">${l.note}</div>
      <div class="cw">${l.pay.toFixed(1)}&times; pay &middot; ${l.wear.toFixed(2)}&times; wear</div>
    </button>`;
  }).join('');
  el('rLoads').querySelectorAll('.opt').forEach((b) => {
    b.addEventListener('click', () => {
      pickedLoad = SIM.loadById(b.dataset.load);
      drawRoute();
    });
  });

  el('rForks').innerHTML = forks.map((f) => {
    const opts = f.branches.map((b) => {
      const c = SEASON.conditionOf(f.id, b.id);
      const shut = c <= SEASON.CLOSED_AT;
      const on = pickedRoute[f.id] === b.id && !shut;
      return `<button class="opt${on ? ' on' : ''}${shut ? ' shut' : ''}`
        + `${!shut && c < 0.3 ? ' warn' : ''}" data-fork="${f.id}" data-branch="${b.id}"
           ${shut ? 'disabled' : ''}>
          <div class="on1">${b.name}</div>
          <div class="on2">${shut ? 'the road is gone' : b.note}</div>
          <div class="cbar"><div class="cfill" style="width:${Math.round(c * 100)}%"></div></div>
          <div class="cw">${SEASON.conditionWord(c)}</div>
        </button>`;
    }).join('');
    return `<div class="fork"><div class="fh">${f.prompt}</div>
            <div class="opts">${opts}</div></div>`;
  }).join('');

  el('rForks').querySelectorAll('.opt').forEach((b) => {
    b.addEventListener('click', () => {
      pickedRoute[b.dataset.fork] = b.dataset.branch;
      drawRoute();
    });
  });

  /* When the season is over the board must offer a way FORWARD. It used to
     disable the button and leave "give up the season" as the only live control,
     which is a dead end worded as a failure — and you hit it at the end of
     every single season. */
  const dead = SEASON.impassable(forks) || st.done;
  el('rGo').textContent = dead ? 'open a new season' : 'take the load down';
  el('rGo').disabled = false;
  el('rClosed').innerHTML = dead
    ? (SEASON.impassable(forks)
        ? `The road is finished. ${st.points} points this season.`
        : `Season over. ${st.points} points.`)
    : el('rClosed').innerHTML;
}

el('rGo').addEventListener('click', () => {
  const forks = T.forksOf(seasonCourse);
  const st = SEASON.state();
  if (SEASON.impassable(forks) || (st && st.done)) {
    SEASON.reset(seasonCourse, forks);
    pickedRoute = T.defaultRoute(seasonCourse);
    lastClosed = [];
    drawRoute();
    return;
  }
  startRun(seasonCourse, pickedRoute);
});
el('rSet').addEventListener('click', () => show('settings'));
el('rQuit').addEventListener('click', () => {
  SEASON.reset(seasonCourse, T.forksOf(seasonCourse));
  pickedRoute = T.defaultRoute(seasonCourse);
  lastClosed = [];
  show('venues');
});

function startRun(courseId, route) {
  /* Always rebuild when a route is in play: the same course with a different
     route is a different centreline, so caching on course id alone would race
     you down last run's mountain. */
  if (courseId && (route || courseId !== T.ID)) {
    /* Tell the renderer what has closed BEFORE it builds, so the roads you can
       no longer take come up chained rather than merely unchosen. */
    const shut = new Set();
    for (const f of T.forksOf(courseId)) {
      for (const b of f.branches) {
        if (!SEASON.state() || !SEASON.isOpen(f.id, b.id)) {
          if (SEASON.state()) shut.add(f.id + '/' + b.id);
        }
      }
    }
    R.setClosedRoads(shut);
    T.load(courseId, route ? routeWithWear(courseId, route) : null);
    R.build();
    drawProfile();
  }
  /* Rivals wear the mountain too. Without this the road is being destroyed by
     you alone, which reads as the game punishing you for playing. */
  rivalRoutes = [];
  if (route) {
    for (const f of T.forksOf(courseId)) {
      const open = SEASON.openBranches(f);
      for (let i = 0; i < 4; i++) {
        rivalRoutes[i] = rivalRoutes[i] || {};
        rivalRoutes[i][f.id] = open.length
          ? open[Math.floor(Math.random() * open.length)].id : f.branches[0].id;
      }
    }
  }
  field = RACE.createField();
  R.setField(field.carts);
  S = field.you;
  /* Only the player carries a load — the rivals are hauling their own problem
     and modelling it would change nothing you can see. */
  S.load = (seasonCourse && T.forksOf(courseId || T.ID).length) ? pickedLoad : null;
  /* Later runs are later in the year: the same descent finishes darker. The
     road failing and the light going are the same story told twice. */
  const sst = SEASON.state();
  R.setSeasonProgress(sst && seasonCourse
    ? (sst.run - 1) / Math.max(1, SEASON.RUNS - 1) : 0);
  countdown = 3.2;
  steerNow = 0;
  lastCount = 9;
  lastPumpShown = 0;
  snap = { bale: 0, wall: 0, spin: 0, land: 0 };
  armAudio();
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
    /* Swatch from the zones the course actually visits, first and last, so the
       chip previews the journey rather than a palette. */
    const zs = [...new Set(C.segments.map((g) => g.zone || 'forest'))];
    const css = (id) => {
      const c = (th.zones[id] || th.zones.forest).ground;
      return `rgb(${c.map((v) => Math.round(Math.min(1, v * 1.25) * 255)).join(',')})`;
    };
    const b = bestFor(id);
    const node = document.createElement('button');
    node.className = 'venue';
    node.style.setProperty('--c1', css(zs[0]));
    node.style.setProperty('--c2', css(zs[zs.length - 1]));
    node.innerHTML = `<div class="sw"></div>
      <div><div class="vt">${C.title}</div>
      <div class="vo">owns &mdash; ${C.owns}</div>
      <div class="vb">${C.blurb}</div></div>
      <div class="vr">${b ? `<div class="n">${b.toFixed(2)}</div><div class="l">best</div>`
                          : '<div class="l">unrun</div>'}</div>`;
    node.onclick = () => openSeason(id);
    list.appendChild(node);
  }
}

el('go').onclick = () => show('venues');
/* After a run you go back to the ROUTE BOARD, not straight into another race:
   seeing what your last load did to the mountain is the point of the season. */
el('again').onclick = () => {
  const forks = T.forksOf(seasonCourse || T.ID);
  if (!seasonCourse || !forks.length) { startRun(); return; }
  const st = SEASON.state();
  if (st && st.done) { SEASON.reset(seasonCourse, forks); lastClosed = []; }
  pickedRoute = SEASON.legalRoute(forks, pickedRoute);
  show('route');
};
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
  if ([' ', 'a', 'd', 's', 'w', 'shift', 'arrowleft', 'arrowright', 'arrowdown',
       'arrowup'].includes(k)) e.preventDefault();
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
  if (k === 'm') { muted = !muted; AUDIO.setMuted(muted); saveOpts(); }
  if (k === 'c') {
    const i = R.VIEWS.indexOf(R.getView());
    R.setView(R.VIEWS[(i + 1) % R.VIEWS.length]);
    saveOpts();
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

/* Steering is ANALOGUE even though the keyboard is not.

   This was the single biggest cause of "stiff rather than fluid": the raw key
   was fed straight in as -1/0/+1, so every tap was an instantaneous full lock
   and the tyres saturated on the first frame of every press — measured slip
   spiked to 3.5 the moment you touched a key, which is a slide, not a turn.

   Three different rates, because they are three different intentions:
     attack  — pressing a direction. Quick, but not instant.
     release — letting go. Faster, so the kart settles the moment you stop
               asking, which is most of what makes a car feel obedient.
     flip    — reversing direction. Fastest of all: a counter-steer has to bite
               NOW or catching a slide is impossible. */
/* Raised after playtest: 7.5 read as "it responds late" and 13 as "it keeps
   going after I let go". Release stays well above attack — a car feels obedient
   when it stops asking faster than it starts. */
const STEER_ATTACK = 11.5, STEER_RELEASE = 19, STEER_FLIP = 26;
let steerNow = 0;
export const resetSteer = () => { steerNow = 0; };

function readInput(dt) {
  S.input.throttle = keys.has('w') || keys.has('arrowup');
  S.input.brake = keys.has('s') || keys.has('arrowdown');
  S.input.hand = keys.has(' ');
  S.input.boost = keys.has('shift');
  const want = (keys.has('d') || keys.has('arrowright') ? 1 : 0)
             - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const rate = want === 0 ? STEER_RELEASE
    : (steerNow !== 0 && Math.sign(want) !== Math.sign(steerNow)) ? STEER_FLIP
    : STEER_ATTACK;
  steerNow += (want - steerNow) * Math.min(1, (dt || 1 / 60) * rate);
  if (Math.abs(steerNow) < 0.004) steerNow = 0;
  S.input.steer = steerNow;
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
let flashT = 0, lastPumpShown = 0, countdown = 0, lastCount = 9;
let snap = { bale: 0, wall: 0, spin: 0, land: 0 }, wasBoosting = false;

/* Rebuilt only when the order actually changes. Writing five rows of innerHTML
   at 60 Hz is both wasteful and visibly janky when a name is mid-ellipsis. */
let lastOrderKey = '';

function updateHUD(dt) {
  const kph = units === 'kmh';
  el('mph').textContent = Math.round(S.v * (kph ? 3.6 : 2.2369));
  el('mphU').textContent = kph ? 'KM/H' : 'MPH';
  el('sfill').style.width =
    Math.max(0, Math.min(100, (S.v / 34) * 100)) + '%';
  /* placeAt, not NAMES[segAt]: a fork branch is a place with its own name and
     does not correspond to a spine segment. Without this the HUD announced
     STEEP DROP while you were driving THE DROP. */
  el('seg').textContent = T.placeAt(S.s);

  /* Grip: how much of what the tyres can supply the corner is already using.
     Past the mark they have let go and you are sliding. */
  const slip = S.air ? 0 : S.slip;
  el('loadfill').style.width = Math.min(100, slip * 62) + '%';
  el('loadfill').style.background = S.spun > 0 ? 'var(--red)'
    : slip > 1 ? 'var(--red)' : slip > 0.8 ? 'var(--warm)' : 'var(--cold)';
  /* Flywheel. Shown in seconds because that is what you spend. */
  const ch = S.charge / SIM.tune.boostMax;
  el('chgfill').style.width = (ch * 100) + '%';
  el('chgnum').textContent = S.charge.toFixed(1) + 's';
  el('chg').classList.toggle('spent', S.input.boost && S.charge > 0);
  el('chg').classList.toggle('ready', S.charge > 0.25);

  const want = S.spun > 0 ? 'spun — you lost it'
    : S.air ? 'airborne'
    : slip > 1 ? 'sliding' : slip > 0.8 ? 'on the limit' : 'gripping';
  el('cue').textContent = want;
  el('cue').classList.toggle('on', slip > 0.8);

  /* Standings. The single most important number on screen now — it is the
     reason any of the rest of it matters. */
  const pos = RACE.positionOf(field, S);
  el('pos').textContent = pos;
  el('posOf').textContent = '/ ' + field.carts.length;
  const gap = RACE.gapAhead(field, S);
  el('gap').textContent = gap
    ? `+${gap.seconds.toFixed(1)}s  ${gap.name}`
    : 'leading';
  el('gap').classList.toggle('lead', !gap);
  el('draft').classList.toggle('on', !!S.drafting || Math.abs(S.drift) > SIM.tune.driftMin);
  el('draft').textContent = Math.abs(S.drift) > SIM.tune.driftMin ? 'drifting' : 'tow';

  /* The running order. "1 / 5" tells you where you are; it does not tell you
     WHO is ahead or by how much, which is the thing that makes you push. */
  const ord = RACE.order(field);
  const key = ord.map((c) => c.name || 'YOU').join('|') + '/' + ord.length;
  if (key !== lastOrderKey) {
    lastOrderKey = key;
    el('orderList').innerHTML = ord.map((c, i) => {
      const me = c === S || c.isPlayer || !c.name;
      const col = c.color != null
        ? '#' + c.color.toString(16).padStart(6, '0') : '#c2452e';
      return `<div class="ln${me ? ' me' : ''}"><span class="i">${i + 1}</span>`
           + `<span class="pip" style="background:${col}"></span>`
           + `<span class="nm">${me ? 'YOU' : c.name}</span>`
           + `<span class="dt" data-i="${i}"></span></div>`;
    }).join('');
  }
  /* Deltas every frame, text only — cheap, and no layout thrash. */
  const meI = ord.indexOf(S);
  const rows = el('orderList').children;
  for (let i = 0; i < rows.length && i < ord.length; i++) {
    const dt2 = rows[i].querySelector('.dt');
    if (!dt2) continue;
    if (i === meI || meI < 0) { dt2.textContent = ''; continue; }
    /* Magnitude only. The row's position already says whether they are ahead
       of you or behind, and a signed number next to a name reads ambiguously —
       "+1.3" is just as easily "1.3 ahead" as "1.3 behind". */
    const d = Math.abs(ord[i].s - ord[meI].s) / Math.max(6, S.v);
    dt2.textContent = d.toFixed(1) + 's';
  }

  const i = Math.min(PROF.length - 1, Math.floor((S.s / T.LENGTH) * (PROF.length - 1)));
  el('profdone').setAttribute('points', PROF.slice(0, i + 1).map((p) => p.join(',')).join(' '));
  el('profdot').setAttribute('cx', PROF[i][0]);
  el('profdot').setAttribute('cy', PROF[i][1]);

  if (S.cleanLandings > lastPumpShown) {
    lastPumpShown = S.cleanLandings;
    el('flashn').textContent = 'CLEAN';
    flashT = 0.6;
  }
  if (flashT > 0) {
    flashT -= dt;
    el('flash').style.opacity = Math.max(0, Math.min(1, flashT / 0.35));
    el('flash').style.transform = `translateX(-50%) translateY(${-(0.55 - flashT) * 26}px)`;
  } else el('flash').style.opacity = 0;
}

function finish() {
  const place = S.place || RACE.positionOf(field, S);
  const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
  el('dplace').textContent = ORD[place] || place + 'th';
  el('dplace').classList.toggle('win', place === 1);
  el('dgrid').textContent = `from ${ORD[S.grid] || S.grid} on the grid`;
  el('dtime').textContent = S.t.toFixed(2);
  el('dtop').textContent = Math.round(S.vMax * 2.2369);
  el('dair').textContent = S.airTotal.toFixed(1);
  el('dthrust').textContent = S.driftTime.toFixed(1) + 's';
  el('dcourse').textContent = T.TITLE;
  const b = bestFor(T.ID);
  if (b === null || S.t < b) {
    localStorage.setItem(bestKey(T.ID), String(S.t));
    el('dbest').textContent = 'a new best';
  } else {
    el('dbest').textContent = `best ${b.toFixed(2)}s`;
  }
  /* Degrade the mountain. This is the moment the hook actually happens: the
     line you just drove is worse than it was, and may be gone. */
  const forks = T.forksOf(T.ID);
  if (seasonCourse && forks.length) {
    const r = SEASON.recordRun(forks, { ...T.ROUTE }, rivalRoutes, place, pickedLoad);
    lastClosed = r ? r.closed : [];
    const st = SEASON.state();
    el('dseason').textContent = st.done
      ? (SEASON.impassable(forks) ? 'the road is finished — and so is the season'
                                  : `season over — ${st.points} points`)
      : `run ${st.run} of ${SEASON.RUNS} — ${st.points} points`;
    el('dclosed').innerHTML = lastClosed.length
      ? lastClosed.map((c) => `${c.branch.name} has gone`
          + `${c.by === 'you' ? ', under your load' : ''}.`).join('<br>')
      : '';
    el('again').textContent = st.done ? 'a new season' : 'the road down';
  } else {
    el('dseason').textContent = '';
    el('dclosed').textContent = '';
  }

  AUDIO.sfx.place();
  show('done');
}

/* --------------------------------- the loop -------------------------------- */
/* Fixed 120 Hz physics with an accumulator, so sim() and the game agree, and so
   a slow frame changes how much is simulated rather than what happens. */
const HZ = 1 / 120;
let acc = 0, last = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  try { frameBody(now); } catch (err) {
    /* A throw inside the loop used to kill rAF outright and the game simply
       stopped — which is how a missing HUD element on the finish screen
       presented as "the game freezes when completing a track". Keep the loop
       alive and make the cause loud rather than terminal. */
    console.error('FREEWHEEL frame error:', err);
  }
}

function frameBody(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;         // a backgrounded tab must not teleport

  if (mode === 'play') {
    if (countdown > 0) {
      /* Held on the grid. Physics is frozen rather than merely input-locked, so
         nobody rolls away down a 10% slope while the lights are still on. */
      countdown -= dt;
      const n = countdown > 0.35 ? Math.ceil(countdown - 0.2) : 0;
      if (n !== lastCount) {
        lastCount = n;
        n > 0 ? AUDIO.sfx.count() : AUDIO.sfx.go();
        R.setStartLights(n > 0);
      }
      el('count').textContent = n > 0 ? String(n) : 'GO';
      el('count').classList.toggle('go', n === 0);
      acc = 0;
    } else {
      el('count').textContent = '';
      acc += dt;
      readInput(dt);
      let guard = 0;
      while (acc >= HZ && guard++ < 60) { RACE.step(field, HZ, S.input); acc -= HZ; }
    }
    updateHUD(dt);

    /* One-shots fire off counters the physics already keeps, so a sound can
       never disagree with what happened. */
    if (S.baleHits > snap.bale) { snap.bale = S.baleHits; AUDIO.sfx.bale(); }
    if (S.wallHits > snap.wall) { snap.wall = S.wallHits; AUDIO.sfx.wall(); }
    if (S.spins > snap.spin) { snap.spin = S.spins; AUDIO.sfx.spin(); }
    if (S.cleanLandings > snap.land) { snap.land = S.cleanLandings; AUDIO.sfx.land(); }
    const boosting = S.input.boost && S.charge > 0.02;
    if (boosting && !wasBoosting) AUDIO.sfx.boost();
    wasBoosting = boosting;

    const Z = THEME.get(T.THEME).zones[T.zoneAt(S.s)];
    let nearest = 999;
    for (const c of field.carts) {
      if (c === S || c.done) continue;
      nearest = Math.min(nearest, Math.abs(c.s - S.s));
    }
    AUDIO.update(S, { playing: true, crowd: Z ? Z.blds : 0, nearest });

    if (S.done) finish();
  } else {
    acc = 0;
    AUDIO.update(S, { playing: false });
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
  tune: SIM.tune, opts: R.opts, T, SIM, R, THEME, RACE,
  get field() { return field; },
  race: (o) => { const r = RACE.sim(o); console.table(r.finishers);
                 if (r.stuck.length) console.warn('STUCK', r.stuck);
                 console.log('spread', r.spread + 's', 'lead changes', r.leadChanges);
                 return r; },
  simAll: (o) => { const r = SIM.simAll(o); console.table(r); return r; },
  course: (id) => { startRun(id); return T.TITLE; },
  sim: (o) => { const r = SIM.sim(o); console.table(r); return r; },
  step: (n = 1) => { for (let i = 0; i < n; i++) SIM.step(S, HZ); return S; },
  play: startRun,
  seek: (s) => { S.s = Math.max(0, Math.min(T.LENGTH - 1, s)); return S; },
};
console.log('%cFREEWHEEL', 'font:600 14px system-ui',
  '— FW.sim() compares policies, FW.tune retunes live, FW.seek(m) jumps.');
