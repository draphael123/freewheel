/* ============================================================================
   FREEWHEEL — cart physics.

   The cart has no engine. Everything it does is a trade against stored height
   and whatever the flywheel has banked.

   TUCK IS AERO, NOT A PUMP. The original design had you pumping the terrain
   for speed, the way a skater pumps a bowl. It was measured working and it was
   still cut, because it failed two playtests in a row — first as boring, then
   as simply not understood. Road curvature is an order of magnitude gentler
   than a skate bowl, so it only ever paid at an 18x fudge factor, and the
   moment you have to prop a mechanic up that hard AND nobody can read it, it
   is not a hook. What replaces it is a trade every player gets in one corner:
   tucked is fast and cannot steer.

   The model is a rail with lateral freedom: state is (s along the centreline,
   u across it, v along it). That is not a shortcut we are apologising for —
   arcade racers have been built this way for thirty years, it makes the blob
   shadow trivially correct because the surface under the cart is always a
   direct query, and it means this build can be wrong about tyre models
   without being wrong about the thing we are actually testing.
   ========================================================================== */

import * as T from './track.js';

/* Live-tunable. Everything a feel test wants to argue about is here, and it is
   reachable from the console as FW.tune so an opinion can be checked in ten
   seconds rather than a rebuild. */
export const tune = {
  G: 9.81,
  dragTuck: 0.0030,       // a = k v^2, tucked. ~40 mph on the average grade
  dragOpen: 0.0052,       // standing up costs you about 10 mph of top end
  roll: 0.09,             /* rolling resistance, CONSTANT m/s^2 (Crr ~ 0.009).
                             Modelling this proportional to v instead cost more
                             energy over 1300 m than the whole hill contains,
                             and every policy died on a climb looking exactly
                             like a course-design problem. */
  brake: 6.0,             // m/s^2 while the drag brake is down
  baleLoss: 0.24,         // fraction of speed lost hitting a bale
  baleShove: 2.6,         // m/s of lateral shove away from it
  wallBite: 0.42,         // speed lost per m/s of lateral speed INTO the barrier
  wallScrub: 4.0,         // m/s^2 lost while scraping along it

  crouchRate: 4.6,        // how fast the rider moves between tuck and stand, /s
  tuckSteer: 0.22,        /* steering authority while fully tucked. THE trade:
                             low drag costs you the ability to turn, so the
                             decision is where the straights end. */
  landAbsorb: 0.55,       // speed lost per m/s of impact perpendicular to road
  landAbsorbTucked: 0.28, // ...if you were crouched when you touched down
  steerRate: 6.6,         // m/s of lateral movement at full lock
  slide: 0.24,            /* how hard a corner throws you toward the outside.
                             Was 0.010, which is 40x too weak to matter: a
                             hairpin at 55 mph pushed the cart 0.13 m/s wide
                             against 5.4 m/s of steering authority, so corners
                             were free, the tuck trade never bit, and the road
                             may as well have been straight. This one number is
                             most of why the track felt like nothing happened.
                             Swept with steerRate and wallScrub: at 0.30 a
                             beginner finished 14 s adrift, at 0.20 a good
                             driver could no longer win. 0.24 leaves a beginner
                             5 s off the lead — a gap you can see closing. */
  /* The flywheel winds off the wheels as you run, faster when you brake,
     faster still in someone's tow, and in a lump for a clean landing. Four
     sources, every one of them something a player can see themselves do. */
  chargeRegen: 0.055,     /* seconds of charge per second at speed. At 0.075
                             the throttle swamped everything: all three courses
                             collapsed to the same ~57 s and the venue identities
                             went with them. Slow enough to stay a decision. */
  chargeRegenV: 18,       // ...reaching full rate at this speed
  brakeRegen: 0.26,       // braking puts speed back into the wheel

  /* Charge is measured in SECONDS of thrust remaining, because that is the
     only unit a player can reason about while driving. */
  thrust: 4.2,            // m/s^2 while spending
  chargeMax: 2.2,         // seconds of thrust the wheel can hold
  landCharge: 0.85,       /* seconds banked for a perfect landing. Visible cause,
                             visible effect, once every few seconds — everything
                             the pump was not. */
  landCleanAt: 8.0,       // impact at which a landing is worth nothing
  landMinAir: 0.25,       /* ...and only after a real jump. Without this the
                             cart farmed the bonus off micro-bounces: 110
                             'clean landings' a run, 60 s of free boost. */

  startSpeed: 2.0,
};

