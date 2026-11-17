/**
 * 위에서 내려다본 비행기 그림.
 * 손으로 그린 그림이 아니라 실제로 접힌 모양(geometry.mesh)을 그대로 내려다본 것이고,
 * 고른 종이의 무늬가 접힌 대로 붙어 있다(신문지를 고르면 신문지 비행기가 보인다).
 */
import { buildGeometry } from '../../core/index';
import type { PlaneDesign, PlaneGeometry } from '../../core/index';
import { planeThumbUrl } from '../three/planeThumb';

interface Props {
  /** 같은 그림을 다시 그리지 않기 위한 열쇠(모양이 같으면 같은 값) */
  id: string;
  design?: PlaneDesign;
  geometry?: PlaneGeometry;
  /** 종이 id. 그림의 무늬를 정한다. 없으면 design 에 적힌 종이를 쓴다. */
  paperId?: string;
  /** (예전 방식) 한 색으로 칠하던 때의 색. 이제는 종이 무늬로 그리므로 쓰지 않는다. */
  color?: string;
}

const geomCache = new Map<string, PlaneGeometry>();

export function Silhouette({ id, design, geometry, paperId }: Props): JSX.Element {
  const paper = paperId ?? design?.paperId ?? 'copy80';
  let g = geometry ?? geomCache.get(id);
  if (!g && design) {
    g = buildGeometry(design);
    geomCache.set(id, g);
    if (geomCache.size > 60) {
      const oldest = geomCache.keys().next().value;
      if (oldest !== undefined) geomCache.delete(oldest);
    }
  }
  const url = g ? planeThumbUrl(id, g, paper, 264) : '';
  if (!url) return <span className="silhouette" aria-hidden="true" />;
  return <img className="silhouette silhouette--img" src={url} alt="" aria-hidden="true" draggable={false} />;
}
