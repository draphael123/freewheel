/* ============================================================================
   FREEWHEEL — sound.

   Synthesised, not sampled. Partly so the project stays asset-free and keeps
   loading in one request, but mostly because the two sounds that matter here
   are CONTINUOUS and have to track state exactly: the engine note follows
   speed and throttle, and the tyres start squealing at precisely the moment
   the grip meter goes amber. A sample library cannot do either without a lot
   of crossfading, and the squeal in particular is the more legible version of
   information the HUD is currently conveying with a bar.

   Everything hangs off one master gain so the whole thing can be muted, and
   nothing is created until a real user gesture unlocks the context.
   ========================================================================== */

let ctx = null, master = null, ready = false, muted = false;
let engine = null, squeal = null, wind = null, crowd = null, rivals = null;
let noiseBuf = null;

export const state = () => ({ ready, muted });
/* For verification only: lets a test tap the master bus and confirm the graph
   is producing signal rather than merely existing. */
export const _tap = () => (ready ? { ctx, master } : null);

function noise() {
  if (!noiseBuf) {
    const n = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

/* Must ride a real gesture or the context stays suspended. */
export function unlock() {
  if (ready) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);

  /* ---- engine ----------------------------------------------------------- */
  /* Two detuned saws for the buzz, a square an octave down for body, and a
     lowpass that opens with the throttle so lifting is audible before the
     pitch has had time to fall. */
  const eg = ctx.createGain(); eg.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.8;
  const oscs = [
    { o: ctx.createOscillator(), type: 'sawtooth', mul: 1.000, g: 0.30 },
    { o: ctx.createOscillator(), type: 'sawtooth', mul: 1.008, g: 0.24 },
    { o: ctx.createOscillator(), type: 'square',   mul: 0.500, g: 0.20 },
  ];
  for (const s of oscs) {
    s.o.type = s.type;
    s.o.frequency.value = 70 * s.mul;
    const g = ctx.createGain(); g.gain.value = s.g;
    s.o.connect(g); g.connect(lp);
    s.o.start();
  }
  lp.connect(eg); eg.connect(master);
  engine = { gain: eg, lp, oscs };

  /* ---- tyres ------------------------------------------------------------ */
  /* Bandpassed noise with a high Q — a squeal is a narrow resonance, and its
     centre climbing with slip is what makes it read as the tyres losing rather
     than as generic hiss. */
  const sg = ctx.createGain(); sg.gain.value = 0;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 7;
  const sn = noise(); sn.connect(bp); bp.connect(sg); sg.connect(master); sn.start();
  squeal = { gain: sg, bp };

  /* ---- wind ------------------------------------------------------------- */
  const wg = ctx.createGain(); wg.gain.value = 0;
  const wlp = ctx.createBiquadFilter();
  wlp.type = 'lowpass'; wlp.frequency.value = 900;
  const wn = noise(); wn.connect(wlp); wlp.connect(wg); wg.connect(master); wn.start();
  wind = { gain: wg, lp: wlp };

  /* ---- crowd ------------------------------------------------------------ */
  const cg = ctx.createGain(); cg.gain.value = 0;
  const cbp = ctx.createBiquadFilter();
  cbp.type = 'bandpass'; cbp.frequency.value = 700; cbp.Q.value = 0.7;
  const cn = noise(); cn.connect(cbp); cbp.connect(cg); cg.connect(master); cn.start();
  crowd = { gain: cg };

  /* ---- the rest of the field -------------------------------------------- */
  /* One drone standing in for every nearby rival. Individually voicing four
     more engines costs four more filter chains to produce a sound the player
     cannot separate anyway. */
  const rg = ctx.createGain(); rg.gain.value = 0;
  const rlp = ctx.createBiquadFilter();
  rlp.type = 'lowpass'; rlp.frequency.value = 420;
  const ro = ctx.createOscillator(); ro.type = 'sawtooth'; ro.frequency.value = 84;
  const ro2 = ctx.createOscillator(); ro2.type = 'sawtooth'; ro2.frequency.value = 62;
  ro.connect(rlp); ro2.connect(rlp); rlp.connect(rg); rg.connect(master);
  ro.start(); ro2.start();
  rivals = { gain: rg, lp: rlp, oscs: [ro, ro2] };

  ready = true;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}

/* --------------------------------------------------------------------------
   One-shots.
   -------------------------------------------------------------------------- */
function ping(freq, dur, type, vol, sweepTo) {
  if (!ready) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = type || 'sine';
  const g = ctx.createGain();
  o.frequency.setValueAtTime(freq, t);
  if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function burst(dur, freq, Q, vol, sweepTo) {
  if (!ready) return;
  const t = ctx.currentTime;
  const src = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = Q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

export const sfx = {
  bale:  () => { burst(0.30, 240, 1.2, 0.55); ping(90, 0.22, 'sine', 0.5, 46); },
  wall:  () => { burst(0.22, 900, 2.0, 0.40, 380); ping(120, 0.14, 'square', 0.22, 70); },
  spin:  () => { burst(0.85, 1700, 6.0, 0.42, 620); },
  land:  () => { burst(0.18, 320, 1.0, 0.34); },
  boost: () => { burst(0.55, 500, 1.4, 0.30, 2400); ping(220, 0.5, 'sawtooth', 0.10, 660); },
  count: () => ping(660, 0.16, 'square', 0.28),
  go:    () => { ping(990, 0.42, 'square', 0.34); ping(1320, 0.42, 'square', 0.18); },
  place: () => { ping(523, 0.16, 'square', 0.24); setTimeout(() => ping(784, 0.34, 'square', 0.24), 150); },
};

/* --------------------------------------------------------------------------
   Per-frame. Everything here is a setTargetAtTime rather than a direct write,
   because stepping a gain or a frequency once per frame at 60 Hz is audible as
   a buzz on top of whatever it was supposed to be doing.
   -------------------------------------------------------------------------- */
export function update(S, opts = {}) {
  if (!ready) return;
  const t = ctx.currentTime;
  const set = (p, v, tau = 0.05) => p.setTargetAtTime(v, t, tau);

  if (!opts.playing) {
    set(engine.gain.gain, 0, 0.12);
    set(squeal.gain.gain, 0, 0.08);
    set(wind.gain.gain, 0, 0.12);
    set(crowd.gain.gain, 0, 0.2);
    set(rivals.gain.gain, 0, 0.12);
    return;
  }

  const v = S.v, thr = S.input.throttle ? 1 : 0;

  /* Engine. Pitch tracks speed with a floor so idle still has a note, and the
     boost lifts it a fifth so spending it is audible without looking. */
  const f = 62 + v * 5.6 + (S.input.boost && S.charge > 0.02 ? 26 : 0);
  for (const s of engine.oscs) set(s.o.frequency, f * s.mul, 0.04);
  set(engine.lp.frequency, 480 + thr * 900 + v * 22, 0.06);
  set(engine.gain.gain, S.spun > 0 ? 0.05 : (0.055 + thr * 0.075), 0.05);

  /* Tyres. Silent until the grip meter goes amber, then it climbs — the same
     information the bar carries, in the channel you are not looking at. */
  const sq = Math.max(0, Math.min(1, (S.slip - 0.78) / 0.55));
  set(squeal.gain.gain, sq * 0.22 * Math.min(1, v / 10), 0.04);
  set(squeal.bp.frequency, 1250 + sq * 700 + Math.abs(S.drift) * 40, 0.05);

  set(wind.gain.gain, Math.min(0.10, v / 42 * 0.10), 0.08);
  set(wind.lp.frequency, 500 + v * 34, 0.08);

  set(crowd.gain.gain, (opts.crowd || 0) * 0.055, 0.35);

  /* The pack, by proximity: a wall of engine when you are in among them. */
  const near = opts.nearest == null ? 999 : opts.nearest;
  set(rivals.gain.gain, Math.max(0, 1 - near / 26) * 0.075, 0.12);
  set(rivals.lp.frequency, 320 + v * 10, 0.1);
}
