import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured before running migrations.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000
});

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const filename of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [738291]);
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );
      if (!rowCount) {
        const sql = await readFile(path.join(directory, filename), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        console.log(`Applied migration ${filename}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
