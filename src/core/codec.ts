/**
 * 설계 <-> 공유 코드.
 *
 * 만드는 법
 * 1) 값을 정수로 반올림한다: 길이는 0.1 mm, 각도는 0.1 도, 던지는 속도는 0.01 m/s 단위.
 * 2) 바이트 배열로 촘촘히 담는다(아래 표).
 * 3) 바이트 배열 전체를 하나의 큰 수로 보고 62진법(0-9, A-Z, a-z)으로 바꾼다.
 *    결과는 영문자와 숫자만 있으므로 주소의 # 뒤에 그대로 쓸 수 있다.
 *
 * 바이트 구성 (여러 바이트 수는 큰 자리부터)
 *   [0]      0x01 고정. 맨 앞의 0 이 큰 수 변환에서 사라지지 않게 하는 표식.
 *   [1]      깃발. 비트0 = 클립 있음, 비트1 = 던지기 값 있음
 *   [2]      종이 번호 (PAPERS 의 순서. 모르는 종이는 255)
 *   [3]      접기 횟수 n
 *   다음     접기 방향 비트 묶음, ceil(n/8) 바이트 (1 = 산접기)
 *   다음     접기마다 8 바이트: ax, ay, bx, by (부호 있는 16비트, 0.1 mm)
 *   다음     마무리 10 바이트: 동체 깊이, 상반각, 날개 끝 폭, 날개 끝 각도, 뒷전 각도 (각 16비트)
 *   (클립)   2 바이트: 위치 (부호 있는 16비트, 0.1 mm)
 *   (던지기) 6 바이트: 속도(0.01 m/s), 각도(0.1 도), 기울임(0.1 도)
 *   끝       2 바이트 검사값(CRC-16). 한 글자라도 틀리면 여기서 걸린다.
 *
 * 코드 앞에는 형식 버전 "P1" 이 붙는다.
 * Buffer, btoa 같은 환경 전용 기능은 쓰지 않는다(브라우저와 Node 양쪽에서 동작).
 */
import type { FoldOp, PlaneDesign, ThrowInput } from './types';
import { LIMITS } from './types';
import { PAPERS } from './papers';
import { validateDesign } from './validate';

const PREFIX = 'P1';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 받아들이는 코드의 최대 길이(글자). 24번 접기 + 던지기 값이 약 300자다. */
const MAX_CODE_LENGTH = 420;

const LEN_Q = 1e-4;  // 0.1 mm
const ANG_Q = 0.1;   // 0.1 도
const SPD_Q = 0.01;  // 0.01 m/s

/** 반올림해서 부호 있는 16비트 범위로 자른다. 숫자가 아니면 0. */
function toI16(v: unknown, quantum: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.round(v / quantum);
  return n < -32768 ? -32768 : n > 32767 ? 32767 : n;
}

/** CRC-16/CCITT-FALSE */
function crc16(bytes: readonly number[], end: number): number {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) {
    crc ^= (bytes[i]! & 0xff) << 8;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** 바이트 배열(큰 수) -> 62진법 글자열. 62 로 계속 나누며 나머지를 모은다. */
function bytesToBase62(bytes: Uint8Array): string {
  const num = Array.from(bytes);
  let start = 0;
  let out = '';
  while (start < num.length) {
    let rem = 0;
    for (let i = start; i < num.length; i++) {
      const cur = rem * 256 + num[i]!;
      num[i] = Math.floor(cur / 62);
      rem = cur % 62;
    }
    out = ALPHABET[rem]! + out;
    while (start < num.length && num[start] === 0) start++;
  }
  return out;
}

/** 62진법 글자열 -> 바이트 배열. 허용하지 않는 글자가 있으면 null. */
function base62ToBytes(text: string): Uint8Array | null {
  // 작은 자리부터 담는 배열. 글자 하나마다 62 를 곱하고 더한다.
  const le: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let v: number;
    if (c >= 48 && c <= 57) v = c - 48;
    else if (c >= 65 && c <= 90) v = c - 65 + 10;
    else if (c >= 97 && c <= 122) v = c - 97 + 36;
    else return null;
    let carry = v;
    for (let j = 0; j < le.length; j++) {
      const cur = le[j]! * 62 + carry;
      le[j] = cur & 0xff;
      carry = cur >>> 8;
    }
    while (carry > 0) {
      le.push(carry & 0xff);
      carry >>>= 8;
    }
  }
  return Uint8Array.from(le.reverse());
}

