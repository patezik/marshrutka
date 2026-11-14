// Локальный PostgreSQL для разработки (только когда нет DATABASE_URL).
// Это настоящий сервер PostgreSQL отдельным процессом: файлы в .data/pg, порт 5433.
// На хостинге не используется — там база берётся из DATABASE_URL (Neon и т. п.).
import fs from 'node:fs';
import path from 'node:path';

export const LOCAL_PG = {
  host: 'localhost',
  port: Number(process.env.LOCAL_PG_PORT) || 5433,
  user: 'depot',
  password: 'depot',
  database: 'marshrutka',
  dir: process.env.LOCAL_PG_DIR || './.data/pg',
};

const urlFor = (db) =>
  `postgresql://${LOCAL_PG.user}:${LOCAL_PG.password}@${LOCAL_PG.host}:${LOCAL_PG.port}/${db}`;

async function canConnect(pg, db) {
  const c = new pg.Client({ connectionString: urlFor(db), connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    try { await c.end(); } catch { /* не подключились */ }
    return false;
  }
}

/** Поднимает (или переиспользует уже запущенный) локальный Postgres и возвращает строку подключения. */
export async function startLocalPostgres() {
  const { default: pg } = await import('pg');

  // Сервер мог остаться работать после прошлого запуска — тогда просто подключаемся.
  if (await canConnect(pg, LOCAL_PG.database)) {
    return { url: urlFor(LOCAL_PG.database), stop: async () => {}, reused: true };
  }

  let EmbeddedPostgres;
  try {
    ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
  } catch {
    throw new Error('Нет DATABASE_URL и не установлен embedded-postgres. Выполните npm install или задайте DATABASE_URL.');
  }

  const dir = path.resolve(LOCAL_PG.dir);
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    port: LOCAL_PG.port,
    user: LOCAL_PG.user,
    password: LOCAL_PG.password,
    persistent: true,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (e) => {
      const msg = String(e?.message ?? e);
      if (/error|fatal|panic/i.test(msg)) console.error('[postgres]', msg.trim());
    },
  });

  if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
    console.log(`[db] создаю локальный PostgreSQL в ${LOCAL_PG.dir}…`);
    await server.initialise();
  } else {
    // Процесс сервера не отвечает, значит pid-файл остался от аварийного завершения.
    const pid = path.join(dir, 'postmaster.pid');
    if (fs.existsSync(pid)) fs.rmSync(pid);
  }
  await server.start();

  if (!(await canConnect(pg, LOCAL_PG.database))) {
    await server.createDatabase(LOCAL_PG.database);
  }
  return { url: urlFor(LOCAL_PG.database), stop: () => server.stop(), reused: false };
}
