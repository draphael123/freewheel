/* ============================================================================
   FREEWHEEL — the field.

   Everything here exists to answer one complaint: a time trial against nothing
   is not a racing game, it is a mode inside one. Rivals turn the same hill into
   a race without a metre of new level geometry.

   Every cart — yours and theirs — runs the identical physics from sim.js. The
   AI differs only in what it presses, never in what it is allowed to do, which
   is the only version of this that stays honest when you start tuning it.
   ========================================================================== */

import * as T from './track.js';
import * as SIM from './sim.js';

/* Cart footprint on the (s, u) rail. Collision is cheap here because both carts
   are already parameterised the same way. */
const LEN = 3.4, WID = 2.0;

export const tune = {
  gridGap: 8.0,           /* metres between grid slots. At 4.2 the field started
                             on top of itself and never untangled: 40% of the
                             first hairpin was spent grinding, and every car
                             finished within 0.14 s of the others. */
  gridStagger: 3.0,       // lateral offset, alternating

  draftMin: 2.5,          // start of the tow
  draftMax: 15.0,         // ...and its end
  draftWidth: 3.2,        // how closely you must be lined up
  draftDrag: 0.52,        // drag multiplier in clean air behind someone
  draftCharge: 0.22,      // seconds of flywheel per second of tow

  bumpTransfer: 0.34,     // speed the rear car loses in a rear-end
  bumpGive: 0.14,         // ...and the fraction the front car gains
  scrapeLoss: 2.2,        // m/s^2 while grinding alongside someone
};

/* The field. Skill is not a speed multiplier — it drives how well each rival
   times the pump, how late they brake, and how tidy their line is, so a slow
   rival is slow for a reason you can watch. */
/* The field.

   `skill` shapes BEHAVIOUR — line, lift point, braking point — and `pace` is a
   flat drag handicap. Behaviour alone was tried first, and it is worth writing
   down why it failed: measured on empty road, skill 0.60 lapped in 66.60 s and
   skill 0.99 in 66.50 s. A tenth of a second across the whole range. The lift
   and brake thresholds only bite inside a narrow band of medium corners, so the
   rest of the lap is identical whoever is driving, and every apparent pace
   difference in a race was traffic luck. A purely behavioural pecking order is
   just a random one wearing a nicer name. */
export const RIVALS = [
  { name: 'VESK',   color: 0x2f6f9e, skill: 0.94, pace: 1.07, line: -0.35, react: 0.10 },
  { name: 'ORRIN',  color: 0xd9a13a, skill: 0.86, pace: 1.12, line:  0.40, react: 0.16 },
  { name: 'HALLOW', color: 0x7a4f9c, skill: 0.79, pace: 1.18, line: -0.55, react: 0.22 },
  { name: 'BRAKE',  color: 0x3f8f5c, skill: 0.71, pace: 1.25, line:  0.60, react: 0.30 },
];


/* Difficulty scales the field's pace handicap and how close to the limit the
   rivals are willing to run. Easy is not a slower race, it is a race you are
   more likely to win — the leader is still a leader. */
export const DIFFICULTY = {
  easy:   { label: 'Easy',   pace: 1.14, nerve: -0.14 },
  normal: { label: 'Normal', pace: 1.00, nerve: 0.00 },
  hard:   { label: 'Hard',   pace: 0.90, nerve: 0.10 },
  brutal: { label: 'Brutal', pace: 0.83, nerve: 0.18 },
};
export let difficulty = 'normal';
export const setDifficulty = (d) => { difficulty = DIFFICULTY[d] ? d : 'normal'; };

export function createField() {
  const carts = [];
  const n = RIVALS.length + 1;

  RIVALS.forEach((r, i) => {
    const c = SIM.create();
    const D = DIFFICULTY[difficulty];
    c.name = r.name; c.color = r.color;
    c.ai = { ...r, skill: Math.max(0.3, Math.min(1, r.skill + D.nerve)) };
    c.pace = r.pace * D.pace;
    c.isPlayer = false;
    carts.push(c);
  });

  const you = SIM.create();
  you.name = 'YOU'; you.isPlayer = true;
  carts.push(you);

  /* You start at the BACK of the grid. It costs nothing and it is the single
     cheapest way to give a run a shape: there is something to do from the first
     second, and a reason to care about the corners. */
  carts.forEach((c, i) => {
    const slot = n - 1 - i;                       // 0 = front
    c.s = slot * tune.gridGap;
    c.u = (slot % 2 ? 1 : -1) * tune.gridStagger;
    c.grid = n - slot;
  });

  return { carts, you, started: false, t: 0, finishers: [] };
}

/* --------------------------------------------------------------------------
   Rival driving. A policy, not a cheat: it reads the same track queries the
   player can see and presses the same four inputs.
   -------------------------------------------------------------------------- */
