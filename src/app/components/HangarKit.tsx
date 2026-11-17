/**
 * 격납고 살림 한 벌: 저장소를 쥔 훅(useHangar), 어느 화면에서나 꺼내 쓰는 창구(HangarContext),
 * "격납고에 넣기" 단추(SaveToHangar), 이름 묻는 대화상자, 스티커처럼 붙는 알림.
 *
 * App 은 useHangar 를 한 번 부르고, ctx 를 HangarContext 로 내려 주고, ui 를 화면 맨 위에 그리면 된다.
 * 다른 화면은 <SaveToHangar where="desk" /> 처럼 한 줄만 넣으면 된다(넘겨줄 값이 없다).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent } from 'react';
import { decodeDesign, PAPERS } from '../../core/index';
import type { PlaneDesign } from '../../core/index';
import type { Action, AppState, Screen } from '../state';
import { evaluateDesign } from '../lib/evaluation';
import {
  addPlane, browserHangarStore, cleanName, deletePlane, designOfCode, findById, HANGAR_MAX, NAME_MAX, nameLength, paperKinds,
  recordFlight as recordFlightPure, renamePlane, replaceDesign, restorePlane, saveStatusOf, setFavourite, setLabNote, suggestName, untouchedPresetOf,
} from '../lib/hangar';
import type { FlightInput, HangarData, HangarStore, PlaneOrigin, SavedPlane, SaveOutcome, SaveStatus } from '../lib/hangar';
import { eulReul, roEuro } from '../lib/hangarWords';
import type { LabNote } from '../lib/lab/labMath';
import { log } from '../lib/logger';
import { playSound } from '../lib/sound';
import { STICKERS } from '../lib/stickers';
import type { StickerId } from '../lib/stickers';
import { renderHangarThumb } from '../three/hangarThumb';
import { Dialog } from './Dialog';
import { HangarIcon } from './HangarIcons';
import { Icon } from './Icons';
import './hangar-ui.css';

// ---------------------------------------------------------------------------
// 창구
// ---------------------------------------------------------------------------
export interface HangarToast {
  id: number;
  text: string;
  /** 새로 받은 스티커(있으면 같이 보여 준다) */
  stickers?: StickerId[];
  action?: { label: string; run: () => void };
  ms?: number;
}

export interface HangarApi {
  data: HangarData;
  /** 브라우저 저장소에 적히는지. false 면 이번 방문 동안만 기억한다. */
  persistent: boolean;
  /** 읽어 들일 때 생긴 일(망가진 칸을 건너뜀 등). 없으면 null */
  loadNote: string | null;
  /** 지금 접은 비행기와 격납고의 사이. 넣을 비행기가 없으면(빈 종이) null */
  status: SaveStatus | null;
  full: boolean;
  /** 따라 접기를 하는 도중인지(아직 다 접지 않았다). 이때는 책상의 넣기 단추를 숨긴다. */
  midGuide: boolean;
  /** 지금 비행기를 새 비행기로 넣는다(이름을 묻는다) */
  askSave: () => void;
  askRename: (id: string) => void;
  /** 꺼내서 고친 비행기를 "고친 걸로 바꾸기" */
  replaceLinked: () => void;
  toggleFavourite: (id: string) => void;
  /** 버린다. 몇 초 동안 되돌릴 수 있다. */
  remove: (id: string) => void;
  /** 격납고 비행기를 꺼낸다: 출발선으로(throw) 또는 책상으로(desk) */
  takeOut: (id: string, to: 'throw' | 'desk') => void;
  goHangar: () => void;
  /** 격납고에서 나간다(들어오기 전에 있던 곳으로) */
  leaveHangar: () => void;
  toast: (t: Omit<HangarToast, 'id'>) => void;
  /** 바람 실험실 쪽지를 그 비행기에 붙인다. 저장소에 적혔으면 true */
  saveLab: (id: string, note: LabNote) => boolean;
}

const noop = (): void => undefined;
const NO_API: HangarApi = {
  data: { v: 1, planes: [] }, persistent: true, loadNote: null, status: null, full: false, midGuide: false,
  askSave: noop, askRename: noop, replaceLinked: noop, toggleFavourite: noop, remove: noop, takeOut: noop, goHangar: noop, leaveHangar: noop, toast: noop, saveLab: () => false,
};

export const HangarContext = createContext<HangarApi>(NO_API);
export const useHangarApi = (): HangarApi => useContext(HangarContext);

