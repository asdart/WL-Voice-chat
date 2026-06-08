"use client";

import { useEffect, useRef } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type Speaker = "idle" | "user" | "ai";

export interface VoiceOrbMeshProps {
  /** Who is currently talking. Drives the color palette. */
  speaker?: Speaker;
  /** User microphone stream. Read when speaker === "user". */
  userStream?: MediaStream | null;
  /** AI TTS output as a MediaStream. Read when speaker === "ai". */
  aiStream?: MediaStream | null;
  /** Alternative AI source: an <audio> element playing TTS. */
  aiAudioElement?: HTMLAudioElement | null;
  /** Manual amplitude override (0..1). Bypasses stream analysers. */
  level?: number;
  /**
   * 5-stop palette for the AI talking state, ordered top → bottom.
   * Each entry is a CSS hex color string.
   * Defaults to the crafted green / blue / mint / yellow / cream palette.
   */
  aiPalette?: [string, string, string, string, string];
  /**
   * 5-stop palette for the user talking state, ordered top → bottom.
   * Defaults to the crafted coral / orange / peach / amber palette.
   */
  userPalette?: [string, string, string, string, string];
  /**
   * Palette while idle. Defaults to aiPalette.
   */
  idlePalette?: [string, string, string, string, string];
  /**
   * Backdrop the orb sits on.
   * "light" — normal alpha blending (default, for light page backgrounds).
   * "dark"  — additive blending so the gradient glows on dark backgrounds.
   */
  surface?: "light" | "dark";
  /** Canvas size in px (square). Default 320. */
  size?: number;
  /** Film grain intensity multiplier (0 = off, 1 = default, >1 = grittier). Default 1. */
  grain?: number;
  /** Animation speed multiplier (1 = default). */
  speed?: number;
  /** Warp displacement multiplier (1 = default, higher = more distorted smoke). */
  warp?: number;
  className?: string;
  style?: React.CSSProperties;
}

/* -------------------------------------------------------------------------- */
/*  Default palettes                                                           */
/* -------------------------------------------------------------------------- */

const DEFAULT_AI_PALETTE: [string, string, string, string, string] = [
  "#106844", // deep green    (top)
  "#7DB0DE", // blue
  "#9EDBB8", // mint
  "#F7E8A8", // light yellow
  "#EDF2E8", // cream         (bottom)
];

const DEFAULT_USER_PALETTE: [string, string, string, string, string] = [
  "#EF5A47", // coral red     (top)
  "#F47341", // red-orange
  "#F8A36B", // peach-light
  "#FAA34A", // orange
  "#FCBA54", // amber gold    (bottom)
];

/* -------------------------------------------------------------------------- */
/*  Color helpers                                                              */
/* -------------------------------------------------------------------------- */

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type Palette = [RGB, RGB, RGB, RGB, RGB];

function parsePalette(hexes: [string, string, string, string, string]): Palette {
  return hexes.map(hexToRgb) as Palette;
}

function clonePalette(p: Palette): Palette {
  return p.map((c) => [...c] as RGB) as Palette;
}

function lerpPalette(cur: Palette, tgt: Palette, k: number) {
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 3; j++)
      cur[i][j] += (tgt[i][j] - cur[i][j]) * k;
}

/* -------------------------------------------------------------------------- */
/*  Shaders                                                                   */
/* -------------------------------------------------------------------------- */

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_flow;
uniform float u_seed;
uniform float u_level;
uniform float u_grain;
uniform float u_warp;
uniform vec3  u_c0;
uniform vec3  u_c1;
uniform vec3  u_c2;
uniform vec3  u_c3;
uniform vec3  u_c4;

