import './style.css';
import { VEHICLES, UPGRADES, dayConfig } from '../../shared/catalog.js';
import { api, bootPlayer, Player, ShiftRow, LeaderRow } from './api';
import { sfx } from './audio';
import { ICON } from './icons';
import { Shift, ShiftResult } from './game/shift';
import { drawBus, drawPerson, DRIVER, rrect } from './game/draw';

const app = document.getElementById('app')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
let player: Player;
let shift: Shift | null = null;

const VEHICLE_NAME: Record<string, string> = { pazik: 'Пазик', gazelle: 'Газелька', citybus: 'Городской' };
const UPGRADE_INFO: Record<string, { name: string; hint: string; icon: string }> = {
  freshener: { name: 'Ёлочка', hint: 'терпеливее', icon: ICON.tree },
  calculator: { name: 'Калькулятор', hint: 'Σ сдачи', icon: ICON.calc },
  suspension: { name: 'Подвеска', hint: 'меньше падают', icon: ICON.spring },
  engine: { name: 'Мотор', hint: '−25% бензина', icon: ICON.engine },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ru-RU')}`;

function show(view: 'loading' | 'garage' | 'game' | 'summary' | 'error') {
  document.body.dataset.view = view;
}

// ---------------- загрузка ----------------

async function boot() {
  show('loading');
  app.innerHTML = `<div class="center"><div class="spinner"></div></div>`;
  try {
    player = await bootPlayer();
    await garage();
  } catch (e) {
    console.error(e);
    show('error');
    app.innerHTML = `
      <div class="center col">
        <div class="big-ico">${ICON.lock}</div>
        <p class="muted">Нет связи с депо (сервером)</p>
        <button class="btn" id="retry">${ICON.play}<span>Ещё раз</span></button>
      </div>`;
    document.getElementById('retry')!.onclick = boot;
  }
}

// ---------------- гараж ----------------

function busCanvas(id: string, w: number, h: number, scale: number, withDriver = false) {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = w * dpr;
  c.height = h * dpr;
  c.style.width = '100%';
  c.style.aspectRatio = `${w} / ${h}`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr * scale, dpr * scale);
  const spec = VEHICLES[id as keyof typeof VEHICLES];
  const lw = w / scale, lh = h / scale;
  const x0 = (lw - spec.length) / 2 - (withDriver ? 30 : 0);
  const gy = lh - 16;
  drawBus(ctx, spec, { x0, gy, wheelRot: 0.4, doorOpen: withDriver ? 1 : 0, night: 0, pitch: 0 });
  if (withDriver) drawPerson(ctx, x0 + spec.length + 60, gy - 2, DRIVER, { mood: 0.9 });
  return c;
}

function chart(rows: ShiftRow[]) {
  if (!rows.length) return `<div class="empty">${ICON.brain}<span>—</span></div>`;
  const W = 320, H = 120, pad = 8;
  const n = Math.max(rows.length, 12);
  const bw = (W - pad * 2) / n;
  const maxS = Math.max(8, ...rows.map((r) => r.avg_ms / 1000));
  let bars = '', pts = '';
  rows.forEach((r, i) => {
    const acc = r.ops ? r.correct / r.ops : 0;
    const bh = (H - 20) * acc;
    const x = pad + i * bw;
    const col = acc >= 0.9 ? 'var(--good)' : acc >= 0.6 ? 'var(--warn)' : 'var(--bad)';
    bars += `<rect x="${x + bw * 0.15}" y="${H - bh}" width="${bw * 0.7}" height="${bh}" rx="2" fill="${col}" opacity=".85"><title>${Math.round(acc * 100)}%</title></rect>`;
    const sy = H - ((r.avg_ms / 1000) / maxS) * (H - 20);
    pts += `${x + bw / 2},${sy} `;
  });
  const last = rows[rows.length - 1], first = rows[0];
  const dS = (last.avg_ms - first.avg_ms) / 1000;
  const accLast = last.ops ? Math.round((last.correct / last.ops) * 100) : 0;
  return `
    <svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">
      ${bars}
      <polyline points="${pts.trim()}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    <div class="chart-legend">
      <span class="pill"><i class="sw good"></i>${ICON.check} ${accLast}%</span>
      <span class="pill"><i class="sw ink"></i>${ICON.clock} ${(last.avg_ms / 1000).toFixed(1)} с</span>
      ${rows.length > 1 && Math.abs(dS) >= 0.05 ? `<span class="pill ${dS <= 0 ? 'up' : 'down'}">${ICON.brain} ${dS <= 0 ? '−' : '+'}${Math.abs(dS).toFixed(1)} с</span>` : ''}
    </div>`;
}

function leaders(rows: LeaderRow[]) {
  if (!rows.length) return `<div class="empty">${ICON.trophy}<span>—</span></div>`;
  return `<ol class="leaders">${rows
    .map((r) => `<li class="${r.name === player.name ? 'me' : ''}"><span>${esc(r.name)}</span><b>${fmt(r.profit)}</b></li>`)
    .join('')}</ol>`;
}

