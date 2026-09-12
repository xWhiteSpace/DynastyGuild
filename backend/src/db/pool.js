import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (Supabase Postgres connection string)');
  }
  pool = new Pool({
    connectionString,
    max: 8,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
  });
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}
