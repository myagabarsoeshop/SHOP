-- =============================================================================
-- DATABASE SCHEMA: MULTI-STORE GARMENT POS, INVENTORY & CASHBOOK SYSTEM
-- Target Database: Cloudflare D1 (SQLite)
-- Version: 3.2.0 (Enterprise Security Hardened, PBKDF2-SHA256, Soft-Delete & Audit)
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. CORE & BRANCH MANAGEMENT (ဆိုင်ခွဲများနှင့် ပင်မအိမ်ဆိုင်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('main_hub', 'branch', 'warehouse')),
    phone TEXT,
    address TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 2. USER AUTHENTICATION & ACCESS CONTROL (အသုံးပြုသူ ဝန်ထမ်းများ)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    plain_password TEXT DEFAULT NULL,
    token_version INTEGER NOT NULL DEFAULT 1,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'finance', 'manager', 'cashier')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 3. CUSTOMERS, SUPPLIERS & DEBT/LIABILITIES LEDGER (ဖောက်သည်နှင့် ပွဲရုံကြွေးမြီ)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    shop_name TEXT,
    entity_type TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK(entity_type IN ('CUSTOMER', 'SUPPLIER', 'BOTH')),
    customer_type TEXT NOT NULL DEFAULT 'retail' CHECK(customer_type IN ('retail', 'wholesale')),
    credit_limit INTEGER NOT NULL DEFAULT 0,
    current_debt INTEGER NOT NULL DEFAULT 0,
    current_payable INTEGER NOT NULL DEFAULT 0,
    address TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ဖောက်သည် အကြွေးစာရင်း (Customer Receivable Ledger)
CREATE TABLE IF NOT EXISTS customer_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    sale_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('DEBIT', 'CREDIT')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    balance_after INTEGER NOT NULL,
    payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'credit', 'split', 'opening')),
    bank_account_name TEXT,
    reference_note TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ပွဲရုံ/ကုန်ပေးသွင်းသူ အကြွေးမှတ်တမ်း (Supplier Payable Ledger)
CREATE TABLE IF NOT EXISTS supplier_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    purchase_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('PURCHASE_DEBT', 'PAYMENT', 'ADJUSTMENT')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    balance_after INTEGER NOT NULL,
    payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'credit', 'split', 'opening')),
    bank_account_name TEXT,
    reference_note TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 4. YARN & WEAVING PRODUCTION (ချည်စတိုနှင့် ရက်ကန်း/စက်ရုံ မှတ်တမ်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yarn_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    color TEXT,
    unit TEXT NOT NULL DEFAULT 'lb',
    current_stock REAL NOT NULL DEFAULT 0.0,
    alert_stock REAL NOT NULL DEFAULT 0.0,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS yarn_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    yarn_id INTEGER NOT NULL,
    product_id INTEGER,
    weaver_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0),
    issue_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 5. GARMENT PRODUCTS & INVENTORY (အထည်အချောနှင့် ဆိုင်ခွဲလက်ကျန်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE,
    barcode TEXT UNIQUE,
    category TEXT NOT NULL,
    item_name TEXT NOT NULL,
    pattern TEXT,
    size TEXT NOT NULL DEFAULT 'ထည်',
    color TEXT,
    product_type TEXT NOT NULL DEFAULT 'manufactured' CHECK(product_type IN ('manufactured', 'trading')),
    cost_price INTEGER NOT NULL DEFAULT 0,
    retail_price INTEGER NOT NULL DEFAULT 0,
    wholesale_price INTEGER NOT NULL DEFAULT 0,
    alert_quantity INTEGER NOT NULL DEFAULT 5,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branch_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_product UNIQUE (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_no TEXT NOT NULL UNIQUE,
    from_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    to_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('pending', 'dispatched', 'received', 'completed', 'cancelled')),
    dispatched_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    dispatched_at DATETIME,
    received_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    received_at DATETIME,
    created_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK(quantity > 0)
);

-- -----------------------------------------------------------------------------
-- 6. PURCHASES (Ref No, Items Total, Paid & Difference ပါဝင်သော အဝယ်မှတ်တမ်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_no TEXT NOT NULL UNIQUE,
    ref_no TEXT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    supplier_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    purchase_date DATE,
    items_total INTEGER NOT NULL DEFAULT 0 CHECK(items_total >= 0),
    total_amount INTEGER NOT NULL CHECK(total_amount >= 0),
    paid_amount INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
    diff_amount INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank', 'credit')),
    bank_account_name TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    cancelled_by INTEGER,
    cancelled_at DATETIME,
    cancel_reason TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_cost INTEGER NOT NULL CHECK(unit_cost >= 0),
    subtotal INTEGER NOT NULL CHECK(subtotal >= 0)
);

