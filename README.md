# FREEWHEEL

**No engine. Height is your fuel.**

A gravity racer down a mountain that is also a town. Once a year the whole hill
closes and the streets become the track — no motors, only what gravity lends
you, and only until you spend it.

Isometric camera, real inclines and declines, five altitude bands from the
snowline to the sea.

## The mechanic

Hold **SPACE** to tuck: low drag, cheap, and the correct default.

**Let go as the road compresses under you** — when the load meter passes 1 g —
and you pump speed out of the hill itself, exactly the way a skater pumps a
bowl. Crouch again over the crest. Stand up anywhere else and you are a sail.

| | |
|---|---|
| `SPACE` | tuck (hold) |
| `A` / `D` | steer |
| `S` | drag brake |
| `R` | restart |
| `ESC` | settings |

## Status

This is **slice 0**: one diagnostic hill, built to answer two questions before
any content gets made.

1. **Can a fixed isometric camera read elevation at all?**
2. **Does pumping a slope feel like a skill?**

The course is a diagnostic, not a level. Every segment exists to test one thing
— `STEEP DROP` asks whether "down" reads, `THE ROLLERS` is a pump rhythm,
`THE CLIMB` punishes wasted height, `THE STEP` is a 14 m cliff that asks
whether you can tell how high you are.

Rules are verified headlessly. **Feel is unvalidated** — that needs hands.

## What the measurements said

Physics numbers came out of `FW.sim()`, not out of taste:

- **The pump cannot pay at honest scale.** Gain goes as `v·kv·travel`, linear in
  speed; the drag cost of standing goes as `Δk·v²`, quadratic. On road-scale
  curvature standing always loses — measured, the "correct" policy captured
  0.4 m/s over the whole course while paying 4.5 m/s in drag. Real pumping works
  because a skate bowl has roughly 15× the curvature of a road. `pumpGain` is
  the number that buys the fantasy; at 1.0 the mechanic is simply dead.
- **The pump is the transition, not the pose.** Leading the compression is the
  intuitive move and it is exactly wrong — you arrive already standing and did
  all the work in the crest before it. A 6 m lookahead put the rider perfectly
  anti-phase and turned a +7 m/s mechanic into −7.5 m/s.
- **Skill gradient holds**: `pump 92.3 s` > `tucked 96.5 s` > `mash DNF` >
  `open DNF`. Mashing is punished correctly — it nets +0.6 m/s of pump and pays
  16.6 in drag.
- **A vertical drop viewed end-on is invisible** on this camera. Big elevation
  changes want to be seen side-on, after a turn. The cues that actually carry
  height are the **landing ring**, the **tether**, and **road walls that reach
  the ground** — a dark contact shadow on dark asphalt communicates nothing.

Every readability cue is individually switchable in **Settings**, so the claim
"this cue is doing work" can be checked rather than asserted.

## Console

```js
FW.sim()        // compare policies: open / mash / tucked / pump
FW.tune         // every physics constant, live
FW.seek(1000)   // jump to a distance in metres
FW.opts         // the readability toggles
```

## Running it

```bash
python serve.py 5812
```

Then open <http://localhost:5812>. The server sends `no-store` deliberately:
plain `http.server` lets Chrome cache ES modules, and a fresh config paired with
a stale module reads exactly like a code bug.

## Layout

| file | what it holds |
|---|---|
| `track.js` | the course; grade authored directly, curvature by finite difference |
| `sim.js` | cart physics and the headless policies |
| `render.js` | the look, and the readability experiment |
| `main.js` | screens, input, fixed-timestep loop |

three.js r160 is vendored in `vendor/` on purpose — a CDN miss leaves a menu
rendering with silently dead buttons.
