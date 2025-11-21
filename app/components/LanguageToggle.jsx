import { useLocation, useNavigate } from "react-router";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";
import { useLocale } from "../hooks/useLocale";
import { TRANSLATION_KEYS } from "../constants/translations";

function buildLangHref({ pathname, search, hash, buildAppUrl, targetLang }) {
  const url = new URL(`${pathname}${search || ""}${hash || ""}`, "https://app.internal");
  url.searchParams.set("lang", targetLang);
  const nextSearch = url.searchParams.toString();
  return buildAppUrl(`${url.pathname}?${nextSearch}${url.hash || ""}`);
}

export function LanguageToggle() {
  const { lang, t } = useLocale();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const buildAppUrl = useAppUrlBuilder();

  const handleClick = (targetLang) => (event) => {
    event.preventDefault();
    navigate(buildLangHref({ pathname, search, hash, buildAppUrl, targetLang }));
  };

  const englishHref = buildLangHref({ pathname, search, hash, buildAppUrl, targetLang: "en" });
  const chineseHref = buildLangHref({ pathname, search, hash, buildAppUrl, targetLang: "zh" });

  const targetLang = lang === "zh" ? "en" : "zh";
  const targetHref = targetLang === "zh" ? chineseHref : englishHref;
  const targetLabel = targetLang === "zh" ? "中文" : "English";

  return (
    <s-button
      variant="secondary"
      size="slim"
      href={targetHref}
      onClick={handleClick(targetLang)}
      aria-label={`${t(TRANSLATION_KEYS.REPORTS_LANG_LABEL)}: ${targetLabel}`}
    >
      {targetLabel}
    </s-button>
  );
}
