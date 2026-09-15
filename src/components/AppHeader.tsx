import { useState, useRef, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useCrm } from '@/lib/store';
import { logout } from '@/lib/auth';
import { toast } from 'sonner';

export function AppHeader({ title }: { title?: string }) {
  const settings = useCrm((s) => s.settings);
  const resetJournal = useCrm((s) => s.resetJournal);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function copyBook() {
    const url = `${window.location.origin}/book`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success('Ссылка скопирована'),
      () => toast.message(url),
    );
    setOpen(false);
  }

  function doReset() {
    if (!confirm('Очистить журнал? Визиты будут удалены, услуги сохранятся.')) return;
    resetJournal();
    toast.success('Журнал очищен');
    setOpen(false);
  }

  function doLogout() {
    logout();
    setOpen(false);
    window.location.href = '/';
  }

  return (
    <header className="safe-top shrink-0 bg-accent text-white">
      <div className="h-12 flex items-center px-3 gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{title || settings.studioName}</div>
          <div className="text-[10px] text-white/80 truncate">{settings.subtitle}</div>
        </div>
        <div className="relative" ref={ref}>
          <button
            type="button"
            className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-white/10"
            onClick={() => setOpen((v) => !v)}
            aria-label="Меню"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {open && (
            <div className="absolute right-0 top-11 z-50 w-56 rounded-xl bg-white text-gray-900 shadow-xl border border-gray-100 py-1 overflow-hidden">
              {[
                { label: 'График', action: () => nav({ to: '/schedule' }) },
                { label: 'Услуги', action: () => nav({ to: '/services' }) },
                { label: 'Настройки', action: () => nav({ to: '/settings' }) },
                { label: 'Скопировать ссылку записи', action: copyBook },
                { label: 'Сбросить журнал', action: doReset },
                { label: 'Выйти (PIN)', action: doLogout },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50"
                  onClick={() => {
                    setOpen(false);
                    m.action();
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
