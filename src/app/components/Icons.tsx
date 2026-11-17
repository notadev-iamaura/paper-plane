/**
 * 직접 그린 작은 그림들(SVG). 크레파스로 그린 듯 굵고 둥근 남색 선에 색종이 색을 채운다.
 * 이모지나 아이콘 글꼴은 쓰지 않는다. 모두 장식이라 화면 낭독기에는 숨긴다(aria-hidden).
 */
import type { ReactNode } from 'react';

export type IconName =
  | 'home' | 'soundOn' | 'soundOff' | 'book' | 'note' | 'ruler' | 'clock' | 'plane' | 'back' | 'next'
  | 'check' | 'close' | 'copy' | 'star' | 'undo' | 'hand' | 'feather' | 'weight' | 'scissors' | 'pencil'
  | 'trophy' | 'retry' | 'fold' | 'lock' | 'megaphone' | 'bolt';

const P: Record<IconName, ReactNode> = {
  home: (<>
    <path d="M3.5 11.5 12 4l8.5 7.5" /><path d="M5.5 10.500V20h13v-9.5" className="fill-yellow" /><path d="M10 20v-5h4v5" className="fill-paper" />
  </>),
  soundOn: (<>
    <path d="M4 9.500h3.500L12 5.500v13l-4.5-4H4z" className="fill-yellow" /><path d="M15.5 9c1.3 1.6 1.3 4.4 0 6" /><path d="M18 6.500c2.7 3 2.7 8 0 11" />
  </>),
  soundOff: (<>
    <path d="M4 9.500h3.500L12 5.500v13l-4.5-4H4z" className="fill-shade" /><path d="m15.5 9.5 5 5M20.5 9.500l-5 5" />
  </>),
  book: (<>
    <path d="M5 4.500h12.500a1.5 1.5 0 0 1 1.5 1.500v13.500H6.500A1.5 1.5 0 0 1 5 18z" className="fill-blue" /><path d="M8.5 4.500v15" /><path d="M11.5 9h4.500M11.5 12.500h3" className="stroke-paper" />
  </>),
  note: (<>
    <path d="M6 3.500h12v17H6z" className="fill-paper" /><path d="M9 3.500v17" className="stroke-red" /><path d="M11.5 8h4.500M11.5 11.500h4.500M11.5 15h3" /><path d="M4 7h3M4 12h3M4 17h3" />
  </>),
  ruler: (<>
    <path d="M2.5 9h19v6.500h-19z" className="fill-yellow" /><path d="M6 9v3M9.5 9v2M13 9v3M16.5 9v2M20 9v0" />
  </>),
  clock: (<>
    <circle cx="12" cy="13.5" r="7" className="fill-paper" /><path d="M12 9.500v4l2.5 2" /><path d="M10 3.500h4M12 3.500v3M18 7l1.5-1.5" />
  </>),
  plane: (<>
    <path d="M3 11.5 21 4l-5.5 15.5-3.5-6z" className="fill-paper" /><path d="M12 13.5 21 4" />
  </>),
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  next: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  check: <path d="m5 12.5 4.5 4.500L19 7.5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  copy: (<>
    <path d="M8.5 8.500h10.500v11H8.500z" className="fill-paper" /><path d="M5 15.500V4.500h10.5" />
  </>),
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.900L12 16.9 6.8 19.700l1-5.900L3.5 9.700l5.9-.8z" className="fill-yellow" />,
  undo: (<>
    <path d="M8 5 4 9l4 4" /><path d="M4.5 9H14a5 5 0 0 1 0 10h-3" />
  </>),
  hand: (<>
    <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-1.500a1.5 1.5 0 0 1 3 0V11a1.5 1.5 0 0 1 3 0v4c0 3.5-2 5.5-5 5.500S7.5 19 6 16l-1.5-3a1.4 1.4 0 0 1 2.3-1.500z" className="fill-skin" />
  </>),
  feather: (<>
    <path d="M19.5 4.500c-6.5 0-11 4-11 9.500v2l-3 3.5" /><path d="M19.5 4.500c0 6.5-4 11-9.5 11H8.5" className="fill-paper" /><path d="M8.5 16 15 9.5" />
  </>),
  weight: (<>
    <path d="M6.5 9.500h11L20 19.500H4z" className="fill-shade" /><circle cx="12" cy="6.5" r="2.5" />
  </>),
  scissors: (<>
    <circle cx="6.5" cy="7" r="2.5" /><circle cx="6.5" cy="17" r="2.5" /><path d="M8.5 8.5 20 17M8.5 15.5 20 7" />
  </>),
  pencil: (<>
    <path d="m5 19 1-4L16.5 4.500l3 3L9 18z" className="fill-yellow" /><path d="m14.5 6.5 3 3" />
  </>),
  trophy: (<>
    <path d="M8 4.500h8v5a4 4 0 0 1-8 0z" className="fill-yellow" /><path d="M8 6H5c0 3 1.5 4.5 3.5 4.500M16 6h3c0 3-1.5 4.5-3.5 4.500M12 13.500v3.500M8.5 19.500h7" />
  </>),
  retry: (<>
    <path d="M19 12a7 7 0 1 1-2.2-5.1" /><path d="M19.5 4v4h-4" />
  </>),
  fold: (<>
    <path d="M5 3.5h9.5L19 8v12.5H5z" className="fill-paper" /><path d="M14.5 3.5V8H19z" className="fill-red" /><path d="M8 12.5h8M8 16h5" />
  </>),
  lock: (<>
    <path d="M6.5 11h11v8.500h-11z" className="fill-shade" /><path d="M9 11V8a3 3 0 0 1 6 0v3" />
  </>),
  megaphone: (<>
    <path d="M4.5 10v4l3 .5 8.5 4V5.500l-8.5 4z" className="fill-red" /><path d="M8 14.5 9 19.500h2.500l-1-4.500M18.5 9.500c1 1.5 1 3.5 0 5" />
  </>),
  bolt: <path d="M13 3.5 6 13h5l-1 7.5 7-9.500h-5z" className="fill-yellow" />,
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}

/** 도장: 빨간 동그라미 두 줄 안에 글자. 인주가 덜 묻은 듯 거칠게 찍힌다. */
export function Stamp({ text, small = false }: { text: string; small?: boolean }): JSX.Element {
  // "참 잘했어요" 는 "참"을 위에 따로 올려 두 줄로 찍는다.
  const two = text.startsWith('참 ');
  const lines = two ? [text.slice(0, 1), text.slice(2)] : [text];
  return (
    <svg className={`stamp${small ? ' stamp--small' : ''}`} viewBox="0 0 120 120" role="img" aria-label={`도장: ${text}`}>
      <defs>
        <filter id="stamp-rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.55" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
      </defs>
      <g filter="url(#stamp-rough)">
        <circle cx="60" cy="60" r="54" className="stamp__ring" />
        <circle cx="60" cy="60" r="46" className="stamp__ring stamp__ring--thin" />
        {two ? (
          <>
            <text x="60" y="52" className="stamp__text stamp__text--top">{lines[0]}</text>
            <text x="60" y="84" className="stamp__text">{lines[1]}</text>
            <path d="m38 36 4-9 4 9M74 36l4-9 4 9" className="stamp__deco" />
          </>
        ) : (
          <text x="60" y="70" className="stamp__text stamp__text--big">{lines[0]}</text>
        )}
      </g>
    </svg>
  );
}
