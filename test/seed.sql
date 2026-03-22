-- ── Report SDK stress-test seed ──────────────────────────────────────────────
-- E-commerce schema: customers, products, orders, order_items, events
-- ~1M orders, ~5M order_items, ~2M events

-- ── Schema ────────────────────────────────────────────────────────────────────

CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES categories(id),
  name          TEXT NOT NULL,
  sku           TEXT NOT NULL UNIQUE,
  price         NUMERIC(10,2) NOT NULL,
  cost          NUMERIC(10,2) NOT NULL,
  stock_qty     INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customers (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  country       TEXT NOT NULL,
  plan          TEXT NOT NULL CHECK (plan IN ('free','starter','pro','enterprise')),
  ltv           NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ
);

CREATE TABLE orders (
  id            SERIAL PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES customers(id),
  status        TEXT NOT NULL CHECK (status IN ('pending','processing','shipped','delivered','cancelled','refunded')),
  subtotal      NUMERIC(12,2) NOT NULL,
  discount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total         NUMERIC(12,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  shipped_at    TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ
);

CREATE TABLE order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id),
  product_id  INT NOT NULL REFERENCES products(id),
  qty         INT NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL,
  line_total  NUMERIC(12,2) NOT NULL
);

CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  customer_id INT REFERENCES customers(id),
  session_id  UUID NOT NULL,
  event_type  TEXT NOT NULL,
  page        TEXT,
  product_id  INT REFERENCES products(id),
  occurred_at TIMESTAMPTZ NOT NULL
);

-- ── Seed: categories (10) ────────────────────────────────────────────────────

INSERT INTO categories (name, slug) VALUES
  ('Electronics',    'electronics'),
  ('Clothing',       'clothing'),
  ('Home & Garden',  'home-garden'),
  ('Sports',         'sports'),
  ('Books',          'books'),
  ('Toys',           'toys'),
  ('Beauty',         'beauty'),
  ('Automotive',     'automotive'),
  ('Food & Drink',   'food-drink'),
  ('Office',         'office');

-- ── Seed: products (500) ────────────────────────────────────────────────────

INSERT INTO products (category_id, name, sku, price, cost, stock_qty, is_active, created_at)
SELECT
  (gs % 10) + 1,
  'Product #' || gs,
  'SKU-' || LPAD(gs::TEXT, 6, '0'),
  ROUND((RANDOM() * 299 + 1)::NUMERIC, 2),
  ROUND((RANDOM() * 99  + 1)::NUMERIC, 2),
  (RANDOM() * 1000)::INT,
  RANDOM() > 0.05,
  NOW() - (RANDOM() * 730)::INT * INTERVAL '1 day'
FROM generate_series(1, 500) gs;

-- ── Seed: customers (100 000) ────────────────────────────────────────────────

INSERT INTO customers (email, first_name, last_name, country, plan, ltv, created_at, last_seen_at)
SELECT
  'user' || gs || '@example.com',
  (ARRAY['Alice','Bob','Carol','Dave','Eve','Frank','Grace','Hank','Ivy','Jack'])[((gs % 10) + 1)],
  (ARRAY['Smith','Jones','Williams','Brown','Taylor','Wilson','Davies','Evans','Thomas','Roberts'])[((gs / 10 % 10) + 1)],
  (ARRAY['US','UK','CA','AU','DE','FR','JP','IN','BR','MX'])[((gs % 10) + 1)],
  (ARRAY['free','free','starter','starter','pro','pro','pro','enterprise','free','starter'])[((gs % 10) + 1)],
  ROUND((RANDOM() * 4999)::NUMERIC, 2),
  NOW() - (RANDOM() * 1095)::INT * INTERVAL '1 day',
  NOW() - (RANDOM() * 30)::INT  * INTERVAL '1 day'
FROM generate_series(1, 100000) gs;

-- ── Seed: orders (1 000 000) ─────────────────────────────────────────────────

INSERT INTO orders (customer_id, status, subtotal, discount, tax, total, created_at, shipped_at, delivered_at)
SELECT
  (RANDOM() * 99999 + 1)::INT,
  (ARRAY['pending','processing','shipped','delivered','delivered','delivered','cancelled','refunded'])[((gs % 8) + 1)],
  ROUND((RANDOM() * 999 + 5)::NUMERIC,  2),
  ROUND((RANDOM() * 50)::NUMERIC,       2),
  ROUND((RANDOM() * 80 + 5)::NUMERIC,   2),
  ROUND((RANDOM() * 1080 + 10)::NUMERIC, 2),
  NOW() - (RANDOM() * 730)::INT * INTERVAL '1 day',
  CASE WHEN RANDOM() > 0.3 THEN NOW() - (RANDOM() * 720)::INT * INTERVAL '1 day' END,
  CASE WHEN RANDOM() > 0.5 THEN NOW() - (RANDOM() * 710)::INT * INTERVAL '1 day' END
FROM generate_series(1, 1000000) gs;

-- ── Seed: order_items (~3 items per order → ~3 000 000 rows) ─────────────────

INSERT INTO order_items (order_id, product_id, qty, unit_price, line_total)
SELECT
  o.id,
  (RANDOM() * 499 + 1)::INT,
  (RANDOM() * 4 + 1)::INT,
  ROUND((RANDOM() * 299 + 1)::NUMERIC, 2),
  ROUND((RANDOM() * 999 + 1)::NUMERIC, 2)
FROM orders o
CROSS JOIN generate_series(1, 3);

-- ── Seed: events (~2 000 000 rows) ───────────────────────────────────────────

INSERT INTO events (customer_id, session_id, event_type, page, product_id, occurred_at)
SELECT
  CASE WHEN RANDOM() > 0.2 THEN (RANDOM() * 99999 + 1)::INT END,
  gen_random_uuid(),
  (ARRAY['page_view','add_to_cart','remove_from_cart','checkout_start','purchase','search','login','signup'])[((gs % 8) + 1)],
  (ARRAY['/','/products','/cart','/checkout','/account','/search'])[((gs % 6) + 1)],
  CASE WHEN RANDOM() > 0.4 THEN (RANDOM() * 499 + 1)::INT END,
  NOW() - (RANDOM() * 365)::INT * INTERVAL '1 day' - (RANDOM() * 86400)::INT * INTERVAL '1 second'
FROM generate_series(1, 2000000) gs;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX ON orders      (customer_id);
CREATE INDEX ON orders      (created_at);
CREATE INDEX ON orders      (status);
CREATE INDEX ON order_items (order_id);
CREATE INDEX ON order_items (product_id);
CREATE INDEX ON events      (customer_id);
CREATE INDEX ON events      (occurred_at);
CREATE INDEX ON events      (event_type);
CREATE INDEX ON products    (category_id);

-- ── Quick row-count check ─────────────────────────────────────────────────────

SELECT
  relname AS table,
  to_char(reltuples::BIGINT, 'FM999,999,999') AS approx_rows
FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE nspname = 'public' AND relkind = 'r'
ORDER BY reltuples DESC;
