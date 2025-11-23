import { phaseTwoDisabled } from "./phase-two-disabled.server";

export const LOGISTICS_PROVIDERS = [
  { id: "EASYPOST_LOGISTICS", label: "EasyPost" },
  { id: "SHIPSTATION_LOGISTICS", label: "ShipStation" },
];

const disabled = () => phaseTwoDisabled("logistics integrations");

export async function syncLogisticsProvider() {
  disabled();
}

export async function describeLogisticsIntegrations() {
  disabled();
}
