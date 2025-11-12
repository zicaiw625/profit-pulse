import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ShopifyRequestEnhancer />
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/reports">Reports</s-link>
        <s-link href="/app/refunds">Refunds</s-link>
        <s-link href="/app/reconciliation">Reconciliation</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function ShopifyRequestEnhancer() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const host = searchParams.get("host");
    const shop = searchParams.get("shop");
    const idToken = searchParams.get("id_token");
    const embedded = searchParams.get("embedded");
    const sessionToken = searchParams.get("session");
    if (!host || !shop) {
      return undefined;
    }

    const originalFetch = window.fetch;

    window.fetch = (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url, window.location.origin);

      if (url.origin === window.location.origin && url.pathname.startsWith("/app")) {
        if (!url.searchParams.has("shop")) {
          url.searchParams.set("shop", shop);
        }
        if (!url.searchParams.has("host")) {
          url.searchParams.set("host", host);
        }
        if (idToken && !url.searchParams.has("id_token")) {
          url.searchParams.set("id_token", idToken);
        }
        if (embedded && !url.searchParams.has("embedded")) {
          url.searchParams.set("embedded", embedded);
        }
        if (sessionToken && !url.searchParams.has("session")) {
          url.searchParams.set("session", sessionToken);
        }
        const headers = new Headers(request.headers);
        if (idToken && !headers.has("authorization")) {
          headers.set("authorization", `Bearer ${idToken}`);
        }

        const patchedRequest = new Request(url.toString(), {
          method: request.method,
          headers,
          body: request.body,
          mode: request.mode,
          credentials: request.credentials,
          cache: request.cache,
          redirect: request.redirect,
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy,
          integrity: request.integrity,
          keepalive: request.keepalive,
          signal: request.signal,
        });

        return originalFetch(patchedRequest);
      }

      const patchedRequest = new Request(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        mode: request.mode,
        credentials: request.credentials,
        cache: request.cache,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        integrity: request.integrity,
        keepalive: request.keepalive,
        signal: request.signal,
      });

      return originalFetch(patchedRequest);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
