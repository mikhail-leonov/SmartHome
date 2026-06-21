/**
 * PluginLoader — yt-dlp-style auto-discovery.
 *
 * Scans `src/sensors/` and `src/actors/`, dynamically imports every module,
 * validates its exported manifest, and registers it. Adding a file to either
 * directory is all it takes for a plugin to appear — there is zero central
 * wiring. Broken plugins are reported and skipped; they never crash the app.
 *
 * Each plugin module must default-export (or named-export `plugin`) an object
 * conforming to SensorPlugin / ActorPlugin.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, extname, basename } from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';
import { registerPlugin } from '../db/index.js';
import type { ActorPlugin, SensorPlugin, Trigger } from '../types/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LoadedPlugins {
  sensors: SensorPlugin[];
  actors: Map<string, ActorPlugin>;
}

/** Files that are infrastructure, not plugins. */
const IGNORE = new Set(['index', 'loader']);

function isPluginFile(file: string): boolean {
  const ext = extname(file);
  if (ext !== '.ts' && ext !== '.js') return false;
  if (file.endsWith('.d.ts') || file.endsWith('.map')) return false;
  return !IGNORE.has(basename(file, ext));
}

function pickExport<T>(mod: Record<string, unknown>): T | undefined {
  if (mod.default) return mod.default as T;
  if (mod.plugin) return mod.plugin as T;
  return undefined;
}

function validateTrigger(t: unknown): t is Trigger {
  if (!t || typeof t !== 'object') return false;
  const trig = t as { type?: string };
  switch (trig.type) {
    case 'interval':
      return typeof (t as { everyMs?: unknown }).everyMs === 'number';
    case 'cron':
      return typeof (t as { expression?: unknown }).expression === 'string';
    case 'seasonal':
      return typeof (t as { on?: unknown }).on === 'string';
    case 'event':
      return true;
    default:
      return false;
  }
}

function validateSensor(p: unknown): p is SensorPlugin {
  const s = p as Partial<SensorPlugin>;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.run === 'function' &&
    validateTrigger(s.trigger)
  );
}

function validateActor(p: unknown): p is ActorPlugin {
  const a = p as Partial<ActorPlugin>;
  return (
    !!a &&
    typeof a.id === 'string' &&
    typeof a.name === 'string' &&
    typeof a.description === 'string' &&
    typeof a.execute === 'function'
  );
}

function isEnabled(id: string): boolean {
  // Absent flag → enabled by default.
  return config.plugins[id] !== false;
}

async function loadDir<T>(
  dir: string,
  validate: (p: unknown) => p is T,
): Promise<{ ok: T[]; skipped: number }> {
  const abs = resolve(__dirname, '..', dir);
  let files: string[];
  try {
    files = readdirSync(abs).filter(isPluginFile);
  } catch {
    logger.warn('loader', `directory not found: ${dir}`);
    return { ok: [], skipped: 0 };
  }

  const ok: T[] = [];
  let skipped = 0;

  for (const file of files) {
    const fileUrl = pathToFileURL(resolve(abs, file)).href;
    try {
      const mod = (await import(fileUrl)) as Record<string, unknown>;
      const plugin = pickExport<T>(mod);
      if (!plugin || !validate(plugin)) {
        logger.warn('loader', `skipped ${dir}/${file} — invalid or missing manifest`);
        skipped++;
        continue;
      }
      ok.push(plugin);
    } catch (err) {
      logger.error('loader', `failed to load ${dir}/${file}: ${(err as Error).message}`);
      skipped++;
    }
  }
  return { ok, skipped };
}

/** Discover and register all sensor and actor plugins. */
export async function loadPlugins(): Promise<LoadedPlugins> {
  logger.info('loader', 'discovering plugins…');

  const sensorRes = await loadDir<SensorPlugin>('sensors', validateSensor);
  const actorRes = await loadDir<ActorPlugin>('actors', validateActor);

  const sensors: SensorPlugin[] = [];
  for (const s of sensorRes.ok) {
    const enabled = isEnabled(s.id);
    await registerPlugin(s.id, 'sensor', enabled);
    if (!enabled) {
      logger.warn('loader', `sensor disabled by config: ${s.id}`);
      continue;
    }
    sensors.push(s);
    logger.ok('loader', `+ sensor  ${s.id}  (${describeTrigger(s.trigger)})`);
  }

  const actors = new Map<string, ActorPlugin>();
  for (const a of actorRes.ok) {
    const enabled = isEnabled(a.id);
    await registerPlugin(a.id, 'actor', enabled);
    if (!enabled) {
      logger.warn('loader', `actor disabled by config: ${a.id}`);
      continue;
    }
    actors.set(a.id, a);
    logger.ok('loader', `+ actor   ${a.id}  (${Object.keys(a.params ?? {}).join(', ') || 'no params'})`);
  }

  const skipped = sensorRes.skipped + actorRes.skipped;
  logger.info(
    'loader',
    `loaded ${sensors.length} sensor(s), ${actors.size} actor(s)${skipped ? `, skipped ${skipped}` : ''}`,
  );

  return { sensors, actors };
}

function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case 'interval':
      return `interval ${Math.round(t.everyMs / 1000)}s`;
    case 'cron':
      return `cron "${t.expression}"`;
    case 'seasonal':
      return `seasonal ${t.on}`;
    case 'event':
      return `event ${t.topic ?? t.eventName ?? '?'}`;
  }
}