export function create() {
  return {
    s: 0, u: 0, v: tune.startSpeed,
    c: 1,                   // crouch state. 0 = fully tucked, 1 = fully upright
    air: false, yAir: 0, vyAir: 0,
    t: 0, done: false,
    charge: 0,              // seconds of thrust in the flywheel
    N: 1,                   // load in g, for the airborne test and the HUD
    brakeTotal: 0, airTotal: 0, airT: 0, cleanLandings: 0, landQuality: 0,
    vMax: 0, lastLanding: 0, thrustTotal: 0,
    onWall: false, wallHits: 0, lastWallBite: 0, slip: 0, baleHits: 0, lastBaleS: -99,
    mod: { drag: 1 }, drafting: false, scraping: false,
    input: { tuck: false, steer: 0, brake: false, thrust: false },
  };
}

/* One fixed physics step. dt is clamped by the caller; nothing here is
   frame-rate dependent, and nothing here reads a wall clock, so sim() and the
   live game run the identical code path. */
export function step(S, dt) {
  if (S.done) return S;
  const K = tune;
  S.t += dt;

  const pitch = T.pitchAt(S.s), kv = T.kvAt(S.s), kh = T.khAt(S.s);

  /* ---- rider posture. 0 = fully tucked, 1 = upright. ---------------------- */
  const target = S.input.tuck ? 0 : 1;
  const move = K.crouchRate * dt;
  S.c += Math.max(-move, Math.min(move, target - S.c));

  if (S.air) {
    /* ---- ballistic ------------------------------------------------------ */
    const vh = S.v * Math.cos(pitch);
    S.vyAir -= K.G * dt;
    S.yAir += S.vyAir * dt;
    S.s += vh * dt;
    S.u += S.input.steer * K.steerRate * 0.35 * dt;  // a little air steering
    S.airTotal += dt;
    S.airT += dt;

    const ground = T.surfaceAt(S.s, S.u).y;
    if (S.yAir <= ground) {
      /* Landing keeps only the component along the road. Meet the slope and
         you keep everything; land flat off a big drop and the perpendicular
         component is simply gone. That asymmetry is the lesson. */
      const p = T.pitchAt(S.s);
      const along = vh * Math.cos(p) + S.vyAir * Math.sin(p);
      const perp = -vh * Math.sin(p) + S.vyAir * Math.cos(p);
      const absorb = K.landAbsorbTucked + (K.landAbsorb - K.landAbsorbTucked) * S.c;
      S.v = Math.max(0, along - absorb * Math.abs(Math.min(0, perp)));
      S.lastLanding = Math.abs(perp);
      /* Meet the slope and you are paid for it. This is the replacement skill:
         you can SEE the ramp coming, you can see whether you matched it, and
         the reward arrives immediately. */
      /* GRADED, not binary. A pass/fail window caught nothing: real drops land
         hard enough to fail it and micro-hops are too short to qualify, so the
         reward fired zero times in a whole run. Scale it instead — meet the
         slope perfectly and take the lot, slam it and take nothing. */
      S.landQuality = S.airT > K.landMinAir
        ? Math.max(0, 1 - S.lastLanding / K.landCleanAt) : 0;
      if (S.landQuality > 0) {
        S.charge = Math.min(K.chargeMax, S.charge + K.landCharge * S.landQuality);
        if (S.landQuality > 0.5) S.cleanLandings++;
      }
      S.air = false;
      S.N = 1;
    }
  } else {
    /* ---- load, used only to decide whether the wheels have left the road. -- */
    S.N = Math.cos(pitch) + (S.v * S.v * kv) / K.G;

    if (S.N < 0) {                                 // the road fell away faster
      S.air = true;                                // than gravity could hold us
      S.yAir = T.surfaceAt(S.s, S.u).y;
      S.vyAir = S.v * Math.sin(pitch);
      S.airT = 0;
    } else {
      let a = -K.G * Math.sin(pitch);              // gravity along the road

      /* Spending. Deliberately available on climbs and flats, where gravity
         gives you nothing. Consumed PROPORTIONALLY to what is in the wheel:
         `charge > 0` plus a flat `a += thrust` is a quantisation hole where a
         sliver of charge buys a whole frame of full thrust. */
      if (S.input.thrust && S.charge > 0.02) {
        const use = Math.min(dt, S.charge);
        a += K.thrust * (use / dt);
        S.charge -= use;
        S.thrustTotal += K.thrust * use;
      }

      /* mod.drag is how a tow arrives: the race layer sets it below 1 while
         you sit in someone's wake. Kept as a per-cart multiplier rather than a
         special case in here, so sim.step stays one cart's physics and nothing
         else. */
      const drag = (K.dragTuck + (K.dragOpen - K.dragTuck) * S.c)
                 * (S.mod?.drag ?? 1);
      a -= drag * S.v * S.v;
      a -= K.roll;

      /* Brakes are a tyre force too, so ice takes them away as surely as it
         takes away the corners. Braking also winds the wheel, which gives the
         brake a second reason to exist: shed speed you cannot use into a corner
         and get some of it back on the climb after it. */
      if (S.input.brake) {
        const b = K.brake * T.gripAt(S.s);
        a -= b; S.brakeTotal += b * dt;
        S.charge = Math.min(K.chargeMax, S.charge + K.brakeRegen * dt);
      }
      S.charge = Math.min(K.chargeMax,
        S.charge + K.chargeRegen * Math.min(1, S.v / K.chargeRegenV) * dt);

      S.v = Math.max(0, S.v + a * dt);
      S.s += S.v * dt;
    }
  }

  /* ---- lateral ---------------------------------------------------------- */
  /* Grip scales what the tyres can do in both directions at once: it resists
     the outward slide and it is also how much of your steering input arrives.
     Banking relieves the slide directly, because part of the cornering force
     is now being supplied by the road being tilted rather than by friction. */
  const uPrev = S.u;
  if (!S.air) {
    const grip = T.gripAt(S.s);
    const lat = S.v * S.v * kh - K.G * Math.sin(T.bankAt(S.s));
    const drift = lat * K.slide / grip;
    /* Tucked, you keep only tuckSteer of your steering. This one multiplier is
       the entire mechanic: fast in a line, helpless in a corner. */
    const auth = K.tuckSteer + (1 - K.tuckSteer) * S.c;
    const steerMax = K.steerRate * grip * auth * Math.min(1, S.v / 7);
    /* How much of your grip the corner is already using. Past 1 you are going
       wide whatever you do — this is the number the HUD shows, because it is
       the one that tells you to come out of the tuck. */
    S.slip = Math.abs(drift) / Math.max(0.01, steerMax);
    S.u += (S.input.steer * steerMax + drift) * dt;
  }

  /* A barrier at the verge, not a soft penalty. Previously the cart could sit
     three metres past the edge with a little extra rolling drag — hovering over
     an embankment, on nothing, at no real cost. Hay bales line a closed road,
     so: you cannot leave, and touching costs you. A bite proportional to how
     hard you arrived, then a continuous scrub while you lean on it. */
  /* Bales. Soft, so they cost you speed and a shove rather than ending the run
     — the punishment for a bad line should be a place lost, not a restart. */
  if (!S.air && S.s - S.lastBaleS > 8) {
    for (const h of T.hazardsNear(S.s, 2.6)) {
      if (Math.abs(h.u - S.u) < T.HAZARD_R + 0.9) {
        /* ONE hit per impact. Testing the overlap every frame charged the
           player once per tick for as long as they were inside the bale —
           26 to 55 "hits" per run, and a course nobody could finish quickly. */
        S.v = Math.max(0, S.v * (1 - K.baleLoss));
        S.u += Math.sign(S.u - h.u || 1) * K.baleShove;
        S.baleHits++;
        S.lastBaleS = S.s;
        break;
      }
    }
  }

  const wall = T.halfWAt(S.s);
  const wasOn = S.onWall;
  S.onWall = Math.abs(S.u) > wall;
  if (S.onWall) {
    const into = Math.abs(S.u - uPrev) / dt;
    S.u = Math.sign(S.u) * wall;
    if (!wasOn) {
      const bite = K.wallBite * Math.min(into, 12);
      S.v = Math.max(0, S.v - bite);
      S.wallHits++; S.lastWallBite = bite;
    }
    if (!S.air) S.v = Math.max(0, S.v - K.wallScrub * dt);
  }

  if (S.v > S.vMax) S.vMax = S.v;
  if (S.s >= T.LENGTH) { S.s = T.LENGTH; S.done = true; }
  return S;
}

