/**
 * 격납고: 넣어 둔 비행기를 자랑스럽게 늘어놓는 곳.
 * 체육관 창고의 나무 선반장(3D)에 비행기가 이름표와 함께 놓여 있고, 하나를 누르면 돌림판 받침대로 나온다.
 * 3D 를 쓸 수 없는 기기에서는 같은 내용을 그림 딱지 목록(2D)으로 보여 준다.
 * 저장과 대화상자, 알림은 HangarKit 이 맡는다. 이 화면은 보여 주고 고르는 일만 한다.
 */
import { createPortal } from 'react-dom';
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PHYSICS_VERSION } from '../../core/index';
import type { GameMode, PlaneGeometry } from '../../core/index';
import { copyText } from '../lib/clipboard';
import { evaluateDesign } from '../lib/evaluation';
import { fmt } from '../lib/format';
import { championOf, designOfCode, HANGAR_MAX, sortPlanes } from '../lib/hangar';
import type { HangarSort, SavedPlane } from '../lib/hangar';
import { eulReul, kidDate, originWord, paperWord, tagLine } from '../lib/hangarWords';
import { balanceOf, forecastOf } from '../lib/kidvoice';
import { labNoteShort } from '../lib/lab/labMath';
import { codeNote } from '../lib/lab/labStore';
import { log } from '../lib/logger';
import { Dialog } from '../components/Dialog';
import { HangarIcon } from '../components/HangarIcons';
import { useHangarApi } from '../components/HangarKit';
import { Icon } from '../components/Icons';
import { LabIcon } from '../components/LabBits';
import { CodeCopy } from '../components/ShareDialog';
import { Silhouette } from '../components/Silhouette';
import { HangarCanvas } from '../three/HangarCanvas';
import { paperTint } from '../three/hangarPaper';
import type { HangarItem, HangarStage } from '../three/HangarStage';
import { Notebook } from './Notebook';
import './hangar.css';

interface Props {
  mode: GameMode;
  /** 다른 큰 판(연구 노트 등)에 가려졌으면 false: 3D 그리기를 쉰다 */
  active: boolean;
  onGoDesk: () => void;
  /** 고른 비행기를 바람 실험실에 올린다 */
  onLab?: (id: string) => void;
}

const SORTS: { id: HangarSort; label: string }[] = [
  { id: 'recent', label: '최근' },
  { id: 'far', label: '멀리' },
  { id: 'long', label: '오래' },
  { id: 'fav', label: '즐겨찾기' },
];

const FLAT_NOTE: Record<'nogl' | 'lost' | 'slow', string> = {
  nogl: '이 기기에서는 입체 격납고를 보여 줄 수 없어서 그림으로 보여 줘요.',
  lost: '입체 격납고가 멈춰서 그림으로 바꿔 보여 줘요.',
  slow: '입체 격납고가 너무 느려서 그림으로 바꿔 보여 줘요.',
};

function geometryOf(code: string): PlaneGeometry | null {
  const d = designOfCode(code);
  if (!d) return null;
  try {
    return evaluateDesign(d, code).geometry;
  } catch (err) {
    log.warn('hangar', '비행기 모양을 만들지 못했어요', err);
    return null;
  }
}

