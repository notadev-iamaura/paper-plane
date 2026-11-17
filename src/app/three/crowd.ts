/**
 * 관람석의 관중: 작고 둥근 아이들 수십 명을 인스턴싱으로 한꺼번에 그린다(몸, 다리, 머리, 머리 모양 4종, 팔, 깃발).
 * 가만히 있을 때는 살랑살랑 흔들리며 비행기(또는 던지는 아이)를 눈으로 좇고,
 * 착지하면 가까운 자리부터 파도처럼 들썩이며 팔과 종이 깃발을 흔든다(등급이 좋을수록 크게, 오래).
 */
import * as THREE from 'three';
import { tok } from '../lib/palette';
import { BLEACHER_ROWS, GYM } from './gym';
import type { Tier } from './quality';
import { canvasOf, capsuleY, Merger, mix, outlineMat, seeded, smoothLathe, texOf, toonMat, Trash } from './toon';

export interface Crowd {
  group: THREE.Group;
  /** focus: 다 같이 바라보는 곳(세계 좌표) */
  update: (dt: number, clock: number, focus: THREE.Vector3) => void;
  /** 환호. level 0~1, fromX: 파도가 시작되는 x 자리 */
  cheer: (level: number, fromX: number, holdS: number) => void;
  calm: () => void;
  setTier: (t: Tier) => void;
  dispose: () => void;
}

export interface Seat { x: number; y: number; z: number; s: number; ph: number; sp: number; hair: number; flag: boolean; yaw: number; pitch: number; lazy: number }

const MAX = 56;
const UP = new THREE.Vector3(0, 1, 0);

/** 자리 뽑기: 출발선 가까이는 빽빽하게, 멀수록 듬성듬성. 앞쪽 자리부터(단계가 낮으면 앞에서부터 덜 앉힌다). */
export function pickSeats(rnd: () => number, max = MAX): Seat[] {
  const cand: (Seat & { pri: number })[] = [];
  BLEACHER_ROWS.forEach((row, k) => {
    for (let x = GYM.bleacherX0 + 0.75 + (k % 2) * 0.4; x < GYM.bleacherX1 - 0.6; x += 1.22) {
      const dens = x < 9 ? 2.2 : x < 16 ? 0.9 : x < 28 ? 0.45 : 0.14;
      cand.push({
        x: x + (rnd() - 0.5) * 0.2, y: row.y + 0.07, z: row.z - 0.04, s: 1.42 + rnd() * 0.26, ph: rnd() * 6.28, sp: 0.8 + rnd() * 0.5,
        hair: Math.floor(rnd() * 4), flag: rnd() < 0.42, yaw: 0, pitch: 0, lazy: 0.5 + rnd() * 0.5, pri: rnd() / dens,
      });
    }
  });
  cand.sort((a, b) => a.pri - b.pri);
  return cand.slice(0, max);
}

