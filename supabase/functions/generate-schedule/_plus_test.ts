import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generatePlusRotationBlocks } from "./index.ts";

Deno.test("generatePlusRotationBlocks: materialises active admin-specified PLUS sessions", () => {
  const specialists = [{
    id: "s1", name: "Art", subject: "Art", location: "Rm1",
    plus_rotation: {
      Mon: { active: true, startTime: "14:00", grades: [{ grade: "3", durationMinutes: 30 }, { grade: "4" }] },
      Tue: { active: false, startTime: "14:00", grades: [{ grade: "5" }] }, // inactive → skipped
    },
  }] as any;
  const blocks = generatePlusRotationBlocks("g", specialists, { class_duration: 45 });
  assertEquals(blocks.length, 2);
  const g3 = blocks.find((b) => b.grade === "3")!;
  assertEquals([g3.day_of_week, g3.start_time, g3.end_time], ["Mon", "14:00", "14:30"]); // 30-min override
  assertEquals(g3.specialist_id, "s1");
  assertEquals(g3.subject, "Art (PLUS)");
  const g4 = blocks.find((b) => b.grade === "4")!;
  assertEquals(g4.end_time, "14:45"); // default class_duration 45
});

Deno.test("generatePlusRotationBlocks: no/empty plus_rotation → no blocks", () => {
  assertEquals(generatePlusRotationBlocks("g", [{ id: "s1", subject: "PE" }] as any, {}).length, 0);
  assertEquals(generatePlusRotationBlocks("g", [{ id: "s2", subject: "PE", plus_rotation: {} }] as any, {}).length, 0);
});
