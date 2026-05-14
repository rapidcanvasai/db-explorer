import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  axis: 'x' | 'y';
  initial: number;
  min: number;
  max: number;
  storageKey?: string;
  /** For axis 'y' the size grows when the cursor moves UP (drag handle is between content and bottom panel). */
  invert?: boolean;
}

export function useDragResize({ axis, initial, min, max, storageKey, invert }: Options) {
  const [size, setSize] = useState<number>(() => {
    if (!storageKey) return initial;
    const saved = localStorage.getItem(storageKey);
    if (!saved) return initial;
    const n = Number(saved);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : initial;
  });

  const isResizing = useRef(false);
  const start = useRef(0);
  const startSize = useRef(size);
  const latest = useRef(size);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const cur = axis === 'x' ? e.clientX : e.clientY;
      const delta = cur - start.current;
      const next = Math.min(max, Math.max(min, startSize.current + (invert ? -delta : delta)));
      setSize(next);
      latest.current = next;
    };
    const onUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (storageKey) localStorage.setItem(storageKey, String(latest.current));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [axis, min, max, invert, storageKey]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    start.current = axis === 'x' ? e.clientX : e.clientY;
    startSize.current = size;
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [axis, size]);

  return { size, onMouseDown };
}
