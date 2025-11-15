import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  recordOrderProcessing,
  recordPlanLimitError,
  recordReportScheduleExecution,
  resetMetricsLoggerForTests,
  setMetricsLoggerForTests,
} from '../app/services/metrics.server.js';

describe('metrics logging', () => {
  let logger;

  beforeEach(() => {
    logger = {
      info: mock.fn(() => {}),
      warn: mock.fn(() => {}),
      error: mock.fn(() => {}),
    };
    setMetricsLoggerForTests(logger);
  });

  afterEach(() => {
    resetMetricsLoggerForTests();
  });

  it('records successful order processing with timing metadata', () => {
    recordOrderProcessing({
      storeId: 'store-1',
      merchantId: 'merchant-1',
      shopifyOrderId: '1001',
      status: 'success',
      durationMs: 128.7,
      channel: 'online',
      totals: { revenue: 420, netProfit: 180, grossProfit: 250, refundCount: 1 },
    });

    assert.equal(logger.info.mock.callCount(), 1);
    const [message, meta] = logger.info.mock.calls[0].arguments;
    assert.equal(message, 'order.processed');
    assert.equal(meta.storeId, 'store-1');
    assert.equal(meta.merchantId, 'merchant-1');
    assert.equal(meta.orderId, '1001');
    assert.equal(meta.status, 'success');
    assert.equal(meta.durationMs, 129);
    assert.equal(meta.channel, 'online');
    assert.equal(meta.revenue, 420);
    assert.equal(meta.netProfit, 180);
    assert.equal(meta.grossProfit, 250);
    assert.equal(meta.refundCount, 1);
  });

  it('records failed order processing with serialized error details', () => {
    const failure = new Error('capacity exceeded');
    recordOrderProcessing({
      storeId: 'store-2',
      merchantId: 'merchant-2',
      shopifyOrderId: '1002',
      status: 'failure',
      durationMs: -5,
      channel: 'pos',
      error: failure,
    });

    assert.equal(logger.error.mock.callCount(), 1);
    const [message, meta] = logger.error.mock.calls[0].arguments;
    assert.equal(message, 'order.processed');
    assert.equal(meta.durationMs, 0);
    assert.equal(meta.status, 'failure');
    assert.equal(meta.channel, 'pos');
    assert.equal(meta.error.message, 'capacity exceeded');
    assert.equal(meta.error.name, 'Error');
  });

  it('records plan limit exceedance events as warnings', () => {
    recordPlanLimitError({
      merchantId: 'merchant-3',
      storeId: 'store-3',
      limit: 1000,
      usage: 1100,
      source: 'processShopifyOrder',
    });

    assert.equal(logger.warn.mock.callCount(), 1);
    const [message, meta] = logger.warn.mock.calls[0].arguments;
    assert.equal(message, 'plan.limit_exceeded');
    assert.equal(meta.limit, 1000);
    assert.equal(meta.usage, 1100);
    assert.equal(meta.source, 'processShopifyOrder');
  });

  it('records report schedule outcomes with severity derived from status', () => {
    recordReportScheduleExecution({
      scheduleId: 'schedule-1',
      merchantId: 'merchant-4',
      storeId: 'store-4',
      channel: 'EMAIL',
      status: 'success',
      durationMs: 501.2,
    });
    assert.equal(logger.info.mock.callCount(), 1);

    recordReportScheduleExecution({
      scheduleId: 'schedule-2',
      merchantId: 'merchant-5',
      channel: 'WEBHOOK',
      status: 'delivery_failed',
      durationMs: 42,
    });
    assert.equal(logger.warn.mock.callCount(), 1);

    recordReportScheduleExecution({
      scheduleId: 'schedule-3',
      merchantId: 'merchant-6',
      status: 'error',
      durationMs: 33,
      error: new Error('digest run failed'),
    });
    assert.equal(logger.error.mock.callCount(), 1);
    const [message, meta] = logger.error.mock.calls[0].arguments;
    assert.equal(message, 'report_schedule.run');
    assert.equal(meta.status, 'error');
    assert.equal(meta.error.message, 'digest run failed');
  });
});
