// =============================================================================
// FILE 1 OF 5: cashbook-api/utils.js
// SHARED HELPERS, KYAT/QTY MATH, D1 SCHEMA GUARD & CRYPTO/JWT AUTH
// =============================================================================

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-Id",
    "Access-Control-Max-Age": "86400",
};

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
// ONE-TIME LAZY SCHEMA GUARD (D1 Write Quota မကုန်စေရန် ၁ ကြိမ်သာ စစ်မည်)
// =============================================================================
let schemaVerified = false;

export async function ensureSchemaOnce(db) {
    if (schemaVerified || !db) return;
    try {
        // 1. စနစ်သုံး ငွေစာရင်းခေါင်းစဉ်များ သေချာစေခြင်း
        await db.batch([
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (1, 'အထည်ရောင်းရငွေ (POS Sales)', 'INCOME', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (2, 'အကြွေးဟောင်းရငွေ (Debt Collection)', 'INCOME', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (6, 'ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ် (Trading Goods Purchase)', 'EXPENSE', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (10, 'ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ', 'EXPENSE', 1, 1)`),
            db.prepare(`INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) VALUES (11, 'ပွဲရုံအကြွေးဆပ်ငွေ (Supplier Debt Payment)', 'EXPENSE', 1, 1)`)
        ]).catch(() => {});

        // 2. customers ဇယားတွင် entity_type နှင့် current_payable ကော်လံများ သေချာစေခြင်း
        const custInfo = await db.prepare("PRAGMA table_info(customers)").all().catch(() => ({ results: [] }));
        const custCols = (custInfo.results || []).map(r => r.name.toLowerCase());
        if (custCols.length > 0) {
            if (!custCols.includes("entity_type")) {
                await db.prepare("ALTER TABLE customers ADD COLUMN entity_type TEXT DEFAULT 'CUSTOMER'").run().catch(() => {});
            }
            if (!custCols.includes("current_payable")) {
                await db.prepare("ALTER TABLE customers ADD COLUMN current_payable REAL DEFAULT 0").run().catch(() => {});
            }
        }

        // 3. purchases ဇယားတွင် supplier_id နှင့် purchase_date ကော်လံများ သေချာစေခြင်း
        const purInfo = await db.prepare("PRAGMA table_info(purchases)").all().catch(() => ({ results: [] }));
        const purCols = (purInfo.results || []).map(r => r.name.toLowerCase());
        if (purCols.length > 0) {
            if (!purCols.includes("supplier_id")) {
                await db.prepare("ALTER TABLE purchases ADD COLUMN supplier_id INTEGER REFERENCES customers(id)").run().catch(() => {});
            }
            if (!purCols.includes("purchase_date")) {
                await db.prepare("ALTER TABLE purchases ADD COLUMN purchase_date DATE").run().catch(() => {});
            }
        }

        // 4. stock_transfers ဇယားတွင် product_id, quantity, created_by ကော်လံများ သေချာစေခြင်း
        const trfInfo = await db.prepare("PRAGMA table_info(stock_transfers)").all().catch(() => ({ results: [] }));
        const trfCols = (trfInfo.results || []).map(r => r.name.toLowerCase());
        if (trfCols.length > 0 && !trfCols.includes("product_id")) {
            await db.prepare("ALTER TABLE stock_transfers ADD COLUMN product_id INTEGER REFERENCES products(id)").run().catch(() => {});
            await db.prepare("ALTER TABLE stock_transfers ADD COLUMN quantity REAL DEFAULT 0").run().catch(() => {});
            await db.prepare("ALTER TABLE stock_transfers ADD COLUMN created_by INTEGER REFERENCES users(id)").run().catch(() => {});
        }

        // 5. D1 Read Quota သက်သာစေမည့် အရေးကြီး Index များ သေချာစေခြင်း
        await db.batch([
            db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items(purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items(product_id, purchase_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id, sale_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_sale_id ON cashbook_entries(sale_id)"),
            db.prepare("CREATE INDEX IF NOT EXISTS idx_cashbook_purchase_id ON cashbook_entries(purchase_id)")
        ]).catch(() => {});

        schemaVerified = true;
    } catch {
        schemaVerified = true;
    }
}

// =============================================================================
// SECURITY & CRYPTO HELPERS (PBKDF2 Password Hashing & HMAC-SHA256 Token)
// =============================================================================

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
    const secret = env.JWT_SECRET || "mya-gabar-soe-garment-erp-secret-2026-key";
    return await verifyToken(token, secret);
}
