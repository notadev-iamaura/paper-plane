/**
 * 순위표: 체육관 벽의 점수판처럼 보이는 랭킹 판.
 * 종목 탭(멀리 날리기 / 오래 날리기), 금·은·동 메달, 내 줄("나"), 줄을 누르면 나오는 "이 비행기 구경하기".
 * 별명과 그 밖의 글자는 모두 글자로만 그린다(React 가 알아서 글자로 넣는다. HTML 로 넣지 않는다).
 *
 * 두 군데에 놓인다: 기록장 안(위에서 몇 줄만) 과 순위표 큰 판(RankingHost 가 띄운다).
 */
import { useEffect, useState } from 'react';
import { PAPERS } from '../../core/index';
import { fmt } from '../lib/format';
import { EVENT_NAME, VERDICT_LINE, VERDICT_SHORT } from '../lib/kidvoice';
import type { Records } from '../lib/records';
import { scoreKey } from '../lib/ranking/board';
import type { RankingBackend, RankMode, RankRow, RemoveOutcome } from '../lib/ranking/types';
import { RANK_MODES } from '../lib/ranking/types';
import { orAfter, rankUi, useRankingSelection, useRankingState, WRITE_WAIT_MS } from '../lib/ranking/useRanking';
import { PAPER_LOOK_SPECS } from '../three/paperTextures';
import { Icon } from './Icons';
import './ranking.css';

export const UNIT: Record<RankMode, string> = { distance: 'm', airtime: '초' };
export const OFF_LINE = '여기서는 순위표를 쓸 수 없어요. 내 기록은 이 기기에 저장돼요.';
export const READONLY_LINE = "구경만 할 수 있어요. 기록을 올리려면 초대해 준 사람에게 '기여자'로 바꿔 달라고 말해 주세요.";
export const NO_ID_LINE = '구경만 할 수 있어요. 로그인한 다음에 다시 열면 기록을 올릴 수 있어요.';

interface Props {
  records: Records;
  /** 코드를 불러온다(기존의 코드 불러오기 길). 성공하면 true. */
  onLoadCode: (code: string, from: string) => boolean;
  /** 보여 줄 줄 수. 생략하면 모두(최대 50) */
  limit?: number;
  /** 줄을 줄여 보여 줄 때 "모두 보기"를 누르면 */
  onSeeAll?: (mode: RankMode) => void;
  initialMode?: RankMode;
  /** 값이 바뀌면 다시 가져온다(서버 랭킹에서 기록을 올린 직후) */
  token?: number;
  /** 판 머리에 "순위표" 제목을 넣을지 */
  title?: boolean;
}

/** 순위표가 놓일 자리. 순위표를 쓸 수 없으면 차분한 한 줄만 보여 준다. */
export function RankBoard(props: Props): JSX.Element {
  const sel = useRankingSelection();
  if (sel.kind === 'none') return <p className="fine" data-testid="ranking-off">{OFF_LINE}</p>;
  if (sel.kind === 'checking') return <p className="fine" role="status" data-testid="ranking-checking">순위표를 준비하고 있어요…</p>;
  return <Board {...props} backend={sel.backend} />;
}

