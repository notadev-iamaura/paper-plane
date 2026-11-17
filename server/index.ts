/**
 * 랭킹 서버 실행 파일.  npm run server
 *
 * 환경 변수
 *   PORT         듣는 포트 (기본 8787)
 *   HOST         듣는 주소 (기본 0.0.0.0)
 *   DATA_FILE    랭킹을 저장할 JSON 파일 경로. 없으면 메모리에만 둔다(껐다 켜면 사라진다).
 *   CORS_ORIGIN  허용할 화면 출처 (기본 '*'). 예: https://example.com
 *   MAX_QUEUE    동시에 받아 둘 제출 수 (기본 20). 넘으면 503.
 */
import { createServer } from 'node:http';
import { CORE_VERSION, createApp, remeasureEntry } from './app';
import { FileStore, MemoryStore } from './store';

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '0.0.0.0';
const dataFile = process.env.DATA_FILE;
const maxQueue = Number(process.env.MAX_QUEUE) || undefined;

// 파일에 적힌 물리 판이 지금과 다르면(옛 규칙의 기록) 시작할 때 코드로 모두 다시 계산한다.
// 한 줄에 0.1~0.2초쯤 걸리므로 기록이 많으면 처음 한 번은 켜지는 데 시간이 걸린다(같은 코드는 한 번만 계산한다).
const remeasured = new Map<string, ReturnType<typeof remeasureEntry>>();
const fileStore = dataFile
  ? new FileStore(dataFile, undefined, {
      version: CORE_VERSION,
      recompute: (e) => {
        if (!remeasured.has(e.code)) remeasured.set(e.code, remeasureEntry(e));
        const hit = remeasured.get(e.code) ?? null;
        // 같은 코드라도 줄마다 id, 닉네임, 모드가 다르다: 계산값만 옮겨 싣는다.
        return hit ? { ...e, code: hit.code, distanceM: hit.distanceM, airtimeS: hit.airtimeS, verdict: hit.verdict, score: e.mode === 'distance' ? hit.distanceM : hit.airtimeS } : null;
      },
    })
  : null;
remeasured.clear();
const store = fileStore ?? new MemoryStore();
const server = createServer(createApp({ store, corsOrigin: process.env.CORS_ORIGIN, maxQueue }));

// 느리게 보내는 요청이 연결을 오래 붙잡지 못하게 한다.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(port, host, () => {
  console.log(`[server] http://${host}:${port} 에서 대기 중`);
  console.log(`[server] 저장: ${dataFile ? dataFile : '메모리(DATA_FILE 미설정)'} / 기록 ${store.count('distance')} + ${store.count('airtime')}건 / 물리 ${CORE_VERSION}판`);
  const m = fileStore?.migrated;
  if (m) console.log(`[server] 랭킹 파일이 물리 ${m.from ?? '?'}판의 것이라 ${m.to}판으로 다시 계산했습니다: ${m.kept}건 유지, ${m.dropped}건 삭제 (옛 파일은 ${dataFile}.physics-${m.from ?? 'none'} 에 보관)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
