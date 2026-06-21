/**
 * MySQL persistence layer.
 *
 * Persists every state change (variables + variable_history), bus events,
 * actor runs and the plugin registry. If the database is disabled or
 * unreachable the app keeps running on the in-memory cache and logs a
 * warning rather than crashing — persistence simply becomes a no-op.
 */
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';
import type { ActorRunRecord, PluginKind, StateValue } from '../types/types.js';

let pool: Pool | null = null;
let healthy = false;

/** Connect to MySQL. Failure is non-fatal: we degrade to memory-only mode. */
export async function initDb(): Promise<void> {
  if (!config.db.enabled) {
    logger.warn('db', 'DB_ENABLED=false — running in memory-only mode (no persistence)');
    return;
  }
  try {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true,
    });
    await pool.query('SELECT 1');
    healthy = true;
    logger.ok('db', `connected to mysql://${config.db.host}:${config.db.port}/${config.db.database}`);
  } catch (err) {
    healthy = false;
    logger.warn(
      'db',
      `could not connect (${(err as Error).message}) — continuing without persistence. ` +
        `Run "npm run db:init" once MySQL is up.`,
    );
  }
}

export function isDbHealthy(): boolean {
  return healthy;
}

export function getPool(): Pool | null {
  return pool;
}

/** Run a query, swallowing errors so persistence never takes the app down. */
async function safeQuery(sql: string, params: unknown[] = []): Promise<void> {
  if (!pool || !healthy) return;
  try {
    await pool.query(sql, params);
  } catch (err) {
    logger.error('db', `query failed: ${(err as Error).message}`);
  }
}

function asText(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/** Upsert the current value of a variable and append to history. */
export async function persistState(rec: StateValue): Promise<void> {
  await safeQuery(
    `INSERT INTO variables (topic, room, device, variable, value, unit, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(?))
     ON DUPLICATE KEY UPDATE value = VALUES(value), unit = VALUES(unit), updated_at = VALUES(updated_at)`,
    [
      rec.topic,
      rec.room ?? null,
      rec.device ?? null,
      rec.variable ?? null,
      asText(rec.value),
      rec.unit ?? null,
      Math.floor(rec.updatedAt / 1000),
    ],
  );
  await safeQuery(
    `INSERT INTO variable_history (topic, value, unit, recorded_at)
     VALUES (?, ?, ?, FROM_UNIXTIME(?))`,
    [rec.topic, asText(rec.value), rec.unit ?? null, Math.floor(rec.updatedAt / 1000)],
  );
}

/** Audit a bus event. */
export async function persistEvent(name: string, payload: unknown): Promise<void> {
  await safeQuery(
    `INSERT INTO events (name, payload, created_at) VALUES (?, ?, NOW())`,
    [name, asText(payload)],
  );
}

/** Audit an actor execution. */
export async function persistActorRun(run: ActorRunRecord): Promise<void> {
  await safeQuery(
    `INSERT INTO actor_runs (actor_id, params, rule_id, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?))`,
    [
      run.actorId,
      asText(run.params),
      run.rule ?? null,
      run.status,
      run.error ?? null,
      Math.floor(run.at / 1000),
    ],
  );
}

/** Register a discovered plugin (idempotent). */
export async function registerPlugin(id: string, kind: PluginKind, enabled: boolean): Promise<void> {
  await safeQuery(
    `INSERT INTO plugins (id, kind, enabled, discovered_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE kind = VALUES(kind), enabled = VALUES(enabled)`,
    [id, kind, enabled ? 1 : 0],
  );
}

/** Most recent actor runs for the dashboard activity log (best-effort). */
export async function recentActorRuns(limit = 20): Promise<ActorRunRecord[]> {
  if (!pool || !healthy) return [];
  try {
    const [rows] = await pool.query(
      `SELECT actor_id, params, rule_id, status, error, UNIX_TIMESTAMP(created_at) * 1000 AS at
       FROM actor_runs ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      actorId: String(r.actor_id),
      params: safeParse(r.params),
      rule: r.rule_id ? String(r.rule_id) : undefined,
      status: r.status as 'ok' | 'error',
      error: r.error ? String(r.error) : undefined,
      at: Number(r.at),
    }));
  } catch {
    return [];
  }
}

function safeParse(v: unknown): Record<string, unknown> {
  try {
    return JSON.parse(String(v));
  } catch {
    return {};
  }
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
}
