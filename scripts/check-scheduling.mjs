import {
  availabilityValidationMessage,
  firstBookableStart,
  initialCalendarWeek,
  isUpcomingSlot,
  manilaInstant,
} from "../src/scheduling.ts";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const fridayAfternoon = new Date("2026-08-07T08:00:00Z");
const firstAfterFriday = firstBookableStart(fridayAfternoon);
assert(
  firstAfterFriday.toISOString() === "2026-08-07T08:30:00.000Z",
  `A same-day future slot was not allowed: ${firstAfterFriday.toISOString()}`,
);
assert(
  initialCalendarWeek(fridayAfternoon) === "2026-08-03",
  "The initial calendar week did not stay on the current week.",
);

const fridayEndOfDay = new Date("2026-08-07T09:00:00Z");
assert(
  firstBookableStart(fridayEndOfDay).toISOString() === "2026-08-10T00:00:00.000Z",
  "The calendar did not advance to Monday after weekday hours ended.",
);

const saturday = manilaInstant("2026-08-08", 8 * 60);
const saturdayEnd = new Date(saturday.getTime() + 30 * 60_000);
assert(
  availabilityValidationMessage(
    saturday,
    saturdayEnd,
    [],
    new Date("2026-08-05T00:00:00Z"),
  ).includes("Monday to Friday"),
  "The weekend rule did not reject Saturday.",
);

const monday = manilaInstant("2026-08-10", 8 * 60);
const mondayEnd = new Date(monday.getTime() + 30 * 60_000);
assert(
  availabilityValidationMessage(
    monday,
    mondayEnd,
    [{ starts_at: monday.toISOString(), ends_at: mondayEnd.toISOString() }],
    new Date("2026-08-05T00:00:00Z"),
  ).includes("overlaps"),
  "The overlap rule did not reject an existing slot.",
);

const shortConsultationEnd = new Date(monday.getTime() + 15 * 60_000);
assert(
  availabilityValidationMessage(
    monday,
    shortConsultationEnd,
    [],
    new Date("2026-08-05T00:00:00Z"),
  ) === "",
  "A valid 15-minute consultation was rejected.",
);

assert(
  availabilityValidationMessage(
    fridayAfternoon,
    new Date(fridayAfternoon.getTime() + 30 * 60_000),
    [],
    new Date("2026-08-07T07:45:00Z"),
  ) === "",
  "A valid near-term future consultation was rejected.",
);
assert(
  availabilityValidationMessage(
    fridayAfternoon,
    new Date(fridayAfternoon.getTime() + 30 * 60_000),
    [],
    fridayAfternoon,
  ).includes("future"),
  "A consultation at the current time was not rejected.",
);

const extendedConsultationEnd = new Date(monday.getTime() + 120 * 60_000);
assert(
  availabilityValidationMessage(
    monday,
    extendedConsultationEnd,
    [],
    new Date("2026-08-05T00:00:00Z"),
  ) === "",
  "A valid two-hour consultation was rejected.",
);

const lateStart = manilaInstant("2026-08-10", 16 * 60);
const lateExtendedEnd = new Date(lateStart.getTime() + 120 * 60_000);
assert(
  availabilityValidationMessage(
    lateStart,
    lateExtendedEnd,
    [],
    new Date("2026-08-05T00:00:00Z"),
  ).includes("8:00 AM–5:00 PM"),
  "A long consultation extending past office hours was accepted.",
);

const currentTime = new Date("2026-08-09T04:00:00Z");
assert(
  !isUpcomingSlot({ ends_at: "2026-08-08T09:00:00Z" }, currentTime),
  "An expired availability entry was treated as upcoming.",
);
assert(
  isUpcomingSlot({ ends_at: "2026-08-10T09:00:00Z" }, currentTime),
  "A future availability entry was incorrectly hidden.",
);

console.log("Scheduling checks passed: Friday rolls to Monday; flexible durations, weekends, office hours, overlaps, and expired slots are handled.");
