export interface DailyScheduleTime {
  hour: number;
  minute: number;
  label: string;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function parseDailyScheduleTime(value: string): DailyScheduleTime | null {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return null;
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    label: `${match[1]}:${match[2]}`
  };
}

export function assertValidTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new Error(`Invalid time zone "${timeZone}". Use an IANA name such as Europe/London.`);
  }
}

export function formatZonedDate(date: Date, timeZone: string): string {
  const parts = getZonedDateParts(date, timeZone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

export function formatZonedDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23"
  }).format(date);
}

export function getNextDailyRunDate(
  now: Date,
  schedule: DailyScheduleTime,
  timeZone: string
): Date {
  const localNow = getZonedDateParts(now, timeZone);
  const todayRunMs = zonedDateTimeToUtcMs(
    {
      year: localNow.year,
      month: localNow.month,
      day: localNow.day,
      hour: schedule.hour,
      minute: schedule.minute,
      second: 0
    },
    timeZone
  );

  if (todayRunMs > now.getTime()) {
    return new Date(todayRunMs);
  }

  const tomorrow = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day + 1));
  const tomorrowParts = getUtcDateParts(tomorrow);
  return new Date(
    zonedDateTimeToUtcMs(
      {
        ...tomorrowParts,
        hour: schedule.hour,
        minute: schedule.minute,
        second: 0
      },
      timeZone
    )
  );
}

function getUtcDateParts(date: Date): Pick<ZonedDateParts, "year" | "month" | "day"> {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedDateParts(date, timeZone);
  const zonedAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return zonedAsUtcMs - date.getTime();
}

function zonedDateTimeToUtcMs(parts: ZonedDateParts, timeZone: string): number {
  const localAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const firstPassUtcMs = localAsUtcMs - getTimeZoneOffsetMs(new Date(localAsUtcMs), timeZone);
  return localAsUtcMs - getTimeZoneOffsetMs(new Date(firstPassUtcMs), timeZone);
}
