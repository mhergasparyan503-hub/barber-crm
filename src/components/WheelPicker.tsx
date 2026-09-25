import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';

export const WHEEL_ITEM_H = 40;

export type WheelOption = { value: number; label: string };

/**
 * Touch-friendly scroll drum / wheel. Snap to items; call onChange when settled.
 * `loop`: circular wheel (…22, 23, 00, 01…). The options are rendered as many
 * repeated cycles; after the wheel settles it silently jumps back to the same
 * value in the middle cycle, so it never hits an end.
 */
export function WheelPicker({
  options,
  value,
  onChange,
  className,
  loop = false,
  'aria-label': ariaLabel,
}: {
  options: WheelOption[];
  value: number;
  onChange: (value: number) => void;
  className?: string;
  loop?: boolean;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ignoreScroll = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const n = options.length;
  // Enough cycles that a hard fling can't reach either end (≥ ~100 items per side).
  const cycles = loop && n > 1 ? Math.max(7, 2 * Math.ceil(100 / n) + 1) : 1;
  const mid = Math.floor(cycles / 2);
  const total = n * cycles;

  const idxFor = useMemo(() => {
    const map = new Map<number, number>();
    options.forEach((o, i) => map.set(o.value, i));
    return map;
  }, [options]);

  /** Rendered index of `value` closest to the current scroll position. */
  function targetIndexFor(v: number, el: HTMLDivElement): number | null {
    const base = idxFor.get(v);
    if (base == null) return null;
    if (cycles === 1) return base;
    const cur = Math.round(el.scrollTop / WHEEL_ITEM_H);
    const curCycle = el.scrollTop > 0 ? Math.floor(cur / n) : mid;
    let best = mid * n + base;
    for (const c of [curCycle - 1, curCycle, curCycle + 1]) {
      if (c < 0 || c >= cycles) continue;
      const i = c * n + base;
      if (el.scrollTop > 0 && Math.abs(i - cur) < Math.abs(best - cur)) best = i;
    }
    return best;
  }

  function jumpTo(top: number) {
    const el = ref.current;
    if (!el) return;
    ignoreScroll.current = true;
    el.scrollTop = top;
    requestAnimationFrame(() => {
      ignoreScroll.current = false;
    });
  }

  /** Loop mode: move silently to the same value in the middle cycle. */
  function recenter() {
    const el = ref.current;
    if (!el || cycles === 1) return;
    const idx = Math.round(el.scrollTop / WHEEL_ITEM_H);
    if (Math.abs(el.scrollTop - idx * WHEEL_ITEM_H) > 1) return; // still moving
    const cycle = Math.floor(idx / n);
    if (cycle === mid) return;
    jumpTo((mid * n + (idx % n)) * WHEEL_ITEM_H);
  }

  // Sync scroll position when value changes from outside (and on mount)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = targetIndexFor(value, el);
    if (idx == null) return;
    const target = idx * WHEEL_ITEM_H;
    if (Math.abs(el.scrollTop - target) < 2) return;
    jumpTo(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, idxFor, cycles]);

  function settle() {
    const el = ref.current;
    if (!el || !n) return;
    const idx = Math.max(0, Math.min(total - 1, Math.round(el.scrollTop / WHEEL_ITEM_H)));
    const opt = options[idx % n];
    const target = idx * WHEEL_ITEM_H;
    ignoreScroll.current = true;
    const moving = Math.abs(el.scrollTop - target) > 1;
    if (moving) el.scrollTo({ top: target, behavior: 'smooth' });
    if (opt && opt.value !== valueRef.current) {
      onChangeRef.current(opt.value);
    }
    window.setTimeout(() => {
      ignoreScroll.current = false;
      recenter();
    }, moving ? 220 : 60);
  }

  function onScroll() {
    if (ignoreScroll.current) return;
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(settle, 90);
  }

  useEffect(() => {
    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  }, []);

  const items = [];
  for (let i = 0; i < total; i++) {
    const o = options[i % n];
    const active = o.value === value;
    items.push(
      <div
        key={i}
        role="option"
        aria-selected={active && Math.floor(i / n) === mid}
        className={cn(
          'flex snap-center items-center justify-center text-base tabular-nums transition-colors',
          active ? 'font-semibold text-gray-900' : 'font-normal text-gray-400',
        )}
        style={{ height: WHEEL_ITEM_H, cursor: 'pointer' }}
        onClick={() => {
          const el = ref.current;
          if (el) el.scrollTo({ top: i * WHEEL_ITEM_H, behavior: 'smooth' });
          if (o.value !== valueRef.current) onChangeRef.current(o.value);
        }}
      >
        {o.label}
      </div>,
    );
  }

  return (
    <div className={cn('relative select-none', className)}>
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-10 -translate-y-1/2 rounded-lg border-y border-accent/25 bg-accent/5"
        aria-hidden
      />
      <div
        ref={ref}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={onScroll}
        onTouchEnd={() => {
          // Momentum scroll may continue after the finger lifts — settle once it stops.
          if (settleTimer.current) window.clearTimeout(settleTimer.current);
          settleTimer.current = window.setTimeout(settle, 250);
        }}
        className="no-scrollbar h-[120px] overflow-y-auto overscroll-contain snap-y snap-mandatory"
        style={{
          paddingTop: WHEEL_ITEM_H,
          paddingBottom: WHEEL_ITEM_H,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {items}
      </div>
    </div>
  );
}

export function buildRangeOptions(min: number, max: number, step: number, suffix = ''): WheelOption[] {
  const out: WheelOption[] = [];
  for (let v = min; v <= max; v += step) {
    out.push({ value: v, label: suffix ? `${v}${suffix}` : String(v).padStart(2, '0') });
  }
  return out;
}
