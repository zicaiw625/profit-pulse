import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { translate } from "../utils/i18n";

const SUPPORTED_LANGS = ["en", "zh"];
const DEFAULT_LANG = "en";

export function useLocale() {
  const [searchParams] = useSearchParams();
  const langParam = (searchParams.get("lang") || "").toLowerCase();
  const lang = SUPPORTED_LANGS.includes(langParam) ? langParam : DEFAULT_LANG;

  const t = useMemo(() => {
    return (key) => translate(key, lang);
  }, [lang]);

  return { lang, t };
}
