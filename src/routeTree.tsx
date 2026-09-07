import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { AppShell } from './components/app-shell';
import { JournalPage } from './routes/index';
import { CalendarPage } from './routes/calendar';
import { SchedulePage } from './routes/schedule';
import { ClientsPage } from './routes/clients';
import { ClientCardPage } from './routes/client-card';
import { ServicesPage } from './routes/services';
import { SettingsPage } from './routes/settings';
import { BookPage } from './routes/book';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'admin',
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  component: JournalPage,
});
const calendarRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/calendar',
  component: CalendarPage,
});
const scheduleRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/schedule',
  component: SchedulePage,
});
const clientsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/clients',
  component: ClientsPage,
});
const clientCardRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/clients/$clientId',
  component: ClientCardPage,
});
const servicesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/services',
  component: ServicesPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/settings',
  component: SettingsPage,
});
const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/book',
  component: BookPage,
});

export const routeTree = rootRoute.addChildren([
  adminRoute.addChildren([
    indexRoute,
    calendarRoute,
    scheduleRoute,
    clientsRoute,
    clientCardRoute,
    servicesRoute,
    settingsRoute,
  ]),
  bookRoute,
]);
