/**
 * 연구 노트에 들어가는 그림들: 받음각 곡선, 무게중심 막대, 옆에서 본 궤적.
 * 그래프 라이브러리 없이 SVG 로 직접 그린다. 모눈 공책에 연필과 색연필로 그린 느낌으로 꾸민다(styles.css).
 */
import type { AeroSummary, PlaneGeometry, SimResult } from '../../core/index';
import { clamp, fmt, pct } from '../lib/format';

interface Pt { x: number; y: number }

/** 보기 좋은 눈금 값을 고른다(1, 2, 5 의 배수). */
function niceTicks(min: number, max: number, target: number): number[] {
  const span = max - min || 1;
  const rough = span / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 5, 10].map((m) => m * pow).find((u) => span / u <= target + 1) ?? pow * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / unit - 1e-9) * unit; v <= max + unit * 1e-6; v += unit) out.push(Number(v.toFixed(10)));
  return out;
}

interface ChartProps {
  title: string;
  /** 이 그래프가 무엇을 말하는지 쉬운 한 줄 */
  explain: string;
  yLabel: string;
  points: Pt[];
  trimX: number | null;
  stallX: number;
  digits: number;
  testId?: string;
}

const W = 328, H = 200;
const M = { left: 46, right: 12, top: 14, bottom: 40 };

