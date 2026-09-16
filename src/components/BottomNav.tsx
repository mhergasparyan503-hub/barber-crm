import { Link, useRouterState } from '@tanstack/react-router';
import { BookOpen, CalendarDays, Users, MoreHorizontal, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

export function BottomNav({ onPlus }: { onPlus: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const linkCls = (active: boolean) =>
    cn(
      'flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium',
      active ? 'text-accent' : 'text-gray-400',
    );

  return (
    <nav className="safe-bottom border-t border-gray-200 bg-white shrink-0">
      <div className="grid grid-cols-5 h-14">
        <Link to="/" search={{ day: undefined }} className={linkCls(pathname === '/')}>
          <BookOpen className="h-5 w-5" />
          Журнал
        </Link>
        <Link to="/calendar" className={linkCls(pathname.startsWith('/calendar'))}>
          <CalendarDays className="h-5 w-5" />
          Календарь
        </Link>
        <button type="button" onClick={onPlus} className="flex items-center justify-center -mt-3" aria-label="Новая запись">
          <span className="h-12 w-12 rounded-full bg-accent text-white shadow-lg shadow-orange-200 flex items-center justify-center">
            <Plus className="h-6 w-6" strokeWidth={2.5} />
          </span>
        </button>
        <Link to="/clients" className={linkCls(pathname.startsWith('/clients'))}>
          <Users className="h-5 w-5" />
          Клиенты
        </Link>
        <Link
          to="/more"
          className={linkCls(
            pathname.startsWith('/more') ||
              pathname.startsWith('/schedule') ||
              pathname.startsWith('/services') ||
              pathname.startsWith('/settings'),
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          Ещё
        </Link>
      </div>
    </nav>
  );
}
