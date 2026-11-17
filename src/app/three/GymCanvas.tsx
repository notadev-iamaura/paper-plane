/**
 * 체육관 무대를 화면에 붙이는 얇은 React 껍데기.
 * 캔버스와 무대(GymStage)를 한 번 만들고, 크기가 바뀌면 알려 주고, 화면에서 빠질 때 모두 정리한다.
 * WebGL 을 쓸 수 없으면 색종이로 오려 붙인 듯한 그림 배경과 빈 무대(NullStage)로 대신한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { log } from '../lib/logger';
import { GymStage, NullStage } from './GymStage';
import type { Stage } from './GymStage';
import { createRenderer } from './planeMesh';

interface Props {
  /** 무대가 준비되면(또는 사라지면 null 로) 불린다. */
  onStage: (stage: Stage | null) => void;
  /** 보이지 않을 때는 그리기를 멈춘다. */
  active: boolean;
}

const VIGNETTE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background: 'radial-gradient(ellipse 85% 75% at 50% 42%, rgba(255, 236, 200, 0) 55%, rgba(120, 62, 30, 0.2) 100%), linear-gradient(rgba(255, 214, 150, 0.05), rgba(255, 190, 120, 0.07))',
};

export function GymCanvas({ onStage, active }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let stage: Stage;
    let renderer = null;
    try {
      renderer = createRenderer(canvas);
      stage = renderer ? new GymStage(renderer) : new NullStage();
    } catch (err) {
      log.warn('three', '체육관 장면을 만들지 못했어요', err);
      stage = new NullStage();
      renderer = null;
    }
    if (!renderer) {
      log.warn('three', '이 기기에서는 3D 체육관을 그릴 수 없어 그림 배경으로 보여 줘요');
      setFlat(true);
    }
    stageRef.current = stage;
    // 개발, 갈무리용 손잡이(놀이 흐름에는 쓰지 않는다).
    (window as unknown as { __ppStage?: Stage }).__ppStage = stage;
    const resize = (): void => stage.resize(host.clientWidth, host.clientHeight);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    onStage(stage);
    return () => {
      ro.disconnect();
      onStage(null);
      delete (window as unknown as { __ppStage?: Stage }).__ppStage;
      stage.dispose();
      stageRef.current = null;
    };
    // 무대는 한 번만 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 화면에 보이지 않으면(다른 화면에 가려졌거나, 품고 있는 틀 밖으로 밀려났으면) 그리기를 멈춘다.
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
    <div className={`gym${flat ? ' gym--flat' : ''}`} style={{ position: 'relative' }} ref={hostRef} aria-hidden="true" data-testid="gym">
      <canvas ref={canvasRef} className="gym__canvas" data-testid="gym-canvas" />
      {/* 가장자리를 살짝 어둡고 따뜻하게(비네트). 후처리 없이 CSS 한 겹으로 끝낸다. */}
      {!flat && <div style={VIGNETTE} />}
    </div>
  );
}
