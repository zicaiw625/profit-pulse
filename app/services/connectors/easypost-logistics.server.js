import { phaseTwoDisabled } from "../phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("logistics integrations (EasyPost)");

export async function fetchEasyPostLogisticsRates() {
  disabled();
}
