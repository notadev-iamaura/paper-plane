/** 격납고에서 쓰는 작은 그림들(직접 그린 SVG). 선 굵기와 색은 Icons.tsx 와 같은 규칙(.icon)을 따른다. */
import type { ReactNode } from 'react';

export type HangarIconName = 'hangar' | 'starOn' | 'starOff' | 'trash' | 'swap' | 'box';

const STAR = 'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.700l5.9-.8z';

const P: Record<HangarIconName, ReactNode> = {
  // 둥근 지붕 격납고 안에 종이비행기 한 대
  hangar: (<>
    <path d="M3 20V11.500C3 7 7 4 12 4s9 3 9 7.500V20z" className="fill-blue" /><path d="M6.5 20v-6.500h11V20z" className="fill-paper" /><path d="m8.5 17 7-2.200-2.200 4.200-1.400-1.600z" className="fill-yellow" /><path d="M2 20h20" />
  </>),
  starOn: <path d={STAR} className="fill-yellow" />,
  starOff: <path d={STAR} className="fill-paper" />,
  trash: (<>
    <path d="M6.5 8h11l-1 12h-9z" className="fill-shade" /><path d="M4.5 8h15M9.500 8V5h5v3M10 11.500v5M14 11.500v5" />
  </>),
  swap: (<>
    <path d="M5 9h12.500l-3-3M19 15H6.500l3 3" />
  </>),
  box: (<>
    <path d="M4 9h16v10.500H4z" className="fill-yellow" /><path d="M3 5.500h18V9H3z" className="fill-paper" /><path d="M10 12.500h4" />
  </>),
};

export function HangarIcon({ name, size = 24 }: { name: HangarIconName; size?: number }): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}
