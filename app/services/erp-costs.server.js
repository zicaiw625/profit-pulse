import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("ERP cost sync");

export async function syncErpCosts() {
  disabled();
}
