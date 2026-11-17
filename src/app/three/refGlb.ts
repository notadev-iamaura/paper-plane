/**
 * 블렌더(파이썬 코드)로 만든 심판 선생님(referee.glb)을 불러와 무대의 "심판" 자리에 세운다.
 *
 * - 모델: tools/character/build_referee.py 가 만든다(아이와 같은 방법, 생김새만 다르다: chars/referee.py).
 *   단발머리, 동그란 안경, 청록 운동복, 목에 건 호루라기, 왼손의 기록판, 오른손의 손깃발이 모두 실제 모양이다.
 * - 동작: Idle / WatchPlane / RaiseFlag / PointToLanding / Clap 클립을 섞고, 그 위에 "고개 돌리기"와 "가리키는 쪽으로 몸 돌리기"를 얹는다.
 * - 무대가 보기에는 기존 심판(kid.ts 의 RefActor)과 똑같다: chibi.root / update / snap / dispose.
 *
 * 이 파일과 모델은 첫 그림이 나간 뒤에 따로 내려받는다. 불러오지 못하면 무대가 기존 도형 심판을 세운다.
 * 좌표: 모델은 +Z 가 앞(glTF). 게임의 캐릭터는 +X 가 앞이라 통째로 90도 돌려 넣는다.
 */
import * as THREE from 'three';
import { browOf } from './faceAtlas';
import { axesOf, clamp, ClipSet, dressToon, loadGlb, rotateWorld, turnBone } from './glbActor';
import type { Chibi, ChibiLook, Expr, RefActor, RefInput } from './kid';

type ClipName = 'Idle' | 'WatchPlane' | 'RaiseFlag' | 'PointToLanding' | 'Clap';
const CLIPS: ClipName[] = ['Idle', 'WatchPlane', 'RaiseFlag', 'PointToLanding', 'Clap'];
const OUTLINE = 0.0068;
/** 모델의 키는 1 이다. 기존 도형 심판(키 1.135 x look.scale)과 같은 크기로 서게 하는 배율. */
const HEIGHT = 1.135;
/** 머리 한가운데의 높이(모델 단위. chars/referee.py 의 head_z) */
const HEAD_Y = 0.815;

export interface RefGlbOpts {
  facePx?: number;
  /** 가벼운 벌(referee-lite.glb, 삼각형 약 1/4)을 쓴다. 낮은 화질 단계에서 켠다. */
  lite?: boolean;
}

const wrap = (x: number): number => { let v = x; while (v > Math.PI) v -= Math.PI * 2; while (v < -Math.PI) v += Math.PI * 2; return v; };
/** 한 번 하고 나서 끝부분을 되풀이하는 동작의 시간: 0~a 는 그대로, 그 뒤는 a~a+period 를 되풀이한다 */
const holdLoop = (t: number, a: number, period: number): number => (t < a ? t : a + ((t - a) % period));

