// =============================================================================
// FILE 1 OF 5: cashbook-api/utils.js
// SHARED HELPERS, KYAT/QTY MATH, D1 SCHEMA GUARD, RBAC, AUDIT & CRYPTO/JWT AUTH
// Version: 3.2.0 (Enterprise Security Hardened, Zero Plaintext & D1 Indexed)
// =============================================================================

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-Id",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
};

/**
 * Request Origin အား wrangler.toml ရှိ ALLOWED_ORIGIN နှင့် တိုက်ဆိုင်စစ်ဆေးပြီး CORS သတ်မှတ်ခြင်း
 */
export function getCorsHeaders(request, env) {
    const reqOrigin = request?.headers?.get("Origin") || "";
    const rawAllowed = (env && env.ALLOWED_ORIGIN) ? String(env.ALLOWED_ORIGIN).trim() : "";
    const allowedList = rawAllowed.split(",").map(s => s.trim()).filter(Boolean);
    const primaryOrigin = allowedList[0] || "*";

    let resolvedOrigin = primaryOrigin;
    if (reqOrigin) {
        const isLocal = reqOrigin.startsWith("http://localhost:") ||
                        reqOrigin === "http://localhost" ||
                        reqOrigin.startsWith("http://127.0.0.1:") ||
                        reqOrigin === "http://127.0.0.1";
        const isExplicitlyAllowed = allowedList.includes(reqOrigin);

        if (isLocal || isExplicitlyAllowed) {
            resolvedOrigin = reqOrigin;
        }
    }

    return {
        "Access-Control-Allow-Origin": resolvedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-Id",
        "Access-Control-Max-Age": "86400",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Vary": "Origin"
    };
}

export function configureRequestContext(request, env) {
    const dynamicHeaders = getCorsHeaders(request, env);
    corsHeaders["Access-Control-Allow-Origin"] = dynamicHeaders["Access-Control-Allow-Origin"];
    return dynamicHeaders;
}

export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify({ success: true, data }), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json;charset=UTF-8",
            "Cache-Control": "no-store"
        }
    });
}

export function errorResponse(message, status = 400) {
    return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json;charset=UTF-8",
            "Cache-Control": "no-store"
        }
    });
}

// =============================================================================
// MYANMAR TIMEZONE (UTC+6:30) & INDEX-FRIENDLY UTC BOUNDARY HELPERS
// =============================================================================
const MMT_OFFSET_MS = 6.5 * 60 * 60 * 1000;

/**
 * မြန်မာစံတော်ချိန် (UTC+6:30) ဖြင့် ယနေ့ YYYY-MM-DD ရယူခြင်း
 */
export function getMyanmarTodayDate() {
    const now = new Date(Date.now() + MMT_OFFSET_MS);
    return now.toISOString().split("T")[0];
}

/**
 * မြန်မာစံတော်ချိန် (UTC+6:30) ဖြင့် ယမန်နေ့ YYYY-MM-DD ရယူခြင်း (00:00 MMT Cron အတွက်)
 */
export function getMyanmarYesterdayDate() {
    const yesterday = new Date(Date.now() + MMT_OFFSET_MS - (24 * 60 * 60 * 1000));
    return yesterday.toISOString().split("T")[0];
}

/**
 * မြန်မာရက်စွဲ (YYYY-MM-DD) တစ်ခုအတွက် SQLite B-Tree Index မိစေမည့် UTC အစနှင့်အဆုံး အချိန်ရယူခြင်း
 * Example: "2026-11-10" (MMT) -> { startUtc: "2026-11-09 17:30:00", endUtc: "2026-11-10 17:29:59" }
 */
export function getMyanmarDayUtcBounds(mmtDateStr) {
    const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(mmtDateStr || "").trim())
        ? String(mmtDateStr).trim()
        : getMyanmarTodayDate();

    const startMs = Date.parse(`${cleanDate}T00:00:00.000+06:30`);
    const endMs = Date.parse(`${cleanDate}T23:59:59.000+06:30`);

    const toSqliteUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
    return {
        startUtc: toSqliteUtc(startMs),
        endUtc: toSqliteUtc(endMs)
    };
}

