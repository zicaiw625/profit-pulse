import test from "node:test";
import assert from "node:assert/strict";

import {
  checkNetProfitAlert,
  checkRefundSpikeAlert,
  setAlertsDependenciesForTests,
} from "../app/services/alerts.server.js";

const defaultStore = {
  id: "store-1",
  merchantId: "merchant-123",
  primaryTimezone: "UTC",
  shopDomain: "example.myshopify.com",
};

test("checkNetProfitAlert sends notification and updates store when negative", async () => {
  const notifications = [];
  const updates = [];
  setAlertsDependenciesForTests({
    prisma: {
      store: {
        update: async (args) => {
          updates.push(args);
          return args;
        },
      },
    },
    sendSlackNotification: async (payload) => {
      notifications.push(payload);
      return true;
    },
  });

  await checkNetProfitAlert({
    store: { ...defaultStore },
    netProfitAfterFixed: -25,
  });

  assert.strictEqual(notifications.length, 1, "should send one notification");
  assert.equal(notifications[0].merchantId, defaultStore.merchantId);
  assert.ok(
    notifications[0].text.includes("Net profit after fixed costs is negative"),
  );
  assert.strictEqual(updates.length, 1, "should update store");
  assert.deepEqual(updates[0].where, { id: defaultStore.id });
  assert.ok(updates[0].data.lastNetLossAlertAt instanceof Date);

  setAlertsDependenciesForTests();
});

test("checkNetProfitAlert skips when already alerted today", async () => {
  let sendCount = 0;
  let updateCount = 0;
  setAlertsDependenciesForTests({
    prisma: {
      store: {
        update: async () => {
          updateCount += 1;
        },
      },
    },
    sendSlackNotification: async () => {
      sendCount += 1;
      return true;
    },
  });

  const store = {
    ...defaultStore,
    lastNetLossAlertAt: new Date(),
  };

  await checkNetProfitAlert({ store, netProfitAfterFixed: -10 });

  assert.strictEqual(sendCount, 0, "should not send duplicate alert");
  assert.strictEqual(updateCount, 0, "should not update store");

  setAlertsDependenciesForTests();
});

test("checkRefundSpikeAlert requires thresholds and updates when sent", async () => {
  const notifications = [];
  const updates = [];
  setAlertsDependenciesForTests({
    prisma: {
      store: {
        update: async (args) => {
          updates.push(args);
        },
      },
    },
    sendSlackNotification: async (payload) => {
      notifications.push(payload);
      return true;
    },
  });

  await checkRefundSpikeAlert({
    store: { ...defaultStore },
    refundRate: 0.12,
    refundCount: 5,
    orderCount: 40,
  });

  assert.strictEqual(notifications.length, 1, "should send refund spike alert");
  assert.strictEqual(updates.length, 1, "should persist alert timestamp");
  assert.deepEqual(updates[0].where, { id: defaultStore.id });
  assert.ok(updates[0].data.lastRefundSpikeAlertAt instanceof Date);

  setAlertsDependenciesForTests();
});

test("checkRefundSpikeAlert skips when below thresholds", async () => {
  let sendCount = 0;
  setAlertsDependenciesForTests({
    prisma: {
      store: {
        update: async () => {
          throw new Error("should not update store");
        },
      },
    },
    sendSlackNotification: async () => {
      sendCount += 1;
      return true;
    },
  });

  await checkRefundSpikeAlert({
    store: { ...defaultStore },
    refundRate: 0.02,
    refundCount: 1,
    orderCount: 10,
  });

  assert.strictEqual(sendCount, 0, "should not send when thresholds unmet");

  setAlertsDependenciesForTests();
});
