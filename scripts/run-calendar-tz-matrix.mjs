import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const zones = ["UTC", "Europe/Moscow", "America/New_York", "Australia/Lord_Howe"];
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const testFiles = [
  "src/services/calendar/domain/time.test.ts",
  "src/services/calendar/icalTimeMapping.test.ts",
  "src/services/calendar/ical/codec.test.ts",
  "src/services/calendar/freeBusy/projection.test.ts",
  "src/services/calendar/scheduling/timeline.test.ts",
  "src/services/calendar/scheduling/slots.test.ts",
  "src/services/calendar/scheduling/workingHours.test.ts",
  "src/services/calendar/scheduling/schedulingAssistantService.test.ts",
  "src/components/calendar/scheduling/schedulingView.test.ts",
];

for (const zone of zones) {
  console.log(`\nTZ_MATRIX ${zone}`);
  const result = spawnSync(process.execPath, [vitest, "run", ...testFiles, "--reporter=dot", "--silent"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, TZ: zone },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
