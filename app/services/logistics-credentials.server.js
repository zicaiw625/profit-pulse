import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("logistics integrations");

export function parseLogisticsCredentialSecret() {
  disabled();
}

export async function listLogisticsCredentials() {
  disabled();
}

export async function upsertLogisticsCredential() {
  disabled();
}

export async function deleteLogisticsCredential() {
  disabled();
}