/**
 * မြန်မာနှစ်တစ်နှစ်လုံးအတွက် SQLite B-Tree Index မိစေမည့် UTC အစနှင့်အဆုံး အချိန်ရယူခြင်း
 */
export function getMyanmarYearUtcBounds(year) {
    const y = /^\d{4}$/.test(String(year || "").trim())
        ? String(year).trim()
        : getMyanmarTodayDate().slice(0, 4);

    const { startUtc } = getMyanmarDayUtcBounds(`${y}-01-01`);
    const { endUtc } = getMyanmarDayUtcBounds(`${y}-12-31`);
    return { startUtc, endUtc };
}

/**
 * URL မှ Year ကို ဖမ်းယူရန် သို့မဟုတ် လက်ရှိမြန်မာနှစ်ကို Default ယူရန်
 */
export function getQueryYear(url, defaultYear = null) {
    const fallback = String(defaultYear || getMyanmarTodayDate().slice(0, 4));
    if (!url || !url.searchParams) return fallback;
    const y = url.searchParams.get("year");
    return (y && /^\d{4}$/.test(y.trim())) ? y.trim() : fallback;
}

// =============================================================================
// CURRENCY (INTEGER KYAT) & QUANTITY MATH HELPERS
// =============================================================================

/**
 * ငွေပမာဏများကို Floating-point အမှားမပါစေရန် Kyat ကိန်းပြည့် (INTEGER) သို့ နီးစပ်ရာယူခြင်း
 */
export function roundKyat(val) {
    if (typeof val === "string") {
        val = val.replace(/,/g, "").trim();
    }
    const num = Number(val);
    return Number.isFinite(num) ? Math.round(num) : 0;
}

/**
 * အရေအတွက် (Quantity) ကို ဒသမ ၃ နေရာအထိ တိကျစွာ ယူခြင်း (ပေါင်/ကိုက် နှင့် အထည် နှစ်မျိုးလုံးအတွက်)
 */
export function roundQty(val) {
    if (typeof val === "string") {
        val = val.replace(/,/g, "").trim();
    }
    const num = Number(val);
    return Number.isFinite(num) ? Math.round(num * 1000) / 1000 : 0;
}

// =============================================================================
// RBAC & MULTI-BRANCH ISOLATION HELPERS
// =============================================================================

/**
 * Cashier ဖြစ်ပါက မိမိဆိုင်ခွဲ (auth.branch_id) ကိုသာ အတင်းသတ်မှတ်ပြီး ဆိုင်ခွဲကျော်ကြည့်ရှုမှုကို ပိတ်ဆို့ခြင်း
 */
export function resolveBranchId(auth, requestedBranchId = null, options = { allowAllForAdmin: false }) {
    const role = String(auth?.role || "cashier").toLowerCase();
    const userBranchId = Number(auth?.branch_id || 1);

    // Cashiers are strictly locked to their own assigned branch
    if (role === "cashier") {
        return userBranchId;
    }

    // Admin / Finance / Manager
    if (!requestedBranchId || requestedBranchId === "ALL") {
        return options?.allowAllForAdmin ? "ALL" : ( Number(requestedBranchId) || userBranchId );
    }

    const parsed = Number(requestedBranchId);
    return (Number.isInteger(parsed) && parsed > 0) ? parsed : userBranchId;
}

/**
 * သတ်မှတ်ထားသော Role များသာ ဝင်ရောက်ခွင့်ပြုရန် စစ်ဆေးခြင်း
 */
export function requireRole(auth, allowedRoles = ["admin"]) {
    const role = String(auth?.role || "").toLowerCase();
    return allowedRoles.map(r => r.toLowerCase()).includes(role);
}

/**
 * စာရင်းစစ် မှတ်တမ်း (Audit Trail) ရေးသွင်းခြင်း
 */
