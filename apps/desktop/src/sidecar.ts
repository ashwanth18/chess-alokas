import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import log from 'electron-log/main';
import { resolveDesktopBbpBinary } from './bbpPath.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SidecarHandle {
  port: number;
  baseUrl: string;
  process: ChildProcess;
  stop: () => Promise<void>;
}

export function findFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not allocate a free port'));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function repoRootFromDev(): string {
  // apps/desktop/out -> repo root
  return path.resolve(__dirname, '../../..');
}

/** Ensure userData/api.env exists (copy example or local apps/api/.env on first run). */
export function ensureUserApiEnv(): string {
  const userData = app.getPath('userData');
  const dest = path.join(userData, 'api.env');
  if (!fs.existsSync(dest)) {
    const candidates = [
      // Dev convenience: reuse local API secrets if present
      path.join(repoRootFromDev(), 'apps/api/.env'),
      path.join(repoRootFromDev(), 'apps/desktop/resources/api.env.example'),
      path.join(repoRootFromDev(), 'apps/api/.env.example'),
    ];
    const example = candidates.find((p) => fs.existsSync(p));
    const seed = example
      ? fs.readFileSync(example, 'utf8')
      : `# Chess Alokas desktop API config\n# Copy DATABASE_URL / SUPABASE_* from your cloud project for sync + certificates.\nPORT=3001\nHOST=127.0.0.1\n`;
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(dest, seed, 'utf8');
    log.info('Created API env at', dest);
  }
  return dest;
}

function certificatesDir(): string {
  const dir = path.join(app.getPath('userData'), 'certificates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Development only: the RunAsNode fuse is off in packaged builds, which have no sidecar. */
function nodeCommand(): string {
  return process.env['npm_node_execpath'] ?? 'node';
}

function resolveApiEntry(): { command: string; args: string[]; cwd: string } {
  const command = nodeCommand();

  const apiPkg = path.join(repoRootFromDev(), 'apps/api');
  const distEntry = path.join(apiPkg, 'dist/index.js');
  if (fs.existsSync(distEntry)) {
    return {
      command,
      args: [distEntry],
      cwd: apiPkg,
    };
  }

  const apiTsx = path.join(apiPkg, 'node_modules/tsx/dist/cli.mjs');
  const rootTsx = path.join(repoRootFromDev(), 'node_modules/tsx/dist/cli.mjs');
  const tsxCli = fs.existsSync(apiTsx) ? apiTsx : rootTsx;
  const srcEntry = path.join(apiPkg, 'src/index.ts');
  return {
    command,
    args: [tsxCli, srcEntry],
    cwd: apiPkg,
  };
}

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`API sidecar did not become healthy: ${lastErr}`);
}

export async function startApiSidecar(): Promise<SidecarHandle> {
  const port = await findFreePort();
  const envFile = ensureUserApiEnv();
  const certs = certificatesDir();
  const { command, args, cwd } = resolveApiEntry();
  const baseUrl = `http://127.0.0.1:${port}`;

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    CERTIFICATES_DIR: certs,
  };
  const bbpExe = resolveDesktopBbpBinary();
  if (bbpExe) {
    childEnv['BBP_PAIRINGS_PATH'] = bbpExe;
  }
  // Avoid inheriting Electron's own ELECTRON_RUN_AS_NODE into unrelated tools
  delete childEnv['ELECTRON_RUN_AS_NODE'];

  const useEnvFileFlag = fs.existsSync(envFile);
  const finalArgs = useEnvFileFlag ? [`--env-file=${envFile}`, ...args] : args;

  log.info('Starting API sidecar', { command, finalArgs, cwd, port });

  const child = spawn(command, finalArgs, {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.on('data', (buf: Buffer) => log.info('[api]', buf.toString().trimEnd()));
  child.stderr?.on('data', (buf: Buffer) => log.error('[api]', buf.toString().trimEnd()));
  child.on('exit', (code, signal) => {
    log.warn('API sidecar exited', { code, signal });
  });

  try {
    await waitForHealth(baseUrl);
  } catch (err) {
    child.kill();
    throw err;
  }

  return {
    port,
    baseUrl,
    process: child,
    stop: async () => {
      if (child.killed) return;
      child.kill();
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        child.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
