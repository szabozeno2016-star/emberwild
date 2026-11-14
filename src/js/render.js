/* =====================================================================
   Renderer (WebGL2)
   ===================================================================== */
const VS_MAIN = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aUVL;
layout(location=2) in vec3 aLight;
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uTime; uniform float uWave;
out vec3 vUVL; out float vShade; out float vSky; out float vBlk; out float vDist; out vec3 vPos; flat out int vFlags;
void main(){
  float fl = floor(aLight.x * 0.5);
  int f = int(fl + 0.5);
  vShade = aLight.x - fl * 2.0;
  vec3 p = aPos;
  if ((f & 1) != 0 && uWave > 0.5) { p.x += sin(uTime * 1.5 + p.x * 0.6 + p.z * 0.4) * 0.035; p.z += cos(uTime * 1.2 + p.z * 0.5) * 0.03; }
  if ((f & 2) != 0 && uWave > 0.5) { p.x += sin(uTime * 1.1 + p.y * 0.8 + p.z) * 0.018; p.y += cos(uTime * 1.4 + p.x) * 0.012; }
  vFlags = f;
  vUVL = aUVL; vSky = aLight.y; vBlk = aLight.z;
  vDist = length(p - uCam); vPos = p;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const FS_MAIN = `#version 300 es
precision highp float; precision highp sampler2DArray;
in vec3 vUVL; in float vShade; in float vSky; in float vBlk; in float vDist; in vec3 vPos; flat in int vFlags;
uniform vec3 uCamF;
uniform sampler2DArray uTex; uniform sampler2DArray uTexA; uniform float uAniso; uniform vec3 uAmb;
uniform float uDay; uniform vec3 uSunCol; uniform vec3 uFog; uniform vec2 uFogR; uniform float uAlpha;
uniform float uWater; uniform float uTime; uniform vec4 uTint; uniform float uCutoff; uniform float uFlick; uniform float uFastLeaves; uniform float uFancyWater; uniform vec3 uBiome[32];
out vec4 o;
float curve(float x){ return x / (3.0 - 2.0 * x); }
void main(){
  vec3 uvl = vUVL;
  vec4 t;
  if (uWater > 0.5) {
    vec2 wp = vPos.xz;
    if (uFancyWater > 0.5) t = 0.5 * texture(uTex, vec3(wp * 0.5 + vec2(uTime * 0.02, uTime * 0.03), uvl.z))
      + 0.5 * texture(uTex, vec3(wp.yx * 0.37 + vec2(-uTime * 0.025, uTime * 0.012), uvl.z));
    else t = texture(uTex, vec3(wp * 0.5 + vec2(uTime * 0.02, uTime * 0.03), uvl.z));
  } else if (uAniso > 0.5) {
    // pixel-crisp up close (nearest), anisotropic at grazing angles / distance
    vec2 g = max(abs(dFdx(uvl.xy)), abs(dFdy(uvl.xy))) * 16.0;
    vec4 tn = texture(uTex, uvl), ta = texture(uTexA, uvl);
    t = max(g.x, g.y) < 1.0 ? tn : ta;
  } else t = texture(uTex, uvl);
  if (uFastLeaves > 0.5 && (vFlags & 2) != 0) t.a = 1.0;
  if (t.a < uCutoff) discard;
  int ti = (vFlags >> 3) & 31;
  if (ti > 0 && uWater < 0.5) {   // biome colour: only the green parts of grass, leaves and plants
    float gw = clamp((t.g - max(t.r, t.b)) * 6.0, 0.0, 1.0);
    t.rgb = mix(t.rgb, clamp(t.rgb * uBiome[ti], 0.0, 1.0), gw);
  }
  float sky = curve(clamp(vSky, 0.0, 1.0));
  float blk = pow(clamp(vBlk, 0.0, 1.0), 1.7) * 1.3 * uFlick;
  vec3 L = max(sky * uDay * uSunCol, blk * vec3(1.0, 0.76, 0.48));
  L = min(L, vec3(1.25));
  L = max(L, uAmb);
  vec3 c = t.rgb * vShade * L;
  if ((vFlags & 4) != 0) c = t.rgb * (1.08 + 0.1 * sin(uTime * 11.0 + vPos.x * 5.0 + vPos.z * 3.0));
  float a = t.a * uAlpha;
  if (uWater > 0.5) {
    float depth = clamp(vShade, 0.0, 1.0);
    c = t.rgb * vec3(0.52, 0.72, 1.12) * L * mix(1.08, 0.66, depth);
    vec3 vd = normalize(uCamF - vPos);
    float fres = uFancyWater > 0.5 ? pow(1.0 - clamp(abs(vd.y), 0.0, 1.0), 4.0) : 0.0;
    c = mix(c, uFog * max(L.g, 0.25) * 1.05, fres * 0.55);
    a = mix(0.58, 0.9, depth) + fres * 0.08;
  }
  c = mix(c, uTint.rgb, uTint.a);
  float fog = smoothstep(uFogR.x, uFogR.y, vDist);
  c = mix(c, uFog, fog);
  o = vec4(c, a);
}`;
const VS_SKY = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP, 0.9999, 1.0); }`;
const FS_SKY = `#version 300 es
precision highp float;
in vec2 vP; uniform mat4 uInv; uniform vec3 uSun; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow;
uniform float uNight; uniform float uTime; uniform float uSunset; uniform float uRain;
out vec4 o;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
void main(){
  vec4 w = uInv * vec4(vP, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w);
  float y = d.y;
  vec3 col = mix(uHor, uZen, pow(clamp(y, 0.0, 1.0), 0.55));
  if (y < 0.0) col = mix(uHor, uHor * 0.55, clamp(-y * 3.0, 0.0, 1.0));
  float sd = max(dot(d, uSun), 0.0);
  float clear = 1.0 - uRain * 0.9;
  col += uGlow * (pow(sd, 6.0) * 0.55 + pow(sd, 48.0) * 0.6) * (0.35 + uSunset) * clear;
  // horizon band glow toward the sun at sunrise / sunset
  float band = exp(-abs(y) * 7.0) * pow(max(dot(normalize(vec3(d.x,0.0,d.z)), normalize(vec3(uSun.x,0.0,uSun.z))), 0.0), 2.0);
  col += uGlow * band * uSunset * 0.5 * clear;
  // square sun
  vec3 up = abs(uSun.y) > 0.99 ? vec3(1,0,0) : vec3(0,1,0);
  vec3 r = normalize(cross(up, uSun)); vec3 u = cross(uSun, r);
  float ds = dot(d, uSun);
  if (ds > 0.0) {
    vec2 q = vec2(dot(d, r), dot(d, u)) / ds;
    float m = max(abs(q.x), abs(q.y));
    if (m < 0.075) col = mix(col, vec3(1.0, 0.97, 0.82), 0.92 * clear);
    else if (m < 0.1) col = mix(col, vec3(1.0, 0.85, 0.5), 0.45 * clear);
  }
  // moon (opposite)
  float dm = dot(d, -uSun);
  if (dm > 0.0) {
    vec2 q = vec2(dot(d, -r), dot(d, u)) / dm;
    float m = max(abs(q.x), abs(q.y));
    if (m < 0.06) {
      vec2 cell = floor((q + 0.06) / 0.12 * 8.0);
      float cr = h(vec3(cell, 3.0));
      vec3 mc = vec3(0.86, 0.88, 0.95) * (cr < 0.2 ? 0.72 : 1.0);
      col = mix(col, mc, 0.9 * clamp(uNight + 0.25, 0.0, 1.0) * clear);
    }
  }
  // stars
  if (uNight > 0.01 && y > 0.0) {
    vec3 sp = d * 160.0;
    vec3 cell = floor(sp);
    float s = h(cell);
    if (s > 0.9975) {
      vec3 f = fract(sp) - 0.5;
      float tw = 0.65 + 0.35 * sin(uTime * 2.0 + s * 300.0);
      float a = smoothstep(0.32, 0.0, max(abs(f.x), max(abs(f.y), abs(f.z)))) * tw;
      col += vec3(a) * uNight * smoothstep(0.0, 0.2, y) * clear;
    }
  }
  o = vec4(col, 1.0);
}`;
const VS_LINE = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uVP; void main(){ gl_Position = uVP * vec4(aPos,1.0); }`;
const FS_LINE = `#version 300 es
precision mediump float; uniform vec4 uCol; out vec4 o; void main(){ o = uCol; }`;

