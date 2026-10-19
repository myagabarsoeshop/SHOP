-- ==============================================================================
-- MYA GABAR SOE SHOP - DATABASE SCHEMA & AUDIT LOGS
-- File: cashbook-api/schema.sql
-- ==============================================================================

-- 1. Users Table (Role & Branch Codes)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT,
  role TEXT NOT NULL DEFAULT 'staff', -- admin, finance, staff, viewer
  branch_code TEXT NOT NULL DEFAULT 'main', -- main, shop1, shop2, shop3, shop4, shop5
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Cashbook Table (Multi-branch, Subcategory & MY tracking)
CREATE TABLE IF NOT EXISTS cashbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL DEFAULT 'main',
  tx_date TEXT NOT NULL,
  my TEXT, -- Month-Year (e.g., Oct 26)
  category TEXT NOT NULL,
  sub_category TEXT,
  description TEXT,
  voucher_no TEXT,
  subtotal REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  net_total REAL DEFAULT 0,
  cash_amount REAL DEFAULT 0,
  bank_amount REAL DEFAULT 0,
  bank_name TEXT,
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  transfer_target TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Voucher Items (Multi-item tracking for sales/purchases)
CREATE TABLE IF NOT EXISTS voucher_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no TEXT NOT NULL,
  item_code TEXT NOT NULL,
  item_type TEXT DEFAULT 'garment', -- garment or yarn
  quantity REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  total_price REAL DEFAULT 0
);

-- 4. Items Master (Garments)
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT,
  sub_category TEXT,
  color_code TEXT,
  unit TEXT DEFAULT 'ထည်',
  retail_price REAL DEFAULT 0,
  wholesale_price REAL DEFAULT 0,
  remark TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Shop Inventory (Garments Stock per Branch)
CREATE TABLE IF NOT EXISTS shop_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  current_stock REAL DEFAULT 0,
  cost_price REAL DEFAULT 0,
  remark TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Yarn Items Master
CREATE TABLE IF NOT EXISTS yarn_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  yarn_type TEXT,
  color_code TEXT,
  color_name TEXT,
  unit TEXT DEFAULT 'ထုပ်',
  retail_price REAL DEFAULT 0,
  wholesale_price REAL DEFAULT 0,
  remark TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Yarn Inventory per Branch
CREATE TABLE IF NOT EXISTS yarn_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  current_stock REAL DEFAULT 0,
  cost_price REAL DEFAULT 0,
  remark TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. Audit Trail / Logs (Tracking edits, deletes, and critical actions)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  action_type TEXT NOT NULL, -- INSERT, UPDATE, DELETE, LOGIN
  target_table TEXT NOT NULL,
  record_id INTEGER,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
