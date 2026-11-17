import { useEffect, useState } from 'react';

/** 값이 delayMs 동안 바뀌지 않으면 그때 반영되는 "늦게 따라오는 값". 슬라이더처럼 빠르게 바뀌는 입력에 쓴다. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [late, setLate] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setLate(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return late;
}
