import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authPost, authStatus } from '@/lib/server-auth';
import { logout as pinLogout } from '@/lib/auth';
import { PasswordInput } from './PasswordInput';

const inputCls = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900';

/** Settings → Аккаунт: email, change password / email, logout. */
export function AccountCard() {
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState<'' | 'password' | 'email'>('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void authStatus().then((s) => setEmail(s?.email || ''));
  }, []);

  const reset = () => {
    setError('');
    setOpen('');
    setCurrent('');
    setNext('');
    setNext2('');
    setNewEmail('');
  };

  async function changePassword() {
    setError('');
    if (!current) return setError('Введите текущий пароль');
    if (next.trim().length < 6) return setError('Новый пароль — минимум 6 символов');
    if (next.trim() !== next2.trim()) return setError('Новые пароли не совпадают');
    setBusy(true);
    const r = await authPost('change-password', { current, password: next });
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Ошибка');
    toast.success('Пароль изменён');
    reset();
  }

  async function changeEmail() {
    setError('');
    if (!current) return setError('Введите текущий пароль');
    setBusy(true);
    const r = await authPost('change-email', { current, email: newEmail });
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Ошибка');
    setEmail(String(r.email || newEmail));
    toast.success('Email изменён');
    reset();
  }

  async function logout() {
    if (!confirm('Выйти из аккаунта на этом телефоне?')) return;
    await authPost('logout');
    pinLogout();
    window.location.href = '/';
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm text-sm space-y-3">
      <div className="font-medium text-gray-900">Аккаунт</div>
      <div className="text-gray-600">Вход: {email || '—'}</div>
      <div className="flex gap-2">
        <button
          type="button"
          className="touch-btn flex-1 rounded-xl border border-gray-200 font-medium"
          onClick={() => {
            setError('');
            setOpen(open === 'password' ? '' : 'password');
          }}
        >
          Сменить пароль
        </button>
        <button
          type="button"
          className="touch-btn flex-1 rounded-xl border border-gray-200 font-medium"
          onClick={() => {
            setError('');
            setOpen(open === 'email' ? '' : 'email');
          }}
        >
          Сменить email
        </button>
      </div>
      {open && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-500">
            Текущий пароль (тот, с которым входите по email)
            <PasswordInput className={inputCls} autoComplete="current-password" value={current} onChange={setCurrent} />
          </label>
          {open === 'password' ? (
            <>
              <label className="block text-xs text-gray-500">
                Новый пароль (минимум 6 символов)
                <PasswordInput className={inputCls} autoComplete="new-password" value={next} onChange={setNext} />
              </label>
              <label className="block text-xs text-gray-500">
                Повторите новый пароль
                <PasswordInput className={inputCls} autoComplete="new-password" value={next2} onChange={setNext2} />
              </label>
              {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
              <button type="button" disabled={busy} onClick={changePassword} className="touch-btn w-full rounded-xl bg-accent text-white font-semibold disabled:opacity-60">
                {busy ? 'Сохраняю…' : 'Сохранить пароль'}
              </button>
              <p className="text-xs text-gray-400">
                Не помните текущий пароль? Нажмите «Выйти из аккаунта», затем на экране входа «Забыли пароль?» — код придёт в Telegram.
              </p>
            </>
          ) : (
            <>
              <label className="block text-xs text-gray-500">
                Новый email
                <input className={inputCls} type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
              <button type="button" disabled={busy} onClick={changeEmail} className="touch-btn w-full rounded-xl bg-accent text-white font-semibold disabled:opacity-60">
                Сохранить email
              </button>
            </>
          )}
        </div>
      )}
      <button type="button" onClick={logout} className="touch-btn w-full rounded-xl border border-red-200 text-red-600 font-medium">
        Выйти из аккаунта
      </button>
    </div>
  );
}
