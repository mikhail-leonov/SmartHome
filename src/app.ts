/**
 * Express + Twig application.
 *
 * Serves the dashboard (one card per room, a system panel and an activity
 * log) and a handful of small control endpoints used by the dashboard's
 * "simulate" buttons so the platform can be exercised end-to-end without real
 * hardware.
 */
import express from 'express';
import type { Express } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from './config/index.js';
import { state } from './core/state.js';
import { bus } from './core/bus.js';
import { logger } from './core/logger.js';
import { publish, isMqttConnected } from './mqtt/client.js';
import { isDbHealthy, recentActorRuns } from './db/index.js';
import { currentSeason, forceSeason } from './engine/seasonal.js';
import type { RoomConfig, Season } from './types/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

/** Build the room→device→variable view-model with current cached values. */
function roomsViewModel() {
  return config.rooms.map((room: RoomConfig) => ({
    id: room.id,
    name: room.name,
    devices: room.devices.map((device) => ({
      id: device.id,
      name: device.name,
      variables: device.variables.map((v) => {
        const topic = `${config.mqtt.baseTopic}/${room.id}/${device.id}/${v.id}`;
        const rec = state.get(topic);
        return {
          id: v.id,
          name: v.name,
          unit: v.unit ?? '',
          topic,
          value: rec ? formatValue(rec.value) : '—',
          updatedAt: rec?.updatedAt ?? null,
        };
      }),
    })),
  }));
}

function formatValue(v: unknown): string {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // Twig setup.
  app.set('views', resolve(projectRoot, 'views'));
  app.set('view engine', 'twig');
  // eslint-disable-next-line @typescript-eslint/no-var-requires

  // Static assets.
  app.use('/public', express.static(resolve(projectRoot, 'public')));

  // ── Dashboard ──────────────────────────────────────────────────────
  app.get('/', (_req, res) => {
    res.render('index', {
      title: 'SmartHome',
      rooms: roomsViewModel(),
      baseTopic: config.mqtt.baseTopic,
      season: currentSeason(),
      mqttConnected: isMqttConnected(),
      dbHealthy: isDbHealthy(),
    });
  });

  // ── Small control API used by the dashboard simulate buttons ───────
  // Generic publish: lets you push any test state from the UI.
  app.post('/api/publish', (req, res) => {
    const { topic, value } = req.body ?? {};
    if (typeof topic !== 'string') {
      res.status(400).json({ error: 'topic (string) required' });
      return;
    }
    publish(topic, value);
    res.json({ ok: true, topic, value });
  });

  // Simulate the garage opening (fires the event-driven garage-door sensor).
  app.post('/api/simulate/garage-open', (_req, res) => {
    bus.emit('garage:opened');
    res.json({ ok: true });
  });

  // Simulate a season transition (fires seasonal sensors + the summer rule).
  app.post('/api/simulate/season', (req, res) => {
    const season = req.body?.season as Season;
    const valid: Season[] = ['spring', 'summer', 'autumn', 'winter'];
    if (!valid.includes(season)) {
      res.status(400).json({ error: `season must be one of ${valid.join(', ')}` });
      return;
    }
    forceSeason(season);
    res.json({ ok: true, season });
  });

  // Recent actor runs (for an optional history view / debugging).
  app.get('/api/actor-runs', async (_req, res) => {
    res.json(await recentActorRuns(30));
  });

  app.get('/api/state', (_req, res) => res.json(state.all()));

  app.use((_req, res) => res.status(404).send('Not found'));

  logger.ok('web', 'Express app configured');
  return app;
}
