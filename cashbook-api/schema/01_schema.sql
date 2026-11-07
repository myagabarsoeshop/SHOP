-- =============================================================================
-- DATABASE SCHEMA: MULTI-STORE GARMENT POS, INVENTORY & CASHBOOK SYSTEM
-- Target Database: Cloudflare D1 (SQLite)
-- Version: 2.2.0 (Updated: Purchases Ref, Difference & Supplier Liabilities)
-- Architecture: Multi-Branch, Centralized Customer/Supplier Ledger, Dual-Channel Cash/Bank
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. CORE & BRANCH MANAGEMENT (ဆိုင်ခွဲများနှင့် ပင်မအိမ်ဆိုင်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,                       -- e.g., 'MAIN', 'SH1', 'SH2', 'SH3', 'SH4'
    name TEXT NOT NULL,                              -- 'Main Home Shop', 'Shop 1'
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
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL, -- NULL = Global Access (Admin / Finance)
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
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
    shop_name TEXT,                                  -- လက်ကားဆိုင် သို့မဟုတ် ပွဲရုံအမည်
    entity_type TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK(entity_type IN ('CUSTOMER', 'SUPPLIER', 'BOTH')), -- ဖောက်သည် သို့ ပွဲရုံ
    customer_type TEXT NOT NULL DEFAULT 'retail' CHECK(customer_type IN ('retail', 'wholesale')),
    credit_limit REAL NOT NULL DEFAULT 0.0,          -- အများဆုံး ခွင့်ပြုထားသည့် အကြွေးပမာဏ
    current_debt REAL NOT NULL DEFAULT 0.0,          -- ဖောက်သည်ထံမှ ရရန်ရှိငွေ (Receivables)
    current_payable REAL NOT NULL DEFAULT 0.0,       -- ပွဲရုံသို့ ပေးရန်ကျန်ငွေ / စရန်ပိုငွေ (Payables)
    address TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ဖောက်သည် အကြွေးစာရင်း (Customer Receivable Ledger)
CREATE TABLE IF NOT EXISTS customer_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    sale_id INTEGER,                                 -- Foreign Key to sales(id)
    type TEXT NOT NULL CHECK(type IN ('DEBIT', 'CREDIT')), -- DEBIT = အကြွေးယူ, CREDIT = အကြွေးဆပ်
    amount REAL NOT NULL CHECK(amount > 0),
    balance_after REAL NOT NULL,                     -- စာရင်းရှင်းပြီးနောက် ကျန်ရှိငွေ
    payment_method TEXT CHECK(payment_method IN ('cash', 'bank')),
    bank_account_name TEXT,                          -- e.g., 'KPay', 'CB Bank', 'KBZ Bank'
    reference_note TEXT,                             -- e.g., 'INV-SH1-202610-001 အကြွေးဆပ်'
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ပွဲရုံ/ကုန်ပေးသွင်းသူ အကြွေးမှတ်တမ်း (Supplier Payable Ledger)
CREATE TABLE IF NOT EXISTS supplier_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK(type IN ('PURCHASE_DEBT', 'PAYMENT', 'ADJUSTMENT')), -- PURCHASE_DEBT = အကြွေးဝယ်, PAYMENT = ပွဲရုံကြွေးဆပ်
    amount REAL NOT NULL CHECK(amount > 0),
    balance_after REAL NOT NULL,                     -- ပွဲရုံသို့ ပေးရန်ကျန်ငွေ လက်ကျန်
    payment_method TEXT CHECK(payment_method IN ('cash', 'bank')),
    bank_account_name TEXT,
    reference_note TEXT,                             -- e.g., 'VR-061126-01 အဝယ်ကြွေးကျန်'
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 4. YARN & WEAVING PRODUCTION (ချည်စတိုနှင့် ရက်ကန်း/စက်ရုံ မှတ်တမ်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yarn_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,                       -- ချည်ကုတ် (e.g., 'YN-001')
    name TEXT NOT NULL,                              -- ချည်အမျိုးအမည် (e.g., 'ချည်နီလွန်း')
    color TEXT,
    unit TEXT NOT NULL DEFAULT 'lb',                 -- ပေါင်, လိပ်, ထုပ်
    current_stock REAL NOT NULL DEFAULT 0.0,
    alert_stock REAL NOT NULL DEFAULT 0.0,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS yarn_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    yarn_id INTEGER NOT NULL REFERENCES yarn_items(id) ON DELETE RESTRICT,
    weaver_name TEXT NOT NULL,                       -- ရက်ကန်းသမား အမည်
    quantity REAL NOT NULL CHECK(quantity > 0),
    issue_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    notes TEXT,                                      -- ရက်ကန်းစင်အမှတ် သို့မဟုတ် အထည်အဆင်
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 5. GARMENT PRODUCTS & INVENTORY (အထည်အချောနှင့် ဆိုင်ခွဲလက်ကျန်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE,                                 -- အထည်ကုတ် (ဥပမာ - PS-KC-001)
    barcode TEXT UNIQUE,                             -- Barcode / QR
    category TEXT NOT NULL,                          -- အမျိုးအစား (ပုဆိုး၊ လုံချည်၊ အင်္ကျီ)
    item_name TEXT NOT NULL,                         -- ပစ္စည်းအမည် (ကချင်၊ မန္တလေးချည်ဖောက်)
    pattern TEXT,                                    -- အဆင်/ဒီဇိုင်း (အကွက်စိပ်၊ ပန်းဖောက်)
    size TEXT NOT NULL DEFAULT 'Free Size',          -- S, M, L, XL, Free Size
    color TEXT,                                      -- နက်ပြာ၊ အနီ၊ စိမ်း
    product_type TEXT NOT NULL DEFAULT 'manufactured' CHECK(product_type IN ('manufactured', 'trading')),
    cost_price REAL NOT NULL DEFAULT 0.0,            -- အရင်းဈေး
    retail_price REAL NOT NULL DEFAULT 0.0,          -- လက်လီရောင်းဈေး
    wholesale_price REAL NOT NULL DEFAULT 0.0,       -- လက်ကားရောင်းဈေး
    alert_quantity INTEGER NOT NULL DEFAULT 5,       -- အနည်းဆုံး ကျန်ရှိသင့်သော အရေအတွက်
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branch_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_product UNIQUE (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_no TEXT NOT NULL UNIQUE,                -- e.g., 'TR-20261029-001'
    from_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    to_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'dispatched', 'received', 'cancelled')),
    dispatched_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    dispatched_at DATETIME,
    received_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    received_at DATETIME,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(quantity > 0)
);

-- -----------------------------------------------------------------------------
-- 6. PURCHASES (Ref No, Items Total, Paid & Difference ပါဝင်သော အဝယ်မှတ်တမ်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_no TEXT NOT NULL UNIQUE,                -- e.g., '061126-01' (VR NO)
    ref_no TEXT,                                     -- ပြင်ပဆိုင်ဘောင်ချာနံပါတ် (ဥပမာ - INV-9021)
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    supplier_name TEXT NOT NULL,
    items_total REAL NOT NULL DEFAULT 0.0 CHECK(items_total >= 0),   -- ပစ္စည်းများ ပေါင်းလဒ်အစစ်
    total_amount REAL NOT NULL CHECK(total_amount >= 0),             -- စုစုပေါင်း ကုန်ကျငွေ
    paid_amount REAL NOT NULL DEFAULT 0.0 CHECK(paid_amount >= 0),   -- အမှန်တကယ် ပေးခဲ့ငွေ
    diff_amount REAL NOT NULL DEFAULT 0.0,                           -- ပိုငွေ (+), လိုငွေ/အကြွေး (-)
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank', 'credit')),
    bank_account_name TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    subtotal REAL NOT NULL CHECK(subtotal >= 0)
);

-- -----------------------------------------------------------------------------
-- 7. SALES & POS VOUCHERS (အရောင်းဘောင်ချာစနစ်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL UNIQUE,                 -- e.g., 'INV-SH1-20261029-001'
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    sale_type TEXT NOT NULL DEFAULT 'retail' CHECK(sale_type IN ('retail', 'wholesale')),
    total_amount REAL NOT NULL CHECK(total_amount >= 0),
    discount_amount REAL NOT NULL DEFAULT 0.0 CHECK(discount_amount >= 0),
    final_amount REAL NOT NULL CHECK(final_amount >= 0),
    paid_amount REAL NOT NULL DEFAULT 0.0 CHECK(paid_amount >= 0),
    debt_amount REAL NOT NULL DEFAULT 0.0 CHECK(debt_amount >= 0),
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank', 'credit', 'split')),
    cash_amount REAL NOT NULL DEFAULT 0.0,
    bank_amount REAL NOT NULL DEFAULT 0.0,
    bank_account_name TEXT,                          -- e.g., 'KPay', 'Wave', 'KBZ'
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price REAL NOT NULL CHECK(unit_price >= 0), -- အရောင်းဖြစ်ပွားချိန် ရောင်းဈေး
    cost_price REAL NOT NULL CHECK(cost_price >= 0), -- အရောင်းဖြစ်ပွားချိန် အရင်းဈေး (အမြတ်တွက်ရန်)
    subtotal REAL NOT NULL CHECK(subtotal >= 0)
);

-- -----------------------------------------------------------------------------
-- 8. MULTI-STORE CASHBOOK (Ref No, Diff Amount ပါဝင်သော နေ့စဉ်ငွေစာရင်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,                       -- အထည်အရောင်း၊ ရက်ကန်းခ၊ ဆိုင်လခ
    type TEXT NOT NULL CHECK(type IN ('INCOME', 'EXPENSE')),
    is_system INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0, 1)),
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
    bank_account_name TEXT,                          -- 'KPay', 'KBZ Pay', 'CB Bank'
    amount REAL NOT NULL CHECK(amount > 0),          -- အမှန်ထွက်သွားသည့် Paid Amount
    diff_amount REAL NOT NULL DEFAULT 0.0,           -- Surplus (+) သို့မဟုတ် Deficit (-)
    ref_no TEXT,                                     -- Voucher / Invoice No (Ref)
    description TEXT,                                -- ဆိုင်အမည် / အကြောင်းအရာ အတိုချုပ်
    entry_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 9. DAILY CASHBOOK CLOSING & AUDIT (နေ့ချုပ် ငွေစစ်ဆေးမှုမှတ်တမ်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    closing_date DATE NOT NULL,
    opening_cash REAL NOT NULL DEFAULT 0.0,
    opening_bank REAL NOT NULL DEFAULT 0.0,
    total_cash_in REAL NOT NULL DEFAULT 0.0,
    total_cash_out REAL NOT NULL DEFAULT 0.0,
    closing_cash REAL NOT NULL DEFAULT 0.0,
    total_bank_in REAL NOT NULL DEFAULT 0.0,
    total_bank_out REAL NOT NULL DEFAULT 0.0,
    closing_bank REAL NOT NULL DEFAULT 0.0,
    actual_cash_counted REAL NOT NULL DEFAULT 0.0,
    cash_difference REAL NOT NULL DEFAULT 0.0,
    closed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_closing_date UNIQUE (branch_id, closing_date)
);

