/**
 * 게시 플랫폼의 window.claude.use("db" | "user") 를 흉내 내는 페이지 안 스크립트(검사 전용).
 * scripts/e2e-ranking.mjs 가 페이지의 스크립트보다 먼저 넣는다(evaluateOnNewDocument).
 * 플랫폼 문서에 적힌 겉모습만 흉내 낸다:
 *   - use(name) 은 한참 뒤에(설정한 만큼) 능력 묶음이나 null 을 준다. 모르는 이름은 null.
 *   - db.doc(짝수 마디 경로): get / set(전체 바꾸기) / update(합치기, 있어야 함) / delete / onSnapshot
 *   - db.collection(홀수 마디 경로): where / orderBy(하나만) / limit(1~1000) / get / onSnapshot
 *   - 문서는 평범한 JSON 객체(256 KiB 까지). 경로 마디는 영문자, 숫자, _ - . ~ : @ +
 *   - 규칙: { path: "scores", read: "view", write: "owner" }, { path: "scores/{self}", write: "interact" }
 *       -> 들어온 사람은 모두 읽는다. 주인은 어디든 쓴다. 기여자 이상은 scores/<자기 id> 에만 쓴다.
 *          구경만 하는 사람과 바깥 손님은 못 쓴다. 거절은 { code: "invalid_argument" }.
 *   - 읽기는 권한 문제를 알리지 않는다(없는 문서처럼 보인다).
 *   - 오류는 { code, message }.
 *
 * 설정: window.__mockClaudeConfig = {
 *   absent: true                         window.claude 를 아예 만들지 않는다
 *   resolveDelayMs: 300                  use() 가 답하기까지
 *   db: false / user: false              그 능력은 null
 *   uid: 'player-me' | null              user.id()
 *   level: 'owner' | 'contributor' | 'viewer' | 'outside'
 *   can: true | false | null             user.can('data.write') 의 답(주지 않으면 주인만 true, 구경꾼은 false, 나머지는 null)
 *   seed: { id: 문서 }                    처음 한 번 깔아 두는 문서(규칙을 거치지 않는다)
 *   failSet: ['unavailable']             다음 set/delete 들이 차례로 이 code 로 실패한다
 *   stallSnapshots: true                 onSnapshot 이 아무 소식도 주지 않는다(10초 멈춤 검사)
 *   snapshotError: 'unavailable'         첫 onSnapshot 은 이 code 로 실패한다(그다음은 정상)
 *   snapshotDelayMs: 150
 *   persist: true                        문서를 localStorage 에 두어 새로 고침해도 남게 한다
 * }
 * 검사 손잡이: window.__mockClaude = { remoteSet(id, doc), remoteDelete(id), dump(), calls, writes, config }
 */
