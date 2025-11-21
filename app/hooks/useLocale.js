import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  DEFAULT_LANG,
  getLanguageFromSearchParams,
  getLanguageFromCookies,
  LANG_COOKIE_NAME,
  normalizeLanguage,
  translate,
} from "../utils/i18n";

export function useLocale() {
  const [searchParams] = useSearchParams();
  const hasLangParam = searchParams.has("lang");
  const langFromSearch = getLanguageFromSearchParams(searchParams);
  const langFromCookie =
    typeof document !== "undefined"
      ? getLanguageFromCookies(document.cookie)
      : null;
  const documentLang =
    typeof document !== "undefined" && document?.documentElement?.lang
      ? normalizeLanguage(document.documentElement.lang)
      : null;
  const lang = hasLangParam
    ? langFromSearch
    : documentLang || langFromCookie || langFromSearch;
  const resolvedLang = lang || DEFAULT_LANG;

  useEffect(() => {
    if (typeof document !== "undefined" && document?.documentElement) {
      document.documentElement.lang = resolvedLang;
      try {
        document.cookie = `${LANG_COOKIE_NAME}=${resolvedLang}; path=/; max-age=31536000; SameSite=Lax`;
      } catch (error) {
        // Ignore cookie write errors (e.g., in private mode)
      }
    }
  }, [resolvedLang]);

  const t = useMemo(() => {
    return (key) => translate(key, resolvedLang);
  }, [resolvedLang]);

  return { lang: resolvedLang, t };
}
