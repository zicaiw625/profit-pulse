import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { fetchMetaAdMetrics } from "../app/services/connectors/meta-ads.server.js";
import { fetchLatestRates } from "../app/services/external/fx-provider.server.js";
import { ExternalServiceError } from "../app/errors/external-service-error.js";

test("fetchMetaAdMetrics surfaces ExternalServiceError on upstream failure", async (t) => {
  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: false,
    status: 502,
    text: async () => "Bad gateway",
  }));
  t.after(() => fetchMock.mock.restore());

  await assert.rejects(
    () =>
      fetchMetaAdMetrics({
        accountId: "act_123456",
        secret: { accessToken: "token" },
        days: 3,
      }),
    (error) =>
      error instanceof ExternalServiceError &&
      error.service === "meta-ads" &&
      error.status === 502,
  );
});

test("fetchLatestRates falls back when FX provider errors", async (t) => {
  const fetchMock = mock.method(global, "fetch", async () => ({
    ok: false,
    status: 500,
    text: async () => "FX outage",
  }));
  t.after(() => fetchMock.mock.restore());

  const result = await fetchLatestRates("USD");
  assert.equal(result.source, "Fallback");
  assert.ok(result.rates);
  assert.equal(result.rates.USD, 1);
});

