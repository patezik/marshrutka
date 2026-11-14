// Слой БД — всегда PostgreSQL.
// На хостинге: строка подключения из DATABASE_URL (Neon, Supabase, Render Postgres…).
// Локально без DATABASE_URL: свой PostgreSQL-сервер в .data/pg на localhost:5433 (server/localpg.js).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saves (
  player_id   TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  money       INTEGER NOT NULL,
  day         INTEGER NOT NULL DEFAULT 1,
  vehicle     TEXT NOT NULL DEFAULT 'pazik',
  owned       JSONB NOT NULL DEFAULT '["pazik"]',
  upgrades    JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shifts (
  id              SERIAL PRIMARY KEY,
  player_id       TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day             INTEGER NOT NULL,
  vehicle         TEXT NOT NULL,
  passengers      INTEGER NOT NULL,
  revenue         INTEGER NOT NULL,
  fuel_cost       INTEGER NOT NULL,
  rent            INTEGER NOT NULL,
  fines           INTEGER NOT NULL,
  profit          INTEGER NOT NULL,
  ops             INTEGER NOT NULL,
  correct         INTEGER NOT NULL,
  avg_ms          INTEGER NOT NULL,
  falls           INTEGER NOT NULL,
  duration_s      INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shifts_player_idx ON shifts(player_id, id DESC);
CREATE INDEX IF NOT EXISTS shifts_profit_idx ON shifts(profit DESC);
`;

let impl = null;
let closeFn = async () => {};

export async function initDb() {
  const { default: pg } = await import('pg');
  let url = process.env.DATABASE_URL;
  let kind;
  let stopLocal = async () => {};
  if (url) {
    kind = `postgres (${new URL(url).hostname})`;
  } else {
    if (!process.argv.includes('--dev')) {
      console.warn('[db] ВНИМАНИЕ: DATABASE_URL не задан — запускаю локальный PostgreSQL. ' +
        'На хостинге обязательно задайте DATABASE_URL (облачная база), иначе данные пропадут при пересборке.');
    }
    // Локальная разработка: свой PostgreSQL в .data/pg (см. server/localpg.js)
    const { startLocalPostgres, LOCAL_PG } = await import('./localpg.js');
    const local = await startLocalPostgres();
    url = local.url;
    stopLocal = local.stop;
    kind = `локальный postgres localhost:${LOCAL_PG.port}/${LOCAL_PG.database}${local.reused ? ' (уже был запущен)' : ''}`;
  }
  const pool = new pg.Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 5,
  });
  closeFn = async () => {
    await pool.end();
    await stopLocal();
  };
  impl = {
    query: async (text, params) => (await pool.query(text, params)).rows,
    exec: async (text) => { await pool.query(text); },
    readOnly: async (text) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const r = await client.query(text);
        return { fields: r.fields.map((f) => f.name), rows: r.rows };
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },
  };
  await impl.exec(SCHEMA);
  return kind;
}

export function query(text, params = []) {
  if (!impl) throw new Error('DB not initialised');
  return impl.query(text, params);
}

/** Только чтение: запрос выполняется в READ ONLY транзакции и откатывается. Для просмотрщика БД в dev-режиме. */
export function readOnlyQuery(text) {
  if (!impl) throw new Error('DB not initialised');
  return impl.readOnly(text);
}

export async function closeDb() {
  await closeFn();
}
