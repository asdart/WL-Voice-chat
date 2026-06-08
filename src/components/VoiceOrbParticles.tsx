"use client";

import { useEffect, useRef } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type Speaker = "idle" | "user" | "ai";

export interface VoiceOrbParticlesProps {
  /** Who is currently talking. Drives the color of the orb. */
  speaker?: Speaker;
  /** User microphone stream. Amplitude is read from this when speaker === "user". */
  userStream?: MediaStream | null;
  /** AI TTS output as a MediaStream. Read when speaker === "ai". */
  aiStream?: MediaStream | null;
  /** Alternative AI source: an <audio> element playing the TTS. Read when speaker === "ai". */
  aiAudioElement?: HTMLAudioElement | null;
  /** Manual amplitude override (0..1). Used instead of reading the streams. */
  level?: number;
  /** Color when the user is talking. Default: sunshine. */
  userColor?: string;
  /** Color when the AI is talking. Default: Kodara green. */
  aiColor?: string;
  /** Color while idle. Defaults to aiColor. */
  idleColor?: string;
  /**
   * Backdrop the orb sits on. "light" draws particles with normal alpha (for
   * light backgrounds); "dark" uses additive blending for a glowing look.
   */
  surface?: "light" | "dark";
  /** Rendered size in px (square). Default 320. */
  size?: number;
  /** Number of particles. Default 560. */
  count?: number;
  className?: string;
  style?: React.CSSProperties;
}

/* -------------------------------------------------------------------------- */
/*  Color helpers — build a 4-stop ramp (deep → brand → mint → highlight)     */
/* -------------------------------------------------------------------------- */

type RGB = [number, number, number];
interface Ramp { deep: RGB; brand: RGB; mint: RGB; hi: RGB; }

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
function buildRamp(hex: string): Ramp {
  const rgb = hexToRgb(hex);
  const [h, s] = rgbToHsl(rgb);
  return {
    deep: hslToRgb(h, Math.min(s, 1), 0.17),
    brand: rgb,
    mint: hslToRgb(h, Math.min(s * 0.75, 1), 0.78),
    hi: hslToRgb(h, Math.min(s * 0.5, 1), 0.96),
  };
}
function cloneRamp(r: Ramp): Ramp {
  return {
    deep: [...r.deep] as RGB, brand: [...r.brand] as RGB,
    mint: [...r.mint] as RGB, hi: [...r.hi] as RGB,
  };
}
function lerpRamp(cur: Ramp, tgt: Ramp, k: number) {
  (["deep", "brand", "mint", "hi"] as const).forEach((key) => {
    for (let i = 0; i < 3; i++) cur[key][i] += (tgt[key][i] - cur[key][i]) * k;
  });
}
function mix3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

interface Particle { x: number; y: number; z: number; seed: number; }

