/**
 * Database initialiser.
 *
 *   npm run db:init
 *
 * Connects to MySQL (without selecting a database, so it can CREATE one),
 * splits schema.sql into statements and applies them. Safe to run repeatedly.
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const schemaPath = resolve(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');

  logger.info('db:init', `connecting to mysql://${config.db.host}:${config.db.port}`);

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });

  // Split on semicolons at end of line; keep it simple since the schema is ours.
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    await conn.query(stmt);
  }

  await conn.end();
  logger.ok('db:init', `schema applied (${statements.length} statements). Database ready.`);
}

main().catch((err) => {
  logger.error('db:init', err.message);
  process.exit(1);
});
