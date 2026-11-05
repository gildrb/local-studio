export const DISCONNECTED_COMPOSER_PLACEHOLDER =
  "Ask for changes, send follow-ups, or attach images";

export function resolveComposerPlaceholder(input: {
  readonly approvalPending: boolean;
  readonly pendingQuestion: { readonly choiceOnly: boolean } | null;
  readonly planFollowUp: boolean;
  readonly projectSelectionRequired: boolean;
  readonly providerUnavailable: boolean;
  readonly disconnected: boolean;
}): string {
  if (input.approvalPending) return "Resolve this approval request to continue";
  if (input.pendingQuestion !== null) {
    return input.pendingQuestion.choiceOnly
      ? "Choose an option above"
      : "Type your own answer, or leave this blank to use the selected option";
  }
  if (input.planFollowUp) {
    return "Add feedback to refine the plan, or leave this blank to implement it";
  }
  if (input.projectSelectionRequired) return "Choose a project above to start a thread";
  if (input.providerUnavailable) return "Enable a provider in Settings to send a message";
  if (input.disconnected) return DISCONNECTED_COMPOSER_PLACEHOLDER;
  return "Ask anything, @tag files/folders, $use skills, or / for commands";
}
