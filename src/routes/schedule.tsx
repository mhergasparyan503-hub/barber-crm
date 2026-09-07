import { addDays, format, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState } from 'react';
import { useCrm } from '@/lib/store';
import { getDayPlan } from '@/lib/schedule';
import { ScheduleEditor } from '@/components/schedule-editor';

export function SchedulePage() {
  const [anchor] = useState(new Date());
  const allStaff = useCrm((s) => s.staff);
  const staff = allStaff.filter((x) => x.active);
  const schedules = useCrm((s) => s.schedules);
  const exceptions = useCrm((s) => s.exceptions);
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [edit, setEdit] = useState<{ staffId: string; date?: string } | null>(null);

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-semibold">График</h1>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="p-2 text-left">Сотрудник</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="p-2 capitalize">{format(d, 'EEE d', { locale: ru })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((st) => {
              const sc = schedules.find((s) => s.staffId === st.id);
              return (
                <tr key={st.id} className="border-b">
                  <td className="p-2">
                    <button type="button" className="font-semibold text-[#ff7900]" onClick={() => setEdit({ staffId: st.id })}>
                      {st.name}
                    </button>
                  </td>
                  {days.map((d) => {
                    const plan = getDayPlan(sc, exceptions, st.id, d);
                    const label = !plan.working
                      ? plan.type === 'vacation'
                        ? 'Отпуск'
                        : plan.type === 'sick'
                          ? 'Больничный'
                          : 'Выходной'
                      : `${format(plan.start!, 'HH:mm')}–${format(plan.end!, 'HH:mm')}`;
                    return (
                      <td key={d.toISOString()} className="p-1">
                        <button
                          type="button"
                          className={`touch-btn w-full rounded-md px-2 py-2 text-left text-xs ${plan.working ? 'bg-emerald-50' : 'bg-slate-100 text-slate-500'}`}
                          onClick={() => setEdit({ staffId: st.id, date: format(d, 'yyyy-MM-dd') })}
                        >
                          {label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edit && (
        <ScheduleEditor
          open={!!edit}
          onOpenChange={(v) => !v && setEdit(null)}
          staffId={edit.staffId}
          focusDate={edit.date}
        />
      )}
    </div>
  );
}
