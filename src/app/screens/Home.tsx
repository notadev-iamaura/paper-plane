/**
 * 대회장(홈): 체육관이 화면을 가득 채우고, 아래에 종목 고르기와 큰 단추 하나가 놓인다.
 * 제목은 체육관 벽의 현수막이 맡는다(화면 낭독기를 위한 제목은 따로 숨겨 둔다).
 */
import { useEffect, useRef, useState } from 'react';
import type { GameMode } from '../../core/index';
import { fmt } from '../lib/format';
import { EVENT_NAME } from '../lib/kidvoice';
import type { Records } from '../lib/records';
import { STICKERS } from '../lib/stickers';
import { useStageInsets } from '../lib/useInsets';
import type { Stage } from '../three/GymStage';
import { HangarIcon } from '../components/HangarIcons';
import { Icon } from '../components/Icons';

interface Props {
  stage: Stage | null;
  mode: GameMode;
  records: Records;
  stickerCount: number;
  /** 이미 접어 둔 비행기가 있는지 */
  hasPlane: boolean;
  showHint: boolean;
  version: string;
  onMode: (m: GameMode) => void;
  onGoDesk: () => void;
  onGoThrow: () => void;
  onGoBook: () => void;
  /** 격납고(넣어 둔 비행기를 모아 두는 곳)로 가기와, 거기 든 비행기 수 */
  onGoHangar: () => void;
  hangarCount: number;
  onCloseHint: () => void;
  onVersionTap: () => void;
  /** 내 캐릭터(꾸미기)로 가기. charNudge = "캐릭터도 꾸밀 수 있어요" 귀띔을 보여 줄지(처음 한 번) */
  onGoCharacter: () => void;
  charNudge?: boolean;
  onCharNudgeShown?: () => void;
}

export function Home(p: Props): JSX.Element {
  const sheetRef = useRef<HTMLDivElement>(null);
  useStageInsets(p.stage, sheetRef, `${p.hasPlane}-${p.showHint}`);

  const best = p.mode === 'distance' ? p.records.bestDistance : p.records.bestAirtime;
  useEffect(() => {
    if (!p.stage) return;
    p.stage.showHome();
    p.stage.setBoard('최고 기록', best ? (p.mode === 'distance' ? `${fmt(best.distanceM, 2)} m` : `${fmt(best.airtimeS, 2)} 초`) : '아직 없음');
  }, [p.stage, p.mode, best]);

  const bestText = (m: GameMode): string => {
    const r = m === 'distance' ? p.records.bestDistance : p.records.bestAirtime;
    if (!r) return '첫 기록에 도전!';
    return m === 'distance' ? `최고 ${fmt(r.distanceM, 2)} m` : `최고 ${fmt(r.airtimeS, 2)} 초`;
  };

  // 체육관의 아이를 눌러도 꾸미기로 간다: 아이가 화면의 어디에 서 있는지 무대에 물어 그 위에 투명한 단추를 얹는다.
  const [kidBox, setKidBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!p.stage?.kidRect) return;
    const read = (): void => setKidBox(p.stage?.kidRect?.() ?? null);
    const id = window.setInterval(read, 700);
    read();
    return () => window.clearInterval(id);
  }, [p.stage]);
  const { charNudge, onCharNudgeShown } = p;
  useEffect(() => {
    if (charNudge) onCharNudgeShown?.();
  }, [charNudge, onCharNudgeShown]);

  return (
    <section className="home" aria-labelledby="home-title">
      <h1 id="home-title" className="sr-only">종이비행기 날리기 대회</h1>
      {kidBox && (
        <button type="button" className="home__kid" style={{ left: kidBox.x, top: kidBox.y, width: kidBox.w, height: kidBox.h }} onClick={p.onGoCharacter} aria-label="내 캐릭터 꾸미기" data-testid="home-kid" />
      )}

      <div className="home__bottom" ref={sheetRef}>
      {p.showHint && (
        <div className="bubble" role="note" data-testid="hint">
          <p><b>어서 와요!</b> 종이로 비행기를 접어서 체육관 끝까지 날려 봐요.</p>
          <button type="button" className="btn btn--small" onClick={p.onCloseHint} data-testid="hint-close">좋아요!</button>
        </div>
      )}

      <div className="sheet home__sheet">
        <div className="eventpick" role="radiogroup" aria-label="종목 고르기">
          {(['distance', 'airtime'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={p.mode === m} className={`eventpick__opt${p.mode === m ? ' is-on' : ''}`} onClick={() => p.onMode(m)} data-testid={`event-${m}`}>
              <Icon name={m === 'distance' ? 'ruler' : 'clock'} size={30} />
              <span className="eventpick__text">
                <strong>{EVENT_NAME[m]}</strong>
                <small className="num" data-testid={`home-best-${m}`}>{bestText(m)}</small>
              </span>
            </button>
          ))}
        </div>

        <button type="button" className="btn btn--primary btn--xl" onClick={p.onGoDesk} data-testid="go-desk">
          <Icon name="fold" size={28} />비행기 접으러 가기
        </button>
        {p.hasPlane && (
          <button type="button" className="btn btn--plain" onClick={p.onGoThrow} data-testid="go-throw">
            접어 둔 비행기 바로 던지기<Icon name="next" size={20} />
          </button>
        )}

        {/* 곁단추 줄: 칸이 늘면 같은 폭으로 나눠 앉는다(단추를 옆에 더 넣어도 된다). */}
        {p.charNudge && <span className="charnudge" role="note" data-testid="char-nudge">아이도 꾸밀 수 있어요!</span>}
        <div className="home__side" data-testid="home-side">
          <button type="button" className="sidebtn" onClick={p.onGoHangar} data-testid="go-hangar">
            <HangarIcon name="hangar" size={26} />
            <span className="sidebtn__text"><strong>격납고</strong><small className="num" data-testid="home-hangar-count">{p.hangarCount > 0 ? `내 비행기 ${p.hangarCount}대` : '내 비행기 모으기'}</small></span>
          </button>
          <button type="button" className="sidebtn" onClick={p.onGoCharacter} data-testid="go-character">
            <svg className="icon" width={26} height={26} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="13" r="7.500" className="fill-skin" /><path d="M4.500 12C5 6.500 8.500 4 12 4s7 2.500 7.500 8c-2.500-2-5-1-7.500-3-2.500 2-5 1-7.500 3z" className="fill-yellow" /><path d="M9.500 13.500v1M14.500 13.500v1M9.800 17c1.400 1 3 1 4.400 0" />
            </svg>
            <span className="sidebtn__text"><strong>내 캐릭터</strong></span>
          </button>
        </div>

        <div className="home__foot">
          <button type="button" className="stickerlink" onClick={p.onGoBook} data-testid="home-stickers">
            <Icon name="star" size={20} />스티커 <span className="num">{p.stickerCount} / {STICKERS.length}</span>
          </button>
          <button type="button" className="version" onClick={p.onVersionTap} data-testid="version" aria-label={`버전 ${p.version}`}>v{p.version}</button>
        </div>
      </div>
      </div>
    </section>
  );
}