function driveAI(c, field, dt) {
  const ai = c.ai;
  const edge = T.halfWAt(c.s) - 1.4;

  /* How much cornering the road is about to ask for, in units of what the
     tyres can supply. Seen through their reaction time, so a poor rival is
     visibly LATE rather than merely slower. */
  const lead = Math.max(14, c.v * (1.35 - 0.35 * ai.skill));
  const s2 = Math.min(T.LENGTH - 1, c.s + lead);
  const need = Math.abs(c.v * c.v * T.khAt(s2) - SIM.tune.G * Math.sin(T.bankAt(s2)));
  const soon = need / (SIM.tune.mu * SIM.tune.G * T.gripAt(c.s));

  /* Line: hug the inside, plus a personal bias so the field does not converge
     into a single file. */
  const dirAhead = T.khAt(Math.min(T.LENGTH - 1, c.s + lead * 0.6));
  let target = -Math.sign(dirAhead) * edge * 0.78 * ai.skill + ai.line * edge * 0.40;

  /* Avoidance considers everyone nearby and picks the side with room; a rival
     that always swerved the same way herded the pack into one corner of the
     road and ground there. */
  let boxed = false, blocker = null;
  for (const o of field.carts) {
    if (o === c || o.done) continue;
    const ds = o.s - c.s;
    if (ds > 0 && ds < 20 && Math.abs(o.u - c.u) < 3.0) {
      if (!blocker || ds < blocker.s - c.s) blocker = o;
    }
  }
  if (blocker) {
    const room = (side) => {
      const lane = blocker.u + side * 3.6;
      if (Math.abs(lane) > edge) return -1;
      let free = edge - Math.abs(lane);
      for (const o of field.carts) {
        if (o === c || o.done) continue;
        if (Math.abs(o.s - c.s) < 20 && Math.abs(o.u - lane) < 2.6) free -= 5;
      }
      return free;
    };
    const L = room(-1), R = room(1);
    if (L < 0 && R < 0) { boxed = true; target = c.u; }
    else target = blocker.u + (L >= R ? -3.6 : 3.6);
  }
  target = Math.max(-edge, Math.min(edge, target));

  return {
    /* Where they lift and brake is the pace lever, bracketed around the
       reference racer's 1.35 / 1.60. */
    throttle: soon < (0.85 + 0.70 * ai.skill),
    brake: soon > (2.15 - 0.60 * ai.skill),
    steer: Math.max(-1, Math.min(1, (target - c.u) * 0.9 - c.vy * 0.14)),
    hand: false,
    boost: !boxed && c.charge > (0.75 - 0.45 * ai.skill) && soon < 0.8,
  };
}

/* --------------------------------------------------------------------------
   Interactions. Run after every cart has moved, so the order carts appear in
   the array cannot change the outcome.
   -------------------------------------------------------------------------- */
function interact(field, dt) {
  const K = tune;
  const carts = field.carts;

  for (const c of carts) c.drafting = false;

  for (let i = 0; i < carts.length; i++) {
    for (let j = i + 1; j < carts.length; j++) {
      const a = carts[i], b = carts[j];
      if (a.done || b.done) continue;
      const ds = a.s - b.s, du = a.u - b.u;

      /* ---- contact ---------------------------------------------------- */
      if (Math.abs(ds) < LEN && Math.abs(du) < WID) {
        /* Separate laterally. The tie-break matters: at exactly equal u the
           sign is arbitrary and the pair would jitter forever. */
        const dir = du === 0 ? (i % 2 ? 1 : -1) : Math.sign(du);
        /* Separate to slightly MORE than touching. Pushing to exactly WID left
           the pair on the boundary, re-colliding every frame. */
        const overlap = (WID * 1.06 - Math.abs(du)) * 0.5;
        a.u += dir * overlap; b.u -= dir * overlap;

        const rear = a.s < b.s ? a : b;            // whoever is behind
        const front = rear === a ? b : a;
        const closing = rear.v - front.v;
        if (closing > 0) {
          rear.v = Math.max(0, rear.v - closing * K.bumpTransfer);
          front.v += closing * K.bumpGive;
          rear.lastBump = front.name;
          front.lastBumped = rear.name;
        }
        /* Grinding alongside costs both of you, which is what stops side by
           side being strictly better than picking a line — but it has to scale
           with how fast you are actually moving. A flat loss applied at zero
           speed exactly cancelled gravity on a shallow grade, and two carts
           that touched on the grid held each other at a standstill for the
           whole race. No relative motion, no scraping. */
        const bite = K.scrapeLoss * dt;
        a.v = Math.max(0, a.v - bite * Math.min(1, a.v / 8));
        b.v = Math.max(0, b.v - bite * Math.min(1, b.v / 8));
        a.scraping = b.scraping = true;
      }

      /* ---- tow ------------------------------------------------------- */
      const gap = Math.abs(ds);
      if (gap > K.draftMin && gap < K.draftMax && Math.abs(du) < K.draftWidth) {
        const back = a.s < b.s ? a : b;
        back.drafting = true;
      }
    }
  }

  /* Applied as a drag multiplier rather than a shove, so a tow is something you
     have to hold rather than a button that fires. */
  for (const c of carts) {
    c.mod = c.mod || {};
    c.mod.drag = (c.drafting ? K.draftDrag : 1) * (c.pace ?? 1);
    if (c.drafting && !c.air) {
      c.charge = Math.min(SIM.tune.boostMax, c.charge + K.draftCharge * dt);
    }
  }
}

