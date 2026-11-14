// Процедурная отрисовка: люди, маршрутка, деньги, иконки остановок.
// Никаких картинок — всё рисуется кодом, поэтому стиль единый.

export type Ctx = CanvasRenderingContext2D;

export function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  w = Math.max(0, w);
  h = Math.max(0, h);
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

// ---------- Люди ----------

export type Hat = 'none' | 'cap' | 'scarf' | 'beanie' | 'bun' | 'bald' | 'hood' | 'curly';

export interface Look {
  coat: string;
  skin: string;
  hair: string;
  hat: Hat;
  hatColor: string;
  width: number;   // 0.85..1.25
  height: number;  // 0.9..1.1
  glasses: boolean;
  kid: boolean;
  bag: boolean;
}

const COATS = ['#3d5a80', '#98c1d9', '#ee6c4d', '#5c4d7d', '#2a9d8f', '#8d6346', '#c44536', '#6b705c', '#264653', '#e9c46a', '#7f5539', '#457b9d'];
const SKINS = ['#f2d0b1', '#e6b896', '#c99572', '#a8714f', '#7b4b32', '#f5dcc6'];
const HAIRS = ['#2b2118', '#4a3426', '#8a5a2b', '#c9a15b', '#d9d4cc', '#1c1c1c', '#7a2e1d'];

export function randomLook(r: () => number, kid = false): Look {
  const hat = pick(r, ['none', 'cap', 'scarf', 'beanie', 'bun', 'bald', 'hood', 'curly', 'none', 'scarf'] as Hat[]);
  return {
    coat: pick(r, COATS),
    skin: pick(r, SKINS),
    hair: hat === 'scarf' ? '#d9d4cc' : pick(r, HAIRS),
    hat: kid && (hat === 'bald' || hat === 'scarf') ? 'beanie' : hat,
    hatColor: pick(r, ['#c44536', '#e9c46a', '#2a9d8f', '#f4f1de', '#5c4d7d', '#1d3557', '#d4a373']),
    width: kid ? 0.8 : 0.85 + r() * 0.4,
    height: kid ? 0.62 : 0.92 + r() * 0.18,
    glasses: r() < 0.22,
    kid,
    bag: !kid && r() < 0.3,
  };
}

export interface PersonOpts {
  seated?: boolean;
  lean?: number;     // радианы
  mood?: number;     // 0..1
  alpha?: number;
  shade?: number;    // 0..1 затемнение (дальний ряд, ночь)
  blink?: boolean;
  fallen?: number;   // 0..1
  shifty?: boolean;  // бегающие глаза (жулик)
}

