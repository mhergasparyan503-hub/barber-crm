import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router';
import { Toaster, toast } from 'sonner';
import { PhoneShell } from '@/components/PhoneShell';
import { PinGate } from '@/components/PinGate';
import { isSessionOpen, hasLock } from '@/lib/auth';
import { authStatus, UNAUTHORIZED_EVENT, type AuthStatus } from '@/lib/server-auth';
import { AuthScreen } from '@/components/AuthScreen';
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

// Auto-update: when the app comes back to the screen (tab restored from memory),
// check whether a newer build is deployed and reload once to pick it up.
function currentBundle(): string {
  const el = document.querySelector('script[type="module"][src*="/assets/"]') as HTMLScriptElement | null;
  return el ? new URL(el.src, location.href).pathname : '';
}
let updateChecking = false;
async function checkForUpdate() {
  if (updateChecking || location.pathname.startsWith('/book')) return;
  updateChecking = true;
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    const mine = currentBundle();
    if (m && mine && m[1] !== mine) location.reload();
  } catch {
    /* offline — ignore */
  } finally {
    updateChecking = false;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkForUpdate();
});
window.addEventListener('pageshow', (e) => {
  if ((e as PageTransitionEvent).persisted) void checkForUpdate();
});

function AuthGate({ children }: { children: React.ReactNode }) {
  // server session (email + password); PIN only as offline fallback
  const [server, setServer] = useState<AuthStatus | 'loading' | 'offline'>('loading');
  const [authed, setAuthed] = useState(false);

  const refresh = async () => {
    const st = await authStatus();
    setServer(st ?? 'offline');
  };

  useEffect(() => {
    setAuthed(isSessionOpen());
    void refresh();
    // Any 401 from sync → show login again (local data is kept).
    const onUnauth = () => {
      toast.error('Сессия истекла, войдите снова', { id: 'sess-expired' });
      void refresh();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauth);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauth);
  }, []);

  if (server === 'loading') {
    return (
      <div className="phone-shell flex items-center justify-center text-gray-400 text-sm">
        Загрузка…
      </div>
    );
  }

  // Offline: allow local data behind the PIN; sync resumes (or asks to log in) when online.
  if (server !== 'offline' && !server.authed) {
    return (
      <AuthScreen
        hasAccount={server.hasAccount}
        masterTelegram={server.masterTelegram}
        onDone={() => {
          setServer('loading');
          void refresh();
        }}
      />
    );
  }

  // Server session (cookie, 90 days) is the login. The old local PIN is only
  // asked when the server is unreachable and a PIN was set up earlier.
  if (server === 'offline' && hasLock() && !authed) {
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
