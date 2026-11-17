/**
 * 랭킹에 올리기: 별명을 적고 기록을 순위표에 올린다.
 * 보내는 것은 비행기 코드(접은 모양 + 던지기 값), 종목, 별명뿐이다. 이 기기에서 계산한 점수는 보내지 않는다.
 *   - 랭킹 서버: 서버가 코드로 다시 계산한 "공식 기록"을 돌려준다.
 *   - 함께 쓰는 저장소: 코드만 저장하고, 보는 기기마다 코드로 다시 계산한다. 이미 올린 기록보다 좋을 때만 바꾼다.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { fmt } from '../lib/format';
import { EVENT_NAME } from '../lib/kidvoice';
import { NICK_MAX, sanitizeNickname } from '../lib/ranking/board';
import type { RankingBackend, SubmitOutcome } from '../lib/ranking/types';
import { orAfter, useRankingState, WRITE_WAIT_MS } from '../lib/ranking/useRanking';
import type { SubmitRequest } from '../lib/ranking/useRanking';
import { loadJson, saveJson, STORAGE_KEYS } from '../lib/storage';
import { Dialog } from './Dialog';
import { Icon } from './Icons';
import { NO_ID_LINE, OFF_LINE, READONLY_LINE, UNIT } from './RankBoard';
import './ranking.css';

interface Props {
  req: SubmitRequest;
  backend: RankingBackend;
  onClose: () => void;
  /** 순위표를 보러 간다 */
  onSeeBoard: () => void;
}

const FAIL_TEXT: Record<string, string> = {
  nickname: '별명은 1자에서 16자까지 쓸 수 있어요.',
  invalid: '이 비행은 순위표에 올릴 수 없어요. 다시 던진 다음에 올려 봐요.',
  busy: '지금 올리는 중이에요. 잠깐만 기다려 주세요.',
  full: '지금은 순위표에 자리가 없어요. 나중에 다시 해 봐요.',
  offline: '지금은 올리지 못했어요. 조금 있다가 다시 해 봐요.',
  closed: OFF_LINE,
  error: '올리지 못했어요. 조금 있다가 다시 해 봐요.',
};

