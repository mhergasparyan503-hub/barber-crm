import { Link } from '@tanstack/react-router';
import { CalendarClock, Scissors, Settings, Link2, LogOut } from 'lucide-react';
import { logout } from '@/lib/auth';
import { toast } from 'sonner';

const links = [
  { to: '/schedule', label: 'График', icon: CalendarClock },
  { to: '/services', label: 'Услуги', icon: Scissors },
  { to: '/settings', label: 'Настройки', icon: Settings },
] as const;

export function MorePage() {
  function copyBook() {
    const url = `${window.location.origin}/book`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success('Ссылка скопирована'),
      () => toast.message(url),
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-journal p-4 space-y-2">
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <Link
            key={l.to}
            to={l.to}
            className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-gray-100"
          >
            <Icon className="h-5 w-5 text-accent" />
            <span className="font-medium">{l.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={copyBook}
        className="w-full flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-gray-100"
      >
        <Link2 className="h-5 w-5 text-accent" />
        <span className="font-medium">Ссылка онлайн-записи</span>
      </button>
      <button
        type="button"
        onClick={() => {
          logout();
          window.location.href = '/';
        }}
        className="w-full flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-gray-100 text-red-600"
      >
        <LogOut className="h-5 w-5" />
        <span className="font-medium">Выйти (PIN)</span>
      </button>
    </div>
  );
}