export async function logAudit(db, { branchId, userId, action, tableName, recordId, details }) {
    if (!db) return;
    try {
        await db.prepare(`
            INSERT INTO audit_logs (branch_id, user_id, action, table_name, record_id, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
            Number(branchId || 1),
            Number(userId || 1),
            String(action || "ACTION"),
            String(tableName || ""),
            recordId != null ? String(recordId) : null,
            typeof details === "object" ? JSON.stringify(details) : String(details || "")
        ).run();
    } catch (err) {
        console.error("[Audit Log Error]:", err.message);
    }
}

// =============================================================================
// PERSISTENT D1 + IN-MEMORY LOGIN BRUTE-FORCE RATE LIMITER
// =============================================================================
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 60 * 1000;

export function getClientIp(request) {
    return (
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
        "unknown-ip"
    );
}

export async function checkLoginRateLimit(request, db = null, username = "") {
    const ip = getClientIp(request);
    const key = username ? `${ip}:${String(username).toLowerCase()}` : ip;
    const now = Date.now();

    // 1. Check D1 Persistent Rate Limit Table if available
    if (db) {
        try {
            const row = await db.prepare(
                "SELECT attempts, first_attempt_ms FROM login_attempts WHERE attempt_key = ?"
            ).bind(key).first();

            if (row) {
                if (now - Number(row.first_attempt_ms) > LOCKOUT_WINDOW_MS) {
                    await db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(key).run();
                    return { allowed: true };
                }
                if (Number(row.attempts) >= MAX_LOGIN_ATTEMPTS) {
                    const waitSec = Math.ceil((LOCKOUT_WINDOW_MS - (now - Number(row.first_attempt_ms))) / 1000);
                    return { allowed: false, waitSeconds: Math.max(1, waitSec) };
                }
            }
        } catch {
            // Fallback to in-memory check below
        }
    }

    // 2. Fallback / Fast In-Memory Check
    const record = loginAttempts.get(key);
    if (!record) return { allowed: true };

    if (now - record.firstAttemptAt > LOCKOUT_WINDOW_MS) {
        loginAttempts.delete(key);
        return { allowed: true };
    }

    if (record.count >= MAX_LOGIN_ATTEMPTS) {
        const waitSec = Math.ceil((LOCKOUT_WINDOW_MS - (now - record.firstAttemptAt)) / 1000);
        return { allowed: false, waitSeconds: Math.max(1, waitSec) };
    }

    return { allowed: true };
}

export async function recordLoginAttempt(request, dbOrIsSuccess = null, username = "", isSuccess = false) {
    // Support both legacy signature (request, isSuccess) and new signature (request, db, username, isSuccess)
    let db = null;
    let userKey = "";
    let successFlag = false;

    if (typeof dbOrIsSuccess === "boolean") {
        successFlag = dbOrIsSuccess;
    } else {
        db = dbOrIsSuccess;
        userKey = String(username || "").toLowerCase();
        successFlag = Boolean(isSuccess);
    }

    const ip = getClientIp(request);
    const key = userKey ? `${ip}:${userKey}` : ip;
    const now = Date.now();

    if (db) {
        try {
            if (successFlag) {
                await db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(key).run();
            } else {
                const existing = await db.prepare(
                    "SELECT attempts, first_attempt_ms FROM login_attempts WHERE attempt_key = ?"
                ).bind(key).first();

                if (!existing || (now - Number(existing.first_attempt_ms) > LOCKOUT_WINDOW_MS)) {
                    await db.prepare(`
                        INSERT INTO login_attempts (attempt_key, attempts, first_attempt_ms)
                        VALUES (?, 1, ?)
                        ON CONFLICT(attempt_key) DO UPDATE SET attempts = 1, first_attempt_ms = excluded.first_attempt_ms
                    `).bind(key, now).run();
                } else {
                    await db.prepare(
                        "UPDATE login_attempts SET attempts = attempts + 1 WHERE attempt_key = ?"
                    ).bind(key).run();
                }
            }
        } catch {
            // Continue to in-memory update
        }
    }

    if (successFlag) {
        loginAttempts.delete(key);
        return;
    }

    const record = loginAttempts.get(key);
    if (!record || (now - record.firstAttemptAt > LOCKOUT_WINDOW_MS)) {
        loginAttempts.set(key, { count: 1, firstAttemptAt: now });
    } else {
        record.count += 1;
    }

    if (loginAttempts.size > 500) {
        for (const [k, v] of loginAttempts.entries()) {
            if (now - v.firstAttemptAt > LOCKOUT_WINDOW_MS) loginAttempts.delete(k);
        }
    }
}

// =============================================================================
// ONE-TIME LAZY SCHEMA, CONSTRAINT FIX & COLUMN AUTO-MIGRATION GUARD
// =============================================================================
let schemaVerified = false;

async function ensureColumns(db, tableName, requiredColumns) {
    const info = await db.prepare(`PRAGMA table_info(${tableName})`).all().catch(() => ({ results: [] }));
    const existing = (info.results || []).map(r => String(r.name).toLowerCase());
    if (existing.length === 0) return;

    for (const [colName, colDef] of Object.entries(requiredColumns)) {
        if (!existing.includes(colName.toLowerCase())) {
            await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`).run().catch((e) => {
                console.error(`[Schema Alter Error ${tableName}.${colName}]:`, e.message);
            });
        }
    }
}

