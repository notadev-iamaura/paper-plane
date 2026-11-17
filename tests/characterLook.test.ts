/**
 * 내 캐릭터의 차림: 값 검사, 옛 값 옮기기, "아무거나!", 머리 모양과 모자의 짝 표.
 */
import { describe, expect, it } from 'vitest';
import {
  applyBase, BASES, cleanName, colorwayOf, DEFAULT_NAME, defaultLook, EYES, HAIR_COLORS, HAIR_HAT, HAIRS, HAT_COLORS, HATS, hexToLinear, IRIS_COLORS,
  isValidLook, LOOK_VERSION, MAIN_PIECES, mixHex, NAME_MAX, needsWardrobe, OUTFITS, piecesOf, primColors, randomLook, sameLook, sanitizeLook,
  SHOE_COLORS, SKIN_TONES, slotColors, typingName,
} from '../src/app/lib/characterLook';
import type { CharacterLook } from '../src/app/lib/characterLook';

/** 정해진 순서의 난수기(매번 같은 값) */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

describe('기본 차림', () => {
  it('고칠 데 없는 차림이고, 예전 주인공의 색 그대로다', () => {
    const d = defaultLook();
    expect(isValidLook(d)).toBe(true);
    expect(d.v).toBe(LOOK_VERSION);
    const c = slotColors(d);
    // tools/character/chars/kid.py 의 COLORS 와 같은 값이어야 기본 아이가 예전과 똑같이 보인다
    expect(c.skin).toBe('#ffd9b8');
    expect(c.shirt).toBe('#fffdf6');
    expect(c.collar).toBe('#2f6fe0');
    expect(c.shorts).toBe('#2f6fe0');
    expect(c.shoe).toBe('#ee4b3e');
    expect(c.cap).toBe('#ffc533');
    expect(c.cap_button).toBe('#ee4b3e');
    expect(c.hair).toBe(mixHex('#1d2a4d', '#c98f48', 0.22));
    expect(c.hair_in).toBe(mixHex('#1d2a4d', '#c98f48', 0.1));
    expect(c.cap_band).toBe(mixHex('#ffc533', '#f58a2e', 0.22));
    expect(c.shirt_in).toBe(mixHex('#fffdf6', '#1d2a4d', 0.28));
  });
  it('기본 차림은 기본 파일만으로 그릴 수 있다(옷장 파일을 받지 않는다)', () => {
    expect(needsWardrobe(defaultLook())).toBe(false);
    expect(piecesOf(defaultLook()).every((p) => MAIN_PIECES.includes(p))).toBe(true);
    expect(needsWardrobe({ ...defaultLook(), hair: 'bun' })).toBe(true);
    expect(needsWardrobe({ ...defaultLook(), hat: 'none' })).toBe(false);
  });
  it('색 섞기는 선형 공간에서 한다(three.js, meshkit.py 와 같은 결과)', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#bcbcbc');
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
  });
});