/* --------------------------------------------------------------------------
   One tick of the whole race.
   -------------------------------------------------------------------------- */
export function step(field, dt, playerInput) {
  field.t += dt;

  for (const c of field.carts) {
    if (c.done) continue;
    c.scraping = false;
    if (c.isPlayer) Object.assign(c.input, playerInput);
    else Object.assign(c.input, driveAI(c, field, dt));
    SIM.step(c, dt);
    if (c.done && !c.placed) {
      c.placed = true;
      field.finishers.push(c);
      c.place = field.finishers.length;
    }
  }
  interact(field, dt);
  return field;
}

/* Running order: finishers first in the order they crossed, then everyone else
   by distance. */
export function order(field) {
  const done = field.finishers.slice();
  const running = field.carts.filter((c) => !c.placed).sort((a, b) => b.s - a.s);
  return done.concat(running);
}

export function positionOf(field, cart) {
  return order(field).indexOf(cart) + 1;
}

/* Gap in seconds to the cart ahead, estimated from their current speed —
   distance alone reads wrong when the two of you are at different speeds. */
export function gapAhead(field, cart) {
  const ord = order(field);
  const i = ord.indexOf(cart);
  if (i <= 0) return null;
  const ahead = ord[i - 1];
  const d = ahead.s - cart.s;
  return { name: ahead.name, metres: d, seconds: d / Math.max(6, cart.v) };
}

/* --------------------------------------------------------------------------
   Headless: does the field actually race, or does it stretch into a parade?
   -------------------------------------------------------------------------- */
export function sim(opts = {}) {
  const field = createField();
  const dt = 1 / 120;
  const you = field.you;
  /* Drive the player seat with a BEGINNER by default. Balancing the field
     against a good policy is exactly how the rivals ended up quicker than any
     human could be — the question is whether a mediocre driver has a race, not
     whether a robot does. */
  /* Flat out, steers roughly, never brakes. NOTE: this used to be written with
     the old input names, so it silently never touched the throttle and reported
     the floor as 69 s adrift — a harness that never drove, reported as a
     balance result. */
  const beginner = (S) => ({
    throttle: true,
    brake: false,
    steer: Math.max(-1, Math.min(1, -S.u * 0.36 - S.vy * 0.16)) * 0.8,
    hand: false,
    boost: S.charge > 0.4,
  });
  /* Three reference drivers, because one number cannot answer "is this fair".
     beginner = the floor a first run should clear; good = a competent human,
     who ought to be able to win from the back; ace = the ceiling. */
  const asRival = (skill) => {
    you.ai = { skill, line: 0, react: 0.12 };
    /* A human uses the tow and spends boost to PASS. The rival policy declines
       to thrust while boxed in, which is polite and correct for them and made
       the reference driver unable to overtake anything — every skill level
       finished fifth by exactly the same margin. */
    return () => ({ ...driveAI(you, field, dt), thrust: you.charge > 0.3 });
  };
  const drivePlayer = opts.player === 'good' ? asRival(0.90)
                    : opts.player === 'ace' ? asRival(0.99)
                    : beginner;
  let steps = 0;
  const lead = [];

  while (field.finishers.length < field.carts.length && steps++ < 90000) {
    step(field, dt, drivePlayer(you));
    if (steps % 240 === 0) lead.push(order(field)[0].name);
  }
  const changes = lead.filter((n, i) => i && n !== lead[i - 1]).length;
  /* Report the carts that did NOT finish, loudly. A field report that quietly
     averages over whoever happened to make it describes a race that did not
     take place. */
  const stuck = field.carts.filter((c) => !c.placed).map((c) => ({
    name: c.name, stuckAt: +c.s.toFixed(0), segment: T.NAMES[T.segAt(c.s)],
    v: +c.v.toFixed(2), u: +c.u.toFixed(1), onWall: c.onWall,
  }));
  const fin = field.finishers;
  return {
    finishers: fin.map((c) => ({
      place: c.place, name: c.name, time: +c.t.toFixed(2), grid: c.grid,
    })),
    stuck,
    spread: fin.length > 1 ? +(fin[fin.length - 1].t - fin[0].t).toFixed(2) : null,
    leadChanges: changes,
  };
}
