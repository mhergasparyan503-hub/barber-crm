import { Outlet, useRouterState } from '@tanstack/react-router';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';
import { BookingProvider, useBooking } from './BookingContext';

function ShellInner() {
  const { open } = useBooking();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMore = pathname === '/more';

  return (
    <>
      <AppHeader />
      <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden bg-journal">
        <Outlet />
      </div>
      <BottomNav onPlus={() => open({ kind: 'new', start: new Date() })} />
    </>
  );
}

export function PhoneShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isBook = pathname.startsWith('/book');

  if (isBook) {
    return (
      <div className="phone-shell">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="phone-shell">
      <BookingProvider>
        <ShellInner />
      </BookingProvider>
    </div>
  );
}