describe('값 검사와 옮기기', () => {
  it('엉뚱한 값이 와도 쓸 수 있는 차림을 돌려준다', () => {
    for (const raw of [null, undefined, 3, 'x', [], {}, { v: 99 }, { hair: 5, hat: {}, outfitColor: 'a' }, JSON.parse('{"__proto__":{"hair":"bun"}}')]) {
      const s = sanitizeLook(raw);
      expect(isValidLook(s)).toBe(true);
      expect(sameLook(s, defaultLook())).toBe(true);
    }
  });
  it('모르는 칸만 기본값으로 바꾸고 나머지는 살린다', () => {
    const s = sanitizeLook({ v: 1, hair: 'bun', hairColor: 'pink', hat: 'wizard', hatColor: 'rainbow', outfit: 'track', outfitColor: 3, shoes: 'ink', eyes: 'dot', iris: 'green', skin: 'deep', name: '보라', extra: 1 });
    expect(s.hair).toBe('bun');
    expect(s.hairColor).toBe('pink');
    expect(s.hat).toBe('cap');
    expect(s.hatColor).toBe('yellow');
    expect(s.outfit).toBe('track');
    expect(s.outfitColor).toBe(3);
    expect(s.skin).toBe('deep');
    expect(s.name).toBe('보라');
    expect('extra' in s).toBe(false);
  });
  it('옷이 바뀌어 색 번호가 범위를 벗어나면 첫 색으로 돌린다', () => {
    expect(sanitizeLook({ outfit: 'gym', outfitColor: 99 }).outfitColor).toBe(0);
    expect(sanitizeLook({ outfit: 'gym', outfitColor: -1 }).outfitColor).toBe(0);
    expect(sanitizeLook({ outfit: 'gym', outfitColor: 1.5 }).outfitColor).toBe(0);
    expect(sanitizeLook({ outfit: 'nope', outfitColor: 2 }).outfit).toBe('gym');
  });
  it('판 번호가 없던 값, 더 새로운 판의 값도 아는 칸만 받아 지금 판으로 옮긴다', () => {
    const old = sanitizeLook({ hair: 'bob', outfit: 'skirt', outfitColor: 1, name: '나래' });
    expect(old.v).toBe(LOOK_VERSION);
    expect(old.hair).toBe('bob');
    expect(old.outfit).toBe('skirt');
    expect(old.name).toBe('나래');
    const future = sanitizeLook({ v: 7, hair: 'mohawk', glasses: 'round', hat: 'beanie', name: '미래' });
    expect(future.v).toBe(LOOK_VERSION);
    expect(future.hair).toBe('short');
    expect(future.hat).toBe('beanie');
    expect(isValidLook(future)).toBe(true);
  });
  it('저장했다 읽어도 그대로다', () => {
    const look: CharacterLook = { ...defaultLook(), base: 'girl', hair: 'pigtails', hat: 'band', hatColor: 'pink', outfit: 'skirt', outfitColor: 2, eyes: 'sparkle', iris: 'blue', skin: 'tan', shoes: 'white', name: '하나둘셋' };
    expect(sameLook(sanitizeLook(JSON.parse(JSON.stringify(look))), look)).toBe(true);
  });
});

describe('이름', () => {
  it('1~6 자로 다듬는다', () => {
    expect(cleanName('  하늘  ')).toBe('하늘');
    expect(cleanName('일이삼사오육칠팔')).toBe('일이삼사오육');
    expect(Array.from(cleanName('가나다라마바사')).length).toBe(NAME_MAX);
    expect(cleanName('')).toBe(DEFAULT_NAME);
    expect(cleanName('   ')).toBe(DEFAULT_NAME);
    expect(cleanName(null)).toBe(DEFAULT_NAME);
    expect(cleanName(42)).toBe(DEFAULT_NAME);
  });
  it('줄바꿈, 제어 문자, 폭 없는 글자를 뺀다', () => {
    expect(cleanName('하\n늘')).toBe('하 늘');
    expect(cleanName('a\u0000b​c')).toBe('a b c');
    expect(cleanName('‮‮')).toBe(DEFAULT_NAME);
    expect(typingName('가\u0007나')).toBe('가나');
  });
  it('글자 수는 눈에 보이는 글자로 센다(쪼개진 반쪽 글자를 남기지 않는다)', () => {
    const s = cleanName('𠀀𠀁𠀂𠀃𠀄𠀅𠀆');
    expect(Array.from(s).length).toBe(NAME_MAX);
    expect(/[\ud800-\udbff]$/.test(s)).toBe(false);
    expect(typingName('1234567890')).toBe('123456');
    expect(typingName('')).toBe('');
  });
});

describe('기본형', () => {
  it('머리 모양과 옷만 미리 골라 주고, 나머지는 건드리지 않는다', () => {
    const mine: CharacterLook = { ...defaultLook(), hairColor: 'pink', hat: 'beanie', hatColor: 'blue', skin: 'brown', eyes: 'dot', iris: 'green', shoes: 'yellow', name: '마루' };
    for (const b of BASES) {
      const next = applyBase(mine, b.id);
      expect(isValidLook(next)).toBe(true);
      expect(next.base).toBe(b.id);
      for (const k of ['hairColor', 'hat', 'hatColor', 'skin', 'eyes', 'iris', 'shoes', 'name'] as const) expect(next[k]).toBe(mine[k]);
    }
    expect(applyBase(mine, 'girl').hair).toBe('pigtails');
    expect(applyBase(mine, 'boy').outfit).toBe('gym');
  });
  it('어느 기본형에서든 모든 머리 모양, 모자, 옷을 고를 수 있다(잠긴 것이 없다)', () => {
    for (const b of BASES) for (const h of HAIRS) for (const t of HATS) for (const o of OUTFITS) {
      expect(isValidLook({ ...applyBase(defaultLook(), b.id), hair: h.id, hat: t.id, outfit: o.id, outfitColor: 0 })).toBe(true);
    }
  });
});