-- -----------------------------------------------------------------------------
-- 7. SALES & POS VOUCHERS (အရောင်းဘောင်ချာစနစ်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    sale_type TEXT NOT NULL DEFAULT 'retail' CHECK(sale_type IN ('retail', 'wholesale')),
    total_amount INTEGER NOT NULL CHECK(total_amount >= 0),
    discount_amount INTEGER NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
    final_amount INTEGER NOT NULL CHECK(final_amount >= 0),
    paid_amount INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
    debt_amount INTEGER NOT NULL DEFAULT 0 CHECK(debt_amount >= 0),
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank', 'credit', 'split')),
    cash_amount INTEGER NOT NULL DEFAULT 0,
    bank_amount INTEGER NOT NULL DEFAULT 0,
    bank_account_name TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    cancelled_by INTEGER,
    cancelled_at DATETIME,
    cancel_reason TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
    cost_price INTEGER NOT NULL CHECK(cost_price >= 0),
    subtotal INTEGER NOT NULL CHECK(subtotal >= 0)
);

-- -----------------------------------------------------------------------------
-- 8. MULTI-STORE CASHBOOK (နေ့စဉ်ငွေစာရင်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('INCOME', 'EXPENSE')),
    is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0, 1)),
    is_remittance INTEGER NOT NULL DEFAULT 0 CHECK(is_remittance IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS cashbook_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    category_id INTEGER NOT NULL REFERENCES cash_categories(id) ON DELETE RESTRICT,
    sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    customer_ledger_id INTEGER REFERENCES customer_ledger(id) ON DELETE SET NULL,
    supplier_ledger_id INTEGER REFERENCES supplier_ledger(id) ON DELETE SET NULL,
    entry_type TEXT NOT NULL CHECK(entry_type IN ('INCOME', 'EXPENSE')),
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank')),
    bank_account_name TEXT,
    amount INTEGER NOT NULL CHECK(amount > 0),
    diff_amount INTEGER NOT NULL DEFAULT 0,
    ref_no TEXT,
    description TEXT,
    entry_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 9. DAILY CASHBOOK CLOSING, AUDIT TRAIL & LOGIN RATE LIMITING
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    closing_date DATE NOT NULL,
    opening_cash INTEGER NOT NULL DEFAULT 0,
    opening_bank INTEGER NOT NULL DEFAULT 0,
    total_cash_in INTEGER NOT NULL DEFAULT 0,
    total_cash_out INTEGER NOT NULL DEFAULT 0,
    closing_cash INTEGER NOT NULL DEFAULT 0,
    total_bank_in INTEGER NOT NULL DEFAULT 0,
    total_bank_out INTEGER NOT NULL DEFAULT 0,
    closing_bank INTEGER NOT NULL DEFAULT 0,
    actual_cash_counted INTEGER NOT NULL DEFAULT 0,
    cash_difference INTEGER NOT NULL DEFAULT 0,
    closed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_closing_date UNIQUE (branch_id, closing_date)
);

CREATE TABLE IF NOT EXISTS waste_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_no TEXT NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_cost INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER,
    user_id INTEGER,
    action TEXT NOT NULL,
    table_name TEXT,
    record_id TEXT,
    details TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 1,
    first_attempt_ms INTEGER NOT NULL
);

