# FREEWHEEL

**No engine. Height is your fuel.**

A gravity racer down a mountain that is also a town. Once a year the whole hill
closes and the streets become the track — no motors, only what gravity lends
you, and only until you spend it.

Isometric camera, real inclines and declines, five altitude bands from the
snowline to the sea.

## The mechanic

`W` to go, `S` to brake, `A`/`D` to steer, `SPACE` to break traction, `SHIFT`
to spend boost.

Your tyres can only supply so much lateral force. Ask for more and the cart
**slides** — the grip meter shows how close you are, and past the mark you are
going wherever the corner sends you. Overcook it badly enough and you spin.

**Sliding charges the boost**, so the risky line is also the fast one. A tow
charges it too, as does a clean landing.

| | |
|---|---|
| `W` | throttle |
| `S` | brake |
| `A` / `D` | steer |
| `SPACE` | handbrake — break traction |
| `SHIFT` | spend boost |
| `R` | restart · `ESC` settings |

### It used to be a gravity racer

There was no throttle: speed came from reading the terrain, and `SPACE` was a
tuck that traded steering for drag. That premise was defended through three
redesigns and rejected in four playtests — *"I would like to steer and
accelerate"*, *"there is no way to accelerate"*, *"I do not understand what tuck
does"*, *"auto accelerate does not make sense"*. Both of tuck's effects were
invisible, so no amount of rebalancing was ever going to make it read.

What makes it a race now is the **grip limit**. A braking point is only a
decision if arriving too fast costs you the corner.

## The race

Four rivals, and you start **last on a five-car grid**. That costs nothing to
build and it is the cheapest way to give a run a shape — there is something to
do from the first second and a reason to care about the corners.

Every cart runs the identical physics from `sim.js`. The AI differs only in what
it presses, never in what it is allowed to do. Skill is not a speed multiplier:
it drives how well a rival times the pump, how late they brake and how tidy
their line is, so a slow rival is slow for a reason you can watch.

- **Contact** — rear-ending costs the car behind, grinding alongside costs you
  both, so side-by-side is never strictly better than picking a line.
- **The tow** — sit 2.5–15 m behind someone and your drag halves while the
  flywheel winds. Rivals are a resource, not only an obstacle.

Measured over a full field: **11.4 s spread, 6 lead changes**, everyone finishes.

## Zones

A course is a journey, not a list of corners. Every segment carries a `zone`,
and the zone drives ground colour, what is scattered beside the road and where
the buildings are — so the world changes under you at authored moments rather
than drifting with altitude.

**THE VALE** now runs 2380 m from the snowline to the sea:

`THE GATE · THE CORNICE · STEEP DROP · THE PINEWOOD · THE LEAP · HAIRPIN L ·
THE SPAN · THE ESSES · THE ADIT · THE TERRACES · THE SWEEP · THE PINCH ·
THE VILLAGE · THE STEPS · HAIRPIN R · THE QUAY`

Three of those are places rather than corners: **THE SPAN** refuses the terrain
carve so the ground drops away and the road is a bridge, **THE ADIT** is a
tunnel, and **THE VILLAGE** is a street with houses hard against both verges.

## Sound

Synthesised, not sampled — the project stays asset-free, but mostly because the
two sounds that matter are continuous and have to track state exactly. The
engine note follows speed and throttle, and **the tyres start squealing at
precisely the moment the grip meter goes amber**: the same information the bar
carries, in the channel you are not looking at.

Also wind with speed, crowd that swells in the village, a drone for the pack
when you are among them, and one-shots fired off counters the physics already
keeps — so a sound can never disagree with what happened.

`M` mutes. Measured on the master bus: silent in menus, louder with speed, and
the 1.2–2.6 kHz band nearly doubles when the tyres let go.

## Views and difficulty

Three cameras, cycled with `C` or set in Settings:

- **ISO** — the fixed orthographic view the readability work was built for
- **CHASE** — perspective, behind and above, lagging on a spring so the cart
  leads the camera through a corner rather than the other way round
- **COCKPIT** — the rider's eyeline, parented to the cart so it inherits the
  body roll, which is most of what makes it feel like driving

