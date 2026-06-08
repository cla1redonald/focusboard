import { describe, expect, it } from "vitest";
import { isCaptureVisible } from "./useCaptureQueue";

describe("isCaptureVisible", () => {
  const now = new Date("2026-06-08T12:00:00.000Z").getTime();

  it("keeps unsnoozed captures visible", () => {
    expect(isCaptureVisible({ snoozed_until: null }, now)).toBe(true);
  });

  it("hides captures until their snooze expires", () => {
    expect(isCaptureVisible({ snoozed_until: "2026-06-08T12:15:00.000Z" }, now)).toBe(false);
  });

  it("shows captures when their snooze has expired", () => {
    expect(isCaptureVisible({ snoozed_until: "2026-06-08T11:59:00.000Z" }, now)).toBe(true);
  });
});
