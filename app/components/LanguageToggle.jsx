import { useLocation, useNavigate } from "react-router";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";
import { useLocale } from "../hooks/useLocale";

function buildLangHref({ pathname, search, hash, buildAppUrl, targetLang }) {
  const url = new URL(`${pathname}${search || ""}${hash || ""}`, "https://app.internal");
  url.searchParams.set("lang", targetLang);
  const nextSearch = url.searchParams.toString();
  return buildAppUrl(`${url.pathname}?${nextSearch}${url.hash || ""}`);
}

export function LanguageToggle() {
  const { lang } = useLocale();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const buildAppUrl = useAppUrlBuilder();

  const handleClick = (targetLang) => (event) => {
    event.preventDefault();
    navigate(buildLangHref({ pathname, search, hash, buildAppUrl, targetLang }));
  };

  const englishHref = buildLangHref({ pathname, search, hash, buildAppUrl, targetLang: "en" });
  const chineseHref = buildLangHref({ pathname, search, hash, buildAppUrl, targetLang: "zh" });

  return (
    <s-stack direction="inline" gap="tight" align="center" wrap>
      <s-text variation="subdued" style={{ whiteSpace: "nowrap" }}>
        Language / 语言
      </s-text>
      <s-button-group>
        <s-button
          variant={lang === "en" ? "primary" : "secondary"}
          href={englishHref}
          onClick={handleClick("en")}
        >
          English
        </s-button>
        <s-button
          variant={lang === "zh" ? "primary" : "secondary"}
          href={chineseHref}
          onClick={handleClick("zh")}
        >
          中文
        </s-button>
      </s-button-group>
    </s-stack>
  );
}
