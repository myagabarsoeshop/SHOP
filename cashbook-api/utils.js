// =============================================================================
// FILE 1 OF 5: cashbook-api/utils.js
// SHARED HELPERS, KYAT/QTY MATH, FULL D1 AUTO-MIGRATION GUARD & CRYPTO/JWT AUTH
// Version: 3.2.0 (Includes users.plain_password Auto-Migration for Admin View)
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
export function configureRequestContext(request, env) {
    const reqOrigin = request.headers.get("Origin") || "";
    const allowedOrigin = (env && env.ALLOWED_ORIGIN) ? String(env.ALLOWED_ORIGIN).trim() : "";

    if (!reqOrigin) {
        corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin || "*";
        return;
    }

    const isLocal = reqOrigin.startsWith("http://localhost") || reqOrigin.startsWith("http://127.0.0.1");
    const isAllowedDomain =
        (allowedOrigin && reqOrigin === allowedOrigin) ||
        reqOrigin.endsWith(".pages.dev") ||
        reqOrigin.endsWith(".workers.dev");

    if (isLocal || isAllowedDomain) {
        corsHeaders["Access-Control-Allow-Origin"] = reqOrigin;
    } else {
        corsHeaders["Access-Control-Allow-Origin"] = allowedOrigin || "*";
    }
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

/**
 * မြန်မာစံတော်ချိန် (UTC+6:30) ဖြင့် YYYY-MM-DD ရယူခြင်း
 */
export function getMyanmarTodayDate() {
    const now = new Date(Date.now() + (6.5 * 60 * 60 * 1000));
    return now.toISOString().split("T")[0];
}

/**
 * ငွေပမာဏများကို Floating-point အမှားမပါစေရန် Kyat ကိန်းပြည့်သို့ နီးစပ်ရာယူခြင်း
 */
export function roundKyat(val) {
    if (typeof val === "string") {
        val = val.replace(/,/g, "").trim();
    }
    const num = parseFloat(val);
    return isNaN(num) ? 0 : Math.round(num);
}

/**
 * အရေအတွက် (Quantity) ကို ဒသမ ၃ နေရာအထိ တိကျစွာ ယူခြင်း (ပေါင်/ကိုက် နှင့် အထည် နှစ်မျိုးလုံးအတွက်)
 */
export function roundQty(val) {
    if (typeof val === "string") {
        val = val.replace(/,/g, "").trim();
    }
    const num = parseFloat(val);
    return isNaN(num) ? 0 : Math.round(num * 1000) / 1000;
}

// =============================================================================
// LOGIN BRUTE-FORCE RATE LIMITER
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

export function checkLoginRateLimit(request) {
    const ip = getClientIp(request);
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (!record) return { allowed: true };

    if (now - record.firstAttemptAt > LOCKOUT_WINDOW_MS) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }

    if (record.count >= MAX_LOGIN_ATTEMPTS) {
        const waitSec = Math.ceil((LOCKOUT_WINDOW_MS - (now - record.firstAttemptAt)) / 1000);
        return {
            allowed: false,
            waitSeconds: Math.max(1, waitSec)
        };
    }

    return { allowed: true };
}

