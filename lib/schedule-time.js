function localDateParts(date, timezone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

export function localDateKey(date, timezone) {
  const parts = localDateParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function localTimeToUtc(year, month, day, hour, minute, timezone) {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localDateParts(new Date(timestamp), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    timestamp += target - represented;
  }
  return new Date(timestamp);
}

export function localDateTimeToUtc(dateKey, hour, minute, timezone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Invalid local schedule date or time.');
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error('Invalid local schedule date or time.');
  }
  return localTimeToUtc(year, month, day, hour, minute, timezone);
}

export function nextScheduleBase(now, timezone) {
  const localNow = localDateParts(now, timezone);
  let date = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day));
  let base = localTimeToUtc(
    date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 18, 0, timezone
  );
  if (now.getTime() > base.getTime() + 32 * 30 * 60 * 1000) {
    date = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    base = localTimeToUtc(
      date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 18, 0, timezone
    );
  }
  return base;
}
