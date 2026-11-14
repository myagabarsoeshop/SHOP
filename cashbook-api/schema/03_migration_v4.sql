-- =============================================================================
-- MIGRATION SCRIPT: 03_migration_v4.sql 
-- Target: Upgrade existing D1 Database to v4.1.0 (Ledger & RBAC Architecture)
-- Usage: npx wrangler d1 execute <DB_NAME> --file=./cashbook-api/schema/03_migration_v4.sql
-- =============================================================================

PRAGMA defer_foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. SCHEMA MIGRATIONS & INVOICE SEQUENCES TABLES
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
-- 2. UPGRADE USERS TABLE (DROP plain_password & MIGRATE 'manager' -> 'branch_manager')
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users_v41 (
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

INSERT INTO users_v41 (
    id, branch_id, username, password_hash, token_version, full_name, phone, role, is_active, created_at
)
SELECT 
    id,
    CASE 
        WHEN LOWER(role) IN ('admin', 'finance') THEN branch_id
        ELSE COALESCE(branch_id, 1)
    END AS branch_id,
    username,
    password_hash,
    COALESCE(token_version, 1) AS token_version,
    full_name,
    phone,
    CASE 
        WHEN LOWER(role) = 'manager' THEN 'branch_manager'
        WHEN LOWER(role) IN ('admin', 'finance', 'branch_manager', 'cashier') THEN LOWER(role)
        ELSE 'cashier'
    END AS role,
    COALESCE(is_active, 1) AS is_active,
    COALESCE(created_at, CURRENT_TIMESTAMP) AS created_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v41 RENAME TO users;

-- -----------------------------------------------------------------------------
-- 3. CREATE STOCK MOVEMENTS LEDGER (APPEND-ONLY SOURCE OF TRUTH)
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
    quantity REAL NOT NULL CHECK(quantity != 0),
    effective_date DATE NOT NULL,
    source_table TEXT,
    source_id INTEGER,
    reason TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sm_branch_product_date ON stock_movements(branch_id, product_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_sm_source ON stock_movements(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_sm_effective_date ON stock_movements(effective_date);

-- -----------------------------------------------------------------------------
-- 4. CREATE OPENING STOCK WORKFLOW TABLES
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_approved_opening 
ON opening_stock_counts(branch_id) 
WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_opening_branch_status ON opening_stock_counts(branch_id, status);

-- -----------------------------------------------------------------------------
-- 5. CREATE STOCK COUNT & ADJUSTMENTS TABLES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_no TEXT NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    effective_date DATE NOT NULL,
    total_variance_value INTEGER NOT NULL DEFAULT 0,
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
    diff_qty REAL NOT NULL DEFAULT 0,
    unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    reason TEXT NOT NULL,
    UNIQUE (adjustment_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_adj_branch_status ON stock_adjustments(branch_id, status, effective_date);

-- -----------------------------------------------------------------------------
-- 6. UPGRADE STOCK TRANSFERS & YARN ISSUES TABLES FOR STATE MACHINE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers_v41 (
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

INSERT INTO stock_transfers_v41 (
    id, transfer_no, from_branch_id, to_branch_id, product_id, quantity, status, notes, created_by, created_at
)
SELECT 
    id,
    transfer_no,
    from_branch_id,
    to_branch_id,
    product_id,
    quantity,
    CASE 
        WHEN status IN ('pending', 'dispatched', 'received', 'completed', 'cancelled') THEN status
        ELSE 'completed'
    END AS status,
    notes,
    COALESCE(created_by, 1),
    COALESCE(created_at, CURRENT_TIMESTAMP)
FROM stock_transfers
WHERE product_id IS NOT NULL AND from_branch_id != to_branch_id;

DROP TABLE stock_transfers;
ALTER TABLE stock_transfers_v41 RENAME TO stock_transfers;

CREATE INDEX IF NOT EXISTS idx_transfers_from_created ON stock_transfers(from_branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_to_created ON stock_transfers(to_branch_id, created_at);

CREATE TABLE IF NOT EXISTS yarn_issues_v41 (
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

INSERT INTO yarn_issues_v41 (
    id, reference_no, branch_id, yarn_id, product_id, weaver_name, issue_type, quantity, issue_date, notes, status, created_by, created_at
)
SELECT 
    id,
    'YRN-LEGACY-' || id,
    COALESCE(branch_id, 1),
    yarn_id,
    product_id,
    weaver_name,
    'ISSUE',
    quantity,
    COALESCE(issue_date, date(created_at, '+390 minutes')),
    notes,
    'completed',
    COALESCE(created_by, 1),
    COALESCE(created_at, CURRENT_TIMESTAMP)
FROM yarn_issues;

DROP TABLE yarn_issues;
ALTER TABLE yarn_issues_v41 RENAME TO yarn_issues;

CREATE INDEX IF NOT EXISTS idx_yarn_issues_branch_date ON yarn_issues(branch_id, issue_date);

-- -----------------------------------------------------------------------------
-- 7. LEGACY DATA MIGRATION (Spec Section 2.5)
-- Convert existing branch_inventory balances into baseline OPENING movements
-- (Idempotent: Only inserts if no stock_movements exist yet for that branch & product)
-- -----------------------------------------------------------------------------
INSERT INTO stock_movements (
    branch_id,
    product_id,
    movement_type,
    quantity,
    effective_date,
    source_table,
    source_id,
    reason,
    created_by,
    approved_by,
    created_at
)
SELECT 
    bi.branch_id,
    bi.product_id,
    'OPENING',
    ROUND(bi.quantity, 3),
    date('now', '+390 minutes'),
    'branch_inventory',
    bi.id,
    'Legacy migration',
    COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1), 1),
    COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1), 1),
    CURRENT_TIMESTAMP
FROM branch_inventory bi
WHERE bi.quantity > 0
  AND NOT EXISTS (
      SELECT 1 FROM stock_movements sm 
      WHERE sm.branch_id = bi.branch_id AND sm.product_id = bi.product_id
  );

-- Record migration version
INSERT OR REPLACE INTO schema_migrations (version, description, applied_at)
VALUES ('0002_v4_1_stock_movements_and_rbac', 'Added stock_movements, opening_stock, adjustments, invoice_sequences and branch_manager RBAC', CURRENT_TIMESTAMP);
