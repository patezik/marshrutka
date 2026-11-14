// Одна смена: дорога, остановки, светофоры, пассажиры, касса, приборка.
import { VEHICLES, DENOMS, COIN_MAX, START_FLOAT, dayConfig } from '../../../shared/catalog.js';
import {
  Ctx, Look, StopKind, STOP_KINDS, BUS_H, drawBus, drawPerson, drawMoney, drawPaxIcon, drawStopIcon,
  randomLook, rng, hash, rrect, mix, pick, doorCenter,
} from './draw';
import { sfx } from '../audio';

export interface ShiftResult {
  passengers: number;
  revenue: number;
  fuelCost: number;
  fines: number;
  redCount: number;
  redFine: number;
  complaintCount: number;
  complaintFine: number;
  lateS: number;
  lateFine: number;
  rent: number;
  ops: number;
  correct: number;
  avgMs: number;
  falls: number;
  durationS: number;
  tips: number;
  lost: number;
}

export interface ShiftOptions {
  day: number;
  vehicle: string;
  upgrades: string[];
  onEnd: (r: ShiftResult) => void;
  onQuit: () => void;
}

type PaxState = 'waiting' | 'walking' | 'riding' | 'gone';
interface Slot { kind: 'seat' | 'stand'; row: number; i: number; pax: Pax | null }
interface Pax {
  id: number;
  look: Look;
  kid: boolean;
  party: Party;
  state: PaxState;
  wx: number;
  slot: Slot | null;
  mood: number;
  fallen: number;
  blink: number;
  requested: boolean;
  hx: number;
  hy: number;
}
interface Party {
  id: number;
  members: Pax[];
  adults: number;
  kids: number;
  dest: number;
  due: number;
  paid: number[];
  cheat: boolean;
  payState: 'none' | 'queued' | 'active' | 'done' | 'skipped';
  readyAt: number;
  activeAt: number;
  boarded: number;
  fixed: boolean; // доплатил после ✗
}
interface Stop { idx: number; x: number; kind: StopKind; parties: Party[]; passed: boolean }
interface Light { x: number; phase: number; flashed: boolean }
interface DishItem { d: number; x: number; y: number; rot: number }
interface Walker { look: Look; wx: number; vx: number; t: number }
interface Floater { x: number; y: number; text: string; color: string; t: number; vy: number }
interface Flyer { d: number; x: number; y: number; vx: number; vy: number; rot: number; vr: number; t: number }

const W = 1280, H = 720;
const GY = 392;            // дорога под колёсами
const WALK_Y = 326;        // тротуар (ноги пешеходов)
const FRONT_X = 600;       // экранная x переда маршрутки
const STOP_TOL = 64;       // допуск остановки двери у столба
const BRAKE_MAX = 950;
const LIGHT_CYCLE = 10;

const UI = {
  hand: { x: 20, y: 418, w: 380, h: 172 },
  dish: { cx: 600, cy: 505, rx: 175, ry: 68 },
  ok: { x: 868, y: 452, r: 36 },
  no: { x: 868, y: 535, r: 29 },
  clear: { x: 790, y: 578, r: 17 },
  tray: { x: 172, y: 604, w: 736, h: 106 },
  fare: { x: 20, y: 604, w: 140, h: 106 },
  speedo: { x: 1004, y: 506, r: 76 },
  brake: { x: 928, y: 612, w: 146, h: 98 },
  gas: { x: 1090, y: 596, w: 170, h: 114 },
  pause: { x: 1236, y: 30, r: 20 },
};

export class Shift {
  private ctx: Ctx;
  private cfg: ReturnType<typeof dayConfig>;
  private spec: (typeof VEHICLES)[keyof typeof VEHICLES];
  private up: Set<string>;
  private r: () => number;
  private raf = 0;
  private last = 0;
  private t = 0;
  private paused = false;
  private ended = false;
  private endTimer = -1;

  // движение
  private pos = -520;
  private v = 0;
  private acc = 0;
  private accSm = 0;
  private gasP = 0;
  private brakeP = 0;
  private gasHeld = false;
  private brakeHeld = false;
  private keysGas = false;
  private keysBrake = false;
  private wheelRot = 0;
  private fuel = 0;
  private hardEvent = false;
  private everGas = false;

  // мир
  private stops: Stop[] = [];
  private lights: Light[] = [];
  private walkers: Walker[] = [];
  private seats: Slot[] = [];
  private stands: Slot[] = [];
  private paxId = 1;
  private doorOpen = 0;
  private atStop: Stop | null = null;
  private stopActT = 0;
  private schedule = 0;

  // касса
  private tray: Record<number, number> = { ...START_FLOAT };
  private startTotal = 0;
  private dish: DishItem[] = [];
  private queue: Party[] = [];
  private active: Party | null = null;
  private handT = 0;
  private handShake = 0;
  private resolving = 0; // анимация ухода руки

  // статистика
  private ops = 0;
  private correct = 0;
  private opMs: number[] = [];
  private complaints = 0;
  private reds = 0;
  private falls = 0;
  private tips = 0;
  private lost = 0;
  private boardedTotal = 0;

  // эффекты
  private floaters: Floater[] = [];
  private flyers: Flyer[] = [];
  private flash = 0;
  private shake = 0;

