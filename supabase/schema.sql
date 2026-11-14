-- «Передайте за проезд» — схема базы для Supabase (PostgreSQL).
-- Выполнить один раз: Supabase → SQL Editor → вставить весь файл → Run.
-- Повторный запуск безопасен (всё создаётся через IF NOT EXISTS / OR REPLACE).
--
-- Как это работает без своего сервера:
--  * браузер НЕ имеет прямого доступа к таблицам (RLS включён, политик нет, права отозваны);
--  * всё общение идёт через функции ниже (Supabase отдаёт их как POST /rest/v1/rpc/<имя>);
--  * функции выполняются с правами владельца (SECURITY DEFINER) и сами проверяют данные:
--    считают прибыль, проверяют деньги при покупке — как раньше делал сервер на Express.
-- Цены и тарифы должны совпадать с shared/catalog.js.

-- ---------- Таблицы ----------

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

-- Прямой доступ из браузера к таблицам закрыт
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE saves   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON players, saves, shifts FROM anon, authenticated;

-- ---------- Вспомогательные функции (не доступны снаружи) ----------

CREATE OR REPLACE FUNCTION _valid_id(p_id TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_id ~ '^[0-9a-f-]{36}$'
$$;

CREATE OR REPLACE FUNCTION _clean_name(p_name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT left(btrim(regexp_replace(coalesce(p_name, ''), '[\x00-\x1f<>]', '', 'g')), 24)
$$;

CREATE OR REPLACE FUNCTION _clamp(v INTEGER, lo INTEGER, hi INTEGER) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT least(hi, greatest(lo, coalesce(v, lo)))
$$;

-- Аренда за день — как dayConfig(day).rent в shared/catalog.js
CREATE OR REPLACE FUNCTION _rent(p_day INTEGER) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT round(60 + (ARRAY[30, 45, 55, 65, 73, 87, 94])[least(greatest(p_day, 1), 7)] * 1.5)::INTEGER
$$;

CREATE OR REPLACE FUNCTION _item_price(p_item TEXT) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_item
    WHEN 'pazik' THEN 0 WHEN 'gazelle' THEN 4000 WHEN 'citybus' THEN 12000
    WHEN 'freshener' THEN 300 WHEN 'calculator' THEN 800 WHEN 'suspension' THEN 1500 WHEN 'engine' THEN 2000
  END
$$;

CREATE OR REPLACE FUNCTION _player_json(p_id TEXT) RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'id', p.id, 'name', p.name,
    'save', json_build_object('money', s.money, 'day', s.day, 'vehicle', s.vehicle, 'owned', s.owned, 'upgrades', s.upgrades))
  FROM players p JOIN saves s ON s.player_id = p.id
  WHERE p.id = p_id
$$;

-- ---------- Функции, которые вызывает игра ----------

-- Новый водитель
CREATE OR REPLACE FUNCTION create_player(p_name TEXT DEFAULT NULL) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id TEXT := gen_random_uuid()::TEXT;
  v_name TEXT := _clean_name(p_name);
BEGIN
  IF v_name = '' THEN v_name := 'Водитель №' || (1000 + floor(random() * 9000))::INT; END IF;
  INSERT INTO players (id, name) VALUES (v_id, v_name);
  INSERT INTO saves (player_id, money) VALUES (v_id, 500);
  RETURN _player_json(v_id);
END $$;

-- Загрузить водителя (NULL, если такого нет)
CREATE OR REPLACE FUNCTION get_player(p_id TEXT) RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _valid_id(p_id) THEN _player_json(p_id) END
$$;

CREATE OR REPLACE FUNCTION rename_player(p_id TEXT, p_name TEXT) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name TEXT := _clean_name(p_name);
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'bad_name'; END IF;
  UPDATE players SET name = v_name WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN _player_json(p_id);
END $$;

-- Итоги смены: база сама считает аренду и прибыль, двигает день
CREATE OR REPLACE FUNCTION submit_shift(
  p_id TEXT, p_passengers INTEGER, p_revenue INTEGER, p_fuel_cost INTEGER, p_fines INTEGER,
  p_ops INTEGER, p_correct INTEGER, p_avg_ms INTEGER, p_falls INTEGER, p_duration_s INTEGER
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s saves%ROWTYPE;
  v_rent INTEGER; v_profit INTEGER;
  v_rev INTEGER := _clamp(p_revenue, -20000, 50000);
  v_fuel INTEGER := _clamp(p_fuel_cost, 0, 20000);
  v_fines INTEGER := _clamp(p_fines, 0, 50000);
  v_ops INTEGER := _clamp(p_ops, 0, 500);
BEGIN
  SELECT * INTO s FROM saves WHERE player_id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_rent := _rent(s.day);
  v_profit := v_rev - v_fuel - v_rent - v_fines;
  INSERT INTO shifts (player_id, day, vehicle, passengers, revenue, fuel_cost, rent, fines, profit,
                      ops, correct, avg_ms, falls, duration_s)
  VALUES (p_id, s.day, s.vehicle, _clamp(p_passengers, 0, 500), v_rev, v_fuel, v_rent, v_fines, v_profit,
          v_ops, least(_clamp(p_correct, 0, 500), v_ops), _clamp(p_avg_ms, 0, 600000),
          _clamp(p_falls, 0, 500), _clamp(p_duration_s, 0, 7200));
  UPDATE saves SET money = money + v_profit, day = day + 1, updated_at = now() WHERE player_id = p_id;
  RETURN json_build_object('profit', v_profit, 'rent', v_rent, 'player', _player_json(p_id));
END $$;

-- Покупка машины / тюнинга (или пересесть на уже купленную машину)
CREATE OR REPLACE FUNCTION buy(p_id TEXT, p_item TEXT) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s saves%ROWTYPE;
  v_price INTEGER := _item_price(p_item);
  v_vehicle BOOLEAN := p_item IN ('pazik', 'gazelle', 'citybus');
BEGIN
  IF v_price IS NULL THEN RAISE EXCEPTION 'unknown_item'; END IF;
  SELECT * INTO s FROM saves WHERE player_id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF v_vehicle AND s.owned ? p_item THEN
    UPDATE saves SET vehicle = p_item, updated_at = now() WHERE player_id = p_id;
    RETURN _player_json(p_id);
  END IF;
  IF NOT v_vehicle AND s.upgrades ? p_item THEN RAISE EXCEPTION 'owned'; END IF;
  IF s.money < v_price THEN RAISE EXCEPTION 'no_money'; END IF;

  IF v_vehicle THEN
    UPDATE saves SET money = money - v_price, vehicle = p_item, owned = owned || to_jsonb(p_item), updated_at = now()
     WHERE player_id = p_id;
  ELSE
    UPDATE saves SET money = money - v_price, upgrades = upgrades || to_jsonb(p_item), updated_at = now()
     WHERE player_id = p_id;
  END IF;
  RETURN _player_json(p_id);
END $$;

-- История последних 20 смен (для графика «как я считаю»)
CREATE OR REPLACE FUNCTION player_history(p_id TEXT) RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(json_agg(r ORDER BY r.id), '[]'::json) FROM (
    SELECT id, day, vehicle, passengers, revenue, fuel_cost, rent, fines, profit, ops, correct, avg_ms, falls,
           duration_s, created_at
      FROM shifts WHERE player_id = p_id ORDER BY id DESC LIMIT 20
  ) r
$$;

-- Доска почёта: лучшая смена каждого водителя, топ-10
CREATE OR REPLACE FUNCTION leaderboard() RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(json_agg(t ORDER BY t.profit DESC), '[]'::json) FROM (
    SELECT * FROM (
      SELECT DISTINCT ON (p.id) p.name, s.profit, s.day, s.correct, s.ops
        FROM shifts s JOIN players p ON p.id = s.player_id
       ORDER BY p.id, s.profit DESC
    ) best ORDER BY profit DESC LIMIT 10
  ) t
$$;

-- ---------- Права: снаружи можно только вызывать эти функции ----------
REVOKE ALL ON FUNCTION _valid_id(TEXT), _clean_name(TEXT), _clamp(INTEGER, INTEGER, INTEGER), _rent(INTEGER),
  _item_price(TEXT), _player_json(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_player(TEXT), get_player(TEXT), rename_player(TEXT, TEXT),
  submit_shift(TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER),
  buy(TEXT, TEXT), player_history(TEXT), leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_player(TEXT), get_player(TEXT), rename_player(TEXT, TEXT),
  submit_shift(TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER),
  buy(TEXT, TEXT), player_history(TEXT), leaderboard() TO anon, authenticated;
