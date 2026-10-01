import { decideCinematic, shouldShowPendingMarsArrival } from "./cinematics";

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
}

const base = { mode: "progression" as const, newGame: false, continuing: false, seenLuna: false, seenMars: false, foundingWorld: null, actualMarsArrival: false };
equal(decideCinematic({ ...base, newGame: true }), "luna-arrival", "new game shows Luna");
equal(decideCinematic({ ...base, continuing: true }), null, "legacy continue does not interrupt an existing campaign");
equal(decideCinematic({ ...base, newGame: true, seenLuna: true }), null, "seen Luna does not repeat");
equal(decideCinematic({ ...base, newGame: true, foundingWorld: "mars" }), null, "unfounded Mars does not show approach");
equal(decideCinematic({ ...base, actualMarsArrival: true, foundingWorld: "mars" }), "mars-arrival", "actual Mars arrival shows approach");
equal(decideCinematic({ ...base, actualMarsArrival: true, foundingWorld: "mars", seenMars: true }), null, "seen Mars does not repeat");
equal(decideCinematic({ ...base, mode: "replay", newGame: true }), null, "replay is non-progressing");
equal(shouldShowPendingMarsArrival({ founding: { shipId: "ship", world: "mars" }, script: {} }), true, "pending legacy Mars founding shows");
equal(shouldShowPendingMarsArrival({ founding: { shipId: "ship", world: "mars" }, script: { cinematicMarsArrival: true } }), false, "pending seen Mars is quiet");
console.log("cinematics: contract ok");