const SESSION_NOTE = '이 브라우저는 저장을 막아 두어서, 창을 닫으면 넣어 둔 비행기가 사라져요.';

// ---------------------------------------------------------------------------
// 훅
// ---------------------------------------------------------------------------
interface Args {
  state: AppState;
  dispatch: Dispatch<Action>;
  /** 지금 비행기의 정리된 설계와 그 코드(던지기 값 없음) */
  design: PlaneDesign;
  designCode: string;
  valid: boolean;
  /** 격납고 스티커를 챙긴다. 새로 받은 스티커를 돌려준다. */
  awardHangar: (f: { planes: number; paperKinds: number; allPapers: number }) => StickerId[];
  /** 다른 비행기를 꺼냈을 때(지난 비행 결과를 지우는 등) */
  onLoaded: () => void;
}

type Asking =
  | { kind: 'save' }
  | { kind: 'rename'; id: string }
  | { kind: 'full' }
  | null;

export function useHangar({ state, dispatch, design, designCode, valid, awardHangar, onLoaded }: Args): {
  ctx: HangarApi;
  ui: JSX.Element;
  recordFlight: (f: FlightInput) => void;
  /** 코드로 꺼낸 비행기에 "격납고에 넣기"를 권한다 */
  offerSave: (text: string) => void;
} {
  const storeRef = useRef<HangarStore | null>(null);
  if (storeRef.current === null) storeRef.current = browserHangarStore();
  const store = storeRef.current;
  const [boot] = useState(() => store.load());
  const [data, setData] = useState<HangarData>(boot.data);
  const [persistent, setPersistent] = useState(boot.persistent);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [asking, setAsking] = useState<Asking>(null);
  const [toast, setToast] = useState<HangarToast | null>(null);
  const toastSeq = useRef(1);
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadNote = useMemo(() => {
    if (boot.newer) return '더 새로운 놀이판에서 넣어 둔 비행기가 있어요. 여기서는 꺼낼 수 없어서 그대로 두었어요.';
    if (boot.skipped > 0) return `망가진 비행기 ${boot.skipped}대는 꺼내지 못했어요. 나머지는 그대로 있어요.`;
    return null;
  }, [boot]);
  useEffect(() => {
    if (boot.skipped > 0) log.warn('hangar', '망가진 비행기 칸을 건너뛰었어요', { skipped: boot.skipped });
  }, [boot]);

  const showToast = useCallback((t: Omit<HangarToast, 'id'>) => {
    setToast({ ...t, id: toastSeq.current++ });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast((cur) => (cur && cur.id === toast.id ? null : cur)), toast.ms ?? 4200);
    return () => window.clearTimeout(id);
  }, [toast]);

  /** 새 값을 저장한다. 실제로 남은 값(그림을 뺐을 수 있다)을 화면에 반영한다. */
  const commit = useCallback((next: HangarData): SaveOutcome => {
    const out = store.save(next);
    dataRef.current = out.data;
    setData(out.data);
    setPersistent(out.persisted);
    return out;
  }, [store]);

  // 다른 탭에서 격납고가 바뀌면 다시 읽는다.
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === null || !e.key.startsWith('pp.hangar.') || e.key.endsWith('.probe')) return;
      const r = store.load();
      dataRef.current = r.data;
      setData(r.data);
      setPersistent(r.persistent);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store]);

  const hasPlane = valid && design.folds.length > 0;
  const status = useMemo<SaveStatus | null>(
    () => (hasPlane ? saveStatusOf(data, designCode, state.hangarId) : null),
    [hasPlane, data, designCode, state.hangarId],
  );

  // 지금 비행기가 격납고의 어느 비행기인지 이어 둔다(같은 모양이면 그 비행기, 빈 종이면 끊는다).
  useEffect(() => {
    const cur = state.hangarId;
    if (!hasPlane) {
      if (cur !== null && design.folds.length === 0) dispatch({ type: 'hangarLink', id: null });
      return;
    }
    if (status?.kind === 'saved' && cur !== status.plane.id) dispatch({ type: 'hangarLink', id: status.plane.id });
    else if (cur !== null && !findById(data, cur)) dispatch({ type: 'hangarLink', id: null });
  }, [hasPlane, design.folds.length, status, state.hangarId, data, dispatch]);

  /** 지금 비행기가 어떻게 만들어졌는지 */
  const originNow = useCallback((): PlaneOrigin => {
    const s = stateRef.current;
    if (s.foldMode === 'simple' && s.presetChosen && s.guideFolds === null) return `preset:${s.presetId}`;
    // 격납고에서 꺼낸 비행기의 접은 선을 그대로 두고 날개만 다듬었으면 원래 접는 법 이름을 지킨다.
    const linked = findById(dataRef.current, s.hangarId);
    const was = linked ? designOfCode(linked.code) : null;
    if (linked && was && JSON.stringify(was.folds) === JSON.stringify(design.folds)) return linked.origin;
    return 'free';
  }, [design]);

  const thumbNow = useCallback((): string | undefined => {
    try {
      return renderHangarThumb(evaluateDesign(design, designCode).geometry, design.paperId);
    } catch (err) {
      log.warn('hangar', '비행기 그림을 찍지 못했어요', err);
      return undefined;
    }
  }, [design, designCode]);

  const storageTail = (out: SaveOutcome): string => {
    if (!out.persisted) return ` ${SESSION_NOTE}`;
    if (out.droppedThumbs) return ' 자리가 모자라서 비행기 그림은 빼고 넣었어요. 비행기는 그대로예요.';
    return '';
  };

  const saveNew = useCallback((rawName: string): boolean => {
    const r = addPlane(dataRef.current, { name: rawName, code: designCode, origin: originNow(), thumb: thumbNow() }, Date.now());
    if (!r.ok) {
      if (r.reason === 'full') setAsking({ kind: 'full' });
      else if (r.reason === 'code') showToast({ text: '이 모양은 격납고에 넣을 수 없어요. 책상에서 조금 고친 뒤 다시 넣어 봐요.' });
      return false;
    }
    const out = commit(r.data);
    dispatch({ type: 'hangarLink', id: r.plane.id });
    const fresh = awardHangar({ planes: out.data.planes.length, paperKinds: paperKinds(out.data).length, allPapers: PAPERS.length });
    playSound(fresh.length > 0 ? 'cheer' : 'pop');
    showToast({ text: `'${r.plane.name}'${eulReul(r.plane.name)} 격납고에 넣었어요!${storageTail(out)}`, stickers: fresh, ms: out.persisted && !out.droppedThumbs ? 4200 : 7000 });
    log.info('hangar', '비행기를 넣었어요', { planes: out.data.planes.length, persisted: out.persisted });
    return true;
  }, [designCode, originNow, thumbNow, commit, dispatch, awardHangar, showToast]);

  const askSave = useCallback(() => {
    if (dataRef.current.planes.length >= HANGAR_MAX) { setAsking({ kind: 'full' }); playSound('nope'); return; }
    setAsking({ kind: 'save' });
  }, []);
  const askRename = useCallback((id: string) => { if (findById(dataRef.current, id)) setAsking({ kind: 'rename', id }); }, []);

  const replaceLinked = useCallback(() => {
    const linked = findById(dataRef.current, stateRef.current.hangarId);
    if (!linked) return;
    const hadBest = linked.best.distance !== undefined || linked.best.airtime !== undefined;
    const out = commit(replaceDesign(dataRef.current, linked.id, designCode, originNow(), Date.now(), thumbNow()));
    playSound('pop');
    showToast({ text: `'${linked.name}'${eulReul(linked.name)} 고친 모양으로 바꿨어요.${hadBest ? ' 모양이 달라져서 최고 기록은 새로 재요.' : ''}${storageTail(out)}`, ms: 5200 });
  }, [commit, designCode, originNow, thumbNow, showToast]);

  const toggleFavourite = useCallback((id: string) => {
    const p = findById(dataRef.current, id);
    if (!p) return;
    commit(setFavourite(dataRef.current, id, !p.favourite));
    if (!p.favourite) playSound('pop');
  }, [commit]);

  const remove = useCallback((id: string) => {
    const r = deletePlane(dataRef.current, id);
    if (!r.removed) return;
    const removed = r.removed;
    commit(r.data);
    showToast({
      text: `'${removed.plane.name}'${eulReul(removed.plane.name)} 버렸어요.`,
      ms: 6500,
      action: {
        label: '되돌리기',
        run: () => {
          commit(restorePlane(dataRef.current, removed));
          showToast({ text: `'${removed.plane.name}'${eulReul(removed.plane.name)} 도로 가져왔어요.`, ms: 2600 });
        },
      },
    });
  }, [commit, showToast]);

  const takeOut = useCallback((id: string, to: 'throw' | 'desk') => {
    const p = findById(dataRef.current, id);
    const d = p ? designOfCode(p.code) : null;
    if (!p || !d) {
      showToast({ text: '이 비행기를 꺼내지 못했어요. 다른 비행기를 골라 봐요.' });
      return;
    }
    const preset = to === 'desk' ? untouchedPresetOf(p) : null;
    if (preset !== null) {
      dispatch({ type: 'loadPreset', presetId: preset, paperId: p.paperId, hangarId: p.id });
    } else {
      // 그 종목 최고 기록을 낼 때 던진 방법이 남아 있으면 그대로 맞춰 둔다.
      const mode = stateRef.current.mode;
      const tc = (mode === 'distance' ? p.best.distance : p.best.airtime)?.throwCode ?? p.best.distance?.throwCode ?? p.best.airtime?.throwCode;
      let throwIn = undefined;
      if (to === 'throw' && tc) { try { throwIn = decodeDesign(tc)?.throwIn; } catch { throwIn = undefined; } }
      dispatch({ type: 'load', design: d, throwIn, hangarId: p.id });
    }
    onLoaded();
    if (to === 'desk') dispatch({ type: 'deskStep', step: 'fold' });
    dispatch({ type: 'screen', screen: to });
    log.info('hangar', '격납고에서 비행기를 꺼냈어요', { to });
  }, [dispatch, onLoaded, showToast]);

  const goHangar = useCallback(() => dispatch({ type: 'screen', screen: 'hangar' }), [dispatch]);
  const leaveHangar = useCallback(() => {
    const from: Screen = stateRef.current.hangarFrom;
    dispatch({ type: 'screen', screen: from === 'hangar' ? 'home' : from });
  }, [dispatch]);

  const recordFlight = useCallback((f: FlightInput) => {
    const u = recordFlightPure(dataRef.current, f);
    if (u.planeIds.length > 0) commit(u.data);
  }, [commit]);

  const saveLab = useCallback((id: string, note: LabNote): boolean => {
    const next = setLabNote(dataRef.current, id, note);
    if (next === dataRef.current) return false;
    return commit(next).persisted;
  }, [commit]);

  const offerSave = useCallback((text: string) => {
    showToast({ text, ms: 12000, action: { label: '격납고에 넣기', run: () => { setToast(null); askSave(); } } });
  }, [showToast, askSave]);

  // 갈무리, 검사용 손잡이: 앱이 쓰는 바로 그 길(addPlane -> 저장)로 비행기를 넣는다. 놀이 흐름에는 쓰지 않는다.
  useEffect(() => {
    const w = window as unknown as { __ppHangarApi?: unknown };
    w.__ppHangarApi = {
      data: () => dataRef.current,
      persistent: () => store.persistent,
      seed: (list: { name: string; code: string; origin?: PlaneOrigin; favourite?: boolean; flight?: Omit<FlightInput, 'designCode'> }[]) => {
        let cur = dataRef.current;
        let added = 0;
        for (const it of list) {
          const d = designOfCode(it.code);
          let thumb: string | undefined;
          try { thumb = d ? renderHangarThumb(evaluateDesign(d, it.code).geometry, d.paperId) : undefined; } catch { thumb = undefined; }
          const r = addPlane(cur, { name: it.name, code: it.code, origin: it.origin ?? 'free', thumb }, Date.now() + added);
          if (!r.ok) continue;
          cur = r.data;
          added++;
          if (it.favourite) cur = setFavourite(cur, r.plane.id, true);
          if (it.flight) cur = recordFlightPure(cur, { ...it.flight, designCode: it.code }).data;
        }
        const out = commit(cur);
        return { added, planes: out.data.planes.length, persisted: out.persisted };
      },
    };
    return () => { delete w.__ppHangarApi; };
  }, [commit, store]);

  const midGuide = state.foldMode === 'simple' && state.guideFolds !== null;
  const ctx = useMemo<HangarApi>(() => ({
    data, persistent, loadNote, status, full: data.planes.length >= HANGAR_MAX, midGuide,
    askSave, askRename, replaceLinked, toggleFavourite, remove, takeOut, goHangar, leaveHangar, toast: showToast, saveLab,
  }), [data, persistent, loadNote, status, midGuide, askSave, askRename, replaceLinked, toggleFavourite, remove, takeOut, goHangar, leaveHangar, showToast, saveLab]);

  const renameTarget = asking?.kind === 'rename' ? findById(data, asking.id) : null;
  const ui = (
    <>
      {asking?.kind === 'save' && (
        <NameDialog
          title="격납고에 넣기"
          lead="비행기에 이름을 지어 줘요."
          initial={suggestName(data.planes, design.paperId, originNow())}
          submitLabel="넣기"
          note={persistent ? null : SESSION_NOTE}
          onClose={() => setAsking(null)}
          onSubmit={(name) => { if (saveNew(name)) setAsking(null); }}
        />
      )}
      {renameTarget && (
        <NameDialog
          title="이름 바꾸기"
          lead="새 이름을 지어 줘요."
          initial={renameTarget.name}
          submitLabel="바꾸기"
          note={null}
          onClose={() => setAsking(null)}
          onSubmit={(name) => {
            commit(renamePlane(dataRef.current, renameTarget.id, name, Date.now()));
            setAsking(null);
            const n = cleanName(name) ?? name;
            showToast({ text: `이름을 '${n}'${roEuro(n)} 바꿨어요.`, ms: 2800 });
          }}
        />
      )}
      {asking?.kind === 'full' && (
        <Dialog title="격납고가 꽉 찼어요" onClose={() => setAsking(null)} testId="hangar-full">
          <div className="stack">
            <p>격납고에는 비행기를 <b className="num">{HANGAR_MAX}</b>대까지 넣을 수 있어요. 안 쓰는 비행기를 하나 버리면 새 비행기를 넣을 수 있어요.</p>
            <div className="btnrow">
              <button type="button" className="btn" onClick={() => setAsking(null)} data-testid="hangar-full-ok">알겠어요</button>
              <button type="button" className="btn btn--primary" onClick={() => { setAsking(null); goHangar(); }} data-testid="hangar-full-go"><HangarIcon name="hangar" />격납고 보기</button>
            </div>
          </div>
        </Dialog>
      )}
      {toast && <ToastCard key={toast.id} toast={toast} onClose={() => setToast(null)} />}
    </>
  );

  return { ctx, ui, recordFlight, offerSave };
}

