/* ============================================================================
   FREEWHEEL — the post chain.

   Written by hand rather than pulled from three's addons, because the vendored
   build is the core module only and a CDN import is the one thing this project
   has already been bitten by (a CDN miss leaves the menu rendering with silent
   dead buttons).

   THE TRAP, and the reason this file is shaped the way it is: three skips tone
   mapping when it renders into a WebGLRenderTarget. A scene drawn to an RT has
   NO tone curve applied, so if you bloom the result of a normally-rendered
   frame you are blooming values that have already been crushed into 0..1 — and
   the bloom has nothing bright to find. The order has to be:

       scene -> HDR target (tone mapping OFF, half-float)
       bright pass -> blur -> blur          (still linear, still HDR)
       composite: scene + bloom, THEN ACES, THEN sRGB, then the lens effects

   Everything after ACES is deliberately cheap and deliberately subtle. The
   point is not that the player notices a vignette; it is that a flat-shaded
   world stops reading as untextured geometry the moment there is a lens
   between them and it.
   ========================================================================== */

let THREE = null, renderer = null;
let hdr = null, brightRT = null, blurA = null, blurB = null;
let quadScene = null, quadCam = null, quad = null;
let brightMat = null, blurMat = null, compMat = null;
let W = 1, H = 1, ready = false;

export const opts = {
  enabled: true,
  bloom: 0.46,        // strength of the added highlight
  threshold: 0.68,    // luminance above which a pixel blooms
  vignette: 0.22,
  grain: 0.030,
  /* ACES is a flattening curve — it is doing its job, but a flat-shaded world
     has no texture detail to carry the midtones, so it needs the contrast and
     the colour put back deliberately. Without these two the post pass makes
     the game look WORSE than no post at all: softer, greyer, and no more
     detailed. */
  contrast: 1.05,
  saturation: 1.15,
  aberration: 0.45,   // scaled by speed; 0 at a standstill
  speedLines: 0.55,
};

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/* Bright pass. Soft knee rather than a hard cut: a hard threshold makes bloom
   pop in and out as a surface crosses it, which reads as flickering. */
const BRIGHT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(0.0, l - uThreshold);
  k = k / (k + 0.6);
  gl_FragColor = vec4(c * k, 1.0);
}`;

/* Separable 9-tap gaussian; run twice per level, horizontal then vertical. */
const BLUR = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;
void main() {
  vec2 d = uDir;
  vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
  s += texture2D(tSrc, vUv + d * 1.3846).rgb * 0.316216;
  s += texture2D(tSrc, vUv - d * 1.3846).rgb * 0.316216;
  s += texture2D(tSrc, vUv + d * 3.2308).rgb * 0.070270;
  s += texture2D(tSrc, vUv - d * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMP = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom, uExposure, uVignette, uGrain, uAberr, uLines, uSpeed, uTime;
uniform float uContrast, uSat;

/* Stephen Hill's ACES fit. This has to happen HERE and not on the renderer,
   because the scene was drawn into a render target and three skips tone
   mapping for those — without this the whole frame comes back untouched and
   twice as bright as the no-post path. */
vec3 aces(vec3 x) {
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840,
                       0.35458, 0.90834, 0.13383,
                       0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3( 1.60475, -0.10208, -0.00327,
                       -0.53108,  1.10813, -0.07276,
                       -0.07367, -0.00605,  1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}

/* The real sRGB transfer function, not pow(1/2.2). The two differ most in the
   shadows, which is exactly where a dark road lives. */
vec3 lin2srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055,
             step(vec3(0.0031308), c));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 fromC = uv - 0.5;
  float r2 = dot(fromC, fromC);

  /* Chromatic aberration, scaled by speed and by distance from centre. At the
     centre of the frame it is zero, which is where the player is looking. */
  float ab = uAberr * uSpeed * 0.004;
  vec3 sc;
  sc.r = texture2D(tScene, uv + fromC * ab).r;
  sc.g = texture2D(tScene, uv).g;
  sc.b = texture2D(tScene, uv - fromC * ab).b;

  vec3 bloom = texture2D(tBloom, uv).rgb;
  vec3 col = sc + bloom * uBloom;

  /* Speed lines: radial streaks that only exist at the edge of the frame and
     only when moving. Sampled from the bloom buffer so they pick up whatever
     is bright out there rather than being drawn on top as white scratches. */
  if (uLines > 0.001 && uSpeed > 0.02) {
    float ang = atan(fromC.y, fromC.x);
    float streak = fract(ang * 9.0 / 6.28318 + hash(vec2(floor(ang * 24.0), 3.0)));
    streak = smoothstep(0.82, 1.0, streak);
    float edge = smoothstep(0.06, 0.25, r2);
    col += bloom * streak * edge * uLines * uSpeed * 1.4;
  }

  /* The / 0.6 is NOT optional and is easy to miss: three's ACESFilmicToneMapping
     applies  color *= toneMappingExposure / 0.6  before the curve. Leaving it
     out made the post path far darker than the no-post path — measured on the
     village street, the road went 64 -> 24 while the sky only went 197 -> 165,
     because ACES has a toe and the shadows take the whole error. */
  col = aces(col * uExposure / 0.6);

  /* Grade in display-referred space. The pivot is 0.38, NOT middle grey: this
     scene's midtones sit well below 0.5 (tarmac albedo is 0.115), so pivoting
     at 0.5 pushed the entire road to black and the kart with it. Measured on
     THE CLOUD DECK at 1.14/0.5 the road came back at almost zero. */
  col = clamp((col - 0.38) * uContrast + 0.38, 0.0, 1.0);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(lum), col, uSat), 0.0, 1.0);

  /* Vignette, then grain. Grain last and in display space, because grain that
     goes through a tone curve stops being grain and becomes banding. */
  col *= 1.0 - uVignette * smoothstep(0.10, 0.75, r2);
  col = lin2srgb(col);
  col += (hash(uv * 1024.0 + uTime) - 0.5) * uGrain;

  gl_FragColor = vec4(col, 1.0);
}`;

