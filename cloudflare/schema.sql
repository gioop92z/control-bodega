-- VANTIS Equipo · Cloudflare D1 (SQLite).
-- Datos de inventario; no publicar la base como archivo en GitHub Pages.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS people (
  employee TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','scanner','viewer')),
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  employee TEXT PRIMARY KEY,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS labels (
  code TEXT PRIMARY KEY,
  dept TEXT NOT NULL DEFAULT 'ZAPATERIA INFANTIL',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS products (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
  active INTEGER NOT NULL DEFAULT 1,
  dept TEXT NOT NULL DEFAULT 'ZAPATERIA INFANTIL',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS assignments (
  sku TEXT NOT NULL REFERENCES products(code),
  label TEXT NOT NULL REFERENCES labels(code),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
  PRIMARY KEY(sku,label)
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  employee TEXT NOT NULL,
  operator_label TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES products(code),
  label TEXT NOT NULL REFERENCES labels(code),
  kind TEXT NOT NULL CHECK(kind IN ('receive','undo')),
  reversal_of TEXT UNIQUE REFERENCES receipts(id),
  signature TEXT NOT NULL,
  stock_after INTEGER,
  location_after INTEGER,
  stored_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_assignments_label ON assignments(label);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(stored_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_employee ON receipts(employee,stored_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_sku ON receipts(sku,stored_at DESC);