// ---------------------------------------------------------------------------
// 이름 묻는 대화상자
// ---------------------------------------------------------------------------
interface NameProps {
  title: string;
  lead: string;
  initial: string;
  submitLabel: string;
  note: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

function NameDialog({ title, lead, initial, submitLabel, note, onSubmit, onClose }: NameProps): JSX.Element {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = value.replace(/\s+/g, ' ').trim();
  const count = nameLength(trimmed);
  const clean = cleanName(value);
  const problem = count === 0 ? '이름을 한 글자 이상 적어 주세요.' : count > NAME_MAX ? `이름은 ${NAME_MAX}글자까지 쓸 수 있어요. ${count - NAME_MAX}글자만 줄여 주세요.` : null;

  useEffect(() => {
    // 손가락 화면에서는 글자판이 대화상자를 가리지 않게, 눌렀을 때만 글자판이 뜬다.
    const coarse = (() => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
    if (!coarse) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, []);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (clean !== null) onSubmit(clean);
  };

  return (
    <Dialog title={title} onClose={onClose} testId="name-dialog">
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span className="field__label">{lead}</span>
          <span className="hg-nametag">
            <input
              ref={inputRef}
              className="input hg-nametag__input"
              type="text"
              value={value}
              maxLength={NAME_MAX * 3}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="done"
              aria-invalid={problem !== null}
              aria-describedby="hg-name-help"
              onChange={(e) => setValue(e.target.value)}
              data-testid="name-input"
            />
          </span>
        </label>
        <p id="hg-name-help" className={problem ? 'note-warn' : 'fine'} role={problem ? 'alert' : undefined} data-testid="name-help">
          {problem ?? <>글자 수 <b className="num">{count}</b> / {NAME_MAX} · 같은 이름을 또 써도 괜찮아요.</>}
        </p>
        {note && <p className="note-warn" data-testid="name-session-note">{note}</p>}
        <div className="btnrow">
          <button type="button" className="btn" onClick={onClose} data-testid="name-cancel">그만두기</button>
          <button type="submit" className="btn btn--primary" disabled={clean === null} data-testid="name-ok"><Icon name="check" />{submitLabel}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 스티커처럼 붙는 알림
// ---------------------------------------------------------------------------
function ToastCard({ toast, onClose }: { toast: HangarToast; onClose: () => void }): JSX.Element {
  const stickers = (toast.stickers ?? []).map((id) => STICKERS.find((s) => s.id === id)).filter((s): s is (typeof STICKERS)[number] => s !== undefined);
  return (
    <div className="hg-toast" role="status" aria-live="polite" data-testid="hangar-toast">
      <span className="hg-toast__badge" aria-hidden="true"><HangarIcon name="hangar" size={26} /></span>
      <div className="hg-toast__body">
        <p className="hg-toast__text" data-testid="hangar-toast-text">{toast.text}</p>
        {stickers.length > 0 && (
          <p className="hg-toast__stickers" data-testid="hangar-toast-stickers">
            <span>새 스티커!</span>
            {stickers.map((s) => (
              <span key={s.id} className="hg-toast__sticker" style={{ '--sticker': `var(${s.token})` } as React.CSSProperties} data-testid={`hangar-new-sticker-${s.id}`}>
                <i aria-hidden="true"><Icon name="star" size={14} /></i>{s.name}
              </span>
            ))}
          </p>
        )}
      </div>
      {toast.action ? (
        <button type="button" className="btn btn--small hg-toast__act" onClick={toast.action.run} data-testid="hangar-toast-action">{toast.action.label}</button>
      ) : (
        <button type="button" className="hg-toast__close" onClick={onClose} aria-label="알림 닫기" data-testid="hangar-toast-close"><Icon name="close" size={18} /></button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "격납고에 넣기" 단추: 책상과 결과 화면에 한 줄로 넣는다
// ---------------------------------------------------------------------------
/**
 * 지금 접은 비행기를 격납고에 넣는 단추. 상태에 따라 모습이 바뀐다.
 * - 아직 안 넣었으면: "격납고에 넣기"(결과 화면에서는 "이 비행기 넣어 두기")
 * - 같은 모양이 들어 있으면: "격납고에 있어요" + 이름 바꾸기
 * - 격납고에서 꺼내 고쳤으면: "고친 걸로 바꾸기" / "새 비행기로 넣기"
 * 빈 종이일 때는 아무것도 그리지 않는다.
 */
export function SaveToHangar({ where }: { where: 'desk' | 'result' }): JSX.Element | null {
  const api = useHangarApi();
  const st = api.status;
  if (!st) return null;
  // 따라 접는 도중의 반쯤 접은 종이는 아직 비행기가 아니다(다 접으면 단추가 나온다).
  if (where === 'desk' && api.midGuide && st.kind === 'new') return null;
  if (st.kind === 'saved') {
    return (
      <div className={`hg-save hg-save--${where} is-saved`} data-testid="hangar-save" data-state="saved">
        <span className="hg-save__in" data-testid="hangar-saved-name">
          <span className="hg-save__check" aria-hidden="true"><Icon name="check" size={16} /></span>
          <span className="hg-save__words"><small>격납고에 있어요</small><b>{st.plane.name}</b></span>
        </span>
        <button type="button" className="btn btn--small" onClick={() => api.askRename(st.plane.id)} data-testid="hangar-rename"><Icon name="pencil" size={18} />이름 바꾸기</button>
      </div>
    );
  }
  if (st.kind === 'modified') {
    return (
      <div className={`hg-save hg-save--${where} is-modified`} data-testid="hangar-save" data-state="modified">
        <p className="hg-save__lead" data-testid="hangar-modified-name">격납고의 <b>{st.plane.name}</b>{eulReul(st.plane.name)} 고쳤어요.</p>
        <div className="btnrow">
          <button type="button" className="btn btn--small" onClick={api.replaceLinked} data-testid="hangar-replace"><HangarIcon name="swap" size={18} />고친 걸로 바꾸기</button>
          <button type="button" className="btn btn--small" onClick={api.askSave} data-testid="hangar-save-new"><HangarIcon name="hangar" size={18} />새 비행기로 넣기</button>
        </div>
      </div>
    );
  }
  return (
    <div className={`hg-save hg-save--${where}`} data-testid="hangar-save" data-state="new">
      <button type="button" className="btn hg-save__btn" onClick={api.askSave} data-testid="hangar-save-btn">
        <HangarIcon name="hangar" size={22} />{where === 'result' ? '이 비행기 넣어 두기' : '격납고에 넣기'}
      </button>
    </div>
  );
}
