import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : 정적 호스팅 어디에 올려도 상대 경로로 동작하도록 한다.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: process.env.PP_INLINE_FONTS === '1' ? 'dist-preview' : 'dist',
    // 글꼴 조각(woff2)은 따로 파일로 내보내 필요한 것만 내려받게 하고, 그 밖의 작은 자원은 번들에 넣는다.
    // PP_INLINE_FONTS=1 이면 글꼴까지 CSS 안에 넣어 파일 수를 줄인다(파일 수 제한이 있는 미리보기 게시용).
    // 아이 모델(kid.glb)도 따로 파일로 둔다: 켰을 때만 내려받고, base64 로 부풀지 않는다.
    assetsInlineLimit: (file: string) => process.env.PP_INLINE_FONTS === '1' || !(file.endsWith('.woff2') || file.endsWith('.glb')),
    chunkSizeWarningLimit: 2000,
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as any);
