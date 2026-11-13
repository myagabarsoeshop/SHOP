-- =============================================================================
-- DATABASE SCHEMA: MULTI-STORE GARMENT POS, INVENTORY & CASHBOOK SYSTEM
-- Target Database: Cloudflare D1 (SQLite)
-- Version: 4.1.0 (Ledger-Backed Stock Movements, RBAC & Race-Condition Proof)
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 0. SCHEMA MIGRATIONS TRACKER & INVOICE SEQUENCE GENERATOR
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    prefix TEXT NOT NULL,
    date_key TEXT NOT NULL,
    last_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_seq >= 0),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (branch_id, prefix, date_key)
);

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
-- [FIXED] plain_password ဖယ်ရှားပြီး manager အစား branch_manager သုံးထားသည်
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 1,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'finance', 'branch_manager', 'cashier')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_branch_required_for_staff CHECK (
        role IN ('admin', 'finance') OR branch_id IS NOT NULL
    )
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
    credit_limit INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit >= 0),
    current_debt INTEGER NOT NULL DEFAULT 0 CHECK(current_debt >= 0),
    current_payable INTEGER NOT NULL DEFAULT 0 CHECK(current_payable >= 0),
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
    balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
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
    balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
    payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'credit', 'split', 'opening')),
    bank_account_name TEXT,
    reference_note TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 4. GARMENT PRODUCTS & INVENTORY (အထည်အချော၊ ချည် နှင့် ဆိုင်ခွဲလက်ကျန်)
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
    cost_price INTEGER NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
    retail_price INTEGER NOT NULL DEFAULT 0 CHECK(retail_price >= 0),
    wholesale_price INTEGER NOT NULL DEFAULT 0 CHECK(wholesale_price >= 0),
    alert_quantity INTEGER NOT NULL DEFAULT 5 CHECK(alert_quantity >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ဆိုင်ခွဲအလိုက် လက်ကျန် Cache ဇယား (stock_movements နှင့် အမြဲ တစ်ပြိုင်နက် update လုပ်ရမည်)
CREATE TABLE IF NOT EXISTS branch_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_product UNIQUE (branch_id, product_id)
);

-- -----------------------------------------------------------------------------
-- 5. STOCK MOVEMENTS LEDGER (SOURCE OF TRUTH - APPEND ONLY)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'OPENING',
        'PURCHASE_IN',
        'PURCHASE_VOID_OUT',
        'SALE_OUT',
        'SALE_VOID_IN',
        'TRANSFER_OUT',
        'TRANSFER_IN',
        'WASTE_OUT',
        'YARN_ISSUE_OUT',
        'YARN_RETURN_IN',
        'ADJUSTMENT_IN',
        'ADJUSTMENT_OUT'
    )),
    quantity REAL NOT NULL CHECK(quantity != 0), -- ဝင်ရင် (+), ထွက်ရင် (-)
    effective_date DATE NOT NULL,               -- မြန်မာရက်စွဲ (YYYY-MM-DD)
    source_table TEXT,                          -- 'purchases', 'sales', 'stock_transfers', 'opening_stock_counts', 'stock_adjustments', 'waste_logs', 'yarn_issues'
    source_id INTEGER,
    reason TEXT,                                -- Adjustment နှင့် Reversal များတွင် မဖြစ်မနေပါရမည်
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 6. OPENING STOCK WORKFLOW (ဆိုင်ခွဲအလိုက် ကနဦးစတော့ အတည်ပြုချက်စနစ်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opening_stock_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    as_of_date DATE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    submitted_at DATETIME,
    decided_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    decided_at DATETIME,
    reject_reason TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opening_stock_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_id INTEGER NOT NULL REFERENCES opening_stock_counts(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK (quantity >= 0),
    UNIQUE (count_id, product_id)
);

-- ဆိုင်ခွဲတစ်ခုလျှင် approved ဖြစ်ပြီးသား Opening Stock တစ်ကြိမ်သာ ရှိနိုင်ရမည်
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_approved_opening 
ON opening_stock_counts(branch_id) 
WHERE status = 'approved';

-- -----------------------------------------------------------------------------
-- 7. PHYSICAL STOCK COUNT & ADJUSTMENTS (စတော့ရေတွက်ခြင်းနှင့် ကွဲလွဲမှုပြင်ဆင်ချက်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_no TEXT NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    effective_date DATE NOT NULL,
    total_variance_value INTEGER NOT NULL DEFAULT 0, -- ABS(diff_qty * unit_cost) စုစုပေါင်း (Threshold စစ်ရန်)
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    submitted_at DATETIME,
    decided_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    decided_at DATETIME,
    reject_reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    system_qty REAL NOT NULL DEFAULT 0,
    counted_qty REAL NOT NULL CHECK (counted_qty >= 0),
    diff_qty REAL NOT NULL DEFAULT 0, -- counted_qty - system_qty
    unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    reason TEXT NOT NULL,
    UNIQUE (adjustment_id, product_id)
);

-- -----------------------------------------------------------------------------
-- 8. TRANSFERS, YARN ISSUES & WASTE LOGS (ဆိုင်ခွဲလွှဲပြောင်း၊ ရက်ကန်းချည်ထုတ်၊ အလေအလွင့်)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_no TEXT NOT NULL UNIQUE,
    from_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    to_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK(quantity > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'dispatched', 'received', 'completed', 'cancelled')),
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    dispatched_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    dispatched_at DATETIME,
    received_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    received_at DATETIME,
    cancelled_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_at DATETIME,
    cancel_reason TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_different_branches CHECK (from_branch_id != to_branch_id)
);