export function Hangar({ mode, active, onGoDesk, onLab }: Props): JSX.Element {
  const api = useHangarApi();
  const planes = api.data.planes;
  const [sort, setSort] = useState<HangarSort>('recent');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [flat, setFlat] = useState<'nogl' | 'lost' | 'slow' | null>(null);
  const [stage, setStage] = useState<HangarStage | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [copyCode, setCopyCode] = useState<string | null>(null);
  const [swiped, setSwiped] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => sortPlanes(planes, sort), [planes, sort]);
  const picked = pickedId !== null ? (planes.find((p) => p.id === pickedId) ?? null) : null;
  // 고른 비행기가 버려졌거나 지금 차례에 없으면 고른 것을 푼다.
  useEffect(() => {
    if (pickedId !== null && !sorted.some((p) => p.id === pickedId)) setPickedId(null);
  }, [pickedId, sorted]);

  const far = useMemo(() => championOf(planes, 'distance'), [planes]);
  const long = useMemo(() => championOf(planes, 'airtime'), [planes]);
  const items = useMemo<HangarItem[]>(() => sorted.map((p) => ({
    id: p.id, code: p.code, paperId: p.paperId, name: p.name,
    line: tagLine(p, sort === 'long' ? 'airtime' : 'distance'),
    fav: p.favourite,
    farChamp: far?.id === p.id && planes.length > 1,
    longChamp: long?.id === p.id && planes.length > 1,
  })), [sorted, sort, far, long, planes.length]);

  useEffect(() => { stage?.setItems(items); }, [stage, items]);
  useEffect(() => { stage?.select(picked ? picked.id : null); }, [stage, picked]);

  // 위쪽 간판과 아래쪽(또는 오른쪽) 판이 가린 만큼 장면의 가운데를 옮긴다.
  useLayoutEffect(() => {
    if (!stage) return;
    const apply = (): void => {
      const root = rootRef.current;
      if (!root) return;
      const rr = root.getBoundingClientRect();
      const top = headRef.current ? Math.max(0, headRef.current.getBoundingClientRect().bottom - rr.top) : 0;
      let bottom = 0, right = 0;
      const pr = panelRef.current?.getBoundingClientRect();
      if (pr && pr.width > 0) {
        if (pr.width >= rr.width * 0.7) bottom = Math.max(0, Math.min(rr.height * 0.72, rr.bottom - pr.top));
        else right = Math.max(0, rr.right - pr.left);
      }
      stage.setInsets({ top, right, bottom, left: 0 }, panelRef.current !== null);
    };
    apply();
    const ro = new ResizeObserver(apply);
    if (headRef.current) ro.observe(headRef.current);
    if (panelRef.current) ro.observe(panelRef.current);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [stage, picked !== null]);

  const onFlat = useCallback((why: 'nogl' | 'lost' | 'slow') => {
    log.warn('hangar', FLAT_NOTE[why]);
    setFlat(why);
  }, []);
  const onPick = useCallback((id: string | null) => setPickedId(id), []);

  // Esc: 고른 비행기를 선반에 도로 놓는다(대화상자가 떠 있으면 대화상자가 먼저 닫힌다).
  const overlayRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !overlayRef.current && document.querySelector('.dialog') === null) setPickedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const copy = (p: SavedPlane): void => {
    // 가장 잘 날았을 때 던진 방법까지 든 코드가 있으면 그것을, 없으면 모양만 든 코드를 준다.
    const code = (mode === 'distance' ? p.best.distance : p.best.airtime)?.throwCode ?? p.best.distance?.throwCode ?? p.best.airtime?.throwCode ?? p.code;
    // 클립보드는 반드시 누름 처리 안에서 부른다.
    void copyText(code).then((ok) => {
      if (ok) api.toast({ text: `'${p.name}'의 코드를 복사했어요! 친구에게 붙여 넣어 보내요.`, ms: 3200 });
      else setCopyCode(code);
    });
  };

  const confirmPlane = confirmId !== null ? (planes.find((p) => p.id === confirmId) ?? null) : null;
  const notebookPlane = notebookId !== null ? (planes.find((p) => p.id === notebookId) ?? null) : null;
  const notebookDesign = notebookPlane ? designOfCode(notebookPlane.code) : null;
  const empty = planes.length === 0;
  const noFav = !empty && sort === 'fav' && sorted.length === 0;
  const use3d = flat === null;
  const overlayOpen = confirmPlane !== null || notebookPlane !== null || copyCode !== null;
  overlayRef.current = overlayOpen;

  return (
    <section ref={rootRef} className={`hangar${picked ? ' is-picked' : ''}${use3d ? '' : ' hangar--flat'}`} aria-labelledby="hangar-title" data-testid="hangar" data-view={use3d ? '3d' : 'flat'} data-count={planes.length} onPointerDownCapture={swiped ? undefined : () => setSwiped(true)}>
      {use3d && <HangarCanvas onStage={setStage} onFlat={onFlat} geometryOf={geometryOf} onPick={onPick} active={active && !overlayOpen} />}

      <div className="hg-head" ref={headRef}>
        <div className="hg-sign">
          <h1 id="hangar-title" className="hg-sign__title">격납고</h1>
          <p className="hg-sign__sub">내 비행기를 모아 두는 곳</p>
        </div>
        <span className="hg-count num" data-testid="hangar-count" aria-label={`비행기 ${planes.length}대, ${HANGAR_MAX}대까지 넣을 수 있어요`}><b>{planes.length}</b> / {HANGAR_MAX}</span>
        <div className="hg-chips" role="radiogroup" aria-label="늘어놓는 차례">
          {SORTS.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={sort === s.id} className={`hg-chip${sort === s.id ? ' is-on' : ''}`} onClick={() => setSort(s.id)} data-testid={`hangar-sort-${s.id}`}>
              {s.id === 'fav' && <HangarIcon name="starOn" size={18} />}{s.label}
            </button>
          ))}
        </div>
        {(api.loadNote || !api.persistent || flat) && (
          <div className="hg-notes">
            {flat && <p className="hg-note" data-testid="hangar-flat-note">{FLAT_NOTE[flat]}</p>}
            {!api.persistent && <p className="hg-note" data-testid="hangar-session-note">이 브라우저는 저장을 막아 두어서, 창을 닫으면 넣어 둔 비행기가 사라져요.</p>}
            {api.loadNote && <p className="hg-note" data-testid="hangar-load-note">{api.loadNote}</p>}
          </div>
        )}
      </div>

      {use3d ? (
        // 화면 낭독기와 글자판을 위한 목록(눈에는 3D 선반이 보인다)
        <ul className="sr-only" aria-label="넣어 둔 비행기" data-testid="hangar-list">
          {sorted.map((p, i) => (
            <li key={p.id}><button type="button" onClick={() => setPickedId(p.id)} data-testid={`hangar-item-${i}`} data-id={p.id} data-name={p.name}>{p.name}{p.favourite ? ', 즐겨찾기' : ''}{tagLine(p, 'distance') ? `, 최고 ${tagLine(p, 'distance')}` : ''} 고르기</button></li>
          ))}
        </ul>
      ) : (
        <div className="hg-grid" data-testid="hangar-grid">
          {sorted.map((p, i) => (
            <button key={p.id} type="button" className={`hg-card${picked?.id === p.id ? ' is-on' : ''}`} style={{ '--tilt': `${((i * 37) % 5) - 2}deg` } as React.CSSProperties} onClick={() => setPickedId(p.id)} data-testid={`hangar-item-${i}`} data-id={p.id} data-name={p.name}>
              <span className="hg-card__pic">
                {p.thumb ? <img src={p.thumb} alt="" width={160} height={160} /> : <FlatPic plane={p} />}
                {p.favourite && <span className="hg-card__star" aria-hidden="true"><HangarIcon name="starOn" size={22} /></span>}
              </span>
              <span className="hg-card__name">{p.name}</span>
              <span className="hg-card__line num">{tagLine(p, sort === 'long' ? 'airtime' : 'distance') || '아직 안 날렸어요'}</span>
            </button>
          ))}
          {Array.from({ length: Math.min(HANGAR_MAX - sorted.length, empty ? 4 : 2) }, (_, i) => <span key={`e${i}`} className="hg-card hg-card--empty" aria-hidden="true"><span className="hg-card__pic" /><span className="hg-card__name">빈 자리</span></span>)}
        </div>
      )}

      {empty && !picked && (
        <div className="hg-empty" data-testid="hangar-empty">
          <p><b>아직 비어 있어요.</b> 첫 비행기를 접어서 여기에 넣어 봐요!</p>
          <button type="button" className="btn btn--primary" onClick={onGoDesk} data-testid="hangar-go-desk"><Icon name="fold" size={22} />비행기 접으러 가기</button>
        </div>
      )}
      {noFav && <p className="hg-empty hg-empty--small" data-testid="hangar-nofav">아직 즐겨찾기한 비행기가 없어요. 비행기를 고르고 별을 눌러 봐요.</p>}
      {use3d && !empty && !picked && !swiped && !noFav && (
        <p className="hg-hint" aria-hidden="true">옆으로 밀어 보고, 비행기를 눌러 봐요</p>
      )}

      {picked && (
        <PlanePanel
          key={picked.id}
          ref={panelRef}
          plane={picked}
          farChamp={far?.id === picked.id}
          longChamp={long?.id === picked.id}
          onClose={() => setPickedId(null)}
          onThrow={() => api.takeOut(picked.id, 'throw')}
          onEdit={() => api.takeOut(picked.id, 'desk')}
          onRename={() => api.askRename(picked.id)}
          onFav={() => api.toggleFavourite(picked.id)}
          onCopy={() => copy(picked)}
          onNotebook={() => setNotebookId(picked.id)}
          onLab={onLab ? () => onLab(picked.id) : undefined}
          onDelete={() => setConfirmId(picked.id)}
        />
      )}

      {/* 대화상자는 화면 맨 위 겹(.app)에 붙인다: 이 화면 안에 두면 위쪽 막대 아래에 깔린다. */}
      {overlayOpen && createPortal(<>
      {confirmPlane && (
        <Dialog title="비행기를 버릴까요?" onClose={() => setConfirmId(null)} testId="hangar-confirm">
          <div className="stack">
            <p><b>{confirmPlane.name}</b>{eulReul(confirmPlane.name)} 격납고에서 버려요. 이 비행기의 기록도 같이 없어져요.</p>
            <p className="fine">버린 뒤에도 몇 초 동안은 "되돌리기"로 도로 가져올 수 있어요.</p>
            <div className="btnrow">
              <button type="button" className="btn" onClick={() => setConfirmId(null)} data-testid="hangar-confirm-no">그만두기</button>
              <button type="button" className="btn hg-danger" onClick={() => { const id = confirmPlane.id; setConfirmId(null); setPickedId(null); api.remove(id); }} data-testid="hangar-confirm-yes"><HangarIcon name="trash" />버리기</button>
            </div>
          </div>
        </Dialog>
      )}
      {copyCode !== null && (
        <Dialog title="내 비행기 코드" onClose={() => setCopyCode(null)} testId="hangar-copy">
          <CodeCopy code={copyCode} />
        </Dialog>
      )}
      {notebookPlane && notebookDesign && (
        <Notebook design={notebookDesign} ev={evaluateDesign(notebookDesign, notebookPlane.code)} lastResult={null} onClose={() => setNotebookId(null)} lab={notebookPlane.lab ?? codeNote(notebookPlane.code)} onLab={onLab ? () => { const id = notebookPlane.id; setNotebookId(null); onLab(id); } : undefined} />
      )}
      </>, document.querySelector('.app') ?? document.body)}
    </section>
  );
}

