import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Password field for phones: no auto-capitalization/autocorrect, with show/hide toggle. */
export function PasswordInput({
  value,
  onChange,
  className,
  autoComplete = 'current-password',
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        className={cn(className, 'pr-11')}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center text-gray-400"
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}
