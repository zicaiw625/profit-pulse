import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAllowedWebhookUrl,
  notifyWebhook,
  setNotificationAuditLoggerForTests,
} from '../app/services/notifications.server.js';

describe('isAllowedWebhookUrl', () => {
  it('allows known webhook providers over https', () => {
    assert.equal(
      isAllowedWebhookUrl('https://hooks.slack.com/services/T000/B000/XXXX'),
      true,
    );
    assert.equal(
      isAllowedWebhookUrl('https://hooks.zapier.com/hooks/catch/123/abc'),
      true,
    );
    assert.equal(
      isAllowedWebhookUrl('https://subdomain.office.com/webhook'),
      true,
    );
  });

  it('rejects insecure protocols and unknown hosts', () => {
    assert.equal(isAllowedWebhookUrl('http://hooks.slack.com/services/foo'), false);
    assert.equal(isAllowedWebhookUrl('https://example.com/webhook'), false);
    assert.equal(isAllowedWebhookUrl('not-a-url'), false);
  });
});

describe('notifyWebhook', () => {
  let originalFetch;
  let auditMock;
  let warnMock;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    auditMock = mock.fn(async () => {});
    setNotificationAuditLoggerForTests(auditMock);
    warnMock = mock.method(console, 'warn', () => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setNotificationAuditLoggerForTests();
    warnMock.mock.restore();
  });

  it('sends to allowed hosts and returns success', async () => {
    const fetchMock = mock.fn(async () => ({ ok: true }));
    globalThis.fetch = fetchMock;

    const ok = await notifyWebhook({
      url: 'https://hooks.slack.com/services/T000/B000/XXXX',
      payload: { hello: 'world' },
      merchantId: 'merchant-123',
      context: 'report_schedule:abc',
    });

    assert.equal(ok, true);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  it('blocks disallowed destinations and logs an audit event', async () => {
    const fetchMock = mock.fn(async () => ({ ok: true }));
    globalThis.fetch = fetchMock;

    const ok = await notifyWebhook({
      url: 'https://example.com/whatever',
      payload: { hello: 'world' },
      merchantId: 'merchant-456',
      context: 'report_schedule:def',
    });

    assert.equal(ok, false);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(auditMock.mock.callCount(), 1);
    const [auditArgs] = auditMock.mock.calls[0].arguments;
    assert.equal(auditArgs.merchantId, 'merchant-456');
    assert.equal(auditArgs.action, 'notification.webhook_blocked');
    assert.ok(auditArgs.details.includes('https://example.com/whatever'));
  });
});