export function SubmitDialog({ req, backend, onClose, onSeeBoard }: Props): JSX.Element {
  const state = useRankingState(backend);
  const [nickname, setNickname] = useState<string>(() => {
    const saved = loadJson(STORAGE_KEYS.nickname);
    return typeof saved === 'string' ? Array.from(saved).slice(0, NICK_MAX).join('') : '';
  });
  const [sending, setSending] = useState(false);
  const [out, setOut] = useState<SubmitOutcome | null>(null);

  const clean = sanitizeNickname(nickname);
  const tooLong = Array.from(nickname.trim()).length > NICK_MAX;
  const unit = UNIT[req.mode];
  const event = EVENT_NAME[req.mode];
  const board = state.boards[req.mode];

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (clean === null || sending) return;
    setSending(true);
    setOut(null);
    const r = await orAfter<SubmitOutcome>(backend.submit(req.mode, req.code, clean), WRITE_WAIT_MS, { ok: false, reason: 'offline' });
    setSending(false);
    if (r.ok || r.reason === 'not-better') saveJson(STORAGE_KEYS.nickname, clean);
    setOut(r);
  };

  let body: JSX.Element;
  if (out?.ok) {
    // 함께 쓰는 저장소에서는 순위가 살아 움직인다(다른 기록의 계산이 끝나면 바뀔 수 있다).
    const rank = backend.kind === 'pagedb' ? (board.mine?.rank ?? out.rank) : out.rank;
    const total = backend.kind === 'pagedb' ? board.total : out.total;
    body = (
      <div className="rk-done" data-testid="rank-done">
        <p className="rk-done__cheer">올렸어요!</p>
        <p className="rk-done__score" data-testid="official-score">{backend.kind === 'http' ? '공식 기록 ' : `${event} `}<b className="num">{fmt(out.score, 2)} {unit}</b></p>
        {rank !== null && <p className="rk-done__rank" data-testid="rank-result">지금 <b data-testid="rank-result-rank">{rank}등</b>이에요!{total !== null && total > 0 ? ` (모두 ${total}명)` : ''}{out.duplicate ? ' 이미 올린 기록이에요.' : ''}</p>}
        {backend.kind === 'pagedb' && board.pending > 0 && <p className="fine" role="status">다른 기록을 세는 중이라 등수가 조금 바뀔 수 있어요.</p>}
        {backend.kind === 'http' && <p className="fine">대회 본부가 같은 방법으로 다시 계산한 값이에요.</p>}
        <div className="btnrow">
          <button type="button" className="btn" onClick={onClose} data-testid="rank-done-close">닫기</button>
          <button type="button" className="btn btn--primary" onClick={onSeeBoard} data-testid="rank-done-board">순위표 보기</button>
        </div>
      </div>
    );
  } else if (out && out.reason === 'not-better') {
    body = (
      <div className="rk-done" data-testid="rank-kept">
        <p className="rk-done__cheer">올려 둔 기록이 더 좋아요!</p>
        <p className="rk-done__score">올려 둔 기록 <b className="num" data-testid="rank-kept-score">{fmt(out.existingScore, 2)} {unit}</b></p>
        <p>이번 기록은 <b className="num">{fmt(req.localScore, 2)} {unit}</b>라서, 순위표는 그대로 둘게요.</p>
        <div className="btnrow">
          <button type="button" className="btn" onClick={onClose} data-testid="rank-done-close">닫기</button>
          <button type="button" className="btn btn--primary" onClick={onSeeBoard} data-testid="rank-done-board">순위표 보기</button>
        </div>
      </div>
    );
  } else if (state.write !== 'yes' || (out && (out.reason === 'readonly' || out.reason === 'no-id'))) {
    body = (
      <div className="rk-done" data-testid="rank-readonly-dialog">
        <p className="rk__note">{state.write === 'no-id' ? NO_ID_LINE : READONLY_LINE}</p>
        <div className="btnrow">
          <button type="button" className="btn" onClick={onClose} data-testid="rank-done-close">닫기</button>
          <button type="button" className="btn btn--primary" onClick={onSeeBoard} data-testid="rank-done-board">순위표 보기</button>
        </div>
      </div>
    );
  } else {
    const errs = out && !out.ok ? (out.errors && out.errors.length > 0 ? out.errors : [FAIL_TEXT[out.reason] ?? FAIL_TEXT.error!]) : [];
    body = (
      <form className="stack" onSubmit={(e) => { void onSubmit(e); }} data-testid="rank-submit-form">
        <p className="rk-ticket"><span>{event}</span><b className="num" data-testid="rank-submit-score">{fmt(req.localScore, 2)} {unit}</b></p>
        <p className="fine">{backend.kind === 'http' ? '점수는 대회 본부가 비행기 코드로 다시 계산해요.' : '순위표에는 비행기 코드와 별명만 올라가요. 점수는 코드로 다시 계산해요.'}</p>
        <label className="field">
          <span className="field__label">순위표에 쓸 별명 (1~16자)</span>
          <input className="input" type="text" value={nickname} maxLength={32} autoComplete="off" enterKeyHint="done" placeholder="예: 종이왕" data-testid="rank-nickname" onChange={(e) => { setNickname(e.target.value); }} />
        </label>
        {tooLong && <p className="note-warn">별명은 16자까지 쓸 수 있어요.</p>}
        {errs.length > 0 && <ul className="note-warn rk-errs" role="alert" data-testid="rank-submit-errors">{errs.map((er, i) => <li key={i}>{er}</li>)}</ul>}
        <button type="submit" className="btn btn--primary btn--big" disabled={clean === null || sending} data-testid="rank-submit-send"><Icon name="trophy" />{sending ? '올리는 중…' : '올리기'}</button>
      </form>
    );
  }

  return (
    <Dialog title="랭킹에 올리기" onClose={onClose} testId="rank-submit">
      {body}
    </Dialog>
  );
}
