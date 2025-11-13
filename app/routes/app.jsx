import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { LinkWithQuery } from "../components/LinkWithQuery";
import { ShopifyFetchProvider } from "../components/ShopifyFetchProvider";

// 让所有 /app/* 子路由在进入时完成 Admin 侧认证
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Pre-warm the Admin offline session to avoid transient 401s on the first client request.
  try {
    await admin.graphql(`{ shop { name } }`);
  } catch (error) {
    console.debug("Admin session prewarm failed", error);
  }
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ShopifyFetchProvider>
        <s-app-nav>
          <LinkWithQuery to="/app">Dashboard</LinkWithQuery>
          <LinkWithQuery to="/app/reports">Reports</LinkWithQuery>
          <LinkWithQuery to="/app/refunds">Refunds</LinkWithQuery>
          <LinkWithQuery to="/app/reconciliation">Reconciliation</LinkWithQuery>
          <LinkWithQuery to="/app/settings">Settings</LinkWithQuery>
          <LinkWithQuery to="/app/help">Help</LinkWithQuery>
        </s-app-nav>
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
