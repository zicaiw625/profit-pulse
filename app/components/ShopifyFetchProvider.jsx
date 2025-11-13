import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export function ShopifyFetchProvider({ children }) {
  const shopify = useAppBridge();

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.fetch !== "function" ||
      !shopify?.fetch
    ) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    const authenticatedFetch = shopify.fetch.bind(shopify);

    window.fetch = (...args) => authenticatedFetch(...args);

    return () => {
      window.fetch = originalFetch;
    };
  }, [shopify]);

  return children;
}
