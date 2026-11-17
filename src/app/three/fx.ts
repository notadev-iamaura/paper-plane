/**
 * 분위기 효과: 햇살 속에 떠다니는 먼지, 비행기 날개 끝의 바람 꼬리, 빛을 받으며 팔랑팔랑 떨어지는 색종이 조각.
 */
import * as THREE from 'three';
import { tok } from '../lib/palette';
import { GYM, SUN_DIR } from './gym';
import { radialTexture, seeded, toonMat, Trash } from './toon';

// ---------------------------------------------------------------------------
// 먼지
// ---------------------------------------------------------------------------
export interface Dust { points: THREE.Points; update: (t: number) => void; setCount: (n: number) => void; dispose: () => void }

export function buildDust(max: number): Dust {
  const rnd = seeded(99);
  const pos = new Float32Array(max * 3), seed = new Float32Array(max);
  for (let i = 0; i < max; i++) {
    pos[i * 3] = -7 + rnd() * 34;
    pos[i * 3 + 1] = rnd() * 6.5;
    pos[i * 3 + 2] = -11.5 + rnd() * 13;
    seed[i] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const D = SUN_DIR.clone().multiplyScalar(-1);
  const tex = radialTexture(32, 0.05, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTex: { value: tex }, uScale: { value: 600 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * 0.035 * (0.4 + aSeed), 6.5) + 0.25;
        p.x += sin(uTime * 0.13 + aSeed * 40.0) * 0.5;
        p.z += cos(uTime * 0.11 + aSeed * 23.0) * 0.4;
        // 햇살(왼쪽 창에서 비스듬히 내려오는 빛) 안에 있을 때만 반짝인다
        float tt = (p.z + ${GYM.halfZ.toFixed(1)}) / ${D.z.toFixed(4)};
        float yw = p.y - (${D.y.toFixed(4)}) * tt;
        float xw = p.x - (${D.x.toFixed(4)}) * tt;
        float fx = abs(mod(xw + 3.0 + 4.25, 8.5) - 4.25);
        float lit = smoothstep(4.4, 4.9, yw) * (1.0 - smoothstep(8.7, 9.3, yw)) * (1.0 - smoothstep(1.2, 1.6, fx));
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 60.0);
        vA = (0.07 + 0.93 * lit) * tw;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uScale * (0.035 + 0.04 * aSeed) / -mv.z, 1.5, 16.0);
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      varying float vA;
      void main() {
        float a = texture2D(uTex, gl_PointCoord).a * vA;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.74) * a, a);
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  return {
    points,
    update: (t) => { mat.uniforms.uTime!.value = t; },
    setCount: (n) => { g.setDrawRange(0, Math.min(max, n)); points.visible = n > 0; },
    dispose: () => { g.dispose(); mat.dispose(); tex.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// 바람 꼬리(날개 끝에서 풀려 나오는 띠)
// ---------------------------------------------------------------------------
export interface Trail { mesh: THREE.Mesh; reset: () => void; push: (p: THREE.Vector3, camera: THREE.Vector3, speed: number) => void; fade: (dt: number) => void; dispose: () => void }

export function buildTrail(n = 26, width = 0.045): Trail {
  const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 4);
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3());
  let count = 0, strength = 0;
  const side = new THREE.Vector3(), dir = new THREE.Vector3(), view = new THREE.Vector3();
  const rebuild = (camera: THREE.Vector3): void => {
    for (let i = 0; i < n; i++) {
      const j = Math.min(i, Math.max(0, count - 1));
      const p = pts[j]!;
      const q = pts[Math.min(j + 1, Math.max(0, count - 1))]!;
      const r = pts[Math.max(j - 1, 0)]!;
      dir.copy(r).sub(q);
      view.copy(camera).sub(p);
      side.crossVectors(dir, view);
      if (side.lengthSq() < 1e-10) side.set(0, 1, 0);
      const k = 1 - i / (n - 1);
      side.normalize().multiplyScalar(width * 0.5 * (0.35 + 0.65 * k));
      pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
      const a = i < count ? k * k * strength * 0.5 : 0;
      col.set([1, 1, 1, a, 1, 1, 1, a], i * 8);
    }
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  };
  return {
    mesh,
    reset: () => { count = 0; strength = 0; mesh.visible = false; },
    push: (p, camera, speed) => {
      if (count === 0 || pts[0]!.distanceToSquared(p) > 0.0036) {
        const last = pts.pop()!;
        last.copy(p);
        pts.unshift(last);
        count = Math.min(n, count + 1);
      } else pts[0]!.copy(p);
      strength += (Math.min(1, Math.max(0, (speed - 1.5) / 5)) - strength) * 0.2;
      mesh.visible = count > 1;
      rebuild(camera);
    },
    fade: (dt) => {
      if (!mesh.visible) return;
      strength *= Math.exp(-dt * 5);
      if (strength < 0.01) { mesh.visible = false; return; }
      const c = g.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < n * 2; i++) c.setW(i, c.getW(i) * Math.exp(-dt * 5));
      c.needsUpdate = true;
    },
    dispose: () => { g.dispose(); mat.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// 색종이 조각
// ---------------------------------------------------------------------------
export interface Confetti { mesh: THREE.InstancedMesh; burst: (at: THREE.Vector3, n: number, spread: number, up: number) => void; update: (dt: number, clock: number) => boolean; clear: () => void; setMax: (n: number) => void; dispose: () => void }

export function buildConfetti(max: number): Confetti {
  const trash = new Trash();
  const g = trash.keep(new THREE.PlaneGeometry(0.1, 0.065));
  const mat = trash.keep(toonMat({ side: THREE.DoubleSide }));
  const mesh = new THREE.InstancedMesh(g, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.count = 0;
  const tones = ['--red', '--yellow', '--blue', '--green', '--pink', '--orange', '--sky', '--purple'].map((t) => new THREE.Color(tok(t)));
  const P = new Float32Array(max * 3), V = new Float32Array(max * 3), Rr = new Float32Array(max * 3), W = new Float32Array(max * 3), S = new Float32Array(max);
  const alive = new Uint8Array(max);
  let used = 0, cap = max, awake = 0;
  const rnd = seeded(555);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < max; i++) mesh.setColorAt(i, tones[i % tones.length]!);
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const write = (i: number): void => {
    e.set(Rr[i * 3]!, Rr[i * 3 + 1]!, Rr[i * 3 + 2]!);
    q.setFromEuler(e);
    p.set(P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!);
    M.compose(p, q, sc);
    mesh.setMatrixAt(i, M);
  };
  return {
    mesh,
    burst: (at, n, spread, up) => {
      for (let k = 0; k < n && used < cap; k++, used++) {
        const i = used;
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
        P[i * 3] = at.x + Math.cos(a) * r * 0.3; P[i * 3 + 1] = at.y + rnd() * 0.3; P[i * 3 + 2] = at.z + Math.sin(a) * r * 0.3;
        V[i * 3] = Math.cos(a) * r * 1.6; V[i * 3 + 1] = up * (0.5 + rnd() * 0.7); V[i * 3 + 2] = Math.sin(a) * r * 1.6;
        Rr[i * 3] = rnd() * 6; Rr[i * 3 + 1] = rnd() * 6; Rr[i * 3 + 2] = rnd() * 6;
        W[i * 3] = (rnd() - 0.5) * 14; W[i * 3 + 1] = (rnd() - 0.5) * 8; W[i * 3 + 2] = (rnd() - 0.5) * 14;
        S[i] = rnd() * 6.28;
        alive[i] = 1;
        awake++;
        write(i);
      }
      mesh.count = used;
      mesh.instanceMatrix.needsUpdate = true;
    },
    update: (dt, clock) => {
      if (awake === 0) return false;
      for (let i = 0; i < used; i++) {
        if (!alive[i]) continue;
        const o = i * 3;
        // 종이는 가볍다: 금방 느려지고, 좌우로 팔랑거리며 천천히 내려온다
        const drag = Math.exp(-dt * 2.4);
        V[o] = V[o]! * drag + Math.sin(clock * 5 + S[i]!) * 1.1 * dt;
        V[o + 2] = V[o + 2]! * drag + Math.cos(clock * 4.3 + S[i]! * 2) * 1.1 * dt;
        V[o + 1] = Math.max(-1.1, V[o + 1]! - 3.4 * dt);
        P[o] = P[o]! + V[o]! * dt; P[o + 1] = P[o + 1]! + V[o + 1]! * dt; P[o + 2] = P[o + 2]! + V[o + 2]! * dt;
        Rr[o] = Rr[o]! + W[o]! * dt; Rr[o + 1] = Rr[o + 1]! + W[o + 1]! * dt; Rr[o + 2] = Rr[o + 2]! + W[o + 2]! * dt;
        if (P[o + 1]! <= 0.014) {
          P[o + 1] = 0.014 + (i % 7) * 0.0006;
          Rr[o] = Math.PI / 2; Rr[o + 2] = 0;
          alive[i] = 0;
          awake--;
        }
        write(i);
      }
      mesh.instanceMatrix.needsUpdate = true;
      return true;
    },
    clear: () => { used = 0; awake = 0; mesh.count = 0; alive.fill(0); },
    setMax: (n) => { cap = Math.min(max, n); },
    dispose: () => { mesh.dispose(); trash.dispose(); },
  };
}
