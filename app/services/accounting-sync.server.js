import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("accounting provider sync");

export async function syncAccountingProvider() {
  disabled();
}
