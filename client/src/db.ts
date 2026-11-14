// Просмотрщик БД для разработки: таблицы + read-only SQL.
interface Table { name: string; count: number; fields: string[]; rows: Record<string, unknown>[] }

const $ = (id: string) => document.getElementById(id)!;
let tables: Table[] = [];
let current = 'shifts';
const seen = new Map<string, Set<string>>();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function cell(v: unknown, field: string): string {
  if (v === null || v === undefined) return '<td class="muted">null</td>';
  if (typeof v === 'number') return `<td class="num ${v < 0 ? 'neg' : ''}">${v}</td>`;
  if (typeof v === 'object' && !(v instanceof Date)) return `<td class="json">${esc(JSON.stringify(v))}</td>`;
  const s = String(v);
  if (field.endsWith('_at') || v instanceof Date) {
    const d = new Date(s);
    if (!isNaN(+d)) return `<td>${d.toLocaleString('ru-RU')}</td>`;
  }
  return `<td>${esc(s)}</td>`;
}

function renderTable(el: HTMLElement, fields: string[], rows: Record<string, unknown>[], key?: string) {
  if (!rows.length) {
    el.innerHTML = '<div class="empty">пусто — сыграйте смену</div>';
    return;
  }
  const known = key ? seen.get(key) : undefined;
  const ids = new Set<string>();
  const body = rows
    .map((r) => {
      const id = JSON.stringify(r);
      ids.add(id);
      const isNew = known && !known.has(id);
      return `<tr class="${isNew ? 'new' : ''}">${fields.map((f) => cell(r[f], f)).join('')}</tr>`;
    })
    .join('');
  if (key) seen.set(key, ids);
  el.innerHTML = `<table><thead><tr>${fields.map((f) => `<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

function render() {
  $('tabs').innerHTML = tables
    .map((t) => `<button data-t="${t.name}" class="${t.name === current ? 'on' : ''}">${t.name} <b>${t.count}</b></button>`)
    .join('');
  $('tabs').querySelectorAll('button').forEach((b) => {
    (b as HTMLButtonElement).onclick = () => { current = b.getAttribute('data-t')!; render(); };
  });
  const t = tables.find((x) => x.name === current);
  if (t) renderTable($('table'), t.fields, t.rows, t.name);
}

async function load() {
  try {
    const res = await fetch('/api/dev/tables');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tables = await res.json();
    render();
  } catch (e) {
    $('table').innerHTML = `<div class="empty">Нет доступа к БД. Просмотр работает только при запуске <b>npm run dev</b>.<br/>${esc(String(e))}</div>`;
  }
}

const PRESETS: [string, string][] = [
  ['баланс водителей', `SELECT p.name, s.money, s.day, s.vehicle, s.upgrades\nFROM players p JOIN saves s ON s.player_id = p.id\nORDER BY s.money DESC;`],
  ['точность по дням', `SELECT day, count(*) AS смен,\n       round(100.0 * sum(correct) / nullif(sum(ops), 0)) AS точность_проц,\n       round(avg(avg_ms) / 1000.0, 1) AS сек_на_пассажира\nFROM shifts GROUP BY day ORDER BY day;`],
  ['куда уходят деньги', `SELECT sum(revenue) AS выручка, sum(fuel_cost) AS бензин,\n       sum(rent) AS аренда, sum(fines) AS штрафы, sum(profit) AS прибыль\nFROM shifts;`],
  ['последние смены', `SELECT id, day, vehicle, passengers, revenue, profit, correct || '/' || ops AS сдача, falls, created_at\nFROM shifts ORDER BY id DESC LIMIT 10;`],
];

async function run() {
  $('err').textContent = '';
  const sql = ($('q') as HTMLTextAreaElement).value;
  const res = await fetch('/api/dev/sql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  const data = await res.json();
  if (!res.ok) { $('err').textContent = data.error ?? `HTTP ${res.status}`; $('result').innerHTML = ''; return; }
  renderTable($('result'), data.fields, data.rows);
}

$('presets').innerHTML = PRESETS.map(([n], i) => `<button data-i="${i}">${n}</button>`).join('');
$('presets').querySelectorAll('button').forEach((b) => {
  (b as HTMLButtonElement).onclick = () => {
    ($('q') as HTMLTextAreaElement).value = PRESETS[Number(b.getAttribute('data-i'))][1];
    run();
  };
});
($('q') as HTMLTextAreaElement).value = PRESETS[0][1];
($('q') as HTMLTextAreaElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
});
$('run').onclick = run;
$('refresh').onclick = load;
setInterval(() => { if (($('auto') as HTMLInputElement).checked && !document.hidden) load(); }, 3000);
load();
