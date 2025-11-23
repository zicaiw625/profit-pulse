import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("advanced fixed cost allocation");

export async function listFixedCosts() {
  disabled();
}

export async function createFixedCost() {
  disabled();
}

export async function deleteFixedCost() {
  disabled();
}

export async function getFixedCostTotal() {
  disabled();
}

export async function getFixedCostBreakdown() {
  disabled();
}
