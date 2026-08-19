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
  gridGap: 4.2,           // metres between grid slots
  gridStagger: 3.0,       // lateral offset, alternating

  draftMin: 2.5,          // start of the tow
  draftMax: 15.0,         // ...and its end
  draftWidth: 3.2,        // how closely you must be lined up
  draftDrag: 0.52,        // drag multiplier in clean air behind someone
  draftCharge: 0.22,      // seconds of flywheel per second of tow

  bumpTransfer: 0.34,     // speed the rear car loses in a rear-end
  bumpGive: 0.14,         // ...and the fraction the front car gains
  scrapeLoss: 3.2,        // m/s^2 while grinding alongside someone
};

/* The field. Skill is not a speed multiplier — it drives how well each rival
   times the pump, how late they brake, and how tidy their line is, so a slow
   rival is slow for a reason you can watch. */
export const RIVALS = [
  { name: 'VESK',    color: 0x2f6f9e, skill: 0.94, line: -0.35, react: 0.10 },
  { name: 'ORRIN',   color: 0xd9a13a, skill: 0.86, line:  0.40, react: 0.16 },
  { name: 'HALLOW',  color: 0x7a4f9c, skill: 0.79, line: -0.55, react: 0.22 },
  { name: 'BRAKE',   color: 0x3f8f5c, skill: 0.71, line:  0.60, react: 0.30 },
];

export function createField() {
  const carts = [];
  const n = RIVALS.length + 1;

  RIVALS.forEach((r, i) => {
    const c = SIM.create();
    c.name = r.name; c.color = r.color; c.ai = { ...r };
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
  const kv = T.kvAt(c.s), kh = T.khAt(c.s), pitch = T.pitchAt(c.s);
  const grip = T.gripAt(c.s);
  const edge = T.HALF_W - 1.2;

  /* Reaction lag, so a low-skill rival is visibly late rather than merely
     slower. Sampled from the road a little BEHIND where they actually are. */
  ai.lag = (ai.lag ?? 0) + dt;
  const lagged = Math.max(0, c.s - c.v * ai.react);
  const kvSeen = T.kvAt(lagged);

  /* Line: hug the inside of the corner, by as much as their skill allows, plus
     a personal bias so the field does not converge into one file. */
  const ahead = T.khAt(Math.min(T.LENGTH - 1, c.s + Math.max(8, c.v * 0.8)));
  let target = -Math.sign(ahead) * edge * 0.55 * ai.skill + ai.line * edge * 0.5;

  /* Avoidance: if someone is just ahead and on my line, pick a side. Rivals
     that never did this simply drove through each other in a train. */
  for (const o of field.carts) {
    if (o === c) continue;
    const ds = o.s - c.s;
    if (ds > 0 && ds < 16 && Math.abs(o.u - c.u) < 2.6) {
      target = o.u + (o.u >= 0 ? -3.4 : 3.4);
      break;
    }
  }
  target = Math.max(-edge, Math.min(edge, target));
  const steer = Math.max(-1, Math.min(1, (target - c.u) * 0.85));

  /* Brake for a corner they cannot hold. Skill decides how close to the real
     limit they are willing to run. */
  const need = c.v * c.v * Math.abs(kh);
  const canHold = grip * 17.0 * (0.72 + 0.30 * ai.skill);
  const brake = need > canHold && pitch < 0.02;

  return {
    tuck: kvSeen < SIM.tune.pumpKvMin * (2.0 - ai.skill),
    steer,
    brake,
    thrust: c.charge > 0.25 && pitch > -0.16 && !brake,
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
    c.mod.drag = c.drafting ? K.draftDrag : 1;
    if (c.drafting && !c.air) {
      c.charge = Math.min(SIM.tune.chargeMax, c.charge + K.draftCharge * dt);
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
  /* Drive the player seat with a reference rival so the result describes the
     FIELD and not a human. Assigned once — rebuilding it every tick reset the
     reaction-lag state and produced a driver that never settled. */
  you.ai = { skill: opts.skill ?? 0.88, line: 0, react: 0.14 };
  let steps = 0;
  const lead = [];

  while (field.finishers.length < field.carts.length && steps++ < 90000) {
    step(field, dt, driveAI(you, field, dt));
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
