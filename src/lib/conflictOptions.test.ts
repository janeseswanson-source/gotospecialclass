import { describe, it, expect } from "vitest";
import { tacticLabel, blastLabel, resolutionHeadline } from "./conflictOptions";

describe("conflictOptions", () => {
  it("labels tactics in friendly language", () => {
    expect(tacticLabel("relocate")).toBe("Moved the class");
    expect(tacticLabel("swap")).toBe("Swapped two sessions");
    expect(tacticLabel("add_session")).toBe("Added a session");
    expect(tacticLabel("mystery")).toBe("Adjusted the schedule");
  });

  it("formats blast radius with singular/plural", () => {
    expect(blastLabel(1)).toBe("affects 1 block");
    expect(blastLabel(3)).toBe("affects 3 blocks");
    expect(blastLabel(0)).toBe("affects 0 blocks");
  });

  it("summarizes the resolution outcome", () => {
    expect(resolutionHeadline(0, 0)).toBe("No conflicts to resolve.");
    expect(resolutionHeadline(2, 0)).toBe("Resolved 2 conflicts with the smallest possible change.");
    expect(resolutionHeadline(0, 1)).toBe("1 conflict need your decision.");
    expect(resolutionHeadline(3, 2)).toBe("Resolved 3; 2 need your decision.");
  });
});
