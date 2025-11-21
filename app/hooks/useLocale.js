import { useMemo } from "react";
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

  const t = useMemo(() => {
    return (key) => translate(key, lang);
  }, [lang]);

  return { lang: lang || DEFAULT_LANG, t };
}