export function init(three, r) {
  THREE = three; renderer = r;
  quadScene = new THREE.Scene();
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));

  brightMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, uThreshold: { value: opts.threshold } } });
  blurMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } } });
  compMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: COMP, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: null }, tBloom: { value: null },
      uBloom: { value: opts.bloom }, uExposure: { value: 1 },
      uVignette: { value: opts.vignette }, uGrain: { value: opts.grain },
      uAberr: { value: opts.aberration }, uLines: { value: opts.speedLines },
      uSpeed: { value: 0 }, uTime: { value: 0 },
      uContrast: { value: opts.contrast }, uSat: { value: opts.saturation },
    } });

  quad = new THREE.Mesh(g, compMat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  ready = true;
}

export function setSize(w, h) {
  if (!ready) return;
  W = Math.max(2, w | 0); H = Math.max(2, h | 0);
  const mk = (ww, hh, half) => {
    const t = new THREE.WebGLRenderTarget(Math.max(2, ww | 0), Math.max(2, hh | 0), {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: half, stencilBuffer: false,
    });
    t.texture.colorSpace = THREE.LinearSRGBColorSpace;
    return t;
  };
  for (const t of [hdr, brightRT, blurA, blurB]) if (t) t.dispose();
  hdr = mk(W, H, true);
  const bw = Math.max(2, W >> 2), bh = Math.max(2, H >> 2);
  brightRT = mk(bw, bh, true);
  blurA = mk(bw, bh, true);
  blurB = mk(bw, bh, true);
}

function pass(mat, target) {
  quad.material = mat;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(quadScene, quadCam);
}

/* `speed` is 0..1 — how fast you are going relative to the top of the range.
   `exposure` is the theme's, applied in the composite rather than on the
   renderer for the reason at the top of this file. */
export function render(scene, camera, speed, exposure, time) {
  if (!ready || !hdr) return false;

  const prevTone = renderer.toneMapping;
  const prevOut = renderer.outputColorSpace;
  /* Scene into the HDR buffer with NO tone curve and NO sRGB encode: the
     composite does both, and doing them twice is how a post chain ends up
     looking washed out and milky. */
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setRenderTarget(hdr);
  renderer.clear();
  renderer.render(scene, camera);

  brightMat.uniforms.tSrc.value = hdr.texture;
  brightMat.uniforms.uThreshold.value = opts.threshold;
  pass(brightMat, brightRT);

  const bw = brightRT.width, bh = brightRT.height;
  blurMat.uniforms.tSrc.value = brightRT.texture;
  blurMat.uniforms.uDir.value.set(1 / bw, 0);
  pass(blurMat, blurA);
  blurMat.uniforms.tSrc.value = blurA.texture;
  blurMat.uniforms.uDir.value.set(0, 1 / bh);
  pass(blurMat, blurB);
  blurMat.uniforms.tSrc.value = blurB.texture;
  blurMat.uniforms.uDir.value.set(2 / bw, 0);
  pass(blurMat, blurA);
  blurMat.uniforms.tSrc.value = blurA.texture;
  blurMat.uniforms.uDir.value.set(0, 2 / bh);
  pass(blurMat, blurB);

  const u = compMat.uniforms;
  u.tScene.value = hdr.texture;
  u.tBloom.value = blurB.texture;
  u.uBloom.value = opts.bloom;
  u.uExposure.value = exposure;
  u.uVignette.value = opts.vignette;
  u.uGrain.value = opts.grain;
  u.uAberr.value = opts.aberration;
  u.uLines.value = opts.speedLines;
  u.uSpeed.value = speed;
  u.uTime.value = time;
  u.uContrast.value = opts.contrast;
  u.uSat.value = opts.saturation;

  renderer.toneMapping = THREE.NoToneMapping;   // the shader does ACES itself
  renderer.outputColorSpace = prevOut;
  pass(compMat, null);

  renderer.toneMapping = prevTone;
  renderer.outputColorSpace = prevOut;
  return true;
}