-- -----------------------------------------------------------------------------
-- 10. WASTE & DAMAGE LOGS (အလေအလွင့်နှင့် ပျက်စီးဆုံးရှုံးမှု မှတ်တမ်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waste_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_no TEXT NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    reason TEXT NOT NULL,
    recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 11. PERFORMANCE INDEXES (အမြန်နှုန်းမြှင့်တင်ရေး Index များ)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_item_name ON products(item_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_branch_inventory_lookup ON branch_inventory(branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON sales(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_date ON purchases(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_no ON purchases(purchase_no);
CREATE INDEX IF NOT EXISTS idx_purchases_ref_no ON purchases(ref_no);
CREATE INDEX IF NOT EXISTS idx_cashbook_branch_date ON cashbook_entries(branch_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_cashbook_ref_no ON cashbook_entries(ref_no);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger(supplier_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_waste_logs_branch_date ON waste_logs(branch_id, created_at);

-- -----------------------------------------------------------------------------
-- 12. INITIAL SEED DATA
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO branches (id, code, name, type, phone, address) VALUES 
(1, 'MAIN', 'Main Home Shop (အိမ်ဆိုင်/စက်ရုံ)', 'main_hub', '09111111111', 'မန္တလေး'),
(2, 'SH1', 'Shop 1 (ဆိုင်ခွဲ ၁)', 'branch', '09222222222', 'မန္တလေး'),
(3, 'SH2', 'Shop 2 (ဆိုင်ခွဲ ၂)', 'branch', '09333333333', 'မန္တလေး'),
(4, 'SH3', 'Shop 3 (ဆိုင်ခွဲ ၃)', 'branch', '09444444444', 'မန္တလေး'),
(5, 'SH4', 'Shop 4 (ဆိုင်ခွဲ ၄)', 'branch', '09555555555', 'မန္တလေး');

INSERT OR IGNORE INTO cash_categories (id, name, type, is_system) VALUES 
(1, 'အထည်ရောင်းရငွေ (POS Sales)', 'INCOME', 1),
(2, 'အကြွေးဟောင်းရငွေ (Debt Collection)', 'INCOME', 1),
(3, 'အခြားရငွေ (Other Income)', 'INCOME', 0),
(4, 'ရက်ကန်းလုပ်ခ (Weaving Wages)', 'EXPENSE', 0),
(5, 'ကုန်ကြမ်း/ချည်ဝယ်ယူစရိတ် (Raw Material Purchase)', 'EXPENSE', 0),
(6, 'ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ် (Trading Goods Purchase)', 'EXPENSE', 1),
(7, 'ဆိုင်စရိတ်/စားစရိတ် (Daily Shop Expenses)', 'EXPENSE', 0),
(8, 'ဆိုင်လခ/အိမ်လခ (Shop Rent)', 'EXPENSE', 0),
(9, 'လျှပ်စစ်မီးဖိုးနှင့် အထွေထွေစရိတ် (Utilities)', 'EXPENSE', 0),
(10, 'ပင်မဆိုင်သို့ ငွေလွှဲပေးပို့ခြင်း (Cash Transfer to Main)', 'EXPENSE', 0);

INSERT OR IGNORE INTO users (id, branch_id, username, password_hash, full_name, role) VALUES 
(1, NULL, 'admin', 'admin123_hash', 'စနစ်ပိုင်ရှင် (Admin)', 'admin'),
(2, NULL, 'finance', 'finance123_hash', 'စာရင်းကိုင်/စာရင်းစစ် (Finance)', 'finance'),
(3, 1, 'cashier_main', 'cashier_hash', 'Home Shop Cashier', 'cashier'),
(4, 2, 'cashier_sh1', 'cashier_hash', 'Shop 1 Cashier', 'cashier'),
(5, 3, 'cashier_sh2', 'cashier_hash', 'Shop 2 Cashier', 'cashier'),
(6, 4, 'cashier_sh3', 'cashier_hash', 'Shop 3 Cashier', 'cashier'),
(7, 5, 'cashier_sh4', 'cashier_hash', 'Shop 4 Cashier', 'cashier');