/* --------------------------------------------------------------------------
   Headless policies. `naive` matters most: it is a deliberately mediocre
   driver, and the field has to be beatable by it. Balancing against a good
   policy is how the rivals ended up faster than any human could be.
   -------------------------------------------------------------------------- */
const hold = (S) => Math.max(-1, Math.min(1, -S.u * 0.42));

export const POLICIES = {
  /* Never tucks. The drag baseline. */
  coast: (S) => ({ tuck: false, steer: hold(S), brake: false, thrust: false }),

  /* Always tucked, never lifts. Should be quick in a line and terrible in the
     corners — if it is not, the steering penalty is not doing its job. */
  tucked: (S) => ({ tuck: true, steer: hold(S), brake: false, thrust: true }),

  /* A beginner: holds tuck, steers roughly, spends boost whenever it has any.
     THE reference for whether the field is beatable. */
  naive: (S) => ({
    tuck: true, steer: hold(S) * 0.7, brake: false, thrust: S.charge > 0.4,
  }),

  /* Playing properly: lift out of the tuck for corners, brake when the corner
     genuinely cannot be held, spend boost where gravity gives nothing. */
  racer: (S) => {
    const lead = Math.min(T.LENGTH - 1, S.s + Math.max(10, S.v * 0.9));
    const kh = Math.abs(T.khAt(lead));
    const need = S.v * S.v * kh;
    const grip = T.gripAt(S.s);
    return {
      tuck: need < grip * 9.0,
      steer: hold(S),
      brake: need > grip * 20.0,
      thrust: S.charge > 0.3 && T.pitchAt(S.s) > -0.18,
    };
  },
};