const R = {
  gl: null, canvas: null, progMain: null, progSky: null, progLine: null, tex: null,
  quadIndex: null, quadCap: 0, skyVAO: null, lineVAO: null, lineBuf: null,
  dyn: null, dynVAO: null, dynBuf: null,
  vp: M4.create(), view: M4.create(), proj: M4.create(), invVPsky: M4.create(),
  uMain: {}, uSky: {}, uLine: {},
  tileData: null, // Uint8Array RGBA for each layer (for icon extrusion)
};

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function uniforms(gl, p, names) {
  const u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, n); return u;
}

function initRenderer(canvas, atlasImg) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  R.gl = gl; R.canvas = canvas;
  R.progMain = compile(gl, VS_MAIN, FS_MAIN);
  R.progSky = compile(gl, VS_SKY, FS_SKY);
  R.progLine = compile(gl, VS_LINE, FS_LINE);
  R.uMain = uniforms(gl, R.progMain, ['uAmb', 'uBiome', 'uTexA', 'uAniso', 'uWave', 'uFastLeaves', 'uFancyWater', 'uFlick', 'uVP', 'uCam', 'uCamF', 'uTime', 'uTex', 'uDay', 'uSunCol', 'uFog', 'uFogR', 'uAlpha', 'uWater', 'uTint', 'uCutoff']);
  R.uSky = uniforms(gl, R.progSky, ['uInv', 'uSun', 'uZen', 'uHor', 'uGlow', 'uNight', 'uTime', 'uSunset', 'uRain']);
  R.uLine = uniforms(gl, R.progLine, ['uVP', 'uCol']);

  // ---- texture array from atlas ----
  const cv = document.createElement('canvas'); cv.width = atlasImg.width; cv.height = atlasImg.height;
  const cx = cv.getContext('2d'); cx.drawImage(atlasImg, 0, 0);
  const img = cx.getImageData(0, 0, cv.width, cv.height).data;
  fitSkinSlots(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS));
  const data = new Uint8Array(16 * 16 * 4 * TEX_TOTAL);
  for (let l = 0; l < TEX_WHITE; l++) {
    const tx = (l % ATLAS.cols) * 16, ty = ((l / ATLAS.cols) | 0) * 16;
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const s = ((ty + y) * cv.width + tx + x) * 4, d = (l * 256 + y * 16 + x) * 4;
      data[d] = img[s]; data[d + 1] = img[s + 1]; data[d + 2] = img[s + 2]; data[d + 3] = img[s + 3];
      if (img[s + 3] > 0) { ar += img[s]; ag += img[s + 1]; ab += img[s + 2]; an++; }
    }
    // bleed average colour into transparent texels (clean mipmaps)
    if (an) for (let p = 0; p < 256; p++) {
      const d = (l * 256 + p) * 4;
      if (data[d + 3] === 0) { data[d] = ar / an; data[d + 1] = ag / an; data[d + 2] = ab / an; }
    }
  }
  data.fill(255, TEX_WHITE * 1024);
  R.tileData = data;
  R.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, R.tex);
  // every 16px tile is redrawn at 32px with smoothed edges and fine detail
  const hd = new Uint8Array(TILE * TILE * 4 * TEX_TOTAL);
  for (let l = 0; l < TEX_WHITE; l++) hdTile(data, l * 1024, hd, l * TILE * TILE * 4, l);
  hd.fill(255, TEX_WHITE * TILE * TILE * 4);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, TILE, TILE, TEX_TOTAL, 0, gl.RGBA, gl.UNSIGNED_BYTE, hd);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 5);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  R.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  setAniso(GFX.aniso);
  try { initPost(); } catch (e) { R.postOK = false; console.warn('post-processing unavailable', e); }

  // ---- shared quad index buffer ----
  ensureQuadIndex(65536);
  // ---- sky ----
  R.skyVAO = gl.createVertexArray(); gl.bindVertexArray(R.skyVAO);
  const sb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // ---- lines ----
  R.lineVAO = gl.createVertexArray(); gl.bindVertexArray(R.lineVAO);
  R.lineBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, R.lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 24 * 3 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  // ---- dynamic (entities, particles, held item) ----
  R.dyn = new VBuf(36 * 2048);
  R.dynVAO = gl.createVertexArray(); gl.bindVertexArray(R.dynVAO);
  R.dynBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, R.dynBuf);
  gl.bufferData(gl.ARRAY_BUFFER, 4 * 36 * 4096, gl.DYNAMIC_DRAW); R.dynCap = 36 * 4096;
  setupMainAttribs(gl);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.quadIndex);
  gl.bindVertexArray(null);
  R.clouds = buildClouds();
  return gl;
}
function setupMainAttribs(gl) {
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
}
function ensureQuadIndex(quads) {
  const gl = R.gl;
  if (R.quadCap >= quads) return;
  let cap = Math.max(quads, R.quadCap * 2);
  const idx = new Uint32Array(cap * 6);
  for (let q = 0; q < cap; q++) { const b = q * 4, o = q * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
  if (!R.quadIndex) R.quadIndex = gl.createBuffer();
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.quadIndex);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  R.quadCap = cap;
}
function uploadPart(part, buf) {
  const gl = R.gl;
  if (!buf.quads) { if (part) { gl.deleteBuffer(part.vbo); gl.deleteVertexArray(part.vao); } return null; }
  ensureQuadIndex(buf.quads);
  if (!part) {
    part = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), quads: 0 };
    gl.bindVertexArray(part.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, part.vbo);
    setupMainAttribs(gl);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.quadIndex);
  } else {
    gl.bindVertexArray(part.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, part.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.quadIndex);
  }
  gl.bufferData(gl.ARRAY_BUFFER, buf.a.subarray(0, buf.n), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  part.quads = buf.quads;
  return part;
}
function uploadChunkMesh(c, m) {
  const old = c.mesh || {};
  c.mesh = { opaque: uploadPart(old.opaque, m.opaque), cutout: uploadPart(old.cutout, m.cutout), water: uploadPart(old.water, m.water) };
}
function freeChunkMesh(c) {
  if (!c.mesh) return;
  const gl = R.gl;
  for (const k of ['opaque', 'cutout', 'water']) { const p = c.mesh[k]; if (p) { gl.deleteBuffer(p.vbo); gl.deleteVertexArray(p.vao); } }
  c.mesh = null;
}

