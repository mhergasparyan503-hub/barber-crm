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

export const STATUS_LABEL: Record<string, string> = {
  waiting: 'Ожидание',
  cancelled: 'Отмена',
};

export const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const WEEKDAY_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
