import test from "node:test";
import assert from "node:assert/strict";

import {
  refreshExpiringAdCredentials,
  setCredentialServiceDependenciesForTests,
} from "../app/services/credentials.server.js";

test("refreshExpiringAdCredentials refreshes eligible credentials and logs failures", async (t) => {
  const previousConcurrency = process.env.CREDENTIAL_REFRESH_CONCURRENCY;
  process.env.CREDENTIAL_REFRESH_CONCURRENCY = "2";
  t.after(() => {
    setCredentialServiceDependenciesForTests();
    if (previousConcurrency === undefined) {
      delete process.env.CREDENTIAL_REFRESH_CONCURRENCY;
    } else {
      process.env.CREDENTIAL_REFRESH_CONCURRENCY = previousConcurrency;
    }
  });

  const capturedFindManyArgs = [];
  const fakeCredentials = [
    {
      id: "cred-1",
      provider: "GOOGLE_ADS",
      merchantId: "m-1",
      storeId: "s-1",
      expiresAt: new Date().toISOString(),
    },
    {
      id: "cred-2",
      provider: "META_ADS",
      merchantId: "m-1",
      storeId: "s-1",
      expiresAt: null,
    },
    {
      id: "cred-3",
      provider: "GOOGLE_ADS",
      merchantId: "m-2",
      storeId: "s-2",
      expiresAt: new Date(Date.now() - 1).toISOString(),
    },
  ];

  const fakePrisma = {
    adAccountCredential: {
      async findMany(args) {
        capturedFindManyArgs.push(args);
        return fakeCredentials;
      },
    },
  };

  const refreshCalls = [];
  const logs = [];
  const fakeLogger = {
    info() {},
    warn() {},
    error(message, meta) {
      logs.push({ message, meta });
    },
  };

  const fakeRefresher = async ({ credential }) => {
    refreshCalls.push(credential.id);
    if (credential.id === "cred-2") {
      throw new Error("boom");
    }
  };

  setCredentialServiceDependenciesForTests({
    prisma: fakePrisma,
    logger: fakeLogger,
    tokenRefresher: fakeRefresher,
  });

  const refreshed = await refreshExpiringAdCredentials({ marginMinutes: 30 });

  assert.equal(refreshed, 2);
  assert.deepEqual(refreshCalls, ["cred-1", "cred-2", "cred-3"]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].meta.context.credentialId, "cred-2");
  assert.ok(capturedFindManyArgs.length >= 1);
  assert.ok(capturedFindManyArgs[0].where.provider.in.includes("GOOGLE_ADS"));
  assert.ok(capturedFindManyArgs[0].where.provider.in.includes("META_ADS"));

});
