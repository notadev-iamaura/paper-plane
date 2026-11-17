/**
 * 좌표 변환 검사 (node 에서 실행: npx tsx scripts/check-coords.ts).
 * 1) 평범한 활공에서 비행기의 기수(기체 +x)가 속도 방향과 거의 같은가 (three 좌표로 옮긴 뒤에도).
 * 2) 조준 자세 계산(launchQuat)이 비행 엔진의 첫 표본 자세와 같은가.
 * 3) 좌우가 뒤집히지 않았는가: 오른쪽 날개를 내리고 던지면 오른쪽(core -y, three +Z)으로 휘어야 한다.
 * 4) 변환이 거울상이 아닌가(행렬식 +1).
 */
import * as THREE from 'three';
import { PRESETS, buildGeometry, simulate } from '../src/core/index';
import { launchQuat, toThreeQuat, toThreeVec } from '../src/app/three/coords';

let failed = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failed++;
}

const preset = PRESETS.find((p) => p.id === 'dart') ?? PRESETS[0]!;
const geom = buildGeometry(preset.design);

// 1) 기수 방향과 속도 방향
{
  const r = simulate(geom, { speedMps: 7, pitchDeg: 5, rollDeg: 0 });
  let worst = 0;
  let n = 0;
  for (let i = 5; i + 1 < r.samples.length - 5; i++) {
    const a = r.samples[i]!, b = r.samples[i + 1]!;
    const vel = toThreeVec({ x: b.pos.x - a.pos.x, y: b.pos.y - a.pos.y, z: b.pos.z - a.pos.z }).normalize();
    const nose = new THREE.Vector3(1, 0, 0).applyQuaternion(toThreeQuat(a.quat)); // three 에서도 기수는 +X
    const ang = (Math.acos(Math.min(1, Math.max(-1, nose.dot(vel)))) * 180) / Math.PI;
    if (ang > worst) worst = ang;
    n++;
    // 받음각과 같은 크기여야 한다(기수와 속도 사이의 각 = 받음각, 옆미끄럼이 없을 때)
  }
  check('기수가 속도 방향을 향한다', n > 20 && worst < 25, `(${r.verdict}, 최대 차이 ${worst.toFixed(1)}도, 표본 ${n}개)`);
  const mid = r.samples[Math.floor(r.samples.length / 2)]!;
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(toThreeQuat(mid.quat)); // 기체 위쪽(core +z -> three +Y)
  check('날개 윗면이 위를 향한다', up.y > 0.8, `(up.y = ${up.y.toFixed(2)})`);
}

// 2) 조준 자세
for (const [pitch, roll] of [[20, 0], [10, 25], [-10, -15]] as const) {
  const r = simulate(geom, { speedMps: 6, pitchDeg: pitch, rollDeg: roll });
  const q0 = r.samples[0]!.quat;
  const mine = launchQuat(pitch, roll);
  const dot = Math.abs(q0.w * mine.w + q0.x * mine.x + q0.y * mine.y + q0.z * mine.z);
  check(`조준 자세가 엔진과 같다 (각도 ${pitch}, 기울임 ${roll})`, dot > 0.9995, `(일치도 ${dot.toFixed(5)})`);
}

// 3) 좌우
{
  const r = simulate(geom, { speedMps: 7, pitchDeg: 5, rollDeg: 25 });
  // 던진 직후(약 0.4초)를 본다. 상반각이 큰 비행기는 그 뒤에 스스로 바로 서서 되돌아오기도 한다.
  const early = r.samples.find((s) => s.t >= 0.4) ?? r.samples[r.samples.length - 1]!;
  const end = toThreeVec(early.pos);
  check('오른쪽으로 기울이면 오른쪽(three +Z)으로 간다', early.pos.y < -0.03 && end.z > 0.03, `(0.4초 뒤 core y = ${early.pos.y.toFixed(2)}, three z = ${end.z.toFixed(2)})`);
  const q0 = toThreeQuat(r.samples[0]!.quat);
  const leftWing = new THREE.Vector3(0, 0, -1).applyQuaternion(q0); // 기체 +y(왼쪽) -> three -Z
  check('오른쪽 날개가 내려간 자세로 시작한다', leftWing.y > 0.2, `(왼쪽 날개 끝의 높이 성분 ${leftWing.y.toFixed(2)})`);
}

// 4) 거울상이 아님
{
  const ex = toThreeVec({ x: 1, y: 0, z: 0 });
  const ey = toThreeVec({ x: 0, y: 1, z: 0 });
  const ez = toThreeVec({ x: 0, y: 0, z: 1 });
  const det = ex.clone().cross(ey).dot(ez);
  check('변환의 행렬식이 +1 이다', Math.abs(det - 1) < 1e-9, `(det = ${det})`);
}

if (failed > 0) {
  console.error(`좌표 검사 실패 ${failed}건`);
  process.exit(1);
}
console.log('좌표 검사 통과');