Two cameras rather than one with a mode flag: an orthographic and a perspective
camera disagree about almost every property, including how fog reads — the
ortho sits 220 units back and the chase sits ten, so a single near/far either
fogs everything or nothing.

Opponents run at **Easy / Normal / Hard / Brutal**, which scales both their pace
handicap and how close to the limit they are willing to run. Easy is not a
slower race, it is one you are more likely to win.

## The look

Everything here is derived from the centreline, so it costs nothing per course:

- **Guard rails** run unbroken down both verges. Sparse posts left the road edge
  as a dotted suggestion; a continuous line at knee height reads as a boundary
  from any distance and puts something solid a metre off your shoulder.
- **Kerbs** in red and white on every real corner, **skid marks** laid into them,
  and two octaves of noise on the road's vertex colour so the tarmac has repairs
  and wear rather than one flat grey over two kilometres.
- **Fake ambient occlusion**: each terrain vertex is compared with the mean of
  its neighbours, and sitting below them means it is in a hollow. Two lines, and
  it is most of what separates a lit scene from a field of flat polygons.
- **Corner warning signs** placed far enough back to be read — scenery, and also
  the only thing that warns you about a corner before the corner.
- **Spectators** behind the rail where people would actually stand, and clouds
  painted straight into the sky dome so they cannot pop or cost a draw call.

## The road furniture

Sense of speed comes from **proximity**, and an open hillside has nothing near
you — which is why 55 mph read as a stroll whatever the number said. Gantries
pass directly overhead, bunting runs a metre off your shoulder, and hay bales
sit on the road itself: soft, so a bad line costs you a place rather than the
run.

The cart rolls out of corners while the rider leans in, squats under power and
dives under braking, its wheels spin and steer, and the suspension takes a hit
on landing. Two objects disagreeing is what sells weight — a rigid model does
not, at any level of detail.

## The hills

Three venues, and each one **owns a mechanic** rather than a palette. If two
courses ask the same thing of the player they are the same course wearing
different paint, however different the screenshots look.

| | owns | |
|---|---|---|
| **THE VALE** | line choice | sweepers and hairpins, 20% average grade, three drop-offs |
| **THE SPILLWAY** | the pump | bowl-scale curvature, heavy banking, a dry concrete basin |
| **THE COLD LINE** | grip | 0.42 grip falling to 0.28, brakes barely work |

Measured, they behave differently rather than merely looking different — pump
gain over a run is **77 on the spillway, 23 on the vale, 4.6 on the ice**.

A course is a declarative array of segments and nothing else. Everything else is
derived: the hillside, the cut walls, the pylons, where trees clump, the
altitude bands. A new venue is one array in `track.js` and one entry in
`theme.js`.

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
- **Skill gradient holds**: `pump 82.1 s` > `mash 87.9 s` > `pumpNoThrust 88.8 s` >
  `tucked 92.3 s` > `open 118.7 s`. Skilled play beats mashing by 5.8 s; pumping
  with no throttle at all still beats doing nothing by 3.5 s.
- **The flywheel must charge on NET pump, not gross.** Crediting only the positive
  half of a cycle let a rider who simply mashed the key farm charge off the good
  halves while the bad halves cost speed but no charge — measured, mashing beat
  playing properly.
- **Corners were 40x too weak to matter.** A hairpin at 55 mph pushed the cart
  0.13 m/s wide against 5.4 m/s of steering authority, so the road may as well
  have been straight and the tuck trade could never bite. One constant.
- **A behavioural skill model produced no pace at all.** Measured solo on empty
  road, AI skill 0.60 lapped in 66.60 s and skill 0.99 in 66.50 s — a tenth of a
  second across the whole range, because lift and brake thresholds only bite in
  a narrow band of medium corners. Every apparent pace difference in a race was
  traffic luck. Rivals now carry an explicit drag handicap as well.
- **A flat penalty can hold a car at a standstill.** Grinding alongside cost a
  fixed 3.2 m/s², which exactly cancelled gravity on a shallow grade — two carts
  that touched on the grid held each other at zero for the entire race, and the
  field report quietly averaged over the three that got away. Scale contact
  losses by speed, and make the harness name its non-finishers.