function Board({ backend, records, onLoadCode, limit, onSeeAll, initialMode = 'distance', token = 0, title = true }: Props & { backend: RankingBackend }): JSX.Element {
  const [mode, setMode] = useState<RankMode>(initialMode);
  const [open, setOpen] = useState<string | null>(null);
  const state = useRankingState(backend);

  // 서버 랭킹은 종목을 볼 때마다 가져온다. 함께 쓰는 저장소는 한 번 지켜보면 되므로 여기서 할 일이 없다.
  useEffect(() => {
    backend.watch(mode);
  }, [backend, mode, token]);

  const board = state.boards[mode];
  const shown = limit ? board.rows.slice(0, limit) : board.rows;
  const mineShown = board.mine !== null && shown.some((r) => r.mine);
  const status = state.status === 'idle' ? 'loading' : state.status;
  const unit = UNIT[mode];
  const closed = status === 'closed';

  const local = mode === 'distance' ? records.bestDistance : records.bestAirtime;
  const localScore = local ? (mode === 'distance' ? local.distanceM : local.airtimeS) : null;
  const alreadyUp = board.mine !== null && localScore !== null && scoreKey(localScore) <= scoreKey(board.mine.score);

  const view = (row: RankRow): void => {
    if (!onLoadCode(row.code, '순위표')) return;
    rankUi.viewed();
  };

  return (
    <div className="rk" data-testid="ranking" data-status={status} data-kind={backend.kind}>
      <div className="rk__board">
        {title && (
          <div className="rk__top">
            <strong className="rk__title"><Icon name="trophy" size={26} />순위표</strong>
            {status === 'ready' && board.total > 0 && <span className="rk__count" data-testid="rank-total">{board.total}명</span>}
          </div>
        )}
        <div className="rk__tabs" role="radiogroup" aria-label="순위표 종목" data-testid="rank-mode">
          {RANK_MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={`rk__tab${mode === m ? ' is-on' : ''}`} onClick={() => { setMode(m); setOpen(null); }} data-testid={`rank-mode-${m}`}>
              <Icon name={m === 'distance' ? 'ruler' : 'clock'} size={20} />{EVENT_NAME[m]}
            </button>
          ))}
        </div>
      </div>

      {status === 'loading' && <p className="rk__state" role="status" data-testid="rank-loading">순위표를 가져오는 중이에요…</p>}
      {status === 'stalled' && (
        <div className="rk__state rk__state--warn" role="status" data-testid="rank-stalled">
          <p>지금은 순위를 불러올 수 없어요.</p>
          <button type="button" className="btn btn--small rk__retry" onClick={() => backend.retry(mode)} data-testid="rank-retry">다시 해 보기</button>
        </div>
      )}
      {status === 'error' && (
        <div className="rk__state rk__state--warn" role="alert" data-testid="rank-error">
          {state.errors.length > 0
            ? <ul data-testid="ranking-errors">{state.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            : <p>순위표를 가져오지 못했어요.</p>}
          <button type="button" className="btn btn--small rk__retry" onClick={() => backend.retry(mode)} data-testid="rank-retry">다시 해 보기</button>
        </div>
      )}
      {closed && <p className="rk__state" data-testid="rank-closed">지금은 순위표를 쓸 수 없어요. 내 기록은 이 기기에 저장돼요.</p>}

      {status === 'ready' && board.total === 0 && board.pending === 0 && (
        <p className="rk__state rk__state--empty" data-testid="rank-empty">아직 아무도 없어요. 첫 번째로 올려 볼까요?</p>
      )}
      {status === 'ready' && board.pending > 0 && (
        <p className="rk__busy" role="status" data-testid="rank-pending"><i aria-hidden="true" />계산 중 · {board.pending}개 남았어요</p>
      )}

      {status === 'ready' && shown.length > 0 && (
        <ol className="rk__list" data-testid="ranking-table">
          {shown.map((row) => (
            <Row key={row.id} row={row} unit={unit} open={open === row.id} onToggle={() => setOpen(open === row.id ? null : row.id)} onView={() => view(row)} backend={backend} writable={state.write === 'yes'} />
          ))}
        </ol>
      )}
      {status === 'ready' && board.mine !== null && !mineShown && (
        <>
          <p className="rk__gap" aria-hidden="true">· · ·</p>
          <ol className="rk__list" data-testid="rank-mine-outside">
            <Row row={board.mine} unit={unit} open={open === board.mine.id} onToggle={() => setOpen(open === board.mine!.id ? null : board.mine!.id)} onView={() => view(board.mine!)} backend={backend} writable={state.write === 'yes'} />
          </ol>
        </>
      )}
      {status === 'ready' && board.mine === null && board.minePending && <p className="fine" role="status">내 기록을 계산하는 중이에요…</p>}

      {status === 'ready' && limit !== undefined && onSeeAll && board.total > 0 && (
        <button type="button" className="btn rk__all" onClick={() => onSeeAll(mode)} data-testid="rank-see-all">순위표 모두 보기<Icon name="next" size={20} /></button>
      )}

      {!closed && (status === 'ready' || backend.kind === 'http') && (
        <div className="rk__foot">
          {state.write === 'readonly' && <p className="rk__note" data-testid="rank-readonly">{READONLY_LINE}</p>}
          {state.write === 'no-id' && <p className="rk__note" data-testid="rank-readonly">{NO_ID_LINE}</p>}
          {state.write === 'yes' && local && localScore !== null && !alreadyUp && (
            <button type="button" className="btn btn--primary rk__submit" onClick={() => rankUi.openSubmit({ code: local.code, mode, localScore })} data-testid="rank-submit-best">
              <Icon name="trophy" size={22} />내 최고 기록 올리기<small className="num">{fmt(localScore, 2)} {unit}</small>
            </button>
          )}
          {state.write === 'yes' && alreadyUp && <p className="fine" data-testid="rank-already">내 최고 기록이 순위표에 올라가 있어요.</p>}
          {state.write === 'yes' && !local && <p className="fine" data-testid="rank-need-throw">비행기를 날리면 여기에 기록을 올릴 수 있어요.</p>}
          {!backend.live && <button type="button" className="btn btn--small rk__refresh" onClick={() => backend.retry(mode)} disabled={status === 'loading'} data-testid="rank-refresh">새로 보기</button>}
        </div>
      )}
      <p className="fine">{backend.kind === 'http' ? '순위표의 기록은 모두 대회 본부(서버)가 다시 계산한 값이에요.' : '순위표의 기록은 모두 비행기 코드로 다시 계산한 값이에요.'}</p>
    </div>
  );
}

function paperName(id: string | null): string {
  return PAPERS.find((p) => p.id === id)?.nameKo ?? '종이';
}