export function recordLoginAttempt(request, isSuccess) {
    const ip = getClientIp(request);
    if (isSuccess) {
        loginAttempts.delete(ip);
        return;
    }

    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record || (now - record.firstAttemptAt > LOCKOUT_WINDOW_MS)) {
        loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
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
// ONE-TIME LAZY SCHEMA & COLUMN AUTO-MIGRATION GUARD
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
        // 1. အရေးကြီး ဇယားများ မရှိသေးပါက တည်ဆောက်ပေးခြင်း
        await db.batch([
            db.prepare(`
                CREATE TABLE IF NOT EXISTS supplier_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    supplier_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
                    type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    balance_after REAL NOT NULL,
                    payment_method TEXT,
                    bank_account_name TEXT,
                    reference_note TEXT,
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
                    amount REAL NOT NULL,
                    balance_after REAL NOT NULL,
                    payment_method TEXT,
                    bank_account_name TEXT,
                    reference_note TEXT,
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
                    unit_cost REAL NOT NULL DEFAULT 0,
                    reason TEXT NOT NULL,
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
                )
            `)
        ]).catch(() => {});

        // 2. စနစ်သုံး ငွေစာရင်းခေါင်းစဉ်များ သေချာစေခြင်း
        await db.batch([
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (1, 'အထည်ရောင်းရငွေ (POS Sales)', 'INCOME', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (2, 'အကြွေးဟောင်းရငွေ (Debt Collection)', 'INCOME', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (6, 'ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ် (Trading Goods Purchase)', 'EXPENSE', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (10, 'ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ', 'EXPENSE', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (11, 'ပွဲရုံအကြွေးဆပ်ငွေ (Supplier Debt Payment)', 'EXPENSE', 1, 1)`)
        ]).catch(() => {});

        // 3. users ဇယားတွင် Admin ကြည့်ရှုနိုင်ရန် plain_password ကော်လံ ထည့်သွင်းခြင်း
        await ensureColumns(db, "users", {
            plain_password: "TEXT"
        });

        // 4. ရှိပြီးသား ဇယားအဟောင်းများတွင် လိုအပ်နေသော ကော်လံအသစ်များ အလိုအလျောက် ထပ်ပေါင်းထည့်ပေးခြင်း
        await ensureColumns(db, "cashbook_entries", {
            sale_id: "INTEGER",
            purchase_id: "INTEGER",
            customer_ledger_id: "INTEGER",
            supplier_ledger_id: "INTEGER",
            bank_account_name: "TEXT",
            quantity: "REAL DEFAULT 1.0",
            unit_price: "REAL DEFAULT 0.0",
            diff_amount: "REAL DEFAULT 0.0",
            ref_no: "TEXT"
        });

        await ensureColumns(db, "customers", {
            shop_name: "TEXT",
            entity_type: "TEXT DEFAULT 'CUSTOMER'",
            customer_type: "TEXT DEFAULT 'retail'",
            credit_limit: "REAL DEFAULT 0.0",
            current_debt: "REAL DEFAULT 0.0",
            current_payable: "REAL DEFAULT 0.0",
            address: "TEXT",
            is_active: "INTEGER DEFAULT 1"
        });

        await ensureColumns(db, "purchases", {
            ref_no: "TEXT",
            supplier_id: "INTEGER",
            purchase_date: "DATE",
            items_total: "REAL DEFAULT 0.0",
            paid_amount: "REAL DEFAULT 0.0",
            diff_amount: "REAL DEFAULT 0.0",
            bank_account_name: "TEXT",
            notes: "TEXT",
            status: "TEXT DEFAULT 'completed'"
        });

        await ensureColumns(db, "sales", {
            cash_amount: "REAL DEFAULT 0.0",
            bank_amount: "REAL DEFAULT 0.0",
            bank_account_name: "TEXT",
            notes: "TEXT",
            status: "TEXT DEFAULT 'completed'"
        });

        await ensureColumns(db, "stock_transfers", {
            product_id: "INTEGER",
            quantity: "REAL DEFAULT 0",
            created_by: "INTEGER",
            notes: "TEXT"
        });

        await ensureColumns(db, "yarn_issues", {
            branch_id: "INTEGER",
            product_id: "INTEGER",
            notes: "TEXT"
        });

        // 5. D1 Read Quota သက်သာစေမည့် အရေးကြီး Index များ သေချာစေခြင်း
        await db.batch([
            db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id, purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id, sale_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_sale_id ON cashbook_entries(sale_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_purchase_id ON cashbook_entries(purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_supp_ledger ON cashbook_entries(supplier_ledger_id)")
        ]).catch(() => {});

        schemaVerified = true;
    } catch {
        schemaVerified = true;
    }
}

// =============================================================================
// SECURITY & CRYPTO HELPERS (PBKDF2 Password Hashing & HMAC-SHA256 Token)
// =============================================================================

let secretWarned = false;
export function getJwtSecret(env) {
    if (env && env.JWT_SECRET && String(env.JWT_SECRET).trim().length >= 16) {
        return String(env.JWT_SECRET).trim();
    }
    if (!secretWarned) {
        console.warn("[Security Notice] Using default JWT_SECRET fallback. Set `wrangler secret put JWT_SECRET` for production.");
        secretWarned = true;
    }
    return "mya-gabar-soe-garment-erp-secret-2026-key";
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
    if (!storedHash) return false;
    if (storedHash.startsWith("pbkdf2:")) {
        const parts = storedHash.split(":");
        if (parts.length !== 3) return false;
        const saltHex = parts[1];
        const expectedHash = parts[2];
        const computed = await hashPassword(password, saltHex);
        const computedHash = computed.split(":")[2];
        return timingSafeEqual(expectedHash, computedHash);
    }
    return storedHash === password || storedHash === `${password}_hash`;
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

export async function getAuthUser(request, env) {
    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7).trim();
    const secret = getJwtSecret(env);
    return await verifyToken(token, secret);
}