/* createMediaElementSource may only be called once per element — cache it. */
const elementSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function VoiceOrbParticles({
  speaker = "idle",
  userStream = null,
  aiStream = null,
  aiAudioElement = null,
  level,
  userColor = "#FFC53D",
  aiColor = "#106844",
  idleColor,
  surface = "light",
  size = 320,
  count = 560,
  className,
  style,
}: VoiceOrbParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // latest props mirrored into refs so the loop never needs to restart
  const speakerRef = useRef(speaker);
  const levelRef = useRef(level);
  const surfaceRef = useRef(surface);
  const sizeRef = useRef(size);

  const userRamp = useRef(buildRamp(userColor));
  const aiRamp = useRef(buildRamp(aiColor));
  const idleRamp = useRef(buildRamp(idleColor ?? aiColor));

  // mirror latest props into refs so the render loop never needs to restart
  useEffect(() => {
    speakerRef.current = speaker;
    levelRef.current = level;
    surfaceRef.current = surface;
    sizeRef.current = size;
    userRamp.current = buildRamp(userColor);
    aiRamp.current = buildRamp(aiColor);
    idleRamp.current = buildRamp(idleColor ?? aiColor);
  });

  // audio analysers
  const audioCtxRef = useRef<AudioContext | null>(null);
  const userAnalyser = useRef<AnalyserNode | null>(null);
  const userBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const aiAnalyser = useRef<AnalyserNode | null>(null);
  const aiBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);

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

  /* ---- attach user mic ---- */
  useEffect(() => {
    if (!userStream) return;
    const ctx = ensureCtx();
    const src = ctx.createMediaStreamSource(userStream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.78;
    src.connect(an);
    userAnalyser.current = an;
    userBuf.current = new Uint8Array(an.fftSize);
    return () => {
      try { src.disconnect(); an.disconnect(); } catch { /* noop */ }
      userAnalyser.current = null;
      userBuf.current = null;
    };
  }, [userStream]);

  /* ---- attach AI stream ---- */
  useEffect(() => {
    if (!aiStream) return;
    const ctx = ensureCtx();
    const src = ctx.createMediaStreamSource(aiStream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.78;
    src.connect(an);
    aiAnalyser.current = an;
    aiBuf.current = new Uint8Array(an.fftSize);
    return () => {
      try { src.disconnect(); an.disconnect(); } catch { /* noop */ }
      aiAnalyser.current = null;
      aiBuf.current = null;
    };
  }, [aiStream]);

  /* ---- attach AI <audio> element ---- */
  useEffect(() => {
    if (!aiAudioElement) return;
    const ctx = ensureCtx();
    let src = elementSourceCache.get(aiAudioElement);
    if (!src) {
      src = ctx.createMediaElementSource(aiAudioElement);
      elementSourceCache.set(aiAudioElement, src);
    }
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.78;
    src.connect(an);
    src.connect(ctx.destination); // keep the audio audible
    aiAnalyser.current = an;
    aiBuf.current = new Uint8Array(an.fftSize);
    return () => {
      try { an.disconnect(); } catch { /* noop */ }
      aiAnalyser.current = null;
      aiBuf.current = null;
    };
  }, [aiAudioElement]);

  /* ---- generate particles when count changes ---- */
  const particlesRef = useRef<Particle[]>([]);
  useEffect(() => {
    const arr: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(1 - u * u);
      const shell = 0.6 + Math.random() * 0.4;
      arr.push({
        x: rad * Math.cos(th) * shell,
        y: u * shell,
        z: rad * Math.sin(th) * shell,
        seed: Math.random() * 1000,
      });
    }
    particlesRef.current = arr;
  }, [count]);

  /* ---- render loop ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cur = cloneRamp(idleRamp.current);
    let smoothLevel = 0;
    let ay = 0;
    let last = performance.now();
    let raf = 0;

    const readRMS = (an: AnalyserNode, b: Uint8Array<ArrayBuffer>) => {
      an.getByteTimeDomainData(b);
      let sum = 0;
      for (let i = 0; i < b.length; i++) { const v = (b[i] - 128) / 128; sum += v * v; }
      return Math.min(Math.sqrt(sum / b.length) * 4.2, 1);
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = now / 1000;
      const sp = speakerRef.current;

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
      const lvl = smoothLevel;

      // color crossfade
      const tgt = sp === "user" ? userRamp.current : sp === "ai" ? aiRamp.current : idleRamp.current;
      lerpRamp(cur, tgt, 0.06);

      // canvas sizing (handles size prop + DPR)
      const cssSize = sizeRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const dev = Math.round(cssSize * dpr);
      if (canvas.width !== dev) { canvas.width = dev; canvas.height = dev; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssSize, cssSize);
      ctx.globalCompositeOperation = surfaceRef.current === "dark" ? "lighter" : "source-over";

      const C = cssSize / 2;
      const ORB = cssSize * 0.2875;
      const sizeScale = cssSize / 160;

      // rotation accelerates with voice
      ay += dt * (0.12 + lvl * 1.2);
      const ca = Math.cos(ay), sa = Math.sin(ay);
      const amp = 1 + lvl * 0.18;       // gentle outward burst
      const jit = lvl * 0.13 * ORB;     // syllable jitter
      const small = 1 - lvl * 0.4;      // particles shrink when talking

      const parts = particlesRef.current;
      const proj: { sx: number; sy: number; rz: number; ry: number }[] = [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const rx = p.x * ca - p.z * sa;
        const rz = p.x * sa + p.z * ca;
        const ry = p.y;
        const persp = 1 + rz * 0.35;
        const sx = C + rx * ORB * persp * amp + Math.sin(t * 3.0 + p.seed) * jit;
        const sy = C + ry * ORB * persp * amp + Math.cos(t * 2.6 + p.seed * 1.3) * jit;
        proj.push({ sx, sy, rz, ry });
      }
      proj.sort((a, b) => a.rz - b.rz); // depth: back to front

      for (let k = 0; k < proj.length; k++) {
        const q = proj[k];
        const vt = (q.ry + 1) * 0.5;
        let c = vt < 0.5 ? mix3(cur.deep, cur.brand, vt * 2) : mix3(cur.brand, cur.mint, (vt - 0.5) * 2);
        c = mix3(c, cur.hi, lvl * 0.4 * vt);
        const al = Math.min((0.22 + (q.rz + 1) * 0.25) * (0.7 + lvl * 0.3), 0.9);
        const sz = Math.max((0.7 + (q.rz + 1) * 0.45) * small * sizeScale, 0.35);
        ctx.globalAlpha = al;
        ctx.fillStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;
        ctx.beginPath();
        ctx.arc(q.sx, q.sy, sz, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---- close the audio context on unmount ---- */
  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        void audioCtxRef.current.close();
      }
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
