// =============================================================================
// FILE 1 OF 5: cashbook-api/utils.js
// SHARED HELPERS, KYAT/QTY MATH, RBAC MATRIX, BRANCH SCOPING, INVOICE SEQ & AUTH
// Version: 4.1.1 (Full v4.1 Users/Baseline Auto-Migration & Strict Spec 3.2 RBAC)
// =============================================================================

export const APP_VERSION = "4.1.1";
export const MM_OFFSET = "+390 minutes";
export const MMT_OFFSET_MS = 390 * 60 * 1000; // UTC+6:30 in milliseconds
export const HIGH_VALUE_ADJUSTMENT_THRESHOLD_KYAT = 50000;

let activeRequestEnv = null;

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-Id",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
};

/**
 * Custom HTTP Error for clean status & Myanmar message propagation
 */
export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "HttpError";
        this.status = status;
    }
}

/**
 * Request Origin အား wrangler.toml ရှိ ALLOWED_ORIGIN နှင့် တိုက်ဆိုင်စစ်ဆေးပြီး CORS သတ်မှတ်ခြင်း (Spec 9.5)
 */
export function getCorsHeaders(request, env) {
    const reqOrigin = request?.headers?.get("Origin") || "";
    const rawAllowed = (env && env.ALLOWED_ORIGIN) ? String(env.ALLOWED_ORIGIN).trim() : "";
    const allowedList = rawAllowed.split(",").map(s => s.trim()).filter(Boolean);
    const isDev = env?.ENVIRONMENT === "development" || env?.ALLOW_DEV_SECRET === "true";

    let resolvedOrigin = allowedList[0] || (isDev ? "*" : "null");

    if (reqOrigin) {
        const isLocal = isDev && (
            reqOrigin.startsWith("http://localhost:") ||
            reqOrigin === "http://localhost" ||
            reqOrigin.startsWith("http://127.0.0.1:") ||
            reqOrigin === "http://127.0.0.1"
        );
        const isExplicitlyAllowed = allowedList.includes(reqOrigin) || allowedList.includes("*");

        if (isExplicitlyAllowed || isLocal) {
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
    activeRequestEnv = env || null;
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
// MYANMAR TIMEZONE (UTC+6:30) & INDEX-FRIENDLY UTC BOUNDARY HELPERS (Spec 9.9)
// =============================================================================

export function getMyanmarTodayDate() {
    const now = new Date(Date.now() + MMT_OFFSET_MS);
    return now.toISOString().split("T")[0];
}

export function getMyanmarYesterdayDate() {
    const yesterday = new Date(Date.now() + MMT_OFFSET_MS - (24 * 60 * 60 * 1000));
    return yesterday.toISOString().split("T")[0];
}

export function getMyanmarDateKey(mmtDateStr = null) {
    const d = mmtDateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(mmtDateStr).trim())
        ? String(mmtDateStr).trim()
        : getMyanmarTodayDate();
    return d.slice(2).replace(/-/g, "");
}

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

export function getMyanmarYearUtcBounds(year) {
    const y = /^\d{4}$/.test(String(year || "").trim())
        ? String(year).trim()
        : getMyanmarTodayDate().slice(0, 4);

    const { startUtc } = getMyanmarDayUtcBounds(`${y}-01-01`);
    const { endUtc } = getMyanmarDayUtcBounds(`${y}-12-31`);
    return { startUtc, endUtc, startDate: `${y}-01-01`, endDate: `${y}-12-31` };
}

export function getQueryYear(url, defaultYear = null) {
    const fallback = String(defaultYear || getMyanmarTodayDate().slice(0, 4));
    if (!url || !url.searchParams) return fallback;
    const y = url.searchParams.get("year");
    return (y && /^\d{4}$/.test(y.trim())) ? y.trim() : fallback;
}

// =============================================================================
// CURRENCY (INTEGER KYAT) & QUANTITY MATH HELPERS (Spec 9.8)
// =============================================================================

export function roundKyat(val) {
    if (typeof val === "string") {
        val = val.replace(/,/g, "").trim();
    }
    const num = Number(val);
    return Number.isFinite(num) ? Math.round(num) : 0;
}

export function roundQty(val) {
    if (typeof val === "string") {
        val = val.replace(/,/g, "").trim();
    }
    const num = Number(val);
    return Number.isFinite(num) ? Math.round(num * 1000) / 1000 : 0;
}

// =============================================================================
// ROLE & PERMISSION MATRIX (Spec Section 3.1, 3.2, 3.3)
// =============================================================================

export function normalizeRole(rawRole) {
    const r = String(rawRole || "cashier").trim().toLowerCase();
    if (r === "manager") return "branch_manager";
    if (["admin", "finance", "branch_manager", "cashier"].includes(r)) return r;
    return "cashier";
}

export const PERMISSIONS = {
    "product.create": ["admin", "finance"],
    "product.update": ["admin", "finance"],
    "product.delete": ["admin", "finance"],
    "product.bulk_import": ["admin", "finance"],
    "product.view_cost": ["admin", "finance", "branch_manager"],

    "opening.create": ["admin", "finance", "branch_manager"],
    "opening.submit": ["admin", "finance", "branch_manager"],
    "opening.approve": ["admin", "finance"],
    "opening.reject": ["admin", "finance"],
    "opening.view": ["admin", "finance", "branch_manager"],

    "adjustment.create": ["admin", "finance", "branch_manager"],
    "adjustment.submit": ["admin", "finance", "branch_manager"],
    "adjustment.approve": ["admin", "finance"],
    "adjustment.approve_high_value": ["admin"],
    "adjustment.reject": ["admin", "finance"],
    "adjustment.view": ["admin", "finance", "branch_manager"],

    "transfer.create": ["admin", "finance", "branch_manager"],
    "transfer.dispatch": ["admin", "finance", "branch_manager"],
    "transfer.receive": ["admin", "finance", "branch_manager", "cashier"],
    "transfer.cancel": ["admin", "finance", "branch_manager"],
    "transfer.view": ["admin", "finance", "branch_manager", "cashier"],

    "waste.view": ["admin", "finance", "branch_manager"],
    "waste.create": ["admin", "finance", "branch_manager"],
    "waste.delete": ["admin", "finance"],
    "yarn.view": ["admin", "finance", "branch_manager"],
    "yarn.issue": ["admin", "finance", "branch_manager"],

    "purchase.view": ["admin", "finance", "branch_manager"],
    "purchase.create": ["admin", "finance", "branch_manager"],
    "purchase.update": ["admin", "finance", "branch_manager"],
    "purchase.void": ["admin", "finance", "branch_manager"],
    "pos.sale": ["admin", "finance", "branch_manager", "cashier"],
    "pos.void": ["admin", "finance", "branch_manager"],
    "pos.override_price": ["admin", "finance"],

    "cashbook.view": ["admin", "finance", "branch_manager", "cashier"],
    "cashbook.write": ["admin", "finance", "branch_manager", "cashier"],
    "cashbook.delete": ["admin", "finance"],
    "customer.view": ["admin", "finance", "branch_manager", "cashier"],
    "customer.write": ["admin", "finance", "branch_manager", "cashier"],
    "customer.edit_credit_limit": ["admin", "finance"],
    "customer.delete": ["admin", "finance"],

    "report.monthly_stock": ["admin", "finance", "branch_manager"],
    "dashboard.admin_metrics": ["admin", "finance"],
    "user.manage": ["admin"],
    "system.backup": ["admin"],
    "record.delete": ["admin", "finance"]
};

export function can(auth, permission) {
    if (!auth || !auth.role) return false;
    const role = normalizeRole(auth.role);
    const allowedRoles = PERMISSIONS[permission];
    if (!allowedRoles) return role === "admin";
    return allowedRoles.includes(role);
}

export function requirePermission(auth, permission, customMessage = null) {
    if (!can(auth, permission)) {
        throw new HttpError(
            403,
            customMessage || `ဤလုပ်ဆောင်ချက်အား ဆောင်ရွက်ခွင့် မရှိပါ (လိုအပ်သော ခွင့်ပြုချက်: ${permission})`
        );
    }
    return true;
}

export function requireRole(auth, allowedRoles = ["admin"]) {
    const role = normalizeRole(auth?.role);
    const normalizedAllowed = allowedRoles.map(r => normalizeRole(r));
    return normalizedAllowed.includes(role);
}

// =============================================================================
// MULTI-BRANCH SCOPING & ISOLATION (Spec Section 4.1 & 4.2)
// =============================================================================

export function resolveBranchId(auth, requestedBranchId = null, options = {}) {
    const {
        allowAllForAdmin = false,
        isWrite = false,
        strictStaffCheck = false
    } = options;

    const role = normalizeRole(auth?.role);
    const userBranchId = Number(auth?.branch_id || 0);
    const reqStr = requestedBranchId != null ? String(requestedBranchId).trim() : "";
    const isAllRequested = reqStr === "" || reqStr.toUpperCase() === "ALL";

    if (role === "cashier" || role === "branch_manager") {
        if (!userBranchId || userBranchId <= 0) {
            throw new HttpError(403, "သင့်အကောင့်တွင် သတ်မှတ်ထားသော ဆိုင်ခွဲ (branch_id) မရှိပါ");
        }
        if ((isWrite || strictStaffCheck) && !isAllRequested) {
            const parsedReq = Number(reqStr);
            if (Number.isInteger(parsedReq) && parsedReq > 0 && parsedReq !== userBranchId) {
                throw new HttpError(403, "အခြားဆိုင်ခွဲ၏ စာရင်းအား ဝင်ရောက်ပြင်ဆင်ခွင့် မရှိပါ");
            }
        }
        return userBranchId;
    }

    if (isWrite) {
        if (isAllRequested) {
            throw new HttpError(
                400,
                "ဆိုင်ခွဲအားလုံး (ALL View) မှ စာရင်းသွင်း/ပြင်ဆင်၍ မရပါ။ ဆိုင်ခွဲတစ်ခုကို တိကျစွာ ရွေးချယ်ပေးပါ။"
            );
        }
        const parsedWriteBranch = Number(reqStr);
        if (!Number.isInteger(parsedWriteBranch) || parsedWriteBranch <= 0) {
            throw new HttpError(400, "ဆိုင်ခွဲ (branch_id) မှန်ကန်စွာ ရွေးချယ်ပေးပါ");
        }
        return parsedWriteBranch;
    }

    if (isAllRequested) {
        if (allowAllForAdmin) return "ALL";
        if (userBranchId > 0) return userBranchId;
        return 1;
    }

    const parsedReadBranch = Number(reqStr);
    if (!Number.isInteger(parsedReadBranch) || parsedReadBranch <= 0) {
        throw new HttpError(400, "ဆိုင်ခွဲ (branch_id) မမှန်ကန်ပါ");
    }
    return parsedReadBranch;
}

// =============================================================================
// RACE-SAFE INVOICE / VOUCHER NUMBER GENERATOR (Spec Section 1.2)
// =============================================================================

const branchCodeCache = new Map();

async function getBranchCode(db, branchId) {
    const bId = Number(branchId || 1);
    if (branchCodeCache.has(bId)) return branchCodeCache.get(bId);
    try {
        const row = await db.prepare("SELECT code FROM branches WHERE id = ?").bind(bId).first();
        if (row && row.code) {
            const code = String(row.code).trim().toUpperCase();
            branchCodeCache.set(bId, code);
            return code;
        }
    } catch {
        // Fallback
    }
    return `B${bId}`;
}

export async function generateUniqueInvoice(dbOrPrefix, prefixOrBranchId, maybeBranchId = null) {
    let db = null;
    let prefix = "INV";
    let branchId = 1;

    if (typeof dbOrPrefix === "string") {
        db = activeRequestEnv?.DB || null;
        prefix = dbOrPrefix;
        branchId = Number(prefixOrBranchId || 1);
    } else {
        db = dbOrPrefix?.DB ? dbOrPrefix.DB : dbOrPrefix;
        prefix = String(prefixOrBranchId || "INV");
        branchId = Number(maybeBranchId || 1);
    }

    const cleanPrefix = String(prefix || "VR").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "VR";
    const validBranchId = Number.isInteger(branchId) && branchId > 0 ? branchId : 1;
    const dateKey = getMyanmarDateKey();

    if (!db) {
        throw new HttpError(500, "Database connection မရှိသဖြင့် ဘောင်ချာနံပါတ် ထုတ်ပေးနိုင်ခြင်း မရှိပါ");
    }

    const branchCode = await getBranchCode(db, validBranchId);

    const conflictCheckSqlByPrefix = {
        INV: "SELECT 1 FROM sales WHERE invoice_no = ? LIMIT 1",
        PUR: "SELECT 1 FROM purchases WHERE purchase_no = ? LIMIT 1",
        TRF: "SELECT 1 FROM stock_transfers WHERE transfer_no = ? LIMIT 1",
        WST: "SELECT 1 FROM waste_logs WHERE reference_no = ? LIMIT 1",
        ADJ: "SELECT 1 FROM stock_adjustments WHERE reference_no = ? LIMIT 1",
        YRN: "SELECT 1 FROM yarn_issues WHERE reference_no = ? LIMIT 1"
    };
    const checkSql = conflictCheckSqlByPrefix[cleanPrefix] || null;

    for (let attempt = 0; attempt < 10; attempt++) {
        const seqRow = await db.prepare(`
            INSERT INTO invoice_sequences (branch_id, prefix, date_key, last_seq, updated_at)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(branch_id, prefix, date_key)
            DO UPDATE SET 
                last_seq = invoice_sequences.last_seq + 1,
                updated_at = CURRENT_TIMESTAMP
            RETURNING last_seq
        `).bind(validBranchId, cleanPrefix, dateKey).first();

        const seqNum = Number(seqRow?.last_seq || 1);
        const seqStr = String(seqNum).padStart(3, "0");
        const candidate = `${cleanPrefix}-${branchCode}-${dateKey}-${seqStr}`;

        if (!checkSql) {
            return candidate;
        }

        const existing = await db.prepare(checkSql).bind(candidate).first();
        if (!existing) {
            return candidate;
        }
    }

    throw new HttpError(500, "ဘောင်ချာနံပါတ် အသစ်ထုတ်ယူရာတွင် အခက်အခဲရှိနေပါသည်။ ခေတ္တစောင့်ပြီး ပြန်လည်ကြိုးစားပါ။");
}

// =============================================================================
// STOCK MOVEMENTS LEDGER HELPER (Spec Section 2.1)
// =============================================================================

export const VALID_MOVEMENT_TYPES = new Set([
    "OPENING",
    "PURCHASE_IN",
    "PURCHASE_VOID_OUT",
    "SALE_OUT",
    "SALE_VOID_IN",
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "WASTE_OUT",
    "YARN_ISSUE_OUT",
    "YARN_RETURN_IN",
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT"
]);

export function createStockMovementStmt(db, {
    branchId,
    productId,
    movementType,
    quantity,
    effectiveDate = null,
    sourceTable = null,
    sourceId = null,
    reason = null,
    createdBy,
    approvedBy = null
}) {
    if (!VALID_MOVEMENT_TYPES.has(movementType)) {
        throw new HttpError(400, `Stock movement အမျိုးအစား (${movementType}) မမှန်ကန်ပါ`);
    }

    const absQty = Math.abs(roundQty(quantity));
    if (absQty <= 0) {
        throw new HttpError(400, "Stock movement အရေအတွက်သည် သုညထက် ကြီးရပါမည်");
    }

    const isOutMovement = movementType.endsWith("_OUT");
    const signedQty = isOutMovement ? -absQty : absQty;
    const effDate = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate).trim())
        ? String(effectiveDate).trim()
        : getMyanmarTodayDate();

    return db.prepare(`
        INSERT INTO stock_movements (
            branch_id, product_id, movement_type, quantity, effective_date,
            source_table, source_id, reason, created_by, approved_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
        Number(branchId),
        Number(productId),
        movementType,
        signedQty,
        effDate,
        sourceTable ? String(sourceTable) : null,
        sourceId != null ? Number(sourceId) : null,
        reason ? String(reason).trim() : null,
        Number(createdBy || 1),
        approvedBy != null ? Number(approvedBy) : null
    );
}

// =============================================================================
// AUDIT TRAIL & D1 USAGE MONITORING HELPERS
// =============================================================================

export async function logAudit(db, { branchId, userId, action, tableName, recordId, details }) {
    if (!db) return;
    try {
        await db.prepare(`
            INSERT INTO audit_logs (branch_id, user_id, action, table_name, record_id, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
            branchId != null ? Number(branchId) : null,
            userId != null ? Number(userId) : null,
            String(action || "ACTION"),
            String(tableName || ""),
            recordId != null ? String(recordId) : null,
            typeof details === "object" ? JSON.stringify(details) : String(details || "")
        ).run();
    } catch (err) {
        console.error("[Audit Log Error]:", err.message);
    }
}

