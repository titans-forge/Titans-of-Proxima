// Run the original eight test files without the tsx CLI IPC server.
import { spawnSync } from 'node:child_process';
const files = ['src/selftest.ts', 'src/audio/audio.test.ts', 'src/core/fieldGuide.test.ts',
  'src/core/mechanics.test.ts', 'src/core/industry.test.ts', 'src/core/campaign.test.ts',
  'src/render/polish.test.ts', 'src/ui/cinematics.test.ts'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', file], {stdio: 'inherit'});
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log('All eight original test files passed. Authored campaigns are design probes, not independent playtests.');