-- -----------------------------------------------------------------------------
-- 10. PERFORMANCE INDEXES (D1 B-Tree Composite Indexes)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_item_name ON products(item_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_branch_inventory_lookup ON branch_inventory(branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON sales(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_created ON purchases(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_no ON purchases(purchase_no);
CREATE INDEX IF NOT EXISTS idx_purchases_ref_no ON purchases(ref_no);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id, purchase_id);
CREATE INDEX IF NOT EXISTS idx_cashbook_branch_date ON cashbook_entries(branch_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_cashbook_ref_no ON cashbook_entries(ref_no);
CREATE INDEX IF NOT EXISTS idx_cashbook_sale_id ON cashbook_entries(sale_id);
CREATE INDEX IF NOT EXISTS idx_cashbook_purchase_id ON cashbook_entries(purchase_id);
CREATE INDEX IF NOT EXISTS idx_cashbook_supp_ledger ON cashbook_entries(supplier_ledger_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_cust_ledger_cust_id ON customer_ledger(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_supp_ledger_supp_id ON supplier_ledger(supplier_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_from_created ON stock_transfers(from_branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_to_created ON stock_transfers(to_branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_waste_branch_created ON waste_logs(branch_id, created_at);

-- -----------------------------------------------------------------------------
-- 11. INITIAL SEED DATA (PBKDF2-HMAC-SHA256 Pre-hashed Accounts)
-- Default Passwords:
--   admin        -> admin123
--   finance      -> finance123
--   cashier_*    -> cashier123
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO branches (id, code, name, type, phone, address) VALUES 
(1, 'MAIN', 'Main Home Shop (အိမ်ဆိုင်/စက်ရုံ)', 'main_hub', '09111111111', 'မန္တလေး'),
(2, 'SH1', 'Shop 1 (ဆိုင်ခွဲ ၁)', 'branch', '09222222222', 'မန္တလေး'),
(3, 'SH2', 'Shop 2 (ဆိုင်ခွဲ ၂)', 'branch', '09333333333', 'မန္တလေး'),
(4, 'SH3', 'Shop 3 (ဆိုင်ခွဲ ၃)', 'branch', '09444444444', 'မန္တလေး'),
(5, 'SH4', 'Shop 4 (ဆိုင်ခွဲ ၄)', 'branch', '09555555555', 'မန္တလေး');

INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_remittance) VALUES 
(1, 'အထည်ရောင်းရငွေ (POS Sales)', 'INCOME', 1, 0),
(2, 'အကြွေးဟောင်းရငွေ (Debt Collection)', 'INCOME', 1, 0),
(3, 'အခြားရငွေ (Other Income)', 'INCOME', 0, 0),
(4, 'ရက်ကန်းလုပ်ခ (Weaving Wages)', 'EXPENSE', 0, 0),
(5, 'ကုန်ကြမ်း/ချည်ဝယ်ယူစရိတ် (Raw Material Purchase)', 'EXPENSE', 0, 0),
(6, 'ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ် (Trading Goods Purchase)', 'EXPENSE', 1, 0),
(7, 'ဆိုင်စရိတ်/စားစရိတ် (Daily Shop Expenses)', 'EXPENSE', 0, 0),
(8, 'ဆိုင်လခ/အိမ်လခ (Shop Rent)', 'EXPENSE', 0, 0),
(9, 'လျှပ်စစ်မီးဖိုးနှင့် အထွေထွေစရိတ် (Utilities)', 'EXPENSE', 0, 0),
(10, 'ပင်မဆိုင်သို့ ငွေလွှဲပေးပို့ခြင်း (Cash Transfer to Main)', 'EXPENSE', 1, 1),
(11, 'ပွဲရုံအကြွေးဆပ်ငွေ (Supplier Debt Payment)', 'EXPENSE', 1, 0);

INSERT OR IGNORE INTO users (id, branch_id, username, password_hash, full_name, role, token_version) VALUES 
(1, NULL, 'admin', 'pbkdf2:a1b2c3d4e5f60718293a4b5c6d7e8f90:57f0dc896d6b5bc2f9bd025c86aa7a95df3ec95a3ff8d311eb00f36b13c6b984', 'စနစ်ပိုင်ရှင် (Admin)', 'admin', 1),
(2, NULL, 'finance', 'pbkdf2:b2c3d4e5f60718293a4b5c6d7e8f90a1:54df539535494a15bc8ebdf653197f4c9a120a5d3a7dbbd91bdbe048776e1791', 'စာရင်းကိုင်/စာရင်းစစ် (Finance)', 'finance', 1),
(3, 1, 'cashier_main', 'pbkdf2:c3d4e5f60718293a4b5c6d7e8f90a1b2:1dc794e86a4fb515a83e63726ae86bf6bb6908d47b4704ca97f9f5209bb633a7', 'Home Shop Cashier', 'cashier', 1),
(4, 2, 'cashier_sh1', 'pbkdf2:c3d4e5f60718293a4b5c6d7e8f90a1b2:1dc794e86a4fb515a83e63726ae86bf6bb6908d47b4704ca97f9f5209bb633a7', 'Shop 1 Cashier', 'cashier', 1),
(5, 3, 'cashier_sh2', 'pbkdf2:c3d4e5f60718293a4b5c6d7e8f90a1b2:1dc794e86a4fb515a83e63726ae86bf6bb6908d47b4704ca97f9f5209bb633a7', 'Shop 2 Cashier', 'cashier', 1),
(6, 4, 'cashier_sh3', 'pbkdf2:c3d4e5f60718293a4b5c6d7e8f90a1b2:1dc794e86a4fb515a83e63726ae86bf6bb6908d47b4704ca97f9f5209bb633a7', 'Shop 3 Cashier', 'cashier', 1),
(7, 5, 'cashier_sh4', 'pbkdf2:c3d4e5f60718293a4b5c6d7e8f90a1b2:1dc794e86a4fb515a83e63726ae86bf6bb6908d47b4704ca97f9f5209bb633a7', 'Shop 4 Cashier', 'cashier', 1);
