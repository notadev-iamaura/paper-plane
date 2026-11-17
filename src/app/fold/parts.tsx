/**
 * 접기 판의 작은 그림 조각들: 종이 그림, 손 모양 길잡이, 단추에 쓰는 손그림 아이콘.
 * 그림 좌표는 mm 이고, 종이 좌표의 +y(기수 쪽)가 화면 위를 향하도록 y 를 뒤집는다.
 */
import { useId, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Vec2 } from '../../core/types';
import type { Affine2, FoldedSheet } from '../../core/fold/fold';
import type { FoldTexture } from './types';
import { computeOutline } from './gesture';
import type { Seg } from './gesture';

/** m -> 그림 좌표(mm) */
export const X = (v: number): number => v * 1000;
export const Y = (v: number): number => -v * 1000;
export const pts = (poly: readonly Vec2[]): string => poly.map((p) => `${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ');

// ---------------------------------------------------------------------------
// 종이
// ---------------------------------------------------------------------------

interface PaperProps {
  sheet: FoldedSheet;
  /** sheet.layers 와 같은 순서. 지금 접히는 중(또는 방금 접힌) 겹이면 true. 없으면 모두 false. */
  moved?: readonly boolean[];
  /** 접히는 조각을 어떻게 그릴지. live: 끌고 있는 중(반투명), settle: 방금 접혀 내려앉는 중, none: 평소 */
  flap: 'live' | 'settle' | 'none';
  /** 뒤로 접는 중이면 true. 조각이 종이 뒤로 들어가므로 점선 윤곽으로 비쳐 보이게 그린다. */
  behind: boolean;
  /** 무늬가 없을 때의 앞면 색. 뒷면은 흰 도화지 색. */
  paperColor: string;
  /** 종이 무늬. 있으면 겹마다 "펼친 종이 위의 자리"에 맞춰 그림을 붙인다. */
  texture?: FoldTexture;
  /** 미리 구해 둔 바깥 테두리. 없으면 여기서 구한다(겹이 아주 많으면 생략). */
  edges?: readonly Seg[];
}

/** 겹이 이보다 많으면 끌고 있는 동안에는 테두리 계산을 건너뛴다(매 프레임 계산이라 느려질 수 있다). */
const LIVE_OUTLINE_MAX_LAYERS = 90;

/** 겹이 이보다 많으면 무늬를 붙이지 않고 대표 색으로만 칠한다(끌 때마다 다시 그리므로). */
const TEXTURE_MAX_LAYERS = 96;

/**
 * 펼친 종이 좌표(mm, y 는 아래로)에 놓인 그림을 접힌 자리로 옮기는 SVG 변환.
 * toSheet 는 "접힌 자리 -> 펼친 종이"(길이를 보존하는 변환)이므로 그 역변환을 쓴다.
 */
export function sheetToFoldedMatrix(m: Affine2): string {
  const e = -1000 * (m.m00 * m.tx + m.m10 * m.ty);
  const f = 1000 * (m.m01 * m.tx + m.m11 * m.ty);
  return `matrix(${m.m00.toFixed(6)} ${(-m.m01).toFixed(6)} ${(-m.m10).toFixed(6)} ${m.m11.toFixed(6)} ${e.toFixed(3)} ${f.toFixed(3)})`;
}

/** 종이 무늬 그림 두 장(앞, 뒤)을 <defs> 에 한 번만 넣어 두고 겹마다 <use> 로 가져다 쓴다. */
export function TextureDefs({ id, texture, widthM, heightM }: { id: string; texture: FoldTexture; widthM: number; heightM: number }): JSX.Element {
  const w = X(widthM);
  const h = X(heightM);
  return (
    <defs>
      <image id={`${id}-f`} href={texture.front} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="none" />
      {/* 뒷면 그림은 "뒤집어 들고 본 모습"이라 앞면 기준 좌표에서는 좌우를 뒤집어 놓아야 한다. */}
      <image id={`${id}-b`} href={texture.back} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="none" transform="scale(-1 1)" />
    </defs>
  );
}

/**
 * 납작하게 접힌 종이. 아래 겹부터 차례로 칠하면(화가 알고리즘) 접힌 모습이 된다.
 * 앞으로 접는 조각은 맨 위 겹들이므로 따로 묶어 마지막에 그린다.
 *
 * 겹 하나는 이렇게 쌓는다: (1) 아래 겹에 떨어지는 얇은 그림자 (2) 대표 색 바탕 (3) 종이에 붙은 무늬
 * (4) 가장자리 안쪽의 옅은 그늘(접힌 자리가 도드라진다). 뒷면이 보이는 겹은 뒷면 그림을 쓴다.
 */
export function PaperLayers(props: PaperProps): JSX.Element {
  const { sheet, moved, flap, behind, paperColor, texture } = props;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const edges = useMemo(() => {
    if (props.edges) return props.edges;
    if (sheet.layers.length > LIVE_OUTLINE_MAX_LAYERS) return [];
    return computeOutline(sheet).edges;
  }, [props.edges, sheet]);

  const isMoved = (i: number): boolean => flap !== 'none' && (moved?.[i] ?? false);
  const base: number[] = [];
  const top: number[] = [];
  sheet.layers.forEach((_, i) => {
    if (isMoved(i) && !behind) top.push(i);
    else base.push(i);
  });
  const textured = !!texture && sheet.layers.length <= TEXTURE_MAX_LAYERS;
  const thick = Math.max(0.6, Math.min(2.4, texture?.thickness ?? 1));
  // 얇은 종이는 아래 겹이 살짝 비친다(종이 밑에 대표 색 바탕을 깔아 두어 책상 색은 비치지 않는다).
  const seeThrough = textured ? Math.max(0, Math.min(1, texture?.translucency ?? 0)) : 0;
  const layerOpacity = seeThrough > 0.01 ? 1 - 0.2 * seeThrough : undefined;
  const frontFill = texture ? texture.frontTint : paperColor;
  const backFill = texture ? texture.backTint : undefined;

  const face = (i: number): JSX.Element => {
    const l = sheet.layers[i]!;
    const points = pts(l.poly);
    const cls = l.flipped ? 'fb-layer fb-layer--back' : 'fb-layer fb-layer--front';
    if (!textured) {
      return <polygon key={i} points={points} className={cls} style={l.flipped ? (backFill ? { fill: backFill } : undefined) : { fill: frontFill }} />;
    }
    const clip = `${uid}-c${i}`;
    return (
      <g key={i} className="fb-ply" opacity={layerOpacity}>
        {/* 아래 겹에 떨어지는 그림자: 흐림 없이 살짝 어긋난 그늘. 두꺼운 종이일수록 크다. */}
        {l.order > 0 && <polygon points={points} className="fb-ply__cast" transform={`translate(${(0.5 * thick).toFixed(2)} ${(0.9 * thick).toFixed(2)})`} />}
        <clipPath id={clip}><polygon points={points} /></clipPath>
        <polygon points={points} className={cls} style={{ fill: l.flipped ? backFill : frontFill }} />
        <g clipPath={`url(#${clip})`}>
          <use href={`#${uid}-${l.flipped ? 'b' : 'f'}`} transform={sheetToFoldedMatrix(l.toSheet)} />
          {l.flipped && texture?.sameBothSides && <polygon points={points} className="fb-ply__under" />}
          {/* 가장자리 안쪽의 옅은 그늘. 잘린 선의 안쪽 절반만 보인다. */}
          <polygon points={points} className="fb-ply__edge" />
        </g>
        <polygon points={points} className="fb-ply__line" />
      </g>
    );
  };
  const shade = (i: number): JSX.Element => <polygon key={`s${i}`} points={pts(sheet.layers[i]!.poly)} className="fb-shade" />;

  return (
    <g className={`fb-sheet${textured ? ' fb-sheet--tex' : ''}`}>
      {textured && texture && <TextureDefs id={uid} texture={texture} widthM={sheet.paper.widthM} heightM={sheet.paper.heightM} />}
      {/* 책상에 떨어진 그림자(흐림 없이 살짝 아래로) */}
      <g className="fb-drop" transform={`translate(0 ${(2.2 * (0.7 + 0.3 * thick)).toFixed(2)})`}>
        {base.map((i) => <polygon key={i} points={pts(sheet.layers[i]!.poly)} />)}
      </g>
      {/* 비치는 종이 밑에 까는 불투명한 바탕 */}
      {layerOpacity !== undefined && (
        <g style={{ fill: frontFill }}>
          {base.map((i) => <polygon key={i} points={pts(sheet.layers[i]!.poly)} />)}
        </g>
      )}
      {base.map(face)}
      {/* 겹칠수록 조금씩 어두워지게 얇은 그늘을 겹마다 한 번씩 덧칠한다. */}
      {!textured && base.map(shade)}

      {top.length > 0 && (
        <g className={`fb-flap fb-flap--${flap}`}>
          <g className="fb-flap__drop">
            {top.map((i) => <polygon key={i} points={pts(sheet.layers[i]!.poly)} />)}
          </g>
          <g className="fb-flap__body">
            {top.map(face)}
            {!textured && top.map(shade)}
          </g>
        </g>
      )}

      {/* 뒤로 접는 조각: 종이 뒤에 있어 안 보이므로 점선으로 비쳐 보이게 한다. */}
      {behind && flap === 'live' && (
        <g className="fb-ghost">
          {sheet.layers.map((l, i) => (isMoved(i) ? <polygon key={i} points={pts(l.poly)} /> : null))}
        </g>
      )}

      <g className="fb-outline">
        {edges.map((e, i) => <line key={i} x1={X(e.a.x)} y1={Y(e.a.y)} x2={X(e.b.x)} y2={Y(e.b.y)} />)}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// 손 모양 길잡이
// ---------------------------------------------------------------------------

interface HandCueProps {
  from: Vec2;
  to: Vec2;
  /** 화면 1 mm 가 몇 픽셀인지. 손과 점의 크기를 화면에서 늘 비슷하게 유지하려고 쓴다. */
  pxPerMm: number;
  /** 손가락으로 끄는 중이면 손은 숨기고 도착 표시만 남긴다. */
  dragging: boolean;
}

/**
 * "여기를 잡고 -> 저기로" 를 보여 주는 길잡이.
 * 잡을 곳에는 깜빡이는 점, 가는 길에는 점선 화살표, 그 위를 손이 반복해서 움직인다.
 * 움직임은 CSS 변수(--fb-x0 등)에 출발/도착 좌표를 넣고 keyframes 가 그 사이를 오가게 했다.
 */
export function HandCue({ from, to, pxPerMm, dragging }: HandCueProps): JSX.Element {
  const k = 1 / Math.max(0.2, pxPerMm); // 1 픽셀이 몇 mm 인지
  const x0 = X(from.x);
  const y0 = Y(from.y);
  const x1 = X(to.x);
  const y1 = Y(to.y);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  // 화살표는 점과 도착 고리에 닿지 않게 양 끝을 조금 줄인다.
  const gap0 = Math.min(len * 0.25, 13 * k);
  const gap1 = Math.min(len * 0.3, 16 * k);
  const ax0 = x0 + ux * gap0;
  const ay0 = y0 + uy * gap0;
  const ax1 = x1 - ux * gap1;
  const ay1 = y1 - uy * gap1;
  const head = 8 * k;
  const style = {
    '--fb-x0': `${x0}px`, '--fb-y0': `${y0}px`, '--fb-x1': `${x1}px`, '--fb-y1': `${y1}px`,
  } as CSSProperties;
  return (
    <g className="fb-cue" aria-hidden="true">
      <circle cx={x1} cy={y1} r={13 * k} className="fb-cue__dest" />
      <line x1={ax0} y1={ay0} x2={ax1} y2={ay1} className="fb-cue__path fb-cue__path--under" />
      <line x1={ax0} y1={ay0} x2={ax1} y2={ay1} className="fb-cue__path" />
      <polyline
        className="fb-cue__head"
        points={`${ax1 - ux * head - uy * head * 0.7},${ay1 - uy * head + ux * head * 0.7} ${ax1},${ay1} ${ax1 - ux * head + uy * head * 0.7},${ay1 - uy * head - ux * head * 0.7}`}
      />
      {!dragging && (
        <>
          <circle cx={x0} cy={y0} r={9 * k} className="fb-cue__pulse" />
          <circle cx={x0} cy={y0} r={6.5 * k} className="fb-cue__dot" />
          <g className="fb-cue__hand" style={style}>
            <g transform={`scale(${1.75 * k})`}>
              <path className="fb-hand" d={HAND_PATH} />
              <path className="fb-hand__lines" d="M3.4 12.5 v4.2 M7.6 13 v3.8" />
            </g>
          </g>
        </>
      )}
    </g>
  );
}

/** 검지로 가리키는 손. 원점(0,0)이 손가락 끝이다. 크기는 대략 20 x 27. */
const HAND_PATH = [
  'M -3 13.5',
  'V 3',
  'a 3 3 0 0 1 6 0',
  'V 10.2',
  'c 1.2 -1.4 4 -1 4.3 0.9',
  'c 1.3 -1.1 3.9 -0.4 4 1.6',
  'V 19',
  'c 0 4.6 -3.4 7.4 -7.6 7.4',
  'h -1.4',
  'c -3.4 0 -5.6 -1.8 -7.5 -4.8',
  'l -3.3 -5',
  'c -1.3 -2 1.3 -3.9 3 -2.3',
  'z',
].join(' ');

// ---------------------------------------------------------------------------
// 단추 아이콘 (24 x 24, 손으로 그린 듯한 둥근 선)
// ---------------------------------------------------------------------------

export type IconName =
  | 'undo' | 'redo' | 'reset' | 'both' | 'front' | 'back' | 'magnet' | 'skip'
  | 'pencil' | 'unfold' | 'chevron' | 'check' | 'close';

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg className={`fb-icon fb-icon--${name}`} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}

