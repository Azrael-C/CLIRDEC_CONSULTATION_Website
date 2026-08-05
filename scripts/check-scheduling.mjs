import {
  availabilityValidationMessage,
  firstBookableStart,
  initialCalendarWeek,
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

console.log("Scheduling checks passed: Friday rolls to Monday; weekends and overlaps are blocked.");
