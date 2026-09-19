import { useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Journal } from '@/components/Journal';
import { useBooking } from '@/components/BookingContext';
import { mskDateKey, mskDayNoon } from '@/lib/msk';

export function JournalPage() {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const nav = useNavigate();
  const { open } = useBooking();
  const dayParam = useMemo(() => {
    const q = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);
    return q.get('day') || undefined;
  }, [searchStr]);

  const day = useMemo(() => {
    if (dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
      // Noon MSK — never UTC-midnight parse (that shifts the calendar day in MSK).
      return mskDayNoon(dayParam);
    }
    return mskDayNoon(mskDateKey(new Date()));
  }, [dayParam]);

  return (
    <Journal
      day={day}
      onDayChange={(d) => {
        // Moscow calendar date — never Date#toISOString().slice (UTC off-by-one in MSK).
        nav({ to: '/', search: { day: mskDateKey(d) } });
      }}
      onBooking={open}
    />
  );
}
