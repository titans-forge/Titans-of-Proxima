import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const suites = [
  "src/core/shipService.test.ts",
  "src/core/crewTransport.test.ts",
  "src/core/campaignRecoveryPolicy.test.ts",
  "src/core/operations.test.ts",
  "src/core/campaignEconomyPolicy.test.ts",
  "src/core/campaignEconomyStudy.test.ts",
  "src/selftest.ts",
  "src/core/launch.test.ts",
  "src/core/guidance.test.ts",
  "src/core/events.regression.test.ts",
  "src/core/save.regression.test.ts",
  "src/core/mechanics.test.ts",
  "src/core/campaign.test.ts",
  "src/core/campaignStudy.test.ts",
  "src/core/routeIntel.test.ts",
  "src/core/industry.test.ts",
  "src/core/fieldGuide.test.ts",
  "src/ui/fleetDraft.test.ts",
  "src/ui/cinematics.test.ts",
  "src/render/polish.test.ts",
  "src/render/systemGeometry.test.ts",
  "src/render/moduleLayout.test.ts",
  "src/audio/audio.test.ts",
];
for (const suite of suites) {
  execFileSync(process.execPath, ["--import", "tsx", suite], { cwd: root, stdio: "inherit" });
}
console.log(`All ${suites.length} test suites passed.`);
