import {
  localSnoozeDate,
  localSnoozeTime,
  resolveCustomSnooze,
  type CustomSnoozeInput,
} from "@t3tools/client-runtime/state/thread-settled";
import { create } from "zustand";

export type CustomSnoozeMode = CustomSnoozeInput["mode"];
export type CustomSnoozeUnit = "minutes" | "hours" | "days";

export interface CustomSnoozeChoice {
  readonly snoozedUntil: string;
}

interface CustomSnoozeRequest {
  readonly resolve: (choice: CustomSnoozeChoice | null) => void;
}

export const useCustomSnoozeRequest = create<{ request: CustomSnoozeRequest | null }>(() => ({
  request: null,
}));

/** Opens the custom snooze dialog; a newer request cancels the open one. */
export function requestCustomSnooze(): Promise<CustomSnoozeChoice | null> {
  useCustomSnoozeRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useCustomSnoozeRequest.setState({ request: { resolve } }));
}

export function finishCustomSnooze(choice: CustomSnoozeChoice | null): void {
  const request = useCustomSnoozeRequest.getState().request;
  useCustomSnoozeRequest.setState({ request: null });
  request?.resolve(choice);
}

export interface CustomSnoozeForm {
  readonly mode: CustomSnoozeMode;
  /** Local calendar day, YYYY-MM-DD. */
  readonly date: string;
  readonly time: string;
  readonly amount: string;
  readonly unit: CustomSnoozeUnit;
}

export const CUSTOM_SNOOZE_UNIT_LABELS: Readonly<Record<CustomSnoozeUnit, string>> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

/** The dialog opens one hour out, or two hours as a duration. */
export function initialCustomSnoozeForm(now: Date): CustomSnoozeForm {
  const initial = new Date(now.getTime() + 3_600_000);
  return {
    mode: "date",
    date: localSnoozeDate(initial),
    time: localSnoozeTime(initial),
    amount: "2",
    unit: "hours",
  };
}

export function customSnoozeInput(form: CustomSnoozeForm): CustomSnoozeInput {
  return form.mode === "date"
    ? { mode: "date", date: form.date, time: form.time }
    : { mode: "duration", amount: form.amount, unit: form.unit };
}

export type CustomSnoozeSubmission =
  | { readonly kind: "snooze"; readonly choice: CustomSnoozeChoice }
  | { readonly kind: "error"; readonly message: string };

export function resolveCustomSnoozeSubmission(
  form: CustomSnoozeForm,
  now: Date,
): CustomSnoozeSubmission {
  const snoozedUntil = resolveCustomSnooze(customSnoozeInput(form), now);
  if (!snoozedUntil) {
    return {
      kind: "error",
      message:
        form.mode === "date"
          ? "Choose a valid date and time in the future."
          : "Enter a positive duration.",
    };
  }
  return { kind: "snooze", choice: { snoozedUntil } };
}
