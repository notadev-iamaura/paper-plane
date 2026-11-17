/**
 * 접기 판 실험실(개발 전용). FoldBoard 를 앱 없이 혼자 띄워서 손으로, 또 자동 시험(scripts/e2e-fold.mjs)으로 확인한다.
 * - 접기 목록과 되돌리기 기록은 여기(부모)가 갖는다. 실제 앱에서도 같은 식으로 붙이면 된다.
 * - 화면 아래에 접기 목록을 JSON 으로 보여 주고, 자동 시험이 읽을 수 있게 window.__foldLab 에도 넣어 둔다.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FoldOp } from '../../core/types';
import { getPaper, PAPERS } from '../../core/papers';
import { PRESETS } from '../../core/presets';
import { FoldBoard } from './FoldBoard';
import type { FoldTexture } from './types';
import { getPaperLook } from '../three/paperLook';
import '../tokens.css';

interface LabState { folds: FoldOp[]; guideDone: number; sounds: string[]; guide: FoldOp[] | null }
declare global {
  interface Window { __foldLab?: LabState }
}

const COLORS: { name: string; value: string }[] = [
  { name: '빨강', value: 'var(--red)' },
  { name: '노랑', value: 'var(--yellow)' },
  { name: '파랑', value: 'var(--blue)' },
  { name: '초록', value: 'var(--green)' },
];

function Lab(): JSX.Element {
  const paper = getPaper('copy80') ?? PAPERS[0]!;
  // 되돌리기 기록: past 의 마지막이 "지금" 바로 전, future 는 되돌린 것들
  const [hist, setHist] = useState<{ past: FoldOp[][]; now: FoldOp[]; future: FoldOp[][] }>({ past: [], now: [], future: [] });
  const [color, setColor] = useState(COLORS[0]!.value);
  const [guide, setGuide] = useState<FoldOp[] | null>(null);
  // 종이 무늬(신문지 등). null 이면 예전처럼 한 색으로 칠한다.
  const [lookId, setLookId] = useState<string | null>(null);
  const [showAside, setShowAside] = useState(false);
  const texture: FoldTexture | undefined = (() => {
    if (!lookId) return undefined;
    const look = getPaperLook(lookId, 'low');
    return { front: look.frontUrl(), back: look.backUrl(), frontTint: look.tint, backTint: look.backTint, sameBothSides: look.sameBothSides, translucency: look.translucency, thickness: look.thicknessM / 0.00027 };
  })();
  const [guideDone, setGuideDone] = useState(0);
  const sounds = useRef<string[]>([]);
  const [, bump] = useState(0);

  const setFolds = (next: FoldOp[]): void => setHist((h) => ({ past: [...h.past, h.now], now: next, future: [] }));
  const undo = (): void => setHist((h) => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), now: h.past[h.past.length - 1]!, future: [h.now, ...h.future] }));
  const redo = (): void => setHist((h) => (h.future.length === 0 ? h : { past: [...h.past, h.now], now: h.future[0]!, future: h.future.slice(1) }));

  useEffect(() => {
    window.__foldLab = { folds: hist.now, guideDone, sounds: sounds.current, guide };
  });

  const dart = PRESETS.find((p) => p.id === 'dart')!.design.folds;

  return (
    <main className="lab">
      <style>{LAB_CSS}</style>
      <FoldBoard
        paper={paper}
        folds={hist.now}
        onFolds={setFolds}
        canUndo={hist.past.length > 0}
        canRedo={hist.future.length > 0}
        onUndo={undo}
        onRedo={redo}
        onReset={() => setFolds([])}
        paperColor={color}
        texture={texture}
        aside={showAside ? <div data-testid="lab-aside" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>옆 칸</div> : undefined}
        guide={guide ?? undefined}
        onGuideDone={() => setGuideDone((n) => n + 1)}
        onSound={(name) => { sounds.current.push(name); bump((n) => n + 1); }}
      />

      <section className="lab__tools" aria-label="실험실 도구">
        <div className="lab__row" role="group" aria-label="색종이 색">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`lab__swatch${c.value === color ? ' is-on' : ''}`}
              style={{ background: c.value }}
              aria-label={`${c.name} 색종이`}
              aria-pressed={c.value === color}
              onClick={() => setColor(c.value)}
              data-testid={`lab-color-${c.name}`}
            />
          ))}
        </div>
        <div className="lab__row" role="group" aria-label="종이 무늬">
          {['newsprint', 'copy60', 'craft120', 'kent160'].map((id) => (
            <button key={id} type="button" className="lab__btn" aria-pressed={lookId === id} onClick={() => setLookId(id)} data-testid={`lab-paper-${id}`}>{id}</button>
          ))}
          <button type="button" className="lab__btn" onClick={() => setLookId(null)} data-testid="lab-paper-off">무늬 없음</button>
          <button type="button" className="lab__btn" aria-pressed={showAside} onClick={() => setShowAside((v) => !v)} data-testid="lab-aside-toggle">옆 칸</button>
        </div>
        <div className="lab__row">
          <button
            type="button" className="lab__btn" data-testid="lab-guide-dart"
            onClick={() => { setHist({ past: [], now: [], future: [] }); setGuide(dart); setGuideDone(0); }}
          >
            다트 따라 접기 시작
          </button>
          <button
            type="button" className="lab__btn" data-testid="lab-guide-off"
            onClick={() => setGuide(null)}
          >
            내 맘대로 접기
          </button>
        </div>
        <p className="lab__status" data-testid="lab-status">
          따라 접기 완료 {guideDone}번 · 소리 {sounds.current.length}번 ({sounds.current.slice(-4).join(', ') || '없음'})
        </p>
        <pre className="lab__json" data-testid="lab-json">{JSON.stringify(hist.now)}</pre>
      </section>
    </main>
  );
}

const LAB_CSS = `
html, body { height: 100%; margin: 0; }
body { background: var(--hall); color: var(--ink); font-family: var(--font-body); }
.lab { max-width: 592px; margin: 0 auto; padding: 12px var(--gutter) 40px; }
.lab__tools { margin-top: 18px; padding-top: 12px; border-top: 2px dashed var(--ink-soft); }
.lab__row { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.lab__swatch { width: var(--tap); height: var(--tap); border: var(--line); border-radius: var(--radius-small); cursor: pointer; }
.lab__swatch.is-on { box-shadow: var(--drop); transform: translateY(-2px); }
.lab__btn { min-height: var(--tap); padding: 0 14px; border: var(--line); border-radius: var(--radius-small); background: var(--paper); font: inherit; color: inherit; cursor: pointer; }
.lab__status { margin: 0 0 8px; font-size: var(--t-small); color: var(--ink-soft); }
.lab__json { margin: 0; padding: 8px; max-height: 160px; overflow: auto; white-space: pre-wrap; word-break: break-all; background: var(--paper); border: var(--line); border-radius: var(--radius-small); font-size: 11px; }
`;

const root = document.getElementById('lab');
if (root) createRoot(root).render(<Lab />);