/* Run one policy to the bottom. Returns a not-finished row rather than numbers
   if the cart never actually got down the hill, because a policy that stalls
   at 300 m and one that finishes are not comparable and averaging them lies. */
export function run(policyName, opts = {}) {
  const dt = opts.dt || 1 / 120;
  const pol = POLICIES[policyName];
  const S = create();
  let steps = 0;
  const maxSteps = Math.ceil((opts.maxTime || 300) / dt);
  const stall = { s: 0, t: 0 };

  while (!S.done && steps++ < maxSteps) {
    Object.assign(S.input, pol(S));
    step(S, dt);
    if (S.s - stall.s > 5) { stall.s = S.s; stall.t = S.t; }
    if (S.t - stall.t > 12) break;                 // rolled to a halt on a climb
  }
  if (!S.done) {
    return {
      policy: policyName, finished: false,
      stalledAt: +S.s.toFixed(1), segment: T.NAMES[T.segAt(S.s)],
      v: +S.v.toFixed(2),
    };
  }
  return {
    policy: policyName, finished: true,
    time: +S.t.toFixed(2),
    vMax: +S.vMax.toFixed(2),
    vMaxMph: +(S.vMax * 2.2369).toFixed(1),
    cleanLandings: S.cleanLandings,
    thrustUsed: +S.thrustTotal.toFixed(2),
    airTime: +S.airTotal.toFixed(2),
    wallHits: S.wallHits, baleHits: S.baleHits,
  };
}

export function sim(opts = {}) {
  const names = opts.policies || ['coast', 'naive', 'tucked', 'racer'];
  if (!opts.course) return names.map((n) => run(n, opts));
  const back = T.ID;
  T.load(opts.course);
  const rows = names.map((n) => ({ course: T.ID, ...run(n, opts) }));
  T.load(back);
  return rows;
}

/* Every venue, every policy. The question a variety claim actually has to
   answer is whether the courses ask DIFFERENT things, so this is the report
   that matters more than any single course's numbers. */
export function simAll(opts = {}) {
  return T.COURSE_IDS.flatMap((c) => sim({ ...opts, course: c }));
}
