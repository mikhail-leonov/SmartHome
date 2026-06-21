/**
 * SmartHome — application entry point.
 *
 * Boots, in order: database → MQTT → seasonal scheduler → plugin discovery →
 * trigger wiring → rules engine → web server + WebSocket hub. Every subsystem
 * degrades gracefully: a missing broker or database is logged, not fatal, so
 * the dashboard always comes up.
 */
import { createServer } from 'node:http';
import pc from 'picocolors';
import { config } from './config/index.js';
import { logger } from './core/logger.js';
import { initDb, closeDb } from './db/index.js';
import { initMqtt, closeMqtt, publishSystem } from './mqtt/client.js';
import { startSeasonScheduler, stopSeasonScheduler, currentSeason } from './engine/seasonal.js';
import { loadPlugins } from './plugins/loader.js';
import { wireSensors, stopEngine } from './engine/index.js';
import { startRules, stopRules } from './automation/index.js';
import { createApp } from './app.js';
import { createWsHub } from './web/ws.js';

async function main(): Promise<void> {
  logger.banner('SmartHome automation platform starting…');

  // 1. Persistence (non-fatal if unavailable).
  await initDb();

  // 2. MQTT — the source of truth.
  initMqtt();

  // 3. Seasonal scheduler + seed the current season variable.
  startSeasonScheduler();
  publishSystem('season', currentSeason());
  publishSystem('online', true);

  // 4. Auto-discover and register plugins (logged with picocolors).
  const { sensors, actors } = await loadPlugins();

  // 5. Wire each sensor's trigger to the engine.
  wireSensors(sensors);

  // 6. Start the rules engine with the discovered actors.
  startRules(actors);

  // 7. Web server + live dashboard.
  const app = createApp();
  const server = createServer(app);
  createWsHub(server);

  server.listen(config.port, () => {
    logger.banner(`Dashboard ready → ${pc.underline(`http://localhost:${config.port}`)}`);
    logger.info('boot', `topic convention: ${config.mqtt.baseTopic}/<room>/<device>/<variable>`);
  });

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.warn('boot', `${signal} received — shutting down`);
    stopRules();
    stopEngine();
    stopSeasonScheduler();
    closeMqtt();
    await closeDb();
    server.close(() => process.exit(0));
    // Hard exit if something hangs.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('boot', err.stack ?? err.message);
  process.exit(1);
});