vec3 m289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec2 m289(vec2 x){return x - floor(x*(1.0/289.0))*289.0;}
vec3 prm(vec3 x){return m289(((x*34.0)+1.0)*x);}
float sn(vec2 v){
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i = floor(v+dot(v,C.yy));
  vec2 x0 = v - i + dot(i,C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = m289(i);
  vec3 p = prm(prm(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 mm = max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  mm = mm*mm; mm = mm*mm;
  vec3 x = 2.0*fract(p*C.www)-1.0;
  vec3 h = abs(x)-0.5;
  vec3 ox = floor(x+0.5);
  vec3 a0 = x-ox;
  mm *= 1.79284291400159 - 0.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x  = a0.x *x0.x  + h.x *x0.y;
  g.yz = a0.yz*x12.xz + h.yz*x12.yw;
  return 130.0*dot(mm,g);
}
float fbm(vec2 p){
  float v=0.0; float a=0.5;
  mat2 rt=mat2(0.80,0.60,-0.60,0.80);
  for(int i=0;i<5;i++){ v+=a*sn(p); p=rt*p*2.0; a*=0.5; }
  return v;
}
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res) / min(u_res.x, u_res.y);
  float r = length(uv);
  float radius = 0.47;

  // --- omnidirectional fluid warp (two layers, each drifting a different way) ---
  vec2 q;
  q.x = fbm(uv*1.4 + vec2( u_flow*0.60,  u_flow*0.25));
  q.y = fbm(uv*1.4 + vec2(-u_flow*0.30,  u_flow*0.55) + 2.1);

  vec2 q2;
  q2.x = fbm(uv*2.2 + q*0.8 + vec2( u_flow*0.28, -u_flow*0.42));
  q2.y = fbm(uv*2.2 + q*0.8 + vec2(-u_flow*0.38,  u_flow*0.32) + 4.5);

  float warpAmt = (0.26 + u_level*0.22) * u_warp;
  vec2 suv = uv + q*warpAmt*0.6 + q2*warpAmt*0.4;

  // --- stacked color points (top → bottom) ---
  float ts = u_flow*0.5;
  float dr = 0.05 + u_level*0.03;
  vec2 p0 = vec2( 0.05,  0.42) + dr*vec2(sin(ts*0.70), cos(ts*0.60));
  vec2 p1 = vec2(-0.15,  0.18) + dr*vec2(sin(ts*0.50+1.7), cos(ts*0.80+0.4));
  vec2 p2 = vec2( 0.18, -0.02) + dr*vec2(sin(ts*0.60+3.1), cos(ts*0.50+2.2));
  vec2 p3 = vec2(-0.10, -0.24) + dr*vec2(sin(ts*0.80+0.9), cos(ts*0.70+1.1));
  vec2 p4 = vec2( 0.05, -0.44) + dr*vec2(sin(ts*0.55+4.2), cos(ts*0.65+3.3));

  float sh = 5.0;
  float w0 = exp(-dot(suv-p0,suv-p0)*sh);
  float w1 = exp(-dot(suv-p1,suv-p1)*sh);
  float w2 = exp(-dot(suv-p2,suv-p2)*sh);
  float w3 = exp(-dot(suv-p3,suv-p3)*sh);
  float w4 = exp(-dot(suv-p4,suv-p4)*sh);
  float ws = w0+w1+w2+w3+w4 + 1e-4;
  vec3 col = (u_c0*w0 + u_c1*w1 + u_c2*w2 + u_c3*w3 + u_c4*w4) / ws;

  // --- saturation lift ---
  float lum = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(lum), col, 1.18 + u_level*0.30);
  col += u_level*0.04;

  // --- floating highlight (soft light reflection drifting slowly) ---
  vec2 hPos = vec2(-0.06 + 0.07*sin(u_flow*0.28), 0.14 + 0.06*cos(u_flow*0.35));
  float hl = exp(-dot(uv-hPos,uv-hPos)*22.0) * (0.38 + u_level*0.18);
  col = mix(col, vec3(1.0,0.97,0.93), hl);

  // --- radial depth (subtle edge vignette + centre warmth) ---
  float depth = 1.0 - smoothstep(0.18, 0.47, r)*0.12;
  col *= depth;
  col += exp(-r*r*6.0)*0.04;

  // --- layered grain (animated fine + static micro-texture) ---
  float fine  = (hash(gl_FragCoord.xy + u_seed*137.0) - 0.5) * 0.065;
  float micro = (vnoise(gl_FragCoord.xy*0.9) - 0.5) * 0.042;
  col += (fine + micro) * u_grain;

  // --- hard circular mask ---
  float mask = 1.0 - step(radius, r);
  gl_FragColor = vec4(col, mask);
}
`;

/* createMediaElementSource may only be called once per element — cache it. */
const elementSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function VoiceOrbMesh({
  speaker = "idle",
  userStream = null,
  aiStream = null,
  aiAudioElement = null,
  level,
  aiPalette = DEFAULT_AI_PALETTE,
  userPalette = DEFAULT_USER_PALETTE,
  idlePalette,
  surface = "light",
  size = 320,
  grain = 1,
  speed = 1,
  warp = 1,
  className,
  style,
}: VoiceOrbMeshProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // mirror latest props into refs so the loop never needs to restart
  const speakerRef = useRef(speaker);
  const levelRef   = useRef(level);
  const surfaceRef = useRef(surface);
  const sizeRef    = useRef(size);
  const grainRef   = useRef(grain);
  const speedRef   = useRef(speed);
  const warpRef    = useRef(warp);

  // keep latest palettes in refs so crossfade targets update live
  const aiPaletteRef   = useRef(parsePalette(aiPalette));
  const userPaletteRef = useRef(parsePalette(userPalette));
  const idlePaletteRef = useRef(parsePalette(idlePalette ?? aiPalette));

  // mirror props into refs in an effect (never mutate refs during render)
  useEffect(() => {
    speakerRef.current = speaker;
    levelRef.current   = level;
    surfaceRef.current = surface;
    sizeRef.current    = size;
    grainRef.current   = grain;
    speedRef.current   = speed;
    warpRef.current    = warp;
    aiPaletteRef.current   = parsePalette(aiPalette);
    userPaletteRef.current = parsePalette(userPalette);
    idlePaletteRef.current = parsePalette(idlePalette ?? aiPalette);
  });

  // audio
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const userAnalyser = useRef<AnalyserNode | null>(null);
  const userBuf      = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const aiAnalyser   = useRef<AnalyserNode | null>(null);
  const aiBuf        = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const ensureCtx = () => {
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  useEffect(() => {
    if (!userStream) return;
    const ctx = ensureCtx();
    const src = ctx.createMediaStreamSource(userStream);
    const an  = ctx.createAnalyser();
    an.fftSize = 1024; an.smoothingTimeConstant = 0.78;
    src.connect(an);
    userAnalyser.current = an;
    userBuf.current = new Uint8Array(an.fftSize);
    return () => { try { src.disconnect(); an.disconnect(); } catch { /**/ } userAnalyser.current = null; };
  }, [userStream]);

  useEffect(() => {
    if (!aiStream) return;
    const ctx = ensureCtx();
    const src = ctx.createMediaStreamSource(aiStream);
    const an  = ctx.createAnalyser();
    an.fftSize = 1024; an.smoothingTimeConstant = 0.78;
    src.connect(an);
    aiAnalyser.current = an;
    aiBuf.current = new Uint8Array(an.fftSize);
    return () => { try { src.disconnect(); an.disconnect(); } catch { /**/ } aiAnalyser.current = null; };
  }, [aiStream]);

  useEffect(() => {
    if (!aiAudioElement) return;
    const ctx = ensureCtx();
    let src = elementSourceCache.get(aiAudioElement);
    if (!src) { src = ctx.createMediaElementSource(aiAudioElement); elementSourceCache.set(aiAudioElement, src); }
    const an = ctx.createAnalyser();
    an.fftSize = 1024; an.smoothingTimeConstant = 0.78;
    src.connect(an); src.connect(ctx.destination);
    aiAnalyser.current = an; aiBuf.current = new Uint8Array(an.fftSize);
    return () => { try { an.disconnect(); } catch { /**/ } aiAnalyser.current = null; };
  }, [aiAudioElement]);

  /* ---- WebGL render loop ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: true });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);

    const U = {
      res:   gl.getUniformLocation(prog, "u_res"),
      flow:  gl.getUniformLocation(prog, "u_flow"),
      seed:  gl.getUniformLocation(prog, "u_seed"),
      level: gl.getUniformLocation(prog, "u_level"),
      grain: gl.getUniformLocation(prog, "u_grain"),
      warp:  gl.getUniformLocation(prog, "u_warp"),
      c0:    gl.getUniformLocation(prog, "u_c0"),
      c1:    gl.getUniformLocation(prog, "u_c1"),
      c2:    gl.getUniformLocation(prog, "u_c2"),
      c3:    gl.getUniformLocation(prog, "u_c3"),
      c4:    gl.getUniformLocation(prog, "u_c4"),
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const s   = sizeRef.current;
      const d   = Math.round(s * dpr);
      canvas.width = d; canvas.height = d;
      gl.viewport(0, 0, d, d);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const readRMS = (an: AnalyserNode, b: Uint8Array<ArrayBuffer>) => {
      an.getByteTimeDomainData(b);
      let sum = 0;
      for (let i = 0; i < b.length; i++) { const v = (b[i]-128)/128; sum += v*v; }
      return Math.min(Math.sqrt(sum / b.length) * 4.2, 1);
    };

    const cur = clonePalette(idlePaletteRef.current);
    let smoothLevel = 0;
    let flow = 0;
    let last = performance.now();
    let raf  = 0;

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const sp = speakerRef.current;

      // blend mode
      if (surfaceRef.current === "dark") {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      } else {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }

      // amplitude
      let target = 0;
      if (typeof levelRef.current === "number") {
        target = Math.max(0, Math.min(1, levelRef.current));
      } else if (sp === "user" && userAnalyser.current && userBuf.current) {
        target = readRMS(userAnalyser.current, userBuf.current);
      } else if (sp === "ai" && aiAnalyser.current && aiBuf.current) {
        target = readRMS(aiAnalyser.current, aiBuf.current);
      }
      smoothLevel += (target - smoothLevel) * (target > smoothLevel ? 0.35 : 0.1);

      // palette crossfade
      const tgt = sp === "user" ? userPaletteRef.current
                : sp === "ai"   ? aiPaletteRef.current
                :                 idlePaletteRef.current;
      lerpPalette(cur, tgt, 0.05);

      flow += dt * (0.14 + smoothLevel * 1.2) * speedRef.current;

      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.flow, flow);
      gl.uniform1f(U.seed, Math.random());
      gl.uniform1f(U.level, smoothLevel);
      gl.uniform1f(U.grain, grainRef.current);
      gl.uniform1f(U.warp,  warpRef.current);
      gl.uniform3fv(U.c0, cur[0]);
      gl.uniform3fv(U.c1, cur[1]);
      gl.uniform3fv(U.c2, cur[2]);
      gl.uniform3fv(U.c3, cur[3]);
      gl.uniform3fv(U.c4, cur[4]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed")
        void audioCtxRef.current.close();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, display: "block", ...style }}
    />
  );
}