  private pointers = new Map<number, 'gas' | 'brake' | null>();
  private canvasRect = { ox: 0, oy: 0, s: 1 };
  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private opts: ShiftOptions) {
    this.ctx = canvas.getContext('2d')!;
    this.cfg = dayConfig(opts.day);
    this.spec = VEHICLES[opts.vehicle as keyof typeof VEHICLES] ?? VEHICLES.pazik;
    this.up = new Set(opts.upgrades);
    this.r = rng(Date.now() ^ (opts.day * 7919));
    this.startTotal = this.trayTotal();
    this.buildSlots();
    this.buildRoute();
    this.bindInput();
    this.resize();
    sfx.engineStart();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    sfx.engineStop();
    this.cleanup.forEach((f) => f());
  }

  // ---------------- построение ----------------

  private buildSlots() {
    const perRow = Math.ceil(this.spec.seats / 2);
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < perRow && this.seats.length < this.spec.seats; i++)
        this.seats.push({ kind: 'seat', row, i, pax: null });
    for (let i = 0; i < this.spec.standing; i++) this.stands.push({ kind: 'stand', row: 2, i, pax: null });
  }

  private buildRoute() {
    const n = this.cfg.stops;
    const kinds = [...STOP_KINDS].sort(() => this.r() - 0.5);
    let x = 0;
    for (let i = 0; i < n; i++) {
      const kind: StopKind = i === n - 1 ? 'depot' : kinds[i % kinds.length];
      this.stops.push({ idx: i, x, kind, parties: [], passed: false });
      x += 2500 + this.r() * 1100;
    }
    // пассажиры
    for (let i = 0; i < n - 1; i++) {
      const stop = this.stops[i];
      let count: number;
      if (i === 0) count = this.opts.day === 1 ? 1 : 1 + Math.floor(this.r() * 2);
      else count = this.r() < 0.12 ? 0 : 1 + Math.floor(this.r() * (this.opts.day === 1 ? 1.7 : 2.6));
      if (i >= n - 2) count = Math.min(count, 1);
      let k = 0;
      for (let p = 0; p < count; p++) {
        const party = this.makeParty(i, n);
        for (const m of party.members) {
          m.wx = stop.x + 36 + k * 24 + this.r() * 6;
          k++;
        }
        stop.parties.push(party);
      }
    }
    // светофоры между остановками
    const segs = Array.from({ length: n - 1 }, (_, i) => i).sort(() => this.r() - 0.5).slice(0, this.cfg.lights);
    for (const s of segs) {
      const a = this.stops[s].x, b = this.stops[s + 1].x;
      this.lights.push({ x: a + (b - a) * (0.4 + this.r() * 0.25), phase: this.r() * LIGHT_CYCLE, flashed: false });
    }
    const total = this.stops[n - 1].x - this.pos;
    this.schedule = total / (this.spec.maxV * 0.62) + (n - 1) * 9 + 20;
  }

  private makeParty(origin: number, n: number): Party {
    const r = this.r;
    const day = this.opts.day;
    const adults = this.cfg.kids && r() < 0.18 ? (r() < 0.5 ? 1 : 2) : r() < 0.8 ? 1 : 2;
    const kids = this.cfg.kids && r() < 0.28 ? 1 + (r() < 0.3 ? 1 : 0) : 0;
    const dest = origin + 1 + Math.floor(r() * (n - 1 - origin));
    const due = adults * this.cfg.fare + kids * this.cfg.kidFare;
    const party: Party = {
      id: this.paxId++, members: [], adults, kids, dest: Math.min(dest, n - 1), due, paid: [], cheat: false,
      payState: 'none', readyAt: 0, activeAt: 0, boarded: 0, fixed: false,
    };
    const { paid, cheat } = this.genPayment(due, day === 1 && origin === 0);
    party.paid = paid;
    party.cheat = cheat;
    for (let i = 0; i < adults + kids; i++) {
      const kid = i >= adults;
      party.members.push({
        id: this.paxId++, look: randomLook(r, kid), kid, party, state: 'waiting', wx: 0, slot: null,
        mood: this.up.has('freshener') ? 0.8 : 0.7, fallen: 0, blink: r() * 4, requested: false, hx: 0, hy: 0,
      });
    }
    return party;
  }

  private genPayment(due: number, tutorial: boolean): { paid: number[]; cheat: boolean } {
    const r = this.r;
    const compose = (amt: number) => {
      const out: number[] = [];
      for (const d of [...DENOMS].reverse()) {
        if (d > 100) continue;
        while (amt >= d) { out.push(d); amt -= d; }
      }
      return out;
    };
    if (tutorial) return { paid: [50], cheat: false };
    if (this.cfg.cheats && r() < 0.13) {
      const short = pick(r, [5, 10, 10, 20]);
      if (due - short > 0) return { paid: compose(due - short), cheat: true };
    }
    const roll = r();
    if (roll < 0.17) return { paid: compose(due), cheat: false };
    const bills = [50, 100, 500, 1000].filter((b) => b >= due);
    let bill = bills[0];
    if (bills.length > 1 && r() < 0.3) bill = bills[1];
    if (this.cfg.bigBills && r() < 0.12) bill = 1000;
    if (this.cfg.smartPayers && roll > 0.8) {
      const extra = (((due - bill) % 50) + 50) % 50;
      if (extra > 0 && extra < due) return { paid: [bill, ...compose(extra)], cheat: false };
    }
    return { paid: [bill], cheat: false };
  }

  // ---------------- ввод ----------------

  private bindInput() {
    const c = this.canvas;
    const toLocal = (e: PointerEvent) => {
      const { ox, oy, s } = this.canvasRect;
      const b = c.getBoundingClientRect();
      return { x: (e.clientX - b.left - ox) / s, y: (e.clientY - b.top - oy) / s };
    };
    const down = (e: PointerEvent) => {
      sfx.unlock();
      const p = toLocal(e);
      c.setPointerCapture?.(e.pointerId);
      const pedal = this.pedalAt(p.x, p.y);
      this.pointers.set(e.pointerId, pedal);
      if (!pedal) this.tap(p.x, p.y);
      this.syncPedals();
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.syncPedals();
    };
    const move = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = toLocal(e);
      const pedal = this.pedalAt(p.x, p.y);
      if (this.pointers.get(e.pointerId) !== pedal && pedal) {
        this.pointers.set(e.pointerId, pedal);
        this.syncPedals();
      }
    };
    const keydown = (e: KeyboardEvent) => {
      sfx.unlock();
      const k = e.key;
      if (['ArrowRight', 'd', 'D', 'в', 'В', 'ArrowUp', 'w', 'W', 'ц', 'Ц'].includes(k)) this.keysGas = true;
      else if (['ArrowLeft', 'a', 'A', 'ф', 'Ф', 'ArrowDown', 's', 'S', 'ы', 'Ы', ' '].includes(k)) this.keysBrake = true;
      else if (k === 'Escape' || k === 'p' || k === 'P' || k === 'з' || k === 'З') this.paused = !this.paused;
      else if (k === 'Enter') this.give();
      else if (k === 'x' || k === 'X' || k === 'ч' || k === 'Ч') this.reject();
      else if (k === 'Backspace') this.popDish();
      else if (/^[1-8]$/.test(k)) this.toDish(DENOMS[Number(k) - 1]);
      else return;
      this.syncPedals();
      e.preventDefault();
    };
    const keyup = (e: KeyboardEvent) => {
      const k = e.key;
      if (['ArrowRight', 'd', 'D', 'в', 'В', 'ArrowUp', 'w', 'W', 'ц', 'Ц'].includes(k)) this.keysGas = false;
      if (['ArrowLeft', 'a', 'A', 'ф', 'Ф', 'ArrowDown', 's', 'S', 'ы', 'Ы', ' '].includes(k)) this.keysBrake = false;
      this.syncPedals();
    };
    const blur = () => { this.keysGas = this.keysBrake = false; this.pointers.clear(); this.syncPedals(); };
    const resize = () => this.resize();
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointermove', move);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', resize);
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('pointermove', move);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', resize);
    });
  }

  private syncPedals() {
    let g = this.keysGas, b = this.keysBrake;
    for (const v of this.pointers.values()) {
      if (v === 'gas') g = true;
      if (v === 'brake') b = true;
    }
    if (this.paused) g = b = false;
    this.gasHeld = g;
    this.brakeHeld = b;
  }

  private pedalAt(x: number, y: number): 'gas' | 'brake' | null {
    if (this.paused) return null;
    const inR = (q: { x: number; y: number; w: number; h: number }) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;
    if (inR(UI.gas)) return 'gas';
    if (inR(UI.brake)) return 'brake';
    return null;
  }

  private tap(x: number, y: number) {
    const near = (c: { x: number; y: number; r: number }, pad = 6) => Math.hypot(x - c.x, y - c.y) <= c.r + pad;
    if (near(UI.pause)) { this.paused = !this.paused; sfx.click(); return; }
    if (this.paused) {
      if (Math.hypot(x - 540, y - 380) < 60) { this.paused = false; sfx.click(); }
      else if (Math.hypot(x - 740, y - 380) < 60) { this.quit(); }
      else if (Math.hypot(x - 640, y - 500) < 34) { sfx.setMuted(!sfx.muted); }
      return;
    }
    if (near(UI.ok)) return this.give();
    if (near(UI.no)) return this.reject();
    if (near(UI.clear)) return this.clearDish();
    // лоток
    const t = UI.tray;
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
      const i = Math.floor((x - t.x) / (t.w / DENOMS.length));
      return this.toDish(DENOMS[i]);
    }
    // тарелка: вернуть предмет
    for (let i = this.dish.length - 1; i >= 0; i--) {
      const it = this.dish[i];
      const hitR = it.d <= COIN_MAX ? 18 : 34;
      if (Math.abs(x - it.x) < hitR && Math.abs(y - it.y) < (it.d <= COIN_MAX ? 18 : 20)) {
        this.dish.splice(i, 1);
        this.tray[it.d]++;
        it.d <= COIN_MAX ? sfx.coin() : sfx.bill();
        return;
      }
    }
  }

  private quit() {
    if (this.ended) return;
    this.ended = true;
    this.destroy();
    this.opts.onQuit();
  }

  // ---------------- касса ----------------

  private trayTotal() {
    return DENOMS.reduce((s, d) => s + d * (this.tray[d] ?? 0), 0);
  }
  private dishTotal() {
    return this.dish.reduce((s, it) => s + it.d, 0);
  }

  private toDish(d: number | undefined) {
    if (d === undefined || this.paused) return;
    if ((this.tray[d] ?? 0) <= 0) { sfx.click(); return; }
    this.tray[d]--;
    const { cx, cy, rx, ry } = UI.dish;
    let x = 0, y = 0;
    for (let k = 0; k < 8; k++) {
      const a = this.r() * Math.PI * 2, rr = Math.sqrt(this.r()) * 0.72;
      x = cx + Math.cos(a) * rx * rr;
      y = cy + Math.sin(a) * ry * rr;
      if (!this.dish.some((it) => Math.hypot(it.x - x, it.y - y) < 22)) break;
    }
    this.dish.push({ d, x, y, rot: (this.r() - 0.5) * 0.5 });
    d <= COIN_MAX ? sfx.coin() : sfx.bill();
  }

  private popDish() {
    const it = this.dish.pop();
    if (!it) return;
    this.tray[it.d]++;
    it.d <= COIN_MAX ? sfx.coin() : sfx.bill();
  }

  private clearDish() {
    if (!this.dish.length) return;
    for (const it of this.dish) this.tray[it.d]++;
    this.dish = [];
    sfx.coin();
  }

  private payer(p: Party) {
    return p.members[0];
  }

  private paidSum(p: Party) {
    return p.paid.reduce((a, b) => a + b, 0);
  }

  private finishOp(ok: boolean) {
    const p = this.active!;
    this.ops++;
    if (ok) this.correct++;
    this.opMs.push(performance.now() - p.activeAt);
    p.payState = 'done';
    this.resolving = 1;
  }

  /** ✓ — забрать деньги, отдать сдачу с тарелки. */
  private give() {
    const p = this.active;
    if (!p || this.handT < 0.95 || this.resolving > 0 || this.paused) return;
    const paid = this.paidSum(p);
    const change = this.dishTotal();
    for (const d of p.paid) this.tray[d] = (this.tray[d] ?? 0) + 1;
    const pr = this.payer(p);
    const hx = 230, hy = 470;
    if (paid >= p.due) {
      const need = paid - p.due;
      if (change === need) {
        const fast = performance.now() - p.activeAt < 6000;
        this.moodParty(p, +0.25);
        sfx.happy();
        sfx.mumble(0.9, pr.kid, 3);
        if (fast && this.r() < 0.35) {
          const tip = this.r() < 0.5 ? 5 : 10;
          this.tray[tip]++;
          this.tips += tip;
          this.float(hx, hy - 40, `+${tip}`, '#e2b649');
          sfx.coin();
        } else this.float(hx, hy - 40, '✓', '#7bd389');
        this.finishOp(true);
      } else if (change < need) {
        this.moodParty(p, -0.6);
        this.complain(hx, hy - 40);
        sfx.mumble(0.1, pr.kid, 6);
        this.float(hx + 40, hy - 10, `−${need - change}`, '#ff6b6b');
        this.finishOp(false);
      } else {
        this.moodParty(p, +0.3);
        sfx.mumble(0.95, pr.kid, 2);
        this.float(hx, hy - 40, `−${change - need}`, '#ff6b6b');
        this.finishOp(false);
      }
    } else {
      // принял меньше, чем надо
      this.moodParty(p, +0.1);
      sfx.mumble(0.9, pr.kid, 2);
      this.float(hx, hy - 40, `−${p.due - paid}`, '#ff6b6b');
      this.finishOp(false);
    }
    // рука уходит со сдачей, а не с деньгами пассажира
    p.paid = this.dish.map((it) => it.d);
    this.dish = [];
  }

  /** ✗ — «не хватает»: вернуть деньги, потребовать доплату. */
  private reject() {
    const p = this.active;
    if (!p || this.handT < 0.95 || this.resolving > 0 || this.paused) return;
    const pr = this.payer(p);
    const paid = this.paidSum(p);
    if (paid < p.due && !p.fixed) {
      // поймали! пассажир смущённо доплачивает
      const add = p.due - paid;
      const extra: number[] = [];
      let a = add;
      for (const d of [10, 5, 2, 1]) while (a >= d) { extra.push(d); a -= d; }
      p.paid = [...p.paid, ...extra];
      p.cheat = false;
      p.fixed = true;
      this.handShake = 0.5;
      sfx.mumble(0.4, pr.kid, 2);
      this.float(230, 430, `+${add}`, '#7bd389');
      // это правильное действие — засчитаем при выдаче сдачи (обычно сдача 0)
    } else if (paid - p.due > this.trayTotal() + this.dishTotal() && !p.fixed) {
      // «А помельче нет?» — сдачи действительно нет, пассажир платит без сдачи
      const exact: number[] = [];
      let a = p.due;
      for (const d of [100, 50, 10, 5, 2, 1]) while (a >= d) { exact.push(d); a -= d; }
      p.paid = exact;
      p.fixed = true;
      this.handShake = 0.5;
      sfx.mumble(0.45, pr.kid, 3);
    } else {
      // зря придрался
      this.moodParty(p, -0.35);
      this.handShake = 0.6;
      sfx.mumble(0.15, pr.kid, 5);
      if (pr.mood < 0.15) this.complain(230, 430);
    }
    this.clearDish();
  }

  private moodParty(p: Party, d: number) {
    for (const m of p.members) m.mood = Math.max(0, Math.min(1, m.mood + d));
  }

  private complain(x: number, y: number) {
    this.complaints++;
    this.float(x, y, '!', '#ff6b6b');
  }

  private float(x: number, y: number, text: string, color: string) {
    this.floaters.push({ x, y, text, color, t: 0, vy: -38 });
  }

  // ---------------- симуляция ----------------

  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.paused && !this.ended) this.update(dt);
    this.render();
    if (!this.ended) this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    this.t += dt;
    const spec = this.spec;

    // педали: давление нарастает постепенно — резко нажать = долго держать
    this.gasP += ((this.gasHeld && this.doorOpen < 0.05 ? 1 : 0) - this.gasP) * Math.min(1, dt * (this.gasHeld ? 2.2 : 6));
    this.brakeP += ((this.brakeHeld ? 1 : 0) - this.brakeP) * Math.min(1, dt * (this.brakeHeld ? 1.6 : 7));
    if (this.gasHeld) this.everGas = true;

    // если стоим с открытой дверью и жмём газ — закрываем двери
    if (this.gasHeld && this.doorOpen > 0) this.closeDoors();

    const prevV = this.v;
    let a = this.gasP * spec.accel * (1 - this.v / spec.maxV) - this.brakeP * BRAKE_MAX;
    a -= this.gasP < 0.05 ? 18 + this.v * 0.06 : this.v * 0.02;
    this.v = Math.max(0, this.v + a * dt);
    this.acc = (this.v - prevV) / dt;
    this.accSm += (this.acc - this.accSm) * Math.min(1, dt * 10);
    const prevPos = this.pos;
    this.pos += this.v * dt;
    this.wheelRot += (this.v * dt) / 18;

    // топливо
    const eff = this.up.has('engine') ? 0.75 : 1;
    this.fuel += (this.gasP * 0.03 + 0.002) * spec.fuelRate * eff * dt;

    // инерция: стоящие падают, мелочь с тарелки слетает
    const grip = spec.grip * (this.up.has('suspension') ? 1.45 : 1);
    const hard = Math.abs(this.accSm) > 560 * grip;
    if (hard && !this.hardEvent) {
      this.hardEvent = true;
      this.shake = 0.35;
      let fell = 0;
      for (const s of this.stands) {
        if (s.pax && s.pax.fallen <= 0 && this.r() < 0.75) {
          s.pax.fallen = 1;
          s.pax.mood = Math.max(0, s.pax.mood - 0.35);
          fell++;
          this.falls++;
          if (this.r() < 0.5) this.complain(this.xOfSlot(s), GY - 150);
        }
      }
      if (fell) { sfx.thud(); sfx.mumble(0.1, false, 4); }
      const coins = this.dish.filter((it) => it.d <= COIN_MAX);
      if (coins.length) {
        const it = coins[Math.floor(this.r() * coins.length)];
        this.dish.splice(this.dish.indexOf(it), 1);
        this.lost += it.d;
        this.flyers.push({ d: it.d, x: it.x, y: it.y, vx: (this.accSm < 0 ? 1 : -1) * (200 + this.r() * 200), vy: -260, rot: 0, vr: 8, t: 0 });
        sfx.coin();
      }
    } else if (!hard && Math.abs(this.accSm) < 300) this.hardEvent = false;

    // светофоры
    const FRONT_OFF = this.spec.length - (doorCenter(this.spec, 0));
    for (const l of this.lights) {
      const front0 = prevPos + FRONT_OFF, front1 = this.pos + FRONT_OFF;
      if (front0 < l.x && front1 >= l.x && this.lightState(l) === 'red' && !l.flashed) {
        l.flashed = true;
        this.reds++;
        this.flash = 1;
        sfx.flash();
        this.float(FRONT_X - 40, 200, `−${this.cfg.redLightFine}`, '#ff6b6b');
      }
    }

    // остановки
    this.updateStops(dt);

    // оплата
    this.updatePayments(dt);

    // пассажиры: падение, моргание
    for (const s of [...this.seats, ...this.stands]) {
      const p = s.pax;
      if (!p) continue;
      if (p.fallen > 0) p.fallen = Math.max(0, p.fallen - dt * 0.7);
      p.blink -= dt;
      if (p.blink < -0.12) p.blink = 2 + this.r() * 4;
    }

    // прохожие
    for (const w of this.walkers) { w.wx += w.vx * dt; w.t += dt; }
    this.walkers = this.walkers.filter((w) => w.t < 6);

    for (const f of this.floaters) { f.t += dt; f.y += f.vy * dt; }
    this.floaters = this.floaters.filter((f) => f.t < 1.4);
    for (const f of this.flyers) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 900 * dt; f.rot += f.vr * dt; }
    this.flyers = this.flyers.filter((f) => f.t < 1.5);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt);
    this.handShake = Math.max(0, this.handShake - dt);

    sfx.engine(this.v / spec.maxV, this.gasP);

    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0) this.finish();
    }
  }

  private lightState(l: Light): 'green' | 'yellow' | 'red' {
    const c = (this.t + l.phase) % LIGHT_CYCLE;
    return c < 5 ? 'green' : c < 6.4 ? 'yellow' : 'red';
  }

  private nextStop(): Stop | undefined {
    return this.stops.find((s) => !s.passed);
  }

  private updateStops(dt: number) {
    // проехали остановку?
    for (const s of this.stops) {
      if (s.passed || this.pos <= s.x + STOP_TOL + 10) continue;
      s.passed = true;
      if (this.atStop === s) this.atStop = null;
      // те, кому было сюда, — недовольны и выйдут на следующей
      const next = this.stops[s.idx + 1];
      for (const p of this.riders()) {
        if (p.party.dest === s.idx) {
          p.mood = Math.max(0, p.mood - 0.5);
          if (p === p.party.members[0]) { this.complain(this.xOfSlot(p.slot!), GY - 150); sfx.mumble(0.05, p.kid, 6); }
          if (next) p.party.dest = next.idx;
          p.requested = false;
        }
      }
      // ожидавшие на остановке машут вслед
      if (s.parties.some((pt) => pt.members.some((m) => m.state === 'waiting'))) sfx.mumble(0.2, false, 3);
    }

    // запросы на выход
    const ns = this.nextStop();
    for (const p of this.riders()) {
      const want = !!ns && p.party.dest === ns.idx;
      if (want && !p.requested && p === p.party.members[0]) sfx.ding();
      p.requested = want;
    }

    // стоим у остановки?
    const s = ns;
    const at = s && !this.gasHeld && Math.abs(this.pos - s.x) < STOP_TOL && this.v < 4;
    if (at && s) {
      if (this.atStop !== s) { this.atStop = s; this.stopActT = 0.6; sfx.door(); }
      this.doorOpen = Math.min(1, this.doorOpen + dt * 2.5);
      if (this.doorOpen >= 1) {
        this.stopActT -= dt;
        if (this.stopActT <= 0) this.stopStep(s);
      }
    } else if (this.doorOpen > 0) {
      this.closeDoors();
      this.doorOpen = Math.max(0, this.doorOpen - dt * 3);
    }

    // идущие к двери
    if (this.atStop) {
      for (const pt of this.atStop.parties)
        for (const m of pt.members) {
          if (m.state !== 'walking') continue;
          const dx = this.atStop.x - m.wx;
          m.wx += Math.sign(dx) * Math.min(Math.abs(dx), 170 * dt);
          if (Math.abs(dx) < 3) this.board(m);
        }
    }
  }

  private closeDoors() {
    if (!this.atStop) return;
    for (const pt of this.atStop.parties)
      for (const m of pt.members) if (m.state === 'walking') m.state = 'waiting';
    this.atStop = null;
  }

  /** Один шаг на остановке: сначала выходят, потом входят. */
  private stopStep(s: Stop) {
    const leaving = this.riders().filter((p) => p.party.dest === s.idx || s.kind === 'depot');
    if (leaving.length) {
      const p = leaving[0];
      this.unboard(p);
      this.stopActT = 0.32;
      return;
    }
    if (s.kind === 'depot') {
      if (this.endTimer < 0) this.endTimer = 1.2;
      return;
    }
    if (s.parties.some((pt) => pt.members.some((m) => m.state === 'walking'))) return;
    const free = this.seats.filter((x) => !x.pax).length + this.stands.filter((x) => !x.pax).length;
    for (const pt of s.parties) {
      const waiting = pt.members.filter((m) => m.state === 'waiting');
      if (!waiting.length) continue;
      if (free < waiting.length) continue; // компания не влезает целиком
      for (const m of waiting) m.state = 'walking';
      this.stopActT = 0.25;
      return;
    }
  }

  private board(m: Pax) {
    const seat = this.seats.find((x) => !x.pax);
    const slot = seat ?? this.stands.find((x) => !x.pax);
    if (!slot) { m.state = 'waiting'; return; }
    slot.pax = m;
    m.slot = slot;
    m.state = 'riding';
    this.boardedTotal++;
    const pt = m.party;
    pt.boarded++;
    if (pt.boarded === pt.members.length && pt.payState === 'none') {
      pt.payState = 'queued';
      pt.readyAt = this.t + 0.7 + this.r() * 0.8;
      this.queue.push(pt);
    }
  }

  private unboard(p: Pax) {
    if (p.slot) p.slot.pax = null;
    p.slot = null;
    p.state = 'gone';
    p.requested = false;
    this.walkers.push({ look: p.look, wx: this.pos + 10, vx: (this.r() < 0.5 ? -1 : 1) * (40 + this.r() * 30), t: 0 });
    const pt = p.party;
    // ушли, не заплатив
    if (pt.payState === 'queued' || pt.payState === 'active') {
      if (this.active === pt) { this.clearDish(); this.active = null; this.handT = 0; }
      this.queue = this.queue.filter((q) => q !== pt);
      pt.payState = 'skipped';
    }
    if (p.mood > 0.75 && p === pt.members[0]) sfx.mumble(0.9, p.kid, 2);
  }

  private riders(): Pax[] {
    const out: Pax[] = [];
    for (const s of this.seats) if (s.pax) out.push(s.pax);
    for (const s of this.stands) if (s.pax) out.push(s.pax);
    return out;
  }

  private updatePayments(dt: number) {
    if (this.resolving > 0) {
      this.resolving -= dt * 2.2;
      this.handT = Math.max(0, this.resolving);
      if (this.resolving <= 0) { this.active = null; this.handT = 0; this.resolving = 0; }
      return;
    }
    if (!this.active) {
      const i = this.queue.findIndex((q) => q.readyAt <= this.t);
      if (i >= 0) {
        this.active = this.queue.splice(i, 1)[0];
        this.active.payState = 'active';
        this.active.activeAt = performance.now();
        sfx.bill();
        sfx.mumble(0.6, this.payer(this.active).kid, 3);
      }
    }
    if (this.active) {
      this.handT = Math.min(1, this.handT + dt * 3);
      const patience = this.up.has('freshener') ? 1.5 : 1;
      const waited = (performance.now() - this.active.activeAt) / 1000;
      if (waited > 14 * patience) this.moodParty(this.active, -dt * 0.05);
      if (waited > 35 * patience) {
        // устал ждать — едет бесплатно и жалуется
        this.complain(230, 430);
        sfx.mumble(0.05, false, 6);
        this.clearDish();
        this.ops++;
        this.opMs.push(waited * 1000);
        this.active.payState = 'skipped';
        this.resolving = 1;
      }
    }
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    this.destroy();
    sfx.kaching();
    // мелочь, оставшаяся на тарелке, возвращается в лоток
    for (const it of this.dish) this.tray[it.d]++;
    const revenue = this.trayTotal() - this.startTotal;
    const fuelCost = Math.round(this.fuel * this.cfg.fuelPrice);
    const lateS = Math.max(0, Math.round(this.t - this.schedule));
    const lateFine = lateS * 3;
    const redFine = this.reds * this.cfg.redLightFine;
    const complaintFine = this.complaints * this.cfg.complaintFine;
    const avgMs = this.opMs.length ? Math.round(this.opMs.reduce((a, b) => a + b, 0) / this.opMs.length) : 0;
    this.opts.onEnd({
      passengers: this.boardedTotal,
      revenue,
      fuelCost,
      fines: lateFine + redFine + complaintFine,
      redCount: this.reds,
      redFine,
      complaintCount: this.complaints,
      complaintFine,
      lateS,
      lateFine,
      rent: this.cfg.rent,
      ops: this.ops,
      correct: this.correct,
      avgMs,
      falls: this.falls,
      durationS: Math.round(this.t),
      tips: this.tips,
      lost: this.lost,
    });
  }

  // ---------------- отрисовка ----------------

  private resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = c.clientWidth, ch = c.clientHeight;
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
    const s = Math.min(cw / W, ch / H);
    this.canvasRect = { s, ox: (cw - W * s) / 2, oy: (ch - H * s) / 2 };
  }

  private sx(wx: number) {
    return doorCenter(this.spec, FRONT_X - this.spec.length) + (wx - this.pos);
  }

  private xOfSlot(s: Slot) {
    const L = this.spec.length;
    const x0 = FRONT_X - L;
    const span = L - 165;
    if (s.kind === 'seat') {
      const perRow = Math.ceil(this.spec.seats / 2);
      const step = span / perRow;
      return x0 + 26 + step * s.i + step * 0.5 + (s.row === 1 ? step * 0.35 : 0);
    }
    const step = span / this.spec.standing;
    return x0 + 26 + step * s.i + step * 0.5 + step * 0.2;
  }

  private night() {
    const k = Math.min(1, this.t / Math.max(60, this.schedule));
    return Math.min(1, Math.max(0, (k - 0.15) / 0.75));
  }

  private render() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = c.width / Math.max(1, c.clientWidth);
    const { ox, oy, s } = this.canvasRect;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    const sh = this.shake > 0 ? (this.r() - 0.5) * 6 * this.shake : 0;
    ctx.save();
    ctx.translate(sh, sh * 0.5);
    this.drawStreet();
    ctx.restore();
    this.drawRouteStrip();
    this.drawDash();
    for (const f of this.flyers) drawMoney(ctx, f.d, f.x, f.y, 1, f.rot);
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.4);
      ctx.font = '900 30px Rubik, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.paused) this.drawPause();
    ctx.restore();
  }

  private drawStreet() {
    const ctx = this.ctx;
    const n = this.night();
    // небо: закат → ночь
    const sky = ctx.createLinearGradient(0, 0, 0, 340);
    sky.addColorStop(0, mix('#f4a259', '#0b1026', n));
    sky.addColorStop(0.6, mix('#f7c873', '#1b1f45', n));
    sky.addColorStop(1, mix('#f9dfa5', '#3a2f5b', n));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, 340);
    // солнце / луна
    const sunY = 120 + n * 260;
    ctx.fillStyle = mix('#fff1c1', '#f06d4f', Math.min(1, n * 1.4));
    ctx.globalAlpha = 1 - n * 0.9;
    ctx.beginPath();
    ctx.arc(980, sunY, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = n;
    ctx.fillStyle = '#f4f1de';
    ctx.beginPath();
    ctx.arc(260, 80, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix('#f9dfa5', '#0b1026', n);
    ctx.beginPath();
    ctx.arc(268, 74, 16, 0, Math.PI * 2);
    ctx.fill();
    if (n > 0.5) {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = (n - 0.5) * 2 * (0.3 + hash(i * 3) * 0.7);
        ctx.fillRect(hash(i) * W, hash(i + 99) * 200, 2, 2);
      }
    }
    ctx.globalAlpha = 1;

    // дальний город
    const farCol = mix('#c9785b', '#262a4a', n);
    ctx.fillStyle = farCol;
    const fp = this.pos * 0.12;
    for (let i = Math.floor(fp / 70) - 1; i < Math.floor(fp / 70) + W / 70 + 2; i++) {
      const x = i * 70 - fp;
      const h = 60 + hash(i * 13) * 110;
      ctx.fillRect(x, 300 - h, 64, h);
      if (hash(i * 7) > 0.7) ctx.fillRect(x + 20, 300 - h - 30, 6, 30);
    }

    // ближние дома
    const np = this.pos * 0.45;
    const bw = 150;
    for (let i = Math.floor(np / bw) - 1; i < Math.floor(np / bw) + W / bw + 2; i++) {
      const x = i * bw - np;
      const h = 110 + hash(i * 31 + 5) * 150;
      const w = bw - 8 - hash(i * 17) * 20;
      const base = pick(() => hash(i * 11 + 1), ['#b5838d', '#6d6875', '#e5989b', '#8d99ae', '#a3b18a', '#cb997e', '#7f5539']);
      ctx.fillStyle = mix(mix(base, '#3d405b', 0.25), '#151a33', n * 0.8);
      ctx.fillRect(x, 304 - h, w, h);
      // окна
      const cols = Math.floor(w / 26), rows = Math.floor((h - 20) / 30);
      for (let cx = 0; cx < cols; cx++)
        for (let ry = 0; ry < rows; ry++) {
          const lit = hash(i * 997 + cx * 31 + ry * 7) < 0.15 + n * 0.55;
          ctx.fillStyle = lit && n > 0.15 ? `rgba(255,214,120,${0.35 + n * 0.6})` : mix('#2d3047', '#0d1022', n);
          ctx.fillRect(x + 8 + cx * 26, 304 - h + 14 + ry * 30, 14, 18);
        }
    }

    // тротуар
    ctx.fillStyle = mix('#b8b2a7', '#3a3d4d', n);
    ctx.fillRect(0, 304, W, 34);
    ctx.fillStyle = mix('#8f897f', '#2a2c38', n);
    for (let i = Math.floor(this.pos / 60) - 1; i < Math.floor(this.pos / 60) + W / 60 + 2; i++) {
      ctx.fillRect(i * 60 - this.pos, 304, 2, 34);
    }
    ctx.fillStyle = mix('#d6d0c4', '#4a4d5c', n);
    ctx.fillRect(0, 336, W, 6);

    // дорога
    ctx.fillStyle = mix('#4a4e5a', '#1c1e27', n);
    ctx.fillRect(0, 342, W, 66);
    ctx.fillStyle = mix('#f2efe6', '#8a8a8a', n);
    for (let i = Math.floor(this.pos / 120) - 1; i < Math.floor(this.pos / 120) + W / 120 + 2; i++) {
      ctx.fillRect(i * 120 - this.pos, 402, 60, 4);
    }

    // фонари
    for (let i = Math.floor(this.pos / 420) - 1; i < Math.floor(this.pos / 420) + W / 420 + 2; i++) {
      const x = i * 420 + 200 - this.pos;
      ctx.fillStyle = mix('#3d405b', '#151724', n);
      ctx.fillRect(x, 170, 5, 166);
      ctx.fillRect(x, 170, 34, 5);
      ctx.fillStyle = n > 0.25 ? '#ffe8a3' : '#c9c3b3';
      rrect(ctx, x + 24, 174, 16, 7, 3);
      ctx.fill();
      if (n > 0.25) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x + 32, 180, 4, x + 32, 300, 140);
        g.addColorStop(0, `rgba(255,220,140,${0.35 * n})`);
        g.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + 26, 180); ctx.lineTo(x + 38, 180); ctx.lineTo(x + 110, 340); ctx.lineTo(x - 46, 340);
        ctx.fill();
        ctx.restore();
      }
    }

    // остановки и люди
    for (const st of this.stops) {
      const x = this.sx(st.x);
      if (x < -300 || x > W + 300) continue;
      // навес
      ctx.fillStyle = mix('#5c677d', '#232838', n);
      ctx.fillRect(x + 20, 236, 150, 6);
      ctx.fillStyle = `rgba(180,210,230,${0.25 - n * 0.1})`;
      ctx.fillRect(x + 26, 242, 140, 62);
      ctx.fillStyle = mix('#5c677d', '#232838', n);
      ctx.fillRect(x + 160, 242, 5, 94);
      ctx.fillRect(x + 26, 300, 134, 6);
      // столб со знаком
      ctx.fillStyle = mix('#8d99ae', '#3a3f55', n);
      ctx.fillRect(x - 3, 196, 6, 140);
      drawStopIcon(ctx, st.kind, x, 192, 22, true);
      // ожидающие
      for (const pt of st.parties)
        for (const m of pt.members) {
          if (m.state !== 'waiting' && m.state !== 'walking') continue;
          const px = this.sx(m.wx);
          const bob = m.state === 'walking' ? Math.abs(Math.sin(this.t * 12 + m.id)) * 3 : 0;
          drawPerson(ctx, px, WALK_Y - bob, m.look, { mood: m.mood, shade: n * 0.55, blink: m.blink < 0 });
        }
    }
    for (const w of this.walkers) {
      const px = this.sx(w.wx);
      drawPerson(ctx, px, WALK_Y - Math.abs(Math.sin(this.t * 10 + w.wx)) * 3, w.look, { alpha: Math.max(0, 1 - w.t / 6), shade: n * 0.55 });
    }

    // светофоры
    for (const l of this.lights) {
      const x = this.sx(l.x) + (this.spec.length - doorCenter(this.spec, 0)) + 8;
      if (x < -60 || x > W + 60) continue;
      ctx.fillStyle = mix('#2b2d42', '#111', n);
      ctx.fillRect(x - 3, 210, 6, 128);
      rrect(ctx, x - 14, 160, 28, 70, 6);
      ctx.fill();
      const st = this.lightState(l);
      const cols: [string, boolean][] = [['#ff4d4d', st === 'red'], ['#ffc93c', st === 'yellow'], ['#4cd964', st === 'green']];
      cols.forEach(([col, on], i) => {
        ctx.fillStyle = on ? col : 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.arc(x, 174 + i * 21, 8, 0, Math.PI * 2);
        ctx.fill();
        if (on) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(x, 174 + i * 21, 18, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
      // стоп-линия
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x - 12, 344, 6, 62);
    }

    // маршрутка
    const L = this.spec.length;
    const bounce = Math.sin(this.t * 18) * Math.min(1, this.v / 200) * 0.8;
    const pitch = Math.max(-0.03, Math.min(0.03, -this.accSm * 0.000032));
    const spec = { ...this.spec, body: mix(this.spec.body, '#1d2235', n * 0.45), stripe: mix(this.spec.stripe, '#1d2235', n * 0.35) };
    drawBus(ctx, spec, {
      x0: FRONT_X - L,
      gy: GY + bounce,
      wheelRot: this.wheelRot,
      doorOpen: this.doorOpen,
      night: n,
      pitch,
      driverMood: this.complaints > 3 ? 0.2 : 0.7,
      interior: (c) => this.drawInterior(c, FRONT_X - L, GY + bounce, n),
    });

    // направляющая: пунктир от знака к двери, зеленеет, когда дверь напротив
    const ns = this.nextStop();
    if (ns) {
      const dx = ns.x - this.pos;
      const needed = ns.kind === 'depot' || ns.parties.some((pt) => pt.members.some((m) => m.state === 'waiting')) ||
        this.riders().some((p) => p.party.dest === ns.idx);
      if (needed && dx < 700 && dx > -STOP_TOL - 10) {
        const px = this.sx(ns.x);
        const ok = Math.abs(dx) < STOP_TOL;
        ctx.save();
        ctx.strokeStyle = ok ? '#4cd964' : 'rgba(255,255,255,0.8)';
        ctx.lineWidth = ok ? 4 : 3;
        ctx.setLineDash([8, 8]);
        ctx.lineDashOffset = -this.t * 30;
        ctx.beginPath();
        ctx.moveTo(px, 216);
        ctx.lineTo(px, GY - BUS_H + 4);
        ctx.stroke();
        ctx.setLineDash([]);
        const dcx = doorCenter(this.spec, FRONT_X - this.spec.length);
        ctx.fillStyle = ok ? '#4cd964' : 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.moveTo(dcx - 9, GY - BUS_H - 14); ctx.lineTo(dcx + 9, GY - BUS_H - 14); ctx.lineTo(dcx, GY - BUS_H - 3);
        ctx.fill();
        ctx.restore();
      }
    }

    // пузыри «мне выходить»
    for (const p of this.riders()) {
      if (!p.requested || p !== p.party.members[0]) continue;
      const bx = p.hx, by = GY - BUS_H - 34 + Math.sin(this.t * 5 + p.id) * 3;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(bx - 6, by + 16); ctx.lineTo(bx, by + 28); ctx.lineTo(bx + 6, by + 16);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, 19, 0, Math.PI * 2);
      ctx.fill();
      drawStopIcon(ctx, this.stops[p.party.dest].kind, bx, by, 15);
    }
  }

  private drawInterior(ctx: Ctx, x0: number, gy: number, n: number) {
    const top = gy - BUS_H;
    const lean = Math.max(-0.45, Math.min(0.45, -this.accSm / 1400));
    // поручень
    ctx.strokeStyle = 'rgba(200,200,210,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 14, top + 20);
    ctx.lineTo(x0 + this.spec.length - 135, top + 20);
    ctx.stroke();
    const shade = n > 0.4 ? 0 : 0.15;
    // задний ряд, потом передний, потом стоящие
    for (const row of [0, 1]) {
      for (const s of this.seats.filter((q) => q.row === row)) {
        const x = this.xOfSlot(s);
        const y = top + (row === 0 ? 76 : 82);
        ctx.fillStyle = row === 0 ? '#6b2c2c' : '#8a3434';
        rrect(ctx, x - 18, y - 46, 8, 46, 3);
        ctx.fill();
        if (s.pax) {
          s.pax.hx = x; s.pax.hy = y - 40;
          drawPerson(ctx, x, y, s.pax.look, {
            seated: true, lean: lean * 0.35, mood: s.pax.mood, shade: row === 0 ? shade + 0.3 : shade,
            blink: s.pax.blink < 0, shifty: this.active?.cheat && this.active === s.pax.party && s.pax === s.pax.party.members[0],
          });
        }
      }
    }
    for (const s of this.stands) {
      if (!s.pax) continue;
      const x = this.xOfSlot(s);
      const y = gy - 24;
      s.pax.hx = x; s.pax.hy = y - 60;
      drawPerson(ctx, x, y, s.pax.look, {
        lean: lean + Math.sin(this.t * 3 + s.i) * 0.03, mood: s.pax.mood, shade, fallen: s.pax.fallen,
        blink: s.pax.blink < 0, shifty: this.active?.cheat && this.active === s.pax.party && s.pax === s.pax.party.members[0],
      });
      // рука на поручне
      if (!s.pax.fallen) {
        ctx.strokeStyle = mix(s.pax.look.coat, '#000000', 0.2);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x + 4, y - 50 * s.pax.look.height + 8);
        ctx.lineTo(x + 6 + lean * 20, top + 22);
        ctx.stroke();
      }
    }
    // подсветка того, кто платит
    if (this.active && this.handT > 0.5) {
      const p = this.payer(this.active);
      if (p.slot) {
        ctx.strokeStyle = 'rgba(255,230,120,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(p.hx, p.hy, 17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawRouteStrip() {
    const ctx = this.ctx;
    const n = this.stops.length;
    const x0 = 300, x1 = 980, y = 34;
    ctx.fillStyle = 'rgba(14,16,24,0.55)';
    rrect(ctx, x0 - 34, y - 26, x1 - x0 + 68, 52, 26);
    ctx.fill();
    const first = this.stops[0].x, lastX = this.stops[n - 1].x;
    const toX = (wx: number) => x0 + ((wx - first) / (lastX - first)) * (x1 - x0);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    const wanted = new Set(this.riders().map((p) => p.party.dest));
    for (const s of this.stops) {
      const sx = toX(s.x);
      const pulse = wanted.has(s.idx) && !s.passed;
      if (pulse) {
        ctx.strokeStyle = `rgba(255,255,255,${0.5 + Math.sin(this.t * 6) * 0.4})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, y, 19, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = s.passed ? 0.35 : 1;
      drawStopIcon(ctx, s.kind, sx, y, 14);
      // ждут на остановке
      const waiting = s.parties.reduce((a, p) => a + p.members.filter((m) => m.state === 'waiting').length, 0);
      if (waiting && !s.passed) {
        ctx.fillStyle = '#fff';
        for (let i = 0; i < Math.min(waiting, 5); i++) {
          ctx.beginPath();
          ctx.arc(sx - 8 + i * 4, y + 21, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    // маркер маршрутки
    const bx = Math.max(x0 - 20, Math.min(x1, toX(this.pos)));
    ctx.fillStyle = this.spec.body;
    rrect(ctx, bx - 11, y - 9, 22, 13, 3);
    ctx.fill();
    ctx.fillStyle = '#1b1c22';
    ctx.beginPath();
    ctx.arc(bx - 5, y + 5, 3, 0, Math.PI * 2);
    ctx.arc(bx + 6, y + 5, 3, 0, Math.PI * 2);
    ctx.fill();

    // пауза
    const p = UI.pause;
    ctx.fillStyle = 'rgba(14,16,24,0.55)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x - 7, p.y - 8, 5, 16);
    ctx.fillRect(p.x + 2, p.y - 8, 5, 16);
  }

  private pulse(speed = 5) {
    return 0.5 + Math.sin(this.t * speed) * 0.5;
  }

  private drawDash() {
    const ctx = this.ctx;
    const tut = this.opts.day <= 1;
    // панель
    const g = ctx.createLinearGradient(0, 408, 0, H);
    g.addColorStop(0, '#2a2c33');
    g.addColorStop(1, '#17181c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 408, W, H - 408);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 160; i++) ctx.fillRect(hash(i) * W, 410 + hash(i + 7) * 310, 2, 2);
    ctx.fillStyle = '#0e0f12';
    ctx.fillRect(0, 404, W, 6);

    // наклейка тарифа
    const f = UI.fare;
    ctx.fillStyle = '#f2e8cf';
    rrect(ctx, f.x, f.y, f.w, f.h, 8);
    ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(f.x, f.y, f.w, 8);
    drawPaxIcon(ctx, f.x + 26, f.y + 52, false, '#2b2d42');
    ctx.fillStyle = '#2b2d42';
    ctx.font = '900 30px Rubik, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.cfg.fare), f.x + 46, f.y + 38);
    if (this.cfg.kids) {
      drawPaxIcon(ctx, f.x + 26, f.y + 92, true, '#2b2d42');
      ctx.font = '800 24px Rubik, system-ui, sans-serif';
      ctx.fillText(String(this.cfg.kidFare), f.x + 46, f.y + 80);
    }

    // рука с деньгами
    this.drawHand();

    // тарелка для сдачи
    const d = UI.dish;
    ctx.fillStyle = '#0f1013';
    ctx.beginPath();
    ctx.ellipse(d.cx, d.cy + 6, d.rx + 6, d.ry + 6, 0, 0, Math.PI * 2);
    ctx.fill();
    const dg = ctx.createRadialGradient(d.cx, d.cy - 20, 10, d.cx, d.cy, d.rx);
    dg.addColorStop(0, '#5a5e6b');
    dg.addColorStop(1, '#3a3d47');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.ellipse(d.cx, d.cy, d.rx, d.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(d.cx, d.cy, d.rx - 16, d.ry - 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    // сначала купюры, потом монеты
    for (const it of this.dish) if (it.d > COIN_MAX) drawMoney(ctx, it.d, it.x, it.y, 1, it.rot);
    for (const it of this.dish) if (it.d <= COIN_MAX) drawMoney(ctx, it.d, it.x, it.y, 1, it.rot);
    if (this.up.has('calculator')) {
      ctx.fillStyle = '#9fb59a';
      rrect(ctx, d.cx - 50, d.cy + d.ry - 12, 100, 30, 5);
      ctx.fill();
      ctx.fillStyle = '#1d2a1a';
      ctx.font = '700 20px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(this.dishTotal()), d.cx + 40, d.cy + d.ry + 4);
    }

    // кнопки
    const need = this.active ? this.paidSum(this.active) - this.active.due : -1;
    const canAct = !!this.active && this.handT > 0.95 && this.resolving <= 0;
    const okPulse = tut && canAct && need >= 0 && this.dishTotal() === need;
    this.roundBtn(UI.ok, '#3fa66b', canAct, okPulse, (c, x, y) => {
      c.strokeStyle = '#fff'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(x - 13, y + 1); c.lineTo(x - 3, y + 11); c.lineTo(x + 15, y - 10); c.stroke();
    });
    this.roundBtn(UI.no, '#c94b4b', canAct, false, (c, x, y) => {
      c.strokeStyle = '#fff'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - 9, y - 9); c.lineTo(x + 9, y + 9); c.moveTo(x + 9, y - 9); c.lineTo(x - 9, y + 9); c.stroke();
    });
    this.roundBtn(UI.clear, '#555a66', this.dish.length > 0, false, (c, x, y) => {
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.arc(x, y, 7, -Math.PI * 0.2, Math.PI * 1.3); c.stroke();
      c.beginPath(); c.moveTo(x + 6, y - 9); c.lineTo(x + 7, y - 3); c.lineTo(x + 1, y - 3); c.stroke();
    });

    // лоток
    const t = UI.tray;
    ctx.fillStyle = '#101115';
    rrect(ctx, t.x - 4, t.y - 4, t.w + 8, t.h + 8, 10);
    ctx.fill();
    const cw = t.w / DENOMS.length;
    const trayPulse = tut && canAct && need > 0 && this.dish.length === 0;
    DENOMS.forEach((den, i) => {
      const x = t.x + i * cw;
      const cnt = this.tray[den] ?? 0;
      ctx.fillStyle = '#26282f';
      rrect(ctx, x + 3, t.y, cw - 6, t.h, 8);
      ctx.fill();
      if (trayPulse) {
        ctx.strokeStyle = `rgba(255,230,120,${0.25 + this.pulse() * 0.5})`;
        ctx.lineWidth = 2;
        rrect(ctx, x + 3, t.y, cw - 6, t.h, 8);
        ctx.stroke();
      }
      ctx.globalAlpha = cnt > 0 ? 1 : 0.25;
      const cx = x + cw / 2;
      const stack = Math.min(cnt, 4);
      for (let k = stack - 1; k >= 0; k--) drawMoney(ctx, den, cx + k * 2, t.y + 44 - k * 4, den <= COIN_MAX ? 1.15 : 1.12, 0);
      if (stack === 0) drawMoney(ctx, den, cx, t.y + 44, den <= COIN_MAX ? 1.15 : 1.12, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = cnt > 0 ? '#c9ccd6' : '#6a6e7a';
      ctx.font = '700 16px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`×${cnt}`, cx, t.y + t.h - 16);
      ctx.fillStyle = '#4b4f5c';
      ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(String(i + 1), x + 14, t.y + 12);
    });

    // приборы
    this.drawSpeedo();
    this.drawClockFuel();

    // педали
    const ns = this.nextStop();
    const nearStop = ns && ns.x - this.pos < 900 && ns.x - this.pos > 30 && this.v > 60 &&
      (ns.parties.some((p) => p.members.some((m) => m.state === 'waiting')) || this.riders().some((p) => p.party.dest === ns.idx) || ns.kind === 'depot');
    this.pedal(UI.brake, this.brakeP, '#b23a3a', tut && !!nearStop);
    this.pedal(UI.gas, this.gasP, '#3a8a55', (tut || this.opts.day === 2) && !this.everGas && this.t > 1.2);
  }

  private roundBtn(b: { x: number; y: number; r: number }, col: string, on: boolean, pulse: boolean, icon: (c: Ctx, x: number, y: number) => void) {
    const ctx = this.ctx;
    ctx.globalAlpha = on ? 1 : 0.35;
    ctx.fillStyle = '#0c0d10';
    ctx.beginPath();
    ctx.arc(b.x, b.y + 4, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    if (pulse) {
      ctx.strokeStyle = `rgba(255,255,255,${0.3 + this.pulse(7) * 0.6})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    icon(ctx, b.x, b.y);
    ctx.globalAlpha = 1;
  }

  private pedal(r: { x: number; y: number; w: number; h: number }, p: number, col: string, hint: boolean) {
    const ctx = this.ctx;
    const press = p * 8;
    ctx.fillStyle = '#0b0c0f';
    rrect(ctx, r.x, r.y + 6, r.w, r.h, 12);
    ctx.fill();
    ctx.fillStyle = mix('#3b3e47', col, 0.25 + p * 0.6);
    rrect(ctx, r.x, r.y + press, r.w, r.h - press, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    for (let i = 1; i < 5; i++) {
      const y = r.y + press + ((r.h - press) / 5) * i;
      ctx.beginPath();
      ctx.moveTo(r.x + 14, y);
      ctx.lineTo(r.x + r.w - 14, y);
      ctx.stroke();
    }
    if (hint) {
      ctx.strokeStyle = `rgba(255,230,120,${0.3 + this.pulse(6) * 0.7})`;
      ctx.lineWidth = 4;
      rrect(ctx, r.x - 6, r.y - 6, r.w + 12, r.h + 18, 16);
      ctx.stroke();
    }
  }

  private drawSpeedo() {
    const ctx = this.ctx;
    const s = UI.speedo;
    ctx.fillStyle = '#0d0e11';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1e24';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const maxKmh = 80;
    for (let k = 0; k <= maxKmh; k += 10) {
      const a = a0 + ((a1 - a0) * k) / maxKmh;
      ctx.strokeStyle = k >= 60 ? '#ff6b6b' : '#c9ccd6';
      ctx.lineWidth = k % 20 === 0 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(a) * (s.r - 6), s.y + Math.sin(a) * (s.r - 6));
      ctx.lineTo(s.x + Math.cos(a) * (s.r - (k % 20 === 0 ? 18 : 13)), s.y + Math.sin(a) * (s.r - (k % 20 === 0 ? 18 : 13)));
      ctx.stroke();
      if (k % 20 === 0) {
        ctx.fillStyle = '#8a8f9c';
        ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(k), s.x + Math.cos(a) * (s.r - 32), s.y + Math.sin(a) * (s.r - 32));
      }
    }
    const kmh = this.v / 6.5;
    const a = a0 + ((a1 - a0) * Math.min(kmh, maxKmh)) / maxKmh;
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(a) * (s.r - 14), s.y + Math.sin(a) * (s.r - 14));
    ctx.stroke();
    ctx.fillStyle = '#ff8c42';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e6e8ee';
    ctx.font = '800 22px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(kmh)), s.x, s.y + 40);
    // индикатор перегрузки (инерция)
    const g = Math.min(1, Math.abs(this.accSm) / 700);
    ctx.fillStyle = g > 0.8 ? '#ff6b6b' : g > 0.5 ? '#ffc93c' : '#4cd964';
    ctx.fillRect(s.x - 26, s.y + 56, 52 * g, 4);
  }

  private drawClockFuel() {
    const ctx = this.ctx;
    const x = 1104, y = 424;
    ctx.fillStyle = '#0d0e11';
    rrect(ctx, x, y, 156, 160, 10);
    ctx.fill();
    // часы: 17:00 + минуты
    const mins = 17 * 60 + Math.floor(this.t);
    const hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    ctx.fillStyle = '#ffb02e';
    ctx.font = '700 32px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${hh}${Math.floor(this.t * 2) % 2 ? ':' : ' '}${mm}`, x + 78, y + 32);
    // график: полоса до конца смены
    const k = Math.min(1.2, this.t / this.schedule);
    ctx.fillStyle = '#26282f';
    rrect(ctx, x + 14, y + 58, 128, 10, 5);
    ctx.fill();
    ctx.fillStyle = k > 1 ? '#ff6b6b' : k > 0.85 ? '#ffc93c' : '#4cd964';
    rrect(ctx, x + 14, y + 58, 128 * Math.min(1, k), 10, 5);
    ctx.fill();
    // прогресс маршрута поверх (белая метка)
    const first = this.stops[0].x, last = this.stops[this.stops.length - 1].x;
    const pk = Math.max(0, Math.min(1, (this.pos - first) / (last - first)));
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 14 + 128 * pk - 1.5, y + 54, 3, 18);

    // бензин
    ctx.fillStyle = '#8a8f9c';
    ctx.beginPath();
    rrect(ctx, x + 16, y + 96, 18, 24, 3);
    ctx.fill();
    ctx.fillStyle = '#0d0e11';
    ctx.fillRect(x + 19, y + 100, 12, 7);
    ctx.fillStyle = '#e6e8ee';
    ctx.font = '700 20px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    const fc = Math.round(this.fuel * this.cfg.fuelPrice);
    ctx.fillText(fc ? `−${fc}` : '0', x + 44, y + 109);
    // касса
    const cash = this.trayTotal() - this.startTotal;
    drawMoney(ctx, 10, x + 25, y + 140, 0.75, 0);
    ctx.fillStyle = cash >= 0 ? '#7bd389' : '#ff6b6b';
    ctx.fillText(`${cash >= 0 ? '+' : '−'}${Math.abs(cash)}`, x + 44, y + 141);
  }

  private drawHand() {
    const ctx = this.ctx;
    const h = UI.hand;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    rrect(ctx, h.x, h.y, h.w, h.h, 14);
    ctx.fill();
    // очередь ожидающих (точки)
    const waitingQ = this.queue.length;
    for (let i = 0; i < Math.min(waitingQ, 6); i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(h.x + h.w - 18 - i * 14, h.y + 16, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const p = this.active;
    if (!p || this.handT <= 0) return;
    const e = 1 - Math.pow(1 - this.handT, 3);
    const shake = this.handShake > 0 ? Math.sin(this.handShake * 50) * 8 : 0;
    const pr = this.payer(p);
    const hx = -160 + e * 390 + shake, hy = 520;
    // рукав
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = mix(pr.look.coat, '#000000', 0.15);
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.moveTo(hx - 300, hy + 70);
    ctx.lineTo(hx - 50, hy + 8);
    ctx.stroke();
    ctx.strokeStyle = mix(pr.look.coat, '#ffffff', 0.15);
    ctx.lineWidth = 50;
    ctx.beginPath();
    ctx.moveTo(hx - 62, hy + 11);
    ctx.lineTo(hx - 52, hy + 8);
    ctx.stroke();
    // ладонь
    const bills = p.paid.filter((d) => d > COIN_MAX);
    const coins = p.paid.filter((d) => d <= COIN_MAX);
    ctx.fillStyle = pr.look.skin;
    ctx.beginPath();
    const palmW = 58 + Math.max(0, Math.min(4, coins.length) - 1) * 14 + (bills.length && coins.length ? 20 : 0);
    ctx.ellipse(hx + (palmW - 58) / 2, hy, palmW, 34 + (coins.length > 4 ? 14 : 0), -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hx - 30, hy - 26, 14, 9, -0.6, 0, Math.PI * 2); // большой палец
    ctx.fill();
    ctx.restore();
    // деньги на ладони
    // купюры веером слева, монеты — ровным рядом, чтобы их можно было пересчитать
    const billX = coins.length ? hx - 26 : hx;
    bills.forEach((d, i) => drawMoney(ctx, d, billX + i * 12, hy - 4 - i * 9, 1.05, -0.1 + i * 0.12));
    const cols = Math.min(4, coins.length);
    const cx0 = hx + (bills.length ? 30 : -((cols - 1) * 31) / 2);
    coins.forEach((d, i) => {
      const row = Math.floor(i / 4), col = i % 4;
      drawMoney(ctx, d, cx0 + col * 31, hy - 10 + row * 30 + (col % 2) * 3, 1, 0);
    });

    // пузырь: кто платит, сколько человек
    const bx = h.x + 12, by = h.y + 10;
    const icons = p.adults + p.kids;
    const bw = 64 + icons * 28;
    ctx.globalAlpha = e;
    ctx.fillStyle = '#f7f4ec';
    rrect(ctx, bx, by, bw, 56, 14);
    ctx.fill();
    // мордочка платящего
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx + 28, by + 28, 22, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#d9d2c3';
    ctx.fillRect(bx, by, 60, 60);
    drawPerson(ctx, bx + 25, by + 72, pr.look, {
      seated: true, mood: pr.mood, blink: pr.blink < 0, shifty: p.cheat,
    });
    ctx.restore();
    let ix = bx + 64;
    for (let i = 0; i < p.adults; i++) { drawPaxIcon(ctx, ix + 8, by + 46, false); ix += 26; }
    for (let i = 0; i < p.kids; i++) { drawPaxIcon(ctx, ix + 8, by + 46, true, '#3d6fd1'); ix += 26; }
    // нетерпение
    const waited = (performance.now() - p.activeAt) / 1000;
    const pat = 35 * (this.up.has('freshener') ? 1.5 : 1);
    if (waited > pat * 0.35 && this.resolving <= 0) {
      const k = Math.min(1, waited / pat);
      ctx.fillStyle = '#e0dccf';
      rrect(ctx, bx + 8, by + 60, bw - 16, 6, 3);
      ctx.fill();
      ctx.fillStyle = k > 0.75 ? '#e05252' : '#e0a030';
      rrect(ctx, bx + 8, by + 60, (bw - 16) * (1 - k), 6, 3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPause() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,9,14,0.72)';
    ctx.fillRect(0, 0, W, H);
    // ▶
    ctx.fillStyle = '#3fa66b';
    ctx.beginPath();
    ctx.arc(540, 380, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(526, 352); ctx.lineTo(526, 408); ctx.lineTo(572, 380); ctx.closePath();
    ctx.fill();
    // ⌂
    ctx.fillStyle = '#555a66';
    ctx.beginPath();
    ctx.arc(740, 380, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(740, 350); ctx.lineTo(770, 378); ctx.lineTo(760, 378); ctx.lineTo(760, 408); ctx.lineTo(720, 408); ctx.lineTo(720, 378); ctx.lineTo(710, 378);
    ctx.closePath();
    ctx.fill();
    // звук
    ctx.fillStyle = '#2a2c33';
    ctx.beginPath();
    ctx.arc(640, 500, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(624, 492); ctx.lineTo(632, 492); ctx.lineTo(644, 482); ctx.lineTo(644, 518); ctx.lineTo(632, 508); ctx.lineTo(624, 508);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    if (sfx.muted) {
      ctx.beginPath(); ctx.moveTo(650, 490); ctx.lineTo(662, 510); ctx.moveTo(662, 490); ctx.lineTo(650, 510); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(646, 500, 10, -0.8, 0.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(646, 500, 17, -0.8, 0.8); ctx.stroke();
    }
    // подсказка по клавишам — цифрами и стрелками
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '600 16px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('→ газ   ← тормоз   1–8 монеты   Enter ✓   X ✗   ⌫ убрать', 640, 600);
  }
}
