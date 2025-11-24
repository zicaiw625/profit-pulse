import { MAX_FORMULA_LENGTH } from "../constants/formulas.js";
import { createScopedLogger } from "../utils/logger.server.js";

const defaultLogger = createScopedLogger({ service: "report-formulas" });
let formulaLogger = defaultLogger;
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;
const NUMERIC_LITERAL_PATTERN = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const NUMERIC_EXPRESSION_PATTERN = /^[-0-9+*/%.()\sEe]+$/;
// NOTE: Keep the allowed characters intentionally narrow (no quotes, ternaries,
// logical operators, or array/object literals). If the grammar needs to expand,
// replace this evaluator with a dedicated parser rather than widening the regex.
const VALID_CHAR_PATTERN = /^[-0-9A-Za-z_+*/%.()\s]+$/;

function toNumericLiteral(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  const literal = numeric.toString();
  return NUMERIC_LITERAL_PATTERN.test(literal) ? literal : "0";
}

export function setReportFormulaLoggerForTests(logger) {
  formulaLogger = logger ?? defaultLogger;
}

/**
 * evaluateFormulaExpression intentionally supports only a minimal arithmetic grammar:
 * addition, subtraction, multiplication, division, modulo, parentheses, whitespace, and
 * identifiers that match `/[A-Za-z_][A-Za-z0-9_]*`. Do not expand this sanitizer to
 * admit broader JavaScript syntax (function calls, array literals, template strings,
 * etc.). If future requirements need richer expressions, swap this implementation for
 * a dedicated parser/evaluator rather than relaxing the allowed character set or
 * continuing to execute arbitrary strings via `Function`.
 */
export function evaluateFormulaExpression(expression, values = {}) {
  if (typeof expression !== "string") {
    return null;
  }

  const trimmed = expression.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MAX_FORMULA_LENGTH) {
    formulaLogger?.warn?.("report_formulas.rejected", {
      reason: "length_exceeded",
      length: trimmed.length,
    });
    return null;
  }

  if (!VALID_CHAR_PATTERN.test(trimmed)) {
    formulaLogger?.warn?.("report_formulas.rejected", {
      reason: "invalid_characters",
    });
    return null;
  }

  const sanitized = trimmed;
  const substituted = sanitized.replace(IDENTIFIER_PATTERN, (token) => {
    if (Object.prototype.hasOwnProperty.call(values, token)) {
      return toNumericLiteral(values[token]);
    }
    return "0";
  });

  if (!NUMERIC_EXPRESSION_PATTERN.test(substituted)) {
    formulaLogger?.warn?.("report_formulas.rejected", {
      reason: "invalid_substitution",
    });
    return null;
  }

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