/**
 * customer_ledger နှင့် supplier_ledger တွင် CHECK(payment_method IN ('cash','bank')) ဖြစ်နေပါက
 * 'credit' နှင့် 'split' သွင်းနိုင်စေရန် Constraint အလိုအလျောက် ပြင်ဆင်ပေးခြင်း
 */
async function fixLedgerCheckConstraintsIfNeeded(db) {
    try {
        const masterRows = await db.prepare(`
            SELECT name, sql FROM sqlite_master 
            WHERE type = 'table' AND name IN ('customer_ledger', 'supplier_ledger')
        `).all();

        for (const row of (masterRows.results || [])) {
            const sqlText = String(row.sql || "");
            if (sqlText.includes("CHECK") && sqlText.includes("payment_method") && !sqlText.includes("'credit'")) {
                if (row.name === "customer_ledger") {
                    await db.batch([
                        db.prepare(`
                            CREATE TABLE IF NOT EXISTS customer_ledger_v32 (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                                branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                                sale_id INTEGER,
                                type TEXT NOT NULL,
                                amount INTEGER NOT NULL,
                                balance_after INTEGER NOT NULL,
                                payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'credit', 'split', 'opening')),
                                bank_account_name TEXT,
                                reference_note TEXT,
                                status TEXT DEFAULT 'completed',
                                created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            )
                        `),
                        db.prepare(`
                            INSERT INTO customer_ledger_v32 (id, customer_id, branch_id, sale_id, type, amount, balance_after, payment_method, bank_account_name, reference_note, created_by, created_at)
                            SELECT id, customer_id, branch_id, sale_id, type, ROUND(amount), ROUND(balance_after), payment_method, bank_account_name, reference_note, created_by, created_at
                            FROM customer_ledger
                        `),
                        db.prepare("DROP TABLE customer_ledger"),
                        db.prepare("ALTER TABLE customer_ledger_v32 RENAME TO customer_ledger"),
                        db.prepare("CREATE INDEX IF NOT EXISTS idx_cust_ledger_cust_id ON customer_ledger(customer_id, created_at)")
                    ]);
                } else if (row.name === "supplier_ledger") {
                    await db.batch([
                        db.prepare(`
                            CREATE TABLE IF NOT EXISTS supplier_ledger_v32 (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                supplier_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                                branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                                purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
                                type TEXT NOT NULL,
                                amount INTEGER NOT NULL,
                                balance_after INTEGER NOT NULL,
                                payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'credit', 'split', 'opening')),
                                bank_account_name TEXT,
                                reference_note TEXT,
                                status TEXT DEFAULT 'completed',
                                created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            )
                        `),
                        db.prepare(`
                            INSERT INTO supplier_ledger_v32 (id, supplier_id, branch_id, purchase_id, type, amount, balance_after, payment_method, bank_account_name, reference_note, created_by, created_at)
                            SELECT id, supplier_id, branch_id, purchase_id, type, ROUND(amount), ROUND(balance_after), payment_method, bank_account_name, reference_note, created_by, created_at
                            FROM supplier_ledger
                        `),
                        db.prepare("DROP TABLE supplier_ledger"),
                        db.prepare("ALTER TABLE supplier_ledger_v32 RENAME TO supplier_ledger"),
                        db.prepare("CREATE INDEX IF NOT EXISTS idx_supp_ledger_supp_id ON supplier_ledger(supplier_id, created_at)")
                    ]);
                }
            }
        }
    } catch (err) {
        console.error("[Ledger Constraint Migration Error]:", err.message);
    }
}

