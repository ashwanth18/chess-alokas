/**
 * Download bbpPairings v6.0.0 (Apache-2.0) for the current OS.
 * https://github.com/BieremaBoyzProgramming/bbpPairings
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VERSION = '6.0.0';
const BASE = `https://github.com/BieremaBoyzProgramming/bbpPairings/releases/download/v${VERSION}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'vendor', 'bbp-pairings');

const allAssets = {
  win32: {
    url: `${BASE}/bbpPairings-v${VERSION}-x86_64-pc-windows.zip`,
    exeName: 'bbpPairings.exe',
    destDir: path.join(vendor, 'win-x64'),
  },
  linux: {
    url: `${BASE}/bbpPairings-v${VERSION}-x86_64-pc-linux.tar.gz`,
    exeName: 'bbpPairings.exe',
    destDir: path.join(vendor, 'linux-x64'),
  },
};

function requestedKeys() {
  if (process.argv.includes('--all')) return Object.keys(allAssets);
  if (process.platform === 'win32') return ['win32'];
  return ['linux'];
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status} ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function extractZip(zipPath, destDir) {
  if (process.platform === 'win32') {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }
  await execFileAsync('tar', ['-xf', zipPath, '-C', destDir]);
}

async function extractTarGz(archive, destDir) {
  await execFileAsync('tar', ['-xzf', archive, '-C', destDir]);
}

function findExe(dir, name) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name === name || ent.name === 'bbpPairings') return p;
    }
  }
  return null;
}

const keys = requestedKeys();
for (const key of keys) {
  const spec = allAssets[key];
  fs.mkdirSync(spec.destDir, { recursive: true });

  const archiveName = spec.url.split('/').pop();
  const archivePath = path.join(spec.destDir, archiveName);
  console.log(`Fetching ${spec.url}`);
  await download(spec.url, archivePath);

  if (archiveName.endsWith('.zip')) {
    await extractZip(archivePath, spec.destDir);
  } else {
    await extractTarGz(archivePath, spec.destDir);
  }

  const found = findExe(spec.destDir, spec.exeName);
  if (!found) {
    throw new Error(`Could not find ${spec.exeName} after extracting ${archivePath}`);
  }
  const dest = path.join(spec.destDir, spec.exeName);
  if (path.resolve(found) !== path.resolve(dest)) {
    fs.copyFileSync(found, dest);
  }
  const license = findExe(spec.destDir, 'LICENSE.txt') ?? findExe(spec.destDir, 'Apache-2.0.txt');
  if (license) {
    fs.copyFileSync(license, path.join(spec.destDir, 'LICENSE.txt'));
  }
  if (process.platform !== 'win32' || key === 'linux') {
    try {
      fs.chmodSync(dest, 0o755);
    } catch {
      /* windows cannot chmod a linux binary meaningfully */
    }
  }
  try {
    fs.unlinkSync(archivePath);
  } catch {
    /* ignore */
  }
  console.log(`bbpPairings v${VERSION} installed at ${dest}`);
}
