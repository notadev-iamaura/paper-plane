/**
 * 클립보드 복사. 반드시 누름(click) 처리 안에서 불러야 한다(브라우저 규칙).
 * 실패하면 false 를 돌려주므로, 부른 쪽에서 글자를 선택해 두고 직접 복사하도록 안내한다.
 */
import { log } from './logger';

export function copyText(text: string): Promise<boolean> {
  try {
    const clip: Clipboard | undefined = navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function') return Promise.resolve(false);
    return clip.writeText(text).then(
      () => true,
      (err: unknown) => {
        log.warn('share', '클립보드 복사가 거부됐어요', err);
        return false;
      },
    );
  } catch (err) {
    log.warn('share', '클립보드를 쓸 수 없어요', err);
    return Promise.resolve(false);
  }
}
