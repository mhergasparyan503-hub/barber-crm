import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { CalendarDays, ClipboardList, Settings, Scissors, Users, BookOpen, Link2 } from 'lucide-react';
import { useEffect } from 'react';
import { useCrm } from '@/lib/store';
import { loadSnapshot, scheduleFlush } from '@/lib/crm-snapshot';
import { TelegramBridge } from './telegram-bridge';
import { copyText } from '@/lib/copy';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';

const nav = [
  { to: '/', label: 'Журнал', icon: BookOpen },
  { to: '/calendar', label: 'Неделя', icon: CalendarDays },
  { to: '/schedule', label: 'График', icon: ClipboardList },
  { to: '/clients', label: 'Клиенты', icon: Users },
  { to: '/services', label: 'Услуги', icon: Scissors },
];

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const hydrateMerge = useCrm((s) => s.hydrateMerge);
  const getSnapshot = useCrm((s) => s.getSnapshot);
  const settings = useCrm((s) => s.settings);

  useEffect(() => {
    void (async () => {
      const remote = await loadSnapshot();
      if (remote) hydrateMerge(remote);
    })();
  }, [hydrateMerge]);

  useEffect(() => {
    const unsub = useCrm.subscribe(() => {
      scheduleFlush(() => useCrm.getState().getSnapshot());
    });
    return () => unsub();
  }, []);

  const bookUrl = typeof window !== 'undefined' ? `${window.location.origin}/book` : '/book';
  const botUrl = settings.telegramBotUsername
    ? `https://t.me/${settings.telegramBotUsername}`
    : '';

  return (
    <div className="flex h-full min-h-screen bg-[#f0f2f5] text-slate-900">
      <aside className="hidden w-56 shrink-0 flex-col bg-[#2b2d33] text-white md:flex">
        <div className="px-4 py-5 text-lg font-semibold tracking-tight">
          {settings.studioName || 'Барбершоп'}
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  'touch-btn flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                  active ? 'bg-[#ff7900] text-white' : 'text-white/80 hover:bg-white/10',
                )}
              >
                <Icon size={18} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Link
          to="/settings"
          className="m-2 touch-btn flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          <Settings size={18} />
          Настройки
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-black/5 bg-white px-3 py-2">
          <div className="flex flex-1 flex-wrap gap-1 md:hidden">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  'touch-btn rounded-md px-2 py-1 text-xs font-medium',
                  (n.to === '/' ? path === '/' : path.startsWith(n.to))
                    ? 'bg-[#ff7900] text-white'
                    : 'bg-slate-100',
                )}
              >
                {n.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="touch-btn inline-flex items-center gap-1 rounded-md border px-3 text-sm"
              onClick={async () => {
                const ok = await copyText(bookUrl);
                toast[ok ? 'success' : 'error'](ok ? 'Ссылка записи скопирована' : 'Не удалось скопировать');
              }}
            >
              <Link2 size={16} /> Онлайн-запись
            </button>
            {botUrl && (
              <a
                href={botUrl}
                target="_blank"
                rel="noreferrer"
                className="touch-btn inline-flex items-center rounded-md border px-3 text-sm"
              >
                Бот
              </a>
            )}
            <Link
              to="/"
              search={{ book: '1' } as any}
              className="touch-btn rounded-md bg-[#ff7900] px-3 text-sm font-semibold text-white"
            >
              Записать
            </Link>
            <Link to="/settings" className="touch-btn rounded-md border px-3 text-sm md:hidden">
              ⚙
            </Link>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <TelegramBridge />
    </div>
  );
}
