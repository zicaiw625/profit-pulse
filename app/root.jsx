import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import { generateCspNonce } from "./utils/csp-nonce.server";
import { getLanguageFromRequest } from "./utils/i18n";

export const loader = ({ request }) => {
  const lang = getLanguageFromRequest(request);
  return { cspNonce: generateCspNonce(), lang };
};

export default function App() {
  const { cspNonce, lang } = useLoaderData();

  return (
    <html lang={lang || "en"}>
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
