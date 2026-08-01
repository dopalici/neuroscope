import { HASH } from './common'

/**
 * Pass 3 — colour, bloom, grain, vignette, and the fog the artifact veto puts
 * over the picture.
 *
 * `uTint` arrives as the atmosphere engine's live colour already converted to
 * RGB, so the mirror inherits whatever the dashboard's state word is wearing.
 *
 * The left/right split is in SCREEN space. Because the canvas is mirrored, the
 * user's left electrode AF7 is on the right of the picture — the mapping layer
 * has already resolved that, and nothing here should second-guess it.
 */
export const GRADE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec3 uTint;
uniform float uTime;
uniform float uAspect;
uniform float uShutterPhase;
uniform float uReduced;

uniform float u_tint;
uniform float u_bloom;
uniform float u_bloomThreshold;
uniform float u_grain;
uniform float u_vignette;
uniform float u_fog;
uniform float u_lean;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_hueShift;
uniform float u_scanlines;

${HASH}

/** YIQ rotation — a hue turn without a full HSV round trip. */
vec3 hueRotate(vec3 c, float a) {
  const mat3 toYiq = mat3(
    0.299, 0.596, 0.211,
    0.587, -0.274, -0.523,
    0.114, -0.322, 0.312
  );
  const mat3 toRgb = mat3(
    1.0, 1.0, 1.0,
    0.956, -0.272, -1.106,
    0.621, -0.647, 1.703
  );
  vec3 yiq = toYiq * c;
  float s = sin(a);
  float k = cos(a);
  yiq.yz = mat2(k, s, -s, k) * yiq.yz;
  return toRgb * yiq;
}

void main() {
  vec2 uv = vUv;
  vec3 col = texture(uSrc, uv).rgb;

  // One blur, used twice: the bright part becomes bloom, the whole thing
  // becomes the fog that a bad electrode puts over the picture.
  vec3 blur = vec3(0.0);
  float spread = 3.0 + u_fog * 6.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981;
    vec2 o = vec2(cos(a), sin(a)) * uTexel * spread;
    blur += texture(uSrc, uv + o).rgb;
    blur += texture(uSrc, uv + o * 2.3).rgb;
  }
  blur /= 16.0;

  // Soft focus / fog: lose definition, keep the photograph. No grey wash.
  vec3 soft = mix(col, blur, clamp(u_fog, 0.0, 1.0) * 0.72);
  float fogLuma = luma(soft);
  col = mix(soft, vec3(fogLuma) * 0.98 + soft * 0.02, clamp(u_fog, 0.0, 1.0) * 0.28);
  col = mix(col, vec3(0.42, 0.39, 0.35) * (0.55 + fogLuma * 0.5), clamp(u_fog, 0.0, 1.0) * 0.12);

  vec3 bright = max(blur - u_bloomThreshold, 0.0);
  col += bright * u_bloom;

  col *= exp2(u_exposure);
  col = (col - 0.5) * (1.0 + u_contrast) + 0.5;

  col = mix(col, col * uTint * 1.9, clamp(u_tint, 0.0, 1.0));
  if (abs(u_hueShift) > 0.001) col = hueRotate(col, u_hueShift);

  // Warm one half, cool the other. Positive lean = warm on the screen right.
  float side = (uv.x - 0.5) * 2.0;
  float bias = clamp(u_lean * side * 0.5 + 0.5, 0.0, 1.0);
  vec3 split = mix(vec3(0.93, 0.98, 1.06), vec3(1.07, 0.99, 0.91), bias);
  col *= mix(vec3(1.0), split, clamp(abs(u_lean), 0.0, 1.0));

  float scan = sin(uv.y / max(uTexel.y, 1e-6) * 0.9) * 0.5 + 0.5;
  col *= 1.0 - scan * u_scanlines * 0.04;

  // Heart lives here: a breathing falloff at the edges, not a zoom.
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float vig = 1.0 - smoothstep(0.38, 1.05, length(p)) * u_vignette;
  col *= vig;

  float g = hash21(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += g * u_grain * 0.08;

  // Reduced motion caps how far a single frame can fall.
  col = mix(col, col * 0.55, uShutterPhase * (1.0 - uReduced) * 0.5);

  fragColor = vec4(max(col, 0.0), 1.0);
}
`
