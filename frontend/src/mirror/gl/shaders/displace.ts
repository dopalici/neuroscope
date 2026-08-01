import { HASH } from './common'

/**
 * Pass 1 — everything that moves a pixel away from where the camera put it.
 *
 * The video is sampled flipped on both axes: `y` because a texture uploaded
 * from a video has row 0 at the top while UV `v = 0` is the bottom of the
 * screen, and `x` because this is a mirror. Every downstream pass therefore
 * works in plain screen space.
 */
export const DISPLACE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVideo;
uniform float uTime;
uniform float uAspect;
uniform vec2 uCover;
uniform float uShutterPhase;
uniform float uShockPhase;
uniform float uReduced;

uniform float u_blockAmount;
uniform float u_blockScale;
uniform float u_warpAmount;
uniform float u_warpScale;
uniform float u_warpSpeed;
uniform float u_tear;
uniform float u_chroma;
uniform float u_shear;
uniform float u_shock;
uniform float u_shimmer;
uniform float u_breathe;
uniform float u_pulseScale;
uniform float u_zoom;
uniform float u_shutter;

${HASH}

vec2 toVideo(vec2 uv) {
  vec2 c = (uv - 0.5) * uCover + 0.5;
  return vec2(1.0 - c.x, 1.0 - c.y);
}

vec3 grab(vec2 uv) {
  return texture(uVideo, clamp(toVideo(uv), 0.0015, 0.9985)).rgb;
}

void main() {
  vec2 uv = vUv;

  // Aspect-corrected offset from centre, so radial effects stay circular on a
  // wide canvas instead of turning into ellipses.
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);

  // Zoom is almost entirely vignette-driven now; keep these gains tiny so even
  // a maxed panel slider cannot turn the mirror into a heartbeat music video.
  float scale = 1.0
    + u_zoom
    + u_breathe * sin(uTime * 0.45) * 0.008
    + u_pulseScale * 0.006;
  uv = (uv - 0.5) / max(0.2, scale) + 0.5;

  // Slow wander: soft photographic drift, not a flow-field effect.
  vec2 flow = vec2(
    vnoise(uv * u_warpScale + vec2(uTime * u_warpSpeed, 0.0)),
    vnoise(uv * u_warpScale + vec2(0.0, uTime * u_warpSpeed * 0.83) + 17.3)
  ) - 0.5;
  uv += flow * u_warpAmount * 0.055;

  // Tear / block stay available for the panel but are heavily attenuated —
  // default mapping parks their uniforms at zero.
  float tearLine = fract(uTime * 0.37 + hash11(floor(uTime * 0.37)) * 0.5);
  float tearBand = exp(-abs(uv.y - tearLine) * 140.0);
  uv.x += tearBand * u_tear * (hash11(floor(uTime * 11.0)) - 0.5) * 0.08;

  float step14 = floor(uTime * 14.0);
  float row = floor(uv.y * max(4.0, u_blockScale));
  float pick = hash21(vec2(row, step14));
  float live = step(1.0 - clamp(u_blockAmount, 0.0, 1.0) * 0.35, pick);
  uv.x += (hash21(vec2(row + 3.7, step14)) - 0.5) * u_blockAmount * 0.05 * live;

  // Jaw: a soft radial push, not a damage ring.
  float r = length(p);
  float ringR = uShockPhase * 1.3;
  float ring = exp(-pow((r - ringR) * 7.0, 2.0));
  uv += normalize(p + 1e-5) * ring * u_shock * 0.012;

  // Edge shimmer, from the 100 ms amplitude envelope. Local contrast is taken
  // from four taps so the jitter lands on features and leaves flat skin alone.
  float e = 0.0;
  if (u_shimmer > 0.001) {
    vec2 h = vec2(0.0035, 0.0);
    vec2 v = vec2(0.0, 0.0035);
    float lx = luma(grab(uv + h)) - luma(grab(uv - h));
    float ly = luma(grab(uv + v)) - luma(grab(uv - v));
    e = clamp(length(vec2(lx, ly)) * 5.0, 0.0, 1.0);
    vec2 jit = vec2(
      hash21(uv * 700.0 + uTime * 60.0) - 0.5,
      hash21(uv * 700.0 - uTime * 47.0) - 0.5
    );
    uv += jit * e * u_shimmer * 0.006;
  }

  // A blink squeezes the frame vertically before it drops it — a lid, not a cut.
  float lid = uShutterPhase * (1.0 - uReduced * 0.65);
  uv.y = (uv.y - 0.5) * (1.0 + lid * 0.35) + 0.5;

  vec2 dir = p;
  float ca = u_chroma * 0.006;
  vec2 shearOff = vec2(u_shear * 0.018, 0.0);

  vec3 col;
  col.r = grab(uv + dir * ca + shearOff).r;
  col.g = grab(uv).g;
  col.b = grab(uv - dir * ca - shearOff).b;

  // Reduced motion never lets the frame go fully dark.
  float floorLevel = mix(0.04, 0.45, uReduced);
  col *= mix(1.0, floorLevel, uShutterPhase * clamp(u_shutter, 0.0, 1.0));

  fragColor = vec4(col, 1.0);
}
`
