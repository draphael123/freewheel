/* ============================================================================
   FREEWHEEL — cart physics.

   The cart has no engine. Everything it does is a trade against stored height,
   plus whatever it can pump back out of the terrain.

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
  wallBite: 0.42,         // speed lost per m/s of lateral speed INTO the barrier
  wallScrub: 5.0,         // m/s^2 lost while scraping along it

  crouchRate: 3.6,        // how fast the rider moves between tuck and stand, /s
  crouchTravel: 0.45,     // how far the centre of mass moves, metres
  pumpGain: 18.0,         /* 1.0 is the honest physics, and at 1.0 the mechanic
                             is dead: pump gain gsn scales as v*kv while the drag
                             cost of standing scales as v*v, so on road-scale
                             curvature standing NEVER pays. Real pumping works
                             because a skate bowl has ~15x the curvature of a
                             road. This is the number that buys the fantasy.
                             Swept 5.5-16: below 7 pumping is worth under a
                             second over 96 s (noise), at 16 it is worth 7.6 s
                             and tucking stops mattering. Re-swept after the
                             course was steepened to a 20% average grade: higher
                             speeds raise the v^2 drag cost faster than the v
                             pump gain, so the same 9 stopped paying and 18 is
                             what the steeper hill needs. */
  pumpKvMin: 0.018,       /* Do not bother pumping gentler curvature than this.
                             Standing costs drag continuously while a pump pays
                             once, so under this threshold the hold eats the
                             gain. Swept: anywhere in 0.004-0.026 still wins,
                             which is the margin a human needs to be sloppy. */

  landAbsorb: 0.55,       // speed lost per m/s of impact perpendicular to road
  landAbsorbTucked: 0.28, // ...if you were crouched when you touched down
  steerRate: 5.4,         // m/s of lateral movement at full lock
  slide: 0.010,           // how hard a corner throws you toward the outside
  /* The flywheel also winds off the WHEELS, not only off the pump. Gating the
     one accelerate verb behind mastery of the one hard mechanic meant a player
     who simply held tuck completed a single stroke at the start and then never
     charged again — so W did nothing at all and the game read as having no
     throttle. Passive regen is deliberately slow: it guarantees the button
     always does something, while pumping remains far and away the fast way to
     fill it. */
  chargeRegen: 0.055,     /* seconds of charge per second at speed. At 0.075
                             the throttle swamped everything: all three courses
                             collapsed to the same ~57 s and the venue identities
                             went with them. Slow enough to stay a decision. */
  chargeRegenV: 18,       // ...reaching full rate at this speed
  brakeRegen: 0.26,       // braking puts speed back into the wheel

  /* The flywheel. Pumping spins it up, the throttle lets it back out — so
     there is a real accelerate button whose fuel is still the hill, which is
     the whole premise. Charge is measured in SECONDS of thrust remaining,
     because that is the only unit a player can actually reason about. */
  thrust: 4.2,            // m/s^2 while spending
  chargeMax: 2.2,         // seconds of thrust the wheel can hold
  chargePerPump: 0.35,    /* seconds banked per m/s of pump gain. At 0.9 a single
                             run banked 21 s of thrust off the pump alone, which
                             made the flywheel the entire economy and dropped
                             every course to the same ~57 s. The pump should
                             CONTRIBUTE to the wheel, not be it. */

  startSpeed: 2.0,
};

