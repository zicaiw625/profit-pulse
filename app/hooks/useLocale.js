import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { translate } from "../utils/i18n";

const SUPPORTED_LANGS = ["en", "zh"];
const DEFAULT_LANG = "en";

function detectBrowserLanguage() {
  if (typeof navigator === "undefined" || !navigator.language) {
    return null;
  }
  const normalized = navigator.language.toLowerCase();
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  return null;
}

export function useLocale() {
  const [searchParams] = useSearchParams();
  const langParam = (searchParams.get("lang") || "").toLowerCase();
  const initialLang = SUPPORTED_LANGS.includes(langParam) ? langParam : DEFAULT_LANG;
  const [lang, setLang] = useState(initialLang);

  useEffect(() => {
    if (SUPPORTED_LANGS.includes(langParam)) {
      if (lang !== langParam) {
        setLang(langParam);
      }
      return;
    }

    const browserLang = detectBrowserLanguage();
    const fallback = browserLang && SUPPORTED_LANGS.includes(browserLang)
      ? browserLang
      : DEFAULT_LANG;

    if (lang !== fallback) {
      setLang(fallback);
    }
  }, [langParam, lang]);

  const t = useMemo(() => {
    return (key) => translate(key, lang);
  }, [lang]);

  return { lang, t };
}
