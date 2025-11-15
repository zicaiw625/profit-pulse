import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ReportFrequency } from '@prisma/client';

import {
  runScheduledReports,
  setReportScheduleRunnerDependenciesForTests,
  resetReportScheduleRunnerDependenciesForTests,
} from '../app/services/report-schedules-runner.server.js';

const baseOverview = {
  rangeLabel: 'Last 30 days',
  currency: 'USD',
  summaryCards: [
    { key: 'netRevenue', label: 'Net revenue', value: 1000 },
    { key: 'adSpend', label: 'Ad spend', value: 200 },
    { key: 'netProfit', label: 'Net profit', value: 300 },
    { key: 'profitOnAdSpend', label: 'POAS', value: 1.5 },
  ],
  topProducts: [],
  timeseries: {},
};

describe('runScheduledReports', () => {
  afterEach(() => {
    resetReportScheduleRunnerDependenciesForTests();
  });

  it('executes due webhook schedules and advances next run by a calendar month', async () => {
    const now = new Date('2024-03-01T00:00:01.000Z');

    const schedule = {
      id: 'schedule-monthly',
      merchantId: 'merchant-1',
      frequency: ReportFrequency.MONTHLY,
      isActive: true,
      nextRunAt: new Date('2024-03-01T00:00:00.000Z'),
      channel: 'WEBHOOK',
      settings: { webhookUrl: 'https://hooks.slack.com/services/example' },
      recipients: '',
    };

    const store = {
      id: 'store-1',
      merchantId: 'merchant-1',
      shopDomain: 'brand.myshopify.com',
    };

    const findFirstMock = mock.fn(async () => store);
    const updateMock = mock.fn(async () => ({}));
    const notifyMock = mock.fn(async () => true);

    const loggerMock = {
      warn: mock.fn(),
      error: mock.fn(),
    };
    const metricsMock = mock.fn();

    setReportScheduleRunnerDependenciesForTests({
      listReportSchedules: async () => [schedule],
      prisma: {
        store: { findFirst: findFirstMock },
        reportSchedule: { update: updateMock },
      },
      notifyWebhook: notifyMock,
      sendSlackNotification: async () => false,
      sendDigestEmail: async () => true,
      getReportingOverview: async () => baseOverview,
      evaluatePerformanceAlerts: async () => {},
      logger: loggerMock,
      recordReportScheduleExecution: metricsMock,
    });

    await runScheduledReports({ now });

    assert.equal(findFirstMock.mock.callCount(), 1);
    assert.equal(notifyMock.mock.callCount(), 1);
    assert.equal(updateMock.mock.callCount(), 1);

    const [updateArgs] = updateMock.mock.calls[0].arguments;
    assert.equal(updateArgs.where.id, schedule.id);
    assert.equal(updateArgs.data.lastRunAt.toISOString(), now.toISOString());
    assert.equal(
      updateArgs.data.nextRunAt.toISOString(),
      new Date('2024-04-01T00:00:01.000Z').toISOString(),
    );

    const [notifyArgs] = notifyMock.mock.calls[0].arguments;
    assert.equal(notifyArgs.context, `report_schedule:${schedule.id}`);
    assert.equal(notifyArgs.merchantId, schedule.merchantId);

    assert.equal(loggerMock.warn.mock.callCount(), 0);
    assert.equal(loggerMock.error.mock.callCount(), 0);

    assert.equal(metricsMock.mock.callCount(), 1);
    const [metricsArgs] = metricsMock.mock.calls[0].arguments;
    assert.equal(metricsArgs.scheduleId, schedule.id);
    assert.equal(metricsArgs.status, 'success');
    assert.equal(metricsArgs.storeId, store.id);
  });

  it('logs a warning when a digest fails to dispatch', async () => {
    const now = new Date('2024-05-05T10:00:00.000Z');
    const schedule = {
      id: 'schedule-failed',
      merchantId: 'merchant-2',
      frequency: ReportFrequency.DAILY,
      isActive: true,
      nextRunAt: new Date('2024-05-05T09:00:00.000Z'),
      channel: 'WEBHOOK',
      settings: { webhookUrl: 'https://hooks.make.com/blocked' },
      recipients: '',
    };

    const findFirstMock = mock.fn(async () => ({
      id: 'store-2',
      merchantId: 'merchant-2',
      shopDomain: 'brand-2.myshopify.com',
    }));
    const updateMock = mock.fn(async () => ({}));
    const notifyMock = mock.fn(async () => false);

    const warnMock = mock.fn();
    const errorMock = mock.fn();
    const metricsMock = mock.fn();

    setReportScheduleRunnerDependenciesForTests({
      listReportSchedules: async () => [schedule],
      prisma: {
        store: { findFirst: findFirstMock },
        reportSchedule: { update: updateMock },
      },
      notifyWebhook: notifyMock,
      sendSlackNotification: async () => false,
      sendDigestEmail: async () => true,
      getReportingOverview: async () => baseOverview,
      evaluatePerformanceAlerts: async () => {},
      logger: { warn: warnMock, error: errorMock },
      recordReportScheduleExecution: metricsMock,
    });

    await runScheduledReports({ now });

    assert.equal(warnMock.mock.callCount(), 1);
    const [message, details] = warnMock.mock.calls[0].arguments;
    assert.equal(message, 'Scheduled digest delivery failed');
    assert.equal(details.scheduleId, schedule.id);

    assert.equal(notifyMock.mock.callCount(), 1);
    assert.equal(updateMock.mock.callCount(), 1);
    assert.equal(errorMock.mock.callCount(), 0);

    assert.equal(metricsMock.mock.callCount(), 1);
    const [metricsArgs] = metricsMock.mock.calls[0].arguments;
    assert.equal(metricsArgs.status, 'delivery_failed');
    assert.equal(metricsArgs.scheduleId, schedule.id);
  });

  it('skips inactive or not-yet-due schedules', async () => {
    const now = new Date('2024-06-10T12:00:00.000Z');

    const inactive = {
      id: 'schedule-inactive',
      merchantId: 'merchant-3',
      frequency: ReportFrequency.WEEKLY,
      isActive: false,
      nextRunAt: new Date('2024-06-01T00:00:00.000Z'),
      channel: 'EMAIL',
      recipients: 'ops@example.com',
    };

    const future = {
      id: 'schedule-future',
      merchantId: 'merchant-3',
      frequency: ReportFrequency.DAILY,
      isActive: true,
      nextRunAt: new Date('2024-06-11T12:00:00.000Z'),
      channel: 'EMAIL',
      recipients: 'ops@example.com',
    };

    const findFirstMock = mock.fn(async () => ({
      id: 'store-3',
      merchantId: 'merchant-3',
      shopDomain: 'brand-3.myshopify.com',
    }));
    const updateMock = mock.fn(async () => ({}));
    const notifyMock = mock.fn(async () => true);
    const emailMock = mock.fn(async () => true);
    const metricsMock = mock.fn();

    setReportScheduleRunnerDependenciesForTests({
      listReportSchedules: async () => [inactive, future],
      prisma: {
        store: { findFirst: findFirstMock },
        reportSchedule: { update: updateMock },
      },
      notifyWebhook: notifyMock,
      sendSlackNotification: async () => false,
      sendDigestEmail: emailMock,
      getReportingOverview: async () => baseOverview,
      evaluatePerformanceAlerts: async () => {},
      logger: { warn: mock.fn(), error: mock.fn() },
      recordReportScheduleExecution: metricsMock,
    });

    await runScheduledReports({ now });

    assert.equal(findFirstMock.mock.callCount(), 0);
    assert.equal(updateMock.mock.callCount(), 0);
    assert.equal(notifyMock.mock.callCount(), 0);
    assert.equal(emailMock.mock.callCount(), 0);
    assert.equal(metricsMock.mock.callCount(), 0);
  });
});
