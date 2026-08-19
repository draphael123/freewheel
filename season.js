/* ============================================================================
   FREEWHEEL — the season.

   The hook lives here. The premise is that you are hauling on the last working
   season of a mountain road, and the road is failing because of what you are
   doing to it: every run you take wears the line you drove, and a worn line
   eventually closes for good.

   What that buys, and why it is worth a module of its own:

   - It inverts the thing every other racer is about. Mastery in a racing game
     means finding the perfect line and repeating it. Here the perfect line can
     only be driven a few times, and learning the mountain and consuming the
     mountain are the same act.
   - It makes replaying one course the POINT rather than the fallback, because
     run 6 is on a mountain wrecked by runs 1 to 5.
   - It writes its own ending. When there is no open route through a fork, the
     season is over, and the last descent is on whatever bad road is left.

   Rivals wear the road too. The mountain is being consumed by the whole field,
   not just by you, which is what stops it feeling like a punishment meted out
   for playing.

   State is one small object in localStorage. It is deliberately NOT part of the
   render or physics state: a season is a thing that happens between runs.
   ========================================================================== */

const KEY = 'fw.season.v1';

/* Condition runs 1 (new) to 0 (closed). A branch that is merely worn is still
   drivable and worse — narrower and greasier — which matters more than the
   closure does, because you feel it every metre rather than once on a menu. */
/* Swept over 200 simulated seasons rather than guessed. At the first values
   (0.34 / 0.055) greedy play killed the mountain in FOUR runs and the season
   ended at run 5, which is not an arc, it is a punishment. These are the pair
   where the road lasts almost exactly the eight runs: you are always forced off
   your favourite line at some point, and about half of seasons end with the
   last road giving out right at the end rather than with a tidy finish. */
export const WEAR_YOU = 0.24;      // per run, on the branch you drove
export const WEAR_RIVAL = 0.012;   // per run, per rival that took it
export const CLOSED_AT = 0.001;

export const RUNS = 8;             // a season

let st = null;

function fresh(courseId, forks) {
  const cond = {};
  for (const f of forks) {
    cond[f.id] = {};
    for (const b of f.branches) cond[f.id][b.id] = 1;
  }
  return { courseId, run: 1, cond, log: [], points: 0, done: false };
}

export function state() { return st; }

export function begin(courseId, forks) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && raw.courseId === courseId && raw.cond) {
      /* Tolerate a course whose forks have been re-authored since the save:
         anything missing is simply new road. */
      for (const f of forks) {
        raw.cond[f.id] = raw.cond[f.id] || {};
        for (const b of f.branches) {
          if (typeof raw.cond[f.id][b.id] !== 'number') raw.cond[f.id][b.id] = 1;
        }
      }
      st = raw;
      return st;
    }
  } catch { /* a corrupt blob is not worth a crash */ }
  st = fresh(courseId, forks);
  save();
  return st;
}

export function reset(courseId, forks) {
  st = fresh(courseId, forks);
  save();
  return st;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* full disk */ }
}

export const conditionOf = (forkId, branchId) =>
  (st && st.cond[forkId] && st.cond[forkId][branchId] != null)
    ? st.cond[forkId][branchId] : 1;

export const isOpen = (forkId, branchId) => conditionOf(forkId, branchId) > CLOSED_AT;

export const openBranches = (fork) =>
  fork.branches.filter((b) => isOpen(fork.id, b.id));

/* A fork with nothing open ends the season: there is no way down past it. */
export const impassable = (forks) =>
  forks.some((f) => openBranches(f).length === 0);

/* A route the season will actually allow. Anything closed falls back to the
   best remaining road rather than refusing to start. */
export function legalRoute(forks, want) {
  const r = {};
  for (const f of forks) {
    const open = openBranches(f);
    const pick = open.find((b) => b.id === (want || {})[f.id]);
    r[f.id] = pick ? pick.id
      : open.length ? open.slice().sort(
          (a, b) => conditionOf(f.id, b.id) - conditionOf(f.id, a.id))[0].id
      : f.branches[0].id;
  }
  return r;
}

/* Called once a run is finished. `route` is what you drove; `rivalRoutes` is
   what the rest of the field drove. Degrades, then advances the season. */
export function recordRun(forks, route, rivalRoutes, place, load) {
  if (!st) return null;
  /* The load is what breaks the road. An overload wears it nearly twice as
     fast, which is the trade the whole season is built on: the pay is now and
     the cost is a road you will want later. */
  const wearMul = (load && load.wear) || 1;
  const closed = [];
  for (const f of forks) {
    const mine = route[f.id];
    if (mine && st.cond[f.id][mine] != null) {
      const before = st.cond[f.id][mine];
      st.cond[f.id][mine] = Math.max(0, before - WEAR_YOU * wearMul);
      if (before > CLOSED_AT && st.cond[f.id][mine] <= CLOSED_AT) {
        closed.push({ fork: f, branch: f.branches.find((b) => b.id === mine), by: 'you' });
      }
    }
    for (const rr of rivalRoutes || []) {
      const bid = rr[f.id];
      if (!bid || st.cond[f.id][bid] == null) continue;
      const before = st.cond[f.id][bid];
      st.cond[f.id][bid] = Math.max(0, before - WEAR_RIVAL);
      if (before > CLOSED_AT && st.cond[f.id][bid] <= CLOSED_AT) {
        closed.push({ fork: f, branch: f.branches.find((b) => b.id === bid), by: 'field' });
      }
    }
  }
  /* Championship points, so a season is a standing and not just a diary. */
  const PTS = [0, 10, 7, 5, 3, 2, 1];
  const scored = Math.round((PTS[place] || 0) * ((load && load.pay) || 1));
  st.points += scored;
  st.log.push({ run: st.run, place, scored, route: { ...route },
                load: load ? load.id : 'std' });
  st.run += 1;
  st.done = st.run > RUNS || impassable(forks);
  save();
  return { closed, done: st.done };
}

/* How the road reads on the route board. Condition is a continuum but people
   read words faster than bars, so it gets both. */
export function conditionWord(c) {
  if (c <= CLOSED_AT) return 'closed';
  if (c < 0.30) return 'failing';
  if (c < 0.60) return 'worn';
  if (c < 0.90) return 'used';
  return 'sound';
}

/* Wear does not only close a road, it makes it worse to drive first — and this
   is the half the player actually feels. Grip falls away and the usable width
   narrows as the surface breaks up. Applied by track.load() via the route. */
export function wearEffect(c) {
  const t = Math.max(0, Math.min(1, c));
  return { grip: 0.72 + 0.28 * t, width: 0.78 + 0.22 * t };
}