export async function loadRefGlb(look: ChibiLook, opts: RefGlbOpts = {}): Promise<RefActor> {
  // 두 벌 가운데 쓰는 것의 주소만 불러온다(모델을 JS 에 넣는 빌드에서도 안 쓰는 벌은 내려받지 않는다)
  const refUrl = (opts.lite ? await import('../assets/referee-lite.glb?url') : await import('../assets/referee.glb?url')).default;
  const gltf = await loadGlb(refUrl);
  const root = new THREE.Group();
  root.scale.setScalar(look.scale * HEIGHT);
  const model = gltf.scene;
  model.rotation.y = Math.PI / 2;
  root.add(model);
  root.updateMatrixWorld(true);

  const bone = (name: string): THREE.Object3D => {
    const o = model.getObjectByName(name.replace('.', ''));
    if (!o) throw new Error(`referee.glb: 뼈 ${name} 가 없어요`);
    return o;
  };
  const B = { spine: bone('spine'), chest: bone('chest'), neck: bone('neck'), head: bone('head'), upperR: bone('upper_arm.R'), handR: bone('hand_grip.R'), handL: bone('hand_grip.L') };
  const AX = { spine: axesOf(B.spine), chest: axesOf(B.chest), neck: axesOf(B.neck), head: axesOf(B.head) };
  const headCenterL = B.head.worldToLocal(root.localToWorld(new THREE.Vector3(0, HEAD_Y, 0)));

  const dressed = dressToon(model, 'referee', OUTLINE, { kind: 'teacher', brow: browOf(look.hair), px: opts.facePx ?? 1.5 });
  const clips = new ClipSet<ClipName>(model, gltf.animations, CLIPS, 'referee.glb');

  const handR = new THREE.Vector3(), handL = new THREE.Vector3(), headPos = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let baseY = 0;
  const measure = (): void => {
    root.updateMatrixWorld(true);
    B.handR.getWorldPosition(handR);
    B.handL.getWorldPosition(handL);
    headPos.copy(headCenterL);
    B.head.localToWorld(headPos);
  };
  const chibi = {
    root, look,
    apply: () => undefined,
    setFace: (e: Expr, blink: boolean) => dressed.setFace(e, blink),
    setOutline: (on: boolean) => dressed.setOutline(on),
    setBaseY: (y: number) => { baseY = y; root.position.y = y; },
    redrawText: () => undefined,
    handR, handL, headPos,
    toLocal: (world: THREE.Vector3, out: THREE.Vector3) => {
      root.updateMatrixWorld();
      return out.copy(world).applyMatrix4(inv.copy(root.matrixWorld).invert());
    },
    dispose: () => {
      clips.dispose();
      dressed.body.skeleton.dispose();
      dressed.trash.dispose();
    },
  } as unknown as Chibi;

  const tmp = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  let snapNext = true;
  let facing = 0;
  let blinkAt = 1.3, blinkT = 0;
  const cur = { yaw: 0, pitch: 0, twist: 0, aim: 0, aimPitch: 0, aimW: 0 };
  /** 클립 위에 우리가 손을 대는 뼈들과, 손대기 전의 값(믹서는 값이 바뀐 뼈만 다시 쓰므로 매번 되돌려 놓는다) */
  const touched = [B.spine, B.chest, B.neck, B.head, B.upperR];
  const cleanQ = touched.map((b) => b.quaternion.clone());

  const update = (dt: number, clock: number, inp: RefInput): void => {
    clips.clear();
    let rate = 9;
    let expr: Expr = 'smile';
    let lookW = 0.85, nodDown = 0, twistW = 0.25, aimW = 0;
    switch (inp.mode) {
      case 'idle':
        clips.want('Idle', 1);
        clips.setTime('Idle', clock, true);
        // 가끔 기록판을 내려다본다
        if ((clock % 8) > 6.2) { lookW = 0.15; nodDown = 0.42; }
        break;
      case 'watch':
        clips.want('WatchPlane', 1);
        clips.setTime('WatchPlane', clock, true);
        expr = 'wow';
        lookW = 1;
        twistW = 0.4;
        break;
      case 'flag':
        // 깃발 번쩍!
        clips.want('RaiseFlag', 1);
        clips.setTime('RaiseFlag', holdLoop(inp.t, 0.5, 1), false);
        expr = inp.t < 0.6 ? 'joy' : 'smile';
        rate = 26;
        break;
      case 'point':
        // 깃발로 착지 지점을 가리킨다
        clips.want('PointToLanding', 1);
        clips.setTime('PointToLanding', holdLoop(inp.t, 0.5, 1), false);
        rate = 14;
        aimW = 1;
        twistW = 0;
        lookW = 0.7;
        break;
      case 'cheer':
        clips.want('Clap', 1);
        clips.setTime('Clap', clock, true);
        expr = 'joy';
        rate = 14;
        lookW = 0.5;
        break;
    }
    const k = snapNext ? 1 : 1 - Math.exp(-dt * rate);
    clips.blend(k);
    for (let i = 0; i < touched.length; i++) touched[i]!.quaternion.copy(cleanQ[i]!);
    clips.mixer.update(0);
    for (let i = 0; i < touched.length; i++) cleanQ[i]!.copy(touched[i]!.quaternion);

    if (snapNext) facing = inp.facing;
    else facing += wrap(inp.facing - facing) * (1 - Math.exp(-dt * 7));
    root.rotation.y = facing;
    root.position.y = baseY;
    root.updateMatrixWorld(true);

    const gk = snapNext ? 1 : 1 - Math.exp(-dt * 8);
    // ---- 가리키기: 착지 지점 쪽으로 허리와 팔을 돌린다(클립은 정면을 가리킨다)
    let aimYaw = 0, aimPitch = 0;
    if (aimW > 0 && inp.pointAt) {
      tmp.copy(inp.pointAt).sub(root.position);
      aimYaw = clamp(wrap(Math.atan2(-tmp.z, tmp.x) - facing), -1.35, 1.35);
      const shoulderY = 0.6 * root.scale.y;
      aimPitch = clamp(-Math.atan2(shoulderY - inp.pointAt.y, Math.max(0.5, Math.hypot(tmp.x, tmp.z))), -0.45, 0.1);
    }
    cur.aimW += (aimW - cur.aimW) * gk;
    cur.aim += (aimYaw - cur.aim) * gk;
    cur.aimPitch += (aimPitch - cur.aimPitch) * gk;
    // ---- 바라보기: 허리는 조금, 고개는 많이
    let gy = 0, gp = -nodDown, tw = 0;
    if (inp.lookAt) {
      measure();
      tmp.copy(inp.lookAt).sub(headPos);
      const yawTo = clamp(wrap(Math.atan2(-tmp.z, tmp.x) - facing), -1.5, 1.5);
      tw = yawTo * twistW;
    }
    cur.twist += (tw - cur.twist) * gk;
    const bodyYaw = cur.twist + cur.aim * 0.72 * cur.aimW;
    if (Math.abs(bodyYaw) > 1e-4) {
      turnBone(B.spine, AX.spine, bodyYaw * 0.5, 0);
      turnBone(B.chest, AX.chest, bodyYaw * 0.5, 0);
    }
    if (cur.aimW > 0.01) {
      root.updateMatrixWorld(true);
      rotateWorld(B.upperR, q.setFromAxisAngle(Y, cur.aim * 0.28 * cur.aimW));
      // 팔을 위아래로: 가리키는 방향에 수직인 수평축 둘레로 돌린다
      const dirYaw = facing + cur.aim;
      v1.set(Math.sin(dirYaw), 0, Math.cos(dirYaw));
      rotateWorld(B.upperR, q.setFromAxisAngle(v1, -cur.aimPitch * cur.aimW));
    }
    if (inp.lookAt && lookW > 0) {
      root.updateMatrixWorld(true);
      B.head.getWorldQuaternion(q);
      v1.copy(AX.head.fwd).applyQuaternion(q);
      const yawNow = Math.atan2(-v1.z, v1.x), pitchNow = Math.asin(clamp(v1.y, -1, 1));
      B.chest.getWorldQuaternion(q);
      v2.copy(AX.chest.fwd).applyQuaternion(q);
      const yawChest = Math.atan2(-v2.z, v2.x);
      tmp.copy(headCenterL);
      B.head.localToWorld(tmp);
      tmp.subVectors(inp.lookAt, tmp);
      const yawWant = yawChest + clamp(wrap(Math.atan2(-tmp.z, tmp.x) - yawChest), -1.1, 1.1);
      const pitchWant = clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.45, 0.6);
      gy += wrap(yawWant - yawNow) * lookW;
      gp += (pitchWant - pitchNow) * lookW;
    }
    cur.yaw += (gy - cur.yaw) * gk;
    cur.pitch += (gp - cur.pitch) * gk;
    if (Math.abs(cur.yaw) > 1e-4 || Math.abs(cur.pitch) > 1e-4) {
      turnBone(B.neck, AX.neck, cur.yaw * 0.3, cur.pitch * 0.3);
      turnBone(B.head, AX.head, cur.yaw * 0.7, cur.pitch * 0.7);
    }
    measure();

    blinkT -= dt;
    if (clock > blinkAt) { blinkT = 0.11; blinkAt = clock + 2.5 + ((clock * 5.1) % 2.3); }
    dressed.setFace(expr, blinkT > 0);
    snapNext = false;
  };

  dressed.setFace('smile', false);
  measure();
  return { chibi, update, snap: () => { snapNext = true; } };
}