// Anisotropic filtering lives on a separate sampler object (texture unit 3) so the regular
// sampler keeps nearest magnification — many drivers blur pixel art when aniso is on.
function setAniso(n) {
  const gl = R.gl; if (!gl || !R.tex) return;
  R.anisoOn = false;
  if (!R.aniso || n <= 1) return;
  if (!R.anisoSampler) {
    const s = R.anisoSampler = gl.createSampler();
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
  const max = gl.getParameter(R.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
  gl.samplerParameterf(R.anisoSampler, R.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(max, n));
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, R.tex); gl.bindSampler(3, R.anisoSampler);
  gl.activeTexture(gl.TEXTURE0);
  R.anisoOn = true;
}

/* ---- post-processing (Good / Heavenly): bloom, sun rays, colour grading ---- */
const VS_POST = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUV; void main(){ vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
const FS_BRIGHT = `#version 300 es
precision mediump float; uniform sampler2D uSrc; uniform float uThresh; in vec2 vUV; out vec4 o;
void main(){ vec3 c = texture(uSrc, vUV).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(uThresh, uThresh + 0.3, l), 1.0); }`;
const FS_BLUR = `#version 300 es
precision mediump float; uniform sampler2D uSrc; uniform vec2 uDir; in vec2 vUV; out vec4 o;
void main(){
  vec3 s = texture(uSrc, vUV).rgb * 0.227027;
  s += (texture(uSrc, vUV + uDir * 1.3846).rgb + texture(uSrc, vUV - uDir * 1.3846).rgb) * 0.3162162;
  s += (texture(uSrc, vUV + uDir * 3.2308).rgb + texture(uSrc, vUV - uDir * 3.2308).rgb) * 0.0702703;
  o = vec4(s, 1.0); }`;
const FS_RAYSRC = `#version 300 es
precision highp float; uniform sampler2D uScene; uniform sampler2D uDepth; uniform vec2 uSun; uniform float uAspect; in vec2 vUV; out vec4 o;
void main(){
  float sky = texture(uDepth, vUV).r >= 0.99999 ? 1.0 : 0.0;
  vec3 c = texture(uScene, vUV).rgb; vec2 q = vUV - uSun; q.x *= uAspect;
  o = vec4(c * sky * (0.1 + exp(-dot(q, q) * 9.0) * 1.4), 1.0); }`;
const FS_RAYS = `#version 300 es
precision mediump float; uniform sampler2D uSrc; uniform vec2 uSun; in vec2 vUV; out vec4 o;
void main(){
  vec2 dl = (vUV - uSun) / 44.0 * 0.96; vec2 uv = vUV; vec3 acc = vec3(0.0); float w = 1.0, tw = 0.0;
  for (int i = 0; i < 44; i++) { acc += texture(uSrc, uv).rgb * w; tw += w; w *= 0.955; uv -= dl; }
  o = vec4(acc / tw, 1.0); }`;
const FS_COMP = `#version 300 es
precision mediump float; uniform sampler2D uScene; uniform sampler2D uBloom; uniform sampler2D uRays;
uniform float uBloomStr; uniform float uRayStr; uniform vec3 uRayTint; uniform float uSat; uniform float uContrast; in vec2 vUV; out vec4 o;
void main(){
  vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * uBloomStr + texture(uRays, vUV).rgb * uRayStr * uRayTint;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c = c / (1.0 + max(vec3(0.0), c - 1.0));
  vec2 q = vUV - 0.5; c *= 1.0 - dot(q, q) * 0.32;
  o = vec4(c, 1.0); }`;
function initPost() {
  const gl = R.gl;
  const P = R.postProg = {
    bright: compile(gl, VS_POST, FS_BRIGHT), blur: compile(gl, VS_POST, FS_BLUR), raysrc: compile(gl, VS_POST, FS_RAYSRC),
    rays: compile(gl, VS_POST, FS_RAYS), comp: compile(gl, VS_POST, FS_COMP),
  };
  R.postU = {
    bright: uniforms(gl, P.bright, ['uSrc', 'uThresh']), blur: uniforms(gl, P.blur, ['uSrc', 'uDir']),
    raysrc: uniforms(gl, P.raysrc, ['uScene', 'uDepth', 'uSun', 'uAspect']), rays: uniforms(gl, P.rays, ['uSrc', 'uSun']),
    comp: uniforms(gl, P.comp, ['uScene', 'uBloom', 'uRays', 'uBloomStr', 'uRayStr', 'uRayTint', 'uSat', 'uContrast']),
  };
  R.postOK = true;
}
function makeTarget(w, h, withDepth) {
  const gl = R.gl, t = { w, h, tex: gl.createTexture(), fb: gl.createFramebuffer() };
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  if (withDepth) {
    t.depth = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t.depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depth, 0);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) R.postOK = false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return t;
}
function freeTarget(t) { const gl = R.gl; if (!t) return; gl.deleteTexture(t.tex); if (t.depth) gl.deleteTexture(t.depth); gl.deleteFramebuffer(t.fb); }
function ensurePost(w, h) {
  if (R.post && R.post.w === w && R.post.h === h) return;
  if (R.post) for (const k of ['scene', 'a', 'b', 'r1', 'r2']) freeTarget(R.post[k]);
  const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
  R.post = { w, h, scene: makeTarget(w, h, true), a: makeTarget(hw, hh), b: makeTarget(hw, hh), r1: makeTarget(hw, hh), r2: makeTarget(hw, hh), rayStr: 0 };
}
function postPass(prog, target, setup) {
  const gl = R.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
  gl.viewport(0, 0, target ? target.w : R.canvas.width, target ? target.h : R.canvas.height);
  gl.useProgram(prog); setup();
  gl.bindVertexArray(R.skyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function bindTex(unit, tex, loc) { const gl = R.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }
// sun rays: extract open sky around the sun from the scene (before the hand is drawn), then blur it radially
function postRays(sunUV, strength) {
  const gl = R.gl, P = R.post, U = R.postU;
  P.rayStr = strength;
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  if (strength > 0.01) {
    postPass(R.postProg.raysrc, P.r1, () => { bindTex(0, P.scene.tex, U.raysrc.uScene); bindTex(1, P.scene.depth, U.raysrc.uDepth); gl.uniform2f(U.raysrc.uSun, sunUV[0], sunUV[1]); gl.uniform1f(U.raysrc.uAspect, P.w / P.h); });
    postPass(R.postProg.rays, P.r2, () => { bindTex(0, P.r1.tex, U.rays.uSrc); gl.uniform2f(U.rays.uSun, sunUV[0], sunUV[1]); });
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, P.scene.fb); gl.viewport(0, 0, P.w, P.h);
  gl.enable(gl.DEPTH_TEST);
  for (let u = 1; u >= 0; u--) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, R.tex);
}
function postComposite(heavenly, tint) {
  const gl = R.gl, P = R.post, U = R.postU;
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  postPass(R.postProg.bright, P.a, () => { bindTex(0, P.scene.tex, U.bright.uSrc); gl.uniform1f(U.bright.uThresh, heavenly ? 0.76 : 0.82); });
  for (let k = 0; k < (heavenly ? 2 : 1); k++) {
    postPass(R.postProg.blur, P.b, () => { bindTex(0, P.a.tex, U.blur.uSrc); gl.uniform2f(U.blur.uDir, (1 + k) / P.a.w, 0); });
    postPass(R.postProg.blur, P.a, () => { bindTex(0, P.b.tex, U.blur.uSrc); gl.uniform2f(U.blur.uDir, 0, (1 + k) / P.a.h); });
  }
  postPass(R.postProg.comp, null, () => {
    bindTex(0, P.scene.tex, U.comp.uScene); bindTex(1, P.a.tex, U.comp.uBloom); bindTex(2, P.r2.tex, U.comp.uRays);
    gl.uniform1f(U.comp.uBloomStr, heavenly ? 0.62 : 0.45); gl.uniform1f(U.comp.uRayStr, heavenly ? P.rayStr : 0);
    gl.uniform3fv(U.comp.uRayTint, tint || [1, 0.9, 0.75]);
    gl.uniform1f(U.comp.uSat, heavenly ? 1.16 : 1.08); gl.uniform1f(U.comp.uContrast, heavenly ? 1.07 : 1.04);
  });
  gl.enable(gl.DEPTH_TEST);
  for (let u = 2; u >= 0; u--) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, R.tex);
}

// ---- clouds: tileable cell grid, meshed once ----
const CLOUD_CELLS = 48, CLOUD_SIZE = 12, CLOUD_Y = 142, CLOUD_H = 4;
function buildClouds() {
  const N = CLOUD_CELLS, g = new Uint8Array(N * N), rnd = mulberry32(99);
  const v = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) v[i] = rnd();
  // blur with wrap for blobby shapes
  for (let pass = 0; pass < 3; pass++) {
    const nv = new Float32Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) s += v[((x + dx + N) % N) + ((z + dz + N) % N) * N];
      nv[x + z * N] = s / 9;
    }
    v.set(nv);
  }
  const sorted = Array.from(v).sort(); const th = sorted[(N * N * 0.66) | 0];
  for (let i = 0; i < N * N; i++) g[i] = v[i] > th ? 1 : 0;
  const buf = new VBuf(36 * 4096);
  const S = CLOUD_SIZE, at = (x, z) => g[((x + N) % N) + ((z + N) % N) * N];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (!g[x + z * N]) continue;
    const x0 = x * S, z0 = z * S;
    const faces = [!at(x + 1, z), !at(x - 1, z), true, true, !at(x, z + 1), !at(x, z - 1)];
    for (let f = 0; f < 6; f++) {
      if (!faces[f]) continue;
      const F = FACES[f];
      buf.grow(36);
      for (let k = 0; k < 4; k++) {
        const C = F.corners[k];
        buf.v(x0 + C.p[0] * S, C.p[1] * CLOUD_H, z0 + C.p[2] * S, 0.5, 0.5, TEX_WHITE, F.shade === 0.5 ? 0.72 : F.shade, 1, 0);
      }
      buf.quads++;
    }
  }
  const part = uploadPart(null, buf);
  return part;
}