async function garage() {
  show('garage');
  const s = player.save;
  const cfg = dayConfig(s.day);
  app.innerHTML = `
  <div class="garage">
    <header class="top">
      <div class="logo">Передайте<br/>за проезд</div>
      <button class="chip name" id="rename" title="Имя">${ICON.edit}<span>${esc(player.name)}</span></button>
      <div class="chip money">${ICON.coin}<b>${fmt(s.money)}</b></div>
      <div class="chip day"><small>день</small><b>${s.day}</b></div>
    </header>

    <section class="hero">
      <div class="hero-bus" id="heroBus"></div>
      <div class="hero-side">
        <div class="ticket">
          <div class="t-row"><span class="t-ico">${ICON.stand}</span><b>${cfg.fare}</b><small>₽</small></div>
          ${cfg.kids ? `<div class="t-row kid"><span class="t-ico">${ICON.stand}</span><b>${cfg.kidFare}</b><small>₽</small></div>` : ''}
          <div class="t-row dim"><span class="t-ico">${ICON.key}</span><b>−${cfg.rent}</b></div>
          <div class="t-stops">${'<i></i>'.repeat(cfg.stops)}</div>
        </div>
        <button class="btn go" id="go">${ICON.play}<span>В рейс</span></button>
      </div>
    </section>

    <section class="grid">
      <div class="card">
        <h3>${ICON.seat} Машины</h3>
        <div class="vehicles" id="vehicles"></div>
      </div>
      <div class="card">
        <h3>${ICON.engine} Тюнинг</h3>
        <div class="upgrades" id="upgrades"></div>
      </div>
      <div class="card">
        <h3>${ICON.brain} Как я считаю</h3>
        <div id="chart"><div class="spinner sm"></div></div>
      </div>
      <div class="card">
        <h3>${ICON.trophy} Доска почёта</h3>
        <div id="leaders"><div class="spinner sm"></div></div>
      </div>
    </section>
  </div>`;

  document.getElementById('heroBus')!.appendChild(busCanvas(s.vehicle, 640, 190, 1, true));

  // машины
  const vEl = document.getElementById('vehicles')!;
  for (const v of Object.values(VEHICLES)) {
    const owned = s.owned.includes(v.id);
    const cur = s.vehicle === v.id;
    const afford = s.money >= v.price;
    const card = document.createElement('button');
    card.className = `veh ${cur ? 'cur' : ''} ${!owned && !afford ? 'locked' : ''}`;
    card.appendChild(busCanvas(v.id, 240, 80, 0.48));
    const bars = (k: number) => `<span class="bars">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < k ? 'on' : ''}"></i>`).join('')}</span>`;
    const info = document.createElement('div');
    info.className = 'veh-info';
    info.innerHTML = `
      <div class="veh-name">${VEHICLE_NAME[v.id]}</div>
      <div class="veh-stats">
        <span>${ICON.seat}${v.seats}</span><span>${ICON.stand}${v.standing}</span>
        <span>${ICON.speed}${bars(Math.round((v.maxV - 300) / 40))}</span>
        <span>${ICON.fuel}${bars(Math.round((1.2 - v.fuelRate) * 8))}</span>
      </div>
      <div class="veh-price">${cur ? ICON.check : owned ? '' : `${ICON.coin}${fmt(v.price)}`}</div>`;
    card.appendChild(info);
    card.onclick = async () => {
      if (cur || (!owned && !afford)) { sfx.unlock(); sfx.click(); return; }
      sfx.unlock();
      try {
        player = await api.buy(player.id, v.id);
        owned ? sfx.click() : sfx.kaching();
        garage();
      } catch { sfx.sad(); }
    };
    vEl.appendChild(card);
  }

  // тюнинг
  const uEl = document.getElementById('upgrades')!;
  for (const u of Object.values(UPGRADES)) {
    const owned = s.upgrades.includes(u.id);
    const afford = s.money >= u.price;
    const info = UPGRADE_INFO[u.id];
    const b = document.createElement('button');
    b.className = `upg ${owned ? 'owned' : ''} ${!owned && !afford ? 'locked' : ''}`;
    b.innerHTML = `
      <span class="upg-ico">${info.icon}</span>
      <span class="upg-name">${info.name}<small>${info.hint}</small></span>
      <span class="upg-price">${owned ? ICON.check : `${ICON.coin}${fmt(u.price)}`}</span>`;
    b.onclick = async () => {
      sfx.unlock();
      if (owned || !afford) { sfx.click(); return; }
      try {
        player = await api.buy(player.id, u.id);
        sfx.kaching();
        garage();
      } catch { sfx.sad(); }
    };
    uEl.appendChild(b);
  }

  document.getElementById('go')!.onclick = () => { sfx.unlock(); startShift(); };
  document.getElementById('rename')!.onclick = async () => {
    const name = prompt('Как вас зовут в депо?', player.name);
    if (!name || !name.trim()) return;
    try { player = await api.rename(player.id, name.trim()); garage(); } catch { sfx.sad(); }
  };

  api.history(player.id).then((rows) => { const el = document.getElementById('chart'); if (el) el.innerHTML = chart(rows); }).catch(() => {});
  api.leaderboard().then((rows) => { const el = document.getElementById('leaders'); if (el) el.innerHTML = leaders(rows); }).catch(() => {});
}

// ---------------- смена ----------------

function startShift() {
  show('game');
  app.innerHTML = '';
  const s = player.save;
  shift = new Shift(canvas, {
    day: s.day,
    vehicle: s.vehicle,
    upgrades: s.upgrades,
    onEnd: (r) => { shift = null; summary(r); },
    onQuit: () => { shift = null; garage(); },
  });
  if (import.meta.env.DEV) (window as any).__shift = shift;
}

// ---------------- итоги ----------------

async function summary(r: ShiftResult) {
  show('summary');
  const profit = r.revenue - r.fuelCost - r.rent - r.fines;
  const line = (icon: string, value: number, extra = '', cls = '') =>
    `<li class="${cls}"><span class="r-ico">${icon}</span><span class="r-extra">${extra}</span><b class="${value < 0 ? 'neg' : 'pos'}">${value >= 0 ? '+' : ''}${fmt(value)}</b></li>`;
  const rows = [
    line(ICON.coin, r.revenue, `${r.passengers} ${ICON.stand}`),
    line(ICON.fuel, -r.fuelCost),
    line(ICON.key, -r.rent),
    r.redCount ? line(ICON.camera, -r.redFine, `×${r.redCount}`) : '',
    r.complaintCount ? line(ICON.angry, -r.complaintFine, `×${r.complaintCount}`) : '',
    r.lateS ? line(ICON.clock, -r.lateFine, `${r.lateS} с`) : '',
  ].filter(Boolean);
  const acc = r.ops ? Math.round((r.correct / r.ops) * 100) : 0;
  app.innerHTML = `
  <div class="summary">
    <div class="receipt">
      <div class="r-head"><span>№47</span><span>день ${player.save.day}</span></div>
      <ul class="r-lines">${rows.map((l, i) => l.replace('<li', `<li style="--i:${i}"`)).join('')}</ul>
      <div class="r-total" style="--i:${rows.length}"><span>=</span><b class="${profit < 0 ? 'neg' : 'pos'}">${profit >= 0 ? '+' : ''}${fmt(profit)}</b></div>
      <div class="r-skill" style="--i:${rows.length + 1}">
        <span class="pill">${ICON.check} ${r.correct}/${r.ops}</span>
        <span class="pill">${ICON.clock} ${(r.avgMs / 1000).toFixed(1)} с</span>
        <span class="pill">${ICON.fall} ${r.falls}</span>
        ${r.tips ? `<span class="pill">${ICON.heart} +${r.tips}</span>` : ''}
      </div>
      <div class="r-grade grade-${acc >= 90 ? 'a' : acc >= 60 ? 'b' : 'c'}" style="--i:${rows.length + 2}">${acc}%</div>
      <div class="r-zigzag"></div>
    </div>
    <div class="actions">
      <button class="btn ghost" id="home" disabled>${ICON.home}</button>
      <button class="btn go" id="next" disabled>${ICON.play}<span>Дальше</span></button>
    </div>
    <p class="saving muted" id="saving"><span class="spinner sm"></span></p>
  </div>`;

  const saving = document.getElementById('saving')!;
  const enable = () => {
    (document.getElementById('home') as HTMLButtonElement).disabled = false;
    (document.getElementById('next') as HTMLButtonElement).disabled = false;
  };
  document.getElementById('home')!.onclick = () => garage();
  document.getElementById('next')!.onclick = () => startShift();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await api.submitShift(player.id, {
        passengers: r.passengers,
        revenue: r.revenue,
        fuelCost: r.fuelCost,
        fines: r.fines,
        ops: r.ops,
        correct: r.correct,
        avgMs: r.avgMs,
        falls: r.falls,
        durationS: r.durationS,
      });
      player = res.player;
      saving.innerHTML = `${ICON.coin} ${fmt(player.save.money)}`;
      enable();
      return;
    } catch {
      await new Promise((ok) => setTimeout(ok, 1200));
    }
  }
  saving.innerHTML = `<span class="neg">не сохранилось</span>`;
  enable();
}

// маленькая заставка-иконка (favicon) рисуется кодом
(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f2c230';
  rrect(x, 4, 14, 56, 36, 8);
  x.fill();
  x.fillStyle = '#2b3a55';
  x.fillRect(10, 20, 30, 12);
  x.fillStyle = '#1b1c22';
  x.beginPath(); x.arc(18, 50, 7, 0, 7); x.arc(46, 50, 7, 0, 7); x.fill();
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = c.toDataURL();
  document.head.appendChild(link);
})();

window.addEventListener('beforeunload', () => shift?.destroy());
boot();
