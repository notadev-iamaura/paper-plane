/**
 * 내 캐릭터의 차림을 이 기기에 기억한다.
 * - 저장소(localStorage)가 막혀 있으면 이번 방문 동안만 기억한다(모든 접근은 storage.ts 가 try/catch 로 감싼다).
 * - 저장 모양: { v: 1, base, hair, hairColor, hat, hatColor, outfit, outfitColor, shoes, eyes, iris, skin, name }
 *   읽을 때마다 sanitizeLook 을 거치므로, 예전 판이 남긴 값이나 손댄 값이 와도 쓸 수 있는 차림이 된다.
 * - 차림은 꾸미기일 뿐이다. 비행기 코드, 랭킹에 보내는 값과는 따로 둔다.
 */
import { defaultLook, sanitizeLook } from './characterLook';
import type { CharacterLook } from './characterLook';
import { loadJson, saveJson } from './storage';

export const CHARACTER_KEY = 'pp.character.v1';
/** 대회장의 "캐릭터를 바꿀 수 있어요" 귀띔을 이미 봤는지 */
export const CHARACTER_NUDGE_KEY = 'pp.characterNudge.v1';

/** 저장소를 쓸 수 없을 때를 위한, 이번 방문 동안의 기억 */
let session: CharacterLook | null = null;
let nudgeSeen = false;

export function loadLook(): CharacterLook {
  if (session) return session;
  const raw = loadJson(CHARACTER_KEY);
  session = raw === null ? defaultLook() : sanitizeLook(raw);
  return session;
}

export function saveLook(look: CharacterLook): void {
  session = sanitizeLook(look);
  saveJson(CHARACTER_KEY, session);
}

export function nudgeWasSeen(): boolean {
  return nudgeSeen || loadJson(CHARACTER_NUDGE_KEY) === true;
}
export function markNudgeSeen(): void {
  nudgeSeen = true;
  saveJson(CHARACTER_NUDGE_KEY, true);
}
