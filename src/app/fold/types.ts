/**
 * 접기 판(FoldBoard)의 계약. 화면 담당과 접기 판 담당이 이 파일을 기준으로 따로 작업한다.
 * 접기 판은 "종이를 직접 잡아 접는" 편집기이며, 자기 상태를 갖지 않고 folds 를 받아 그리고
 * 바뀐 folds 를 onFolds 로 돌려준다(되돌리기 기록은 바깥 상태가 맡는다).
 */
import type { ReactNode } from 'react';
import type { FoldOp, PaperSpec } from '../../core/index';

/**
 * 종이 무늬. 주어지면 종이를 한 색으로 칠하는 대신 이 그림을 "종이에 붙은 채로" 접는다
 * (겹마다 펼친 종이 위의 자리를 따라가므로 신문지를 접으면 조각마다 글줄 방향이 달라진다).
 */
export interface FoldTexture {
  /** 앞면 그림 주소(data URL 등). 종이와 같은 비율이고 위쪽이 기수 쪽이다. */
  front: string;
  /** 뒷면 그림 주소. "뒤집어 들고 본 모습"이어야 한다. 앞뒤가 같은 종이면 front 와 같은 값. */
  back: string;
  /** 그림이 뜨기 전이나 겹이 아주 많을 때 쓰는 대표 색 */
  frontTint: string;
  backTint: string;
  /** 앞뒤 그림이 같은 종이인지(뒷면을 살짝 그늘지게 해서 구별한다) */
  sameBothSides?: boolean;
  /** 비쳐 보이는 정도 0 ~ 1. 얇은 종이는 아래 겹이 살짝 비친다. */
  translucency?: number;
  /** 도톰한 정도(일반 복사지 = 1). 겹친 조각 아래의 그림자가 이만큼 커진다. */
  thickness?: number;
}

export interface FoldBoardProps {
  paper: PaperSpec;
  /** 지금까지의 접기 */
  folds: FoldOp[];
  /** 새 접기 목록. 한 번의 동작으로 1개(또는 양쪽 같이 접기면 2개)가 늘어난다. */
  onFolds: (next: FoldOp[]) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 처음부터 다시 */
  onReset: () => void;
  /** 무늬가 없을 때의 종이 색(앞면). 뒷면은 흰색으로 그린다. CSS 색 문자열. texture 가 있으면 쓰지 않는다. */
  paperColor: string;
  /** 종이 무늬(선택). 있으면 paperColor 대신 이 그림으로 종이를 그린다. */
  texture?: FoldTexture;
  /**
   * 종이 옆에 함께 놓을 것(선택). 보통 "지금 접은 비행기의 입체 모습"을 넣는다.
   * 책상을 좌우로 나눠 오른쪽에 놓이고, 가운데 막대를 끌어 크기를 바꿀 수 있다.
   */
  aside?: ReactNode;
  /** aside 를 놓는 방법. split: 책상을 나눠 옆에(기본), pip: 책상 구석에 작게 띄워서. */
  asideLayout?: 'split' | 'pip';
  /** 좁은 화면에서 되돌리기 등의 도구를 항상 보이는 곳에 붙인다. 없으면 판 아래에 놓는다. */
  toolbarHost?: HTMLElement | null;
  /**
   * 따라 접기 길잡이. 주어지면 folds.length 번째 접기를 "다음에 할 접기"로 손 모양이 안내하고,
   * 사용자의 접기가 안내와 충분히 비슷하면 안내 값으로 정확히 맞춰 준다. 끝까지 따라 하면 onGuideDone 을 부른다.
   */
  guide?: FoldOp[];
  onGuideDone?: () => void;
  /** 효과음. 접혔을 때 'fold', 맞춤 도우미가 붙었을 때 'snap', 접을 수 없을 때 'nope'. 없으면 소리 없음. */
  onSound?: (name: 'fold' | 'snap' | 'nope') => void;
}
