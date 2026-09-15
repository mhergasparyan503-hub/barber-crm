import { createContext, useContext, useState, type ReactNode } from 'react';
import { BookingSheet, type BookingMode } from './BookingSheet';

const Ctx = createContext<{
  open: (m: BookingMode) => void;
}>({ open: () => {} });

export function BookingProvider({ children }: { children: ReactNode }) {
  const [booking, setBooking] = useState<BookingMode>(null);
  return (
    <Ctx.Provider value={{ open: setBooking }}>
      {children}
      <BookingSheet mode={booking} onClose={() => setBooking(null)} />
    </Ctx.Provider>
  );
}

export function useBooking() {
  return useContext(Ctx);
}
