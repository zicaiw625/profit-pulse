// Defensive ceiling for user-supplied report formulas to keep expressions short and
// reduce the blast radius of malformed payloads. Avoid raising this without also
// revisiting the sanitizer in report-formulas.server.js.
export const MAX_FORMULA_LENGTH = 512;
