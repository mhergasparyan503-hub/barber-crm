import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Plus } from 'lucide-react';
import { useCrm } from '@/lib/store';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

export function ServicesPage() {
  const services = useCrm((s) => s.services);
  const updateService = useCrm((s) => s.updateService);
  const addService = useCrm((s) => s.addService);
  const deleteService = useCrm((s) => s.deleteService);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex-1 overflow-y-auto bg-journal">
      <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2 sticky top-0 z-10">
        <Link to="/more" className="h-10 w-10 flex items-center justify-center">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="font-semibold flex-1">Услуги</div>
        <button
          type="button"
          className="h-10 w-10 flex items-center justify-center text-accent"
          onClick={() => {
            addService({
              name: 'Новая услуга',
              durationMin: 30,
              price: 1000,
              category: 'Другое',
              active: true,
              online: true,
            });
            toast.success('Добавлено');
          }}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
      <div className="p-3 space-y-2 pb-8">
        {services.map((s) => (
          <div key={s.id} className={cn('bg-white rounded-2xl p-3 shadow-sm border border-gray-100', !s.active && 'opacity-60')}>
            {editing === s.id ? (
              <div className="space-y-2">
                <input
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={s.name}
                  onChange={(e) => updateService(s.id, { name: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-gray-500">
                    Мин
                    <input
                      type="number"
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={s.durationMin}
                      onChange={(e) => updateService(s.id, { durationMin: +e.target.value || 15 })}
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    Цена ₽
                    <input
                      type="number"
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={s.price}
                      onChange={(e) => updateService(s.id, { price: +e.target.value || 0 })}
                    />
                  </label>
                </div>
                <div className="flex gap-3 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={s.active} onChange={(e) => updateService(s.id, { active: e.target.checked })} />
                    Активна
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={s.online} onChange={(e) => updateService(s.id, { online: e.target.checked })} />
                    Онлайн
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="flex-1 touch-btn rounded-xl bg-accent text-white text-sm" onClick={() => setEditing(null)}>
                    Готово
                  </button>
                  <button
                    type="button"
                    className="touch-btn px-4 rounded-xl border border-red-200 text-red-600 text-sm"
                    onClick={() => {
                      if (confirm('Удалить услугу?')) {
                        deleteService(s.id);
                        setEditing(null);
                      }
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="w-full text-left" onClick={() => setEditing(s.id)}>
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-gray-500">
                  {s.durationMin} мин · {s.price.toLocaleString('ru-RU')} ₽ · {s.category}
                </div>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
