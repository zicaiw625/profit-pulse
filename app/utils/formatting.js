import { normalizeLanguage } from "./i18n";

const DEFAULT_CURRENCY = "USD";
const CURRENCY_FORMATTER_CACHE = new Map();
const NUMBER_FORMATTER_CACHE = new Map();

export function formatCurrency(
  value,
  currency = DEFAULT_CURRENCY,
  maximumFractionDigits = 2,
) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const formatter = getCurrencyFormatter(normalizedCurrency, maximumFractionDigits);
  return formatter.format(Number(value ?? 0));
}

function normalizeCurrencyCode(code) {
  if (!code) {
    return DEFAULT_CURRENCY;
  }

  const trimmed = code.toString().trim();
  if (!trimmed) {
    return DEFAULT_CURRENCY;
  }

  const upper = trimmed.toUpperCase();
  // Currency codes should be three-letter ISO strings; fallback otherwise.
  return upper.length === 3 ? upper : DEFAULT_CURRENCY;
}

function getCurrencyFormatter(currency, maximumFractionDigits) {
  const key = `${currency}:${maximumFractionDigits}`;
  const cached = CURRENCY_FORMATTER_CACHE.get(key);
  if (cached) {
    return cached;
  }

  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits,
    });
    CURRENCY_FORMATTER_CACHE.set(key, formatter);
    return formatter;
  } catch (error) {
    if (currency !== DEFAULT_CURRENCY) {
      return getCurrencyFormatter(DEFAULT_CURRENCY, maximumFractionDigits);
    }

    throw error;
  }
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

export function formatDate(value, { lang, timeZone, options = {} } = {}) {
  return formatDateTime(value, {
    lang,
    timeZone,
    options: {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: undefined,
      minute: undefined,
      ...options,
    },
  });
}

export function formatDecimal(value, digits = 2) {
  return Number(value ?? 0).toFixed(digits);
}

export function formatNumber(value, lang) {
  const formatter = getNumberFormatter(lang);
  return formatter.format(Number(value ?? 0));
}

export function formatDateTime(
  value,
  { lang, timeZone, options = {} } = {},
) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const locale = resolveLocale(lang);
  const fmtOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    ...options,
  };
  Object.keys(fmtOptions).forEach((key) => {
    if (fmtOptions[key] === undefined) {
      delete fmtOptions[key];
    }
  });
  return new Intl.DateTimeFormat(locale, fmtOptions).format(date);
}

function resolveLocale(lang) {
  const normalized = normalizeLanguage(lang);
  if (normalized === "zh") return "zh-CN";
  return "en-US";
}

function getNumberFormatter(lang) {
  const locale = resolveLocale(lang);
  const cached = NUMBER_FORMATTER_CACHE.get(locale);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat(locale);
  NUMBER_FORMATTER_CACHE.set(locale, formatter);
  return formatter;
}
