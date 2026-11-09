// WebGL renderer for deformed part meshes. Premultiplied alpha; clipping masks
// (irises inside eye whites) use the stencil buffer.

const VS = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform vec4 uView;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos * uView.xy + uView.zw, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uOpacity;
uniform float uAlphaTest;
varying vec2 vUV;
void main() {
  vec4 c = texture2D(uTex, vUV);
  if (c.a <= uAlphaTest) discard;
  gl_FragColor = c * uOpacity;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { alpha: true, premultipliedAlpha: true, stencil: true, antialias: true, preserveDrawingBuffer: true };
    const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    if (!gl) throw new Error('This browser does not support WebGL');
    this.gl = gl;
    // WebGL 2 can make mipmaps for textures of any size. A 2000 px model shown as a 300 px pet is drawn several
    // times smaller than its artwork, and without them thin lines shimmer as it moves.
    this.mips = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this.items = new Map();
    this.model = null;
    // The context can be lost (the display sleeps, the graphics card switches) and everything made in it goes
    // with it. Asking to keep the canvas lets the browser give the context back; the program and the model's
    // textures and meshes are then made again.
    this.lost = gl.isContextLost();
    this.onLost = e => { e.preventDefault(); this.lost = true; };
    this.onRestored = () => {
      this.lost = false;
      this.items.clear(); // what was in it is gone with the old context
      this.init();
      if (this.model) this.load(this.model);
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    if (!this.lost) this.init();
  }

  // Stops watching the canvas, for when another renderer takes it over (the context itself is the canvas's).
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
  }

  init() {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.loc = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      aUV: gl.getAttribLocation(prog, 'aUV'),
      uView: gl.getUniformLocation(prog, 'uView'),
      uTex: gl.getUniformLocation(prog, 'uTex'),
      uOpacity: gl.getUniformLocation(prog, 'uOpacity'),
      uAlphaTest: gl.getUniformLocation(prog, 'uAlphaTest'),
    };
  }

  load(model) {
    const gl = this.gl;
    this.model = model;
    if (this.lost) return; // loaded when the context comes back
    for (const it of this.items.values()) {
      gl.deleteTexture(it.tex);
      gl.deleteBuffer(it.pos);
      gl.deleteBuffer(it.uv);
      gl.deleteBuffer(it.idx);
    }
    this.items.clear();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const p of model.parts) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, p.canvas);
      if (this.mips) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const pos = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pos);
      gl.bufferData(gl.ARRAY_BUFFER, p.mesh.pos, gl.DYNAMIC_DRAW);
      const uv = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uv);
      gl.bufferData(gl.ARRAY_BUFFER, p.mesh.uv, gl.STATIC_DRAW);
      const idx = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.mesh.idx, gl.STATIC_DRAW);
      this.items.set(p, { tex, pos, uv, idx, count: p.mesh.idx.length });
    }
  }

  resize() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  // view maps model pixels to CSS pixels: css = pos * scale + (ox, oy)
  render(model, view) {
    const gl = this.gl, c = this.canvas;
    if (this.lost) return;
    const cw = c.clientWidth || 1, ch = c.clientHeight || 1;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform4f(this.loc.uView, (2 * view.scale) / cw, (-2 * view.scale) / ch, (2 * view.ox) / cw - 1, 1 - (2 * view.oy) / ch);
    gl.uniform1i(this.loc.uTex, 0);
    for (const p of model.parts) {
      if (!p.visible || p._op <= 0.002) continue;
      const mask = p.clip && model._byId?.get(p.clip);
      if (mask) {
        gl.enable(gl.STENCIL_TEST);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        this.draw(mask, 1, 0.1);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.EQUAL, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        this.draw(p, p._op, 0);
        gl.disable(gl.STENCIL_TEST);
      } else {
        this.draw(p, p._op, 0);
      }
    }
  }

  draw(p, opacity, alphaTest) {
    const gl = this.gl, it = this.items.get(p), L = this.loc;
    if (!it) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, it.pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, p._out);
    gl.enableVertexAttribArray(L.aPos);
    gl.vertexAttribPointer(L.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, it.uv);
    gl.enableVertexAttribArray(L.aUV);
    gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.idx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, it.tex);
    gl.uniform1f(L.uOpacity, opacity);
    gl.uniform1f(L.uAlphaTest, alphaTest);
    gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_SHORT, 0);
  }
}
