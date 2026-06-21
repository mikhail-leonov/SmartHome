/**
 * Thin promise wrapper around child_process for plugins that shell out to a
 * binary (e.g. yt-dlp). Resolves with stdout, rejects with a useful message —
 * including the "binary not found" case so callers can degrade gracefully.
 */
import { spawn } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`"${cmd}" is not installed or not on PATH`));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code: 0 });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}
