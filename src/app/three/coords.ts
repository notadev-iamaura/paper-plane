/**
 * 좌표 변환 (core <-> three.js).
 *
 * core 세계/기체 좌표: +x 앞(던지는 방향), +y 왼쪽, +z 위.
 * three.js 좌표:        +X 앞,              +Y 위,   +Z 오른쪽.
 * 따라서 (x, y, z) -> (x, z, -y). 이 변환은 "회전"이라서(행렬식 +1) 좌우가 거울처럼 뒤집히지 않는다.
 * 사원수의 벡터 부분도 같은 규칙으로 옮기면 같은 회전을 three 좌표에서 나타낸다.
 */
import * as THREE from 'three';
import type { Quat, Vec3 } from '../../core/index';

export function toThreeVec(v: Vec3, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v.x, v.z, -v.y);
}

export function toThreeQuat(q: Quat, out: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
  return out.set(q.x, q.z, -q.y, q.w);
}

/**
 * 던지는 순간의 자세(core 좌표의 사원수).
 * - 각도(pitch): 기수를 위로 든다. +y(왼쪽) 축 둘레로 -pitch 만큼 돈 것과 같다.
 * - 기울임(roll): 오른쪽 날개가 내려가면 +. +x(기수) 축 둘레로 +roll.
 * 기체 기준으로 먼저 기울이고(roll) 그다음 든다(pitch): q = q_pitch * q_roll.
 */
export function launchQuat(pitchDeg: number, rollDeg: number): Quat {
  const hp = (-pitchDeg * Math.PI) / 360;
  const hr = (rollDeg * Math.PI) / 360;
  const cp = Math.cos(hp), sp = Math.sin(hp);
  const cr = Math.cos(hr), sr = Math.sin(hr);
  // (cp, 0, sp, 0) * (cr, sr, 0, 0)
  return { w: cp * cr, x: cp * sr, y: sp * cr, z: -sp * sr };
}
