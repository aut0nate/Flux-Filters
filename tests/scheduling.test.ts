import { describe, expect, it } from "vitest";

import {
  formatZonedDate,
  getNextDailyRunDate,
  parseDailyScheduleTime
} from "../src/server/scheduling";

describe("daily scheduling helpers", () => {
  it("parses a 24-hour daily schedule time", () => {
    expect(parseDailyScheduleTime("07:00")).toEqual({
      hour: 7,
      minute: 0,
      label: "07:00"
    });
  });

  it("rejects invalid daily schedule times", () => {
    expect(parseDailyScheduleTime("7am")).toBeNull();
    expect(parseDailyScheduleTime("24:00")).toBeNull();
  });

  it("schedules later today when the configured local time has not passed", () => {
    const schedule = parseDailyScheduleTime("07:00");
    if (!schedule) {
      throw new Error("Expected the test schedule to parse.");
    }

    const nextRun = getNextDailyRunDate(
      new Date("2026-06-29T04:30:00.000Z"),
      schedule,
      "Europe/London"
    );

    expect(nextRun.toISOString()).toBe("2026-06-29T06:00:00.000Z");
  });

  it("schedules tomorrow when today's configured local time has passed", () => {
    const schedule = parseDailyScheduleTime("07:00");
    if (!schedule) {
      throw new Error("Expected the test schedule to parse.");
    }

    const nextRun = getNextDailyRunDate(
      new Date("2026-06-29T07:30:00.000Z"),
      schedule,
      "Europe/London"
    );

    expect(nextRun.toISOString()).toBe("2026-06-30T06:00:00.000Z");
  });

  it("formats a local date in the configured time zone", () => {
    expect(formatZonedDate(new Date("2026-06-29T23:30:00.000Z"), "Europe/London")).toBe(
      "2026-06-30"
    );
  });
});