export async function ensureSchemaOnce(db) {
    if (schemaVerified || !db) return;
    try {
        // 1. အရေးကြီး ဇယားများ တည်ဆောက်ပေးခြင်း (Audit Logs & Rate Limit အပါအဝင်)
        await db.batch([
            db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supplier_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
                    type TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    balance_after INTEGER NOT NULL,
                    payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'credit', 'split', 'opening')),
                    bank_account_name TEXT,
                    reference_note TEXT,
                    status TEXT DEFAULT 'completed',
                    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS customer_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                    sale_id INTEGER,
                    type TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    balance_after INTEGER NOT NULL,
                    payment_method TEXT CHECK(payment_method IN ('cash', 'bank', 'credit', 'split', 'opening')),
                    bank_account_name TEXT,
                    reference_note TEXT,
                    status TEXT DEFAULT 'completed',
                    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS waste_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    reference_no TEXT NOT NULL UNIQUE,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                    quantity REAL NOT NULL,
                    unit_cost INTEGER NOT NULL DEFAULT 0,
                    reason TEXT NOT NULL,
                    status TEXT DEFAULT 'completed',
                    recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS yarn_issues (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
                    yarn_id INTEGER NOT NULL,
                    product_id INTEGER,
                    weaver_name TEXT NOT NULL,
                    quantity REAL NOT NULL,
                    issue_date DATE NOT NULL DEFAULT (CURRENT_DATE),
                    notes TEXT,
                    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
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
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    branch_id INTEGER,
                    user_id INTEGER,
                    action TEXT NOT NULL,
                    table_name TEXT,
                    record_id TEXT,
                    details TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS login_attempts (
                    attempt_key TEXT PRIMARY KEY,
                    attempts INTEGER NOT NULL DEFAULT 1,
                    first_attempt_ms INTEGER NOT NULL
                )
            `)
        ]);

        // Fix legacy CHECK(payment_method IN ('cash', 'bank')) on existing D1 tables
        await fixLedgerCheckConstraintsIfNeeded(db);

        // 2. စနစ်သုံး ငွေစာရင်းခေါင်းစဉ်များ သေချာစေခြင်း
        await ensureColumns(db, "cash_categories", {
            is_remittance: "INTEGER DEFAULT 0"
        });

        await db.batch([
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (1, 'အထည်ရောင်းရငွေ (POS Sales)', 'INCOME', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (2, 'အကြွေးဟောင်းရငွေ (Debt Collection)', 'INCOME', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (6, 'ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ် (Trading Goods Purchase)', 'EXPENSE', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active, is_remittance) VALUES (10, 'ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ', 'EXPENSE', 1, 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (11, 'ပွဲရုံအကြွေးဆပ်ငွေ (Supplier Debt Payment)', 'EXPENSE', 1, 1)`),
            db.prepare(`UPDATE cash_categories SET is_remittance = 1 WHERE id = 10`)
        ]).catch(() => {});

        // 3. Users Security Columns & Zero-Downtime Legacy Password Upgrade
        await ensureColumns(db, "users", {
            plain_password: "TEXT",
            token_version: "INTEGER DEFAULT 1"
        });

        // Upgrade any remaining legacy '_hash' passwords to real PBKDF2-SHA256 & wipe plain_password
        const legacyUsers = await db.prepare(
            "SELECT id, password_hash, plain_password FROM users WHERE password_hash NOT LIKE 'pbkdf2:%' OR plain_password IS NOT NULL"
        ).all().catch(() => ({ results: [] }));

        for (const u of (legacyUsers.results || [])) {
            const currentHash = String(u.password_hash || "");
            if (!currentHash.startsWith("pbkdf2:")) {
                const rawPwd = u.plain_password
                    ? String(u.plain_password)
                    : (currentHash.endsWith("_hash") ? currentHash.slice(0, -5) : currentHash);
                if (rawPwd) {
                    const pbkdf2Hash = await hashPassword(rawPwd);
                    await db.prepare("UPDATE users SET password_hash = ?, plain_password = NULL WHERE id = ?")
                        .bind(pbkdf2Hash, u.id).run().catch(() => {});
                }
            } else if (u.plain_password !== null) {
                await db.prepare("UPDATE users SET plain_password = NULL WHERE id = ?")
                    .bind(u.id).run().catch(() => {});
            }
        }

        // 4. ရှိပြီးသား ဇယားများတွင် Soft-Delete နှင့် Audit ကော်လံများ အလိုအလျောက် ထည့်သွင်းခြင်း
        await ensureColumns(db, "cashbook_entries", {
            sale_id: "INTEGER",
            purchase_id: "INTEGER",
            customer_ledger_id: "INTEGER",
            supplier_ledger_id: "INTEGER",
            bank_account_name: "TEXT",
            quantity: "REAL DEFAULT 1.0",
            unit_price: "INTEGER DEFAULT 0",
            diff_amount: "INTEGER DEFAULT 0",
            ref_no: "TEXT",
            status: "TEXT DEFAULT 'completed'"
        });

        await ensureColumns(db, "customers", {
            shop_name: "TEXT",
            entity_type: "TEXT DEFAULT 'CUSTOMER'",
            customer_type: "TEXT DEFAULT 'retail'",
            credit_limit: "INTEGER DEFAULT 0",
            current_debt: "INTEGER DEFAULT 0",
            current_payable: "INTEGER DEFAULT 0",
            address: "TEXT",
            is_active: "INTEGER DEFAULT 1"
        });

        await ensureColumns(db, "purchases", {
            ref_no: "TEXT",
            supplier_id: "INTEGER",
            purchase_date: "DATE",
            items_total: "INTEGER DEFAULT 0",
            paid_amount: "INTEGER DEFAULT 0",
            diff_amount: "INTEGER DEFAULT 0",
            bank_account_name: "TEXT",
            notes: "TEXT",
            status: "TEXT DEFAULT 'completed'",
            cancelled_by: "INTEGER",
            cancelled_at: "DATETIME",
            cancel_reason: "TEXT"
        });

        await ensureColumns(db, "sales", {
            cash_amount: "INTEGER DEFAULT 0",
            bank_amount: "INTEGER DEFAULT 0",
            bank_account_name: "TEXT",
            notes: "TEXT",
            status: "TEXT DEFAULT 'completed'",
            cancelled_by: "INTEGER",
            cancelled_at: "DATETIME",
            cancel_reason: "TEXT"
        });

        await ensureColumns(db, "stock_transfers", {
            product_id: "INTEGER",
            quantity: "REAL DEFAULT 0",
            created_by: "INTEGER",
            notes: "TEXT",
            status: "TEXT DEFAULT 'completed'"
        });

        await ensureColumns(db, "waste_logs", {
            status: "TEXT DEFAULT 'completed'"
        });

        await ensureColumns(db, "yarn_issues", {
            branch_id: "INTEGER",
            product_id: "INTEGER",
            notes: "TEXT"
        });

        // 5. D1 Read Quota ၉၅%+ သက်သာစေမည့် Composite B-Tree Indexes
        await db.batch([
            db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON sales(branch_id, created_at)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_purchases_branch_created ON purchases(branch_id, created_at)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_branch_date ON cashbook_entries(branch_id, entry_date)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_waste_branch_created ON waste_logs(branch_id, created_at)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_transfers_from_created ON stock_transfers(from_branch_id, created_at)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_transfers_to_created ON stock_transfers(to_branch_id, created_at)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id, purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id, sale_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_sale_id ON cashbook_entries(sale_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_purchase_id ON cashbook_entries(purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_supp_ledger ON cashbook_entries(supplier_ledger_id)")
        ]);

        schemaVerified = true;
    } catch (err) {
        console.error("[Schema Verification Error]:", err.message);
    }
}

