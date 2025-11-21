import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import { generateCspNonce } from "./utils/csp-nonce.server";
import { DEFAULT_LANG, SUPPORTED_LANGS, useLocale } from "./hooks/useLocale";

function resolveInitialLang(request) {
  const url = new URL(request.url);
  const langParam = (url.searchParams.get("lang") || "").toLowerCase();
  if (SUPPORTED_LANGS.includes(langParam)) {
    return langParam;
  }

  const acceptLanguage = request.headers.get("accept-language")?.toLowerCase() ?? "";
  const primary = acceptLanguage.split(",")[0]?.trim() ?? "";
  if (primary.startsWith("zh")) return "zh";
  if (primary.startsWith("en")) return "en";

  return DEFAULT_LANG;
}

export const loader = ({ request }) => {
  return {
    cspNonce: generateCspNonce(),
    initialLang: resolveInitialLang(request),
  };
};

export default function App() {
  const { cspNonce, initialLang } = useLoaderData();
  const { lang } = useLocale(initialLang);

  return (
    <html lang={lang || DEFAULT_LANG}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />

        <script
          nonce={cspNonce}
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
        ></script>
        <script
          nonce={cspNonce}
          src="https://cdn.shopify.com/shopifycloud/polaris.js"
        ></script>

        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration nonce={cspNonce} />
        <Scripts nonce={cspNonce} />
      </body>
    </html>
  );
}
