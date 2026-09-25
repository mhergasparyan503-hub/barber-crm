import { useRef } from 'react';

/**
 * Long-press (≈500 ms) on touch + right-click on desktop, while a normal tap still works.
 * Usage: const lp = useLongPress(); <button {...lp(() => openMenu(key), () => tap(key))} />
 */
export function useLongPress(ms = 500) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const touching = useRef(false);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return (onLong: () => void, onTap?: () => void) => ({
    onTouchStart: (e: React.TouchEvent) => {
      fired.current = false;
      touching.current = true;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        try {
          navigator.vibrate?.(15);
        } catch {
          /* */
        }
        onLong();
      }, ms);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10) clear();
    },
    onTouchEnd: (e: React.TouchEvent) => {
      clear();
      touching.current = false;
      // Long-press already handled: swallow the synthetic click.
      if (fired.current) e.preventDefault();
    },
    onTouchCancel: () => {
      clear();
      touching.current = false;
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (touching.current) {
        // Android fires contextmenu during a long-press — handle it once, suppress the click.
        if (fired.current) return;
        fired.current = true;
        clear();
      }
      onLong(); // desktop right-click
    },
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap?.();
    },
    style: {
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
    } as React.CSSProperties,
  });
}
