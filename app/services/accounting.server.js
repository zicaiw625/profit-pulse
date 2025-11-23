import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("accounting exports");

export async function getAccountingMonthlySummary() {
  disabled();
}

export async function getAccountingDetailRows() {
  disabled();
}