describe('선택지의 수', () => {
  it('의뢰한 만큼 있다', () => {
    expect(BASES.length).toBe(2);
    expect(HAIRS.length).toBeGreaterThanOrEqual(6);
    expect(HAIR_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(HAIR_COLORS.length).toBeLessThanOrEqual(8);
    expect(HATS.length).toBeGreaterThanOrEqual(5);
    expect(HATS[0]!.id).toBe('none');
    expect(OUTFITS.length).toBeGreaterThanOrEqual(5);
    for (const o of OUTFITS) { expect(o.colors.length).toBeGreaterThanOrEqual(3); expect(o.colors.length).toBeLessThanOrEqual(5); }
    expect(SHOE_COLORS.length).toBeGreaterThanOrEqual(3);
    expect(EYES.length).toBeGreaterThanOrEqual(4);
    expect(EYES.length).toBeLessThanOrEqual(6);
    expect(IRIS_COLORS.length).toBeGreaterThanOrEqual(4);
    expect(IRIS_COLORS.length).toBeLessThanOrEqual(5);
    expect(SKIN_TONES.length).toBe(5);
  });
  it('id 가 겹치지 않고, 색 값은 모두 #rrggbb 다', () => {
    for (const list of [BASES, HAIRS, HAIR_COLORS, HATS, HAT_COLORS, OUTFITS, SHOE_COLORS, EYES, IRIS_COLORS, SKIN_TONES]) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    }
    const hex = /^#[0-9a-f]{6}$/;
    for (const h of HAIRS) for (const t of HATS) for (const o of OUTFITS) for (let i = 0; i < o.colors.length; i++) {
      for (const v of Object.values(slotColors({ ...defaultLook(), hair: h.id, hat: t.id, outfit: o.id, outfitColor: i }))) expect(v).toMatch(hex);
    }
    for (const c of [...HAIR_COLORS.flatMap((x) => [x.main, x.deep]), ...HAT_COLORS.flatMap((x) => [x.main, x.shade, x.button]), ...SKIN_TONES.map((x) => x.main), ...SHOE_COLORS.map((x) => x.main)]) expect(c).toMatch(hex);
  });
  it('색 조합이 "어울린다"고 적어 둔 모자 색, 신발 색은 실제로 있는 색이다', () => {
    for (const o of OUTFITS) for (const c of o.colors) {
      expect(c.hats.length).toBeGreaterThan(0);
      expect(c.shoes.length).toBeGreaterThan(0);
      for (const h of c.hats) expect(HAT_COLORS.some((x) => x.id === h)).toBe(true);
      for (const s of c.shoes) expect(SHOE_COLORS.some((x) => x.id === s)).toBe(true);
    }
  });
});

describe('머리 모양과 모자의 짝 표', () => {
  it('모든 짝에 규칙이 있다', () => {
    for (const h of HAIRS) for (const t of HATS) {
      const r = HAIR_HAT[h.id][t.id];
      expect(r).toBeDefined();
      expect(typeof r.tuckCrown).toBe('boolean');
      expect(typeof r.ears).toBe('boolean');
    }
    expect(Object.keys(HAIR_HAT).length).toBe(HAIRS.length);
    for (const h of HAIRS) expect(Object.keys(HAIR_HAT[h.id]).length).toBe(HATS.length);
  });
  it('정수리를 덮는 모자는 정수리 머리카락(똥머리, 삐죽 가닥)을 숨기고, 열린 모자는 그대로 둔다', () => {
    expect(HAIR_HAT.bun.cap.tuckCrown).toBe(true);
    expect(HAIR_HAT.bun.beanie.tuckCrown).toBe(true);
    expect(HAIR_HAT.spiky.bucket.tuckCrown).toBe(true);
    expect(HAIR_HAT.bun.visor.tuckCrown).toBe(false);
    expect(HAIR_HAT.bun.band.tuckCrown).toBe(false);
    expect(HAIR_HAT.bun.none.tuckCrown).toBe(false);
  });
  it('귀를 덮는 머리 모양은 귀를 그리지 않는다', () => {
    expect(piecesOf({ ...defaultLook(), hair: 'bob' })).not.toContain('ears');
    expect(piecesOf({ ...defaultLook(), hair: 'long' })).not.toContain('ears');
    expect(piecesOf({ ...defaultLook(), hair: 'short' })).toContain('ears');
  });
  it('차림마다 필요한 메시: 머리, 몸, 윗옷 하나, 바지 하나, 머리카락 하나, 모자는 많아야 하나', () => {
    for (const h of HAIRS) for (const t of HATS) for (const o of OUTFITS) {
      const p = piecesOf({ ...defaultLook(), hair: h.id, hat: t.id, outfit: o.id, outfitColor: 0 });
      expect(new Set(p).size).toBe(p.length);
      expect(p.filter((x) => x.startsWith('hair_'))).toEqual([`hair_${h.id}`]);
      expect(p.filter((x) => x.startsWith('hat_')).length).toBe(t.id === 'none' ? 0 : 1);
      expect(p.filter((x) => x.startsWith('top_')).length).toBe(1);
      expect(p.filter((x) => x.startsWith('bot_')).length).toBe(1);
      expect(p).toContain('head');
      expect(p).toContain('core');
    }
    expect(piecesOf({ ...defaultLook(), outfit: 'overalls' })).toContain('x_bib');
    expect(piecesOf({ ...defaultLook(), outfit: 'track' })).toEqual(expect.arrayContaining(['top_long', 'bot_long', 'x_zip']));
  });
});

