/**
 * 효과음. 녹음 파일 없이 WebAudio 로 그 자리에서 만든다(종이 접는 소리, 휙, 톡, 줄자, 도장 쾅 등).
 * - AudioContext 는 사용자가 화면을 누른 순간(unlock)에만 만든다. 스스로 재생을 시작하지 않는다.
 * - 소리를 쓸 수 없는 기기에서는 아무 일도 일어나지 않는다(오류를 삼킨다).
 */
import { loadJson, saveJson, STORAGE_KEYS } from './storage';

export type SoundName = 'tick' | 'fold' | 'snap' | 'nope' | 'whoosh' | 'tap' | 'zip' | 'thunk' | 'pop' | 'cheer';

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let enabled = loadJson(STORAGE_KEYS.sound) !== false;
const listeners = new Set<() => void>();

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on) setWindSound(0);
  saveJson(STORAGE_KEYS.sound, on);
  for (const fn of listeners) fn();
}

export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 사용자의 누름 처리 안에서 불러야 한다. 소리 장치를 준비한다. */
export function unlockSound(): void {
  if (!enabled) return;
  try {
    if (!ctx) {
      const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
      const C = w.AudioContext ?? w.webkitAudioContext;
      if (!C) return;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  // 흰 소음. 소리 재료일 뿐이라 계산 결과와는 무관하다.
  let seed = 22222;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  noise = buf;
  return buf;
}

interface NoiseOpt { type: BiquadFilterType; f0: number; f1: number; q: number; gain: number; dur: number; attack?: number; at?: number }

function playNoise(c: AudioContext, o: NoiseOpt): void {
  const t = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = o.type;
  filter.Q.value = o.q;
  filter.frequency.setValueAtTime(o.f0, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t, (t * 7.13) % 0.5);
  src.stop(t + o.dur + 0.03);
}

interface ToneOpt { type: OscillatorType; f0: number; f1: number; gain: number; dur: number; at?: number }

function playTone(c: AudioContext, o: ToneOpt): void {
  const t = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + o.dur + 0.03);
}

/** 효과음 하나를 낸다. durationS 는 줄자 소리(zip)의 길이. */
export function playSound(name: SoundName, durationS = 1): void {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const c = ctx;
  try {
    switch (name) {
      case 'tick':
        playTone(c, { type: 'triangle', f0: 720, f1: 520, gain: 0.05, dur: 0.05 });
        break;
      case 'fold': // 종이를 눌러 접는 사각 소리
        playNoise(c, { type: 'bandpass', f0: 1800, f1: 5200, q: 0.8, gain: 0.16, dur: 0.16 });
        playNoise(c, { type: 'highpass', f0: 4000, f1: 6000, q: 0.5, gain: 0.06, dur: 0.07, at: 0.11 });
        break;
      case 'snap': // 착 붙는 소리
        // 끄는 동안 맞춤 대상이 바뀔 때마다 나므로 아주 짧고 작게
        playNoise(c, { type: 'highpass', f0: 3200, f1: 3200, q: 0.5, gain: 0.035, dur: 0.022, attack: 0.002 });
        break;
      case 'nope':
        playTone(c, { type: 'triangle', f0: 220, f1: 140, gain: 0.09, dur: 0.14 });
        break;
      case 'whoosh': // 휙
        playNoise(c, { type: 'bandpass', f0: 500, f1: 2400, q: 1.2, gain: 0.22, dur: 0.22, attack: 0.05 });
        playNoise(c, { type: 'bandpass', f0: 2200, f1: 500, q: 1.0, gain: 0.12, dur: 0.3, attack: 0.02, at: 0.18 });
        break;
      case 'tap': // 바닥에 톡
        playNoise(c, { type: 'lowpass', f0: 1200, f1: 300, q: 0.7, gain: 0.2, dur: 0.07 });
        playTone(c, { type: 'sine', f0: 170, f1: 90, gain: 0.14, dur: 0.1 });
        break;
      case 'zip': { // 줄자가 드르륵 풀리는 소리: 짧은 딸깍을 점점 빠르게
        const d = Math.max(0.3, Math.min(2, durationS));
        let t = 0;
        let gap = 0.05;
        while (t < d) {
          playNoise(c, { type: 'bandpass', f0: 2600 + t * 900, f1: 2000, q: 2.5, gain: 0.07, dur: 0.018, attack: 0.002, at: t });
          t += gap;
          gap = Math.max(0.016, gap * 0.94);
        }
        playTone(c, { type: 'square', f0: 900, f1: 600, gain: 0.04, dur: 0.04, at: d });
        break;
      }
      case 'thunk': // 도장 쾅
        playTone(c, { type: 'sine', f0: 120, f1: 45, gain: 0.5, dur: 0.22 });
        playNoise(c, { type: 'lowpass', f0: 700, f1: 120, q: 0.6, gain: 0.3, dur: 0.09 });
        break;
      case 'pop': // 스티커 뿅
        playTone(c, { type: 'sine', f0: 520, f1: 1040, gain: 0.12, dur: 0.09 });
        break;
      case 'cheer': // 신기록: 도 미 솔 도
        [523, 659, 784, 1047].forEach((f, i) => playTone(c, { type: 'triangle', f0: f, f1: f, gain: 0.09, dur: 0.16, at: i * 0.09 }));
        break;
    }
  } catch {
    /* 소리를 내지 못해도 놀이는 계속된다 */
  }
}

// ---------------------------------------------------------------------------
// 바람 소리(바람 실험실): 부드럽게 거른 소음을 이어서 낸다. 세기에 따라 조금 커지고 밝아진다.
// 소리가 꺼져 있거나 소리 장치가 준비되지 않았으면 아무 일도 하지 않는다.
// ---------------------------------------------------------------------------
let wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;

/** level: 0 이면 멈춘다. 0..1 은 바람 세기. */
export function setWindSound(level: number): void {
  try {
    const lv = Math.max(0, Math.min(1, level));
    if (!enabled || !ctx || ctx.state !== 'running' || lv <= 0) {
      if (wind && ctx) {
        const w = wind;
        wind = null;
        w.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
        w.src.stop(ctx.currentTime + 0.4);
      }
      return;
    }
    const c = ctx;
    if (!wind) {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.4;
      filter.frequency.value = 300;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter).connect(gain).connect(c.destination);
      src.start();
      wind = { src, filter, gain };
    }
    wind.filter.frequency.setTargetAtTime(240 + 900 * lv, c.currentTime, 0.15);
    wind.gain.gain.setTargetAtTime(0.01 + 0.045 * lv, c.currentTime, 0.15);
  } catch {
    wind = null;
  }
}
