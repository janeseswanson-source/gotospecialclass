import { describe, it, expect } from "vitest";
import { analyzeContractFeasibility } from "./contractFeasibility";

const school = {
  start_time: "08:00",
  end_time: "15:00",
  class_duration: 45,
  passing_time: 5,
  grades_served: ["K", "1", "2"],
};
const spec = { id: "s1", name: "Art", subject: "Art", working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"] };

const errors = (notes: ReturnType<typeof analyzeContractFeasibility>) => notes.filter((n) => n.level === "error");
const warnings = (notes: ReturnType<typeof analyzeContractFeasibility>) => notes.filter((n) => n.level === "warning");

describe("analyzeContractFeasibility — CP-SAT input requirements", () => {
  it("blocks (error) when there are zero classroom teachers — CP-SAT has no classes", () => {
    const notes = analyzeContractFeasibility(school, [spec], []);
    const e = errors(notes);
    expect(e.some((n) => /no classroom teachers/i.test(n.message))).toBe(true);
  });

  it("blocks (error) when there are no specialists", () => {
    const notes = analyzeContractFeasibility(school, [], [{ id: "t1", grade: "K" }]);
    expect(errors(notes).some((n) => /no specialists/i.test(n.message))).toBe(true);
  });

  it("blocks (error) when no grades are selected", () => {
    const notes = analyzeContractFeasibility({ ...school, grades_served: [] }, [spec], [{ id: "t1", grade: "K" }]);
    expect(errors(notes).some((n) => /no grades/i.test(n.message))).toBe(true);
  });

  it("warns (not info) when some served grades have no teacher — CP-SAT leaves them uncovered", () => {
    const notes = analyzeContractFeasibility(school, [spec], [{ id: "t1", grade: "K" }]);
    const w = warnings(notes);
    expect(w.some((n) => /no classroom teacher/i.test(n.message) && /1, 2/.test(n.message))).toBe(true);
    // And it is NOT downgraded to a mere info note anymore.
    expect(notes.some((n) => n.level === "info" && /grade-level blocks/i.test(n.message))).toBe(false);
  });

  it("warns when a teacher's grade is not in grades_served (orphan class can't be placed)", () => {
    const notes = analyzeContractFeasibility(school, [spec], [
      { id: "t1", grade: "K" },
      { id: "t2", grade: "1" },
      { id: "t3", grade: "2" },
      { id: "t4", grade: "9" },
    ]);
    expect(warnings(notes).some((n) => /not in the school's grade list/i.test(n.message) && /9/.test(n.message))).toBe(true);
  });

  it("a fully-configured school produces no blocking errors", () => {
    const notes = analyzeContractFeasibility(school, [spec], [
      { id: "t1", grade: "K" },
      { id: "t2", grade: "1" },
      { id: "t3", grade: "2" },
    ]);
    expect(errors(notes)).toHaveLength(0);
  });
});