const ICONS: Record<IconName, JSX.Element> = {
  undo: (
    <>
      <path d="M9.3 5.6 4.4 10.4l5.1 4.7" />
      <path d="M4.8 10.4h9.1c3.3 0 5.6 2 5.6 4.7 0 2.6-2.2 4.5-5.3 4.5h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m14.7 5.6 4.9 4.8-5.1 4.7" />
      <path d="M19.2 10.4h-9.1c-3.3 0-5.6 2-5.6 4.7 0 2.6 2.2 4.5 5.3 4.5h3" />
    </>
  ),
  reset: (
    <>
      <path d="M6.2 3.6h8.3l3.6 3.7v13H6.2z" className="fb-icon__fill" />
      <path d="M14.4 3.8v3.7h3.5" />
      <path d="M9.4 12.2h5.6M9.4 15.8h3.6" />
    </>
  ),
  both: (
    <>
      <path d="M12 2.8v18.6" strokeDasharray="2.4 3" />
      <path d="M9.4 6.2 3.2 17.4h6.2z" className="fb-icon__fill" />
      <path d="m14.6 6.2 6.2 11.2h-6.2z" className="fb-icon__fill" />
    </>
  ),
  front: (
    <>
      <path d="M12.6 4.2h6.6v15.6H4.8v-8.2" />
      <path d="M4.9 11.4 12.5 4.3l.1 7.2z" className="fb-icon__fill" />
    </>
  ),
  back: (
    <>
      <path d="M12.6 4.2h6.6v15.6H4.8v-8.2z" className="fb-icon__fill" />
      <path d="M4.9 11.4 12.5 4.3" />
      <path d="M12.6 4.4v7.1H5" strokeDasharray="2.2 2.8" />
    </>
  ),
  magnet: (
    <>
      <path d="M5.2 4.4h4.6v7.4c0 1.5.9 2.4 2.2 2.4s2.2-.9 2.2-2.4V4.4h4.6v7.5c0 4.2-2.8 7.2-6.8 7.2s-6.8-3-6.8-7.200z" className="fb-icon__fill" />
      <path d="M5.4 8.300h4.200M14.400 8.300h4.200" />
    </>
  ),
  skip: (
    <>
      <path d="m5 6 6.6 6L5 18" />
      <path d="m12.800 6 6.600 6-6.600 6" />
    </>
  ),
  pencil: (
    <>
      <path d="M3.600 20.400 20.400 3.600" strokeDasharray="2.600 3" />
      <path d="m13.200 15.600 5.400-5.400 2.400 2.400-5.400 5.400-3.200.800z" className="fb-icon__fill" />
    </>
  ),
  unfold: (
    <>
      <path d="M5 3.800h14v16.400H5z" className="fb-icon__fill" />
      <path d="M5.200 10.800 12 4M18.800 10.800 12 4M12 4v16" strokeDasharray="2.200 2.600" />
    </>
  ),
  chevron: <path d="m6 9.200 6 6 6-6" />,
  check: <path d="m5 12.600 4.600 4.400L19 7.400" />,
  close: <path d="M6.400 6.400 17.600 17.600M17.600 6.400 6.400 17.600" />,
};
