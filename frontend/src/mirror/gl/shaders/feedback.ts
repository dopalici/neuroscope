/**
 * Pass 2 — the smear.
 *
 * The previous *output* is sampled slightly zoomed, so a trail crawls outward
 * instead of sitting exactly on top of itself. That drift is the whole
 * difference between a motion blur and a feedback loop.
 */
export const FEEDBACK_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform sampler2D uHist;
uniform float uEcho;

uniform float u_trail;
uniform float u_feedbackDrift;
uniform float u_feedbackHue;

void main() {
  vec3 src = texture(uSrc, vUv).rgb;

  vec2 huv = (vUv - 0.5) * (1.0 - u_feedbackDrift * 0.02) + 0.5;
  vec3 hist = texture(uHist, huv).rgb;

  // Channels decay at slightly different rates, so a long trail slides toward
  // the warm end of the palette as it dies rather than going grey.
  vec3 bias = vec3(1.0, 1.0 - u_feedbackHue * 0.06, 1.0 - u_feedbackHue * 0.13);

  float k = clamp(u_trail + uEcho * 0.6, 0.0, 0.965);
  fragColor = vec4(mix(src, hist * bias, k), 1.0);
}
`
