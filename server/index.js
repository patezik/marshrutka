import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { initDb, query, readOnlyQuery, closeDb } from './db.js';
import { START_MONEY, VEHICLES, UPGRADES, dayConfig } from '../shared/catalog.js';

const app = express();
app.use(express.json({ limit: '32kb' }));

const ID_RE = /^[0-9a-f-]{36}$/;
const int = (v, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
};
const cleanName = (s) =>
  String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);

function saveDto(row) {
  return {
    money: row.money,
    day: row.day,
    vehicle: row.vehicle,
    owned: row.owned,
    upgrades: row.upgrades,
  };
}

async function loadPlayer(id) {
  if (!ID_RE.test(id)) return null;
  const rows = await query(
    `SELECT p.id, p.name, s.money, s.day, s.vehicle, s.owned, s.upgrades
       FROM players p JOIN saves s ON s.player_id = p.id WHERE p.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, name: r.name, save: saveDto(r) };
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'server' });
  });

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Новый водитель
app.post('/api/players', wrap(async (req, res) => {
  const id = randomUUID();
  const name = cleanName(req.body?.name) || `Водитель №${Math.floor(1000 + Math.random() * 9000)}`;
  await query(`INSERT INTO players (id, name) VALUES ($1, $2)`, [id, name]);
  await query(`INSERT INTO saves (player_id, money) VALUES ($1, $2)`, [id, START_MONEY]);
  res.json(await loadPlayer(id));
}));

app.get('/api/players/:id', wrap(async (req, res) => {
  const p = await loadPlayer(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(p);
}));

app.patch('/api/players/:id', wrap(async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name || !ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_name' });
  await query(`UPDATE players SET name = $2 WHERE id = $1`, [req.params.id, name]);
  const p = await loadPlayer(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(p);
}));

// Итоги смены: сервер пересчитывает прибыль и двигает день.
app.post('/api/players/:id/shifts', wrap(async (req, res) => {
  const p = await loadPlayer(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const b = req.body ?? {};
  const cfg = dayConfig(p.save.day);

  const s = {
    passengers: int(b.passengers, 0, 500),
    revenue: int(b.revenue, -20000, 50000),
    fuel_cost: int(b.fuelCost, 0, 20000),
    fines: int(b.fines, 0, 50000),
    ops: int(b.ops, 0, 500),
    correct: int(b.correct, 0, 500),
    avg_ms: int(b.avgMs, 0, 600000),
    falls: int(b.falls, 0, 500),
    duration_s: int(b.durationS, 0, 7200),
  };
  s.correct = Math.min(s.correct, s.ops);
  const rent = cfg.rent;
  const profit = s.revenue - s.fuel_cost - rent - s.fines;

  await query(
    `INSERT INTO shifts (player_id, day, vehicle, passengers, revenue, fuel_cost, rent, fines, profit,
                         ops, correct, avg_ms, falls, duration_s)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [p.id, p.save.day, p.save.vehicle, s.passengers, s.revenue, s.fuel_cost, rent, s.fines, profit,
     s.ops, s.correct, s.avg_ms, s.falls, s.duration_s],
  );
  await query(
    `UPDATE saves SET money = money + $2, day = day + 1, updated_at = now() WHERE player_id = $1`,
    [p.id, profit],
  );
  res.json({ profit, rent, player: await loadPlayer(p.id) });
}));

// Покупки в гараже
app.post('/api/players/:id/buy', wrap(async (req, res) => {
  const p = await loadPlayer(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const item = String(req.body?.item ?? '');
  const save = p.save;

  if (VEHICLES[item]) {
    if (save.owned.includes(item)) {
      await query(`UPDATE saves SET vehicle = $2, updated_at = now() WHERE player_id = $1`, [p.id, item]);
      return res.json(await loadPlayer(p.id));
    }
    const price = VEHICLES[item].price;
    if (save.money < price) return res.status(400).json({ error: 'no_money' });
    await query(
      `UPDATE saves SET money = money - $2, vehicle = $3, owned = owned || $4::jsonb, updated_at = now()
        WHERE player_id = $1 AND money >= $2`,
      [p.id, price, item, JSON.stringify([item])],
    );
    return res.json(await loadPlayer(p.id));
  }

  if (UPGRADES[item]) {
    if (save.upgrades.includes(item)) return res.status(400).json({ error: 'owned' });
    const price = UPGRADES[item].price;
    if (save.money < price) return res.status(400).json({ error: 'no_money' });
    await query(
      `UPDATE saves SET money = money - $2, upgrades = upgrades || $3::jsonb, updated_at = now()
        WHERE player_id = $1 AND money >= $2`,
      [p.id, price, JSON.stringify([item])],
    );
    return res.json(await loadPlayer(p.id));
  }

  res.status(400).json({ error: 'unknown_item' });
}));

// История смен игрока (для графика «как я считаю»)
app.get('/api/players/:id/shifts', wrap(async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
  const rows = await query(
    `SELECT day, vehicle, passengers, revenue, fuel_cost, rent, fines, profit, ops, correct, avg_ms, falls,
            duration_s, created_at
       FROM shifts WHERE player_id = $1 ORDER BY id DESC LIMIT 20`,
    [req.params.id],
  );
  res.json(rows.reverse());
}));

// Доска почёта депо: лучшие смены по прибыли
app.get('/api/leaderboard', wrap(async (_req, res) => {
  const rows = await query(
    `SELECT DISTINCT ON (p.id) p.name, s.profit, s.day, s.correct, s.ops
       FROM shifts s JOIN players p ON p.id = s.player_id
      ORDER BY p.id, s.profit DESC`,
  );
  rows.sort((a, b) => b.profit - a.profit);
  res.json(rows.slice(0, 10));
}));

// ---------- Просмотр БД (только в dev-режиме: npm run dev) ----------
const DEV = process.argv.includes('--dev');
if (DEV) {
  const TABLES = ['players', 'saves', 'shifts'];
  app.get('/api/dev/tables', wrap(async (_req, res) => {
    const out = [];
    for (const t of TABLES) {
      const order = t === 'shifts' ? 'id DESC' : t === 'players' ? 'created_at DESC' : 'updated_at DESC';
      const [{ count }] = await query(`SELECT count(*)::int AS count FROM ${t}`);
      const r = await readOnlyQuery(`SELECT * FROM ${t} ORDER BY ${order} LIMIT 200`);
      out.push({ name: t, count, ...r });
    }
    res.json(out);
  }));
  app.post('/api/dev/sql', wrap(async (req, res) => {
    const sql = String(req.body?.sql ?? '').trim();
    if (!sql) return res.status(400).json({ error: 'empty' });
    try {
      res.json(await readOnlyQuery(sql));
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  }));
}

// Статика собранного клиента
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// В dev-режиме API всегда на 3001 (Vite проксирует туда), в проде — PORT от хостинга.
const port = process.argv.includes('--dev') ? 3001 : Number(process.env.PORT) || 3001;
const kind = await initDb();
const server = app.listen(port, () => console.log(`API на :${port}, БД: ${kind}`));

// Аккуратно закрываем базу при остановке (Ctrl+C, сигнал от хостинга)
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    server.close();
    try { await closeDb(); } catch { /* уже закрыта */ }
    process.exit(0);
  });
}
