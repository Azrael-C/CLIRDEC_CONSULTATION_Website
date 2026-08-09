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
  firstAfterFriday.toISOString() === "2026-08-10T00:00:00.000Z",
  `Friday rollover failed: ${firstAfterFriday.toISOString()}`,
);
assert(
  initialCalendarWeek(fridayAfternoon) === "2026-08-10",
  "The initial calendar week did not advance to Monday.",
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

const currentTime = new Date("2026-08-09T04:00:00Z");
assert(
  !isUpcomingSlot({ ends_at: "2026-08-08T09:00:00Z" }, currentTime),
  "An expired availability entry was treated as upcoming.",
);
assert(
  isUpcomingSlot({ ends_at: "2026-08-10T09:00:00Z" }, currentTime),
  "A future availability entry was incorrectly hidden.",
);

console.log("Scheduling checks passed: Friday rolls to Monday; weekends, overlaps, and expired slots are handled.");
