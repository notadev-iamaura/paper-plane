/**
 * 기록장: 최고 기록, 순위표(위에서 몇 줄. 쓸 수 없는 곳에서는 한 줄 안내), 스티커판, 최근 비행, 내 비행기 코드(복사와 불러오기).
 */
import { useMemo, useState } from 'react';
import { decodeDesign, encodeDesign } from '../../core/index';
import { fmt, shortTime } from '../lib/format';
import { EVENT_NAME, VERDICT_SHORT } from '../lib/kidvoice';
import type { FlightRecord, Records } from '../lib/records';
import { rankUi } from '../lib/ranking/useRanking';
import { stickerCount, STICKERS } from '../lib/stickers';
import type { StickerProgress } from '../lib/stickers';
import { HangarIcon } from '../components/HangarIcons';
import { useHangarApi } from '../components/HangarKit';
import { Icon } from '../components/Icons';
import { RankBoard } from '../components/RankBoard';
import { CodeCopy } from '../components/ShareDialog';
import { StickerBadge } from '../components/StickerBadge';

interface Props {
  records: Records;
  progress: StickerProgress;
  shareCode: string;
  /** 코드를 불러온다. 성공하면 true. */
  onLoadCode: (code: string, from: string) => boolean;
  /** 값이 바뀌면 순위표를 다시 받는다(등록 직후 등) */
  rankingToken: number;
  onGoHangar: () => void;
}

/** 비행 코드(모양 + 던지기)에서 모양만의 코드를 꺼낸다. 못 읽으면 null. */
function designCodeOf(code: string): string | null {
  try {
    const dec = decodeDesign(code);
    return dec ? encodeDesign(dec.design) : null;
  } catch {
    return null;
  }
}

export function Book({ records, progress, shareCode, onLoadCode, rankingToken, onGoHangar }: Props): JSX.Element {
  const hangar = useHangarApi();
  // 최근 비행 가운데 격납고에 넣어 둔 비행기로 날린 것은 그 이름을 같이 보여 준다.
  const recentNames = useMemo(() => records.recent.map((r) => {
    const dc = designCodeOf(r.code);
    return dc ? (hangar.data.planes.find((pl) => pl.code === dc)?.name ?? null) : null;
  }), [records.recent, hangar.data]);
  return (
    <section className="book" aria-labelledby="book-title">
      <div className="book__page">
        <h1 id="book-title" className="book__title">기록장</h1>

        <button type="button" className="hangardoor" onClick={onGoHangar} data-testid="book-hangar">
          <span className="hangardoor__icon" aria-hidden="true"><HangarIcon name="hangar" size={34} /></span>
          <span className="hangardoor__text"><strong>격납고</strong><small>{hangar.data.planes.length > 0 ? `내 비행기 ${hangar.data.planes.length}대가 기다려요` : '마음에 드는 비행기를 넣어 두는 곳'}</small></span>
          <Icon name="next" size={22} />
        </button>

        <h2 className="h-tape"><span className="tape tape--yellow">내 최고 기록</span></h2>
        <div className="bests">
          <BestTag title={EVENT_NAME.distance} icon="ruler" rec={records.bestDistance} value={(r) => `${fmt(r.distanceM, 2)} m`} onLoad={onLoadCode} testId="best-distance" />
          <BestTag title={EVENT_NAME.airtime} icon="clock" rec={records.bestAirtime} value={(r) => `${fmt(r.airtimeS, 2)} 초`} onLoad={onLoadCode} testId="best-airtime" />
        </div>

        <RankBoard records={records} onLoadCode={onLoadCode} limit={5} onSeeAll={rankUi.openBoard} token={rankingToken} />

        <h2 className="h-tape"><span className="tape tape--blue">스티커판</span><span className="h-tape__count" data-testid="sticker-count">{stickerCount(progress)} / {STICKERS.length}</span></h2>
        <div className="stickerboard" data-testid="stickerboard">
          {STICKERS.map((def) => <StickerBadge key={def.id} def={def} got={progress.got[def.id] !== undefined} />)}
        </div>

        <h2 className="h-tape"><span className="tape tape--yellow">최근 비행</span></h2>
        {records.recent.length === 0 ? (
          <p className="empty">아직 던진 적이 없어요. 대회장에서 비행기를 접어 날려 봐요!</p>
        ) : (
          <ol className="recent" data-testid="recent-list">
            {records.recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="recent__item">
                <span className="recent__nums"><b className="num">{fmt(r.distanceM, 2)}</b> m · <b className="num">{fmt(r.airtimeS, 2)}</b> 초</span>
                <span className="recent__meta">{recentNames[i] ? <b className="recent__plane" data-testid={`recent-plane-${i}`}>{recentNames[i]} · </b> : null}{VERDICT_SHORT[r.verdict]} · {shortTime(r.at)}</span>
                <button type="button" className="btn btn--small" onClick={() => onLoadCode(r.code, '최근 비행')} data-testid={`recent-load-${i}`}>이 비행기 꺼내기</button>
              </li>
            ))}
          </ol>
        )}

        <h2 className="h-tape"><span className="tape tape--blue">내 비행기 코드</span></h2>
        <p className="lead">지금 비행기를 코드로 만들어 친구에게 보내거나, 친구가 준 코드로 비행기를 꺼낼 수 있어요.</p>
        <CodeCopy code={shareCode} />
        <LoadCode onLoadCode={onLoadCode} />

      </div>
    </section>
  );
}

