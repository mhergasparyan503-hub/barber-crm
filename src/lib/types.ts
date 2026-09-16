export type VisitStatus = 'waiting' | 'cancelled';
export type ExceptionType = 'off' | 'vacation' | 'sick' | 'custom';
export type AppointmentSource = 'journal' | 'online' | 'telegram';

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: number;
  category: string;
  active: boolean;
  online: boolean;
}

export interface Staff {
  id: string;
  name: string;
  color: string;
  active: boolean;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  notes?: string;
  tags?: string[];
  telegramChatId?: string;
  telegramUsername?: string;
  reminderPrefs?: number[];
  reminderMorning?: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  staffId: string;
  serviceIds: string[];
  /** Wall-clock start (MSK naive or +03:00). Not startsAt. */
  start: string;
  durationMin: number;
  /** booked → waiting; cancelled → cancelled */
  status: VisitStatus;
  note?: string;
  source: AppointmentSource;
  color?: string;
  telegramChatId?: string;
  reminders?: { at: string; sent?: boolean; kind: string }[];
  createdAt: string;
}

export interface TimeWindow {
  id: string;
  staffId: string;
  start: string;
  durationMin: number;
  label?: string;
}

export interface DaySchedule {
  day: number;
  start: string;
  end: string;
  breakStart?: string;
  breakEnd?: string;
  working: boolean;
}

export interface StaffSchedule {
  staffId: string;
  week: DaySchedule[];
}

export interface ScheduleException {
  id: string;
  staffId: string;
  date: string;
  type: ExceptionType;
  start?: string;
  end?: string;
  breakStart?: string;
  breakEnd?: string;
}

export interface TelegramChat {
  chatId: string;
  username?: string;
  clientId?: string;
  linkedAt: string;
}

export interface Settings {
  dataVersion: number;
  studioName: string;
  subtitle: string;
  phone: string;
  address: string;
  soloMode: boolean;
  onlineEnabled: boolean;
  leadMinutes: number;
  horizonDays: number;
  slotMinutes: number;
  visitColor: string;
  onlineColor: string;
  onlineServiceIds: string[];
  telegramToken: string;
  telegramBotUsername: string;
  telegramOwnerChatId: string;
  telegramOffset: number;
  messageTemplates?: { booked: string; reminder: string };
}

export interface CrmState {
  clients: Client[];
  services: Service[];
  staff: Staff[];
  appointments: Appointment[];
  windows: TimeWindow[];
  schedules: StaffSchedule[];
  exceptions: ScheduleException[];
  telegramChats?: TelegramChat[];
  settings: Settings;
}
