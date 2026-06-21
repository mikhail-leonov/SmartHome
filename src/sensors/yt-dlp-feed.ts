/**
 * Sensor: yt-dlp-feed  (yt-dlp-style integration demo)
 *
 * Trigger: interval (every 30 minutes).
 * Polls a configured channel/playlist with `yt-dlp` and flips
 * home/system/yt_new_content to true when the latest upload id changes.
 *
 * Disabled by default (PLUGIN_YT_DLP_FEED=false) and a no-op unless
 * YTDLP_FEED_URL is set, so it never fails the boot if yt-dlp isn't installed.
 */
import type { SensorPlugin } from '../types/types.js';
import { run } from '../core/exec.js';

let lastSeenId: string | null = null;

const plugin: SensorPlugin = {
  id: 'yt-dlp-feed',
  name: 'yt-dlp Feed',
  trigger: { type: 'interval', everyMs: 30 * 60 * 1000 }, // every 30 min

  async run(ctx) {
    const url = ctx.config.ytdlp.feedUrl;
    if (!url) {
      ctx.logger.warn('YTDLP_FEED_URL not set — skipping');
      return;
    }

    try {
      // --flat-playlist is fast (no per-video metadata); print just ids.
      const { stdout } = await run('yt-dlp', [
        '--flat-playlist',
        '--no-warnings',
        '--print',
        'id',
        url,
      ]);
      const ids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      const latest = ids[0] ?? null;

      const isNew = latest !== null && lastSeenId !== null && latest !== lastSeenId;
      if (latest) lastSeenId = latest;

      ctx.mqtt.publish(`${ctx.config.mqtt.baseTopic}/system/yt_new_content`, isNew);
      ctx.logger.info(`feed checked — latest=${latest ?? 'none'}, new=${isNew}`);
    } catch (err) {
      ctx.logger.warn(`yt-dlp feed check failed: ${(err as Error).message}`);
    }
  },
};

export default plugin;