// =============================================================================
// SECURITY & CRYPTO HELPERS (PBKDF2 Password Hashing & HMAC-SHA256 Token)
// =============================================================================

export function getJwtSecret(env) {
    if (env && env.JWT_SECRET && String(env.JWT_SECRET).trim().length >= 16) {
        return String(env.JWT_SECRET).trim();
    }
    // Allow explicit local dev secret only if configured in local .dev.vars
    if (env && env.ALLOW_DEV_SECRET === "true") {
        return "local-dev-only-jwt-secret-key-do-not-use-in-prod";
    }
    throw new Error(
        "JWT_SECRET လုံခြုံရေးကီး သတ်မှတ်ထားခြင်း မရှိသေးပါ။ Terminal မှ `npx wrangler secret put JWT_SECRET` ဖြင့် ထည့်သွင်းပေးပါ။"
    );
}

function base64UrlEncode(bufferOrStr) {
    let str = typeof bufferOrStr === "string" ? bufferOrStr : String.fromCharCode(...new Uint8Array(bufferOrStr));
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let res = 0;
    for (let i = 0; i < a.length; i++) {
        res |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return res === 0;
}

export async function hashPassword(password, saltHex = null) {
    const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const passKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        passKey,
        256
    );
    const hashHex = bytesToHex(new Uint8Array(derivedBits));
    const outSaltHex = bytesToHex(salt);
    return `pbkdf2:${outSaltHex}:${hashHex}`;
}

