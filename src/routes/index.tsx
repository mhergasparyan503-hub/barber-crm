import { useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { parseISO, startOfDay } from 'date-fns';
import { Journal } from '@/components/Journal';
import { useBooking } from '@/components/BookingContext';

export function JournalPage() {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const nav = useNavigate();
  const { open } = useBooking();
  const dayParam = useMemo(() => {
    const q = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);
    return q.get('day') || undefined;
  }, [searchStr]);

  const day = useMemo(() => {
    if (dayParam) {
      try {
        return startOfDay(parseISO(dayParam));
      } catch {}
    }
    return startOfDay(new Date());
  }, [dayParam]);

  return (
    <Journal
      day={day}
      onDayChange={(d) => {
        nav({ to: '/', search: { day: d.toISOString().slice(0, 10) } });
      }}
      onBooking={open}
    />
  );
}
