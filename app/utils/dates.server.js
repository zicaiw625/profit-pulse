const FORMATTER_CACHE = new Map();
const TIMEZONE_CACHE = new Map();

export function resolveTimezone(input) {
  if (!input) return "UTC";
  if (typeof input === "string") {
    return normalizeTimezone(input);
  }
  if (input.timezone) {
    return normalizeTimezone(input.timezone);
  }
  if (input.store) {
    const store = input.store;
    const timezone =
      store?.timezone ||
      store?.preferredTimezone ||
      store?.merchant?.primaryTimezone ||
      input.merchant?.primaryTimezone ||
      input.defaultTimezone;
    if (timezone) {
      return normalizeTimezone(timezone);
    }
  }
  if (input.merchant?.primaryTimezone) {
    return normalizeTimezone(input.merchant.primaryTimezone);
  }
  if (input.defaultTimezone) {
    return normalizeTimezone(input.defaultTimezone);
  }
  return "UTC";
}

export function startOfDay(value, options) {
  const timezone = resolveTimezone(options);
  const date = coerceDate(value);
  if (timezone === "UTC") {
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  const parts = getZonedDateParts(date, timezone);
  return buildZonedDate({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timezone);
}

export function shiftDays(value, delta, options) {
  const timezone = resolveTimezone(options);
  const baseStart = startOfDay(value, timezone);
  const baseParts = getZonedDateParts(baseStart, timezone);
  const utcGuess = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + delta, 0, 0, 0));
  return startOfDay(utcGuess, timezone);
}

export function formatDateKey(value, options) {
  const timezone = resolveTimezone(options);
  const start = startOfDay(value, timezone);
  const parts = getZonedDateParts(start, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function coerceDate(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function getZonedDateParts(date, timezone) {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);
  const result = {
    year: 1970,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  };

  for (const part of parts) {
    switch (part.type) {
      case "year":
        result.year = Number(part.value);
        break;
      case "month":
        result.month = Number(part.value);
        break;
      case "day":
        result.day = Number(part.value);
        break;
      case "hour":
        result.hour = Number(part.value);
        break;
      case "minute":
        result.minute = Number(part.value);
        break;
      case "second":
        result.second = Number(part.value);
        break;
      case "fractionalSecond":
        result.millisecond = Number(part.value.padEnd(3, "0"));
        break;
      default:
        break;
    }
  }

  return result;
}

function buildZonedDate(parts, timezone) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
    parts.millisecond ?? 0,
  );
  const guessDate = new Date(utcGuess);
  const offset = getTimezoneOffset(guessDate, timezone);
  return new Date(utcGuess - offset);
}

function getTimezoneOffset(date, timezone) {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  let hour = 0;
  let minute = 0;
  let second = 0;
  let millisecond = 0;

  for (const part of parts) {
    switch (part.type) {
      case "year":
        year = Number(part.value);
        break;
      case "month":
        month = Number(part.value);
        break;
      case "day":
        day = Number(part.value);
        break;
      case "hour":
        hour = Number(part.value);
        break;
      case "minute":
        minute = Number(part.value);
        break;
      case "second":
        second = Number(part.value);
        break;
      case "fractionalSecond":
        millisecond = Number(part.value.padEnd(3, "0"));
        break;
      default:
        break;
    }
  }

  const zonedTime = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  return zonedTime - date.getTime();
}

function getFormatter(timezone) {
  if (FORMATTER_CACHE.has(timezone)) {
    return FORMATTER_CACHE.get(timezone);
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (error) {
    if (timezone !== "UTC") {
      return getFormatter("UTC");
    }
    throw error;
  }
  FORMATTER_CACHE.set(timezone, formatter);
  return formatter;
}

function normalizeTimezone(value) {
  if (!value || typeof value !== "string") {
    return "UTC";
  }
  const key = value.trim();
  if (!key) return "UTC";
  if (TIMEZONE_CACHE.has(key)) {
    return TIMEZONE_CACHE.get(key);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: key });
    TIMEZONE_CACHE.set(key, key);
    return key;
  } catch (error) {
    TIMEZONE_CACHE.set(key, "UTC");
    return "UTC";
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}
