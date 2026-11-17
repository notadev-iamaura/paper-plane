/**
 * 순위표의 큰 판과 "랭킹에 올리기" 대화상자를 띄우는 자리(App 에 한 번만 놓는다),
 * 그리고 결과 패널에 놓는 입구 단추(RankEntry).
 * 다른 화면은 rankUi.openBoard(), rankUi.openSubmit() 만 부르면 된다.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Flight } from '../lib/flight';
import type { Records } from '../lib/records';
import { rankUi, useRankingSelection, useRankUi } from '../lib/ranking/useRanking';
import { Dialog } from './Dialog';
import { Icon } from './Icons';
import { RankBoard } from './RankBoard';
import { SubmitDialog } from './SubmitDialog';
import './ranking.css';

interface HostProps {
  records: Records;
  onLoadCode: (code: string, from: string) => boolean;
  /** 지금 있는 화면. 화면이 바뀌면 떠 있던 판을 닫는다. */
  screen: string;
}

export function RankingHost({ records, onLoadCode, screen }: HostProps): JSX.Element | null {
  const ui = useRankUi();
  const sel = useRankingSelection();
  useEffect(() => {
    rankUi.closeAll();
  }, [screen]);
  if (sel.kind !== 'ready') return null;
  return (
    <>
      {ui.board && (
        <Dialog title="순위표" onClose={rankUi.closeBoard} testId="rank-screen">
          <RankBoard records={records} onLoadCode={onLoadCode} initialMode={ui.board.mode} title={false} />
        </Dialog>
      )}
      {ui.submit && (
        <SubmitDialog
          key={`${ui.submit.mode}-${ui.submit.code}`}
          req={ui.submit}
          backend={sel.backend}
          onClose={rankUi.closeSubmit}
          onSeeBoard={() => { const mode = ui.submit!.mode; rankUi.closeSubmit(); rankUi.openBoard(mode); }}
        />
      )}
    </>
  );
}

const noop = (): (() => void) => () => undefined;

/** 결과 패널의 입구: "랭킹에 올리기"와 "순위표". 순위표를 쓸 수 없는 곳에서는 아무것도 그리지 않는다. */
export function RankEntry({ flight, onViewed }: { flight: Flight; /** 순위표에서 다른 비행기를 꺼냈을 때(결과 패널을 접고 조준으로 돌아간다) */ onViewed: () => void }): JSX.Element | null {
  const sel = useRankingSelection();
  const viewed = useRankUi().viewed;
  const seen = useRef(viewed);
  useEffect(() => {
    if (viewed === seen.current) return;
    seen.current = viewed;
    onViewed();
  }, [viewed, onViewed]);
  const backend = sel.kind === 'ready' ? sel.backend : null;
  // 여기서는 순위표를 켜지 않는다(읽지 않는다). 올릴 수 있는 사람인지만 본다.
  const write = useSyncExternalStore(backend ? backend.subscribe : noop, () => (backend ? backend.getState().write : 'no-id'));
  const status = useSyncExternalStore(backend ? backend.subscribe : noop, () => (backend ? backend.getState().status : 'idle'));
  if (!backend || status === 'closed') return null;
  const score = flight.mode === 'distance' ? flight.result.distanceM : flight.result.airtimeS;
  return (
    <div className={`rk-entry${write === 'yes' ? '' : ' rk-entry--one'}`} data-testid="rank-entry">
      {write === 'yes' && (
        <button type="button" className="btn rk-entry__up" onClick={() => rankUi.openSubmit({ code: flight.code, mode: flight.mode, localScore: score })} data-testid="rank-open-submit">
          <Icon name="trophy" size={20} />랭킹에 올리기
        </button>
      )}
      <button type="button" className="btn" onClick={() => rankUi.openBoard(flight.mode)} data-testid="rank-open-board">순위표{write === 'yes' ? '' : ' 구경하기'}</button>
    </div>
  );
}
