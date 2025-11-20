import { useCallback, useMemo } from "react";
import { useLocation } from "react-router";

export const APP_PRESERVED_PARAMS = ["host", "shop", "lang", "id_token", "session", "embedded"];

export function useAppUrlBuilder() {
  const { search } = useLocation();

  const preservedEntries = useMemo(() => {
    const urlSearch = new URLSearchParams(search);
    const entries = [];

    APP_PRESERVED_PARAMS.forEach((key) => {
      const value = urlSearch.get(key);
      if (value) {
        entries.push([key, value]);
      }
    });

    return entries;
  }, [search]);

  return useCallback(
    (target) => {
      if (!target || preservedEntries.length === 0) {
        return target;
      }

      const url = new URL(target, "https://app.internal");
      const mergedSearch = new URLSearchParams(url.search);

      preservedEntries.forEach(([key, value]) => {
        if (!mergedSearch.has(key)) {
          mergedSearch.set(key, value);
        }
      });

      const nextSearch = mergedSearch.toString();
      return `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${
        url.hash || ""
      }`;
    },
    [preservedEntries],
  );
}
