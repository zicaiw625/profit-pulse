import { useMemo } from "react";
import { useRouteLoaderData, useSearchParams } from "react-router";
import { translate } from "../utils/i18n";

export const SUPPORTED_LANGS = ["en", "zh"];
export const DEFAULT_LANG = "en";

function resolvePreferredLang(langParam, fallbackLang = DEFAULT_LANG) {
  if (SUPPORTED_LANGS.includes(langParam)) {
    return langParam;
  }

  const documentLang =
    typeof document !== "undefined"
      ? document.documentElement.lang?.toLowerCase()
      : null;
  if (documentLang && SUPPORTED_LANGS.includes(documentLang)) {
    return documentLang;
  }

  const navigatorLang =
    typeof navigator !== "undefined"
      ? navigator.language?.toLowerCase()
      : null;
  if (navigatorLang?.startsWith("zh")) {
    return "zh";
  }
  if (navigatorLang?.startsWith("en")) {
    return "en";
  }

  return SUPPORTED_LANGS.includes(fallbackLang) ? fallbackLang : DEFAULT_LANG;
}

export function useLocale(defaultLang) {
  const rootData = useRouteLoaderData("root");
  const fallbackLang =
    SUPPORTED_LANGS.includes(defaultLang)
      ? defaultLang
      : SUPPORTED_LANGS.includes(rootData?.initialLang)
        ? rootData.initialLang
        : DEFAULT_LANG;
  const [searchParams] = useSearchParams();
  const langParam = (searchParams.get("lang") || "").toLowerCase();

  const lang = useMemo(
    () => resolvePreferredLang(langParam, fallbackLang),
    [langParam, fallbackLang],
  );

  const t = useMemo(() => {
    return (key) => translate(key, lang);
  }, [lang]);

  return { lang, t };
}
