import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export function formatVisitWhen(iso: string) {
  const d = new Date(iso);
  return {
    weekday: format(d, 'EEEE', { locale: ru }),
    date: format(d, 'd MMMM', { locale: ru }),
    time: format(d, 'HH:mm'),
    full: format(d, "EEEE, d MMMM 'в' HH:mm", { locale: ru }),
  };
}

export function fillTemplate(
  tpl: string,
  vars: Record<string, string>,
) {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), tpl);
}

export const STATUS_LABEL: Record<string, string> = {
  waiting: 'Ожидание',
  confirmed: 'Подтвердил',
  arrived: 'Пришёл',
  cancelled: 'Отмена',
  no_show: 'Не пришёл',
};
