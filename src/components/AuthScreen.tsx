import { useState } from 'react';
import { authPost } from '@/lib/server-auth';
import { cn } from '@/lib/cn';
import { PasswordInput } from './PasswordInput';

type Mode = 'login' | 'register' | 'forgot';

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base outline-none focus:border-accent';

export function AuthScreen({
  hasAccount,
  masterTelegram,
  onDone,
}: {
  hasAccount: boolean;
  masterTelegram: boolean;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>(hasAccount ? 'login' : 'register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const go = (m: Mode) => {
    setMode(m);
    setError('');
    setInfo('');
    setCode('');
    setPassword('');
    setPassword2('');
  };

  async function requestCode() {
    setError('');
    setInfo('');
    setBusy(true);
    const r = await authPost('code', { purpose: mode === 'forgot' ? 'reset' : 'register' });
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Не удалось отправить код');
    setInfo(
      r.via === 'telegram'
        ? 'Код отправлен в ваш Telegram (бот мастера). Действует 15 минут.'
        : 'Telegram мастера не подключён — код записан в журнал сервера (спросите администратора).',
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode !== 'forgot' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError('Введите email');
    }
    if (password.trim().length < 6) return setError('Пароль — минимум 6 символов');
    if (mode !== 'login' && password !== password2) return setError('Пароли не совпадают');
    if (mode !== 'login' && !/^\d{6}$/.test(code.trim())) return setError('Введите 6-значный код из Telegram');
    setBusy(true);
    const r =
      mode === 'login'
        ? await authPost('login', { email, password })
        : mode === 'register'
          ? await authPost('register', { email, password, code })
          : await authPost('reset', { code, password });
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Ошибка');
    onDone();
  }

  const title = mode === 'login' ? 'Вход' : mode === 'register' ? 'Регистрация' : 'Сброс пароля';

  return (
    <div className="phone-shell bg-[#f0f2f5]">
      <div className="flex-1 flex flex-col justify-center px-6 py-8 safe-top safe-bottom overflow-y-auto">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-accent flex items-center justify-center text-white text-2xl font-bold">
            ✂
          </div>
          <h1 className="text-xl font-bold text-gray-900">Барбер CRM</h1>
          <p className="text-sm text-gray-500 mt-1">{title}</p>
        </div>

        {mode === 'register' && (
          <p className="text-xs text-gray-500 mb-3">
            Создайте аккаунт владельца (один раз). Для защиты нужен код — он придёт в ваш Telegram-чат
            мастера в боте.
            {!masterTelegram && ' Telegram мастера пока не подключён.'}
          </p>
        )}
        {mode === 'forgot' && (
          <p className="text-xs text-gray-500 mb-3">
            Код для сброса придёт в ваш Telegram-чат мастера в боте. После сброса все другие входы
            будут завершены.
          </p>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode !== 'forgot' && (
            <label className="block">
              <span className="text-xs text-gray-500 mb-1 block">Email</span>
              <input
                className={inputCls}
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {mode !== 'login' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={requestCode}
                disabled={busy}
                className="touch-btn w-full rounded-xl bg-[#229ED9] text-white font-semibold text-sm disabled:opacity-60"
              >
                Получить код в Telegram
              </button>
              {info && <p className="text-xs text-emerald-700">{info}</p>}
              <label className="block">
                <span className="text-xs text-gray-500 mb-1 block">Код из Telegram</span>
                <input
                  className={cn(inputCls, 'tracking-widest')}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </label>
            </div>
          )}
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">
              {mode === 'login' ? 'Пароль' : 'Новый пароль (минимум 6 символов)'}
            </span>
            <PasswordInput
              className={inputCls}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={setPassword}
            />
          </label>
          {mode !== 'login' && (
            <label className="block">
              <span className="text-xs text-gray-500 mb-1 block">Повторите пароль</span>
              <PasswordInput
                className={inputCls}
                autoComplete="new-password"
                value={password2}
                onChange={setPassword2}
              />
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className={cn('touch-btn w-full rounded-xl bg-accent text-white font-semibold text-base', busy && 'opacity-60')}
          >
            {mode === 'login' ? 'Войти' : mode === 'register' ? 'Зарегистрироваться' : 'Сохранить новый пароль'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm">
          {mode === 'login' && (
            <button type="button" className="text-accent" onClick={() => go('forgot')}>
              Забыли пароль?
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="text-accent" onClick={() => go('login')}>
              ← Ко входу
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