describe('"아무거나!"', () => {
  it('언제나 고칠 데 없는 차림만 낸다', () => {
    const rng = seeded(20261115);
    let look = defaultLook();
    for (let i = 0; i < 3000; i++) {
      const next = randomLook(look, rng);
      expect(isValidLook(next)).toBe(true);
      look = next;
    }
  });
  it('모자 색과 신발 색은 그 옷의 색 조합이 어울린다고 적어 둔 것 가운데서 고른다', () => {
    const rng = seeded(7);
    let look = defaultLook();
    for (let i = 0; i < 2000; i++) {
      look = randomLook(look, rng);
      const c = colorwayOf(look);
      expect(c.hats).toContain(look.hatColor);
      expect(c.shoes).toContain(look.shoes);
    }
  });
  it('이름과 기본형은 그대로 두고, 방금 차림과 다른 것을 낸다', () => {
    const rng = seeded(99);
    let look: CharacterLook = { ...defaultLook(), base: 'girl', name: '보라' };
    for (let i = 0; i < 300; i++) {
      const next = randomLook(look, rng);
      expect(next.name).toBe('보라');
      expect(next.base).toBe('girl');
      expect(sameLook(next, look)).toBe(false);
      look = next;
    }
  });
  it('여러 번 누르면 모든 머리 모양, 모자, 옷, 눈, 피부색이 나온다', () => {
    const rng = seeded(1234);
    let look = defaultLook();
    const seen = { hair: new Set<string>(), hat: new Set<string>(), outfit: new Set<string>(), eyes: new Set<string>(), skin: new Set<string>(), hairColor: new Set<string>() };
    for (let i = 0; i < 1500; i++) {
      look = randomLook(look, rng);
      for (const k of Object.keys(seen) as (keyof typeof seen)[]) seen[k].add(String(look[k]));
    }
    expect(seen.hair.size).toBe(HAIRS.length);
    expect(seen.hat.size).toBe(HATS.length);
    expect(seen.outfit.size).toBe(OUTFITS.length);
    expect(seen.eyes.size).toBe(EYES.length);
    expect(seen.skin.size).toBe(SKIN_TONES.length);
    expect(seen.hairColor.size).toBe(HAIR_COLORS.length);
  });
  it('난수가 1 에 아주 가까워도 범위를 벗어나지 않는다', () => {
    expect(isValidLook(randomLook(defaultLook(), () => 0.9999999999))).toBe(true);
    expect(isValidLook(randomLook(defaultLook(), () => 0))).toBe(true);
  });
});

describe('도형 아이에게 넘기는 색', () => {
  it('모델을 불러오지 못해도 고른 색과 이름은 남는다', () => {
    const p = primColors({ ...defaultLook(), hairColor: 'pink', skin: 'deep', outfit: 'track', outfitColor: 1, shoes: 'blue', hat: 'none', name: '다온' });
    expect(p.hair).toBe(HAIR_COLORS.find((h) => h.id === 'pink')!.main);
    expect(p.skin).toBe(SKIN_TONES.find((s) => s.id === 'deep')!.main);
    expect(p.top).toBe('#ee4b3e');
    expect(p.bottom).toBe('#ee4b3e');
    expect(p.shoe).toBe('#2f6fe0');
    expect(p.cap).toBeNull();
    expect(p.tag).toBe('다온');
    expect(primColors(defaultLook()).cap).toBe('#ffc533');
  });
});
