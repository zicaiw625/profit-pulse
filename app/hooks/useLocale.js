import { useEffect, useMemo } from "react";
import { useSearchParams, useRouteLoaderData } from "react-router";
import {
  DEFAULT_LANG,
  getLanguageFromSearchParams,
  normalizeLanguage,
  translate,
} from "../utils/i18n";

export function useLocale() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rootData = useRouteLoaderData("root");
  const rootLang =
    rootData?.lang ? normalizeLanguage(rootData.lang) : null;

  const hasLangParam = searchParams.has("lang");
  const langFromSearch = getLanguageFromSearchParams(searchParams);
  const documentLang =
    typeof document !== "undefined" && document?.documentElement?.lang
      ? normalizeLanguage(document.documentElement.lang)
      : null;
  const lang =
    hasLangParam
      ? langFromSearch
      : documentLang || rootLang || langFromSearch;
  const resolvedLang = lang || DEFAULT_LANG;

  useEffect(() => {
    const currentLangNormalized = normalizeLanguage(searchParams.get("lang"));
    if (currentLangNormalized !== resolvedLang) {
      const next = new URLSearchParams(searchParams);
      next.set("lang", resolvedLang);
      setSearchParams(next, { replace: true });
    }
  }, [resolvedLang, searchParams, setSearchParams]);

  useEffect(() => {
    if (typeof document !== "undefined" && document?.documentElement) {
      document.documentElement.lang = resolvedLang;
      const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const sameSite =
        typeof window !== "undefined" && window?.location?.protocol === "https:"
          ? "None"
          : "Lax";
      const secureFlag = sameSite === "None" ? "; Secure" : "";
      document.cookie = `lang=${resolvedLang}; path=/; SameSite=${sameSite}${secureFlag}; expires=${expires.toUTCString()}`;
    }
  }, [resolvedLang]);

  const t = useMemo(() => {
    return (key) => translate(key, resolvedLang);
  }, [resolvedLang]);

  return { lang: resolvedLang, t };
}