// ---- dynamic geometry helpers ----
function flushDyn() {
  const gl = R.gl, d = R.dyn;
  if (!d.quads) return;
  ensureQuadIndex(d.quads);
  gl.bindVertexArray(R.dynVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, R.dynBuf);
  if (d.n > R.dynCap) { gl.bufferData(gl.ARRAY_BUFFER, d.a.byteLength, gl.DYNAMIC_DRAW); R.dynCap = d.a.length; }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.a.subarray(0, d.n));
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, R.quadIndex);
  gl.drawElements(gl.TRIANGLES, d.quads * 6, gl.UNSIGNED_INT, 0);
  d.reset();
}

// ---- item mesh templates (blocks as cubes, sprites extruded) ----
const ItemMesh = new Map();
// 16px tile -> 32px: Scale2x keeps hand-drawn shapes crisp but rounds their stair-steps, then every texel is
// shaded a little towards its neighbours and given fine grain so surfaces read as material instead of flat squares
const TILE = 32;
function hdTile(src, so, dst, doff, salt) {
  const px = (x, y) => so + (((y + 16) & 15) * 16 + ((x + 16) & 15)) * 4;
  const same = (a, b) => src[a] === src[b] && src[a + 1] === src[b + 1] && src[a + 2] === src[b + 2] && src[a + 3] === src[b + 3];
  let cut = false; for (let i = 3; i < 1024; i += 4) if (src[so + i] < 255) { cut = true; break; }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const P = px(x, y), A = px(x, y - 1), Bq = px(x + 1, y), C = px(x - 1, y), D = px(x, y + 1);
    const pick = [
      same(C, A) && !same(C, D) && !same(A, Bq) ? A : P, same(A, Bq) && !same(A, C) && !same(Bq, D) ? Bq : P,
      same(D, C) && !same(D, Bq) && !same(C, A) ? C : P, same(Bq, D) && !same(Bq, A) && !same(D, C) ? D : P];
    for (let k = 0; k < 4; k++) {
      const sx = k & 1, sy = k >> 1, s = pick[k], d = doff + ((y * 2 + sy) * TILE + x * 2 + sx) * 4;
      let r = src[s], g = src[s + 1], b = src[s + 2]; const a = src[s + 3];
      if (a === 255 && s === P) {
        const H = sx ? Bq : C, V = sy ? D : A, wh = src[H + 3] === 255 ? 0.17 : 0, wv = src[V + 3] === 255 ? 0.17 : 0;
        r = r * (1 - wh - wv) + src[H] * wh + src[V] * wv; g = g * (1 - wh - wv) + src[H + 1] * wh + src[V + 1] * wv; b = b * (1 - wh - wv) + src[H + 2] * wh + src[V + 2] * wv;
        if (!cut) { const n = 1 + (ihash(x * 2 + sx, y * 2 + sy, salt * 131 + 5) - 0.5) * 0.07 + (sx + sy === 0 ? 0.012 : sx + sy === 2 ? -0.012 : 0); r *= n; g *= n; b *= n; }
      }
      dst[d] = r > 255 ? 255 : r; dst[d + 1] = g > 255 ? 255 : g; dst[d + 2] = b > 255 ? 255 : b; dst[d + 3] = a;
    }
  }
}
function tileAlpha(layer, x, y) { return R.tileData[(layer * 256 + y * 16 + x) * 4 + 3]; }
function itemTemplate(id) {
  if (ItemMesh.has(id)) return ItemMesh.get(id);
  const def = ITEMS[id];
  const buf = new VBuf(36 * 64);
  let kind;
  if (def.block && RTYPE[def.block] === RT_CUBE) {
    kind = 'cube';
    emitBox(buf, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, FACE_TEX[def.block], [0, 0, 1, 1], 1, 1, 0, 0, null);
  } else {
    kind = 'sprite';
    const layer = def.block ? FACE_TEX[def.block][0] : TEX[def.icon];
    const th = 1 / 16, hz = 0.5 / 16;
    // front & back
    for (const [z, flip] of [[hz, false], [-hz, true]]) {
      buf.grow(36);
      const pts = flip ? [[0.5, -0.5], [-0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] : [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      for (const [x, y] of pts) buf.v(x, y, z, x + 0.5, 0.5 - y, layer, flip ? 0.8 : 1, 1, 0);
      buf.quads++;
    }
    // edges
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
      if (tileAlpha(layer, px, py) < 128) continue;
      const u = (px + 0.5) / 16, v = (py + 0.5) / 16;
      const x0 = px / 16 - 0.5, x1 = (px + 1) / 16 - 0.5, y1 = 0.5 - py / 16, y0 = 0.5 - (py + 1) / 16;
      const edge = (nx, ny) => nx < 0 || ny < 0 || nx > 15 || ny > 15 || tileAlpha(layer, nx, ny) < 128;
      const q = (a, b, c, d, sh) => { buf.grow(36); for (const p of [a, b, c, d]) buf.v(p[0], p[1], p[2], u, v, layer, sh, 1, 0); buf.quads++; };
      if (edge(px - 1, py)) q([x0, y0, -hz], [x0, y0, hz], [x0, y1, hz], [x0, y1, -hz], 0.7);
      if (edge(px + 1, py)) q([x1, y0, hz], [x1, y0, -hz], [x1, y1, -hz], [x1, y1, hz], 0.7);
      if (edge(px, py - 1)) q([x0, y1, hz], [x1, y1, hz], [x1, y1, -hz], [x0, y1, -hz], 0.95);
      if (edge(px, py + 1)) q([x0, y0, -hz], [x1, y0, -hz], [x1, y0, hz], [x0, y0, hz], 0.55);
    }
  }
  const t = { kind, a: buf.a.slice(0, buf.n), n: buf.n, quads: buf.quads };
  ItemMesh.set(id, t);
  return t;
}
// append template transformed by 4x4 matrix into dyn buffer
function pushTemplate(t, m, sky, blk, extraFlags) {
  const d = R.dyn, a = t.a;
  d.grow(t.n);
  for (let i = 0; i < t.n; i += 9) {
    const x = a[i], y = a[i + 1], z = a[i + 2];
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    d.v(wx, wy, wz, a[i + 3], a[i + 4], a[i + 5], a[i + 6] + (extraFlags || 0), sky, blk);
  }
  d.quads += t.quads;
}

function boxLines(x0, y0, z0, x1, y1, z1) {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  const out = new Float32Array(72);
  e.forEach((k, i) => out.set(p[k], i * 3));
  return out;
}

// frustum planes from VP
function frustumPlanes(m) {
  const p = [];
  const r = (a, b, c, d) => { const l = Math.hypot(a, b, c); p.push([a / l, b / l, c / l, d / l]); };
  r(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  r(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  r(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  r(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  r(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  return p;
}
function boxVisible(planes, x0, y0, z0, x1, y1, z1) {
  for (const [a, b, c, d] of planes) {
    const px = a > 0 ? x1 : x0, py = b > 0 ? y1 : y0, pz = c > 0 ? z1 : z0;
    if (a * px + b * py + c * pz + d < 0) return false;
  }
  return true;
}

// ---- environment colours from time of day ----
function skyState(t, rain, flash) {
  rain = rain || 0; flash = flash || 0;
  // t in [0,1): 0 sunrise, .25 noon, .5 sunset, .75 midnight
  const a = t * Math.PI * 2;
  const sun = [Math.cos(a), Math.sin(a), 0.28];
  const l = Math.hypot(...sun); sun[0] /= l; sun[1] /= l; sun[2] /= l;
  const el = sun[1];
  const day = smoothstep(-0.18, 0.22, el);
  const sunset = Math.exp(-Math.pow(el / 0.2, 2)) ;
  const zenDay = [0.40, 0.62, 1.0], horDay = [0.70, 0.83, 1.0];
  const zenNight = [0.02, 0.03, 0.08], horNight = [0.06, 0.08, 0.16];
  const horSet = [1.0, 0.52, 0.28], zenSet = [0.32, 0.30, 0.56];
  let zen = mix3(zenNight, zenDay, day), hor = mix3(horNight, horDay, day);
  zen = mix3(zen, zenSet, sunset * 0.7);
  hor = mix3(hor, horSet, sunset * 0.9);
  const glow = [1.0, 0.62, 0.3];
  const dayLight = lerp(0.3, 1.0, day);
  const sunCol = mix3([0.55, 0.66, 1.0], mix3([1, 1, 1], [1.0, 0.8, 0.62], sunset * 0.8), day);
  let fog = mix3(hor, zen, 0.06);
  let dl = dayLight, sc = sunCol;
  if (rain > 0) {
    const grey = [0.46 * (0.15 + day * 0.85), 0.49 * (0.15 + day * 0.85), 0.54 * (0.18 + day * 0.82)];
    zen = mix3(zen, grey.map(v => v * 0.85), rain * 0.8); hor = mix3(hor, grey, rain * 0.75); fog = mix3(fog, grey, rain * 0.8);
    dl = dayLight * (1 - 0.32 * rain); sc = mix3(sunCol, [0.82, 0.86, 0.95], rain * 0.7);
  }
  if (flash > 0) { dl = Math.min(1.4, dl + flash * 0.9); zen = mix3(zen, [0.8, 0.82, 0.95], flash * 0.6); hor = mix3(hor, [0.85, 0.87, 0.97], flash * 0.6); }
  return { sun, day, sunset: sunset * (1 - rain * 0.8), zen, hor, glow, dayLight: dl, sunCol: sc, fog, night: 1 - day, rain };
}
