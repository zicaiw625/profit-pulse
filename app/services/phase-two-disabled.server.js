// Shared guard to keep Phase 2 modules disabled in V1.
export function phaseTwoDisabled(featureName) {
  const prefix = "Phase 2 feature disabled";
  const message = featureName ? `${prefix}: ${featureName}` : prefix;
  const error = new Error(message);
  error.code = "PHASE_TWO_DISABLED";
  throw error;
}
