import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/cn';

export const WHEEL_ITEM_H = 40;

export type WheelOption = { value: number; label: string };

/**
 * Touch-friendly scroll drum / wheel. Snap to items; call onChange when settled.
 */
export function WheelPicker({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  options: WheelOption[];
  value: number;
  onChange: (value: number) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ignoreScroll = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const idxFor = useMemo(() => {
    const map = new Map<number, number>();
    options.forEach((o, i) => map.set(o.value, i));
    return map;
  }, [options]);

  // Sync scroll position when value changes from outside
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = idxFor.get(value);
    if (idx == null) return;
    const target = idx * WHEEL_ITEM_H;
    if (Math.abs(el.scrollTop - target) < 2) return;
    ignoreScroll.current = true;
    el.scrollTop = target;
    requestAnimationFrame(() => {
      ignoreScroll.current = false;
    });
  }, [value, idxFor]);

  function settle() {
    const el = ref.current;
    if (!el || !options.length) return;
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / WHEEL_ITEM_H)));
    const opt = options[idx];
    const target = idx * WHEEL_ITEM_H;
    ignoreScroll.current = true;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTo({ top: target, behavior: 'smooth' });
    }
    if (opt && opt.value !== valueRef.current) {
      onChangeRef.current(opt.value);
    }
    window.setTimeout(() => {
      ignoreScroll.current = false;
    }, 120);
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
        {options.map((o) => {
          const active = o.value === value;
          return (
            <div
              key={o.value}
              role="option"
              aria-selected={active}
              className={cn(
                'flex snap-center items-center justify-center text-base tabular-nums transition-colors',
                active ? 'font-semibold text-gray-900' : 'font-normal text-gray-400',
              )}
              style={{ height: WHEEL_ITEM_H, cursor: 'pointer' }}
              onClick={() => {
                const el = ref.current;
                const idx = options.findIndex((x) => x.value === o.value);
                if (el && idx >= 0) el.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: 'smooth' });
                if (o.value !== valueRef.current) onChangeRef.current(o.value);
              }}
            >
              {o.label}
            </div>
          );
        })}
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
