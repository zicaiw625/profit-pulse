import { createScopedLogger } from "../utils/logger.server.js";

const defaultLogger = createScopedLogger({ service: "report-formulas" });
let formulaLogger = defaultLogger;

export function setReportFormulaLoggerForTests(logger) {
  formulaLogger = logger ?? defaultLogger;
}

/**
 * evaluateFormulaExpression intentionally supports only a minimal arithmetic grammar:
 * addition, subtraction, multiplication, division, parentheses, and identifiers that
 * match `/[A-Za-z_][A-Za-z0-9_]*`. Do not expand this sanitizer to admit broader
 * JavaScript syntax (function calls, array literals, template strings, etc.).
 * If business requirements evolve beyond simple formulas, replace this module with a
 * dedicated expression parser/evaluator that performs full tokenization and AST checks
 * instead of relying on `Function`.
 */
export function evaluateFormulaExpression(expression, values = {}) {
  if (typeof expression !== "string") {
    return null;
  }

  const sanitized = expression.replace(/[^0-9a-zA-Z_+\-*/().\s]/g, "");
  if (!sanitized.trim()) {
    return null;
  }

  const substituted = sanitized.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    if (Object.prototype.hasOwnProperty.call(values, token)) {
      const numeric = Number(values[token] ?? 0);
      return Number.isFinite(numeric) ? String(numeric) : "0";
    }
    return "0";
  });

  try {
    const result = Function(`"use strict"; return (${substituted});`)();
    return Number.isFinite(result) ? Number(result) : null;
  } catch (error) {
    formulaLogger?.error?.("report_formulas.compute_failed", {
      expression: sanitized,
      substituted,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// NOTE: This parser intentionally supports only a restricted subset of arithmetic expressions
// (`+`, `-`, `*`, `/`, parentheses, identifiers, and numeric literals). Do not extend the allowed
// character set or introduce additional JavaScript syntax here without replacing the evaluator,
// otherwise the `Function` call above could become a code execution vector.
