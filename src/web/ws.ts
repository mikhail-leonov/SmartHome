/**
 * WebSocket hub.
 *
 * Bridges the internal event bus to browser clients. On connect a client gets
 * a full snapshot (every variable + recent activity + system status); after
 * that it receives incremental messages as state changes, actors run, and
 * seasons turn. The dashboard updates values in place — no refresh.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { bus } from '../core/bus.js';
import { state } from '../core/state.js';
import { logger } from '../core/logger.js';
import { isMqttConnected } from '../mqtt/client.js';
import { isDbHealthy } from '../db/index.js';
import { currentSeason } from '../engine/seasonal.js';
import {
  BusEvents,
  type ActivityItem,
  type ActorRunRecord,
  type Season,
  type StateValue,
} from '../types/types.js';

const ACTIVITY_BUFFER = 60;
const recentActivity: ActivityItem[] = [];

let wss: WebSocketServer | null = null;

function pushActivity(item: ActivityItem): void {
  recentActivity.unshift(item);
  if (recentActivity.length > ACTIVITY_BUFFER) recentActivity.pop();
}

function broadcast(msg: unknown): void {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function status() {
  return { mqtt: isMqttConnected(), db: isDbHealthy(), season: currentSeason() };
}

export function createWsHub(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    logger.debug('ws', 'client connected');
    socket.send(
      JSON.stringify({
        type: 'snapshot',
        state: state.all(),
        activity: recentActivity,
        status: status(),
      }),
    );
  });

  // State changes → live value updates.
  bus.on(BusEvents.StateChange, (rec: StateValue) => {
    broadcast({ type: 'state', value: rec });
  });

  // Activity log items.
  bus.on(BusEvents.Activity, (item: ActivityItem) => {
    pushActivity(item);
    broadcast({ type: 'activity', item, status: status() });
  });

  // Actor runs also surface in the activity feed via the engine; here we just
  // refresh system status alongside so the header pills stay current.
  bus.on(BusEvents.ActorRun, (_rec: ActorRunRecord) => {
    broadcast({ type: 'status', status: status() });
  });

  bus.on(BusEvents.SeasonChange, (season: Season) => {
    pushActivity({ kind: 'season', message: `Season changed to ${season}`, at: Date.now() });
    broadcast({ type: 'status', status: status() });
  });

  logger.ok('ws', 'WebSocket hub ready at /ws');
}
