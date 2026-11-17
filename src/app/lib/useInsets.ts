/**
 * 조작 패널이 체육관 장면을 얼마나 가리는지 재서 무대에 알려 준다.
 * 패널이 화면 폭을 거의 다 차지하면(휴대전화) 아래쪽이, 한쪽에 떠 있으면(넓은 화면) 오른쪽이 가려진 것으로 본다.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Insets, Stage } from '../three/GymStage';

const BAR = 56;

export function measureInsets(panel: HTMLElement | null): Insets {
  const vw = window.innerWidth, vh = window.innerHeight;
  const base: Insets = { top: BAR, right: 0, bottom: 0, left: 0 };
  if (!panel) return base;
  const r = panel.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return base;
  // 폭을 거의 다 차지하거나 가운데 아래에 놓인 판은 아래쪽을 가린다.
  const centred = Math.abs(r.left + r.width / 2 - vw / 2) < 48;
  if (r.width >= vw * 0.7 || centred) return { ...base, bottom: Math.max(0, Math.min(vh * 0.7, vh - r.top)) };
  return { ...base, right: Math.max(0, vw - r.left) };
}

/** panelRef 가 가리키는 패널의 크기가 바뀔 때마다 무대에 가려진 폭을 알린다. onChange 로 바깥에서도 받을 수 있다. */
export function useStageInsets(stage: Stage | null, panelRef: RefObject<HTMLElement>, key: unknown, onChange?: (i: Insets) => void): void {
  useEffect(() => {
    const apply = (): void => {
      const i = measureInsets(panelRef.current);
      stage?.setInsets(i);
      onChange?.(i);
    };
    apply();
    const ro = new ResizeObserver(apply);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
    // onChange 는 매번 새로 만들어져도 다시 잴 필요가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, panelRef, key]);
}
