// Общий каталог: используется и клиентом, и сервером (сервер проверяет покупки по нему).

export const START_MONEY = 500;

/** Номиналы в лотке кассы (монеты и купюры), по возрастанию. */
export const DENOMS = [1, 2, 5, 10, 50, 100, 500, 1000];
export const COIN_MAX = 10; // всё, что <= 10, — монеты

export const VEHICLES = {
  pazik: {
    id: 'pazik',
    price: 0,
    seats: 8,
    standing: 4,
    maxV: 380,
    accel: 210,
    fuelRate: 1.0,
    grip: 1.0, // множитель порога падения стоящих
    body: '#e8dcc0',
    stripe: '#b8432f',
    length: 360,
  },
  gazelle: {
    id: 'gazelle',
    price: 4000,
    seats: 12,
    standing: 6,
    maxV: 440,
    accel: 250,
    fuelRate: 0.8,
    grip: 1.1,
    body: '#f2c230',
    stripe: '#2b3a55',
    length: 400,
  },
  citybus: {
    id: 'citybus',
    price: 12000,
    seats: 16,
    standing: 8,
    maxV: 480,
    accel: 290,
    fuelRate: 0.62,
    grip: 1.25,
    body: '#f4f1ea',
    stripe: '#2f8a5b',
    length: 450,
  },
};

export const UPGRADES = {
  freshener: { id: 'freshener', price: 300 },   // ёлочка: пассажиры дольше не злятся
  calculator: { id: 'calculator', price: 800 }, // показывает сумму сдачи (костыль!)
  suspension: { id: 'suspension', price: 1500 },// стоящие реже падают
  engine: { id: 'engine', price: 2000 },        // −25% топлива
};

/** Параметры смены по номеру дня. Детерминированы, чтобы сервер мог их знать. */
export function dayConfig(day) {
  const d = Math.max(1, Math.floor(day));
  const fares = [30, 45, 55, 65, 73, 87, 94];
  const fare = fares[Math.min(d - 1, fares.length - 1)];
  return {
    fare,
    kidFare: Math.ceil(fare / 2),
    stops: Math.min(6 + d, 11),
    kids: d >= 2,
    cheats: d >= 3,
    bigBills: d >= 3,
    smartPayers: d >= 2,
    lights: Math.min(1 + Math.floor(d / 2), 4),
    rent: Math.round(60 + fare * 1.5),
    fuelPrice: 45,
    complaintFine: Math.round(fare * 2),
    redLightFine: fare * 4,
  };
}

export const START_FLOAT = { 1: 10, 2: 10, 5: 8, 10: 10, 50: 4, 100: 3, 500: 1, 1000: 0 };
