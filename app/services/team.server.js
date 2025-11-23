import { phaseTwoDisabled } from "./phase-two-disabled.server";

const disabled = () => phaseTwoDisabled("team management");

export async function listTeamMembers() {
  disabled();
}

export async function inviteTeamMember() {
  disabled();
}

export async function updateTeamMemberRole() {
  disabled();
}

export async function removeTeamMember() {
  disabled();
}

export async function findTeamMemberByEmail() {
  disabled();
}