export function summarizeD1Meta(resultOrArray) {
    const items = Array.isArray(resultOrArray) ? resultOrArray : [resultOrArray];
    let rowsRead = 0;
    let rowsWritten = 0;
    for (const item of items) {
        if (item && item.meta) {
            rowsRead += Number(item.meta.rows_read || 0);
            rowsWritten += Number(item.meta.rows_written || 0);
        }
    }
    return { rowsRead, rowsWritten };
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
            // Fallback
        }
    }

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
            // Continue
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
// ONE-TIME V4.1.1 MIGRATION RUNNER (Ensures v4.1 Tables, Users & Baseline Exist)
// =============================================================================
let schemaVerified = false;

async function ensureColumns(db, tableName, requiredColumns) {
    const info = await db.prepare(`PRAGMA table_info(${tableName})`).all().catch(() => ({ results: [] }));
    const existing = (info.results || []).map(r => String(r.name).toLowerCase());
    if (existing.length === 0) return;

    for (const [colName, colDef] of Object.entries(requiredColumns)) {
        if (!existing.includes(colName.toLowerCase())) {
            await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`).run().catch(() => {});
        }
    }
}

export async function ensureSchemaOnce(db) {
    if (schemaVerified || !db) return;
    try {
        // Fast check: if schema_migrations already has '0003_v4_1_full', skip immediately!
        const migCheck = await db.prepare(
            "SELECT version FROM schema_migrations WHERE version = '0003_v4_1_full' LIMIT 1"
        ).first().catch(() => null);

        if (migCheck) {
            schemaVerified = true;
            return;
        }

        // 1. Ensure v4.1 Tables & Indexes
        await db.batch([
            db.prepare(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    description TEXT NOT NULL,
                    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS invoice_sequences (
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                    prefix TEXT NOT NULL,
                    date_key TEXT NOT NULL,
                    last_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_seq >= 0),
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (branch_id, prefix, date_key)
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS stock_movements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                    movement_type TEXT NOT NULL CHECK (movement_type IN (
                        'OPENING','PURCHASE_IN','PURCHASE_VOID_OUT',
                        'SALE_OUT','SALE_VOID_IN',
                        'TRANSFER_OUT','TRANSFER_IN',
                        'WASTE_OUT','YARN_ISSUE_OUT','YARN_RETURN_IN',
                        'ADJUSTMENT_IN','ADJUSTMENT_OUT'
                    )),
                    quantity REAL NOT NULL,
                    effective_date DATE NOT NULL,
                    source_table TEXT,
                    source_id INTEGER,
                    reason TEXT,
                    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    approved_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS opening_stock_counts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
                    as_of_date DATE NOT NULL,
                    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    submitted_at DATETIME,
                    decided_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
                    decided_at DATETIME,
                    reject_reason TEXT,
                    notes TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS opening_stock_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    count_id INTEGER NOT NULL REFERENCES opening_stock_counts(id) ON DELETE CASCADE,
                    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                    quantity REAL NOT NULL CHECK (quantity >= 0),
                    UNIQUE (count_id, product_id)
                )
            `),
            db.prepare(`
                CREATE TABLE IF NOT EXISTS stock_adjustments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    reference_no TEXT NOT NULL UNIQUE,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
                    effective_date DATE NOT NULL,
                    total_variance_value INTEGER NOT NULL DEFAULT 0,
                    notes TEXT,
                    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                    submitted_at DATETIME,
                    decided_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
                    decided_at DATETIME,
                    reject_reason TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            `),
            db.prepare(`
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
                )
            `),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_sm_branch_product_date ON stock_movements(branch_id, product_id, effective_date)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_sm_source ON stock_movements(source_table, source_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_sm_effective_date ON stock_movements(effective_date)"),
            db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uq_one_approved_opening ON opening_stock_counts(branch_id) WHERE status = 'approved'"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_opening_branch_status ON opening_stock_counts(branch_id, status)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_adj_branch_status ON stock_adjustments(branch_id, status, effective_date)")
        ]);

        // 2. Upgrade users table if plain_password still exists or 'branch_manager' is missing in CHECK
        const usersTableMeta = await db.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).first().catch(() => null);
        const usersSqlText = String(usersTableMeta?.sql || "");

        if (usersSqlText && (usersSqlText.includes("plain_password") || !usersSqlText.includes("branch_manager"))) {
            await db.batch([
                db.prepare("PRAGMA defer_foreign_keys = ON"),
                db.prepare("DROP TABLE IF EXISTS users_v41"),
                db.prepare(`
                    CREATE TABLE users_v41 (
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
                    )
                `),
                db.prepare(`
                    INSERT INTO users_v41 (
                        id, branch_id, username, password_hash, token_version, full_name, phone, role, is_active, created_at
                    )
                    SELECT 
                        id,
                        CASE 
                            WHEN LOWER(role) IN ('admin', 'finance') THEN branch_id
                            ELSE COALESCE(branch_id, 1)
                        END,
                        username,
                        password_hash,
                        COALESCE(token_version, 1),
                        full_name,
                        phone,
                        CASE 
                            WHEN LOWER(role) = 'manager' THEN 'branch_manager'
                            WHEN LOWER(role) IN ('admin', 'finance', 'branch_manager', 'cashier') THEN LOWER(role)
                            ELSE 'cashier'
                        END,
                        COALESCE(is_active, 1),
                        COALESCE(created_at, CURRENT_TIMESTAMP)
                    FROM users
                `),
                db.prepare("DROP TABLE users"),
                db.prepare("ALTER TABLE users_v41 RENAME TO users")
            ]).catch((e) => {
                console.error("[Users Table Auto-Migration Error]:", e.message);
            });
        }

        // 3. Ensure State Machine & Issue columns on stock_transfers & yarn_issues
        await ensureColumns(db, "stock_transfers", {
            product_id: "INTEGER",
            quantity: "REAL DEFAULT 0",
            status: "TEXT DEFAULT 'pending'",
            notes: "TEXT",
            created_by: "INTEGER",
            dispatched_by: "INTEGER",
            dispatched_at: "DATETIME",
            received_by: "INTEGER",
            received_at: "DATETIME",
            cancelled_by: "INTEGER",
            cancelled_at: "DATETIME",
            cancel_reason: "TEXT"
        });

        await ensureColumns(db, "yarn_issues", {
            reference_no: "TEXT",
            branch_id: "INTEGER DEFAULT 1",
            product_id: "INTEGER",
            issue_type: "TEXT DEFAULT 'ISSUE'",
            notes: "TEXT",
            status: "TEXT DEFAULT 'completed'"
        });

        // 4. Baseline existing branch_inventory into stock_movements (Spec 2.5)
        await db.prepare(`
            INSERT INTO stock_movements (
                branch_id, product_id, movement_type, quantity, effective_date,
                source_table, source_id, reason, created_by, approved_by, created_at
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
              )
        `).run().catch(() => {});

        // 5. Mark migrated branches with existing movements as having an Approved Opening Baseline
        await db.prepare(`
            INSERT INTO opening_stock_counts (
                branch_id, status, as_of_date, created_by, submitted_at, decided_by, decided_at, notes
            )
            SELECT 
                b.id,
                'approved',
                date('now', '+390 minutes'),
                COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1), 1),
                CURRENT_TIMESTAMP,
                COALESCE((SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1), 1),
                CURRENT_TIMESTAMP,
                'Legacy migration baseline'
            FROM branches b
            WHERE EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.branch_id = b.id)
              AND NOT EXISTS (SELECT 1 FROM opening_stock_counts osc WHERE osc.branch_id = b.id AND osc.status = 'approved')
        `).run().catch(() => {});

        await db.prepare(`
            INSERT OR REPLACE INTO schema_migrations (version, description, applied_at)
            VALUES ('0003_v4_1_full', 'Upgraded users table, stock_movements, opening_stock baseline & adjustments', CURRENT_TIMESTAMP)
        `).run().catch(() => {});

        schemaVerified = true;
    } catch (err) {
        console.error("[v4.1 Auto-Migration Error]:", err.message);
    }
}

