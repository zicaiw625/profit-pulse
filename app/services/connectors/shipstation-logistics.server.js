import { phaseTwoDisabled } from "../phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("logistics integrations (ShipStation)");

export async function fetchShipStationLogisticsRates() {
  disabled();
}
