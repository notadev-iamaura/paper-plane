/**
 * e2e 검사용 도우미: 내 비행기 코드를 받아 core 로 직접 계산한 값을 JSON 으로 찍는다.
 * 화면(연구 노트, 결과)에 보이는 숫자가 core 값과 같은지 견주는 데 쓴다.
 * 실행: npx tsx scripts/e2e-core.ts <코드>
 */
import { analyze, buildGeometry, decodeDesign, simulate } from '../src/core/index';

const code = process.argv[2] ?? '';
const dec = decodeDesign(code);
if (!dec) {
  console.log(JSON.stringify({ ok: false }));
} else {
  const g = buildGeometry(dec.design);
  const s = analyze(g);
  const r = dec.throwIn ? simulate(g, dec.throwIn) : null;
  const f = (v: number | null, d: number): string => {
    if (v === null || !Number.isFinite(v)) return '–';
    const t = v.toFixed(d);
    return Number(t) === 0 ? (0).toFixed(d) : t;
  };
  console.log(JSON.stringify({
    ok: true,
    folds: dec.design.folds.length,
    paperId: dec.design.paperId,
    throwIn: dec.throwIn ?? null,
    mass: f(g.massKg * 1000, 2),
    wingArea: f(g.stats.wingAreaM2 * 1e4, 1),
    span: f(g.stats.spanM * 100, 1),
    length: f(g.stats.lengthM * 100, 1),
    aspect: f(g.stats.aspectRatio, 2),
    trimSpeed: f(s.trimSpeedMps, 1),
    trimAlpha: f(s.trimAlphaDeg, 1),
    glideRatio: f(s.glideRatio, 1),
    maxLD: f(s.maxLD, 1),
    staticMargin: f(s.staticMargin * 100, 1),
    pitch: s.pitchStability,
    distance: r ? f(r.distanceM, 2) : null,
    airtime: r ? f(r.airtimeS, 2) : null,
    height: r ? f(r.maxHeightM, 2) : null,
    verdict: r ? r.verdict : null,
    diagnosis: r ? r.diagnosisKo : null,
  }));
}
