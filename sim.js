/* ============================================================================
   FREEWHEEL — cart physics.

   IT HAS AN ENGINE. The original design was a gravity racer: no throttle, and
   speed came from reading the terrain. That premise was defended through three
   redesigns and rejected in four separate playtests — "I would like to steer
   and accelerate", "there is no way to accelerate", "I do not understand what
   tuck does", "auto accelerate does not make sense". Tuck is gone with it: both
   of its effects were invisible, so no amount of rebalancing was going to make
   it read.

   WHAT MAKES IT A RACE IS THE GRIP LIMIT. The tyres can only supply so much
   lateral force; ask for more and the cart slides instead of turning. That is
   the whole of the interest: a braking point is only a decision if arriving too
   fast costs you the corner, and a line is only a skill if you can lose it.
   Drifting charges the boost, so the risky thing is also the fast thing.

   The model is a rail with lateral freedom: state is (s along the centreline,
   u across it, v along it, vy sliding across it). Arcade racers have been built
   this way for thirty years; it makes the contact shadow a direct query, and it
   means this build can be wrong about tyre models without being wrong about the
   thing being tested.
   ========================================================================== */

import * as T from './track.js';

/* Live-tunable. Everything a feel test wants to argue about is here, and it is
   reachable from the console as FW.tune so an opinion can be checked in ten
   seconds rather than a rebuild. */
export const tune = {
  G: 9.81,

  /* Engine. Tapers with speed so the top end is a limit rather than a wall. */
  engine: 7.4,            // m/s^2 at a standstill
  engineV: 34,            // ...falling to nothing here
  brake: 11.0,            // m/s^2, scaled by grip
  drag: 0.0036,           // a = k v^2
  roll: 0.09,             // rolling resistance, constant m/s^2

  /* The friction circle. mu is how much lateral acceleration the tyres can
     supply before the cart stops turning and starts sliding. */
  mu: 1.05,
  steerForce: 10.5,       // lateral accel a full lock asks for
  slipDamp: 3.2,          // how hard the tyres fight a slide
  handbrakeGrip: 0.38,    // grip multiplier while the handbrake is down
  slipDrag: 0.55,         // speed scrubbed per m/s of sideways motion
  spinAt: 10.5,           /* sideways speed beyond which you have lost it. At 8
                             a driver who simply held the throttle spun through
                             every corner and finished 69 s down, which is a
                             punishment nobody learns anything from. */
  spinCost: 0.68,         // speed you keep after losing it
  spinTime: 1.0,          // seconds before the throttle answers again

  /* Boost, charged by drifting. The risky thing is the fast thing. */
  boost: 6.2,             // m/s^2 while spending
  boostMax: 2.4,          // seconds it can hold
  driftCharge: 0.62,      // seconds banked per second of a real slide
  driftMin: 2.2,          // ...sideways speed that counts as one

  baleLoss: 0.24,         // fraction of speed lost hitting a bale
  baleShove: 2.6,         // m/s of lateral shove away from it
  wallBite: 0.85,         // speed lost per m/s of lateral speed INTO the barrier
  wallScrub: 8.0,         // m/s^2 lost while scraping along it

  landAbsorb: 0.55,       // speed lost per m/s of impact perpendicular to road
  landCharge: 0.85,       // seconds banked for a perfect landing
  landCleanAt: 8.0,       // impact at which a landing is worth nothing
  landMinAir: 0.25,       // ...and only after a real jump

  uMargin: 0.0,
  startSpeed: 2.0,
};