/** 설계(와 선택적으로 던지기 값)를 영문자+숫자 코드로 만든다. */
export function encodeDesign(design: PlaneDesign, throwIn?: ThrowInput): string {
  const b: number[] = [];
  const pushI16 = (n: number): void => {
    const u = n & 0xffff;
    b.push(u >>> 8, u & 0xff);
  };

  const folds: FoldOp[] = Array.isArray(design.folds) ? design.folds.slice(0, 255) : [];
  const hasClip = design.clip !== null && typeof design.clip === 'object';
  const hasThrow = throwIn !== undefined && throwIn !== null;
  const paperIndex = PAPERS.findIndex((p) => p.id === design.paperId);

  b.push(0x01);
  b.push((hasClip ? 1 : 0) | (hasThrow ? 2 : 0));
  b.push(paperIndex >= 0 && paperIndex < 255 ? paperIndex : 255);
  b.push(folds.length);
  for (let i = 0; i < folds.length; i += 8) {
    let bits = 0;
    for (let k = 0; k < 8 && i + k < folds.length; k++) {
      if (folds[i + k]?.dir === 'mountain') bits |= 1 << k;
    }
    b.push(bits);
  }
  for (const f of folds) {
    pushI16(toI16(f?.a?.x, LEN_Q));
    pushI16(toI16(f?.a?.y, LEN_Q));
    pushI16(toI16(f?.b?.x, LEN_Q));
    pushI16(toI16(f?.b?.y, LEN_Q));
  }
  const s = design.shaping;
  pushI16(toI16(s?.keelM, LEN_Q));
  pushI16(toI16(s?.dihedralDeg, ANG_Q));
  pushI16(toI16(s?.wingletM, LEN_Q));
  pushI16(toI16(s?.wingletDeg, ANG_Q));
  pushI16(toI16(s?.elevatorDeg, ANG_Q));
  if (hasClip) pushI16(toI16(design.clip?.xBodyM, LEN_Q));
  if (hasThrow) {
    pushI16(toI16(throwIn.speedMps, SPD_Q));
    pushI16(toI16(throwIn.pitchDeg, ANG_Q));
    pushI16(toI16(throwIn.rollDeg, ANG_Q));
  }
  pushI16(crc16(b, b.length));
  return PREFIX + bytesToBase62(Uint8Array.from(b));
}

/** decodeDesign 의 결과 */
export interface DecodedDesign {
  design: PlaneDesign;
  /** 코드에 들어 있던 던지기 값. 지금의 LIMITS 범위 안일 때만 있다. */
  throwIn?: ThrowInput;
  /**
   * 코드에 던지기 값이 들어 있었지만 지금의 LIMITS 범위를 벗어나 쓸 수 없을 때, 그 원래 값(표시용).
   * 예: 던지기 한도가 16 m/s 이던 때(물리 1판)에 만든 코드의 12 m/s 던지기.
   * 이 값으로 계산하면 안 된다. 화면은 "예전 규칙으로 던진 기록이에요. 다시 던져 주세요" 라고 알려 주는 데만 쓴다.
   */
  throwOutOfRange?: ThrowInput;
}

/**
 * 코드를 설계로 되돌린다. 조금이라도 잘못된 코드면 null (예외를 던지지 않는다).
 * 되돌린 설계는 validateDesign 을 통과한 것만 돌려준다.
 *
 * 던지기 값의 호환 규칙 (던지기 한도를 16 -> 10 m/s 로 낮추면서 정했다)
 *  - 코드 형식("P1")은 그대로다. 예전 코드도 같은 방법으로 읽는다.
 *  - 접은 모양(설계)은 한도 변경과 무관하므로 언제나 그대로 돌려준다.
 *  - 던지기 값이 지금의 LIMITS 범위 안이면 throwIn 으로 돌려준다.
 *  - 범위를 벗어나면 throwIn 을 넣지 않고(= 던지기 값 없음) throwOutOfRange 에 원래 값을 담아 알린다.
 *    한도 안으로 잘라서 돌려주지 않는다: 10 m/s 로 자르면 "다른 던지기"가 되어 기록의 뜻이 바뀌기 때문이다.
 *    랭킹 서버와 화면은 throwIn 이 없는 코드를 기록으로 받지 않으므로, 예전의 센 던지기 기록은 자동으로 걸러진다.
 */
