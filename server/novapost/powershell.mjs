import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPsScriptPath() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'np-request.ps1'),
    path.join(process.cwd(), 'server', 'scripts', 'np-request.ps1'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function shouldUseNovaPostPowerShellBridge() {
  if (process.platform !== 'win32') return false;
  return process.env.NOVAPOST_USE_POWERSHELL !== 'false';
}

export async function novaPostRequestViaPowerShell(method, url, headers = {}, body) {
  const payloadPath = path.join(tmpdir(), `np-req-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const payload = { method: method.toUpperCase(), url, headers, body: body ?? null };

  mkdirSync(tmpdir(), { recursive: true });
  writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');

  const scriptPath = getPsScriptPath();
  if (!existsSync(scriptPath)) {
    throw new Error(`Nova Post PowerShell script not found: ${scriptPath}`);
  }

  let stdout = '';
  try {
    const result = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, payloadPath],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (error) {
    stdout = error.stdout?.trim() ?? '';
    if (!stdout) {
      throw new Error(`Nova Post PowerShell bridge failed: ${error.message ?? String(error)}`);
    }
  } finally {
    try { unlinkSync(payloadPath); } catch { /* ignore */ }
  }

  const envelope = JSON.parse(stdout.trim());
  if (envelope.ok === false) {
    const status = envelope.status ?? 0;
    const raw = envelope.error ?? 'PowerShell Nova Post request failed';
    throw new Error(`Nova Post request failed (${status}): ${String(raw).slice(0, 500)}`);
  }
  return envelope.data;
}