export function create() {
  return {
    s: 0, u: 0, v: tune.startSpeed, vy: 0,
    c: 1,                   // rider posture, kept for the animation
    air: false, yAir: 0, vyAir: 0, airT: 0,
    t: 0, done: false,
    N: 1,                   // load in g, for the airborne test
    charge: 0,              // seconds of boost banked
    slip: 0,                // >1 means the tyres have let go
    drift: 0,               // signed sideways speed, for the HUD and the yaw
    spun: 0,                // seconds left of a spin
    brakeTotal: 0, airTotal: 0, cleanLandings: 0, landQuality: 0,
    boostTotal: 0, driftTime: 0, vMax: 0, lastLanding: 0,
    onWall: false, wallHits: 0, baleHits: 0, lastBaleS: -99, spins: 0,
    mod: { drag: 1 }, drafting: false, scraping: false,
    input: { throttle: false, brake: false, steer: 0, hand: false, boost: false },
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
  const grip = T.gripAt(S.s);
  const In = S.input;

  /* Rider posture, purely cosmetic now: they duck at speed. */
  S.c += ((S.v > 18 ? 0.25 : 1) - S.c) * Math.min(1, dt * 3);

  if (S.air) {
    const vh = S.v * Math.cos(pitch);
    S.vyAir -= K.G * dt;
    S.yAir += S.vyAir * dt;
    S.s += vh * dt;
    S.u += In.steer * 2.0 * dt;
    S.airTotal += dt; S.airT += dt;

    const ground = T.surfaceAt(S.s, S.u).y;
    if (S.yAir <= ground) {
      /* Landing keeps only the component along the road: meet the slope and you
         keep everything, land flat off a big drop and the perpendicular part is
         simply gone. Graded, not pass/fail — a binary window caught nothing,
         because real drops land hard and micro-hops are too short to qualify. */
      const p = T.pitchAt(S.s);
      const along = vh * Math.cos(p) + S.vyAir * Math.sin(p);
      const perp = -vh * Math.sin(p) + S.vyAir * Math.cos(p);
      S.v = Math.max(0, along - K.landAbsorb * Math.abs(Math.min(0, perp)));
      S.lastLanding = Math.abs(perp);
      S.landQuality = S.airT > K.landMinAir
        ? Math.max(0, 1 - S.lastLanding / K.landCleanAt) : 0;
      if (S.landQuality > 0) {
        S.charge = Math.min(K.boostMax, S.charge + K.landCharge * S.landQuality);
        if (S.landQuality > 0.5) S.cleanLandings++;
      }
      S.air = false; S.N = 1;
    }
  } else {
    S.N = Math.cos(pitch) + (S.v * S.v * kv) / K.G;
    if (S.N < 0) {
      S.air = true; S.airT = 0;
      S.yAir = T.surfaceAt(S.s, S.u).y;
      S.vyAir = S.v * Math.sin(pitch);
    } else {
      let a = -K.G * Math.sin(pitch);            // gravity along the road

      if (S.spun > 0) S.spun -= dt;              // no drive while spinning
      else if (In.throttle) a += K.engine * Math.max(0, 1 - S.v / K.engineV);

      if (In.brake) {
        const b = K.brake * grip;
        a -= b; S.brakeTotal += b * dt;
      }
      if (In.boost && S.charge > 0.02 && S.spun <= 0) {
        /* Spend PROPORTIONALLY: `charge > 0` plus a flat add is a quantisation
           hole where a sliver of charge buys a whole frame of full thrust. */
        const use = Math.min(dt, S.charge);
        a += K.boost * (use / dt);
        S.charge -= use;
        S.boostTotal += K.boost * use;
      }

      a -= (K.drag * (S.mod ? S.mod.drag : 1)) * S.v * S.v;
      a -= K.roll;
      a -= K.slipDrag * Math.abs(S.vy);          // sliding costs you speed

      S.v = Math.max(0, S.v + a * dt);
      S.s += S.v * dt;
    }
  }

  /* ---- the friction circle ---------------------------------------------- */
  /* `push` is the apparent outward acceleration of following a curving road,
     relieved by banking. The tyres must supply that just to hold the corner,
     BEFORE any steering. Ask for more than mu*g and they let go — that is the
     grip limit, and it is the only reason a braking point is a decision. */
  if (!S.air) {
    const push = S.v * S.v * kh - K.G * Math.sin(T.bankAt(S.s));
    const limit = K.mu * K.G * grip
                * (In.hand ? K.handbrakeGrip : 1)
                * (S.spun > 0 ? 0.25 : 1);
    const desired = In.steer * K.steerForce * Math.min(1, S.v / 6)
                  - S.vy * K.slipDamp - push;
    S.slip = Math.abs(desired) / limit;
    const aTyre = Math.max(-limit, Math.min(limit, desired));
    S.vy += (aTyre + push) * dt;
    S.u += S.vy * dt;
    S.drift = S.vy;

    if (Math.abs(S.vy) > K.driftMin && S.v > 8) {
      S.charge = Math.min(K.boostMax, S.charge + K.driftCharge * dt);
      S.driftTime += dt;
    }
    /* Overcook it and you have lost the car. Brief, and it costs you the
       corner rather than the run. */
    /* Overcooking it has to COST. With a cheap spin, a policy that never
       braked took nine barrier hits and two spins and still beat one that
       drove properly by three seconds — which makes the grip limit a
       decoration rather than a decision. */
    if (Math.abs(S.vy) > K.spinAt && S.spun <= 0) {
      S.spun = K.spinTime;
      S.v *= K.spinCost;
      S.vy *= 0.3;
      S.spins++;
    }
  }

  /* ---- bales ------------------------------------------------------------- */
  if (!S.air && S.s - S.lastBaleS > 8) {
    for (const h of T.hazardsNear(S.s, 2.6)) {
      if (Math.abs(h.u - S.u) < T.HAZARD_R + 0.9) {
        S.v = Math.max(0, S.v * (1 - K.baleLoss));
        S.vy += Math.sign(S.u - h.u || 1) * K.baleShove;
        S.baleHits++; S.lastBaleS = S.s;
        break;
      }
    }
  }

  /* ---- the barrier ------------------------------------------------------- */
  const wall = T.halfWAt(S.s);
  const wasOn = S.onWall;
  S.onWall = Math.abs(S.u) > wall;
  if (S.onWall) {
    const into = Math.abs(S.vy);
    S.u = Math.sign(S.u) * wall;
    if (!wasOn) { S.v = Math.max(0, S.v - K.wallBite * Math.min(into, 12)); S.wallHits++; }
    S.vy *= -0.15;                                // it does not bounce you back
    if (!S.air) S.v = Math.max(0, S.v - K.wallScrub * dt);
  }

  if (S.v > S.vMax) S.vMax = S.v;
  if (S.s >= T.LENGTH) { S.s = T.LENGTH; S.done = true; }
  return S;
}

/* --------------------------------------------------------------------------
   Headless policies. `naive` matters most: it is a deliberately mediocre
   driver, and the field has to be beatable by it. Balancing against a good
   policy is how the rivals once ended up faster than any human could be.
   -------------------------------------------------------------------------- */
const hold = (S) => Math.max(-1, Math.min(1, -S.u * 0.36 - S.vy * 0.16));

/* How much cornering the road is about to ask for, in units of what the tyres
   can supply. Above 1 the corner cannot be taken at this speed. */
function load(S, lead) {
  const s2 = Math.min(T.LENGTH - 1, S.s + lead);
  const need = Math.abs(S.v * S.v * T.khAt(s2) - tune.G * Math.sin(T.bankAt(s2)));
  return need / (tune.mu * tune.G * T.gripAt(S.s));
}

export const POLICIES = {
  /* No throttle at all. The gravity-only baseline. */
  coast: (S) => ({ throttle: false, brake: false, steer: hold(S), hand: false, boost: false }),

  /* Flat out, never brakes, spends boost the moment it has any. The floor. */
  naive: (S) => ({
    throttle: true, brake: false, steer: hold(S) * 0.8,
    hand: false, boost: S.charge > 0.4,
  }),

  /* Plays it properly: lifts and brakes for a corner it cannot hold, spends
     boost where the road is straight enough to use it. */
  /* Swept: lifting at 0.85 and braking at 1.05 is over-cautious and loses to
     a policy that never brakes at all. Lift only for corners that genuinely
     cannot be held, and the same driver gains three seconds in a hundred with
     no spins at all. */
  racer: (S) => {
    const soon = load(S, Math.max(14, S.v * 1.1));
    return {
      throttle: soon < 1.35,
      brake: soon > 1.60,
      steer: hold(S),
      hand: false,
      boost: S.charge > 0.35 && soon < 0.70,
    };
  },

  /* Same, but deliberately breaks traction in the corners to charge boost.
     If this does not beat `racer`, drifting is decoration. */
  drifter: (S) => {
    const soon = load(S, Math.max(14, S.v * 1.1));
    const now = load(S, 2);
    return {
      throttle: soon < 1.35,
      brake: soon > 1.70,
      steer: hold(S),
      hand: now > 0.85 && now < 1.7 && S.v > 12,
      boost: S.charge > 0.35 && soon < 0.70,
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
    cleanLandings: S.cleanLandings, spins: S.spins,
    driftS: +S.driftTime.toFixed(1),
    boostUsed: +S.boostTotal.toFixed(1),
    airTime: +S.airTotal.toFixed(2),
    wallHits: S.wallHits, baleHits: S.baleHits,
  };
}

export function sim(opts = {}) {
  const names = opts.policies || ['coast', 'naive', 'racer', 'drifter'];
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
