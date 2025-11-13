const DEFAULT_CURRENCY = "USD";

export function formatCurrency(
  value,
  currency = DEFAULT_CURRENCY,
  maximumFractionDigits = 2,
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(Number(value ?? 0));
}

export function formatPercent(value, decimals = 1) {
  return `${(Number(value ?? 0) * 100).toFixed(decimals)}%`;
}

export function formatRatio(value, decimals = 2, fallback = "—") {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return fallback;
  }
  return numeric.toFixed(decimals);
}

export function formatChannelLabel(channel = "") {
  if (!channel) return "Unknown";
  return channel.replace(/_/g, " ").toLowerCase().replace(/^\w/, (char) =>
    char.toUpperCase()
  );
}

export function formatDateShort(value, timezone) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  const options = {
    month: "short",
    day: "numeric",
  };
  if (timezone) {
    options.timeZone = timezone;
  }
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

export function formatDecimal(value, digits = 2) {
  return Number(value ?? 0).toFixed(digits);
}

export function formatNumber(value) {
  return Number(value ?? 0).toLocaleString();
}
