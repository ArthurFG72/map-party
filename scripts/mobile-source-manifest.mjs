import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.expo', '.gradle', '.cxx', '.kotlin', 'build']);
const EXCLUDED_NAMES = new Set(['.env', 'debug.keystore', 'map-party.png', 's20-check.png', 's20-current.png']);
const EXCLUDED_SUFFIXES = ['.apk', '.aab', '.ipa', '.hbc', '.map'];

function excluded(relativePath, directory = false) {
  const parts = relativePath.split(/[\\/]/);
  const name = basename(relativePath);
  if (directory && (EXCLUDED_DIRECTORIES.has(name) || name.startsWith('dist'))) return true;
  return parts.some((part) => EXCLUDED_DIRECTORIES.has(part) || part.startsWith('dist')) ||
    EXCLUDED_NAMES.has(name) || EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

async function filesAt(root, current = root, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = resolve(current, entry.name);
    const path = relative(root, absolute);
    if (excluded(path, entry.isDirectory())) continue;
    if (entry.isDirectory()) await filesAt(root, absolute, result);
    else if (entry.isFile()) result.push(path.split(sep).join('/'));
  }
  return result;
}

export async function collectMobileSourceManifest(root) {
  const absoluteRoot = resolve(root);
  const files = (await filesAt(absoluteRoot)).sort();
  return Promise.all(files.map(async (path) => {
    const digest = createHash('sha256').update(await readFile(resolve(absoluteRoot, path))).digest('hex');
    return `${digest}  ${path}`;
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await collectMobileSourceManifest(process.argv[2] || 'mobile');
  process.stdout.write(`${manifest.join('\n')}\n`);
}
