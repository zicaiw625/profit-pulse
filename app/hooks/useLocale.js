import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  DEFAULT_LANG,
  getLanguageFromSearchParams,
  normalizeLanguage,
  translate,
} from "../utils/i18n";

export function useLocale() {
  const [searchParams] = useSearchParams();
  const hasLangParam = searchParams.has("lang");
  const langFromSearch = getLanguageFromSearchParams(searchParams);
  const documentLang =
    typeof document !== "undefined" && document?.documentElement?.lang
      ? normalizeLanguage(document.documentElement.lang)
      : null;
  const lang = hasLangParam ? langFromSearch : documentLang || langFromSearch;
  const resolvedLang = lang || DEFAULT_LANG;

  useEffect(() => {
    if (typeof document !== "undefined" && document?.documentElement) {
      document.documentElement.lang = resolvedLang;
    }
  }, [resolvedLang]);

  const t = useMemo(() => {
    return (key) => translate(key, resolvedLang);
  }, [resolvedLang]);

  return { lang: resolvedLang, t };
}
