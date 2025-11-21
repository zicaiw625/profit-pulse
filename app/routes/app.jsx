import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { HttpResponseError } from "@shopify/shopify-api";
import { authenticate } from "../shopify.server";
import { LinkWithQuery } from "../components/LinkWithQuery";
import { ShopifyFetchProvider } from "../components/ShopifyFetchProvider";
import { useLocale } from "../hooks/useLocale";
import { TRANSLATION_KEYS } from "../constants/translations";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";
import { LanguageToggle } from "../components/LanguageToggle";

const appLogger = createScopedLogger({ route: "app.loader" });

// 让所有 /app/* 子路由在进入时完成 Admin 侧认证
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Pre-warm the Admin offline session to avoid transient 401s on the first client request.
  try {
    await admin.graphql(`{ shop { name } }`);
  } catch (error) {
    // If Shopify needs us to restart authentication it will throw a Response
    // object. Re-throw it so the platform can handle the redirect correctly.
    if (error instanceof Response) {
      throw error;
    }

    if (error instanceof HttpResponseError && error.response?.code === 401) {
      throw new Response(
        JSON.stringify(error.response.body ?? {}),
        {
          status: error.response.code,
          headers: {
            "Content-Type":
              error.response.headers?.["Content-Type"] ?? "application/json",
          },
        },
      );
    }

    appLogger.warn("admin_prewarm_failed", { error: serializeError(error) });
  }
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const { t } = useLocale();
  const navStyle = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    background: "var(--p-surface, #ffffff)",
    borderBottom: "1px solid #e3e8ee",
    position: "sticky",
    top: 0,
    zIndex: 20,
  };
  const linkStyle = {
    textDecoration: "none",
    color: "inherit",
    fontWeight: 600,
  };

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ShopifyFetchProvider>
        <div role="navigation" style={navStyle}>
          <LinkWithQuery to="/app" style={linkStyle}>
            {t(TRANSLATION_KEYS.NAV_OVERVIEW)}
          </LinkWithQuery>
          <LinkWithQuery to="/app/orders" style={linkStyle}>
            {t(TRANSLATION_KEYS.NAV_ORDERS)}
          </LinkWithQuery>
          <LinkWithQuery to="/app/products" style={linkStyle}>
            {t(TRANSLATION_KEYS.NAV_PRODUCTS)}
          </LinkWithQuery>
          <LinkWithQuery to="/app/reconciliation" style={linkStyle}>
            {t(TRANSLATION_KEYS.NAV_RECONCILIATION)}
          </LinkWithQuery>
          <LinkWithQuery to="/app/settings" style={linkStyle}>
            {t(TRANSLATION_KEYS.NAV_SETTINGS)}
          </LinkWithQuery>
          <LinkWithQuery to="/app/help" style={linkStyle}>
            {t(TRANSLATION_KEYS.NAV_HELP)}
          </LinkWithQuery>
          <div style={{ marginLeft: "auto" }}>
            <LanguageToggle />
          </div>
        </div>
        <Outlet />
      </ShopifyFetchProvider>
    </AppProvider>
  );
}

// 让 React Router 捕获并透传 Shopify 需要的 headers（授权跳转等）
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