function BestTag({ title, icon, rec, value, onLoad, testId }: {
  title: string;
  icon: 'ruler' | 'clock';
  rec: FlightRecord | null;
  value: (r: FlightRecord) => string;
  onLoad: (code: string, from: string) => boolean;
  testId: string;
}): JSX.Element {
  return (
    <div className="nametag" data-testid={testId}>
      <span className="nametag__head"><Icon name={icon} size={20} />{title}</span>
      {rec ? (
        <>
          <span className="nametag__value num">{value(rec)}</span>
          <span className="nametag__meta">{shortTime(rec.at)}</span>
          <button type="button" className="btn btn--small" onClick={() => onLoad(rec.code, title)}>이 비행기 꺼내기</button>
        </>
      ) : (
        <span className="nametag__empty">아직 없어요</span>
      )}
    </div>
  );
}

function LoadCode({ onLoadCode }: { onLoadCode: (code: string, from: string) => boolean }): JSX.Element {
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onLoad = (): void => {
    // 주소째 붙여 넣어도 # 뒤의 코드만 꺼내 쓴다.
    let code = input.trim();
    const hashAt = code.lastIndexOf('#p');
    if (hashAt >= 0) code = code.slice(hashAt + 2);
    if (code === '') {
      setMsg({ ok: false, text: '먼저 코드를 붙여 넣어 주세요.' });
      return;
    }
    const ok = onLoadCode(code, '붙여 넣은 코드');
    setMsg(ok
      ? { ok: true, text: '비행기를 꺼냈어요! 출발선에서 던져 볼 수 있어요.' }
      : { ok: false, text: '코드가 맞지 않아요. 처음부터 끝까지 빠짐없이 붙여 넣었는지 봐 주세요.' });
    if (ok) setInput('');
  };

  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">친구 코드 넣기</span>
        <textarea className="input input--code" rows={3} value={input} placeholder="받은 코드를 여기에 붙여 넣어요" data-testid="load-input" onChange={(e) => { setInput(e.target.value); setMsg(null); }} />
      </label>
      <button type="button" className="btn" onClick={onLoad} data-testid="load-code">이 코드로 비행기 꺼내기</button>
      {msg && <p className={msg.ok ? 'note-ok' : 'note-warn'} role="status" data-testid="load-msg">{msg.text}</p>}
    </div>
  );
}
