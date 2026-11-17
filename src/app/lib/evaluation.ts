/**
 * 설계 -> 형상(무게, 무게중심 등) + 공기역학 분석.
 * buildGeometry 와 analyze 는 수십 ms 가 걸릴 수 있으므로
 * - 같은 설계(코드가 같음)는 한 번만 계산해 기억해 두고(memo),
 * - 슬라이더를 끄는 동안에는 70 ms 쉬었을 때만 계산한다(debounce).
 */
import { useEffect, useState } from 'react';
import { analyze, buildGeometry } from '../../core/index';
import type { AeroSummary, PlaneDesign, PlaneGeometry } from '../../core/index';
import { log } from './logger';

export interface Evaluated {
  /** 이 결과를 만든 설계의 코드(던지기 값 제외) */
  designCode: string;
  geometry: PlaneGeometry;
  summary: AeroSummary;
}

const CACHE_MAX = 40;
const cache = new Map<string, Evaluated>();

/** 코드를 열쇠로 기억해 둔 결과를 돌려주거나 새로 계산한다. */
export function evaluateDesign(design: PlaneDesign, designCode: string): Evaluated {
  const hit = cache.get(designCode);
  if (hit) return hit;
  const t0 = performance.now();
  const geometry = buildGeometry(design);
  const t1 = performance.now();
  const summary = analyze(geometry);
  const t2 = performance.now();
  log.debug('eval', '형상과 분석을 계산했어요', {
    geomMs: Math.round(t1 - t0), analyzeMs: Math.round(t2 - t1), folds: design.folds.length,
  });
  const out: Evaluated = { designCode, geometry, summary };
  cache.set(designCode, out);
  // 오래된 것부터 지운다(Map 은 넣은 순서를 기억한다).
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return out;
}

const DEBOUNCE_MS = 70;

/** 설계가 바뀌면 잠깐 기다렸다가 다시 계산한다. pending 은 "아직 예전 결과를 보여주는 중"이라는 뜻. */
export function useEvaluation(design: PlaneDesign, designCode: string): { ev: Evaluated; pending: boolean } {
  const [ev, setEv] = useState<Evaluated>(() => evaluateDesign(design, designCode));

  useEffect(() => {
    if (ev.designCode === designCode) return;
    const id = window.setTimeout(() => {
      try {
        setEv(evaluateDesign(design, designCode));
      } catch (err) {
        log.error('eval', '형상 계산 중 오류가 났어요', err);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [design, designCode, ev.designCode]);

  return { ev, pending: ev.designCode !== designCode };
}
