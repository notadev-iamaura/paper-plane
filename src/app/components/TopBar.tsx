/** 위쪽 작은 막대: 대회장으로 돌아가기, 지금 있는 곳 이름표, 소리 켬/끔, 기록장. */
import { useEffect, useState } from 'react';
import type { Screen } from '../state';
import { setSoundEnabled, soundEnabled, subscribeSound, unlockSound } from '../lib/sound';
import { HangarIcon } from './HangarIcons';
import { Icon } from './Icons';

const PLACE: Record<Screen, string> = { home: '대회장', desk: '책상', throw: '출발선', book: '기록장', hangar: '격납고' };

interface Props {
  screen: Screen;
  onHome: () => void;
  onBook: () => void;
  /** 격납고로 가기(넓은 화면의 막대와, 격납고 안에서 돌아갈 때 쓴다) */
  onHangar?: () => void;
  /** 격납고에서 나가기: 들어오기 전에 있던 곳으로 */
  onLeaveHangar?: () => void;
}

export function TopBar({ screen, onHome, onBook, onHangar, onLeaveHangar }: Props): JSX.Element {
  const [sound, setSound] = useState(soundEnabled);
  useEffect(() => subscribeSound(() => setSound(soundEnabled())), []);

  const toggleSound = (): void => {
    const next = !soundEnabled();
    setSoundEnabled(next);
    if (next) unlockSound(); // 누른 순간에만 소리 장치를 준비한다.
  };

  return (
    <header className="bar">
      {screen === 'home' ? (
        <span className="bar__logo" aria-hidden="true"><Icon name="plane" size={28} /></span>
      ) : screen === 'hangar' && onLeaveHangar ? (
        <button type="button" className="bar__btn bar__btn--back" onClick={onLeaveHangar} data-testid="nav-back">
          <Icon name="back" size={22} /><span className="bar__label bar__label--wide">돌아가기</span><span className="sr-only">돌아가기</span>
        </button>
      ) : (
        <button type="button" className="bar__btn bar__btn--back" onClick={onHome} data-testid="nav-home">
          <Icon name="back" size={22} /><Icon name="home" size={24} /><span className="sr-only">대회장으로 돌아가기</span>
        </button>
      )}
      <span className="bar__place tape tape--yellow" data-testid="place">{PLACE[screen]}</span>
      <span className="bar__gap" />
      <button type="button" className="bar__btn" role="switch" aria-checked={sound} onClick={toggleSound} data-testid="sound-toggle">
        <Icon name={sound ? 'soundOn' : 'soundOff'} size={24} /><span className="bar__label">소리 {sound ? '켬' : '끔'}</span>
      </button>
      {onHangar && screen !== 'hangar' && (
        <button type="button" className="bar__btn bar__btn--wide" onClick={onHangar} data-testid="nav-hangar">
          <HangarIcon name="hangar" size={24} /><span className="bar__label">격납고</span>
        </button>
      )}
      {screen !== 'book' && (
        <button type="button" className="bar__btn" onClick={onBook} data-testid="nav-book">
          <Icon name="book" size={24} /><span className="bar__label">기록장</span>
        </button>
      )}
    </header>
  );
}
