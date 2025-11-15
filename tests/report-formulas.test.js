import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateFormulaExpression,
  setReportFormulaLoggerForTests,
} from '../app/services/report-formulas.server.js';

describe('evaluateFormulaExpression', () => {
  let loggerMock;

  beforeEach(() => {
    loggerMock = {
      info: mock.fn(() => {}),
      warn: mock.fn(() => {}),
      error: mock.fn(() => {}),
    };
    setReportFormulaLoggerForTests(loggerMock);
  });

  afterEach(() => {
    setReportFormulaLoggerForTests();
  });

  it('computes arithmetic expressions using provided metric values', () => {
    const result = evaluateFormulaExpression('netProfit + adSpend - cogs', {
      netProfit: 125.5,
      adSpend: 40,
      cogs: 10.5,
    });

    assert.equal(result, 155);
  });

  it('treats missing identifiers as zero and returns null for empty expressions', () => {
    const missing = evaluateFormulaExpression('netProfit + unknownMetric', {
      netProfit: 200,
    });
    assert.equal(missing, 200);

    const empty = evaluateFormulaExpression('   ', { netProfit: 10 });
    assert.equal(empty, null);
  });

  it('returns null for non-finite results such as division by zero', () => {
    const result = evaluateFormulaExpression('netProfit / adSpend', {
      netProfit: 100,
      adSpend: 0,
    });

    assert.equal(result, null);
  });

  it('sanitizes potentially dangerous tokens and logs failures instead of executing them', () => {
    const result = evaluateFormulaExpression('netProfit + globalThis.process.exit()', {
      netProfit: 50,
    });

    assert.equal(result, null);
    assert.equal(loggerMock.error.mock.callCount(), 1);

    const [logMessage, logMeta] = loggerMock.error.mock.calls[0].arguments;
    assert.equal(logMessage, 'report_formulas.compute_failed');
    assert.ok(logMeta.expression.includes('globalThis.process.exit'));
    assert.equal(/[A-Za-z]/.test(logMeta.substituted), false);
  });

  it('ignores non-string expressions', () => {
    const result = evaluateFormulaExpression(null, { netProfit: 1 });
    assert.equal(result, null);
  });
});
