/**
 * 화면 표시용 덧붙임 값(mesh.sheetUv, faceSide, stackSide, stackOrder, flatXY, fold) 검사.
 * 이 값들은 "종이 무늬가 접힌 대로 따라가게" 그리는 데만 쓰이고 물리 계산에는 쓰이지 않는다.
 */
import { describe, expect, it } from 'vitest';
import type { PlaneDesign, PlaneGeometry } from '../src/core/types';
import { getPaper } from '../src/core/papers';
import { buildGeometry } from '../src/core/fold/geometry';
import { applyFolds, pointInConvex } from '../src/core/fold/fold';
import { PRESETS } from '../src/core/presets';
import { makeLcg, randomDesign } from './helpers';

const flatShaping = { keelM: 0, dihedralDeg: 0, wingletM: 0, wingletDeg: 0, elevatorDeg: 0 };

function designs(): { label: string; design: PlaneDesign }[] {
  const out: { label: string; design: PlaneDesign }[] = PRESETS.map((p) => ({ label: p.id, design: p.design }));
  const rnd = makeLcg(20261115);
  for (let i = 0; i < 60; i++) out.push({ label: `random-${i}`, design: randomDesign(rnd, 7) });
  out.push({ label: 'blank', design: { v: 1, paperId: 'copy80', folds: [], shaping: { ...flatShaping }, clip: null } });
  return out;
}

function triCount(g: PlaneGeometry): number {
  return g.mesh.layers.length;
}

/** UV 삼각형의 부호 있는 넓이(u 오른쪽, v 위 기준. 반시계면 +) */
function uvArea(uv: number[], t: number): number {
  const o = t * 6;
  const ax = uv[o]!, ay = uv[o + 1]!, bx = uv[o + 2]!, by = uv[o + 3]!, cx = uv[o + 4]!, cy = uv[o + 5]!;
  return ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}