function drawHead(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.54;
  const eye = '#33264a';
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(cx + s * 50, cy + 22, 1, cx + s * 50, cy + 22, 17);
    g.addColorStop(0, 'rgba(255,110,120,0.6)');
    g.addColorStop(1, 'rgba(255,110,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx + s * 50 - 18, cy + 4, 36, 36);
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.ellipse(cx + s * 30, cy, 8.5, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + s * 30 - 3, cy - 4, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = eye;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.fillStyle = '#8a2f3a';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy + 24);
  ctx.quadraticCurveTo(cx, cy + 27, cx + 12, cy + 24);
  ctx.quadraticCurveTo(cx, cy + 42, cx - 12, cy + 24);
  ctx.fill();
  ctx.stroke();
}

export function buildCrowd(tier: Tier): Crowd {
  const trash = new Trash();
  const keep = <T extends { dispose: () => void }>(x: T): T => trash.keep(x);
  const group = new THREE.Group();
  const rnd = seeded(2024);

  const seats: Seat[] = pickSeats(rnd);
  const N = seats.length;

  // ---- 재질과 도형 ----
  const headC = canvasOf(512, 256);
  if (headC.ctx) drawHead(headC.ctx, 512, 256);
  const headTex = keep(texOf(headC.canvas, 2));
  const bodyMat = keep(toonMat({ rim: 0.3 }));
  const headMat = keep(toonMat({ map: headTex, rim: 0.3, skin: true }));
  const flagMat = keep(toonMat({ side: THREE.DoubleSide }));
  const line = keep(outlineMat(0.011));

  const HEAD_Y = 0.47, HEAD_R = 0.172, SH_Y = 0.262, SH_X = 0.118, ARM = 0.2;
  const bodyG = keep(new Merger().add(smoothLathe([[0.001, -0.01], [0.09, -0.005], [0.14, 0.035], [0.138, 0.13], [0.11, 0.24], [0.066, 0.3], [0.04, 0.325]], 9, 7), '#ffffff').build());
  const legsG = keep((() => {
    const m = new Merger();
    for (const s of [-1, 1]) {
      m.add(capsuleY(0.055, 0.13, 5, 1), '#ffffff', { x: s * 0.068, y: 0.035, z: 0.05, rx: Math.PI / 2 });
      m.add(capsuleY(0.05, 0.085, 5, 1), '#ffffff', { x: s * 0.068, y: 0.035, z: 0.2, rx: Math.PI * 0.86 });
      m.add(new THREE.SphereGeometry(0.062, 6, 4), '#ffffff', { x: s * 0.068, y: -0.085, z: 0.27, sz: 1.35, sy: 0.82 });
    }
    return m.build();
  })());
  const headG = keep(new THREE.SphereGeometry(HEAD_R, 12, 8).rotateY(-Math.PI / 2).scale(1.04, 0.96, 1));
  const armG = keep((() => {
    const m = new Merger();
    m.add(capsuleY(0.038, ARM - 0.04, 5, 1), '#ffffff');
    m.add(new THREE.SphereGeometry(0.047, 6, 4), '#ffe9dc', { y: ARM });
    return m.build();
  })());
  const flagG = keep((() => {
    const m = new Merger();
    m.add(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 5), '#55607f', { y: ARM + 0.16 });
    const g = new THREE.BufferGeometry();
    const y0 = ARM + 0.34;
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, y0, 0, 0.24, y0 - 0.075, 0, 0, y0 - 0.15, 0], 3));
    g.computeVertexNormals();
    m.add(g, '#ffffff');
    return m.build();
  })());
  // 머리 모양 4가지(얼굴은 +Z 를 본다)
  const R = HEAD_R;
  const shell = (m: Merger, down = 0.7): void => {
    m.add(new THREE.SphereGeometry(R * 1.06, 10, 3, 0, Math.PI * 2, 0, 0.36 * Math.PI), '#ffffff', { sx: 1.04, sy: 0.98 });
    m.add(new THREE.SphereGeometry(R * 1.055, 7, 5, Math.PI * 0.42, Math.PI * 1.16, 0, down * Math.PI), '#ffffff', { sx: 1.04, sy: 0.98, ry: Math.PI / 2 });
  };
  const hairG = [
    (() => { // 바가지 머리
      const m = new Merger();
      shell(m, 0.66);
      for (const fx of [-0.5, 0, 0.5]) m.add(new THREE.SphereGeometry(R * 0.4, 6, 4), '#ffffff', { x: fx * R, y: R * 0.56, z: R * 0.78, sy: 0.6, sz: 0.5 });
      return m.build();
    })(),
    (() => { // 양 갈래
      const m = new Merger();
      shell(m, 0.6);
      for (const s of [-1, 1]) {
        m.add(new THREE.SphereGeometry(R * 0.36, 7, 5), '#ffffff', { x: s * R * 1.12, y: R * 0.1, z: -R * 0.1, sy: 1.25 });
        m.add(new THREE.SphereGeometry(R * 0.36, 6, 4), '#ffffff', { x: s * R * 0.45, y: R * 0.6, z: R * 0.74, sy: 0.55, sz: 0.5 });
      }
      return m.build();
    })(),
    (() => { // 삐죽 머리
      const m = new Merger();
      shell(m, 0.55);
      m.add(new THREE.ConeGeometry(R * 0.26, R * 0.5, 8), '#ffffff', { y: R * 1.12, x: R * 0.1, rz: -0.3 });
      m.add(new THREE.SphereGeometry(R * 0.5, 6, 4), '#ffffff', { y: R * 0.62, z: R * 0.72, sy: 0.5, sz: 0.5 });
      return m.build();
    })(),
    (() => { // 반 모자
      const m = new Merger();
      m.add(new THREE.SphereGeometry(R * 1.1, 12, 5, 0, Math.PI * 2, 0, 0.45 * Math.PI), '#ffffff', { sx: 1.04, y: R * 0.05 });
      m.add(new THREE.SphereGeometry(R * 0.74, 9, 5), '#ffffff', { y: R * 0.2, z: R * 0.9, sy: 0.12 });
      m.add(new THREE.SphereGeometry(R * 1.02, 7, 4, 0, Math.PI, 0.3 * Math.PI, 0.36 * Math.PI), '#6a5148', { ry: Math.PI / 2 + Math.PI / 2, sx: 1.04 });
      return m.build();
    })(),
  ].map((g) => keep(g));

  const mkInst = (geom: THREE.BufferGeometry, mat: THREE.Material, count: number, cast = true): THREE.InstancedMesh => {
    const m = new THREE.InstancedMesh(geom, mat, Math.max(1, count));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = cast;
    group.add(m);
    return m;
  };
  const vc = keep(toonMat({ vertexColors: true, rim: 0.3 }));
  const bodies = mkInst(bodyG, bodyMat, N);
  const legs = mkInst(legsG, bodyMat, N);
  const heads = mkInst(headG, headMat, N);
  const arms = mkInst(armG, vc, N * 2, false);
  const hairCount = [0, 0, 0, 0];
  for (const s of seats) hairCount[s.hair]!++;
  const hairs = hairG.map((g, i) => mkInst(g, vc, hairCount[i]!));
  const flagCount = seats.filter((s) => s.flag).length;
  const flags = mkInst(flagG, flagMat, flagCount, false);
  flags.material = keep(toonMat({ vertexColors: true, side: THREE.DoubleSide }));

  // 외곽선(같은 인스턴스 행렬을 함께 쓴다)
  const outlines: THREE.InstancedMesh[] = [];
  for (const src of [bodies, heads, ...hairs]) {
    const o = new THREE.InstancedMesh(src.geometry, line, src.count);
    o.instanceMatrix = src.instanceMatrix;
    o.frustumCulled = false;
    group.add(o);
    outlines.push(o);
    (o.userData as { src: THREE.InstancedMesh }).src = src;
  }

  // ---- 색 ----
  const shirts = [tok('--red'), tok('--yellow'), tok('--blue'), tok('--green'), tok('--orange'), tok('--pink'), tok('--purple'), tok('--sky'), tok('--paper')];
  const pants = [tok('--ink'), mix(tok('--blue'), tok('--ink'), 0.4), mix(tok('--court-dark'), tok('--ink'), 0.3), tok('--ink-soft')];
  const skins = [tok('--skin'), mix(tok('--skin'), tok('--paper'), 0.35), mix(tok('--skin'), tok('--court-dark'), 0.3), mix(tok('--skin'), tok('--pink'), 0.15)];
  const hairTones = ['#2a2238', '#3b2a26', '#5a3a28', '#74482a'];
  const capTones = [tok('--red'), tok('--blue'), tok('--yellow'), tok('--green')];
  const flagTones = [tok('--red'), tok('--yellow'), tok('--sky'), tok('--pink'), tok('--green')];
  const col = new THREE.Color();
  const hairAt = [0, 0, 0, 0];
  let flagAt = 0;
  const hairIdx: number[] = [], flagIdx: number[] = [];
  seats.forEach((s, i) => {
    const shirt = shirts[Math.floor(rnd() * shirts.length)]!;
    bodies.setColorAt(i, col.set(shirt));
    legs.setColorAt(i, col.set(pants[Math.floor(rnd() * pants.length)]!));
    heads.setColorAt(i, col.set(skins[Math.floor(rnd() * skins.length)]!));
    arms.setColorAt(i * 2, col.set(shirt));
    arms.setColorAt(i * 2 + 1, col.set(shirt));
    const h = hairAt[s.hair]!++;
    hairIdx.push(h);
    hairs[s.hair]!.setColorAt(h, col.set(s.hair === 3 ? capTones[Math.floor(rnd() * capTones.length)]! : hairTones[Math.floor(rnd() * hairTones.length)]!));
    if (s.flag) {
      flags.setColorAt(flagAt, col.set(flagTones[Math.floor(rnd() * flagTones.length)]!));
      flagIdx.push(flagAt++);
    } else flagIdx.push(-1);
  });
  for (const m of [bodies, legs, heads, arms, flags, ...hairs]) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  // ---- 움직임 ----
  let shown = Math.min(N, tier.crowd);
  let cheerLevel = 0, cheerAt = -100, cheerX = 0, cheerHold = 1.5;
  let now = 0;
  const M = new THREE.Matrix4(), MB = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const p = new THREE.Vector3(), sc = new THREE.Vector3(), dir = new THREE.Vector3(), sh = new THREE.Vector3();
  const eul = new THREE.Euler();

  const applyCounts = (): void => {
    const hc = [0, 0, 0, 0];
    let fc = 0;
    for (let i = 0; i < shown; i++) { hc[seats[i]!.hair]!++; if (seats[i]!.flag) fc++; }
    bodies.count = legs.count = heads.count = shown;
    arms.count = shown * 2;
    hairs.forEach((h, i) => { h.count = hc[i]!; h.visible = hc[i]! > 0; });
    flags.count = fc;
    flags.visible = fc > 0;
    for (const o of outlines) { const src = (o.userData as { src: THREE.InstancedMesh }).src; o.count = src.count; }
  };
  const setTier = (t: Tier): void => {
    shown = Math.min(N, t.crowd);
    applyCounts();
    for (const o of outlines) o.visible = t.crowdOutline && (o.userData as { src: THREE.InstancedMesh }).src.count > 0;
    bodies.castShadow = heads.castShadow = t.crowdShadow;
    legs.castShadow = false;
    for (const h of hairs) h.castShadow = false;
  };

  const update = (dt: number, clock: number, focus: THREE.Vector3): void => {
    now = clock;
    const since = clock - cheerAt;
    for (let i = 0; i < shown; i++) {
      const s = seats[i]!;
      // 환호는 가까운 자리부터 파도처럼 번진다
      const tau = since - Math.abs(s.x - cheerX) * 0.035 - s.lazy * 0.12;
      let e = 0;
      if (tau > 0) e = cheerLevel * (tau < 0.18 ? tau / 0.18 : tau < cheerHold ? 1 : Math.exp(-(tau - cheerHold) / 0.7)) * (0.55 + 0.45 * s.lazy);
      const bounce = Math.abs(Math.sin(clock * (7.5 + s.sp) + s.ph)) * 0.13 * e;
      const sway = Math.sin(clock * s.sp + s.ph);
      // 몸
      p.set(s.x, s.y + bounce * s.s, s.z);
      eul.set(0, 0, sway * (0.035 + 0.05 * e));
      q.setFromEuler(eul);
      const sq = 1 + Math.sin(clock * 2 * s.sp + s.ph) * 0.012 + bounce * 0.35;
      sc.set(s.s / Math.sqrt(sq), s.s * sq, s.s / Math.sqrt(sq));
      MB.compose(p, q, sc);
      bodies.setMatrixAt(i, MB);
      sc.setScalar(s.s);
      M.compose(p, q, sc);
      legs.setMatrixAt(i, M);
      // 머리: 초점을 바라본다(사람마다 조금 늦게, 조금 다르게)
      dir.set(focus.x - s.x, focus.y - (s.y + HEAD_Y * s.s), focus.z - s.z);
      const yawT = THREE.MathUtils.clamp(Math.atan2(dir.x, dir.z), -1.2, 1.2) + Math.sin(clock * 0.31 * s.sp + s.ph * 2) * 0.12;
      const pitchT = THREE.MathUtils.clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.55, 0.3) - e * 0.15;
      const k = 1 - Math.exp(-dt * (3 + 3 * s.lazy));
      s.yaw += (yawT - s.yaw) * k;
      s.pitch += (pitchT - s.pitch) * k;
      eul.set(s.pitch, s.yaw, sway * 0.06, 'YXZ');
      q2.setFromEuler(eul);
      p.set(0, HEAD_Y * sq, 0).applyMatrix4(M);
      p.y += (sq - 1) * 0.02;
      sc.setScalar(s.s);
      M.compose(p, q2, sc);
      heads.setMatrixAt(i, M);
      hairs[s.hair]!.setMatrixAt(hairIdx[i]!, M);
      // 팔: 무릎 위에 얌전히 -> 번쩍 들고 흔든다
      for (let a = 0; a < 2; a++) {
        const side = a === 0 ? -1 : 1;
        const up = Math.min(1, e * 1.2) * (s.flag && side > 0 ? 1 : 0.5 + 0.5 * s.lazy);
        const wave = Math.sin(clock * (9 + s.sp * 2) + s.ph + a * 1.3) * 0.35 * up;
        const holds = s.flag && side > 0;
        if (holds) dir.set(side * (0.1 + 0.3 * up) + wave + sway * 0.06, 0.5 + 0.5 * up, 0.75 * (1 - up) + 0.1).normalize();
        else dir.set(side * (0.12 + 0.3 * up) + wave, -0.75 + 1.75 * up, 0.66 * (1 - up) + 0.12).normalize();
        q.setFromUnitVectors(UP, dir);
        sh.set(side * SH_X, SH_Y * sq, 0).applyMatrix4(MB);
        // MB 의 눌림 배율이 섞이지 않게 어깨 위치만 쓰고 크기는 따로 준다
        sc.setScalar(s.s);
        M.compose(sh, q, sc);
        arms.setMatrixAt(i * 2 + a, M);
        if (side > 0 && flagIdx[i]! >= 0) flags.setMatrixAt(flagIdx[i]!, M);
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    flags.instanceMatrix.needsUpdate = true;
    for (const h of hairs) h.instanceMatrix.needsUpdate = true;
  };

  setTier(tier);
  return {
    group,
    update,
    cheer: (level, fromX, holdS) => { cheerLevel = level; cheerAt = now; cheerX = fromX; cheerHold = holdS; },
    calm: () => { cheerLevel = 0; },
    setTier,
    dispose: () => {
      for (const m of [bodies, legs, heads, arms, flags, ...hairs, ...outlines]) m.dispose();
      trash.dispose();
    },
  };
}
