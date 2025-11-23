import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("merchant performance analytics");

export async function getMerchantPerformanceSummary() {
  disabled();
}
