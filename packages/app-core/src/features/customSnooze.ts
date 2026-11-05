import { localSnoozeDate } from "@t3tools/client-runtime/state/thread-settled";
import {
  CUSTOM_SNOOZE_UNIT_LABELS,
  type CustomSnoozeForm,
  type CustomSnoozeMode,
  type CustomSnoozeUnit,
  finishCustomSnooze,
  initialCustomSnoozeForm,
  resolveCustomSnoozeSubmission,
  useCustomSnoozeRequest,
} from "@t3tools/web/src/components/CustomSnoozeDialog.logic.ts";
import { weekStartsOn } from "@t3tools/web/src/timestampFormat.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";

type CalendarMonth = { readonly year: number; readonly month: number };

type CustomSnoozeState = {
  readonly requestKey: number;
  readonly form: CustomSnoozeForm;
  readonly error: string | null;
  readonly month: CalendarMonth;
};

export type CustomSnoozeCalendarDay = {
  readonly date: string;
  readonly day: number;
  readonly outside: boolean;
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly today: boolean;
};

export type CustomSnoozeView = {
  readonly requestKey: number;
  readonly mode: CustomSnoozeMode;
  readonly dateLabel: string;
  readonly time: string;
  readonly amount: string;
  readonly unit: CustomSnoozeUnit;
  readonly unitLabel: string;
  readonly units: ReadonlyArray<{ readonly value: CustomSnoozeUnit; readonly label: string }>;
  readonly error: string | null;
  readonly calendar: {
    readonly caption: string;
    readonly weekdays: ReadonlyArray<string>;
    readonly weeks: ReadonlyArray<ReadonlyArray<CustomSnoozeCalendarDay>>;
  };
};

const UpdateParams = Schema.decodeUnknownSync(
  Schema.Struct({
    mode: Schema.optional(Schema.Literals(["date", "duration"])),
    date: Schema.optional(Schema.String),
    time: Schema.optional(Schema.String),
    amount: Schema.optional(Schema.String),
    unit: Schema.optional(Schema.Literals(["minutes", "hours", "days"])),
  }),
);
const MonthParams = Schema.decodeUnknownSync(Schema.Struct({ delta: Schema.Number }));

const UNITS: ReadonlyArray<CustomSnoozeUnit> = ["minutes", "hours", "days"];
const CAPTION_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short" });

function parseLocalDate(value: string): Date {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthOf(value: string): CalendarMonth {
  const date = parseLocalDate(value);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function buildCalendar(month: CalendarMonth, selected: string): CustomSnoozeView["calendar"] {
  const firstWeekday = weekStartsOn ?? 0;
  const first = new Date(month.year, month.month, 1);
  const lead = (first.getDay() - firstWeekday + 7) % 7;
  const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);
  const today = localSnoozeDate(new Date());
  const weeks: Array<Array<CustomSnoozeCalendarDay>> = [];
  for (let week = 0; week < weekCount; week++) {
    const days: Array<CustomSnoozeCalendarDay> = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const date = new Date(month.year, month.month, 1 - lead + week * 7 + weekday);
      const key = localSnoozeDate(date);
      days.push({
        date: key,
        day: date.getDate(),
        outside: date.getMonth() !== month.month,
        disabled: key < today,
        selected: key === selected,
        today: key === today,
      });
    }
    weeks.push(days);
  }
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    WEEKDAY_FORMAT.format(new Date(2024, 0, 7 + ((firstWeekday + index) % 7))).slice(0, 2),
  );
  return { caption: CAPTION_FORMAT.format(first), weekdays, weeks };
}

export function createCustomSnoozeFeature(context: FeatureContext): CoreFeature {
  const { registry } = context;
  let requestKey = 0;
  const stateAtom = Atom.make<CustomSnoozeState | null>(null).pipe(Atom.keepAlive);
  useCustomSnoozeRequest.subscribe(({ request }) => {
    const current = registry.get(stateAtom);
    if (request === null) {
      if (current !== null) registry.set(stateAtom, null);
      return;
    }
    if (current !== null) return;
    const form = initialCustomSnoozeForm(new Date());
    requestKey += 1;
    registry.set(stateAtom, { requestKey, form, error: null, month: monthOf(form.date) });
  });

  const viewAtom = Atom.make((get): CustomSnoozeView | null => {
    const state = get(stateAtom);
    if (state === null) return null;
    const { form } = state;
    return {
      requestKey: state.requestKey,
      mode: form.mode,
      dateLabel: parseLocalDate(form.date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      time: form.time,
      amount: form.amount,
      unit: form.unit,
      unitLabel: CUSTOM_SNOOZE_UNIT_LABELS[form.unit],
      units: UNITS.map((value) => ({ value, label: CUSTOM_SNOOZE_UNIT_LABELS[value] })),
      error: state.error,
      calendar: buildCalendar(state.month, form.date),
    };
  });

  return {
    views: { customSnooze: viewAtom },
    actions: {
      customSnoozeUpdate: async (params) => {
        const update = UpdateParams(params);
        const state = registry.get(stateAtom);
        if (state === null) return null;
        const form: CustomSnoozeForm = {
          mode: update.mode ?? state.form.mode,
          date: update.date ?? state.form.date,
          time: update.time ?? state.form.time,
          amount: update.amount ?? state.form.amount,
          unit: update.unit ?? state.form.unit,
        };
        registry.set(stateAtom, {
          ...state,
          form,
          error: null,
          month: update.date === undefined ? state.month : monthOf(update.date),
        });
        return null;
      },
      customSnoozeCalendarMonth: async (params) => {
        const { delta } = MonthParams(params);
        const state = registry.get(stateAtom);
        if (state === null) return null;
        const shifted =
          delta === 0
            ? parseLocalDate(state.form.date)
            : new Date(state.month.year, state.month.month + delta, 1);
        registry.set(stateAtom, {
          ...state,
          month: { year: shifted.getFullYear(), month: shifted.getMonth() },
        });
        return null;
      },
      customSnoozeSubmit: async () => {
        const state = registry.get(stateAtom);
        if (state === null) return null;
        const submission = resolveCustomSnoozeSubmission(state.form, new Date());
        if (submission.kind === "error") {
          registry.set(stateAtom, { ...state, error: submission.message });
          return null;
        }
        finishCustomSnooze(submission.choice);
        return null;
      },
      customSnoozeCancel: async () => {
        finishCustomSnooze(null);
        return null;
      },
    },
  };
}
