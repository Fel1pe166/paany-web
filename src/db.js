import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// SQLite embutido no Node 22 (sem dependência nativa para compilar na hospedagem).
let db;

export function openDb(path = config.dbPath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate();
  return db;
}

export const getDb = () => db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  image_url TEXT,
  stock INTEGER,                         -- NULL = ilimitado
  delivery_type TEXT NOT NULL,           -- cargo | link | arquivo | texto
  delivery_content TEXT,                 -- conteúdo privado, só vai para quem pagou
  role_id TEXT,                          -- cargo liberado (VIP)
  vip_days INTEGER,                      -- NULL/0 = permanente
  rules TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  coupon_code TEXT,
  method TEXT NOT NULL,                  -- mercadopago | pix_manual | manual_admin
  status TEXT NOT NULL,
  mp_payment_id TEXT,
  pix_code TEXT,
  ticket_channel_id TEXT,
  expires_at INTEGER,
  paid_at INTEGER,
  delivered_at INTEGER,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  stock_taken INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  reviewed_by TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_mp ON orders(mp_payment_id) WHERE mp_payment_id IS NOT NULL;

-- Eventos de pagamento: a UNIQUE impede processar o mesmo evento duas vezes
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_cents INTEGER,
  actor_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_id, status)
);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- percent | fixed
  value INTEGER NOT NULL,                -- % ou centavos
  max_uses INTEGER,                      -- NULL = ilimitado
  uses INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  expires_at INTEGER,
  min_cents INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER,                    -- NULL = vale para todos
  one_per_user INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_uses (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coupon_uses ON coupon_uses(code, user_id);

CREATE TABLE IF NOT EXISTS vips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  order_id TEXT,
  expires_at INTEGER,                    -- NULL = permanente
  warned INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vips_active ON vips(active, expires_at);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT UNIQUE,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'aberto',
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  closed_by TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);
`;

function migrate() {
  db.exec(SCHEMA);
}

// Helpers curtos
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

/** Executa fn dentro de uma transação (rollback se der erro). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key, fallback = null) {
  return one('SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value == null ? null : String(value));
}

export function audit(actorId, action, details = '') {
  run('INSERT INTO audit_log(actor_id, action, details, created_at) VALUES(?, ?, ?, ?)',
    actorId ?? null, action, typeof details === 'string' ? details : JSON.stringify(details), Date.now());
}
