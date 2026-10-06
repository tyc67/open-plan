// Compares two capture folders pixel by pixel. Exit code 0 only when every screenshot is identical.
// Usage: node tools/visual/compare.mjs <baseline-dir> <candidate-dir> [diff-dir]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { EXPECTED_SHOTS } from './scenes.mjs';

const [baseDir, candDir, diffDir] = process.argv.slice(2);
if (!baseDir || !candDir) { console.error('Usage: node tools/visual/compare.mjs <baseline-dir> <candidate-dir> [diff-dir]'); process.exit(2); }

const base = JSON.parse(await readFile(join(baseDir, 'meta.json'), 'utf8'));
const cand = JSON.parse(await readFile(join(candDir, 'meta.json'), 'utf8'));
// A browser update changes rendering; it must not look like a regression.
if (base.chrome !== cand.chrome) {
  console.error(`Chrome version differs: baseline ${base.chrome}, candidate ${cand.chrome}. Capture a new baseline with the old build first.`);
  process.exit(3);
}
// Stale or partial captures must not pass: both sets must be exactly the current scene list, with no page errors.
for (const [label, meta] of [['baseline', base], ['candidate', cand]]) {
  const names = meta.shots.map(s => s.name);
  if (names.length !== EXPECTED_SHOTS.length || names.some((n, i) => n !== EXPECTED_SHOTS[i])) {
    console.error(`The ${label} does not match the scene list.\n  expected: ${EXPECTED_SHOTS.join(', ')}\n  found:    ${names.join(', ')}`);
    process.exit(4);
  }
  const withErrors = meta.shots.filter(s => s.errors?.length);
  if (withErrors.length) {
    console.error(`The ${label} has page errors: ${withErrors.map(s => `${s.name}: ${s.errors.join(' | ')}`).join('; ')}`);
    process.exit(5);
  }
}
if (diffDir) await mkdir(diffDir, { recursive: true });

let failed = 0;
for (const shot of base.shots) {
  const a = PNG.sync.read(await readFile(join(baseDir, shot.file)));
  let b;
  try { b = PNG.sync.read(await readFile(join(candDir, shot.file))); } catch { console.log(`MISSING  ${shot.name}`); failed++; continue; }
  if (a.width !== b.width || a.height !== b.height) { console.log(`SIZE     ${shot.name}: ${a.width}x${a.height} vs ${b.width}x${b.height}`); failed++; continue; }
  const diff = new PNG({ width: a.width, height: a.height });
  // includeAA: pixelmatch skips anti-aliased pixels by default, so threshold 0 alone is not an exact compare.
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0, includeAA: true });
  // Independent byte check, so a pass always means identical RGBA data.
  const identical = Buffer.compare(a.data, b.data) === 0;
  if (changed === 0 && !identical) throw new Error(`${shot.name}: pixelmatch found no change, but the bytes differ`);
  if (changed) {
    failed++;
    if (diffDir) await writeFile(join(diffDir, shot.file), PNG.sync.write(diff));
  }
  console.log(`${changed ? 'DIFF    ' : 'SAME    '} ${shot.name}${changed ? `: ${changed} pixels (${(100 * changed / (a.width * a.height)).toFixed(3)}%)` : ''}`);
}
console.log(failed ? `${failed} of ${base.shots.length} screenshots differ.` : `All ${base.shots.length} screenshots are identical.`);
process.exit(failed ? 1 : 0);