export function create() {
  return {
    s: 0, u: 0, v: tune.startSpeed,
    c: 1,                   // crouch state. 0 = fully tucked, 1 = fully upright
    air: false, yAir: 0, vyAir: 0,
    t: 0, done: false,
    charge: 0,              // seconds of thrust in the flywheel
    strokeGain: 0,          // pump banked so far in the current stroke
    lastEnd: 1,             // which end of the crouch travel we last reached
    N: 1,                   // load in g. the thing you are pumping against
    pumpRate: 0,            // dv/dt currently coming from the pump, for the HUD
    lastPump: 0,            // speed gained by the most recent extension
    pumpTotal: 0, brakeTotal: 0, airTotal: 0,
    vMax: 0, lastLanding: 0, thrustTotal: 0,
    onWall: false, wallHits: 0, lastWallBite: 0,
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

  /* ---- rider crouch. The pump is entirely in this one variable. ---------- */
  const cPrev = S.c;
  const target = S.input.tuck ? 0 : 1;
  const move = K.crouchRate * dt;
  S.c += Math.max(-move, Math.min(move, target - S.c));
  const cdot = (S.c - cPrev) / dt;                 // + = standing up = extending

  if (S.air) {
    /* ---- ballistic ------------------------------------------------------ */
    const vh = S.v * Math.cos(pitch);
    S.vyAir -= K.G * dt;
    S.yAir += S.vyAir * dt;
    S.s += vh * dt;
    S.u += S.input.steer * K.steerRate * 0.35 * dt;  // a little air steering
    S.airTotal += dt;

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
      S.air = false;
      S.N = 1;
    }
  } else {
    /* ---- load. Positive vertical curvature is the road bending up into you,
       which is a compression, which is the only time a pump is worth
       anything. This single sign is the whole mechanic. -------------------- */
    S.N = Math.cos(pitch) + (S.v * S.v * kv) / K.G;

    if (S.N < 0) {                                 // the road fell away faster
      S.air = true;                                // than gravity could hold us
      S.yAir = T.surfaceAt(S.s, S.u).y;
      S.vyAir = S.v * Math.sin(pitch);
      S.pumpRate = 0;
    } else {
      let a = -K.G * Math.sin(pitch);              // gravity along the road

      /* Only the load ABOVE static does any work for you. Raising the centre
         of mass by dh under load N spends N*m*g*dh but banks m*g*dh of real
         potential energy, so the kinetic gain is (N-1)*m*g*dh — and (N-1)*g
         is exactly the centripetal term v*v*kv. Dividing that by v to turn
         energy into speed cancels a v, which is why there is no small-v
         clamp here and why the whole mechanic collapses to one product.

         The sign works out to the real pump cycle for free: extend in a
         compression (kv>0, cdot>0) gains, and so does crouching over a crest
         (kv<0, cdot<0). Doing either backwards pays the same cost. */
      const pump = S.v * kv * K.crouchTravel * cdot * K.pumpGain;
      // Delta-v of one full extension = v * kv * crouchTravel * pumpGain.
      a += pump;
      S.pumpRate = pump;
      if (pump > 0) S.pumpTotal += pump * dt;

      /* The wheel is wound by COMPLETED STROKES, not per frame.

         Signed per-frame accrual looks correct and is not: charge is clamped at
         zero, and any alternating signal against a floor accumulates, because
         every negative excursion below zero is absorbed for free. Mashing the
         key exploited exactly that and won the ice course by twelve seconds.

         Crediting a stroke only when the rider actually reaches an end of the
         crouch travel closes it, because a fast mash never gets there — at 3 Hz
         the rider only ever oscillates around the middle. It also gives an
         honest event to hang the HUD flash on. */
      S.strokeGain += pump * dt;
      const end = S.c >= 0.985 ? 1 : (S.c <= 0.015 ? 0 : -1);
      if (end >= 0 && end !== S.lastEnd) {
        S.lastEnd = end;
        S.charge = Math.max(0, Math.min(K.chargeMax,
          S.charge + S.strokeGain * K.chargePerPump));
        S.lastPump = S.strokeGain;
        S.strokeGain = 0;
      }

      /* Spending. Deliberately available on climbs and flats, where gravity
         gives you nothing — that is where a throttle is worth having and where
         reading the hill turns into a decision rather than a reflex. */
      /* Spend PROPORTIONALLY to what is actually in the wheel this frame.
         `charge > 0` plus a flat `a += thrust` is a quantisation hole: a
         sliver of charge bought a whole frame of full thrust, so a trickle of
         regen worth 0.055 s/s delivered full acceleration essentially all the
         time. Measured, 3.4 s of banked charge was spent as 21.8 s of thrust. */
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
    S.u += (S.input.steer * K.steerRate * grip * Math.min(1, S.v / 7) + drift) * dt;
  }

  /* A barrier at the verge, not a soft penalty. Previously the cart could sit
     three metres past the edge with a little extra rolling drag — hovering over
     an embankment, on nothing, at no real cost. Hay bales line a closed road,
     so: you cannot leave, and touching costs you. A bite proportional to how
     hard you arrived, then a continuous scrub while you lean on it. */
  const wall = T.HALF_W;
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
   Headless policies. These exist so we can ask whether the pump has a skill
   gradient at all before asking a human to feel for one.
   -------------------------------------------------------------------------- */
/* Every policy steers for the centreline. Without this the headless rider
   never touches the wheel, and on a low-grip course it is simply thrown off
   the road — which reports as a physics result when it is really a harness
   that never drove. */
const hold = (S) => Math.max(-1, Math.min(1, -S.u * 0.42));

export const POLICIES = {
  /* Never stands up. The aero baseline: what you get for doing nothing. */
  tucked: (S) => ({ tuck: true, steer: hold(S), brake: false, thrust: false }),

  /* Never tucks. Should lose badly on drag — if it does not, the aero trade
     carries no weight and the tuck key is decoration. */
  open: (S) => ({ tuck: false, steer: hold(S), brake: false, thrust: false }),

  /* Mashing. If this beats tucked, the mechanic rewards noise, not timing. */
  mash: (S) => ({ tuck: (Math.floor(S.t * 6) % 2) === 0, steer: hold(S),
                  brake: false, thrust: (Math.floor(S.t * 5) % 2) === 0 }),

  /* Plays it properly. The rider oscillates IN PHASE WITH THE ROAD: stand
     through a compression, crouch over a crest, and tuck on anything flat
     because there is nothing to pump and drag is still charging you.

     An earlier version thresholded on total load N and held the stand for the
     whole loaded region. That looks reasonable and is badly wrong — it pays
     full standing drag for the entire compression while the pump only earns
     during the transition itself. It captured 5% of the available energy. */
  pump: (S) => {
    /* Curvature HERE, with no lookahead. Leading the compression is the
       intuitive move and it is exactly wrong: the pump is earned during the
       transition, so leading means you finish standing just as you arrive and
       every joule of that work went into the crest you were still crossing.
       Measured, a 6 m lead put the rider perfectly anti-phase and turned a
       +7 m/s mechanic into -7.5 m/s. Stand up THROUGH the compression. */
    const kv = T.kvAt(S.s);
    return {
      tuck: kv < tune.pumpKvMin, steer: hold(S), brake: false,
      /* Spend where gravity is not already paying: shallow or uphill road,
         and never while a compression is available to pump. */
      thrust: S.charge > 0 && kv < tune.pumpKvMin && T.pitchAt(S.s) > -0.14,
    };
  },

  /* The same rider with the flywheel disabled, so the throttle's contribution
     can be read off rather than assumed. */
  pumpNoThrust: (S) => ({
    tuck: T.kvAt(S.s) < tune.pumpKvMin, steer: hold(S), brake: false, thrust: false,
  }),
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
    pumpGain: +S.pumpTotal.toFixed(2),
    thrustUsed: +S.thrustTotal.toFixed(2),
    airTime: +S.airTotal.toFixed(2),
    wallHits: S.wallHits,
  };
}

export function sim(opts = {}) {
  const names = opts.policies || ['open', 'mash', 'tucked', 'pumpNoThrust', 'pump'];
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