(() => {
  const cfg = Object.assign({ resolveDelayMs: 200, uid: 'player-me', level: 'contributor', snapshotDelayMs: 120, persist: true }, window.__mockClaudeConfig || {});
  const KEY = '__mockClaudeDb';
  const SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
  const MAX_BYTES = 256 * 1024;
  const calls = { use: 0, get: 0, set: 0, update: 0, delete: 0, subscribe: 0, unsubscribe: 0, rejected: 0 };
  const writes = [];
  const err = (code, message) => ({ code, message: message || code });
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const later = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 경로 -> 문서. 예: "scores/player-01" */
  let docs = new Map();
  try {
    const raw = cfg.persist ? window.localStorage.getItem(KEY) : null;
    if (raw) docs = new Map(JSON.parse(raw));
    else for (const [id, d] of Object.entries(cfg.seed || {})) docs.set(`scores/${id}`, clone(d));
  } catch { /* 저장소가 막혀 있으면 메모리만 쓴다 */ }
  const save = () => { try { if (cfg.persist) window.localStorage.setItem(KEY, JSON.stringify([...docs])); } catch { /* 무시 */ } };
  save();

  const listeners = new Set();
  const notify = () => { for (const l of [...listeners]) l(); };

  const segs = (path) => {
    if (typeof path !== 'string') throw err('invalid_argument', 'path must be a string');
    const parts = path.split('/');
    if (parts.length === 0 || parts.some((p) => !SEG.test(p))) throw err('invalid_argument', `bad path: ${path}`);
    return parts;
  };
  const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

  /** 규칙: 주인은 scores 아래 어디든, 기여자 이상은 scores/<자기 id> 에만 */
  const mayWrite = (parts) => {
    if (parts[0] !== 'scores' || parts.length !== 2) return false;
    if (cfg.level === 'owner') return true;
    return cfg.level === 'contributor' && typeof cfg.uid === 'string' && parts[1] === cfg.uid;
  };
  const failNext = () => {
    const list = cfg.failSet;
    return Array.isArray(list) && list.length > 0 ? list.shift() : null;
  };

  const docSnap = (path) => {
    const id = path.split('/').pop();
    const has = docs.has(path);
    const value = has ? clone(docs.get(path)) : undefined;
    return { id, exists: has, data: () => (has ? clone(value) : undefined), metadata: { fromCache: false } };
  };

  function docRef(path) {
    const parts = segs(path);
    if (parts.length % 2 !== 0) throw err('invalid_argument', 'document path needs an even number of segments');
    const write = async (kind, value) => {
      await later(40);
      const fail = failNext();
      if (fail) throw err(fail);
      if (!mayWrite(parts)) { calls.rejected++; throw err('invalid_argument', 'write rejected by rules'); }
      if (kind !== 'delete') {
        if (!isPlain(value)) throw err('invalid_argument', 'document must be a plain object');
        let json;
        try { json = JSON.stringify(value); } catch { throw err('invalid_argument', 'document must be JSON'); }
        if (json.length > MAX_BYTES) throw err('invalid_argument', 'document too large');
        if (kind === 'update') {
          if (!docs.has(path)) throw err('invalid_argument', 'update needs an existing document');
          docs.set(path, Object.assign(clone(docs.get(path)), JSON.parse(json)));
        } else docs.set(path, JSON.parse(json));
      } else docs.delete(path);
      writes.push({ kind, path, value: kind === 'delete' ? null : clone(docs.get(path)) });
      save();
      setTimeout(notify, cfg.snapshotDelayMs);
    };
    return {
      id: parts[parts.length - 1],
      path,
      get: async () => { calls.get++; await later(40); return docSnap(path); },
      set: (value) => { calls.set++; return write('set', value); },
      update: (value) => { calls.update++; return write('update', value); },
      delete: () => { calls.delete++; return write('delete'); },
      onSnapshot: (next) => {
        calls.subscribe++;
        const fire = () => next(docSnap(path));
        listeners.add(fire);
        setTimeout(fire, cfg.snapshotDelayMs);
        return () => { calls.unsubscribe++; listeners.delete(fire); };
      },
    };
  }

  const OPS = {
    '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
  };
  let firstSnapshotError = cfg.snapshotError || null;

  function query(path, q) {
    const parts = segs(path);
    if (parts.length % 2 !== 1) throw err('invalid_argument', 'collection path needs an odd number of segments');
    const run = () => {
      let list = [...docs.keys()].filter((p) => p.startsWith(`${path}/`) && p.split('/').length === parts.length + 1).sort().map(docSnap);
      for (const [field, op, value] of q.where) list = list.filter((d) => OPS[op](d.data()?.[field], value));
      if (q.orderBy) {
        const [field, dir] = q.orderBy;
        list.sort((a, b) => { const x = a.data()?.[field], y = b.data()?.[field]; return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
      }
      if (q.limit) list = list.slice(0, q.limit);
      return { docs: list, size: list.length, empty: list.length === 0 };
    };
    return {
      where: (field, op, value) => {
        if (!OPS[op]) throw err('invalid_argument', `unknown operator ${op}`);
        return query(path, { ...q, where: [...q.where, [field, op, value]] });
      },
      orderBy: (field, dir) => {
        if (q.orderBy) throw err('invalid_argument', 'only one orderBy');
        return query(path, { ...q, orderBy: [field, dir || 'asc'] });
      },
      limit: (n) => {
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw err('invalid_argument', 'limit must be 1..1000');
        return query(path, { ...q, limit: n });
      },
      get: async () => { calls.get++; await later(40); return run(); },
      onSnapshot: (next, error) => {
        calls.subscribe++;
        if (cfg.stallSnapshots) return () => { calls.unsubscribe++; };
        if (firstSnapshotError) {
          const code = firstSnapshotError;
          firstSnapshotError = null;
          setTimeout(() => { if (error) error(err(code)); }, cfg.snapshotDelayMs);
          return () => { calls.unsubscribe++; };
        }
        const fire = () => next(run());
        listeners.add(fire);
        setTimeout(() => { if (listeners.has(fire)) fire(); }, cfg.snapshotDelayMs);
        return () => { calls.unsubscribe++; listeners.delete(fire); };
      },
    };
  }

  const db = { doc: docRef, collection: (path) => query(path, { where: [], orderBy: null, limit: 0 }) };
  const user = {
    id: async () => { await later(20); return typeof cfg.uid === 'string' ? cfg.uid : null; },
    isOwner: async () => cfg.level === 'owner',
    can: async (what) => {
      if (what !== 'data.write') return null;
      if (cfg.can !== undefined) return cfg.can;
      // 뿌리 규칙(scores 는 주인만 쓴다) 기준의 답. 기여자에게는 알려 주지 않는 것으로 둔다.
      return cfg.level === 'owner' ? true : cfg.level === 'viewer' || cfg.level === 'outside' ? false : null;
    },
  };

  window.__mockClaude = {
    config: cfg, calls, writes,
    dump: () => Object.fromEntries([...docs].map(([p, d]) => [p.split('/').pop(), clone(d)])),
    /** 다른 선수가 올린 것처럼 문서를 바꾼다(규칙을 거치지 않는다). 지켜보는 쪽에 곧 소식이 간다. */
    remoteSet: (id, doc) => { docs.set(`scores/${id}`, clone(doc)); save(); setTimeout(notify, cfg.snapshotDelayMs); },
    remoteDelete: (id) => { docs.delete(`scores/${id}`); save(); setTimeout(notify, cfg.snapshotDelayMs); },
  };
  if (cfg.absent) return;

  window.claude = {
    use: (name) => {
      calls.use++;
      return later(cfg.resolveDelayMs).then(() => {
        if (name === 'db') return cfg.db === false ? null : db;
        if (name === 'user') return cfg.user === false ? null : user;
        return null;
      });
    },
  };
})();
