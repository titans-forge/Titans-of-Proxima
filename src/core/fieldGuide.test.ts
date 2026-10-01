import { FIELD_GUIDE, FIELD_GUIDE_CATEGORIES, guideCategory } from "./fieldGuide";

function equal(actual: unknown, expected: unknown, message?: string): void { if (actual !== expected) throw new Error(message ?? `${String(actual)} !== ${String(expected)}`); }
function ok(value: unknown, message: string): void { if (!value) throw new Error(message); }
function match(value: string, pattern: RegExp): void { if (!pattern.test(value)) throw new Error(`unexpected value: ${value}`); }

const ids = new Set(FIELD_GUIDE.map((item) => item.id));
equal(ids.size, FIELD_GUIDE.length, "field guide IDs must be unique");
equal(FIELD_GUIDE.length, 45);
for (const item of FIELD_GUIDE) {
  equal(item.verifiedDate, "2026-09-21");
  ok(FIELD_GUIDE_CATEGORIES.includes(guideCategory(item)), "unknown category");
  if (item.sourceUrl) match(item.sourceUrl, /^https:\/\//);
  ok(item.sourceTitle.length > 0 && item.body.length > 0, "empty guide content");
}
equal(FIELD_GUIDE.filter((item) => item.category === "stated goal").length, 2);
equal(FIELD_GUIDE.filter((item) => item.category === "history").length, 11);
ok(FIELD_GUIDE.find((item) => item.id === "game-abstraction")?.sourceUrl === null, "game design must have no external source");
for (const item of FIELD_GUIDE.filter((item) => item.category === "game abstraction")) {
  ok(item.sourceUrl === null, `game abstraction ${item.id} must have no external source`);
}
equal(FIELD_GUIDE.find((item) => item.id === "moon-temperature")?.body.includes("260 F"), true, "lunar temperature follows its NASA source, Fahrenheit-first");
equal(FIELD_GUIDE.find((item) => item.id === "mars-rad-cruise-vs-surface")?.sourceUrl, "https://science.nasa.gov/resource/radiation-exposure-comparisons-with-mars-trip-calculation/", "radiation note uses the reviewed source");
equal(FIELD_GUIDE.find((item) => item.id === "mars-perchlorates")?.body.includes("has to wash"), false, "perchlorate note avoids an unsupported universal rule");
equal(FIELD_GUIDE.find((item) => item.id === "moon-sintered-pads-plume")?.body.includes("excavates a crater"), false, "plume note avoids categorical crater claim");
console.log("field guide contract: ok");
