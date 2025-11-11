export function startOfDay(value) {
  const date = typeof value === "string" ? new Date(value) : new Date(value ?? Date.now());
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function shiftDays(value, delta) {
  const date = startOfDay(value);
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

export function formatDateKey(value) {
  return startOfDay(value).toISOString().slice(0, 10);
}
