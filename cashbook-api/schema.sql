-- ==============================================================================
-- GOLDEN ERP SYSTEM - CLOUDFLARE D1 DATABASE MASTER PRODUCTION SCHEMA
-- File: schema.sql (Location: cashbook-api/schema.sql)
-- 💡 Features: 20 Complete Relational Tables, High-Performance Composite Indexes,
--              PBKDF2 Password Security & Canonical Grade Matrix Initial Seeds
--              🎯 Phase 3: Added Foreign Keys (ON DELETE SET NULL) to preserve Accounting Integrity
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. USERS & AUTHENTICATION (PBKDF2 Secured)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer',
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------------------------
-- 1B. LOGIN ATTEMPTS (Server-Side Brute-Force / Rate-Limiting)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY,
  fail_count INTEGER DEFAULT 0,
  locked_until TEXT,
  last_attempt_at TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------------------------
-- 1C. AUDIT LOGS (Who Did What, When — Required for Financial Systems)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  record_id TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- ------------------------------------------------------------------------------
-- 2. MAIN FINANCIAL & EXPENSE BOOKS (5 Core Ledgers)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Bank',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Main Bank Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Main Cash Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS office (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  description TEXT,
  unit REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  liabilities REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Office Exp Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kitchen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Kitchen Exp Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'Full Time Salary',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  unpaid_bonus REAL DEFAULT 0,
  unpaid_fund REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'HR Payroll Exp Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

-- ------------------------------------------------------------------------------
-- 3. STUDENT DIRECTORY (Master Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  stu_status TEXT DEFAULT 'New Student',
  date TEXT NOT NULL,
  fy TEXT DEFAULT '2026-2027',
  student_id INTEGER,
  fyid TEXT,
  name TEXT NOT NULL,
  fyid_name TEXT,
  class TEXT,
  category TEXT DEFAULT 'Boarder',
  promo TEXT DEFAULT 'Original price',
  transfer_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  gender TEXT DEFAULT 'Male',
  parents_name TEXT,
  phone_no TEXT,
  address TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);