/** 그림이 없는 비행기: 위에서 본 모양을 종이색으로 그린다 */
function FlatPic({ plane }: { plane: SavedPlane }): JSX.Element | null {
  const d = designOfCode(plane.code);
  if (!d) return null;
  return <Silhouette id={`hg-${plane.code}`} design={d} color={paperTint(plane.paperId)} />;
}

// ---------------------------------------------------------------------------
// 고른 비행기의 판(아래에서 올라오는 도화지)
// ---------------------------------------------------------------------------
interface PanelProps {
  plane: SavedPlane;
  farChamp: boolean;
  longChamp: boolean;
  onClose: () => void;
  onThrow: () => void;
  onEdit: () => void;
  onRename: () => void;
  onFav: () => void;
  onCopy: () => void;
  onNotebook: () => void;
  onLab?: () => void;
  onDelete: () => void;
}

const PlanePanel = forwardRef<HTMLDivElement, PanelProps>(function PlanePanel({ plane, farChamp, longChamp, onClose, onThrow, onEdit, onRename, onFav, onCopy, onNotebook, onLab, onDelete }, ref) {
  const now = Date.now();
  const summary = useMemo(() => {
    const d = designOfCode(plane.code);
    if (!d) return null;
    try { return evaluateDesign(d, plane.code).summary; } catch { return null; }
  }, [plane.code]);
  const balance = summary ? balanceOf(summary) : null;
  const d = plane.best.distance, t = plane.best.airtime;
  const labNote = plane.lab ?? codeNote(plane.code);

  return (
    <div className="sheet hg-panel" ref={ref} role="region" aria-label={`고른 비행기: ${plane.name}`} data-testid="hangar-panel" data-id={plane.id}>
      <div className="hg-panel__head">
        <h2 className="hg-panel__name tape tape--yellow" data-testid="panel-name">{plane.name}</h2>
        <button type="button" className={`iconbtn hg-fav${plane.favourite ? ' is-on' : ''}`} role="switch" aria-checked={plane.favourite} aria-label="즐겨찾기" onClick={onFav} data-testid="panel-fav">
          <HangarIcon name={plane.favourite ? 'starOn' : 'starOff'} size={26} />
        </button>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="선반에 도로 놓기" data-testid="panel-close"><Icon name="close" /></button>
      </div>

      <div className="hg-panel__chips">
        <span className="chip" data-testid="panel-paper">{paperWord(plane.paperId)}</span>
        <span className="chip" data-testid="panel-origin">{originWord(plane.origin)}</span>
        {balance && <span className={`chip hg-bal hg-bal--${balance.kind}`} data-testid="panel-balance">{balance.label}</span>}
        {summary && <span className="chip" data-testid="panel-forecast">{forecastOf(summary)}</span>}
      </div>

      <div className="hg-panel__bests">
        <div className={`hg-best${farChamp && d ? ' is-champ' : ''}`} data-testid="panel-best-distance">
          <span className="hg-best__head"><Icon name="ruler" size={18} />멀리</span>
          {d ? <><b className="num">{fmt(d.value, 2)}</b><small> m · {kidDate(d.at, now)}</small></> : <small>아직 없어요</small>}
        </div>
        <div className={`hg-best${longChamp && t ? ' is-champ' : ''}`} data-testid="panel-best-airtime">
          <span className="hg-best__head"><Icon name="clock" size={18} />오래</span>
          {t ? <><b className="num">{fmt(t.value, 2)}</b><small> 초 · {kidDate(t.at, now)}</small></> : <small>아직 없어요</small>}
        </div>
      </div>
      <p className="hg-panel__meta" data-testid="panel-flights">
        {plane.flights > 0 ? <><b className="num">{plane.flights}</b>번 날렸어요</> : '아직 한 번도 안 날렸어요'} · {kidDate(plane.createdAt, now)} 넣었어요
      </p>

      {labNote && (
        <p className="hg-lab" data-testid="panel-lab-note"><LabIcon name="fan" size={20} /><span><b>바람 쪽지</b> {labNoteShort(labNote)}{labNote.physics !== PHYSICS_VERSION ? ' (규칙이 바뀌기 전에 쟀어요)' : ''}</span></p>
      )}
      <div className="hg-go">
        <button type="button" className="btn btn--primary btn--big" onClick={onThrow} data-testid="panel-throw"><Icon name="plane" />꺼내서 날리기</button>
        {onLab && <button type="button" className="btn btn--big hg-go__lab" onClick={onLab} data-testid="panel-lab"><LabIcon name="fan" size={24} /><span>바람<br />실험하기</span></button>}
      </div>
      <div className="hg-acts">
        <button type="button" className="hg-act" onClick={onEdit} data-testid="panel-edit"><Icon name="fold" size={22} /><span>고쳐 접기</span></button>
        <button type="button" className="hg-act" onClick={onRename} data-testid="panel-rename"><Icon name="pencil" size={22} /><span>이름 바꾸기</span></button>
        <button type="button" className="hg-act hg-act--note" onClick={onNotebook} data-testid="panel-notebook"><Icon name="note" size={22} /><span>연구 노트 보기</span></button>
        <button type="button" className="hg-act hg-act--wide" onClick={onCopy} data-testid="panel-copy"><Icon name="copy" size={22} /><span>내 비행기 코드 복사</span></button>
        <button type="button" className="hg-act hg-act--danger" onClick={onDelete} data-testid="panel-delete"><HangarIcon name="trash" size={22} /><span>버리기</span></button>
      </div>
    </div>
  );
});