/** Рисует человека. (x, y) — точка опоры (ноги или сиденье). Смотрит вправо. */
export function drawPerson(ctx: Ctx, x: number, y: number, look: Look, o: PersonOpts = {}) {
  const s = look.height;
  const w = look.width;
  const bodyH = (o.seated ? 34 : 50) * s;
  const bodyW = 22 * w;
  const headR = 11 * (look.kid ? 1.05 : 1);
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.translate(x, y);
  let rot = o.lean ?? 0;
  if (o.fallen) rot += o.fallen * 1.2;
  ctx.rotate(rot);

  const shade = (c: string) => (o.shade ? mix(c, '#141826', o.shade) : c);

  // ноги
  if (!o.seated) {
    ctx.fillStyle = shade('#2b2d42');
    rrect(ctx, -bodyW * 0.35, -16 * s, bodyW * 0.3, 16 * s, 3);
    ctx.fill();
    rrect(ctx, bodyW * 0.05, -16 * s, bodyW * 0.3, 16 * s, 3);
    ctx.fill();
  }
  // туловище
  ctx.fillStyle = shade(look.coat);
  const by = o.seated ? -bodyH : -bodyH;
  rrect(ctx, -bodyW / 2, by, bodyW, bodyH - (o.seated ? 0 : 12 * s), 9 * w);
  ctx.fill();
  // сумка
  if (look.bag) {
    ctx.fillStyle = shade('#6d4c41');
    rrect(ctx, -bodyW / 2 - 7, by + bodyH * 0.35, 10, 14, 3);
    ctx.fill();
  }
  // голова
  const hy = by - headR + 3;
  ctx.fillStyle = shade(look.skin);
  ctx.beginPath();
  ctx.arc(0, hy, headR, 0, Math.PI * 2);
  ctx.fill();

  // волосы / шапки
  const hc = shade(look.hatColor);
  const hair = shade(look.hair);
  switch (look.hat) {
    case 'cap':
      ctx.fillStyle = hc;
      ctx.beginPath();
      ctx.arc(0, hy - 2, headR, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(0, hy - 3, headR + 7, 4);
      break;
    case 'scarf':
      ctx.fillStyle = hc;
      ctx.beginPath();
      ctx.arc(0, hy, headR + 2.5, Math.PI * 0.75, Math.PI * 2.1);
      ctx.lineTo(-2, hy + headR + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade('#ffffff');
      ctx.globalAlpha *= 0.35;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * 5 - 2, hy - 6, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = o.alpha ?? 1;
      break;
    case 'beanie':
      ctx.fillStyle = hc;
      ctx.beginPath();
      ctx.arc(0, hy - 1, headR + 1, Math.PI * 1.05, Math.PI * 1.95);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-headR - 1, hy - 4, headR * 2 + 2, 4);
      ctx.beginPath();
      ctx.arc(0, hy - headR - 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bun':
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(0, hy - 1, headR, Math.PI * 0.95, Math.PI * 2.02);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-headR * 0.6, hy - headR + 1, 5.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bald':
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(-3, hy + 1, headR + 0.5, Math.PI * 0.6, Math.PI * 1.05);
      ctx.lineTo(-3, hy);
      ctx.fill();
      break;
    case 'hood':
      ctx.fillStyle = shade(look.coat);
      ctx.beginPath();
      ctx.arc(-1, hy, headR + 3, Math.PI * 0.55, Math.PI * 1.85);
      ctx.closePath();
      ctx.fill();
      break;
    case 'curly':
      ctx.fillStyle = hair;
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (0.85 + i * 0.22);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * headR * 0.85, hy + Math.sin(a) * headR * 0.85, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    default:
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(0, hy - 1, headR, Math.PI * 0.9, Math.PI * 1.9);
      ctx.lineTo(-headR * 0.3, hy - 2);
      ctx.closePath();
      ctx.fill();
  }

  // лицо (смотрит вправо)
  const mood = o.mood ?? 0.7;
  const ex = headR * 0.35;
  ctx.fillStyle = shade('#1b1b1b');
  const look2 = o.shifty ? Math.sin(performance.now() / 180) * 1.6 : 0;
  if (o.blink) {
    ctx.fillRect(ex - 2, hy - 2, 4, 1.4);
    ctx.fillRect(ex + 5, hy - 2, 4, 1.4);
  } else {
    ctx.beginPath();
    ctx.arc(ex + look2, hy - 2, 1.6, 0, Math.PI * 2);
    ctx.arc(ex + 7 + look2, hy - 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (look.glasses) {
    ctx.strokeStyle = shade('#1b1b1b');
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(ex, hy - 2, 3.4, 0, Math.PI * 2);
    ctx.moveTo(ex + 10.4, hy - 2);
    ctx.arc(ex + 7, hy - 2, 3.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  // брови при злости
  if (mood < 0.3) {
    ctx.strokeStyle = shade('#1b1b1b');
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ex - 3, hy - 7);
    ctx.lineTo(ex + 2, hy - 5);
    ctx.moveTo(ex + 10, hy - 7);
    ctx.lineTo(ex + 5, hy - 5);
    ctx.stroke();
  }
  // рот
  ctx.strokeStyle = shade('#3a1f1a');
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const mx = ex + 3.5, my = hy + 5;
  const curve = (mood - 0.5) * 7;
  ctx.moveTo(mx - 4, my);
  ctx.quadraticCurveTo(mx, my + curve, mx + 4, my);
  ctx.stroke();
  // румянец
  if (mood > 0.85) {
    ctx.fillStyle = 'rgba(230,90,90,0.35)';
    ctx.beginPath();
    ctx.arc(ex - 2, hy + 3, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Мини-силуэт для пузыря «сколько человек». */
export function drawPaxIcon(ctx: Ctx, x: number, y: number, kid: boolean, color = '#1d2433') {
  const s = kid ? 0.7 : 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - 22 * s, 6 * s, 0, Math.PI * 2);
  ctx.fill();
  rrect(ctx, x - 7 * s, y - 15 * s, 14 * s, 15 * s, 5 * s);
  ctx.fill();
}

// ---------- Деньги ----------

export const MONEY_STYLE: Record<number, { fill: string; ink: string; coin: boolean; r?: number }> = {
  1: { fill: '#c9ccd1', ink: '#5b6068', coin: true, r: 13 },
  2: { fill: '#d5d8dd', ink: '#5b6068', coin: true, r: 14 },
  5: { fill: '#dfe2e6', ink: '#555a62', coin: true, r: 15.5 },
  10: { fill: '#e2b649', ink: '#7a5a12', coin: true, r: 15 },
  50: { fill: '#8fb0c9', ink: '#24425c', coin: false },
  100: { fill: '#c9a27a', ink: '#5a3a1c', coin: false },
  500: { fill: '#b493c4', ink: '#4a2a5c', coin: false },
  1000: { fill: '#7fbfa9', ink: '#1e5244', coin: false },
};

export function drawMoney(ctx: Ctx, d: number, x: number, y: number, scale = 1, rot = 0) {
  const st = MONEY_STYLE[d];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  if (st.coin) {
    const r = st.r!;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(1.5, 2.5, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = st.fill;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = st.ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = st.ink;
    ctx.font = `800 ${r * 0.95}px Rubik, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(d), 0, 1);
  } else {
    const w = 66, h = 34;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    rrect(ctx, -w / 2 + 2, -h / 2 + 3, w, h, 3);
    ctx.fill();
    ctx.fillStyle = st.fill;
    rrect(ctx, -w / 2, -h / 2, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = st.ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    rrect(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-w / 2 + 16, 0, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = st.ink;
    ctx.font = `800 17px Rubik, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(d), w / 2 - 6, 1);
  }
  ctx.restore();
}

// ---------- Иконки остановок ----------

export type StopKind = 'park' | 'hospital' | 'school' | 'market' | 'home' | 'factory' | 'circus' | 'station' | 'depot';
export const STOP_KINDS: StopKind[] = ['park', 'hospital', 'school', 'market', 'home', 'factory', 'circus', 'station'];
export const STOP_COLOR: Record<StopKind, string> = {
  park: '#3e9b5c',
  hospital: '#d64545',
  school: '#3d6fd1',
  market: '#e8902a',
  home: '#8a58c4',
  factory: '#6f7680',
  circus: '#d64596',
  station: '#1f9aa8',
  depot: '#2b2d42',
};

export function drawStopIcon(ctx: Ctx, kind: StopKind, x: number, y: number, r: number, ring = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = STOP_COLOR[kind];
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  const k = r / 20;
  ctx.scale(k, k);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'park': // дерево
      ctx.beginPath();
      ctx.arc(0, -4, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-1.8, 2, 3.6, 10);
      break;
    case 'hospital':
      ctx.fillRect(-3, -10, 6, 20);
      ctx.fillRect(-10, -3, 20, 6);
      break;
    case 'school': // книга
      ctx.beginPath();
      ctx.moveTo(0, -6); ctx.lineTo(-11, -9); ctx.lineTo(-11, 8); ctx.lineTo(0, 11);
      ctx.lineTo(11, 8); ctx.lineTo(11, -9); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = STOP_COLOR.school;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, 11); ctx.stroke();
      break;
    case 'market': // тележка
      ctx.beginPath();
      ctx.moveTo(-12, -9); ctx.lineTo(-8, -9); ctx.lineTo(-5, 5); ctx.lineTo(9, 5); ctx.lineTo(11, -5); ctx.lineTo(-7, -5);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(-3, 10, 2.4, 0, Math.PI * 2); ctx.arc(7, 10, 2.4, 0, Math.PI * 2); ctx.fill();
      break;
    case 'home':
      ctx.beginPath();
      ctx.moveTo(0, -12); ctx.lineTo(12, -1); ctx.lineTo(8, -1); ctx.lineTo(8, 11); ctx.lineTo(-8, 11); ctx.lineTo(-8, -1); ctx.lineTo(-12, -1);
      ctx.closePath(); ctx.fill();
      break;
    case 'factory':
      ctx.beginPath();
      ctx.moveTo(-12, 11); ctx.lineTo(-12, -2); ctx.lineTo(-5, 3); ctx.lineTo(-5, -2); ctx.lineTo(2, 3); ctx.lineTo(2, -11);
      ctx.lineTo(7, -11); ctx.lineTo(7, 3); ctx.lineTo(12, 3); ctx.lineTo(12, 11); ctx.closePath(); ctx.fill();
      break;
    case 'circus': // шатёр
      ctx.beginPath();
      ctx.moveTo(0, -13); ctx.lineTo(12, 3); ctx.lineTo(12, 11); ctx.lineTo(-12, 11); ctx.lineTo(-12, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = STOP_COLOR.circus;
      ctx.fillRect(-3, 3, 6, 8);
      break;
    case 'station': // поезд
      rrect(ctx, -10, -11, 20, 18, 4); ctx.fill();
      ctx.fillStyle = STOP_COLOR.station;
      ctx.fillRect(-7, -8, 14, 6);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(-7, 12); ctx.lineTo(-3, 7); ctx.moveTo(7, 12); ctx.lineTo(3, 7); ctx.stroke();
      break;
    case 'depot': // флаг
      ctx.beginPath(); ctx.moveTo(-8, 12); ctx.lineTo(-8, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(11, -7); ctx.lineTo(-6, -1); ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
}

// ---------- Маршрутка ----------

export interface BusSpec {
  body: string;
  stripe: string;
  length: number;
}

export interface BusDraw {
  x0: number;        // левый (задний) край
  gy: number;        // уровень дороги под колёсами
  wheelRot: number;
  doorOpen: number;  // 0..1
  night: number;     // 0..1
  pitch: number;     // радианы, клевок при торможении
  interior?: (ctx: Ctx) => void;
  driverMood?: number;
}

export const BUS_H = 122;
export const doorCenter = (spec: BusSpec, x0: number) => x0 + spec.length - 112;

export function drawBus(ctx: Ctx, spec: BusSpec, d: BusDraw) {
  const L = spec.length;
  const { x0, gy } = d;
  const top = gy - BUS_H;
  ctx.save();
  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x0 + L / 2, gy + 2, L / 2 + 6, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // наклон вокруг задних колёс
  ctx.translate(x0 + 60, gy - 18);
  ctx.rotate(d.pitch);
  ctx.translate(-(x0 + 60), -(gy - 18));

  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(x0 + 4, gy - 20);
    ctx.lineTo(x0, top + 14);
    ctx.quadraticCurveTo(x0, top, x0 + 16, top);
    ctx.lineTo(x0 + L - 70, top - 2);
    ctx.quadraticCurveTo(x0 + L - 52, top - 2, x0 + L - 40, top + 14);
    ctx.lineTo(x0 + L - 8, top + 60);
    ctx.quadraticCurveTo(x0 + L, top + 66, x0 + L, top + 78);
    ctx.lineTo(x0 + L, gy - 20);
    ctx.closePath();
  };

  // кузов
  ctx.fillStyle = spec.body;
  bodyPath();
  ctx.fill();

  // окна-салон
  const wx0 = x0 + 12, wx1 = x0 + L - 132, wy0 = top + 12, wy1 = top + 56;
  ctx.save();
  rrect(ctx, wx0, wy0, wx1 - wx0, wy1 - wy0, 6);
  ctx.clip();
  const ig = ctx.createLinearGradient(0, wy0, 0, wy1);
  ig.addColorStop(0, mix('#ffe7b0', '#f2c76b', d.night));
  ig.addColorStop(1, mix('#d9c08a', '#a8813d', d.night));
  ctx.fillStyle = d.night > 0.4 ? ig : '#3c4152';
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  if (d.interior) d.interior(ctx);
  // блик стекла
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(wx0, wy0); ctx.lineTo(wx0 + 70, wy0); ctx.lineTo(wx0 + 30, wy1); ctx.lineTo(wx0, wy1);
  ctx.fill();
  ctx.restore();

  // стойки окон
  ctx.fillStyle = spec.body;
  const n = Math.round((wx1 - wx0) / 62);
  for (let i = 1; i < n; i++) {
    const px = wx0 + ((wx1 - wx0) / n) * i;
    ctx.fillRect(px - 3, wy0, 6, wy1 - wy0);
  }

  // дверь
  const dc = doorCenter(spec, x0);
  const dw = 40;
  const dTop = top + 10, dBot = gy - 22;
  ctx.fillStyle = '#20232d';
  ctx.fillRect(dc - dw / 2, dTop, dw, dBot - dTop);
  if (d.doorOpen > 0) {
    // ступенька и свет
    ctx.fillStyle = d.night > 0.3 ? 'rgba(255,214,140,0.65)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(dc - dw / 2 + 3, dTop + 3, dw - 6, dBot - dTop - 3);
    ctx.fillStyle = '#5a5f6e';
    ctx.fillRect(dc - dw / 2, dBot - 8, dw, 8);
  }
  const doff = d.doorOpen * (dw - 4);
  ctx.save();
  ctx.translate(-doff, 0);
  ctx.fillStyle = mix(spec.body, '#000000', 0.08);
  ctx.fillRect(dc - dw / 2, dTop, dw, dBot - dTop);
  ctx.fillStyle = '#3c4152';
  rrect(ctx, dc - dw / 2 + 5, dTop + 4, dw - 10, 42, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(dc + dw / 2 - 8, dTop + 54, 4, 14);
  ctx.restore();

  // лобовое стекло и водитель
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0 + L - 88, top + 12);
  ctx.lineTo(x0 + L - 50, top + 12);
  ctx.lineTo(x0 + L - 14, top + 60);
  ctx.lineTo(x0 + L - 88, top + 60);
  ctx.closePath();
  ctx.fillStyle = '#3c4152';
  ctx.fill();
  ctx.clip();
  // водитель (вид сбоку)
  drawPerson(ctx, x0 + L - 58, top + 92, DRIVER, { seated: true, mood: d.driverMood ?? 0.7, shade: 0.1 });
  // руль
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x0 + L - 34, top + 58, 4, 12, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(x0 + L - 60, top + 12); ctx.lineTo(x0 + L - 48, top + 12); ctx.lineTo(x0 + L - 70, top + 60); ctx.lineTo(x0 + L - 82, top + 60);
  ctx.fill();
  ctx.restore();

  // полоса
  ctx.fillStyle = spec.stripe;
  ctx.save();
  bodyPath();
  ctx.clip();
  ctx.fillRect(x0 - 5, top + 68, L + 10, 9);
  ctx.fillRect(x0 - 5, gy - 30, L + 10, 4);
  ctx.restore();
  // перерисуем дверь поверх полосы
  ctx.save();
  ctx.translate(-doff, 0);
  ctx.fillStyle = mix(spec.body, '#000000', 0.08);
  ctx.fillRect(dc - dw / 2, top + 66, dw, 12);
  ctx.restore();

  // табличка маршрута
  ctx.fillStyle = '#16181f';
  rrect(ctx, x0 + L - 150, top - 16, 56, 16, 3);
  ctx.fill();
  ctx.fillStyle = '#ffb02e';
  ctx.font = '700 12px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('47', x0 + L - 122, top - 7.5);

  // фары
  ctx.fillStyle = d.night > 0.3 ? '#fff6c9' : '#f4ecd0';
  rrect(ctx, x0 + L - 8, gy - 48, 8, 12, 3);
  ctx.fill();
  if (d.night > 0.3) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(x0 + L, 0, x0 + L + 260, 0);
    g.addColorStop(0, `rgba(255,240,180,${0.35 * d.night})`);
    g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 + L, gy - 46); ctx.lineTo(x0 + L + 260, gy - 70); ctx.lineTo(x0 + L + 260, gy + 4); ctx.lineTo(x0 + L, gy - 38);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#c0392b';
  rrect(ctx, x0 - 2, gy - 50, 6, 14, 2);
  ctx.fill();

  // колёса
  for (const wx of [x0 + 60, x0 + L - 72]) {
    ctx.fillStyle = mix(spec.body, '#000000', 0.35);
    ctx.beginPath();
    ctx.arc(wx, gy - 18, 23, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#1b1c22';
    ctx.beginPath();
    ctx.arc(wx, gy - 18, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8b8f99';
    ctx.beginPath();
    ctx.arc(wx, gy - 18, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555a66';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = d.wheelRot + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(wx, gy - 18);
      ctx.lineTo(wx + Math.cos(a) * 8, gy - 18 + Math.sin(a) * 8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export const DRIVER: Look = {
  coat: '#4a4e69',
  skin: '#e6b896',
  hair: '#2b2118',
  hat: 'cap',
  hatColor: '#22223b',
  width: 1.15,
  height: 1.0,
  glasses: false,
  kid: false,
  bag: false,
};