function LineChart({ title, explain, yLabel, points, trimX, stallX, digits, testId }: ChartProps): JSX.Element {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const pad = (yMax - yMin || 1) * 0.08;
  yMin -= yMin < 0 ? pad : 0;
  yMax += pad;

  const px = (x: number): number => M.left + ((x - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
  const py = (y: number): number => H - M.bottom - ((y - yMin) / (yMax - yMin || 1)) * (H - M.top - M.bottom);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const xTicks = niceTicks(xMin, xMax, 7);
  const yTicks = niceTicks(yMin, yMax, 5);

  // 안정 받음각에서의 값(곡선 위의 점). 앞뒤 점 사이를 직선으로 본다.
  let trimY: number | null = null;
  if (trimX !== null) {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!, b = points[i + 1]!;
      if (trimX >= a.x && trimX <= b.x) {
        trimY = a.y + ((b.y - a.y) * (trimX - a.x)) / (b.x - a.x || 1);
        break;
      }
    }
  }

  return (
    <figure className="chart" data-testid={testId}>
      <figcaption className="chart__title">{title}</figcaption>
      <p className="chart__explain">{explain}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} 그래프`}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={py(t)} y2={py(t)} className={t === 0 ? 'chart__zero' : 'chart__grid'} />
            <text x={M.left - 6} y={py(t) + 3.5} className="chart__tick" textAnchor="end">{fmt(t, digits)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={px(t)} x2={px(t)} y1={M.top} y2={H - M.bottom} className="chart__grid" />
            <text x={px(t)} y={H - M.bottom + 13} className="chart__tick" textAnchor="middle">{t}</text>
          </g>
        ))}
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} className="chart__axis" />
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} className="chart__axis" />
        {stallX >= xMin && stallX <= xMax && (
          <g>
            <line x1={px(stallX)} x2={px(stallX)} y1={M.top} y2={H - M.bottom} className="chart__stall" />
            <text x={px(stallX) + 3} y={M.top + 9} className="chart__mark chart__mark--stall">실속 {fmt(stallX, 0)}°</text>
          </g>
        )}
        <path d={path} className="chart__line" />
        {trimX !== null && trimY !== null && (
          <g>
            <line x1={px(trimX)} x2={px(trimX)} y1={py(trimY)} y2={H - M.bottom} className="chart__trim" />
            <circle cx={px(trimX)} cy={py(trimY)} r={4.5} className="chart__trimdot" />
            <text x={px(trimX) + 6} y={Math.max(M.top + 20, py(trimY) - 6)} className="chart__mark chart__mark--trim">활공 {fmt(trimX, 1)}°</text>
          </g>
        )}
        <text x={(M.left + W - M.right) / 2} y={H - 6} className="chart__axislabel" textAnchor="middle">받음각 (도)</text>
        <text x={12} y={(M.top + H - M.bottom) / 2} className="chart__axislabel" textAnchor="middle" transform={`rotate(-90 12 ${(M.top + H - M.bottom) / 2})`}>{yLabel}</text>
      </svg>
    </figure>
  );
}

export function PolarCharts({ summary }: { summary: AeroSummary }): JSX.Element {
  const p = summary.polar;
  const common = { trimX: summary.trimAlphaDeg, stallX: summary.stallAlphaDeg };
  return (
    <div className="charts">
      <LineChart title="양력 계수 CL" explain="위로 뜨는 힘. 날개를 세울수록 커지다가, 너무 세우면 뚝 떨어져요." yLabel="CL (단위 없음)" digits={1} points={p.map((r) => ({ x: r.alphaDeg, y: r.cl }))} {...common} testId="chart-cl" />
      <LineChart title="항력 계수 CD" explain="뒤로 잡아당기는 힘. 날개를 세울수록 계속 커져요." yLabel="CD (단위 없음)" digits={1} points={p.map((r) => ({ x: r.alphaDeg, y: r.cd }))} {...common} testId="chart-cd" />
      <LineChart title="양항비 L/D" explain="뜨는 힘 ÷ 잡아당기는 힘. 클수록 멀리 미끄러져 가요." yLabel="L/D (단위 없음)" digits={0} points={p.map((r) => ({ x: r.alphaDeg, y: r.cd > 1e-6 ? r.cl / r.cd : 0 }))} {...common} testId="chart-ld" />
      <LineChart title="피칭 모멘트 계수 Cm (무게중심 기준)" explain="코를 들거나 숙이는 힘. 선이 0을 지나며 내려가는 곳에서 비행기가 균형을 잡아요." yLabel="Cm (단위 없음)" digits={2} points={p.map((r) => ({ x: r.alphaDeg, y: r.cm }))} {...common} testId="chart-cm" />
    </div>
  );
}

/** 활공 구역의 폭(평균 시위 대비 정적 여유) */
const GLIDE_MARGIN = 0.25;

/**
 * 옆에서 본 비행기를 막대로 나타내고, 무게중심과 중립점의 위치를 표시한다.
 * 색 구역은 정적 여유만으로 그린 대략적인 기준이다(중립점보다 뒤: 뒤집힘, 바로 앞: 활공, 더 앞: 급강하 쪽).
 */
export function CgBar({ geometry, summary }: { geometry: PlaneGeometry; summary: AeroSummary }): JSX.Element {
  const len = Math.max(geometry.stats.lengthM, 1e-6);
  const BW = 328, x0 = 14, x1 = BW - 14;
  const px = (xBody: number): number => x0 + clamp(-xBody / len, 0, 1) * (x1 - x0);
  const np = summary.neutralPointX;
  const glideFront = np + GLIDE_MARGIN * geometry.stats.macM;
  const cgX = px(geometry.cg.x);
  const npX = px(np);
  const macA = px(geometry.stats.macLeX);
  const macB = px(geometry.stats.macLeX - geometry.stats.macM);
  const close = Math.abs(cgX - npX) < 64;
  const cgAnchor = close ? (cgX <= npX ? 'end' : 'start') : 'middle';
  const npAnchor = close ? (cgX <= npX ? 'start' : 'end') : 'middle';

  return (
    <figure className="cgbar" data-testid="cgbar">
      <svg viewBox={`0 0 ${BW} 132`} role="img" aria-label={`무게중심은 기수에서 전체 길이의 ${pct(geometry.stats.cgFracLength)}% 지점`}>
        <text x={x0} y={12} className="cgbar__end">기수(코)</text>
        <text x={x1} y={12} className="cgbar__end" textAnchor="end">꼬리</text>
        <rect x={x0} y={44} width={Math.max(0, px(glideFront) - x0)} height={22} className="cgbar__zone cgbar__zone--dive" />
        <rect x={px(glideFront)} y={44} width={Math.max(0, npX - px(glideFront))} height={22} className="cgbar__zone cgbar__zone--glide" />
        <rect x={npX} y={44} width={Math.max(0, x1 - npX)} height={22} className="cgbar__zone cgbar__zone--tumble" />
        <rect x={x0} y={44} width={x1 - x0} height={22} className="cgbar__frame" />
        <line x1={macA} x2={macB} y1={72} y2={72} className="cgbar__mac" />
        <line x1={macA} x2={macA} y1={69} y2={75} className="cgbar__mac" />
        <line x1={macB} x2={macB} y1={69} y2={75} className="cgbar__mac" />
        <path d={`M${cgX},44 l-6,-10 h12 z`} className="cgbar__cg" />
        <line x1={cgX} x2={cgX} y1={44} y2={66} className="cgbar__cgline" />
        <text x={cgX} y={28} className="cgbar__label cgbar__label--cg" textAnchor={cgAnchor}>무게중심 {pct(geometry.stats.cgFracLength)}%</text>
        <path d={`M${npX},66 l-6,10 h12 z`} className="cgbar__np" />
        <text x={npX} y={90} className="cgbar__label cgbar__label--np" textAnchor={npAnchor}>중립점(추정)</text>
        <g transform="translate(14 112)">
          <rect width={10} height={10} y={-9} className="cgbar__zone cgbar__zone--dive" />
          <text x={14} className="cgbar__legend">급강하 쪽</text>
          <rect x={78} width={10} height={10} y={-9} className="cgbar__zone cgbar__zone--glide" />
          <text x={92} className="cgbar__legend">활공</text>
          <rect x={130} width={10} height={10} y={-9} className="cgbar__zone cgbar__zone--tumble" />
          <text x={144} className="cgbar__legend">뒤집힘</text>
          <line x1={196} x2={216} y1={-4} y2={-4} className="cgbar__mac" />
          <text x={220} className="cgbar__legend">평균 시위(MAC)</text>
        </g>
      </svg>
    </figure>
  );
}

const TW = 328, TH = 150;
const TM = { left: 34, right: 12, top: 10, bottom: 32 };

/** 옆에서 본 궤적(가로: 던진 방향 거리, 세로: 높이). 가로세로 눈금 비율은 같지 않을 수 있다. */
export function TrajectoryPlot({ result }: { result: SimResult }): JSX.Element {
  const s = result.samples;
  let minX = 0, maxX = 1, maxZ = 2;
  for (const p of s) {
    if (p.pos.x < minX) minX = p.pos.x;
    if (p.pos.x > maxX) maxX = p.pos.x;
    if (p.pos.z > maxZ) maxZ = p.pos.z;
  }
  maxX = Math.ceil(maxX + 0.5);
  minX = Math.floor(minX);
  maxZ = Math.ceil(maxZ + 0.2);
  const px = (x: number): number => TM.left + ((x - minX) / (maxX - minX)) * (TW - TM.left - TM.right);
  const py = (z: number): number => TH - TM.bottom - (z / maxZ) * (TH - TM.top - TM.bottom);
  const path = s.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.pos.x).toFixed(1)},${py(Math.max(0, p.pos.z)).toFixed(1)}`).join(' ');
  const xStep = maxX - minX > 30 ? 10 : maxX - minX > 12 ? 5 : maxX - minX > 6 ? 2 : 1;
  const xTicks: number[] = [];
  for (let x = Math.ceil(minX / xStep) * xStep; x <= maxX; x += xStep) xTicks.push(x);
  const zStep = maxZ > 8 ? 4 : maxZ > 4 ? 2 : 1;
  const zTicks: number[] = [];
  for (let z = 0; z <= maxZ; z += zStep) zTicks.push(z);
  const last = s[s.length - 1];

  return (
    <figure className="chart chart--traj" data-testid="trajectory">
      <figcaption className="chart__title">옆에서 본 궤적</figcaption>
      <p className="chart__explain">비행기가 지나간 길이에요. 파란 점에서 던져서 빨간 점에 내려앉았어요.</p>
      <svg viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label={`궤적 그래프. 최고 높이 ${fmt(result.maxHeightM, 1)} m`}>
        {zTicks.map((z) => (
          <g key={`z${z}`}>
            <line x1={TM.left} x2={TW - TM.right} y1={py(z)} y2={py(z)} className={z === 0 ? 'chart__axis' : 'chart__grid'} />
            <text x={TM.left - 5} y={py(z) + 3.5} className="chart__tick" textAnchor="end">{z}</text>
          </g>
        ))}
        {xTicks.map((x) => (
          <g key={`x${x}`}>
            <line x1={px(x)} x2={px(x)} y1={TM.top} y2={TH - TM.bottom} className="chart__grid" />
            <text x={px(x)} y={TH - TM.bottom + 13} className="chart__tick" textAnchor="middle">{x}</text>
          </g>
        ))}
        <path d={path} className="chart__line chart__line--traj" />
        {s[0] && <circle cx={px(s[0].pos.x)} cy={py(s[0].pos.z)} r={4} className="chart__start" />}
        {last && <circle cx={px(last.pos.x)} cy={py(0)} r={4.5} className="chart__trimdot" />}
        <text x={(TM.left + TW - TM.right) / 2} y={TH - 4} className="chart__axislabel" textAnchor="middle">던진 방향 거리 (m)</text>
        <text x={10} y={(TM.top + TH - TM.bottom) / 2} className="chart__axislabel" textAnchor="middle" transform={`rotate(-90 10 ${(TM.top + TH - TM.bottom) / 2})`}>높이 (m)</text>
      </svg>
    </figure>
  );
}