export function decodeDesign(code: string): DecodedDesign | null {
  try {
    if (typeof code !== 'string') return null;
    if (code.length <= PREFIX.length || code.length > MAX_CODE_LENGTH) return null;
    if (code.slice(0, PREFIX.length) !== PREFIX) return null;
    const body = code.slice(PREFIX.length);
    // 맨 앞이 '0' 이면 같은 값을 나타내는 다른 표기이므로 받지 않는다(코드 하나 = 설계 하나).
    if (body.charCodeAt(0) === 48) return null;
    const bytes = base62ToBytes(body);
    if (!bytes || bytes.length < 4 + 10 + 2) return null;
    if (bytes[0] !== 0x01) return null;

    const n = bytes.length;
    const crc = (bytes[n - 2]! << 8) | bytes[n - 1]!;
    if (crc16(Array.from(bytes), n - 2) !== crc) return null;

    const flags = bytes[1]!;
    if ((flags & ~3) !== 0) return null;
    const hasClip = (flags & 1) !== 0;
    const hasThrow = (flags & 2) !== 0;
    const paper = PAPERS[bytes[2]!];
    if (!paper) return null;
    const nFolds = bytes[3]!;
    if (nFolds > LIMITS.maxFolds) return null;

    const dirBytes = Math.ceil(nFolds / 8);
    const expected = 4 + dirBytes + nFolds * 8 + 10 + (hasClip ? 2 : 0) + (hasThrow ? 6 : 0) + 2;
    if (n !== expected) return null;

    let pos = 4 + dirBytes;
    const readI16 = (): number => {
      const u = (bytes[pos]! << 8) | bytes[pos + 1]!;
      pos += 2;
      return u >= 0x8000 ? u - 0x10000 : u;
    };
    // 정수 x 단위를 그대로 곱하면 0.07 같은 값에 미세한 꼬리가 붙으므로 한 번 더 다듬는다.
    const len = (i: number): number => Math.round(i) / 1e4;
    const ang = (i: number): number => Math.round(i) / 10;

    const folds: FoldOp[] = [];
    for (let i = 0; i < nFolds; i++) {
      const mountain = ((bytes[4 + (i >> 3)]! >> (i & 7)) & 1) === 1;
      const ax = len(readI16()), ay = len(readI16()), bx = len(readI16()), by = len(readI16());
      folds.push({ a: { x: ax, y: ay }, b: { x: bx, y: by }, dir: mountain ? 'mountain' : 'valley' });
    }
    const keelM = len(readI16());
    const dihedralDeg = ang(readI16());
    const wingletM = len(readI16());
    const wingletDeg = ang(readI16());
    const elevatorDeg = ang(readI16());
    const clip = hasClip ? { xBodyM: len(readI16()) } : null;

    const design: PlaneDesign = {
      v: 1,
      paperId: paper.id,
      folds,
      shaping: { keelM, dihedralDeg, wingletM, wingletDeg, elevatorDeg },
      clip,
    };
    if (!validateDesign(design).ok) return null;

    if (!hasThrow) return { design };
    const throwIn: ThrowInput = {
      speedMps: Math.round(readI16()) / 100,
      pitchDeg: ang(readI16()),
      rollDeg: ang(readI16()),
    };
    const inRange = throwIn.speedMps >= LIMITS.throwSpeedMin && throwIn.speedMps <= LIMITS.throwSpeedMax
      && throwIn.pitchDeg >= LIMITS.pitchMin && throwIn.pitchDeg <= LIMITS.pitchMax
      && throwIn.rollDeg >= LIMITS.rollMin && throwIn.rollDeg <= LIMITS.rollMax;
    if (!inRange) return { design, throwOutOfRange: throwIn };
    return { design, throwIn };
  } catch {
    return null;
  }
}
