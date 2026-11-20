// 3D glass Christmas tree scene, written directly in WebGL2 (no libraries).
// Same interface as the SVG Tree in tree.js: knock(), removeInstantly(), remaining, destroy().

import { rng } from "./tree.js";

// ---------------------------------------------------------------- math
const m4 = {
  ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  chain(...ms) { return ms.reduce((a, b) => m4.mul(a, b)); },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
    return m;
  },
  lookAt(e, c, u) {
    const z = norm(sub(e, c)), x = norm(cross(u, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  },
  t(x, y, z) { const m = m4.ident(); m[12] = x; m[13] = y; m[14] = z; return m; },
  s(x, y = x, z = x) { const m = m4.ident(); m[0] = x; m[5] = y; m[10] = z; return m; },
  rx(a) { const m = m4.ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
  ry(a) { const m = m4.ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
  rz(a) { const m = m4.ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
  apply(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------- shaders
const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNorm; layout(location=2) in vec2 aUV;
uniform mat4 uProj, uView, uModel;
out vec3 vPos; out vec3 vNorm; out vec2 vUV;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vPos = w.xyz; vNorm = mat3(uModel) * aNorm; vUV = aUV;
  gl_Position = uProj * uView * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNorm; in vec2 vUV;
uniform int uMode; uniform vec3 uColor; uniform vec3 uEmissive; uniform float uAlpha;
uniform vec3 uCam; uniform float uTime; uniform float uRibbon; uniform vec4 uParam;
out vec4 o;
float spec(vec3 N, vec3 V, vec3 L, float p){ return pow(max(dot(reflect(-L, N), V), 0.0), p); }
void main(){
  vec3 N = normalize(vNorm); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vPos);
  vec3 L1 = normalize(vec3(0.5, 0.9, 0.8)), L2 = normalize(vec3(-0.8, 0.4, 0.5));
  float fres = pow(1.0 - abs(dot(N, V)), 2.5);
  float rib = 0.0;
  if (uRibbon > 0.0) rib = max(step(abs(vUV.x - 0.5), 0.08), step(abs(vUV.y - 0.5), 0.08));

  if (uMode == 0) {            // solid, shiny (baubles, base, star)
    float d = max(dot(N, L1), 0.0) * 0.8 + max(dot(N, L2), 0.0) * 0.35;
    vec3 sc = mix(vec3(1.0), uColor, uParam.x);
    vec3 c = uColor * (0.16 + d) + (spec(N, V, L1, 70.0) * 1.6 + spec(N, V, L2, 30.0) * 0.6) * sc + fres * uColor * 0.8 + uEmissive;
    c = mix(c, vec3(1.0, 0.97, 0.9) * (0.7 + d), rib * 0.85);
    o = vec4(c, 1.0);
  } else if (uMode == 1) {     // glass (tree tiers, floating gifts)
    float e = min(min(vUV.x, 1.0 - vUV.x), vUV.y);
    float edge = smoothstep(uParam.y, 0.0, e);
    float rim = smoothstep(0.07, 0.0, vUV.y) * uParam.z; // glowing lower rim
    float s = spec(N, V, L1, 40.0) + 0.7 * spec(N, V, L2, 20.0);
    vec3 edgeCol = mix(vec3(0.9, 1.0, 0.95), uColor * 1.6 + 0.25, uParam.w);
    float streaks = pow(0.5 + 0.5 * sin(vUV.x * 23.0 + vUV.y * 4.0 + uTime * 0.7), 12.0) * 0.35 * (1.0 - uParam.w);
    vec3 c = uColor * (0.38 + 0.85 * vUV.y) + vec3(0.9, 1.0, 0.85) * streaks + mix(vec3(0.8, 1.0, 0.9), uColor + 0.3, uParam.w) * fres * 0.6 + vec3(s) * 0.8
           + edge * edgeCol * 0.8 + rim * vec3(1.0, 0.85, 0.5) * 1.6 + rib * mix(vec3(1.0), uColor + 0.5, 0.5) * 0.5;
    float a = clamp((0.20 + fres * 0.5) * uAlpha + edge * 0.5 + rim * 0.8 + s * 0.6 + rib * 0.35, 0.0, 1.0);
    o = vec4(c, a);
  } else if (uMode == 2) {     // light swirl comet (additive)
    float f = fract(vUV.x * uParam.x - uTime * uParam.y);
    float comet = pow(f, 5.0) * 1.2 + pow(f, 60.0) * 3.0;
    float w = pow(1.0 - abs(vUV.y * 2.0 - 1.0), 1.5);
    o = vec4(uColor * comet * w * uAlpha, 1.0);
  } else if (uMode == 3) {     // ribbed glass wall
    float s = 0.5 + 0.5 * sin(vUV.x * uParam.x * 6.2832);
    float ridge = pow(s, 4.0);
    float fade = smoothstep(0.0, 0.15, vUV.y) * (1.0 - 0.5 * vUV.y);
    float frame = smoothstep(0.012, 0.0, min(vUV.x, 1.0 - vUV.x));
    float light = 0.55 + 0.45 * sin(vUV.x * 3.0 + 1.0);
    vec3 c = uColor * (0.12 + 0.55 * ridge) * fade * light + vec3(1.0) * pow(s, 80.0) * 0.18 * fade + vec3(0.8, 1.0, 0.9) * frame * 0.5;
    o = vec4(c, (0.55 + 0.25 * ridge) * uAlpha);
  } else if (uMode == 4) {     // reflective floor (drawn over the mirrored scene)
    float r = length(vPos.xz);
    float a = mix(0.62, 0.97, smoothstep(0.3, 4.5, r));
    float streak = 0.5 + 0.5 * sin(vPos.x * 3.0 + vPos.z * 0.5);
    vec3 c = vec3(0.12, 0.145, 0.14) + vec3(0.07) * streak * (1.0 - smoothstep(0.0, 5.0, r))
           + vec3(1.0, 0.82, 0.45) * 0.28 * exp(-r * r * 0.7);
    o = vec4(c, a);
  } else {                     // soft glow (additive)
    vec2 q = vUV * 2.0 - 1.0;
    float g = exp(-dot(q, q) * uParam.x);
    o = vec4(uColor * g * uAlpha, 1.0);
  }
}`;

const PVS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aCol; layout(location=2) in vec2 aSA;
uniform mat4 uProj, uView; uniform float uScale;
out vec3 vCol; out float vA;
void main(){
  vec4 v = uView * vec4(aPos, 1.0);
  gl_Position = uProj * v;
  gl_PointSize = aSA.x * uScale / max(0.5, -v.z) ;
  vCol = aCol; vA = aSA.y;
}`;
const PFS = `#version 300 es
precision mediump float;
in vec3 vCol; in float vA; out vec4 o;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  float g = exp(-d * 4.0) + 0.6 * exp(-abs(q.x) * 18.0) * exp(-abs(q.y) * 2.0) + 0.6 * exp(-abs(q.y) * 18.0) * exp(-abs(q.x) * 2.0);
  o = vec4(vCol * g * vA, 1.0);
}`;

const QVS = `#version 300 es
out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const BRIGHT = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; out vec4 o;
void main(){ vec3 c = texture(uTex, vUV).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(0.62, 1.0, l), 1.0); }`;
const BLUR = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUV).rgb * 0.227;
  c += (texture(uTex, vUV + uDir * 1.385).rgb + texture(uTex, vUV - uDir * 1.385).rgb) * 0.316;
  c += (texture(uTex, vUV + uDir * 3.231).rgb + texture(uTex, vUV - uDir * 3.231).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;
const COMPOSITE = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uScene, uBloom, uBloom2; out vec4 o;
void main(){
  vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * 1.1 + texture(uBloom2, vUV).rgb * 0.9;
  vec2 q = vUV - 0.5;
  c *= 1.0 - dot(q, q) * 0.9;
  c = c / (1.0 + max(c - 1.0, 0.0) * 0.5);
  o = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------- geometry
function geo() { return { P: [], N: [], U: [], I: [] }; }
function quad(g, a, b, c, d, out) {
  // a-b-c-d counter-clockwise when seen from outside; uv (0,0),(1,0),(1,1),(0,1)
  let n = norm(cross(sub(b, a), sub(d, a)));
  if (out && dot(n, out) < 0) { [b, d] = [d, b]; n = norm(cross(sub(b, a), sub(d, a))); }
  const i = g.P.length / 3;
  for (const p of [a, b, c, d]) { g.P.push(...p); g.N.push(...n); }
  g.U.push(0, 0, 1, 0, 1, 1, 0, 1);
  g.I.push(i, i + 1, i + 2, i, i + 2, i + 3);
}
function frustum(sides, rB, rT, yB, yT, rot = 0) {
  const g = geo();
  for (let i = 0; i < sides; i++) {
    const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2;
    const b0 = [rB * Math.sin(a0), yB, rB * Math.cos(a0)], b1 = [rB * Math.sin(a1), yB, rB * Math.cos(a1)];
    const t0 = [rT * Math.sin(a0), yT, rT * Math.cos(a0)], t1 = [rT * Math.sin(a1), yT, rT * Math.cos(a1)];
    const mid = (a0 + a1) / 2;
    quad(g, b0, b1, t1, t0, [Math.sin(mid), 0, Math.cos(mid)]);
  }
  // caps (uv in the centre so they get no edge glow)
  for (const [y, r, up] of [[yB, rB, -1], [yT, rT, 1]]) {
    if (r < 0.01) continue;
    const c = g.P.length / 3;
    g.P.push(0, y, 0); g.N.push(0, up, 0); g.U.push(0.5, 0.5);
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      g.P.push(r * Math.sin(a), y, r * Math.cos(a)); g.N.push(0, up, 0); g.U.push(0.5, 0.5);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (up > 0) g.I.push(c, c + 1 + i, c + 1 + j); else g.I.push(c, c + 1 + j, c + 1 + i);
    }
  }
  return g;
}
function sphere(seg = 20) {
  const g = geo();
  for (let y = 0; y <= seg; y++) for (let x = 0; x <= seg; x++) {
    const u = x / seg, v = y / seg, th = u * Math.PI * 2, ph = v * Math.PI;
    const p = [Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)];
    g.P.push(...p); g.N.push(...p); g.U.push(u, v);
  }
  for (let y = 0; y < seg; y++) for (let x = 0; x < seg; x++) {
    const i = y * (seg + 1) + x;
    g.I.push(i, i + seg + 1, i + 1, i + 1, i + seg + 1, i + seg + 2);
  }
  return g;
}
function box() {
  const g = geo();
  const v = (x, y, z) => [x * 0.5, y * 0.5, z * 0.5];
  quad(g, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), [0, 0, 1]);
  quad(g, v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), [0, 0, -1]);
  quad(g, v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), [1, 0, 0]);
  quad(g, v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), [-1, 0, 0]);
  quad(g, v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1), [0, 1, 0]);
  quad(g, v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), [0, -1, 0]);
  return g;
}
function star(outer = 1, inner = 0.45, depth = 0.25) {
  const g = geo();
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer, a = (i / 10) * Math.PI * 2;
    pts.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  for (const side of [1, -1]) {
    const c = g.P.length / 3;
    g.P.push(0, 0, depth * side); g.N.push(0, 0, side); g.U.push(0.5, 0.5);
    for (const [x, y] of pts) { g.P.push(x, y, 0); g.N.push(...norm([x * 0.3, y * 0.3, side])); g.U.push(0.5, 0.5); }
    for (let i = 0; i < 10; i++) {
      const j = (i + 1) % 10;
      if (side > 0) g.I.push(c, c + 1 + j, c + 1 + i); else g.I.push(c, c + 1 + i, c + 1 + j);
    }
  }
  return g;
}
function ring(seg = 160) {
  const g = geo();
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    g.P.push(c * 0.988, 0, s * 0.988, c * 1.012, 0, s * 1.012);
    g.N.push(0, 1, 0, 0, 1, 0);
    g.U.push(i / seg, 0, i / seg, 1);
    if (i < seg) { const k = i * 2; g.I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  return g;
}
function plane() {
  const g = geo();
  quad(g, [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1]);
  return g;
}

// ---------------------------------------------------------------- tree layout
const TIERS = [ // [yBottom, yTop, rBottom, rTop]
  [0.42, 1.30, 1.34, 0.56],
  [1.08, 1.92, 1.12, 0.44],
  [1.70, 2.48, 0.90, 0.32],
  [2.28, 3.00, 0.66, 0.18],
  [2.80, 3.48, 0.42, 0.02],
];
const STAR_Y = 3.66;
const BAUBLES = [
  { color: [0.9, 0.05, 0.08], emissive: [0.25, 0.0, 0.0], metal: 0.2 },  // red
  { color: [1.0, 0.7, 0.2], emissive: [0.22, 0.13, 0.02], metal: 0.9 }, // gold
  { color: [0.1, 0.7, 0.32], emissive: [0.0, 0.12, 0.04], metal: 0.4 },  // green
  { color: [0.9, 0.06, 0.1], emissive: [0.2, 0.0, 0.0], metal: 0.2 },    // red again (most common)
];
const GIFT_COLOURS = [[0.95, 0.1, 0.12], [1.0, 0.72, 0.2], [0.2, 0.85, 0.42], [0.9, 0.93, 0.97]];

export function supportsWebGL2() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

// ---------------------------------------------------------------- class
export class Tree3D {
  constructor(container, { count = 40, seed = 1 } = {}) {
    this.container = container;
    this.count = count;
    this.random = rng(seed);
    this.flying = [];
    this.particles = [];
    this.wobble = 0; this.wobbleV = 0; this.shakeCam = 0;

    container.innerHTML = "";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "tree3d";
    container.appendChild(this.canvas);
    const gl = this.canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 not available");
    this.gl = gl;

    this.initGL();
    this.buildScene();
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
    this.t0 = performance.now();
    this.last = this.t0;
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  get remaining() { return this.ornaments.length; }
  get total() { return this.count; }

  // ---------- GL setup
  program(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const locs = {};
    return { p, u: (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))) };
  }

  mesh(g) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    [[g.P, 3], [g.N, 3], [g.U, 2]].forEach(([data, size], i) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, size, gl.FLOAT, false, 0, 0);
    });
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.I), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: g.I.length };
  }

  initGL() {
    const gl = this.gl;
    this.prog = this.program(VS, FS);
    this.pprog = this.program(PVS, PFS);
    this.bright = this.program(QVS, BRIGHT);
    this.blur = this.program(QVS, BLUR);
    this.comp = this.program(QVS, COMPOSITE);
    this.emptyVao = gl.createVertexArray();

    this.meshes = {
      tiers: TIERS.map(([yb, yt, rb, rt]) => this.mesh(frustum(4, rb, rt, yb, yt, 0))),
      base: this.mesh(frustum(6, 0.4, 0.34, 0, 0.44, Math.PI / 6)),
      plinth: this.mesh(frustum(6, 0.5, 0.5, 0, 0.05, Math.PI / 6)),
      sphere: this.mesh(sphere(18)),
      box: this.mesh(box()),
      star: this.mesh(star()),
      ring: this.mesh(ring()),
      plane: this.mesh(plane()),
    };

    this.pbuf = gl.createBuffer();
    this.pvao = gl.createVertexArray();
    gl.bindVertexArray(this.pvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.bindVertexArray(null);
  }

  makeTarget(w, h, msaa) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const t = { tex, fb, w, h };
    if (msaa) {
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
      t.msFb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.msFb);
      const crb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, crb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, crb);
      const drb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, drb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, drb);
      t.rbs = [crb, drb];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }

  freeTarget(t) {
    if (!t) return;
    const gl = this.gl;
    gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb);
    if (t.msFb) { gl.deleteFramebuffer(t.msFb); t.rbs.forEach((r) => gl.deleteRenderbuffer(r)); }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = w; this.canvas.height = h;
    [this.scene, this.b1, this.b2, this.c1, this.c2].forEach((t) => this.freeTarget(t));
    this.scene = this.makeTarget(w, h, true);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.b1 = this.makeTarget(bw, bh); this.b2 = this.makeTarget(bw, bh);
    const cw = Math.max(1, w >> 3), ch = Math.max(1, h >> 3);
    this.c1 = this.makeTarget(cw, ch); this.c2 = this.makeTarget(cw, ch);

    // Fit the whole tree on screen whatever the shape of the phone.
    const asp = w / h, fov = (40 * Math.PI) / 180, tf = Math.tan(fov / 2);
    const dist = Math.max(2.55 / tf, 2.05 / (tf * asp));
    this.camBase = [0, 2.35, dist];
    this.target = [0, 1.78, 0];
    this.proj = m4.persp(fov, asp, 0.1, 60);
    this.asp = asp;
  }

  // ---------- scene contents
  buildScene() {
    const r = this.random;

    // Decorations on the tree faces.
    const spots = [];
    const balls = this.count - 1;
    const weights = TIERS.map(([yb, yt, rb, rt]) => (rb + rt) * (yt - yb));
    const wsum = weights.reduce((a, b) => a + b, 0);
    let guard = 0;
    while (spots.length < balls && guard++ < 8000) {
      let pick = r() * wsum, ti = 0;
      while (pick > weights[ti]) { pick -= weights[ti]; ti++; }
      const [yb, yt, rb, rt] = TIERS[ti];
      // Bias to the two faces that face the camera most of the time.
      const face = r() < 0.72 ? (r() < 0.5 ? 0 : 3) : (r() < 0.5 ? 1 : 2);
      const a0 = (face / 4) * Math.PI * 2, a1 = ((face + 1) / 4) * Math.PI * 2;
      const u = 0.12 + r() * 0.76, v = 0.1 + r() * 0.7;
      const rr = rb + (rt - rb) * v, y = yb + (yt - yb) * v;
      const p0 = [rr * Math.sin(a0), y, rr * Math.cos(a0)], p1 = [rr * Math.sin(a1), y, rr * Math.cos(a1)];
      const p = [p0[0] + (p1[0] - p0[0]) * u, y, p0[2] + (p1[2] - p0[2]) * u];
      const mid = (a0 + a1) / 2;
      const n = [Math.sin(mid), 0.35, Math.cos(mid)];
      const minD = guard > 6000 ? 0.15 : 0.22;
      if (spots.some((s) => (s.p[0] - p[0]) ** 2 + (s.p[1] - p[1]) ** 2 + (s.p[2] - p[2]) ** 2 < minD * minD)) continue;
      spots.push({ p, n: norm(n) });
    }

    this.ornaments = spots.map(({ p, n }) => {
      const roll = r();
      let o;
      if (roll < 0.78) {
        const s = 0.075 + r() * 0.035;
        o = { kind: "ball", size: s, style: BAUBLES[Math.floor(r() * BAUBLES.length)] };
      } else {
        const c = GIFT_COLOURS[Math.floor(r() * GIFT_COLOURS.length)];
        o = { kind: "gift", size: 0.13, style: { color: c, emissive: c.map((x) => x * 0.25), metal: 0.3 }, spin: r() * Math.PI };
      }
      o.local = [p[0] + n[0] * o.size * 0.9, p[1] + n[1] * o.size * 0.9, p[2] + n[2] * o.size * 0.9];
      return o;
    });
    for (let i = this.ornaments.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [this.ornaments[i], this.ornaments[j]] = [this.ornaments[j], this.ornaments[i]];
    }
    this.ornaments.unshift({
      kind: "star", size: 0.27, local: [0, STAR_Y, 0],
      style: { color: [1.0, 0.78, 0.3], emissive: [0.95, 0.7, 0.25], metal: 1 },
    });

    // Floating glass gifts around the room (decoration only).
    this.gifts = [
      { p: [-1.45, 3.75, -0.6], s: 0.4, c: [0.6, 0.66, 0.7], rot: [0.3, 0.5, -0.2] },
      { p: [-1.6, 2.75, 0.1], s: 0.32, c: [1.0, 0.12, 0.15], rot: [0.2, -0.4, 0.15] },
      { p: [-1.75, 1.55, 0.3], s: 0.3, c: [1.0, 0.15, 0.15], rot: [-0.2, 0.6, 0.1] },
      { p: [1.55, 3.5, -0.4], s: 0.38, c: [1.0, 0.75, 0.25], rot: [0.25, 0.7, 0.1] },
      { p: [1.7, 2.55, -0.3], s: 0.4, c: [0.25, 0.95, 0.45], rot: [-0.15, -0.5, 0.2] },
      { p: [1.55, 0.55, 0.6], s: 0.38, c: [1.0, 0.15, 0.18], rot: [0.0, 0.4, 0.0] },
      { p: [-1.2, 0.3, 0.9], s: 0.3, c: [1.0, 0.8, 0.3], rot: [0.1, -0.6, 0.05] },
      { p: [0.75, 0.25, 1.25], s: 0.2, c: [0.4, 1.0, 0.55], rot: [0.3, 0.3, 0.2] },
    ];

    // Ambient sparkles.
    const cols = [[1, 0.85, 0.45], [1, 1, 1], [1, 0.3, 0.3], [0.4, 1, 0.6]];
    this.sparkles = Array.from({ length: 70 }, () => ({
      p: [(r() - 0.5) * 4.2, 0.2 + r() * 4.2, (r() - 0.5) * 3],
      c: cols[Math.floor(r() * cols.length)],
      size: 6 + r() * 16,
      ph: r() * 6.28, sp: 1 + r() * 3,
    }));

    // Light swirls: [y, radius, tiltX, tiltZ, speed, colour]
    this.swirls = [
      [0.95, 1.75, 0.10, -0.06, 0.22, [1.0, 0.9, 0.65]],
      [1.55, 1.55, -0.05, 0.08, -0.27, [1.0, 1.0, 1.0]],
      [2.2, 1.25, 0.12, 0.05, 0.3, [1.0, 0.88, 0.6]],
      [2.85, 0.95, -0.08, -0.1, -0.35, [1.0, 1.0, 0.95]],
    ];
  }

  treeMatrix(t) {
    const sway = Math.sin(t * 0.45) * 0.18;
    return m4.chain(m4.rz(this.wobble), m4.ry(sway));
  }

  // ---------- gameplay hooks
  knock(n = 1, dir = 1) {
    let removed = 0;
    const tm = this.treeMatrix((performance.now() - this.t0) / 1000);
    for (let i = 0; i < n && this.ornaments.length; i++) {
      const o = this.ornaments.pop();
      const wp = m4.apply(tm, o.local);
      const out = norm([wp[0] || dir * 0.5, 0, wp[2] + 0.3]);
      const r = Math.random;
      o.pos = wp;
      o.vel = [out[0] * (1.2 + r() * 1.4) + dir * (0.8 + r()), 1.8 + r() * 2.2, out[2] * (0.8 + r() * 1.2) + 0.9 + r() * 1.4];
      o.axis = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
      o.ang = 0; o.angV = 6 + r() * 10; o.life = 0;
      this.flying.push(o);
      this.burst(wp, o.kind === "star" ? 40 : 12);
      removed++;
    }
    this.wobbleV += -dir * (0.9 + 0.3 * n);
    this.shakeCam = Math.min(1, this.shakeCam + 0.35);
    return removed;
  }

  removeInstantly(k) {
    for (let i = 0; i < k && this.ornaments.length; i++) this.ornaments.pop();
  }

  burst(p, n) {
    const r = Math.random;
    const cols = [[1, 0.9, 0.55], [1, 1, 1], [1, 0.75, 0.3]];
    for (let i = 0; i < n; i++) {
      const v = norm([r() - 0.5, r() - 0.3, r() - 0.5]);
      const sp = 0.8 + r() * 2.2;
      this.particles.push({ p: [...p], v: [v[0] * sp, v[1] * sp, v[2] * sp], c: cols[i % 3], size: 6 + r() * 11, life: 0, max: 0.5 + r() * 0.5 });
    }
  }

  // ---------- frame
  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    this.update(dt);
    this.draw(t);
  }

  update(dt) {
    // springy wobble
    this.wobbleV += (-this.wobble * 60 - this.wobbleV * 7) * dt;
    this.wobble += this.wobbleV * dt;
    this.wobble = Math.max(-0.22, Math.min(0.22, this.wobble));
    this.shakeCam = Math.max(0, this.shakeCam - dt * 3);

    this.flying = this.flying.filter((o) => {
      o.life += dt;
      o.vel[1] -= 7.5 * dt;
      for (let k = 0; k < 3; k++) o.pos[k] += o.vel[k] * dt;
      o.ang += o.angV * dt;
      return o.life < 2.2 && o.pos[1] > -0.5 && o.pos[2] < this.camBase[2] - 0.6;
    });
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      p.v[1] -= 2.5 * dt;
      for (let k = 0; k < 3; k++) p.p[k] += p.v[k] * dt;
      return p.life < p.max;
    });
  }

  draw(t) {
    const gl = this.gl;
    this.resize();
    const P = this.prog;
    const sc = this.shakeCam;
    const cam = [this.camBase[0] + Math.sin(t * 40) * 0.05 * sc, this.camBase[1] + Math.cos(t * 33) * 0.04 * sc, this.camBase[2]];
    const view = m4.lookAt(cam, this.target, [0, 1, 0]);
    const tm = this.treeMatrix(t);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.msFb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0.025, 0.05, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u("uProj"), false, this.proj);
    gl.uniformMatrix4fv(P.u("uView"), false, view);
    gl.uniform3fv(P.u("uCam"), cam);
    gl.uniform1f(P.u("uTime"), t);

    const draw = (mesh, model, mode, color, o = {}) => {
      gl.uniformMatrix4fv(P.u("uModel"), false, model);
      gl.uniform1i(P.u("uMode"), mode);
      gl.uniform3fv(P.u("uColor"), color);
      gl.uniform3fv(P.u("uEmissive"), o.emissive || [0, 0, 0]);
      gl.uniform1f(P.u("uAlpha"), o.alpha ?? 1);
      gl.uniform1f(P.u("uRibbon"), o.ribbon ? 1 : 0);
      gl.uniform4fv(P.u("uParam"), o.param || [0, 0.03, 1, 0]);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    };
    const { meshes } = this;
    const additive = () => { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); };
    const alphaBlend = () => { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); };

    // ---- room: glows and ribbed glass walls
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    additive();
    draw(meshes.plane, m4.chain(m4.t(0, 2.1, -1.2), m4.s(5.2, 6.4, 1)), 5, [0.06, 0.38, 0.2], { param: [2.2, 0, 0, 0] });
    draw(meshes.plane, m4.chain(m4.t(-2.6, 2.4, -2.5), m4.s(4, 6, 1)), 5, [0.05, 0.3, 0.14], { param: [2.5, 0, 0, 0] });
    draw(meshes.plane, m4.chain(m4.t(2.7, 1.2, -1.5), m4.s(3.5, 4, 1)), 5, [0.35, 0.05, 0.06], { param: [2.5, 0, 0, 0] });
    alphaBlend();
    // back panel, left (green) and right (clear) panels
    draw(meshes.plane, m4.chain(m4.t(0, 2.8, -3.4), m4.s(4.4, 6.2, 1)), 3, [0.12, 0.42, 0.28], { param: [70, 0, 0, 0], alpha: 0.8 });
    draw(meshes.plane, m4.chain(m4.t(-2.15, 2.7, -1.4), m4.ry(1.0), m4.s(4.8, 6.0, 1)), 3, [0.1, 0.55, 0.28], { param: [80, 0, 0, 0], alpha: 0.9 });
    draw(meshes.plane, m4.chain(m4.t(2.15, 2.7, -1.4), m4.ry(-1.0), m4.s(4.8, 6.0, 1)), 3, [0.45, 0.5, 0.55], { param: [80, 0, 0, 0], alpha: 0.8 });

    // ---- reflection: mirrored copy of the tree under the floor
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    const mirror = m4.s(1, -1, 1);
    gl.frontFace(gl.CW);
    gl.disable(gl.BLEND);
    this.drawSolids(draw, tm, mirror);
    alphaBlend();
    gl.depthMask(false);
    this.drawGlassTree(draw, m4.mul(mirror, tm), 0.5, true);
    gl.frontFace(gl.CCW);
    gl.disable(gl.CULL_FACE);

    // ---- floor over the reflection
    alphaBlend();
    draw(meshes.plane, m4.chain(m4.rx(-Math.PI / 2), m4.s(14, 14, 1)), 4, [0, 0, 0]);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // ---- real scene
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.drawSolids(draw, tm, m4.ident());
    for (const o of this.flying) {
      const m = m4.chain(m4.t(...o.pos), axisAngle(o.axis, o.ang), this.ornamentShape(o));
      this.drawOrnament(draw, o, m);
    }

    alphaBlend();
    gl.depthMask(false);
    this.drawGlassTree(draw, tm, 1, false);

    // floating glass gifts
    gl.enable(gl.CULL_FACE);
    for (const g of this.gifts) {
      const bob = Math.sin(t * 0.9 + g.p[0] * 3) * 0.06;
      const m = m4.chain(m4.t(g.p[0], g.p[1] + bob, g.p[2]), m4.rx(g.rot[0]), m4.ry(g.rot[1] + t * 0.15), m4.rz(g.rot[2]), m4.s(g.s));
      gl.cullFace(gl.FRONT);
      draw(meshes.box, m, 1, g.c, { ribbon: true, alpha: 1.2, param: [0, 0.05, 0, 1] });
      gl.cullFace(gl.BACK);
      draw(meshes.box, m, 1, g.c, { ribbon: true, alpha: 1.2, param: [0, 0.05, 0, 1] });
    }
    gl.disable(gl.CULL_FACE);

    // light swirls
    additive();
    for (const [y, rad, tx, tz, speed, col] of this.swirls) {
      const m = m4.chain(m4.t(0, y, 0), m4.rx(tx), m4.rz(tz), m4.s(rad, 1, rad * 0.95));
      const ring = m4.chain(m, m4.s(1, 1, 1));
      for (let k = 0; k < 4; k++) {
        const sc = 1 + k * 0.035;
        draw(meshes.ring, m4.chain(m, m4.s(sc, 1, sc)), 2, col, { param: [2, speed * (1 + k * 0.15), 0, 0], alpha: 1.3 - k * 0.25 });
      }
    }
    this.drawPoints(view, t);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    this.postProcess();
  }

  drawSolids(draw, tm, pre) {
    const { meshes } = this;
    draw(meshes.plinth, m4.mul(pre, m4.ident()), 0, [0.12, 0.13, 0.13], { param: [0.2, 0, 0, 0] });
    draw(meshes.base, m4.mul(pre, m4.chain(m4.t(0, 0.04, 0))), 0, [0.08, 0.09, 0.09], { param: [0.3, 0, 0, 0] });
    for (const o of this.ornaments) {
      const m = m4.chain(pre, tm, m4.t(...o.local), this.ornamentShape(o));
      this.drawOrnament(draw, o, m);
    }
  }

  ornamentShape(o) {
    if (o.kind === "gift") return m4.chain(m4.ry(o.spin), m4.rx(0.2), m4.s(o.size));
    return m4.s(o.size);
  }

  drawOrnament(draw, o, m) {
    const st = o.style;
    if (o.kind === "ball") draw(this.meshes.sphere, m, 0, st.color, { emissive: st.emissive, param: [st.metal, 0, 0, 0] });
    else if (o.kind === "gift") draw(this.meshes.box, m, 0, st.color, { emissive: st.emissive, ribbon: true, param: [0.3, 0, 0, 0] });
    else draw(this.meshes.star, m, 0, st.color, { emissive: st.emissive, param: [1, 0, 0, 0] });
  }

  drawGlassTree(draw, tm, alpha, reflected) {
    const gl = this.gl;
    gl.enable(gl.CULL_FACE);
    const green = [0.1, 0.62, 0.32];
    for (const pass of [gl.FRONT, gl.BACK]) {
      gl.cullFace(pass);
      this.meshes.tiers.forEach((mesh) => draw(mesh, tm, 1, green, { alpha, param: [0, 0.022, reflected ? 0.4 : 1, 0] }));
    }
    gl.disable(gl.CULL_FACE);
  }

  drawPoints(view, t) {
    const gl = this.gl;
    const data = [];
    for (const s of this.sparkles) {
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(t * s.sp + s.ph));
      data.push(...s.p, ...s.c, s.size, a * 0.9);
    }
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      data.push(...p.p, ...p.c, p.size * (0.5 + a), a);
    }
    const arr = new Float32Array(data);
    gl.useProgram(this.pprog.p);
    gl.uniformMatrix4fv(this.pprog.u("uProj"), false, this.proj);
    gl.uniformMatrix4fv(this.pprog.u("uView"), false, view);
    gl.uniform1f(this.pprog.u("uScale"), this.dpr * (this.h / 900) * 6);
    gl.bindVertexArray(this.pvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, arr.length / 8);
    gl.useProgram(this.prog.p);
  }

  postProcess() {
    const gl = this.gl;
    // resolve MSAA
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.scene.msFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.scene.fb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVao);
    const pass = (prog, target, setup) => {
      gl.useProgram(prog.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : this.w, target ? target.h : this.h);
      setup(prog);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tex = (prog, name, unit, t) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(prog.u(name), unit);
    };
    const blurPair = (a, b, scale) => {
      for (let i = 0; i < 2; i++) {
        pass(this.blur, b, (p) => { tex(p, "uTex", 0, a); gl.uniform2f(p.u("uDir"), scale / a.w, 0); });
        pass(this.blur, a, (p) => { tex(p, "uTex", 0, b); gl.uniform2f(p.u("uDir"), 0, scale / a.h); });
      }
    };
    pass(this.bright, this.b1, (p) => tex(p, "uTex", 0, this.scene));
    blurPair(this.b1, this.b2, 1.2);
    pass(this.blur, this.c1, (p) => { tex(p, "uTex", 0, this.b1); gl.uniform2f(p.u("uDir"), 0, 0); });
    blurPair(this.c1, this.c2, 1.6);
    pass(this.comp, null, (p) => { tex(p, "uScene", 0, this.scene); tex(p, "uBloom", 1, this.b1); tex(p, "uBloom2", 2, this.c1); });
    gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.container.innerHTML = "";
  }
}

function axisAngle(ax, a) {
  const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return new Float32Array([
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ]);
}
