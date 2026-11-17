/**
 * 내 캐릭터(주인공 아이)의 차림: 고를 수 있는 것의 목록, 고른 값(CharacterLook), 검사와 옮기기, "아무거나!".
 *
 * - 이 파일은 순수한 계산만 한다(DOM, three 를 쓰지 않는다). 저장은 characterStore.ts, 그리기는 three/kidGlb.ts 가 맡는다.
 * - 차림은 꾸미기일 뿐이다. 비행기 코드에도, 랭킹에 보내는 값에도 들어가지 않는다.
 * - 색 값은 여기 한곳에만 적는다. 기본 차림의 색은 tokens.css 의 색종이 색과 같은 값이다
 *   (tools/character/chars/kid.py 의 COLORS 와 같아야 기본 아이가 예전과 똑같이 보인다).
 */

// ---------------------------------------------------------------------------
// 색 도구(three.js 의 Color.lerp 와 같은 방식: 선형 공간에서 섞는다. tools/character/meshkit.py 의 mix_hex 와 결과가 같다)
// ---------------------------------------------------------------------------
const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
};
/** '#rrggbb' -> 선형 RGB(0~1) */
export function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
}
export function mixHex(a: string, b: string, k: number): string {
  const la = hexToLinear(a), lb = hexToLinear(b);
  return `#${[0, 1, 2].map((i) => Math.round(toSrgb(la[i]! + (lb[i]! - la[i]!) * k) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** tokens.css 와 같은 값(이 파일은 DOM 없이도 돌아야 해서 따로 적어 둔다) */
const T = {
  ink: '#1d2a4d', paper: '#fffdf6', red: '#ee4b3e', yellow: '#ffc533', blue: '#2f6fe0', green: '#2faa63', orange: '#f58a2e',
  pink: '#f27aa6', purple: '#8b62d9', sky: '#4fb6e8', skin: '#ffd9b8', courtDark: '#c98f48', mat: '#2f8f6b', paperShade: '#f1ecdd',
} as const;

// ---------------------------------------------------------------------------
// 고를 수 있는 것들
// ---------------------------------------------------------------------------
export const LOOK_VERSION = 1;

export const BASES = [
  { id: 'boy', name: '남자아이' },
  { id: 'girl', name: '여자아이' },
] as const;
export type BaseId = (typeof BASES)[number]['id'];

/** 머리 모양. 순서는 모델(tools/character/wardrobe.py 의 HAIR_ORDER)과 같아야 한다. */
export const HAIRS = [
  { id: 'short', name: '짧은 머리' },
  { id: 'bowl', name: '바가지 머리' },
  { id: 'spiky', name: '삐죽 머리' },
  { id: 'bob', name: '단발' },
  { id: 'pigtails', name: '양 갈래' },
  { id: 'ponytail', name: '묶은 머리' },
  { id: 'bun', name: '똥머리' },
  { id: 'long', name: '긴 머리' },
] as const;
export type HairId = (typeof HAIRS)[number]['id'];

export interface HairColor { id: string; name: string; main: string; deep: string }
const hc = (id: string, name: string, main: string, deep = mixHex(main, T.ink, 0.42)): HairColor => ({ id, name, main, deep });
export const HAIR_COLORS: readonly HairColor[] = [
  hc('black', '까만색', '#262433'),
  hc('darkbrown', '짙은 밤색', mixHex(T.ink, T.courtDark, 0.22), mixHex(T.ink, T.courtDark, 0.1)),
  hc('brown', '밤색', '#6e4630'),
  hc('lightbrown', '밝은 밤색', '#a56a3c'),
  hc('honey', '꿀색', '#d9a23f'),
  hc('redbrown', '단풍색', '#b9502f'),
  hc('pink', '솜사탕 분홍', '#f39ab6'),
  hc('blueblack', '밤하늘색', '#2c3f86'),
];

export const HATS = [
  { id: 'none', name: '안 써요', crown: false },
  { id: 'cap', name: '학교 모자', crown: true },
  { id: 'visor', name: '썬캡', crown: false },
  { id: 'band', name: '리본 머리띠', crown: false },
  { id: 'beanie', name: '방울 비니', crown: true },
  { id: 'bucket', name: '벙거지', crown: true },
] as const;
export type HatId = (typeof HATS)[number]['id'];

export interface HatColor { id: string; name: string; main: string; shade: string; button: string }
export const HAT_COLORS: readonly HatColor[] = [
  { id: 'yellow', name: '노랑', main: T.yellow, shade: T.orange, button: T.red },
  { id: 'red', name: '빨강', main: T.red, shade: '#9c2f3c', button: T.paper },
  { id: 'blue', name: '파랑', main: T.blue, shade: T.ink, button: T.yellow },
  { id: 'green', name: '초록', main: T.green, shade: '#1c6b55', button: T.yellow },
  { id: 'pink', name: '분홍', main: T.pink, shade: '#c2507f', button: T.paper },
  { id: 'purple', name: '보라', main: T.purple, shade: '#55389c', button: T.yellow },
  { id: 'white', name: '하양', main: T.paper, shade: '#9aa3c4', button: T.red },
];

export interface Colorway {
  name: string;
  top: string; trim: string; bottom: string; sock: string; accent: string;
  /** "아무거나!" 가 이 옷에 맞춰 고르는 모자 색, 신발 색 */
  hats: readonly string[]; shoes: readonly string[];
}
export interface Outfit { id: string; name: string; top: 'tee' | 'long'; bottom: 'short' | 'long'; extras: readonly ('zip' | 'hood' | 'skirt' | 'bib')[]; colors: readonly Colorway[] }
const cw = (name: string, top: string, trim: string, bottom: string, accent: string, hats: string[], shoes: string[], sock: string = T.paper): Colorway => ({ name, top, trim, bottom, sock, accent, hats, shoes });
export const OUTFITS = [
  {
    id: 'gym', name: '체육복', top: 'tee', bottom: 'short', extras: [],
    colors: [
      cw('파랑', T.paper, T.blue, T.blue, T.red, ['yellow', 'red', 'blue', 'white'], ['red', 'blue', 'white']),
      cw('빨강', T.paper, T.red, T.red, T.yellow, ['yellow', 'red', 'white'], ['red', 'white', 'ink']),
      cw('초록', T.paper, T.green, T.green, T.yellow, ['yellow', 'green', 'white'], ['yellow', 'white', 'green']),
      cw('남색', T.yellow, T.ink, T.ink, T.red, ['yellow', 'red', 'white'], ['red', 'yellow', 'ink']),
      cw('하늘', T.sky, T.paper, T.ink, T.yellow, ['yellow', 'white', 'blue'], ['white', 'yellow', 'blue']),
    ],
  },
  {
    id: 'track', name: '운동복', top: 'long', bottom: 'long', extras: ['zip'],
    colors: [
      cw('파랑', T.blue, T.paper, T.blue, T.yellow, ['yellow', 'white', 'blue', 'red'], ['red', 'white', 'yellow']),
      cw('빨강', T.red, T.paper, T.red, T.yellow, ['yellow', 'white', 'red'], ['white', 'ink', 'yellow']),
      cw('초록', T.mat, T.paper, T.mat, T.yellow, ['yellow', 'white', 'green'], ['white', 'yellow', 'red']),
      cw('분홍', T.pink, T.paper, mixHex(T.purple, T.ink, 0.25), T.yellow, ['pink', 'white', 'purple', 'yellow'], ['white', 'yellow']),
      cw('남색', T.ink, T.yellow, T.ink, T.yellow, ['yellow', 'red', 'white'], ['yellow', 'red', 'white']),
    ],
  },
  {
    id: 'skirt', name: '티셔츠와 치마', top: 'tee', bottom: 'short', extras: ['skirt'],
    colors: [
      cw('분홍', T.paper, T.pink, T.pink, T.yellow, ['pink', 'yellow', 'white', 'purple'], ['red', 'white', 'yellow']),
      cw('파랑', T.paper, T.blue, T.blue, T.red, ['yellow', 'red', 'blue', 'white'], ['red', 'white', 'blue']),
      cw('빨강', T.yellow, T.red, T.red, T.paper, ['yellow', 'red', 'white'], ['red', 'white', 'ink']),
      cw('보라', T.sky, T.paper, T.purple, T.yellow, ['purple', 'white', 'yellow', 'pink'], ['white', 'yellow']),
      cw('초록', T.paper, T.green, T.green, T.pink, ['yellow', 'green', 'pink', 'white'], ['yellow', 'white', 'red']),
    ],
  },
  {
    id: 'hoodie', name: '후드티', top: 'long', bottom: 'short', extras: ['hood'],
    colors: [
      cw('노랑', T.yellow, T.paper, T.blue, T.red, ['blue', 'red', 'white', 'yellow'], ['red', 'blue', 'white']),
      cw('빨강', T.red, T.paper, T.ink, T.yellow, ['yellow', 'red', 'white'], ['white', 'yellow', 'ink']),
      cw('하늘', T.sky, T.paper, T.ink, T.yellow, ['yellow', 'white', 'blue'], ['white', 'yellow', 'red']),
      cw('보라', T.purple, T.yellow, T.ink, T.yellow, ['yellow', 'purple', 'white', 'pink'], ['yellow', 'white']),
      cw('초록', T.green, T.paper, mixHex(T.courtDark, T.ink, 0.2), T.yellow, ['yellow', 'green', 'white'], ['white', 'yellow', 'red']),
    ],
  },
  {
    id: 'overalls', name: '멜빵바지', top: 'tee', bottom: 'short', extras: ['bib'],
    colors: [
      cw('청바지', T.paper, T.red, mixHex(T.blue, T.ink, 0.25), T.yellow, ['yellow', 'red', 'white', 'blue'], ['red', 'yellow', 'white']),
      cw('노랑 티', T.yellow, T.blue, mixHex(T.blue, T.ink, 0.25), T.red, ['red', 'blue', 'yellow', 'white'], ['red', 'white', 'blue']),
      cw('초록', T.paper, T.yellow, T.mat, T.yellow, ['yellow', 'green', 'white'], ['yellow', 'white', 'red']),
      cw('분홍', T.paper, T.purple, T.pink, T.paper, ['pink', 'purple', 'white', 'yellow'], ['white', 'yellow', 'red']),
      cw('빨강', mixHex(T.paper, T.sky, 0.35), T.paper, T.red, T.yellow, ['yellow', 'red', 'white'], ['white', 'yellow', 'ink']),
    ],
  },
] as const satisfies readonly Outfit[];
export type OutfitId = (typeof OUTFITS)[number]['id'];

export interface ShoeColor { id: string; name: string; main: string }
export const SHOE_COLORS: readonly ShoeColor[] = [
  { id: 'red', name: '빨강', main: T.red },
  { id: 'blue', name: '파랑', main: T.blue },
  { id: 'yellow', name: '노랑', main: T.yellow },
  { id: 'white', name: '하양', main: '#f4efe2' },
  { id: 'ink', name: '남색', main: '#2a3558' },
  { id: 'green', name: '초록', main: T.green },
];

export const EYES = [
  { id: 'round', name: '동글 눈' },
  { id: 'sparkle', name: '반짝 눈' },
  { id: 'sleepy', name: '반달 눈' },
  { id: 'upturned', name: '또랑 눈' },
  { id: 'dot', name: '콩알 눈' },
] as const;
export type EyeId = (typeof EYES)[number]['id'];

/** 눈동자 색: 위(짙은 색), 가운데, 아래(밝은 색) */
export interface IrisColor { id: string; name: string; top: string; mid: string; low: string; swatch: string }
export const IRIS_COLORS: readonly IrisColor[] = [
  { id: 'plum', name: '자두색', top: '#2c2148', mid: '#59397a', low: '#8a5488', swatch: '#59397a' },
  { id: 'brown', name: '밤색', top: '#2b1a14', mid: '#6b3f24', low: '#a8683a', swatch: '#6b3f24' },
  { id: 'black', name: '까만색', top: '#15131f', mid: '#2a2638', low: '#4a4458', swatch: '#2a2638' },
  { id: 'blue', name: '파란색', top: '#152a5c', mid: '#2f62b8', low: '#5aa4e0', swatch: '#2f62b8' },
  { id: 'green', name: '초록색', top: '#143a30', mid: '#2a7a58', low: '#63b47c', swatch: '#2a7a58' },
];

export interface SkinTone { id: string; name: string; main: string }
export const SKIN_TONES: readonly SkinTone[] = [
  { id: 'light', name: '밝은 살구색', main: '#ffe7d3' },
  { id: 'peach', name: '살구색', main: T.skin },
  { id: 'tan', name: '꿀빛', main: '#f1bd90' },
  { id: 'brown', name: '밤빛', main: '#c88b5f' },
  { id: 'deep', name: '코코아빛', main: '#9a6444' },
];

export const NAME_MAX = 6;
export const DEFAULT_NAME = '하늘';

// ---------------------------------------------------------------------------
// 고른 값
// ---------------------------------------------------------------------------
export interface CharacterLook {
  v: typeof LOOK_VERSION;
  base: BaseId;
  hair: HairId;
  hairColor: string;
  hat: HatId;
  hatColor: string;
  outfit: OutfitId;
  /** 그 옷의 몇 번째 색 조합인지 */
  outfitColor: number;
  shoes: string;
  eyes: EyeId;
  iris: string;
  skin: string;
  /** 이름표의 이름(1~6 자) */
  name: string;
}

export function defaultLook(): CharacterLook {
  return { v: LOOK_VERSION, base: 'boy', hair: 'short', hairColor: 'darkbrown', hat: 'cap', hatColor: 'yellow', outfit: 'gym', outfitColor: 0, shoes: 'red', eyes: 'round', iris: 'plum', skin: 'peach', name: DEFAULT_NAME };
}

/** 기본형이 미리 골라 주는 것: 머리 모양과 옷뿐이다. 그 뒤에는 무엇이든 바꿀 수 있다. */
export const BASE_PRESET: Record<BaseId, Pick<CharacterLook, 'hair' | 'outfit' | 'outfitColor'>> = {
  boy: { hair: 'short', outfit: 'gym', outfitColor: 0 },
  girl: { hair: 'pigtails', outfit: 'skirt', outfitColor: 0 },
};
export function applyBase(look: CharacterLook, base: BaseId): CharacterLook {
  return { ...look, base, ...BASE_PRESET[base] };
}

const has = <T extends { id: string }>(list: readonly T[], id: unknown): id is string => typeof id === 'string' && list.some((x) => x.id === id);
export const byId = <T extends { id: string }>(list: readonly T[], id: string): T => list.find((x) => x.id === id) ?? list[0]!;
export const outfitOf = (id: string): Outfit => byId<Outfit>(OUTFITS, id);
export const colorwayOf = (look: Pick<CharacterLook, 'outfit' | 'outfitColor'>): Colorway => {
  const o = outfitOf(look.outfit);
  return o.colors[look.outfitColor] ?? o.colors[0]!;
};

/** 이름에 넣지 않는 글자: 제어 문자, 폭 없는 글자, 줄 나눔 글자 */
const JUNK = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202f\\ufeff]', 'g');

/** 이름을 다듬는다: 줄바꿈과 제어 문자를 빼고, 앞뒤 빈칸을 지우고, 6 자까지만. 비면 기본 이름. */
export function cleanName(raw: unknown, fallback = DEFAULT_NAME): string {
  if (typeof raw !== 'string') return fallback;
  const s = Array.from(raw.replace(JUNK, ' ').replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('').trim();
  return s === '' ? fallback : s;
}
/** 입력하는 동안의 이름: 지우는 중에는 비어 있어도 된다(화면에는 그대로, 저장과 이름표에는 cleanName 을 쓴다). */
export function typingName(raw: string): string {
  return Array.from(raw.replace(JUNK, '')).slice(0, NAME_MAX).join('');
}

/**
 * 저장돼 있던 값을 지금 판의 차림으로 옮긴다. 어떤 값이 와도 예외 없이 쓸 수 있는 차림을 돌려준다.
 *  - 모르는 값, 사라진 선택지, 틀린 자료형은 그 칸만 기본값으로 바꾼다(나머지는 살린다).
 *  - 판 번호가 없던 시절의 값(v 없음)과 더 새로운 판의 값도 아는 칸만 골라 받는다.
 */
export function sanitizeLook(raw: unknown): CharacterLook {
  const d = defaultLook();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const outfit = has(OUTFITS, r.outfit) ? (r.outfit as OutfitId) : d.outfit;
  const n = outfitOf(outfit).colors.length;
  const oc = typeof r.outfitColor === 'number' && Number.isInteger(r.outfitColor) && r.outfitColor >= 0 && r.outfitColor < n ? r.outfitColor : 0;
  return {
    v: LOOK_VERSION,
    base: has(BASES, r.base) ? (r.base as BaseId) : d.base,
    hair: has(HAIRS, r.hair) ? (r.hair as HairId) : d.hair,
    hairColor: has(HAIR_COLORS, r.hairColor) ? r.hairColor : d.hairColor,
    hat: has(HATS, r.hat) ? (r.hat as HatId) : d.hat,
    hatColor: has(HAT_COLORS, r.hatColor) ? r.hatColor : d.hatColor,
    outfit,
    outfitColor: oc,
    shoes: has(SHOE_COLORS, r.shoes) ? r.shoes : d.shoes,
    eyes: has(EYES, r.eyes) ? (r.eyes as EyeId) : d.eyes,
    iris: has(IRIS_COLORS, r.iris) ? r.iris : d.iris,
    skin: has(SKIN_TONES, r.skin) ? r.skin : d.skin,
    name: cleanName(r.name),
  };
}

/** 값이 고칠 데 없이 올바른 차림인지(검사에 쓴다) */
export function isValidLook(x: unknown): x is CharacterLook {
  if (typeof x !== 'object' || x === null) return false;
  const s = sanitizeLook(x);
  const r = x as Record<string, unknown>;
  return (Object.keys(s) as (keyof CharacterLook)[]).every((k) => r[k] === s[k]) && Object.keys(r).length === Object.keys(s).length;
}

export const sameLook = (a: CharacterLook, b: CharacterLook): boolean => (Object.keys(a) as (keyof CharacterLook)[]).every((k) => a[k] === b[k]);

// ---------------------------------------------------------------------------
// 머리 모양과 모자가 만났을 때(우연에 맡기지 않고 표로 정한다)
// ---------------------------------------------------------------------------
export interface HairHatRule {
  /** 정수리의 머리카락(모자 테 위쪽, 똥머리, 삐죽 가닥)을 모자 속으로 숨긴다 */
  tuckCrown: boolean;
  /** 귀를 그린다(단발, 긴 머리는 머리카락이 귀를 덮는다) */
  ears: boolean;
  /** 모자가 드리우는 그늘을 머리와 머리카락에 더한다 */
  shade: boolean;
}
const EARS_HIDDEN: readonly HairId[] = ['bob', 'long'];
function rule(hair: HairId, hat: HatId): HairHatRule {
  const crown = byId(HATS, hat).crown;
  return { tuckCrown: crown, ears: !EARS_HIDDEN.includes(hair), shade: crown };
}
/** 모든 (머리 모양, 모자) 짝의 규칙. 새 머리 모양이나 모자를 더하면 이 표가 함께 늘어난다(검사가 빠진 짝을 잡는다). */
export const HAIR_HAT: Record<HairId, Record<HatId, HairHatRule>> = Object.fromEntries(
  HAIRS.map((h) => [h.id, Object.fromEntries(HATS.map((t) => [t.id, rule(h.id, t.id)]))]),
) as Record<HairId, Record<HatId, HairHatRule>>;

// ---------------------------------------------------------------------------
// 그릴 때 쓰는 값: 모델의 부분(색 자리)마다의 색, 필요한 메시 이름
// ---------------------------------------------------------------------------
/** 모델의 색 자리 이름(tools/character/wardrobe.py 의 SLOTS 와 같다) */
export type SlotName =
  | 'skin' | 'skin_shade' | 'hair' | 'hair_in' | 'shirt' | 'collar' | 'shorts' | 'shorts_in' | 'shirt_in' | 'shoe_in'
  | 'sock' | 'shoe' | 'sole' | 'toe' | 'lace' | 'cap' | 'cap_band' | 'cap_under' | 'cap_button' | 'accent' | 'zip';

export function slotColors(look: CharacterLook): Record<SlotName, string> {
  const skin = byId(SKIN_TONES, look.skin).main;
  const hair = byId(HAIR_COLORS, look.hairColor);
  const hat = byId(HAT_COLORS, look.hatColor);
  const c = colorwayOf(look);
  const shoe = byId(SHOE_COLORS, look.shoes).main;
  return {
    skin,
    skin_shade: mixHex(skin, T.pink, 0.22),
    hair: hair.main,
    hair_in: hair.deep,
    shirt: c.top,
    collar: c.trim,
    shorts: c.bottom,
    shorts_in: mixHex(c.bottom, T.ink, 0.35),
    shirt_in: mixHex(c.top, T.ink, 0.28),
    shoe_in: mixHex(shoe, T.ink, 0.35),
    sock: c.sock,
    shoe,
    sole: T.paper,
    toe: T.paper,
    lace: T.paper,
    cap: hat.main,
    cap_band: mixHex(hat.main, hat.shade, 0.22),
    cap_under: mixHex(hat.main, hat.shade, 0.42),
    cap_button: hat.button,
    accent: c.accent,
    zip: mixHex(T.paper, T.ink, 0.18),
  };
}

/** 이 차림을 그리는 데 필요한 메시 이름(kid_ 머리말 없이) */
export function piecesOf(look: CharacterLook): string[] {
  const o = outfitOf(look.outfit);
  const r = HAIR_HAT[look.hair][look.hat];
  const out = ['head', 'core', `top_${o.top}`, `bot_${o.bottom}`, `hair_${look.hair}`];
  if (r.ears) out.push('ears');
  if (look.hat !== 'none') out.push(`hat_${look.hat}`);
  for (const x of o.extras) out.push(`x_${x}`);
  return out;
}
/** 기본 파일(kid.glb)에 들어 있는 메시. 나머지는 옷장 파일(kid-wardrobe.glb)에 있다. */
export const MAIN_PIECES: readonly string[] = ['head', 'ears', 'core', 'top_tee', 'bot_short', 'hair_short', 'hat_cap'];
export const needsWardrobe = (look: CharacterLook): boolean => piecesOf(look).some((p) => !MAIN_PIECES.includes(p));

/** 기본 도형 아이(kid.ts)에 넘길 색: 모델을 불러오지 못해도 고른 색은 남는다. */
export function primColors(look: CharacterLook): { skin: string; hair: string; top: string; bottom: string; shoe: string; cap: string | null; tag: string } {
  const s = slotColors(look);
  return { skin: s.skin, hair: s.hair, top: s.shirt, bottom: s.shorts, shoe: s.shoe, cap: look.hat === 'none' ? null : s.cap, tag: look.name };
}

// ---------------------------------------------------------------------------
// "아무거나!"
// ---------------------------------------------------------------------------
/** 0 이상 1 미만의 수를 내는 함수(기본은 Math.random. 검사에서는 정해진 순서의 난수기를 넣는다). */
export type Rng = () => number;
const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;

/**
 * 잘 어울리는 조합만 고른다.
 *  - 옷과 색 조합을 먼저 정하고, 모자 색과 신발 색은 그 조합이 "어울린다"고 적어 둔 것 가운데서 고른다.
 *  - 분홍, 밤하늘색 머리는 가끔만 나온다. 이름과 기본형은 그대로 둔다.
 *  - 방금 차림과 똑같은 것은 내지 않는다.
 */
export function randomLook(prev: CharacterLook, rng: Rng = Math.random): CharacterLook {
  for (let tries = 0; tries < 8; tries++) {
    const outfit = pick(OUTFITS, rng);
    const outfitColor = Math.min(outfit.colors.length - 1, Math.floor(rng() * outfit.colors.length));
    const c = outfit.colors[outfitColor]!;
    const fun = rng() < 0.22;
    const hairs = HAIR_COLORS.filter((h) => (h.id === 'pink' || h.id === 'blueblack') === fun);
    const hat = rng() < 0.2 ? 'none' : pick(HATS.filter((h) => h.id !== 'none'), rng).id;
    const next: CharacterLook = {
      v: LOOK_VERSION, base: prev.base, name: prev.name,
      hair: pick(HAIRS, rng).id, hairColor: pick(hairs, rng).id,
      hat, hatColor: pick(c.hats, rng),
      outfit: outfit.id as OutfitId, outfitColor,
      shoes: pick(c.shoes, rng),
      eyes: pick(EYES, rng).id, iris: pick(IRIS_COLORS, rng).id,
      skin: pick(SKIN_TONES, rng).id,
    };
    if (!sameLook(next, prev)) return next;
  }
  return prev;
}
