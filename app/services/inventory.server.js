import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("inventory sync and costing");

export async function syncInventoryAndCosts() {
  disabled();
}
