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

  const targetLang = lang === "zh" ? "en" : "zh";
  const targetLabel = targetLang === "zh" ? "中文" : "English";
  const buttonStyle = {
    border: "1px solid var(--p-border, #c9ccd1)",
    background: "var(--p-surface, #fff)",
    color: "inherit",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 14,
    cursor: "pointer",
    height: 28,
    lineHeight: "20px",
  };

  return (
    <button
      type="button"
      style={buttonStyle}
      onClick={handleClick(targetLang)}
      aria-label={`${t(TRANSLATION_KEYS.REPORTS_LANG_LABEL)}: ${targetLabel}`}
    >
      {targetLabel}
    </button>
  );
}