- **Crashing has to cost more than braking.** With a cheap spin, a policy that
  never braked took nine barrier hits and two spins and still beat one that drove
  properly by three seconds — which makes the grip limit a decoration.
- **And the reference driver was over-cautious.** Lifting at 0.85 of the grip
  limit lost to flat-out; lifting at 1.35 gains three seconds in a hundred with
  no spins. Swept, not guessed.
- **A binary test across a smooth field makes cliffs.** THE SPAN drops the
  terrain 30 m wherever the NEAREST road sample is a bridge, and the course
  doubles back enough that the assignment flipped between adjacent cells
  constantly — the hillside grew a row of giant vertical slabs. Weight it like
  the height and the gorge becomes a gorge.
- **A four-sided pyramid seen from above is a diamond.** A street of them read
  as a rash of red lozenges, not houses. Gabled roofs with a ridge, and a cursor
  per side of the street so buildings stop growing through one another.
- **A tunnel on a fixed iso camera is unplayable.** The roof hides the road,
  the cart and every rival under it. The ceiling is its own mesh so it can fade
  out while you are inside and close again behind you.
- **Scatter density has to be authored, not sampled.** Placing buildings at
  random s across the course put 394 houses over 2.4 km — six within sight of
  the village street, which reads as open ground with the odd shed. A street is
  a density: walk the zone instead.
- **The handedness trap bites twice.** `{right, nrm, tan}` has determinant −1,
  so it is a reflection and `setFromRotationMatrix` returns nonsense. It put the
  cart broadside across the road the first time and rendered a 15 m gantry banner
  as a thin vertical strip the second. Build X from `nrm × tan`.
- **Nearest-neighbour terrain sampling shows.** The road wall is built every
  metre against a 4.5 m terrain grid, so the two met in a sawtooth that read as
  broken geometry. Bilinear fixed it in four lines.
- **A different URL is a different module.** `main.js` imported
  `./track.js?v=4` for cache-busting while `render.js` imported `./track.js`
  plainly, which created two track modules with separate state: switching venue
  moved the HUD and the physics while the renderer quietly kept building the old
  course. Freshness belongs in headers, not in import URLs.
- **Dark ground throws the geometry away.** The spillway first inverted the
  alpine arrangement — pale road on dark scrub. The terrain measured the same
  1.7 m of relief per cell as the alpine hill and rendered as a flat olive
  field, because a dark low-contrast albedo cannot show shading. Road darker
  than ground, in every theme.
- **A sine's crests are as tight as its compressions.** A washboard fast enough
  to pump hard also launches you off every other metre — measured at 25% of the
  course airborne, where you can neither pump nor steer. Real skateparks are
  tight bowls with flat tops, so the `bowls` modifier is one too.
- **A left-handed basis is not a rotation.** `{right, nrm, tan}` has determinant
  −1 at every heading, and `setFromRotationMatrix` silently returns a meaningless
  quaternion — the cart sat broadside across the road for the entire build.
- **A vertical drop viewed end-on is invisible** on this camera. Big elevation
  changes want to be seen side-on, after a turn. The cues that actually carry
  height are the **landing ring**, the **tether**, and **road walls that reach
  the ground** — a dark contact shadow on dark asphalt communicates nothing.

Every readability cue is individually switchable in **Settings**, so the claim
"this cue is doing work" can be checked rather than asserted.

## Console

```js
FW.race()       // run a whole field headlessly: places, spread, lead changes
FW.simAll()     // every venue x every policy — the variety claim, measured
FW.sim()        // policies on the current course
FW.course('spillway')
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
| `track.js` | the courses; grade authored directly, curvature by finite difference |
| `theme.js` | every colour, light and scatter rule, as data |
| `sim.js` | cart physics and the headless policies |
| `render.js` | the look, and the readability experiment |
| `race.js` | the field: rivals, contact, the tow, standings |
| `audio.js` | synthesised engine, tyres, wind, crowd and one-shots |
| `main.js` | screens, input, fixed-timestep loop |

three.js r160 is vendored in `vendor/` on purpose — a CDN miss leaves a menu
rendering with silently dead buttons.
