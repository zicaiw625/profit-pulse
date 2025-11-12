import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  HELP_LINKS,
  HELP_METRIC_DEFINITIONS,
  HELP_ONBOARDING_ITEMS,
  HELP_SYNC_ITEMS,
} from "../constants/helpContent";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function HelpPage() {
  return (
    <s-page
      heading="Help center"
      subtitle="Best practices, workflows, and definitions for Profit Pulse"
    >
      <s-section heading="Onboarding checklist">
        <s-unordered-list>
          {HELP_ONBOARDING_ITEMS.map((item) => (
            <s-list-item key={item}>{item}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
      <s-section heading="Start onboarding">
        <s-text variation="subdued">
          Use the guided walkthrough to finish connecting stores, ads, costs, and alerts.
        </s-text>
        <s-button variant="primary" href="/app/onboarding">
          Open onboarding guide
        </s-button>
      </s-section>

      <s-section heading="Key metrics explained">
        <s-stack direction="block" gap="base">
          {HELP_METRIC_DEFINITIONS.map((entry) => (
            <s-card key={entry.title}>
              <s-heading level="4">{entry.title}</s-heading>
              <s-text variation="subdued">{entry.description}</s-text>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Data sources & sync cadence">
        <s-unordered-list>
          {HELP_SYNC_ITEMS.map((item) => (
            <s-list-item key={item}>{item}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading="法律与合规">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/privacy" target="_self">隐私政策</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/terms" target="_self">使用条款</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Quick links & resources">
        <s-stack direction="block" gap="base">
          {HELP_LINKS.map((entry) => (
            <s-card key={entry.title}>
              <s-heading level="4">{entry.title}</s-heading>
              <s-text variation="subdued">
                {entry.description}
                {entry.link && (
                  <>
                    {" "}
                    <s-link href={entry.link.href} tone="primary">
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

export const headers = (headersArgs) => boundary.headers(headersArgs);
