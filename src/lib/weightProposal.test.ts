import { describe, it, expect } from "vitest";
import { describeWeightProposal, weightProposalHeadline } from "./weightProposal";

describe("describeWeightProposal", () => {
  it("returns nothing when there is no proposal or no change", () => {
    expect(describeWeightProposal({ subject_gap: -40 }, null)).toEqual([]);
    expect(describeWeightProposal({ subject_gap: -40 }, { subject_gap: -40 })).toEqual([]);
  });

  it("describes a stronger penalty as leaning 'more' toward that goal", () => {
    const d = describeWeightProposal({ subject_gap: -40 }, { subject_gap: -52 });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ key: "subject_gap", direction: "more", label: "even subject coverage" });
    expect(d[0].reason).toMatch(/Lean toward/);
  });

  it("describes a weaker penalty as 'less'", () => {
    const d = describeWeightProposal({ subject_day_clustering: -15 }, { subject_day_clustering: -9 });
    expect(d[0]).toMatchObject({ direction: "less" });
    expect(d[0].reason).toMatch(/Relax/);
  });

  it("falls back to defaults for the active weight when missing", () => {
    // No active override → compares against default −40.
    const d = describeWeightProposal({}, { subject_gap: -50 });
    expect(d[0].direction).toBe("more");
  });

  it("never proposes hard-constraint terms", () => {
    const d = describeWeightProposal({}, { errors: -500, warnings: -10, subject_gap: -50 });
    expect(d.map((x) => x.key)).not.toContain("errors");
    expect(d.map((x) => x.key)).not.toContain("warnings");
    expect(d.map((x) => x.key)).toContain("subject_gap");
  });

  it("builds a human headline", () => {
    expect(weightProposalHeadline([{ key: "subject_gap", label: "even subject coverage", direction: "more", reason: "" }]))
      .toBe("Want future schedules to favor even subject coverage?");
    expect(weightProposalHeadline([
      { key: "subject_gap", label: "a", direction: "more", reason: "" },
      { key: "class_repeats", label: "b", direction: "less", reason: "" },
    ])).toMatch(/2 tweaks/);
    expect(weightProposalHeadline([])).toBe("");
  });
});
