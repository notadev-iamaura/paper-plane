/**
 * 격납고 무대를 화면에 붙이는 얇은 React 껍데기(GymCanvas 와 같은 방식).
 * 캔버스와 무대를 한 번 만들고, 크기가 바뀌면 알려 주고, 화면에서 빠질 때 모두 정리한다.
 * WebGL 을 쓸 수 없거나 너무 느리면 onFlat 으로 알려서 2D 목록으로 바꾸게 한다.
 */
import { useEffect, useRef } from 'react';
import { log } from '../lib/logger';
import { HangarStage } from './HangarStage';
import type { HangarStageOpts } from './HangarStage';
import { webglAvailable } from './hangarPaper';
import { createRenderer } from './planeMesh';

interface Props {
  onStage: (stage: HangarStage | null) => void;
  /** 3D 로 보여 줄 수 없다(WebGL 없음, 장치를 잃음, 너무 느림) */
  onFlat: (why: 'nogl' | 'lost' | 'slow') => void;
  geometryOf: HangarStageOpts['geometryOf'];
  onPick: HangarStageOpts['onPick'];
  active: boolean;
}

export function HangarCanvas({ onStage, onFlat, geometryOf, onPick, active }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HangarStage | null>(null);
  // 무대는 한 번만 만들기 때문에, 바뀔 수 있는 함수들은 상자에 담아 최신 것을 부른다.
  const cb = useRef({ onStage, onFlat, geometryOf, onPick });
  cb.current = { onStage, onFlat, geometryOf, onPick };

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let stage: HangarStage | null = null;
    try {
      const renderer = webglAvailable() ? createRenderer(canvas) : null;
      if (renderer) {
        stage = new HangarStage(renderer, {
          geometryOf: (code) => cb.current.geometryOf(code),
          onPick: (id) => cb.current.onPick(id),
          onSlow: () => cb.current.onFlat('slow'),
          onLost: () => cb.current.onFlat('lost'),
        });
      }
    } catch (err) {
      log.warn('three', '격납고 장면을 만들지 못했어요', err);
      stage = null;
    }
    if (!stage) {
      log.warn('three', '이 기기에서는 3D 격납고를 그릴 수 없어 그림 목록으로 보여 줘요');
      cb.current.onFlat('nogl');
      return;
    }
    const st = stage;
    stageRef.current = st;
    // 개발, 갈무리용 손잡이(놀이 흐름에는 쓰지 않는다).
    (window as unknown as { __ppHangar?: HangarStage }).__ppHangar = st;
    const resize = (): void => st.resize(host.clientWidth, host.clientHeight);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    cb.current.onStage(st);
    return () => {
      ro.disconnect();
      cb.current.onStage(null);
      delete (window as unknown as { __ppHangar?: HangarStage }).__ppHangar;
      st.dispose();
      stageRef.current = null;
    };
  }, []);

  // 가려졌거나 화면 밖이면 그리기를 멈춘다.
  const activeRef = useRef(active);
  const seenRef = useRef(true);
  activeRef.current = active;
  useEffect(() => {
    stageRef.current?.setActive(active && seenRef.current);
  }, [active]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (!e) return;
      seenRef.current = e.isIntersecting;
      stageRef.current?.setActive(activeRef.current && seenRef.current);
    });
    io.observe(host);
    return () => io.disconnect();
  }, []);

  return (
    <div className="hg-canvas" ref={hostRef} data-testid="hangar-3d">
      <canvas ref={canvasRef} className="hg-canvas__gl" data-testid="hangar-canvas" aria-hidden="true" />
      <div className="hg-canvas__vignette" aria-hidden="true" />
    </div>
  );
}