// =============================================================================
// SECURITY & CRYPTO HELPERS (PBKDF2 Password Hashing & HMAC-SHA256 Token)
// =============================================================================

export function getJwtSecret(env) {
    if (env && env.JWT_SECRET && String(env.JWT_SECRET).trim().length >= 16) {
        return String(env.JWT_SECRET).trim();
    }
    if (env && env.ENVIRONMENT === "development" && env.ALLOW_DEV_SECRET === "true") {
        return "local-dev-only-jwt-secret-key-do-not-use-in-prod";
    }
    throw new HttpError(
        500,
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

const tokenVersionCache = new Map();
const TOKEN_CACHE_TTL_MS = 15000;

export function invalidateUserTokenCache(userId = null) {
    if (userId != null) {
        tokenVersionCache.delete(Number(userId));
    } else {
        tokenVersionCache.clear();
    }
}

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

    if (env && env.DB) {
        await ensureSchemaOnce(env.DB);

        const now = Date.now();
        const cached = tokenVersionCache.get(Number(payload.uid));
        let dbUser = null;

        if (cached && (now - cached.ts < TOKEN_CACHE_TTL_MS)) {
            dbUser = cached.data;
        } else {
            dbUser = await env.DB.prepare(
                "SELECT is_active, COALESCE(token_version, 1) AS tv, role, branch_id FROM users WHERE id = ?"
            ).bind(Number(payload.uid)).first().catch(() => null);
            if (dbUser) {
                tokenVersionCache.set(Number(payload.uid), { ts: now, data: dbUser });
            }
        }

        if (!dbUser || Number(dbUser.is_active) !== 1) return null;
        if (payload.tv != null && Number(dbUser.tv) !== Number(payload.tv)) {
            return null;
        }

        payload.role = normalizeRole(dbUser.role || payload.role);
        payload.branch_id = Number(dbUser.branch_id || payload.branch_id || 1);
    } else {
        payload.role = normalizeRole(payload.role);
        payload.branch_id = Number(payload.branch_id || 1);
    }

    return payload;
}
