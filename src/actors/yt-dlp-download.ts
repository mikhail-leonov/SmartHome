/**
 * Actor: yt-dlp-download  (concrete yt-dlp integration)
 *
 * Runs `yt-dlp` to download the URL passed in params into the configured
 * download directory. If yt-dlp isn't installed the error is surfaced and
 * recorded in actor_runs — it does not crash the platform.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ActorPlugin } from '../types/types.js';
import { run } from '../core/exec.js';

const plugin: ActorPlugin = {
  id: 'yt-dlp-download',
  name: 'yt-dlp Download',
  description: 'Downloads a URL with yt-dlp into the configured download directory.',
  params: { url: 'string' },

  async execute(params, ctx) {
    const url = String(params.url ?? '').trim();
    if (!url) throw new Error('missing "url" param');

    const dir = resolve(ctx.config.projectRoot, ctx.config.ytdlp.downloadDir);
    mkdirSync(dir, { recursive: true });

    ctx.logger.info(`downloading ${url} → ${dir}`);
    const { stdout } = await run(
      'yt-dlp',
      ['--no-warnings', '-o', `${dir}/%(title)s.%(ext)s`, url],
      10 * 60 * 1000, // downloads can take a while
    );
    const lastLine = stdout.trim().split('\n').pop() ?? '';
    ctx.logger.info(`yt-dlp done: ${lastLine}`);
    ctx.mqtt.publish(`${ctx.config.mqtt.baseTopic}/system/yt_last_download`, url);
  },
};

export default plugin;
