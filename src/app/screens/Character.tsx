/**
 * 내 캐릭터: 체육관 발판 위의 아이를 가까이서 보며 꾸민다.
 * - 위쪽은 체육관 무대(끌어서 돌려 본다), 아래쪽은 색종이 판: 갈래(기본형, 머리, 모자, 옷, 눈, 피부, 이름)와 선택지.
 * - 누르는 즉시 아이가 바뀐다(확인 단계 없음). 바뀌면 아이가 폴짝 뛰거나 새 모자를 올려다본다.
 * - 선택지의 작은 그림은 실제 3D 모델을 그 차림으로 한 번 그려 둔 것이다(무대가 그릴 수 없으면 이름만 보인다).
 * - 차림은 꾸미기일 뿐이라 비행기 코드, 랭킹과는 상관없다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  applyBase, BASES, byId, cleanName, colorwayOf, DEFAULT_NAME, defaultLook, EYES, HAIR_COLORS, HAIRS, HAT_COLORS, HATS, IRIS_COLORS,
  NAME_MAX, OUTFITS, randomLook, sameLook, SHOE_COLORS, SKIN_TONES, slotColors, typingName,
} from '../lib/characterLook';
import type { CharacterLook } from '../lib/characterLook';
import { useStageInsets } from '../lib/useInsets';
import { browOf, makeFaceCell } from '../three/faceAtlas';
import type { Stage } from '../three/GymStage';
import type { KidReact, ThumbView } from '../three/kidGlb';
import { Icon } from '../components/Icons';
import './character.css';

type Tab = 'base' | 'hair' | 'hat' | 'outfit' | 'shoes' | 'eyes' | 'skin' | 'name';
const TABS: readonly { id: Tab; name: string }[] = [
  { id: 'base', name: '기본형' }, { id: 'hair', name: '머리' }, { id: 'hat', name: '모자' }, { id: 'outfit', name: '옷' }, { id: 'shoes', name: '신발' },
  { id: 'eyes', name: '눈' }, { id: 'skin', name: '피부' }, { id: 'name', name: '이름' },
];

/** 갈래 단추와 "아무거나!" 의 작은 그림(직접 그린 SVG. 굵고 둥근 남색 선에 색종이 색) */
const ART: Record<Tab | 'dice', ReactNode> = {
  base: (<>
    <circle cx="12" cy="12.5" r="8" className="fill-skin" /><path d="M4.6 10.500C6 5.500 18 5.500 19.400 10.500c-2.4-1.800-4.400.2-7.400-1.500-3 1.700-5-.3-7.400 1.500z" className="c-fill-hair" />
    <path d="M9 13.200v1M15 13.200v1M9.500 16.500c1.500 1.200 3.500 1.200 5 0" />
  </>),
  hair: (<>
    <circle cx="12" cy="13.5" r="7" className="fill-skin" />
    <path d="M4.500 13C4 7 8 3.500 12 3.500S20 7 19.500 13c-1.500-1-1.500-3-2.500-4.500-1.500 1.500-3.500 1.500-5 0-1.500 1.500-3.500 1.500-5 0C6 10 6 12 4.500 13z" className="c-fill-hair" />
  </>),
  hat: (<>
    <path d="M4.500 14.500C4.500 9 8 5.500 12.500 5.500S19 9 19 14.500z" className="fill-yellow" /><path d="M2.500 15c3-1.500 6-1.500 9 0l-9 2.500z" className="fill-yellow" /><circle cx="12.500" cy="5" r="1.200" className="fill-red" />
  </>),
  outfit: (<>
    <path d="M8.500 4.500 4 7.500l2 3.500 2-1v9.500h8V10l2 1 2-3.500-4.500-3c-.8 1.500-2 2.200-3.500 2.200S9.300 6 8.500 4.500z" className="fill-paper" /><path d="M8 16.500h8" className="c-stroke-blue" />
  </>),
  shoes: (<>
    <path d="M3.500 16.500v-5.500c2 .8 3.500.5 4.500-1l3 3.500c2.500.5 9.500 1 9.500 4v1.500h-17z" className="fill-red" /><path d="M3.500 17.500h17" className="stroke-paper" /><path d="M11 13.500l1.500-1.500M13.500 14.200l1.500-1.500" className="stroke-paper" />
  </>),
  eyes: (<>
    <ellipse cx="12" cy="12.500" rx="5.500" ry="7" className="c-fill-ink" /><circle cx="10" cy="9.500" r="2" className="c-fill-white" /><circle cx="14" cy="15" r="1" className="c-fill-white" /><path d="M5.500 7.500c2-3 6-4 9.500-2.500" />
  </>),
  skin: (<>
    <circle cx="8" cy="9.500" r="4.500" className="c-skin-1" /><circle cx="16" cy="9.500" r="4.500" className="c-skin-3" /><circle cx="12" cy="15.500" r="4.500" className="c-skin-2" />
  </>),
  name: (<>
    <path d="M3.500 7.500h17v10h-17z" className="fill-yellow" /><path d="M7 11h5M7 14h9" /><path d="M12 7.500v-3" />
  </>),
  dice: (<>
    <path d="M5 5h14v14H5z" className="fill-paper" /><circle cx="9" cy="9" r=".9" className="c-fill-ink" /><circle cx="15" cy="15" r=".9" className="c-fill-ink" /><circle cx="12" cy="12" r=".9" className="c-fill-ink" /><circle cx="15" cy="9" r=".9" className="c-fill-ink" /><circle cx="9" cy="15" r=".9" className="c-fill-ink" />
  </>),
};
function Art({ name, size = 26 }: { name: Tab | 'dice'; size?: number }): JSX.Element {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ART[name]}</svg>;
}

