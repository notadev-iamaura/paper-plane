/**
 * 바람 실험실의 2D 그림(옆에서 본 모습). 입체 장면을 쓸 수 없는 기기에서 같은 내용을 보여 준다.
 * 연기 줄은 입체 장면과 같은 식(lib/lab/flowModel.ts)으로 그리고, 점선이 흘러가는 것으로 바람을 나타낸다.
 * 단위: SVG 의 1 은 1 mm. 가로는 바람이 흘러가는 방향(오른쪽이 뒤), 세로는 위아래. 원점은 받침대 축.
 */
import { useMemo } from 'react';
import type { PlaneGeometry, TunnelReading } from '../../core/index';
import { flowPoint, rakeHeights, SMOKE_PACE, vortexPoint } from '../lib/lab/flowModel';
import type { FlowModel, FlowPointOut } from '../lib/lab/flowModel';
import { arrowLength, gfText } from '../lib/lab/labMath';

interface Props {
  geometry: PlaneGeometry;
  tint: string;
  speedMps: number;
  alphaDeg: number;
  reading: TunnelReading;
  model: FlowModel;
  arrows: boolean;
  ghost: { liftN: number; dragN: number } | null;
  shake: number;
}

const MM = 1000;

/** 옆에서 본 비행기: 모든 삼각형을 옆면에 눌러 그린다(무게중심 기준, mm). */
function sidePath(g: PlaneGeometry): string {
  const p = g.mesh.positions;
  const parts: string[] = [];
  const f = (v: number): string => v.toFixed(1);
  for (let i = 0; i + 8 < p.length; i += 9) {
    const pts: string[] = [];
    for (let k = 0; k < 3; k++) {
      const x = (p[i + k * 3]! - g.cg.x) * MM, z = (p[i + k * 3 + 2]! - g.cg.z) * MM;
      pts.push(`${f(-x)} ${f(-z)}`);
    }
    parts.push(`M${pts[0]}L${pts[1]}L${pts[2]}Z`);
  }
  return parts.join('');
}

function Arrow({ x, y, dx, dy, cls, label, sub }: { x: number; y: number; dx: number; dy: number; cls: string; label: string; sub?: string }): JSX.Element | null {
  const len = Math.hypot(dx, dy);
  if (len < 4) return null;
  const ux = dx / len, uy = dy / len;
  const hx = x + dx, hy = y + dy;
  const bx = hx - ux * 12, by = hy - uy * 12;
  const head = `${hx},${hy} ${bx - uy * 7},${by + ux * 7} ${bx + uy * 7},${by - ux * 7}`;
  const tx = hx + ux * 6 + (Math.abs(ux) > 0.5 ? 2 : 6), ty = hy + uy * 8 + (uy > 0.5 ? 8 : uy < -0.5 ? -4 : 4);
  return (
    <g className={`labflat__arrow ${cls}`}>
      <line x1={x} y1={y} x2={bx} y2={by} />
      <polygon points={head} />
      {label && <text x={tx} y={ty}>{label}{sub ? <tspan className="labflat__sub"> {sub}</tspan> : null}</text>}
    </g>
  );
}

