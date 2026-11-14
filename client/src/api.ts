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

export async function bootPlayer(): Promise<Player> {
  const id = storedId();
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

export const api = {
  rename: (id: string, name: string) => req<Player>('PATCH', `/api/players/${id}`, { name }),
  submitShift: (id: string, body: Record<string, number>) =>
    req<{ profit: number; rent: number; player: Player }>('POST', `/api/players/${id}/shifts`, body),
  buy: (id: string, item: string) => req<Player>('POST', `/api/players/${id}/buy`, { item }),
  history: (id: string) => req<ShiftRow[]>('GET', `/api/players/${id}/shifts`),
  leaderboard: () => req<LeaderRow[]>('GET', '/api/leaderboard'),
};
