/** 스티커 한 장: 톱니 모양 동그란 딱지 안에 별과 이름. 아직 못 받은 스티커는 점선 빈자리로 보인다. */
import type { StickerDef } from '../lib/stickers';
import { Icon } from './Icons';

interface Props {
  def: StickerDef;
  got: boolean;
  /** 방금 받았을 때 뿅 하고 붙는다 */
  pop?: boolean;
}

export function StickerBadge({ def, got, pop }: Props): JSX.Element {
  return (
    <span className={`sticker${got ? ' is-got' : ''}${pop ? ' is-pop' : ''}`} style={{ '--sticker': `var(${def.token})` } as React.CSSProperties} data-testid={`sticker-${def.id}`} data-got={got}>
      <span className="sticker__disc" aria-hidden="true">{got ? <Icon name="star" size={22} /> : <Icon name="lock" size={18} />}</span>
      <span className="sticker__name">{def.name}</span>
      {!got && <span className="sticker__how">{def.how}</span>}
    </span>
  );
}
