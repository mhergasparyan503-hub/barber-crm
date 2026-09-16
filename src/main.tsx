import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { PhoneShell } from '@/components/PhoneShell';
import { PinGate } from '@/components/PinGate';
import { isSessionOpen } from '@/lib/auth';
import { JournalPage } from '@/routes/index';
import { CalendarPage } from '@/routes/calendar';
import { ClientsPage } from '@/routes/clients';
import { ClientDetailPage } from '@/routes/client-detail';
import { SchedulePage } from '@/routes/schedule';
import { ServicesPage } from '@/routes/services';
import { SettingsPage } from '@/routes/settings';
import { BookPage } from '@/routes/book';
import { MorePage } from '@/routes/more';
import { TelegramBridge } from '@/components/TelegramBridge';
import '@/styles/app.css';

function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(isSessionOpen());
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="phone-shell flex items-center justify-center text-gray-400 text-sm">
        Загрузка…
      </div>
    );
  }

  if (!authed) {
    return <PinGate onUnlock={() => setAuthed(true)} />;
  }

  return <>{children}</>;
}

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster position="top-center" richColors />
    </>
  ),
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: () => (
    <AuthGate>
      <PhoneShell />
      <TelegramBridge />
    </AuthGate>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  validateSearch: (s: Record<string, unknown>): { day?: string } => ({
    day: typeof s.day === 'string' ? s.day : undefined,
  }),
  component: JournalPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar',
  component: CalendarPage,
});

const clientsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clients',
  component: ClientsPage,
});

const clientDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/clients/$id',
  component: ClientDetailPage,
});

const scheduleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/schedule',
  component: SchedulePage,
});

const servicesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/services',
  component: ServicesPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});

const moreRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/more',
  component: MorePage,
});

const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/book',
  component: () => (
    <div className="phone-shell">
      <BookPage />
    </div>
  ),
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    indexRoute,
    calendarRoute,
    clientsRoute,
    clientDetailRoute,
    scheduleRoute,
    servicesRoute,
    settingsRoute,
    moreRoute,
  ]),
  bookRoute,
]);

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
