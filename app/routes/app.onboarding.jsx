import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { TRANSLATION_KEYS } from "../constants/translations";
import { useLocale } from "../hooks/useLocale";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const STEP_KEYS = [
  TRANSLATION_KEYS.STEP_CONNECT_STORE,
  TRANSLATION_KEYS.STEP_IMPORT_COSTS,
  TRANSLATION_KEYS.STEP_LINK_ADS,
  TRANSLATION_KEYS.STEP_SETUP_ALERTS,
];

export default function OnboardingPage() {
  const { lang, t } = useLocale();
  return (
    <s-page heading={t(TRANSLATION_KEYS.ONBOARDING_TITLE)}>
      <s-section>
        <s-text variation="subdued">
          {t(TRANSLATION_KEYS.ONBOARDING_DESC)}
        </s-text>
        <s-stack direction="block" gap="base" style={{ marginTop: "1rem" }}>
          {STEP_KEYS.map((key) => (
            <s-card key={key} padding="base" tone="primary">
              <s-text>{t(key)}</s-text>
            </s-card>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