-- ------------------------------------------------------------------------------
-- 4. MAIN INCOME BOOK & STUDENT MONEY LEDGER (With Foreign Keys)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  effect_date TEXT,
  date TEXT NOT NULL,
  fy TEXT DEFAULT 'FY 2026-2027',
  student_id INTEGER,
  fyid TEXT,
  fyid_name TEXT,
  class TEXT,
  category TEXT DEFAULT 'Boarder',
  account_name TEXT DEFAULT 'Registration',
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  aut_amount REAL DEFAULT 0,
  promo TEXT DEFAULT 'Original price',
  my TEXT,
  vr_no TEXT,
  remark TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0,
  FOREIGN KEY (student_id) REFERENCES student(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS student_money (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  fy TEXT DEFAULT '2026-2027',
  student_id INTEGER,
  fyid TEXT,
  fyid_name TEXT,
  class TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  remark TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  FOREIGN KEY (student_id) REFERENCES student(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------------------
-- 5. UNIFORM INVENTORY & PROMOTION RATE MATRIX
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uniform_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  product_id TEXT,
  product_name TEXT NOT NULL,
  type TEXT,
  size TEXT,
  opening_stock REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  total_amount REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  profit_amount REAL DEFAULT 0,
  selling_unit REAL DEFAULT 0,
  current_qty REAL DEFAULT 0,
  total_stock_value REAL DEFAULT 0,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS promotion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  fy TEXT DEFAULT '2026-2027',
  class TEXT,
  category TEXT,
  registration REAL DEFAULT 0,
  original_price REAL DEFAULT 0,
  pro_a REAL DEFAULT 0,
  pro_b REAL DEFAULT 0,
  pro_c REAL DEFAULT 0,
  pro_d REAL DEFAULT 0,
  pro_e REAL DEFAULT 0,
  half_scholar REAL DEFAULT 0,
  full_scholar REAL DEFAULT 0,
  remark TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);

-- ------------------------------------------------------------------------------
-- 6. STAFF DIRECTORY & SALARY GRADE MATRIX
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_fulltime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  join_date TEXT NOT NULL,
  category TEXT DEFAULT 'Full Time',
  staff_id INTEGER,
  name TEXT NOT NULL,
  staff_idname TEXT,
  education TEXT,
  position TEXT,
  salary_grade TEXT DEFAULT 'Non',
  working_days REAL DEFAULT 26,
  basic_amt REAL DEFAULT 0,
  extra_amt REAL DEFAULT 0,
  total_salary REAL DEFAULT 0,
  bonus REAL DEFAULT 0,
  fund REAL DEFAULT 0,
  total_net_amt REAL DEFAULT 0,
  resigned_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  gender TEXT DEFAULT 'Male',
  nrc_no TEXT,
  bank_account TEXT,
  phone_no TEXT,
  email TEXT,
  fund_date TEXT,
  unpaid_bonus REAL DEFAULT 0,
  unpaid_fund REAL DEFAULT 0,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS staff_parttime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  join_date TEXT NOT NULL,
  category TEXT DEFAULT 'Part Time',
  staff_id INTEGER,
  name TEXT NOT NULL,
  staff_idname TEXT,
  education TEXT,
  position TEXT,
  total_salary REAL DEFAULT 0,
  total_net_amt REAL DEFAULT 0,
  resigned_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  gender TEXT DEFAULT 'Male',
  nrc_no TEXT,
  bank_account TEXT,
  phone_no TEXT,
  email TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS salary_grade_matrix (
  id INTEGER PRIMARY KEY,
  grade_a REAL DEFAULT 0,
  grade_b REAL DEFAULT 0,
  grade_c REAL DEFAULT 0,
  grade_d REAL DEFAULT 0,
  grade_e REAL DEFAULT 0,
  grade_f REAL DEFAULT 0,
  grade_g REAL DEFAULT 0,
  grade_h REAL DEFAULT 0,
  grade_i REAL DEFAULT 0,
  grade_j REAL DEFAULT 0,
  grade_k REAL DEFAULT 0,
  grade_l REAL DEFAULT 0,
  bonus_rate REAL DEFAULT 0,
  fund_rate REAL DEFAULT 0.05,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------------------------
-- 7. CASHIER SUB-LEDGERS (5 Sub-Books - 17 Cols with responsibility_person)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ca_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Bank',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Bank Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ca_cash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Cash Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ca_office (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Office Exp',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Office Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ca_kitchen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Kitchen Exp',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Kitchen Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ca_payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Payroll Exp',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Payroll Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);

-- ------------------------------------------------------------------------------
-- 8. HIGH-PERFORMANCE COMPOSITE INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bank_fy_date ON bank(fy, date);
CREATE INDEX IF NOT EXISTS idx_cash_fy_date ON cash(fy, date);
CREATE INDEX IF NOT EXISTS idx_office_fy_date ON office(fy, date);
CREATE INDEX IF NOT EXISTS idx_kitchen_fy_date ON kitchen(fy, date);
CREATE INDEX IF NOT EXISTS idx_payroll_fy_date ON payroll(fy, date);
CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
CREATE INDEX IF NOT EXISTS idx_income_fy_date ON income(fy, date);
CREATE INDEX IF NOT EXISTS idx_income_student_id ON income(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fy_status ON student(fy, status);
CREATE INDEX IF NOT EXISTS idx_student_student_id ON student(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fyid ON student(fyid);
CREATE INDEX IF NOT EXISTS idx_student_money_fy_date ON student_money(fy, date);
CREATE INDEX IF NOT EXISTS idx_student_money_student_id ON student_money(student_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_ft_staff_id ON staff_fulltime(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_pt_staff_id ON staff_parttime(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_ft_status ON staff_fulltime(status);
CREATE INDEX IF NOT EXISTS idx_uniform_product_id ON uniform_ledger(product_id);
CREATE INDEX IF NOT EXISTS idx_promotion_fy_class_cat ON promotion(fy, class, category);
CREATE INDEX IF NOT EXISTS idx_ca_bank_fy_date ON ca_bank(fy, date);
CREATE INDEX IF NOT EXISTS idx_ca_cash_fy_date ON ca_cash(fy, date);
CREATE INDEX IF NOT EXISTS idx_ca_office_fy_date ON ca_office(fy, date);
CREATE INDEX IF NOT EXISTS idx_ca_kitchen_fy_date ON ca_kitchen(fy, date);
CREATE INDEX IF NOT EXISTS idx_ca_payroll_fy_date ON ca_payroll(fy, date);

-- ------------------------------------------------------------------------------
-- 9. CANONICAL INITIAL SEED DATA
-- ------------------------------------------------------------------------------
INSERT OR IGNORE INTO salary_grade_matrix (id, grade_a, grade_b, grade_c, grade_d, grade_e, grade_f, grade_g, grade_h, grade_i, grade_j, grade_k, grade_l, bonus_rate, fund_rate, updated_at)
VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, datetime('now'));
