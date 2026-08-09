export const MANILA_TIME_ZONE = "Asia/Manila";
export const MINIMUM_NOTICE_MS = 24 * 60 * 60 * 1000;
export const CONSULTATION_START_MINUTES = 8 * 60;
export const CONSULTATION_END_MINUTES = 17 * 60;
export const SLOT_STEP_MINUTES = 30;

export type ExistingSlot = { starts_at: string; ends_at: string };

export function isUpcomingSlot(slot: Pick<ExistingSlot, "ends_at">, now = new Date()) {
  return new Date(slot.ends_at).getTime() > now.getTime();
}

const manilaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MANILA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateParts(date: Date) {
  return Object.fromEntries(
    manilaDateFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
}

export function manilaDateKey(date: Date) {
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayNumber(dateKey: string) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

export function mondayOf(dateKey: string) {
  const weekday = weekdayNumber(dateKey);
  return addCalendarDays(dateKey, -((weekday + 6) % 7));
}

export function manilaInstant(dateKey: string, minutes: number) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");
  return new Date(`${dateKey}T${hours}:${mins}:00+08:00`);
}

export function weekDays(mondayDateKey: string) {
  return Array.from({ length: 5 }, (_, index) => addCalendarDays(mondayDateKey, index));
}

export function calendarTimes() {
  const times: number[] = [];
  for (
    let minutes = CONSULTATION_START_MINUTES;
    minutes < CONSULTATION_END_MINUTES;
    minutes += SLOT_STEP_MINUTES
  ) {
    times.push(minutes);
  }
  return times;
}

export function firstBookableStart(now = new Date()) {
  const earliest = new Date(now.getTime() + MINIMUM_NOTICE_MS);
  let dateKey = manilaDateKey(earliest);

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const candidateDate = addCalendarDays(dateKey, dayOffset);
    const weekday = weekdayNumber(candidateDate);
    if (weekday === 0 || weekday === 6) continue;

    for (const minutes of calendarTimes()) {
      const candidate = manilaInstant(candidateDate, minutes);
      if (candidate.getTime() >= earliest.getTime()) return candidate;
    }
  }

  return manilaInstant(addCalendarDays(dateKey, 14), CONSULTATION_START_MINUTES);
}

export function initialCalendarWeek(now = new Date()) {
  return mondayOf(manilaDateKey(firstBookableStart(now)));
}

export function overlapsExisting(start: Date, end: Date, existing: ExistingSlot[]) {
  return existing.some((slot) => {
    const existingStart = new Date(slot.starts_at);
    const existingEnd = new Date(slot.ends_at);
    return start < existingEnd && end > existingStart;
  });
}

export function availabilityValidationMessage(
  start: Date,
  end: Date,
  existing: ExistingSlot[],
  now = new Date(),
) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return "Choose a valid start time and duration.";
  }

  const dateKey = manilaDateKey(start);
  const weekday = weekdayNumber(dateKey);
  if (weekday === 0 || weekday === 6) {
    return "Consultation availability may only be published from Monday to Friday.";
  }

  if (start.getTime() < now.getTime() + MINIMUM_NOTICE_MS) {
    return "Publish availability at least 24 hours in advance.";
  }

  const startParts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(start);
  const endParts = new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(end);
  const toMinutes = (parts: Intl.DateTimeFormatPart[]) => {
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Number(values.hour) * 60 + Number(values.minute);
  };

  if (
    toMinutes(startParts) < CONSULTATION_START_MINUTES ||
    toMinutes(endParts) > CONSULTATION_END_MINUTES ||
    manilaDateKey(end) !== dateKey
  ) {
    return "Choose a time that stays within the 8:00 AM–5:00 PM consultation window.";
  }

  if (overlapsExisting(start, end, existing)) {
    return "This time overlaps an availability entry you already published.";
  }

  return "";
}

export function formatCalendarDay(dateKey: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(
    new Date(`${dateKey}T00:00:00Z`),
  );
}

export function formatManilaDateTime(date: Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatTime(minutes: number) {
  return formatManilaDateTime(manilaInstant("2026-01-05", minutes), {
    hour: "numeric",
    minute: "2-digit",
  });
}