// ---------------------------------------------------------------------------
// 선택지의 작은 그림: 무대가 실제 모델을 그 차림으로 그려 준다. 한 번 그린 것은 기억해 둔다.
// ---------------------------------------------------------------------------
const THUMB_PX = 132;
const thumbCache = new Map<string, string>();
interface ThumbJob { key: string; look: CharacterLook; view: ThumbView }
const jobKey = (look: CharacterLook, view: ThumbView): string => `${view}|${look.hair}|${look.hairColor}|${look.hat}|${look.hatColor}|${look.outfit}|${look.outfitColor}|${look.shoes}|${look.eyes}|${look.iris}|${look.skin}`;

/** 지금 보이는 선택지의 그림을 하나씩(프레임 사이사이에) 그려 채운다. */
function useThumbs(stage: Stage | null, jobs: ThumbJob[]): Record<string, string> {
  const [, bump] = useState(0);
  const sig = jobs.map((j) => j.key).join(',');
  useEffect(() => {
    if (!stage?.kidThumb) return;
    let timer = 0, tries = 0, dead = false;
    const run = (): void => {
      if (dead) return;
      const job = jobs.find((j) => !thumbCache.has(j.key));
      if (!job) return;
      let url: string | null = null;
      try {
        const c = stage.kidThumb?.(job.look, job.view, THUMB_PX) ?? null;
        url = c ? c.toDataURL('image/png') : null;
      } catch { url = null; }
      if (url) {
        if (thumbCache.size > 220) thumbCache.clear();
        thumbCache.set(job.key, url);
        tries = 0;
        bump((n) => n + 1);
        timer = window.setTimeout(run, 30);
      } else if (++tries < 60) {
        // 모델이나 옷장 파일이 아직 오는 중이다: 조금 뒤에 다시
        timer = window.setTimeout(run, 350);
      }
    };
    timer = window.setTimeout(run, 120);
    return () => { dead = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, sig]);
  const out: Record<string, string> = {};
  for (const j of jobs) { const u = thumbCache.get(j.key); if (u) out[j.key] = u; }
  return out;
}

interface Props {
  stage: Stage | null;
  look: CharacterLook;
  onChange: (look: CharacterLook) => void;
  onDone: () => void;
}

export function Character({ stage, look, onChange, onDone }: Props): JSX.Element {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('base');
  const [nameDraft, setNameDraft] = useState(look.name);
  const [spun, setSpun] = useState(false);
  useStageInsets(stage, sheetRef, tab);

  useEffect(() => {
    stage?.showDress?.();
    return () => { stage?.setDressSpin?.(0); };
  }, [stage]);

  /** 차림을 바꾸고 아이를 반응시킨다. */
  const change = useCallback((next: CharacterLook, react: KidReact | null = 'hop') => {
    if (sameLook(next, look)) return;
    stage?.setCharacter?.(next, react ?? undefined);
    onChange(next);
  }, [look, onChange, stage]);

  // ---- 끌어서 돌려 보기 ----
  const spin = useRef({ id: -1, x: 0, base: 0, at: 0 });
  const onDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // 돌리기 단추를 누른 것은 끌기가 아니다(끌기로 잡아 버리면 단추가 눌리지 않는다)
    if ((e.target as Element).closest?.('button')) return;
    spin.current.id = e.pointerId;
    spin.current.x = e.clientX;
    spin.current.base = spin.current.at;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (spin.current.id !== e.pointerId) return;
    spin.current.at = spin.current.base + (e.clientX - spin.current.x) * 0.012;
    stage?.setDressSpin?.(spin.current.at);
    if (!spun && Math.abs(e.clientX - spin.current.x) > 12) setSpun(true);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (spin.current.id === e.pointerId) spin.current.id = -1;
  };
  const turn = (d: number): void => {
    spin.current.at += d;
    stage?.setDressSpin?.(spin.current.at);
    setSpun(true);
  };

  // ---- 작은 그림들 ----
  const jobs = useMemo<ThumbJob[]>(() => {
    const mk = (l: CharacterLook, view: ThumbView): ThumbJob => ({ key: jobKey(l, view), look: l, view });
    if (tab === 'base') return BASES.map((b) => mk(applyBase(look, b.id), 'body'));
    if (tab === 'hair') return HAIRS.map((h) => mk({ ...look, hair: h.id, hat: 'none' }, 'head'));
    if (tab === 'hat') return HATS.map((h) => mk({ ...look, hat: h.id }, 'head'));
    if (tab === 'outfit') return OUTFITS.map((o) => mk({ ...look, outfit: o.id, outfitColor: o.id === look.outfit ? look.outfitColor : 0 }, 'body'));
    return [];
  }, [tab, look]);
  const thumbs = useThumbs(stage, jobs);
  const eyeThumbs = useMemo(() => {
    if (tab !== 'eyes') return {} as Record<string, string>;
    const out: Record<string, string> = {};
    const s = slotColors(look);
    for (const e of EYES) {
      try { out[e.id] = makeFaceCell({ kind: 'kid', brow: browOf(s.hair), px: 0.75, eyes: e.id, iris: byId(IRIS_COLORS, look.iris), skin: s.skin }).toDataURL('image/png'); } catch { /* 그림 없이 이름만 */ }
    }
    return out;
  }, [tab, look]);

  const colors = slotColors(look);
  const outfit = OUTFITS.find((o) => o.id === look.outfit) ?? OUTFITS[0];
  const way = colorwayOf(look);
  const isDefault = sameLook(look, { ...defaultLook(), name: look.name }) && look.name === DEFAULT_NAME;

  const card = (key: string, on: boolean, label: string, img: string | undefined, onPick: () => void, testid: string, extra = ''): JSX.Element => (
    <button key={key} type="button" role="radio" aria-checked={on} className={`ccard${on ? ' is-on' : ''}${extra}`} onClick={onPick} data-testid={testid}>
      <span className="ccard__pic">{img ? <img src={img} alt="" draggable={false} /> : <span className="ccard__wait" aria-hidden="true" />}</span>
      <span className="ccard__name">{label}</span>
    </button>
  );
  const dot = (key: string, on: boolean, label: string, bg: string, onPick: () => void, testid: string, bg2?: string): JSX.Element => (
    <button key={key} type="button" role="radio" aria-checked={on} aria-label={label} title={label} className={`cdot${on ? ' is-on' : ''}`} onClick={onPick} data-testid={testid}>
      <span className="cdot__ink" style={{ background: bg2 ? `linear-gradient(${bg} 0 52%, ${bg2} 52% 100%)` : bg }} />
    </button>
  );

  return (
    <section className="creator" aria-labelledby="creator-title" data-testid="creator">
      <div className="creator__stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="creator-stage">
        <div className="creator__turn">
          <button type="button" className="iconbtn" onClick={() => turn(-Math.PI / 4)} aria-label="왼쪽으로 돌리기" data-testid="creator-turn-left"><Icon name="back" size={22} /></button>
          <button type="button" className="iconbtn" onClick={() => turn(Math.PI / 4)} aria-label="오른쪽으로 돌리기" data-testid="creator-turn-right"><Icon name="next" size={22} /></button>
        </div>
        {!spun && <span className="creator__tip tape tape--yellow">끌어서 돌려 봐요</span>}
      </div>

      <div className="sheet creator__sheet" ref={sheetRef}>
        <div className="creator__head">
          <h1 id="creator-title" className="creator__title">내 캐릭터</h1>
          <button type="button" className="btn btn--small" onClick={() => change(randomLook(look))} data-testid="creator-random"><Art name="dice" size={22} />아무거나!</button>
          <button type="button" className="btn btn--small" disabled={isDefault} onClick={() => { setNameDraft(DEFAULT_NAME); change(defaultLook()); }} data-testid="creator-reset"><Icon name="undo" size={20} />처음으로</button>
        </div>

        <div className="ctabs" role="tablist" aria-label="꾸밀 곳 고르기">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`ctab-${t.id}`} aria-selected={tab === t.id} aria-controls="creator-panel" className={`ctab${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)} data-testid={`ctab-${t.id}`}>
              <Art name={t.id} size={26} /><span>{t.name}</span>
            </button>
          ))}
        </div>

        <div className="creator__panel" id="creator-panel" role="tabpanel" aria-labelledby={`ctab-${tab}`} data-testid="creator-panel">
          {tab === 'base' && (<>
            <div className="crow crow--two" role="radiogroup" aria-label="기본형">
              {BASES.map((b) => card(b.id, look.base === b.id, b.name, thumbs[jobKey(applyBase(look, b.id), 'body')], () => change(applyBase(look, b.id)), `base-${b.id}`, ' ccard--wide'))}
            </div>
            <p className="creator__note">처음 모습만 골라 주는 거예요. 머리도 옷도 마음대로 바꿀 수 있어요.</p>
          </>)}

          {tab === 'hair' && (<>
            <div className="crow" role="radiogroup" aria-label="머리 모양">
              {HAIRS.map((h) => card(h.id, look.hair === h.id, h.name, thumbs[jobKey({ ...look, hair: h.id, hat: 'none' }, 'head')], () => change({ ...look, hair: h.id }), `hair-${h.id}`))}
            </div>
            <div className="cline"><span className="cline__label">머리 색</span>
              <div className="crow crow--dots" role="radiogroup" aria-label="머리 색">
                {HAIR_COLORS.map((c) => dot(c.id, look.hairColor === c.id, c.name, c.main, () => change({ ...look, hairColor: c.id }), `haircolor-${c.id}`))}
              </div>
            </div>
          </>)}

          {tab === 'hat' && (<>
            <div className="crow" role="radiogroup" aria-label="모자">
              {HATS.map((h) => card(h.id, look.hat === h.id, h.name, thumbs[jobKey({ ...look, hat: h.id }, 'head')], () => change({ ...look, hat: h.id }, 'look'), `hat-${h.id}`))}
            </div>
            <div className={`cline${look.hat === 'none' ? ' is-off' : ''}`}><span className="cline__label">모자 색</span>
              <div className="crow crow--dots" role="radiogroup" aria-label="모자 색">
                {HAT_COLORS.map((c) => dot(c.id, look.hatColor === c.id, c.name, c.main, () => change({ ...look, hatColor: c.id }, 'look'), `hatcolor-${c.id}`))}
              </div>
            </div>
          </>)}

          {tab === 'outfit' && (<>
            <div className="crow" role="radiogroup" aria-label="옷">
              {OUTFITS.map((o) => card(o.id, look.outfit === o.id, o.name, thumbs[jobKey({ ...look, outfit: o.id, outfitColor: o.id === look.outfit ? look.outfitColor : 0 }, 'body')], () => change({ ...look, outfit: o.id, outfitColor: 0 }), `outfit-${o.id}`))}
            </div>
            <div className="cline"><span className="cline__label">옷 색</span>
              <div className="crow crow--dots" role="radiogroup" aria-label="옷 색">
                {outfit.colors.map((c, i) => dot(String(i), look.outfitColor === i, c.name, c.top === c.bottom ? c.top : c.top, () => change({ ...look, outfitColor: i }), `outfitcolor-${i}`, c.bottom))}
              </div>
            </div>
          </>)}

          {tab === 'shoes' && (<>
            <div className="crow crow--dots crow--big" role="radiogroup" aria-label="신발 색">
              {SHOE_COLORS.map((c) => dot(c.id, look.shoes === c.id, c.name, c.main, () => change({ ...look, shoes: c.id }), `shoes-${c.id}`))}
            </div>
            <p className="creator__note">운동화 색을 골라요. 밑창과 끈은 하얀색이에요.</p>
          </>)}

          {tab === 'eyes' && (<>
            <div className="crow" role="radiogroup" aria-label="눈 모양">
              {EYES.map((e) => (
                <button key={e.id} type="button" role="radio" aria-checked={look.eyes === e.id} className={`ccard ccard--face${look.eyes === e.id ? ' is-on' : ''}`} onClick={() => change({ ...look, eyes: e.id })} data-testid={`eyes-${e.id}`}>
                  <span className="ccard__pic" style={{ background: colors.skin }}>{eyeThumbs[e.id] ? <img src={eyeThumbs[e.id]} alt="" draggable={false} /> : null}</span>
                  <span className="ccard__name">{e.name}</span>
                </button>
              ))}
            </div>
            <div className="cline"><span className="cline__label">눈동자 색</span>
              <div className="crow crow--dots" role="radiogroup" aria-label="눈동자 색">
                {IRIS_COLORS.map((c) => dot(c.id, look.iris === c.id, c.name, c.swatch, () => change({ ...look, iris: c.id }), `iris-${c.id}`))}
              </div>
            </div>
          </>)}

          {tab === 'skin' && (<>
            <div className="crow crow--dots crow--big" role="radiogroup" aria-label="피부색">
              {SKIN_TONES.map((c) => dot(c.id, look.skin === c.id, c.name, c.main, () => change({ ...look, skin: c.id }), `skin-${c.id}`))}
            </div>
            <p className="creator__note">내 마음에 드는 색으로 골라요.</p>
          </>)}

          {tab === 'name' && (
            <div className="cname">
              <label className="cname__label" htmlFor="creator-name">이름표에 쓸 이름</label>
              <div className="cname__row">
                <input
                  id="creator-name" className="cname__input" type="text" inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
                  maxLength={NAME_MAX * 2} value={nameDraft} placeholder={DEFAULT_NAME} data-testid="creator-name"
                  onChange={(e) => {
                    const v = typingName(e.target.value);
                    setNameDraft(v);
                    change({ ...look, name: cleanName(v) }, null);
                  }}
                  onBlur={() => setNameDraft(cleanName(nameDraft))}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <span className="cname__tag tape tape--yellow" aria-hidden="true" data-testid="creator-name-preview">{cleanName(nameDraft)}</span>
              </div>
              <p className="creator__note">{NAME_MAX}글자까지 쓸 수 있어요. 가슴의 이름표에 적혀요.</p>
            </div>
          )}
        </div>

        <button type="button" className="btn btn--primary btn--xl" onClick={onDone} data-testid="creator-done">
          <Icon name="check" size={26} />다 됐어요
        </button>
        <span className="sr-only" aria-live="polite" data-testid="creator-live">{`${byId(HAIRS, look.hair).name}, ${byId(HATS, look.hat).name}, ${outfit.name} ${way.name}`}</span>
      </div>
    </section>
  );
}
