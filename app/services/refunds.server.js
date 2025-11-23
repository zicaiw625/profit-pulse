import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("refund analytics");

export async function getRefundAnalytics() {
  disabled();
}

export async function listRefundRecords() {
  disabled();
}