/**
 * PBKDF2-SHA256 Password ကိုသာ လက်ခံစစ်ဆေးခြင်း (Plaintext နှင့် _hash လုံးဝ လက်မခံတော့ပါ)
 */
export async function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== "string") return false;
    if (!storedHash.startsWith("pbkdf2:")) return false;

    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const saltHex = parts[1];
    const expectedHash = parts[2];
    const computed = await hashPassword(password, saltHex);
    const computedHash = computed.split(":")[2];
    return timingSafeEqual(expectedHash, computedHash);
}

export async function signToken(payload, secret, expiresInSeconds = 43200) {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

    const encHeader = base64UrlEncode(JSON.stringify(header));
    const encPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const dataToSign = `${encHeader}.${encPayload}`;

    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataToSign));
    return `${dataToSign}.${base64UrlEncode(signature)}`;
}

export async function verifyToken(token, secret) {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encHeader, encPayload, encSig] = parts;
    const dataToSign = `${encHeader}.${encPayload}`;

    try {
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
        );
        const sigBytes = base64UrlDecode(encSig);
        const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(dataToSign));
        if (!isValid) return null;

        const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encPayload)));
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) return null;
        return payload;
    } catch {
        return null;
    }
}

// Micro-cache for user token_version to prevent extra D1 reads on rapid concurrent API calls
const tokenVersionCache = new Map();
const TOKEN_CACHE_TTL_MS = 15000;

export async function getAuthUser(request, env) {
    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7).trim();

    let secret;
    try {
        secret = getJwtSecret(env);
    } catch {
        return null;
    }

    const payload = await verifyToken(token, secret);
    if (!payload || !payload.uid) return null;

    // Verify user is still active and token_version matches (if DB is bound)
    if (env && env.DB) {
        const now = Date.now();
        const cached = tokenVersionCache.get(payload.uid);
        let dbUser = null;

        if (cached && (now - cached.ts < TOKEN_CACHE_TTL_MS)) {
            dbUser = cached.data;
        } else {
            dbUser = await env.DB.prepare(
                "SELECT is_active, COALESCE(token_version, 1) AS tv, role, branch_id FROM users WHERE id = ?"
            ).bind(payload.uid).first().catch(() => null);
            if (dbUser) {
                tokenVersionCache.set(payload.uid, { ts: now, data: dbUser });
            }
        }

        if (!dbUser || Number(dbUser.is_active) !== 1) return null;
        if (payload.tv != null && Number(dbUser.tv) !== Number(payload.tv)) {
            return null; // Token revoked due to password change/reset
        }
        // Always enforce authoritative role & branch_id from DB
        payload.role = String(dbUser.role || payload.role || "cashier").toLowerCase();
        payload.branch_id = Number(dbUser.branch_id || payload.branch_id || 1);
    }

    return payload;
}
