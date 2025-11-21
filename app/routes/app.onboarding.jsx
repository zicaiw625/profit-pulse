import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { translate } from "../utils/i18n";
import { TRANSLATION_KEYS } from "../constants/translations";

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
  const lang = detectLanguage();
  return (
    <s-page heading={translate(TRANSLATION_KEYS.ONBOARDING_TITLE, lang)}>
      <s-section>
        <s-text variation="subdued">
          {translate(TRANSLATION_KEYS.ONBOARDING_DESC, lang)}
        </s-text>
        <s-stack direction="block" gap="base" style={{ marginTop: "1rem" }}>
          {STEP_KEYS.map((key) => (
            <s-card key={key} padding="base" tone="primary">
              <s-text>{translate(key, lang)}</s-text>
            </s-card>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function detectLanguage() {
  if (typeof navigator !== "undefined" && navigator?.language) {
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  return "en";
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
