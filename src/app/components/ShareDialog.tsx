/**
 * 자랑하기: 내 비행기 코드를 복사해서 친구에게 보낸다.
 * 랭킹 서버가 연결된 빌드에서는 여기서 기록도 올릴 수 있다.
 * 서버로 보내는 값은 코드, 종목, 별명뿐이다. 화면에서 계산한 점수는 보내지 않는다(서버가 다시 계산한다).
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { GameMode } from '../../core/index';
import { RANKING_ENABLED, submitScore } from '../api';
import type { SubmitResponse } from '../api';
import { copyText } from '../lib/clipboard';
import { fmt } from '../lib/format';
import { EVENT_NAME } from '../lib/kidvoice';
import { loadJson, saveJson, STORAGE_KEYS } from '../lib/storage';
import { Dialog } from './Dialog';
import { Icon } from './Icons';

/** 코드 상자 + 복사 단추. 기록장에서도 같이 쓴다. */
export function CodeCopy({ code }: { code: string }): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [msg, setMsg] = useState('');

  // 클립보드는 반드시 누름 처리 안에서 부른다(브라우저 규칙).
  const onCopy = (): void => {
    void copyText(code).then((ok) => {
      if (ok) {
        setMsg('복사했어요! 친구에게 붙여 넣어 보내요.');
        return;
      }
      // 자동 복사가 막혔을 때: 글자를 골라 두고 직접 복사하도록 알려 준다.
      const el = ref.current;
      if (el) {
        el.focus();
        el.select();
      }
      setMsg('자동으로 복사하지 못했어요. 코드를 골라 두었으니 길게 눌러서(또는 Ctrl+C) 복사해 주세요.');
    });
  };

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">내 비행기 코드</span>
        <textarea ref={ref} className="input input--code" readOnly rows={3} value={code} data-testid="share-code" onFocus={(e) => e.currentTarget.select()} />
      </label>
      <button type="button" className="btn btn--primary btn--big" onClick={onCopy} data-testid="copy-code"><Icon name="copy" />코드 복사하기</button>
      <p className="statusline" role="status" aria-live="polite" data-testid="copy-msg">{msg}</p>
    </div>
  );
}

interface Props {
  code: string;
  mode: GameMode;
  /** 방금 던진 기록이 있을 때만 랭킹에 올릴 수 있다 */
  canRank: boolean;
  onClose: () => void;
  onRanked: () => void;
}

export function ShareDialog({ code, mode, canRank, onClose, onRanked }: Props): JSX.Element {
  return (
    <Dialog title="자랑하기" onClose={onClose} testId="share-dialog">
      <div className="stack">
        <p>이 코드에는 내가 접은 비행기와 던진 방법이 들어 있어요. 친구가 기록장에서 코드를 넣으면 똑같은 비행기가 나와요.</p>
        <CodeCopy code={code} />
        <p className="fine">이 화면의 주소(# 뒤)에도 같은 코드가 들어 있어서, 주소를 그대로 보내도 돼요.</p>
        {RANKING_ENABLED && canRank && <RankForm code={code} mode={mode} onDone={onRanked} />}
      </div>
    </Dialog>
  );
}

function RankForm({ code, mode, onDone }: { code: string; mode: GameMode; onDone: () => void }): JSX.Element {
  const [nickname, setNickname] = useState<string>(() => {
    const saved = loadJson(STORAGE_KEYS.nickname);
    return typeof saved === 'string' ? saved.slice(0, 16) : '';
  });
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<SubmitResponse | null>(null);

  const trimmed = nickname.trim();
  // 글자 수는 눈에 보이는 글자 기준으로 센다.
  const count = Array.from(trimmed).length;
  const valid = count >= 1 && count <= 16;
  const unit = mode === 'distance' ? 'm' : '초';

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!valid || sending) return;
    setSending(true);
    setErrors([]);
    const r = await submitScore(code, mode, trimmed);
    setSending(false);
    if (r.ok) {
      saveJson(STORAGE_KEYS.nickname, trimmed);
      setDone(r.data);
      onDone();
    } else {
      setErrors(r.errors);
    }
  };

  if (done) {
    return (
      <div className="rankbox" data-testid="rank-done">
        <p className="rankbox__score" data-testid="official-score">공식 기록 <b className="num">{fmt(done.entry.score, 2)} {unit}</b></p>
        <p>{EVENT_NAME[mode]} <b>{done.rank}등</b>이에요! (모두 {done.total}개 기록){done.duplicate ? ' 이미 올린 기록이에요.' : ''}</p>
        <p className="fine">대회 본부가 같은 방법으로 다시 계산한 값이에요.</p>
      </div>
    );
  }
  return (
    <form className="rankbox stack" onSubmit={(e) => { void onSubmit(e); }} data-testid="rank-form">
      <strong className="rankbox__title"><Icon name="trophy" />랭킹에 올리기</strong>
      <p className="fine">방금 던진 기록을 {EVENT_NAME[mode]} 랭킹에 올려요. 점수는 대회 본부가 코드로 다시 계산해요.</p>
      <label className="field">
        <span className="field__label">별명 (1~16자)</span>
        <input className="input" type="text" value={nickname} maxLength={32} autoComplete="off" data-testid="nickname" onChange={(e) => setNickname(e.target.value)} />
      </label>
      {count > 16 && <p className="note-warn">별명은 16자까지 쓸 수 있어요.</p>}
      {errors.length > 0 && <ul className="note-warn" role="alert" data-testid="submit-errors">{errors.map((er, i) => <li key={i}>{er}</li>)}</ul>}
      <button type="submit" className="btn" disabled={!valid || sending} data-testid="submit-send">{sending ? '올리는 중…' : '올리기'}</button>
    </form>
  );
}
