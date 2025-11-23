import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("tax rate templates");

export async function listTaxRates() {
  disabled();
}

export async function importTaxRatesFromCsv() {
  disabled();
}
