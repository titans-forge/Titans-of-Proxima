import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is supported');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function files(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error('Symlink in release: ' + relative);
  if (stat.isDirectory()) return fs.readdirSync(absolute).sort().flatMap(name => files(path.posix.join(relative, name)));
  if (!stat.isFile() || relative.includes('.DS_Store')) throw new Error('Unexpected release file: ' + relative);
  const bytes = fs.readFileSync(absolute);
  return [{ path: relative, sha256: digest(bytes), bytes: bytes.length }];
}
const sourceFiles = ['src', 'public', 'scripts', 'index.html', 'package.json',
  'package-lock.json', 'tsconfig.json', 'vite.config.ts'].flatMap(files);
const media = sourceFiles.filter(file => /\.(png|mp3|svg)$/.test(file.path) && file.path.startsWith('public/'));
const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'LICENSING_CHECKPOINT.json'), 'utf8'));
const artifacts = {
  'SOURCE_SNAPSHOT.json': {
    schema: 'forge_game_source_snapshot_v2', game: 'Titans of Proxima', version: '1.1.0',
    recorded_date: '2026-10-05', release_id: checkpoint.release_id,
    scope: 'Current gameplay, public assets, build configuration and release scripts; excludes private records and dependencies',
    original_unchanged_claim: false, earlier_snapshot: 'docs/licensing-history/2026-09-30-source-snapshot.json',
    files: sourceFiles, private_receipts_included: false,
  },
  'docs/MEDIA_PROVENANCE_PUBLIC.json': {
    schema: 'forge_game_media_inventory_v1', version: '1.1.0', assets: media,
    rights_record: 'MEDIA_RIGHTS.md', private_receipts_included: false,
  },
};
for (const [relative, data] of Object.entries(artifacts)) {
  const text = JSON.stringify(data, null, 2) + '\n';
  const target = path.join(root, relative);
  if (check) {
    if (fs.readFileSync(target, 'utf8') !== text) throw new Error('Stale release inventory: ' + relative);
  } else fs.writeFileSync(target, text);
}
console.log(`${check ? 'Verified' : 'Recorded'} ${sourceFiles.length} source files and ${media.length} media assets.`);
