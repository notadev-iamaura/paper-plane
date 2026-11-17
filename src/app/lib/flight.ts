/** 던진 비행 한 번(결과와 그에 딸린 놀이 정보). App 이 만들고 출발선 화면이 보여 준다. */
import type { GameMode, SimResult } from '../../core/index';
import type { Grade } from './kidvoice';
import type { StickerId } from './stickers';

export interface Flight {
  /** 이 비행을 만든 내 비행기 코드(접은 모양 + 던지기 값) */
  code: string;
  /** 던지기 값을 뺀, 접은 모양만의 코드 */
  designCode: string;
  mode: GameMode;
  result: SimResult;
  grade: Grade;
  /** 이 종목의 내 최고 기록을 넘었는지 */
  isBest: boolean;
  /** 이번 비행으로 새로 받은 스티커 */
  fresh: StickerId[];
}
