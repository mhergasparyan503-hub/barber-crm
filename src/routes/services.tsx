import { useState } from 'react';
import { useCrm } from '@/lib/store';
import { toast } from 'sonner';

const CATS = ['Стрижка', 'Борода', 'Бритьё', 'Детское', 'Уход', 'Другое'];

export function ServicesPage() {
  const services = useCrm((s) => s.services);
  const addService = useCrm((s) => s.addService);
  const updateService = useCrm((s) => s.updateService);
  const deleteService = useCrm((s) => s.deleteService);
  const [name, setName] = useState('');
  const [durationMin, setDurationMin] = useState(30);
  const [price, setPrice] = useState(1000);
  const [category, setCategory] = useState('Стрижка');

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-semibold">Услуги</h1>
      <div className="mb-4 grid gap-2 rounded-xl border bg-white p-3 md:grid-cols-5">
        <input className="rounded-md border px-3 py-2 text-sm" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" className="rounded-md border px-3 py-2 text-sm" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
        <input type="number" className="rounded-md border px-3 py-2 text-sm" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        <select className="rounded-md border px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          type="button"
          className="touch-btn rounded-md bg-[#ff7900] font-semibold text-white"
          onClick={() => {
            if (!name.trim()) return toast.error('Название');
            addService({ name: name.trim(), durationMin, price, category, active: true, online: true });
            setName('');
            toast.success('Добавлено');
          }}
        >
          Добавить
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
        {services.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
            <input className="min-w-[160px] flex-1 rounded border px-2 py-1 font-medium" value={s.name} onChange={(e) => updateService(s.id, { name: e.target.value })} />
            <span className="text-slate-400">{s.category}</span>
            <input type="number" className="w-20 rounded border px-2 py-1" value={s.durationMin} onChange={(e) => updateService(s.id, { durationMin: Number(e.target.value) })} />
            <span>мин</span>
            <input type="number" className="w-24 rounded border px-2 py-1" value={s.price} onChange={(e) => updateService(s.id, { price: Number(e.target.value) })} />
            <span>₽</span>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={s.active} onChange={(e) => updateService(s.id, { active: e.target.checked })} /> активна
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={s.online} onChange={(e) => updateService(s.id, { online: e.target.checked })} /> онлайн
            </label>
            <button type="button" className="text-red-600" onClick={() => deleteService(s.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
