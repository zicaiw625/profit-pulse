import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getHelpContent } from "../constants/helpContent";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";
import { useLocale } from "../hooks/useLocale";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function HelpPage() {
  const buildAppUrl = useAppUrlBuilder();
  const { lang } = useLocale();
  const content = getHelpContent(lang);
  const copy = HELP_PAGE_COPY[lang] ?? HELP_PAGE_COPY.en;

  return (
    <s-page
      heading={copy.heading}
      subtitle={copy.subtitle}
    >
      <s-section heading={copy.onboardingHeading}>
        <s-unordered-list>
          {content.onboardingItems.map((item) => (
            <s-list-item key={item}>{item}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
      <s-section heading={copy.startHeading}>
        <s-text variation="subdued">
          {copy.startDescription}
        </s-text>
        <s-button variant="primary" href={buildAppUrl("/app/onboarding")}>
          {copy.startButton}
        </s-button>
      </s-section>

      <s-section heading={copy.metricsHeading}>
        <s-stack direction="block" gap="base">
          {content.metricDefinitions.map((entry) => (
            <s-card key={entry.title}>
              <s-heading level="4">{entry.title}</s-heading>
              <s-text variation="subdued">{entry.description}</s-text>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={copy.syncHeading}>
        <s-unordered-list>
          {content.syncItems.map((item) => (
            <s-list-item key={item}>{item}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading={copy.legalHeading}>
        <s-unordered-list>
          <s-list-item>
            <s-link href={buildAppUrl("/app/privacy")} target="_self">
              {copy.privacyLabel}
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href={buildAppUrl("/app/terms")} target="_self">
              {copy.termsLabel}
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading={copy.quickLinksHeading}>
        <s-stack direction="block" gap="base">
          {content.links.map((entry) => (
            <s-card key={entry.title}>
              <s-heading level="4">{entry.title}</s-heading>
              <s-text variation="subdued">
                {entry.description}
                {entry.link && (
                  <>
                    {" "}
                    <s-link href={buildAppUrl(entry.link.href)} tone="primary">
                      {entry.link.label}
                    </s-link>
                  </>
                )}
              </s-text>
            </s-card>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

const HELP_PAGE_COPY = {
  en: {
    heading: "Help center",
    subtitle: "Best practices, workflows, and definitions for Profit Pulse",
    onboardingHeading: "Onboarding checklist",
    startHeading: "Start onboarding",
    startDescription: "Use the guided walkthrough to finish connecting stores, ads, costs, and alerts.",
    startButton: "Open onboarding guide",
    metricsHeading: "Key metrics explained",
    syncHeading: "Data sources & sync cadence",
    legalHeading: "Legal & compliance",
    privacyLabel: "Privacy policy",
    termsLabel: "Terms of use",
    quickLinksHeading: "Quick links & resources",
  },
  zh: {
    heading: "帮助中心",
    subtitle: "Profit Pulse 的最佳实践、流程与定义",
    onboardingHeading: "Onboarding 清单",
    startHeading: "开始 Onboarding",
    startDescription: "通过向导完成店铺、广告、成本与提醒配置。",
    startButton: "打开 Onboarding 指南",
    metricsHeading: "关键指标释义",
    syncHeading: "数据来源与同步频率",
    legalHeading: "法律与合规",
    privacyLabel: "隐私政策",
    termsLabel: "使用条款",
    quickLinksHeading: "快速链接与资源",
  },
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
