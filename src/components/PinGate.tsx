import { useState } from 'react';
import { hasLock, setupLock, verifyPin, getLock } from '@/lib/auth';
import { normalizePhone, formatPhoneDisplay } from '@/lib/phone';
import { useCrm } from '@/lib/store';
import { cn } from '@/lib/cn';

export function PinGate({ onUnlock }: { onUnlock: () => void }) {
  const isSetup = !hasLock();
  const lock = getLock();
  const replaceSettings = useCrm((s) => s.replaceSettings);
  const [phone, setPhone] = useState(lock?.phone || '');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const nPhone = normalizePhone(phone);
    if (digitsLen(nPhone) < 10) {
      setError('Введите номер телефона');
      return;
    }
    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
      setError('PIN: 4–6 цифр');
      return;
    }
    setBusy(true);
    try {
      if (isSetup) {
        if (pin !== pin2) {
          setError('PIN не совпадает');
          setBusy(false);
          return;
        }
        await setupLock(nPhone, pin);
        replaceSettings({ phone: nPhone });
        onUnlock();
      } else {
        const ok = await verifyPin(nPhone, pin);
        if (!ok) {
          setError('Неверный телефон или PIN');
          setBusy(false);
          return;
        }
        onUnlock();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="phone-shell bg-[#f0f2f5]">
      <div className="flex-1 flex flex-col justify-center px-6 py-8 safe-top safe-bottom">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-accent flex items-center justify-center text-white text-2xl font-bold">
            ✂
          </div>
          <h1 className="text-xl font-bold text-gray-900">Барбер CRM</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isSetup ? 'Создайте PIN для входа' : 'Вход по телефону и PIN'}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">Телефон</span>
            <input
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base outline-none focus:border-accent"
              inputMode="tel"
              placeholder="+7…"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 mb-1 block">PIN (4–6 цифр)</span>
            <input
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base tracking-widest outline-none focus:border-accent"
              inputMode="numeric"
              type="password"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
            />
          </label>
          {isSetup && (
            <label className="block">
              <span className="text-xs text-gray-500 mb-1 block">Подтвердите PIN</span>
              <input
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base tracking-widest outline-none focus:border-accent"
                inputMode="numeric"
                type="password"
                maxLength={6}
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className={cn(
              'touch-btn w-full rounded-xl bg-accent text-white font-semibold text-base',
              busy && 'opacity-60',
            )}
          >
            {isSetup ? 'Создать и войти' : 'Войти'}
          </button>
        </form>
        {!isSetup && lock?.phone && (
          <p className="text-center text-xs text-gray-400 mt-4">
            Аккаунт: {formatPhoneDisplay(lock.phone)}
          </p>
        )}
      </div>
    </div>
  );
}

function digitsLen(p: string) {
  return p.replace(/\D/g, '').length;
}