CREATE TABLE IF NOT EXISTS yarn_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_no TEXT UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    yarn_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    weaver_name TEXT NOT NULL,
    issue_type TEXT NOT NULL DEFAULT 'ISSUE' CHECK(issue_type IN ('ISSUE', 'RETURN')),
    quantity REAL NOT NULL CHECK(quantity > 0),
    issue_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'cancelled')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

-- -----------------------------------------------------------------------------
-- 9. PURCHASES (အဝယ်မှတ်တမ်း)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_no TEXT NOT NULL UNIQUE,
    ref_no TEXT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    supplier_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL,
    purchase_date DATE NOT NULL,
    items_total INTEGER NOT NULL DEFAULT 0 CHECK(items_total >= 0),
    total_amount INTEGER NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
    paid_amount INTEGER NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
    diff_amount INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'bank', 'credit', 'production')),
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
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_cost INTEGER NOT NULL CHECK(unit_cost >= 0),
    subtotal INTEGER NOT NULL CHECK(subtotal >= 0)
);

-- -----------------------------------------------------------------------------
-- 10. SALES & POS VOUCHERS (အရောင်းဘောင်ချာစနစ်)
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
    cash_amount INTEGER NOT NULL DEFAULT 0 CHECK(cash_amount >= 0),
    bank_amount INTEGER NOT NULL DEFAULT 0 CHECK(bank_amount >= 0),
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
-- 11. MULTI-STORE CASHBOOK (နေ့စဉ်ငွေစာရင်း)
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
-- 12. DAILY CASHBOOK CLOSING, AUDIT & SECURITY LOGS
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
-- 13. PERFORMANCE INDEXES (D1 Read-Quota Optimized)
-- -----------------------------------------------------------------------------
-- Search Optimization
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_item_name ON products(item_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- Stock Movements Ledger Indexes (Critical for Monthly Report & Reconciliation)
CREATE INDEX IF NOT EXISTS idx_sm_branch_product_date ON stock_movements(branch_id, product_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_sm_source ON stock_movements(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_sm_effective_date ON stock_movements(effective_date);

-- Opening Stock & Adjustment Lookups
CREATE INDEX IF NOT EXISTS idx_opening_branch_status ON opening_stock_counts(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_adj_branch_status ON stock_adjustments(branch_id, status, effective_date);

-- Multi-tenant Branch Scoping & Date Filtering
CREATE INDEX IF NOT EXISTS idx_branch_inventory_lookup ON branch_inventory(branch_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON sales(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_created ON purchases(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_no ON purchases(purchase_no);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_cashbook_branch_date ON cashbook_entries(branch_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_cust_ledger_cust_id ON customer_ledger(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_supp_ledger_supp_id ON supplier_ledger(supplier_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_from_created ON stock_transfers(from_branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_to_created ON stock_transfers(to_branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_waste_branch_created ON waste_logs(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_yarn_issues_branch_date ON yarn_issues(branch_id, issue_date);

-- Foreign Key Lookups
CREATE INDEX IF NOT EXISTS idx_cashbook_sale_id ON cashbook_entries(sale_id);
CREATE INDEX IF NOT EXISTS idx_cashbook_purchase_id ON cashbook_entries(purchase_id);
CREATE INDEX IF NOT EXISTS idx_cashbook_supp_ledger ON cashbook_entries(supplier_ledger_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id, purchase_id);