/** 종이 종류를 알려 주는 작은 색종이 조각 */
export function PaperChip({ paperId }: { paperId: string | null }): JSX.Element {
  const tint = (paperId !== null ? PAPER_LOOK_SPECS[paperId]?.tint : undefined) ?? PAPER_LOOK_SPECS.copy80?.tint;
  return <i className="rk-chip" style={{ background: tint }} aria-hidden="true" />;
}

/** 금·은·동 메달(색종이를 오려 붙인 모양) */
export function Medal({ place }: { place: 1 | 2 | 3 }): JSX.Element {
  return (
    <svg className={`rk-medal rk-medal--${place}`} viewBox="0 0 40 46" width="40" height="46" role="img" aria-label={`${place}등`}>
      <path className="rk-medal__ribbon rk-medal__ribbon--a" d="M9 2h9l4 15-8 4z" />
      <path className="rk-medal__ribbon rk-medal__ribbon--b" d="M31 2h-9l-4 15 8 4z" />
      <circle className="rk-medal__disc" cx="20" cy="29" r="13.5" />
      <circle className="rk-medal__ring" cx="20" cy="29" r="9.5" />
      <text className="rk-medal__num" x="20" y="34.500" textAnchor="middle">{place}</text>
    </svg>
  );
}

function Row({ row, unit, open, onToggle, onView, backend, writable }: {
  row: RankRow; unit: string; open: boolean; onToggle: () => void; onView: () => void; backend: RankingBackend; writable: boolean;
}): JSX.Element {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const top = row.rank <= 3 ? ` is-top is-top${row.rank}` : '';
  const other = row.mode === 'distance' ? `${fmt(row.airtimeS, 2)}초 동안 떠 있었어요.` : `${fmt(row.distanceM, 2)} m를 날아갔어요.`;

  const onRemove = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const r = await orAfter<RemoveOutcome>(backend.remove(row.mode), WRITE_WAIT_MS, { ok: false, reason: 'offline' });
    setBusy(false);
    setConfirm(false);
    if (!r.ok && r.reason !== 'nothing') setNote(r.reason === 'readonly' ? '지금은 구경만 할 수 있어서 지우지 못했어요.' : '지우지 못했어요. 조금 있다가 다시 해 봐요.');
  };

  return (
    <li className={`rk-row rank__item${top}${row.mine ? ' is-mine' : ''}${open ? ' is-open' : ''}`} data-testid={`rank-row-${row.rank}`} data-rank={row.rank} data-id={row.id} data-mine={row.mine ? 'true' : undefined}>
      <button type="button" className="rk-row__main" aria-expanded={open} onClick={onToggle} data-testid={`rank-row-btn-${row.rank}`}>
        <span className="rk-row__place">
          {row.rank <= 3 ? <Medal place={row.rank as 1 | 2 | 3} /> : <span className="num" aria-label={`${row.rank}등`}>{row.rank}</span>}
        </span>
        <span className="rk-row__who">
          <span className="rk-row__name">{row.mine && <b className="rk-row__me" data-testid="rank-me">나</b>}<span className="rk-row__nick" data-testid="rank-nick">{row.nickname}</span></span>
          <span className="rk-row__meta"><PaperChip paperId={row.paperId} />{VERDICT_SHORT[row.verdict]}</span>
        </span>
        <span className="rk-row__score"><b className="num" data-testid="rank-score">{fmt(row.score, 2)}</b> {unit}</span>
        <span className="rk-row__chev" aria-hidden="true"><Icon name="next" size={18} /></span>
      </button>
      {open && (
        <div className="rk-row__more" data-testid="rank-row-more">
          <p className="rk-row__story">{paperName(row.paperId)} 비행기예요. {VERDICT_LINE[row.verdict]} {other}</p>
          <button type="button" className="btn btn--small rk-row__view" onClick={onView} data-testid="rank-view"><Icon name="plane" size={20} />이 비행기 구경하기</button>
          {row.mine && backend.canRemove && writable && !confirm && (
            <button type="button" className="btn btn--plain rk-row__del" onClick={() => { setConfirm(true); setNote(''); }} data-testid="rank-remove">내 기록 지우기</button>
          )}
          {row.mine && confirm && (
            <div className="rk-row__confirm" role="group" aria-label="내 기록 지우기" data-testid="rank-remove-confirm">
              <p>순위표에서 내 {EVENT_NAME[row.mode]} 기록을 지울까요?</p>
              <div className="btnrow">
                <button type="button" className="btn btn--small" onClick={() => setConfirm(false)} disabled={busy} data-testid="rank-remove-no">그대로 두기</button>
                <button type="button" className="btn btn--small rk-row__yes" onClick={() => { void onRemove(); }} disabled={busy} data-testid="rank-remove-yes">{busy ? '지우는 중…' : '지우기'}</button>
              </div>
            </div>
          )}
          {note && <p className="note-warn" role="status">{note}</p>}
        </div>
      )}
    </li>
  );
}