export function LabFlat({ geometry: g, tint, speedMps, alphaDeg, reading, model, arrows, ghost, shake }: Props): JSX.Element {
  const nose = Math.max(0.02, -g.cg.x), tail = Math.max(0.03, g.stats.lengthM + g.cg.x);
  const sIn = -(nose + 0.05), sOut = tail + 0.17;
  const hy = Math.min(0.18, Math.max(0.105, Math.max(nose, tail) * 0.8 + 0.022));
  const fanR = hy - 0.018;
  const path = useMemo(() => sidePath(g), [g]);
  const on = speedMps > 0.05;

  const lines = useMemo(() => {
    const out: { d: string; cls: string }[] = [];
    const fp: FlowPointOut = { s: 0, y: 0, z: 0, pace: 1, rough: 0 };
    const z0 = -model.spanHalfM * 0.55;
    const N = 44;
    const cl = (v: number): number => Math.max(-hy + 0.008, Math.min(hy - 0.008, v));
    for (const y0 of rakeHeights(9)) {
      const pts: string[] = [];
      let rough = 0;
      for (let k = 0; k <= N; k++) {
        flowPoint(model, z0, y0, sIn + ((sOut - sIn) * k) / N, 0, fp);
        rough = Math.max(rough, fp.rough);
        pts.push(`${(fp.s * MM).toFixed(1)},${(-cl(fp.y) * MM).toFixed(1)}`);
      }
      out.push({ d: pts.join(' '), cls: rough > 0.3 ? ' is-rough' : '' });
    }
    // 날개 끝 소용돌이(옆에서 보면 물결 모양)
    if (Math.abs(model.vortex) > 0.08) {
      const vp = { s: 0, y: 0, z: 0 };
      const pts: string[] = [];
      const s0 = model.tips[1].s;
      for (let k = 0; k <= N; k++) {
        vortexPoint(model, 1, ((sOut - s0) * k) / N, 0, vp);
        pts.push(`${(vp.s * MM).toFixed(1)},${(-cl(vp.y) * MM).toFixed(1)}`);
      }
      out.push({ d: pts.join(' '), cls: ' is-vortex' });
    }
    return out;
  }, [model, sIn, sOut, hy]);

  const dashMs = on ? Math.round((34 / (speedMps * SMOKE_PACE * MM)) * 1000) : 0;
  const cpX = -(reading.centerOfPressureX - g.cg.x) * MM;
  const a = (alphaDeg * Math.PI) / 180;
  // 힘이 걸리는 점(비행기와 함께 돈다)
  const cx = cpX * Math.cos(a), cy = cpX * Math.sin(a);
  const W = reading.weightN;
  const liftLen = on ? arrowLength(reading.liftN, W).lengthM * MM : 0;
  const dragLen = on ? arrowLength(reading.dragN, W).lengthM * MM : 0;
  const weightLen = arrowLength(W, W).lengthM * MM;
  const x0 = (sIn - 0.12) * MM, x1 = sOut * MM + 6;
  const y0 = -(hy + 0.03) * MM, y1 = (hy + 0.03) * MM;
  const fanX = (sIn - 0.055) * MM;
  const spinMs = on ? Math.round(2600 / (0.4 + speedMps)) : 0;

  return (
    <svg className={`labflat${on ? ' is-on' : ''}`} viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="xMidYMid meet" data-testid="lab-flat" role="img" aria-label="바람 실험실을 옆에서 본 그림">
      <rect className="labflat__desk" x={x0} y={hy * MM} width={x1 - x0} height={0.03 * MM + 2} />
      <rect className="labflat__board" x={sIn * MM} y={-hy * MM} width={(sOut - sIn) * MM} height={2 * hy * MM} rx={6} />
      {/* 선풍기 */}
      <g className="labflat__fan">
        <ellipse cx={fanX} cy={0} rx={26} ry={fanR * MM + 14} className="labflat__ring" />
        <g className="labflat__blades" style={{ transformOrigin: `${fanX}px 0px`, animationDuration: `${spinMs}ms` }}>
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx={fanX} cy={-fanR * MM * 0.5} rx={10} ry={fanR * MM * 0.46} className={`labflat__blade labflat__blade--${i}`} transform={`rotate(${i * 90} ${fanX} 0)`} />
          ))}
        </g>
        <circle cx={fanX} cy={0} r={15} className="labflat__hub" />
        <circle cx={fanX - 5} cy={-3} r={2} className="labflat__ink" /><circle cx={fanX + 5} cy={-3} r={2} className="labflat__ink" />
        <path d={`M${fanX - 6} 4 q6 6 12 0`} className="labflat__smile" />
      </g>
      {/* 벌집 바람 고르개 */}
      <line className="labflat__grille" x1={sIn * MM} y1={-hy * MM + 4} x2={sIn * MM} y2={hy * MM - 4} />
      {/* 받침대 */}
      <line className="labflat__post" x1={0} y1={hy * MM} x2={0} y2={4} />
      {/* 연기 */}
      <g className="labflat__smoke" style={{ animationDuration: `${dashMs}ms` }}>
        {lines.map((l, i) => <polyline key={i} points={l.d} className={`labflat__line${l.cls}`} style={{ animationDuration: `${dashMs}ms` }} />)}
      </g>
      {/* 비행기 */}
      <g transform={`rotate(${alphaDeg.toFixed(2)})`}>
        <g className={shake > 0.05 ? 'labflat__plane is-shaking' : 'labflat__plane'}>
          <path d={path} className="labflat__planeink" />
          <path d={path} style={{ fill: tint, stroke: tint }} className="labflat__planefill" />
        </g>
      </g>
      <circle cx={0} cy={0} r={5} className="labflat__pivot" data-lab-pivot="" />
      {arrows && (
        <g>
          {ghost && W > 0 && <Arrow x={cx + 6} y={cy} dx={0} dy={-arrowLength(ghost.liftN, W).lengthM * MM} cls="is-lift is-ghost" label="" />}
          {ghost && W > 0 && <Arrow x={cx + 6} y={cy + 6} dx={arrowLength(ghost.dragN, W).lengthM * MM} dy={0} cls="is-drag is-ghost" label="" />}
          <Arrow x={0} y={0} dx={0} dy={weightLen} cls="is-weight" label={`무게 ${gfText(W)} g`} />
          <Arrow x={cx} y={cy} dx={0} dy={-liftLen} cls="is-lift" label={`뜨는 힘 ${gfText(reading.liftN)} g`} />
          <Arrow x={cx} y={cy} dx={dragLen} dy={0} cls="is-drag" label={`막는 힘 ${gfText(reading.dragN)} g`} />
        </g>
      )}
      <rect className="labflat__frame" x={sIn * MM} y={-hy * MM} width={(sOut - sIn) * MM} height={2 * hy * MM} rx={6} />
    </svg>
  );
}