describe('mesh 의 종이 무늬용 값', () => {
  it('모든 배열의 길이가 삼각형 수와 맞는다', () => {
    for (const { label, design } of designs()) {
      const m = buildGeometry(design).mesh;
      const n = m.layers.length;
      expect(m.positions.length, label).toBe(n * 9);
      expect(m.sheetUv?.length, label).toBe(n * 6);
      expect(m.flatXY?.length, label).toBe(n * 6);
      expect(m.faceSide?.length, label).toBe(n);
      expect(m.stackSide?.length, label).toBe(n);
      expect(m.stackOrder?.length, label).toBe(n);
      expect(m.stackCount, label).toBe(applyFolds(getPaper(design.paperId)!, design.folds).layers.length);
      expect(m.fold, label).toBeDefined();
    }
  });

  it('sheetUv 는 0..1 안에 있고 유한하다', () => {
    for (const { label, design } of designs()) {
      const uv = buildGeometry(design).mesh.sheetUv!;
      for (const v of uv) {
        expect(Number.isFinite(v), label).toBe(true);
        expect(v, label).toBeGreaterThanOrEqual(0);
        expect(v, label).toBeLessThanOrEqual(1);
      }
    }
  });

  it('UV 넓이의 합이 종이 한 장(1.0)이고, 삼각형마다 UV 넓이가 실제 넓이와 같다(늘어나지 않는다)', () => {
    for (const { label, design } of designs()) {
      const g = buildGeometry(design);
      const paper = getPaper(design.paperId)!;
      const sheetArea = paper.widthM * paper.heightM;
      const uv = g.mesh.sheetUv!;
      const p = g.mesh.positions;
      let sum = 0;
      for (let t = 0; t < triCount(g); t++) {
        const aUv = Math.abs(uvArea(uv, t));
        sum += aUv;
        const i = t * 9;
        const ux = p[i + 3]! - p[i]!, uy = p[i + 4]! - p[i + 1]!, uz = p[i + 5]! - p[i + 2]!;
        const vx = p[i + 6]! - p[i]!, vy = p[i + 7]! - p[i + 1]!, vz = p[i + 8]! - p[i + 2]!;
        const a3 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
        expect(aUv * sheetArea, `${label} tri ${t}`).toBeCloseTo(a3, 9);
      }
      expect(sum, label).toBeCloseTo(1, 6);
    }
  });

  it('UV 삼각형들은 종이를 겹치지 않고 빈틈없이 덮는다(임의의 점마다 정확히 하나)', () => {
    const rnd = makeLcg(77);
    for (const { label, design } of designs().slice(0, 25)) {
      const uv = buildGeometry(design).mesh.sheetUv!;
      const n = uv.length / 6;
      for (let k = 0; k < 40; k++) {
        const px = 0.02 + rnd() * 0.96, py = 0.02 + rnd() * 0.96;
        let hits = 0;
        let nearEdge = false;
        for (let t = 0; t < n; t++) {
          const o = t * 6;
          const x = [uv[o]!, uv[o + 2]!, uv[o + 4]!];
          const y = [uv[o + 1]!, uv[o + 3]!, uv[o + 5]!];
          let pos = 0, neg = 0;
          for (let e = 0; e < 3; e++) {
            const f = (e + 1) % 3;
            const len = Math.hypot(x[f]! - x[e]!, y[f]! - y[e]!) || 1;
            const c = ((x[f]! - x[e]!) * (py - y[e]!) - (y[f]! - y[e]!) * (px - x[e]!)) / len;
            if (c > 1e-7) pos++;
            else if (c < -1e-7) neg++;
            else nearEdge = true;
          }
          if (pos === 3 || neg === 3) hits++;
        }
        // 삼각형 변 위에 정확히 놓인 점은 세지 않는다.
        if (!nearEdge) expect(hits, `${label} (${px.toFixed(3)}, ${py.toFixed(3)})`).toBe(1);
      }
    }
  });

  it('앞/뒤 표시가 접기의 뒤집힘과 맞는다: 납작한 상태에서 위를 보는 면 = 뒤집히지 않은 겹의 앞면', () => {
    for (const { label, design } of designs()) {
      const flat: PlaneDesign = { ...design, shaping: { ...flatShaping } };
      const g = buildGeometry(flat);
      const m = g.mesh;
      const sheet = applyFolds(getPaper(flat.paperId)!, flat.folds);
      const byOrder = new Map(sheet.layers.map((l) => [l.order, l]));
      for (let t = 0; t < triCount(g); t++) {
        const layer = byOrder.get(m.stackOrder![t]!)!;
        expect(layer, label).toBeDefined();
        // 납작한 종이의 삼각형 무게중심은 그 겹의 다각형 안에 있다.
        const o = t * 6;
        const c = { x: (m.flatXY![o]! + m.flatXY![o + 2]! + m.flatXY![o + 4]!) / 3, y: (m.flatXY![o + 1]! + m.flatXY![o + 3]! + m.flatXY![o + 5]!) / 3 };
        expect(pointInConvex(layer.poly, c, 1e-7), `${label} tri ${t}`).toBe(true);
        // 납작한 상태에서는 감긴 방향의 법선이 +z(위)이고, 위가 겹 묶음의 위쪽이다.
        const i = t * 9;
        const p = m.positions;
        const nz = (p[i + 3]! - p[i]!) * (p[i + 7]! - p[i + 1]!) - (p[i + 4]! - p[i + 1]!) * (p[i + 6]! - p[i]!);
        expect(Math.sign(nz), `${label} tri ${t}`).toBe(m.stackSide![t]!);
        const frontUp = m.faceSide![t]! * m.stackSide![t]! > 0;
        expect(frontUp, `${label} tri ${t}`).toBe(!layer.flipped);
      }
    }
  });

  it('UV 가 감긴 방향 = 앞면이 위를 보는지와 같다(입체 마무리를 해도 유지된다)', () => {
    for (const { label, design } of designs()) {
      const m = buildGeometry(design).mesh;
      for (let t = 0; t < m.layers.length; t++) {
        const a = uvArea(m.sheetUv!, t);
        if (Math.abs(a) < 1e-12) continue;
        // flatXY 는 반시계로 감겨 있고 그 법선이 겹의 위쪽이다. 뒤집힌 겹은 UV 가 거꾸로 감긴다.
        const o = t * 6;
        const f = m.flatXY!;
        const flatA = (f[o + 2]! - f[o]!) * (f[o + 5]! - f[o + 1]!) - (f[o + 4]! - f[o]!) * (f[o + 3]! - f[o + 1]!);
        expect(flatA, label).toBeGreaterThan(0);
        expect(Math.sign(a), `${label} tri ${t}`).toBe(m.faceSide![t]! * m.stackSide![t]!);
      }
    }
  });

  it('빈 종이: UV 가 종이 좌표를 그대로 0..1 로 옮긴 값이다', () => {
    const g = buildGeometry({ v: 1, paperId: 'copy80', folds: [], shaping: { ...flatShaping }, clip: null });
    const m = g.mesh;
    for (let i = 0; i < m.flatXY!.length; i += 2) {
      expect(m.sheetUv![i]!).toBeCloseTo((m.flatXY![i]! + 0.105) / 0.21, 9);
      expect(m.sheetUv![i + 1]!).toBeCloseTo((m.flatXY![i + 1]! + 0.1485) / 0.297, 9);
    }
    for (const s of m.faceSide!) expect(s).toBe(1);
    expect(m.stackCount).toBe(1);
  });

  it('fold 치수와 flatXY 로 positions 를 다시 만들 수 있다(날개 구역)', () => {
    for (const p of PRESETS) {
      const m = buildGeometry(p.design).mesh;
      const f = m.fold!;
      const G = (f.dihedralDeg * Math.PI) / 180;
      let checked = 0;
      for (let t = 0; t < m.layers.length; t++) {
        const o = t * 6;
        const cx = (m.flatXY![o]! + m.flatXY![o + 2]! + m.flatXY![o + 4]!) / 3;
        const s = Math.abs(cx);
        const wingEnd = cx < 0 ? f.wingEndLeftM : f.wingEndRightM;
        if (!(s > f.keelM && s < wingEnd)) continue;
        const sg = cx < 0 ? 1 : -1;
        const h = (m.stackOrder![t]! - (m.stackCount! - 1) - 0.5) * f.thicknessM;
        for (let k = 0; k < 3; k++) {
          const px = m.flatXY![o + k * 2]!, py = m.flatXY![o + k * 2 + 1]!;
          const u = Math.abs(px) - f.keelM;
          expect(m.positions[t * 9 + k * 3]!).toBeCloseTo(py - f.noseY, 9);
          expect(m.positions[t * 9 + k * 3 + 1]!).toBeCloseTo(sg * (u * Math.cos(G) - h * Math.sin(G)), 9);
          expect(m.positions[t * 9 + k * 3 + 2]!).toBeCloseTo(u * Math.sin(G) + h * Math.cos(G), 9);
        }
        checked++;
      }
      expect(checked, p.id).toBeGreaterThan(0);
    }
  });
});
