/**
 * 바람 실험실 무대를 화면에 붙이는 얇은 React 껍데기(HangarCanvas 와 같은 방식).
 * WebGL 을 쓸 수 없거나 너무 느리면 onFlat 으로 알려서 2D 그림으로 바꾸게 한다.
 */
import { useEffect, useRef } from 'react';
import { log } from '../lib/logger';
import { webglAvailable } from './hangarPaper';
import { createRenderer } from './planeMesh';
import { TunnelStage } from './TunnelStage';
import type { TunnelAnchors } from './TunnelStage';

interface Props {
  onStage: (stage: TunnelStage | null) => void;
  onFlat: (why: 'nogl' | 'lost' | 'slow') => void;
  onAnchors: (a: TunnelAnchors) => void;
  active: boolean;
}

export function TunnelCanvas({ onStage, onFlat, onAnchors, active }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<TunnelStage | null>(null);
  const cb = useRef({ onStage, onFlat, onAnchors });
  cb.current = { onStage, onFlat, onAnchors };

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let stage: TunnelStage | null = null;
    try {
      const renderer = webglAvailable() ? createRenderer(canvas) : null;
      if (renderer) {
        stage = new TunnelStage(renderer, {
          onSlow: () => cb.current.onFlat('slow'),
          onLost: () => cb.current.onFlat('lost'),
          onAnchors: (a) => cb.current.onAnchors(a),
        });
      }
    } catch (err) {
      log.warn('three', '바람 실험실 장면을 만들지 못했어요', err);
      stage = null;
    }
    if (!stage) {
      log.warn('three', '이 기기에서는 입체 실험실을 그릴 수 없어 그림으로 보여 줘요');
      cb.current.onFlat('nogl');
      return;
    }
    const st = stage;
    stageRef.current = st;
    // 개발, 갈무리용 손잡이(놀이 흐름에는 쓰지 않는다).
    (window as unknown as { __ppLab?: TunnelStage }).__ppLab = st;
    const resize = (): void => st.resize(host.clientWidth, host.clientHeight);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    cb.current.onStage(st);
    return () => {
      ro.disconnect();
      cb.current.onStage(null);
      delete (window as unknown as { __ppLab?: TunnelStage }).__ppLab;
      st.dispose();
      stageRef.current = null;
    };
  }, []);

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
    <div className="lab-canvas" ref={hostRef} data-testid="lab-3d">
      <canvas ref={canvasRef} className="lab-canvas__gl" data-testid="lab-canvas" aria-hidden="true" />
      <div className="hg-canvas__vignette" aria-hidden="true" />
    </div>
  );
}
