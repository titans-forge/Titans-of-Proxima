// Copyright (c) 2026 Titans Forge LLC.
// Forge Game Hosting License 1.0; see LICENSE and LICENSING.md.
// Stage rights notices without modifying gameplay files or fetching anything.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'dist');
const checkOnly = process.argv.slice(2).includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) {
  throw new Error('Only --check is supported');
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const approvedHash = '28638be413f7815704fe68aed52a4ea4cb7bd4d28b35f2dca9b78d438a4a90bf';
function readRegular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular, non-symlink file: ' + path.basename(file));
  return fs.readFileSync(file);
}
if (!fs.lstatSync(dist).isDirectory() || fs.lstatSync(dist).isSymbolicLink() || fs.realpathSync(dist) !== dist) {
  throw new Error('dist must be a regular directory inside this project');
}
readRegular(path.join(dist, 'index.html'));
const checkpoint = JSON.parse(readRegular(path.join(root, 'LICENSING_CHECKPOINT.json')));
if (checkpoint.schema !== 'forge_game_github_license_checkpoint_v1' ||
    checkpoint.license_sha256 !== approvedHash ||
    !/^FG-LIC-20260930-[0-9]{2}-GH1$/.test(checkpoint.release_id)) {
  throw new Error('Invalid licensing checkpoint');
}
const copies = [
  ['LICENSE', 'LICENSE'],
  ['LICENSE', 'LICENSE.txt'],
  ['LICENSING.md', 'LICENSING.txt'],
  ['LICENSING_CHECKPOINT.json', 'LICENSING_CHECKPOINT.json'],
];
for (const [source, target] of [['MEDIA_RIGHTS.md', 'MEDIA_RIGHTS.txt'], ['NOTICE', 'NOTICE.txt']]) {
  if (fs.existsSync(path.join(root, source))) copies.push([source, target]);
}

// Validate every source and destination before the first write.
const prepared = copies.map(([source, target]) => {
  const bytes = readRegular(path.join(root, source));
  const dest = path.join(dist, target);
  if (fs.existsSync(dest) || fs.lstatSync(dist).isSymbolicLink()) {
    if (!fs.lstatSync(dest).isFile() || fs.lstatSync(dest).isSymbolicLink()) throw new Error('Unsafe notice destination: ' + target);
  } else {
    // existsSync follows links; a dangling symlink must still be rejected.
    try {
      fs.lstatSync(dest);
      throw new Error('Unsafe notice destination: ' + target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (source === 'LICENSE' && hash(bytes) !== approvedHash) throw new Error('Approved license hash mismatch');
  if (source === 'LICENSE-LEGACY-MIT.txt' && hash(bytes) !== checkpoint.previous_mit_license_sha256) throw new Error('Legacy MIT notice hash mismatch');
  return { dest, target, bytes };
});
// Runtime dependencies bundled into the browser build keep their full notices.
const dependencies = [['vite', 'LICENSE.md']];
for (const [name, notice] of dependencies) {
  const bytes = readRegular(path.join(root, 'node_modules', name, notice));
  const target = path.join('licenses', name, notice);
  const dest = path.join(dist, target);
  for (const directory of [path.join(dist, 'licenses'), path.dirname(dest)]) {
    try {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe notice directory');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (checkOnly) throw new Error('Missing dependency notice directory: ' + name);
    }
  }
  try {
    const stat = fs.lstatSync(dest);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe dependency notice');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  prepared.push({ dest, target, bytes });
}
for (const { dest, target, bytes } of prepared) {
  if (checkOnly) {
    if (!fs.existsSync(dest) || !readRegular(dest).equals(bytes)) throw new Error('Missing or stale build notice: ' + target);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
}
console.log((checkOnly ? 'Verified' : 'Staged') + ' ' + prepared.length + ' release licensing notices; gameplay unchanged.');
