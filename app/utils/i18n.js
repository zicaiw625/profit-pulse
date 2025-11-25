import { TRANSLATIONS } from "../constants/translations.js";

export const SUPPORTED_LANGS = ["en", "zh"];
export const DEFAULT_LANG = "en";

function getLanguageFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  try {
    for (const part of cookieHeader.split(";")) {
      const [name, value] = part.trim().split("=");
      if (name === "lang" && value) {
        return normalizeLanguage(value);
      }
    }
  } catch (error) {
    // Non-blocking: ignore malformed cookies.
  }
  return null;
}

export function normalizeLanguage(lang) {
  const normalized = (lang || "").toString().toLowerCase();
  if (SUPPORTED_LANGS.includes(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  return DEFAULT_LANG;
}

export function getLanguageFromSearchParams(searchParams) {
  if (!searchParams) return DEFAULT_LANG;
  const langParam =
    typeof searchParams.get === "function"
      ? searchParams.get("lang")
      : new URLSearchParams(searchParams).get("lang");
  return normalizeLanguage(langParam);
}

export function getLanguageFromRequest(request) {
  try {
    const url = new URL(request.url);
    const langParam = url.searchParams.get("lang");
    if (langParam) {
      return normalizeLanguage(langParam);
    }
    const langFromCookie = getLanguageFromCookieHeader(
      request.headers.get("cookie"),
    );
    if (langFromCookie) {
      return langFromCookie;
    }
    const acceptLanguage = request.headers.get("accept-language") || "";
    const [first] = acceptLanguage.split(",").map((item) => item.split(";")[0]);
    if (first) {
      return normalizeLanguage(first);
    }
  } catch (error) {
    // Non-blocking: fall back to default language when parsing fails.
  }
  return DEFAULT_LANG;
}

export function translate(key, lang = DEFAULT_LANG) {
  const locale = normalizeLanguage(lang);
  const dictionary = TRANSLATIONS[locale] ?? TRANSLATIONS[DEFAULT_LANG];
  return dictionary[key] ?? TRANSLATIONS[DEFAULT_LANG][key] ?? key;
}
