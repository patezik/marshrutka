export interface Save {
  money: number;
  day: number;
  vehicle: string;
  owned: string[];
  upgrades: string[];
}
export interface Player {
  id: string;
  name: string;
  save: Save;
}
export interface ShiftRow {
  day: number;
  vehicle: string;
  passengers: number;
  revenue: number;
  fuel_cost: number;
  rent: number;
  fines: number;
  profit: number;
  ops: number;
  correct: number;
  avg_ms: number;
  falls: number;
  duration_s: number;
}
export interface LeaderRow {
  name: string;
  profit: number;
  day: number;
  correct: number;
  ops: number;
}

const KEY = 'marshrutka.playerId';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    try { (err as any).code = (await res.json()).error; } catch { /* нет тела */ }
    throw err;
  }
  return res.json() as Promise<T>;
}

function storedId(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function storeId(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* приватный режим */ }
}

// ---------- Два бэкенда ----------
// 1) Supabase (сайт на GitHub Pages): браузер вызывает функции базы через REST (POST /rest/v1/rpc/<имя>).
//    Адрес и публичный ключ подставляются при сборке из VITE_SUPABASE_URL / VITE_SUPABASE_KEY.
// 2) Свой сервер на Express (npm run dev): запросы на /api/...

const SB_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
const SB_KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
export const usingSupabase = !!(SB_URL && SB_KEY);

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: SB_KEY! };
  // Старый формат ключа (JWT anon) нужно передавать ещё и в Authorization; новый sb_publishable_ — только в apikey.
  if (SB_KEY!.startsWith('eyJ')) headers.authorization = `Bearer ${SB_KEY}`;
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!res.ok) {
    let code = '';
    try { code = (await res.json()).message ?? ''; } catch { /* нет тела */ }
    const err = new Error(code || `HTTP ${res.status}`) as Error & { status: number; code: string };
    err.status = code === 'not_found' ? 404 : res.status;
    err.code = code;
    throw err;
  }
  return res.json() as Promise<T>;
}

const shiftArgs = (id: string, b: Record<string, number>) => ({
  p_id: id, p_passengers: b.passengers, p_revenue: b.revenue, p_fuel_cost: b.fuelCost, p_fines: b.fines,
  p_ops: b.ops, p_correct: b.correct, p_avg_ms: b.avgMs, p_falls: b.falls, p_duration_s: b.durationS,
});

export async function bootPlayer(): Promise<Player> {
  const id = storedId();
  if (usingSupabase) {
    if (id) {
      const p = await rpc<Player | null>('get_player', { p_id: id });
      if (p) return p;
    }
    const p = await rpc<Player>('create_player', {});
    storeId(p.id);
    return p;
  }
  if (id) {
    try {
      return await req<Player>('GET', `/api/players/${id}`);
    } catch (e: any) {
      if (e.status !== 404) throw e;
    }
  }
  const p = await req<Player>('POST', '/api/players', {});
  storeId(p.id);
  return p;
}

type Shifted = { profit: number; rent: number; player: Player };

export const api = usingSupabase
  ? {
      rename: (id: string, name: string) => rpc<Player>('rename_player', { p_id: id, p_name: name }),
      submitShift: (id: string, body: Record<string, number>) => rpc<Shifted>('submit_shift', shiftArgs(id, body)),
      buy: (id: string, item: string) => rpc<Player>('buy', { p_id: id, p_item: item }),
      history: (id: string) => rpc<ShiftRow[]>('player_history', { p_id: id }),
      leaderboard: () => rpc<LeaderRow[]>('leaderboard'),
    }
  : {
      rename: (id: string, name: string) => req<Player>('PATCH', `/api/players/${id}`, { name }),
      submitShift: (id: string, body: Record<string, number>) => req<Shifted>('POST', `/api/players/${id}/shifts`, body),
      buy: (id: string, item: string) => req<Player>('POST', `/api/players/${id}/buy`, { item }),
      history: (id: string) => req<ShiftRow[]>('GET', `/api/players/${id}/shifts`),
      leaderboard: () => req<LeaderRow[]>('GET', '/api/leaderboard'),
    };
