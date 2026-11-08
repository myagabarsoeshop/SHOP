// =============================================================================
// GARMENT POS & CASHBOOK ALL-IN-ONE BACKEND (Cloudflare Worker)
// File: cashbook-api/worker.js (Phase 1 & 2 Completed: Secure Auth + D1 Fixed)
// =============================================================================

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-Id",
    "Access-Control-Max-Age": "86400",
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify({ success: true, data }), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json;charset=UTF-8",
            "Cache-Control": "no-store"
        }
    });
}

function errorResponse(message, status = 400) {
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
function getMyanmarTodayDate() {
    const now = new Date(Date.now() + (6.5 * 60 * 60 * 1000));
    return now.toISOString().split("T")[0];
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

async function hashPassword(password, saltHex = null) {
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

async function verifyPassword(password, storedHash) {
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

async function signToken(payload, secret, expiresInSeconds = 43200) {
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

async function verifyToken(token, secret) {
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

async function getAuthUser(request, env) {
    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7).trim();
    const secret = env.JWT_SECRET || "mya-gabar-soe-garment-erp-secret-2026-key";
    return await verifyToken(token, secret);
}

// =============================================================================
// MAIN WORKER HANDLER
// =============================================================================

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        if (!path.startsWith("/api")) {
            if (env && env.ASSETS) {
                return env.ASSETS.fetch(request);
            }
            return jsonResponse({
                status: "online",
                version: "2.8.2",
                note: "Frontend assets not bound."
            });
        }

        try {
            // 1. Health Check
            if (path === "/api/health" && method === "GET") {
                return jsonResponse({ status: "online", version: "2.8.2" });
            }

            // 2. Auth Login
            if (path === "/api/auth/login" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { username, password } = body;
                if (!username || !password) {
                    return errorResponse("အသုံးပြုသူအမည်နှင့် စကားဝှက် ထည့်သွင်းပေးပါ", 400);
                }

                const query = `
                    SELECT u.id, u.branch_id, u.username, u.full_name, u.role, u.password_hash,
                           b.code AS branch_code, b.name AS branch_name
                    FROM users u
                    LEFT JOIN branches b ON u.branch_id = b.id
                    WHERE LOWER(u.username) = LOWER(?) AND u.is_active = 1
                `;
                const user = await env.DB.prepare(query).bind(String(username).trim()).first();

                if (!user || !(await verifyPassword(String(password), user.password_hash))) {
                    return errorResponse("အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်", 401);
                }

                const secret = env.JWT_SECRET || "mya-gabar-soe-garment-erp-secret-2026-key";
                const token = await signToken({
                    uid: user.id,
                    username: user.username,
                    role: String(user.role || "cashier").toLowerCase(),
                    branch_id: user.branch_id || 1,
                    branch_code: user.branch_code || "MAIN"
                }, secret);

                return jsonResponse({
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        fullName: user.full_name || user.username,
                        role: String(user.role || "cashier").toLowerCase(),
                        branchId: user.branch_id || 1,
                        branchCode: user.branch_code || "MAIN",
                        branchName: user.branch_name || "Main Home Shop"
                    },
                    message: "Login အောင်မြင်ပါသည်"
                });
            }

            // =================================================================
            // PROTECTED ROUTE GATEWAY
            // =================================================================
            const auth = await getAuthUser(request, env);
            if (!auth) {
                return errorResponse("အကောင့်ဝင်ရောက်ထားခြင်း မရှိပါ သို့မဟုတ် Token သက်တမ်းကုန်ဆုံးသွားပါသည် (401 Unauthorized)", 401);
            }

            const currentUserId = auth.uid;
            const currentUserRole = auth.role;
            const userBranchId = auth.branch_id;

            if (method === "DELETE" && !["admin", "manager", "finance"].includes(currentUserRole)) {
                return errorResponse("ဤမှတ်တမ်းအား ဖျက်ပစ်ခွင့် မရှိပါ (Admin / Manager Role လိုအပ်ပါသည်)", 403);
            }

            // 2.1. Password Change
            if (path === "/api/auth/change-password" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { oldPassword, newPassword } = body;
                if (!oldPassword || !newPassword || String(newPassword).length < 6) {
                    return errorResponse("စကားဝှက်အသစ်သည် အနည်းဆုံး ၆ လုံး ရှိရပါမည်", 400);
                }

                const currentUser = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(currentUserId).first();
                if (!currentUser || !(await verifyPassword(oldPassword, currentUser.password_hash))) {
                    return errorResponse("မူလ စကားဝှက် မှားယွင်းနေပါသည်", 400);
                }

                const secureHash = await hashPassword(newPassword);
                await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(secureHash, currentUserId).run();
                return jsonResponse({ message: "စကားဝှက် အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ" });
            }

            // 1.1. System Setting & Email Backup (Admin Only)
            if (path === "/api/system/send-report-email" && method === "POST") {
                if (currentUserRole !== "admin") {
                    return errorResponse("စနစ် အစီရင်ခံစာ ပို့ဆောင်ခွင့်ကို စနစ်ပိုင်ရှင် (Admin) သာ ခွင့်ပြုပါသည်", 403);
                }

                const body = await request.json().catch(() => ({}));
                const targetYear = String(body.year || new Date().getFullYear());
                const targetEmail = body.email;

                if (!targetEmail) return errorResponse("အီးမေးလ်လိပ်စာ ထည့်သွင်းပေးပါ", 400);
                if (!env.RESEND_API_KEY) return errorResponse("Resend API Key ကို Server တွင် ထည့်သွင်းထားခြင်း မရှိသေးပါ", 500);

                const { results: products } = await env.DB.prepare(`
                    SELECT p.id, p.sku, p.category, p.item_name, p.pattern, p.size, p.color,
                           p.cost_price, p.retail_price, p.wholesale_price,
                           COALESCE(SUM(bi.quantity), 0) AS total_stock,
                           (COALESCE(SUM(bi.quantity), 0) * p.cost_price) AS total_value
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                    WHERE p.is_active = 1
                    GROUP BY p.id
                    ORDER BY p.category ASC, p.item_name ASC
                `).all();

                const { results: sales } = await env.DB.prepare(`
                    SELECT s.invoice_no, b.name AS branch_name, COALESCE(c.name, 'Walk-in') AS customer_name,
                           s.sale_type, s.payment_method, s.total_amount, s.discount_amount,
                           s.final_amount, s.paid_amount, s.debt_amount, s.created_at
                    FROM sales s
                    LEFT JOIN branches b ON s.branch_id = b.id
                    LEFT JOIN customers c ON s.customer_id = c.id
                    WHERE strftime('%Y', s.created_at) = ?
                    ORDER BY s.id DESC LIMIT 2000
                `).bind(targetYear).all();

                const { results: cashbook } = await env.DB.prepare(`
                    SELECT ce.entry_date, b.name AS branch_name, cc.name AS category_name,
                           ce.entry_type, ce.payment_method, ce.bank_account_name,
                           ce.amount, ce.description
                    FROM cashbook_entries ce
                    LEFT JOIN branches b ON ce.branch_id = b.id
                    LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                    WHERE strftime('%Y', ce.entry_date) = ?
                    ORDER BY ce.entry_date DESC, ce.id DESC LIMIT 3000
                `).bind(targetYear).all();

                const { results: customers } = await env.DB.prepare(`
                    SELECT name, phone, shop_name, customer_type, credit_limit, current_debt, address
                    FROM customers
                    WHERE is_active = 1
                    ORDER BY current_debt DESC, name ASC
                `).all();

                const { results: purchases } = await env.DB.prepare(`
                    SELECT p.purchase_no, b.name AS branch_name, p.supplier_name,
                           p.payment_method, p.total_amount, p.status, p.created_at
                    FROM purchases p
                    LEFT JOIN branches b ON p.branch_id = b.id
                    WHERE strftime('%Y', p.created_at) = ?
                    ORDER BY p.id DESC LIMIT 1000
                `).bind(targetYear).all();

                const { results: yarns } = await env.DB.prepare(`
                    SELECT p.sku, p.item_name, p.color, p.size AS unit, p.cost_price,
                           COALESCE(SUM(bi.quantity), 0) AS current_stock
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                    WHERE p.is_active = 1 AND (p.category = 'ချည်' OR p.category LIKE 'ချည်%')
                    GROUP BY p.id
                    ORDER BY p.id DESC
                `).all();

                let waste = [];
                try {
                    const resW = await env.DB.prepare(`
                        SELECT w.reference_no, b.name AS branch_name, p.item_name, p.sku,
                               w.quantity, w.unit_cost, (w.quantity * w.unit_cost) AS total_loss,
                               w.reason, w.created_at
                        FROM waste_logs w
                        LEFT JOIN branches b ON w.branch_id = b.id
                        LEFT JOIN products p ON w.product_id = p.id
                        WHERE strftime('%Y', w.created_at) = ?
                        ORDER BY w.id DESC
                    `).bind(targetYear).all();
                    waste = resW.results || [];
                } catch {
                    waste = [];
                }

                const cleanXml = (val) => String(val ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
                const buildSheet = (sheetName, headers, rows) => {
                    let xml = `<Worksheet ss:Name="${cleanXml(sheetName)}"><Table>`;
                    xml += `<Row ss:StyleID="Header">`;
                    headers.forEach(h => { xml += `<Cell><Data ss:Type="String">${cleanXml(h)}</Data></Cell>`; });
                    xml += `</Row>`;
                    rows.forEach(r => {
                        xml += `<Row>`;
                        r.forEach(c => {
                            const isNum = typeof c === 'number' || (!isNaN(c) && c !== "" && typeof c !== 'string');
                            const type = isNum ? "Number" : "String";
                            xml += `<Cell><Data ss:Type="${type}">${cleanXml(c)}</Data></Cell>`;
                        });
                        xml += `</Row>`;
                    });
                    xml += `</Table></Worksheet>`;
                    return xml;
                };

                let workbookXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#064E3B" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
  </Style>
 </Styles>
`;
                workbookXml += buildSheet("Products", ["ID", "SKU", "အမျိုးအစား", "ပစ္စည်းအမည်", "ဒီဇိုင်း/အဆင်", "ဆိုဒ်", "အရောင်", "အရင်းဈေး", "လက်လီဈေး", "လက်ကားဈေး", "လက်ကျန်အရေအတွက်", "စုစုပေါင်းတန်ဖိုး (Ks)"], (products || []).map(p => [p.id, p.sku, p.category, p.item_name, p.pattern, p.size, p.color, p.cost_price, p.retail_price, p.wholesale_price, p.total_stock, p.total_value]));
                workbookXml += buildSheet("Sales", ["ဘောင်ချာအမှတ်", "ဆိုင်ခွဲ", "ဖောက်သည်", "အရောင်းအမျိုးအစား", "ငွေပေးချေမှု", "စုစုပေါင်း", "လျှော့ဈေး", "ကျသင့်ငွေ", "ပေးချေငွေ", "အကြွေးကျန်", "ရက်စွဲ"], (sales || []).map(s => [s.invoice_no, s.branch_name, s.customer_name, s.sale_type, s.payment_method, s.total_amount, s.discount_amount, s.final_amount, s.paid_amount, s.debt_amount, s.created_at]));
                workbookXml += buildSheet("Cashbook", ["ရက်စွဲ", "ဆိုင်ခွဲ", "ခေါင်းစဉ်", "အမျိုးအစား (IN/OUT)", "ငွေပေးချေမှု", "ဘဏ်အကောင့်", "ပမာဏ (Ks)", "အကြောင်းအရာ"], (cashbook || []).map(c => [c.entry_date, c.branch_name, c.category_name, c.entry_type, c.payment_method, c.bank_account_name, c.amount, c.description]));
                workbookXml += buildSheet("Customers", ["အမည်", "ဖုန်းနံပါတ်", "ဆိုင်အမည်", "အမျိုးအစား", "အကြွေးကန့်သတ်ချက်", "လက်ရှိပေးရန်ကျန်ငွေ (Ks)", "လိပ်စာ"], (customers || []).map(c => [c.name, c.phone, c.shop_name, c.customer_type, c.credit_limit, c.current_debt, c.address]));
                workbookXml += buildSheet("Purchases", ["အဝယ်အမှတ်", "ဆိုင်ခွဲ", "ကုန်သည်/ဆိုင်အမည်", "ငွေပေးချေမှု", "စုစုပေါင်းကျသင့်ငွေ (Ks)", "အခြေအနေ", "ရက်စွဲ"], (purchases || []).map(p => [p.purchase_no, p.branch_name, p.supplier_name, p.payment_method, p.total_amount, p.status, p.created_at]));
                workbookXml += buildSheet("Yarn", ["ကုတ်", "ချည်အမည်", "အရောင်", "ယူနစ်", "အရင်းဈေး", "လက်ကျန်စတော့"], (yarns || []).map(y => [y.sku, y.item_name, y.color, y.unit, y.cost_price, y.current_stock]));
                workbookXml += buildSheet("Waste", ["မှတ်တမ်းအမှတ်", "ဆိုင်ခွဲ", "ပစ္စည်းအမည်", "SKU", "ပျက်စီးအရေအတွက်", "တစ်ခုအရင်း", "ဆုံးရှုံးမှုတန်ဖိုး (Ks)", "အကြောင်းရင်း", "ရက်စွဲ"], (waste || []).map(w => [w.reference_no, w.branch_name, w.item_name, w.sku, w.quantity, w.unit_cost, w.total_loss, w.reason, w.created_at]));
                workbookXml += `</Workbook>`;

                const utf8Bytes = new TextEncoder().encode(workbookXml);
                let binaryStr = "";
                const chunkSize = 8192;
                for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
                    binaryStr += String.fromCharCode.apply(null, utf8Bytes.subarray(i, i + chunkSize));
                }
                const base64Excel = btoa(binaryStr);

                const resendResponse = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        from: "Garment ERP <onboarding@resend.dev>",
                        to: [targetEmail],
                        subject: `မြကမ္ဘာစိုး ပိုးထည်တိုက် - All-in-One Database Backup Report (${targetYear})`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 24px; color: #1e293b; background-color: #f8fafc; border-radius: 12px; max-width: 650px; margin: auto;">
                                <h2 style="color: #064e3b; margin: 0 0 10px 0;">မြကမ္ဘာစိုး ပိုးထည်တိုက် (GARMENT ERP)</h2>
                                <p style="font-size: 14px;"><b>${targetYear} ခုနှစ်</b> အတွက် Cloudflare D1 Database စနစ်တစ်ခုလုံး၏ ဇယားများကို ပူးတွဲတင်ပြအပ်ပါသည်။</p>
                                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                                <p style="font-size: 11px; color: #94a3b8;">Admin အသုံးပြုသူ ${auth.username} မှ တောင်းဆိုထားသော စနစ်အစီရင်ခံစာ ဖြစ်ပါသည်။</p>
                            </div>
                        `,
                        attachments: [
                            {
                                filename: `Garment_ERP_Full_Backup_${targetYear}.xls`,
                                content: base64Excel
                            }
                        ]
                    })
                });

                const resendData = await resendResponse.json();
                if (!resendResponse.ok) {
                    return errorResponse(resendData.message || "Failed to send email via Resend", 500);
                }
                return jsonResponse({ success: true, message: "Multi-sheet Excel report sent successfully", data: resendData });
            }

            // 3. Branches
            if (path === "/api/branches" && method === "GET") {
                const { results } = await env.DB.prepare(
                    "SELECT id, code, name, type, phone, address FROM branches WHERE is_active = 1 ORDER BY id ASC"
                ).all();
                return jsonResponse(results || []);
            }

            // 4. Products & Stock
            if (path === "/api/products" && method === "GET") {
                const branchId = url.searchParams.get("branch_id");
                const search = url.searchParams.get("search")?.trim() || "";
                const category = url.searchParams.get("category")?.trim() || "";

                // COALESCE တွင် branchId ရှိက ထိုဆိုင်၏ လက်ကျန်၊ မရှိပါက (Product Master အတွက်) ဆိုင်အားလုံးပေါင်း စုစုပေါင်းလက်ကျန် (SUM) ကို ပြသမည်
                let sql = `
                    SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                           p.cost_price, p.retail_price, p.wholesale_price, p.alert_quantity,
                           COALESCE(
                               (
                                   SELECT ${branchId ? "bi.quantity" : "SUM(bi.quantity)"} 
                                   FROM branch_inventory bi 
                                   WHERE bi.product_id = p.id 
                                   ${branchId ? "AND bi.branch_id = ?" : ""}
                               ), 0
                           ) AS current_stock
                    FROM products p
                `;
                
                const bindings = [];
                if (branchId) {
                    bindings.push(branchId);
                }

                sql += " WHERE p.is_active = 1 ";
                
                if (search) {
                    sql += " AND (p.barcode = ? OR p.sku LIKE ? OR p.item_name LIKE ? OR p.pattern LIKE ? OR p.color LIKE ? OR p.category LIKE ?) ";
                    bindings.push(search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
                }
                
                if (category) {
                    sql += " AND p.category = ? ";
                    bindings.push(category);
                }
                
                sql += " ORDER BY p.item_name ASC, p.id DESC LIMIT 1000";
                
                const { results } = await env.DB.prepare(sql).bind(...bindings).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/products/scan" && method === "GET") {
                const code = url.searchParams.get("code")?.trim();
                const branchId = url.searchParams.get("branch_id") || userBranchId;
                if (!code) return errorResponse("Barcode ထည့်သွင်းပေးပါ", 400);

                const sql = `
                    SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                           p.cost_price, p.retail_price, p.wholesale_price, COALESCE(bi.quantity, 0) AS current_stock
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                    WHERE (p.barcode = ? OR p.sku = ?) AND p.is_active = 1 LIMIT 1
                `;
                const product = await env.DB.prepare(sql).bind(Number(branchId), code, code).first();
                if (!product) return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);
                return jsonResponse(product);
            }

            if (path === "/api/products" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const itemName = body.itemName || body.item_name;
                if (!body.category || !itemName) {
                    return errorResponse("အမျိုးအစားနှင့် ပစ္စည်းအမည် ထည့်သွင်းပေးပါ", 400);
                }

                const sku = body.sku ? String(body.sku).trim() : null;
                const barcode = body.barcode ? String(body.barcode).trim() : null;
                const costPrice = parseFloat(body.costPrice ?? body.cost_price) || 0;
                const retailPrice = parseFloat(body.retailPrice ?? body.retail_price) || 0;
                const wholesalePrice = parseFloat(body.wholesalePrice ?? body.wholesale_price ?? retailPrice) || 0;
                const initialStock = parseFloat(body.initialStock ?? body.quantity ?? 0) || 0;
                const targetBranchId = parseInt(body.targetBranchId ?? body.branchId ?? userBranchId, 10) || 1;

                const res = await env.DB.prepare(`
                    INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    sku, barcode, String(body.category).trim(), String(itemName).trim(),
                    body.pattern ? String(body.pattern).trim() : null,
                    body.size ? String(body.size).trim() : "ထည်",
                    body.color ? String(body.color).trim() : null,
                    costPrice, retailPrice, wholesalePrice
                ).run();

                const newProductId = res.meta.last_row_id;
                if (initialStock > 0) {
                    await env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity
                    `).bind(targetBranchId, newProductId, initialStock).run();
                }

                return jsonResponse({ id: newProductId, message: "အထည်အသစ် သိမ်းဆည်းပြီးပါပြီ" }, 201);
            }

            if (path.startsWith("/api/products/") && method === "PUT") {
                const productId = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));

                await env.DB.prepare(`
                    UPDATE products SET
                        sku = COALESCE(?, sku),
                        barcode = COALESCE(?, barcode),
                        category = COALESCE(?, category),
                        item_name = COALESCE(?, item_name),
                        pattern = COALESCE(?, pattern),
                        size = COALESCE(?, size),
                        color = COALESCE(?, color),
                        cost_price = COALESCE(?, cost_price),
                        retail_price = COALESCE(?, retail_price),
                        wholesale_price = COALESCE(?, wholesale_price)
                    WHERE id = ?
                `).bind(
                    body.sku ?? null, body.barcode ?? null, body.category ?? null,
                    body.itemName ?? body.item_name ?? null, body.pattern ?? null,
                    body.size ?? null, body.color ?? null,
                    body.costPrice !== undefined ? parseFloat(body.costPrice) : null,
                    body.retailPrice !== undefined ? parseFloat(body.retailPrice) : null,
                    body.wholesalePrice !== undefined ? parseFloat(body.wholesalePrice) : null,
                    productId
                ).run();

                if (body.quantity !== undefined && (body.branchId || userBranchId)) {
                    await env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = excluded.quantity
                    `).bind(Number(body.branchId || userBranchId), productId, parseFloat(body.quantity) || 0).run();
                }

                return jsonResponse({ message: "ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ" });
            }

            if (path.startsWith("/api/products/") && method === "DELETE") {
                const productId = Number(path.split("/").pop());
                if (!productId) return errorResponse("Product ID မမှန်ကန်ပါ", 400);

                await env.DB.prepare("UPDATE products SET is_active = 0 WHERE id = ?").bind(productId).run();
                return jsonResponse({ message: "အထည်စာရင်းမှ အောင်မြင်စွာ ဖျက်ပြီးပါပြီ" });
            }

            // =================================================================
            // 5. PURCHASES & STOCK IN (AUTO SUPPLIER REGISTRATION & PAYABLES SYNC)
            // =================================================================
            if (path === "/api/purchases" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || userBranchId;

                const sql = `
                    SELECT 
                        pi.id AS item_row_id,
                        p.id AS purchase_id,
                        p.purchase_no,
                        p.purchase_no AS vr_no,
                        p.ref_no,
                        p.supplier_name,
                        COALESCE(p.items_total, p.total_amount, 0) AS items_total,
                        p.total_amount,
                        COALESCE(p.paid_amount, p.total_amount, 0) AS paid_amount,
                        COALESCE(p.diff_amount, 0) AS diff_amount,
                        p.payment_method,
                        p.bank_account_name,
                        p.status,
                        p.created_at,
                        pi.product_id,
                        pi.quantity,
                        pi.unit_cost,
                        pi.subtotal,
                        pr.sku,
                        pr.barcode,
                        pr.category,
                        pr.item_name,
                        pr.pattern,
                        pr.size,
                        pr.color,
                        pr.retail_price,
                        pr.wholesale_price
                    FROM purchases p
                    INNER JOIN purchase_items pi ON p.id = pi.purchase_id
                    INNER JOIN products pr ON pi.product_id = pr.id
                    WHERE p.branch_id = ?
                    ORDER BY p.id DESC, pi.id DESC LIMIT 300
                `;
                const { results } = await env.DB.prepare(sql).bind(Number(branchId)).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/purchases" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const targetBranch = currentUserRole === "cashier" ? userBranchId : Number(body.branch_id || userBranchId);
                const supplierName = String(body.supplier_name || "").trim();

                if (!supplierName) return errorResponse("ပေးသွင်းသူ (ပွဲရုံ) အမည် လိုအပ်ပါသည်", 400);

                // ၁။ VR NO အား DDMMYY-01 ပုံစံဖြင့် Auto Sequence ထုတ်ယူခြင်း
                const mmToday = getMyanmarTodayDate(); // YYYY-MM-DD
                const [yyyy, mth, day] = mmToday.split("-");
                const prefix = `${day}${mth}${yyyy.slice(-2)}`;

                const lastPo = await env.DB.prepare(
                    "SELECT purchase_no FROM purchases WHERE purchase_no LIKE ? AND branch_id = ? ORDER BY id DESC LIMIT 1"
                ).bind(`${prefix}-%`, targetBranch).first();

                let nextSeq = "01";
                if (lastPo && lastPo.purchase_no) {
                    const parts = lastPo.purchase_no.split("-");
                    const lastNum = parseInt(parts[parts.length - 1], 10);
                    if (!isNaN(lastNum)) {
                        nextSeq = String(lastNum + 1).padStart(2, "0");
                    }
                }
                const purchaseNo = `${prefix}-${nextSeq}`;
                const refNo = body.ref_no ? String(body.ref_no).trim() : null;

                // ၂။ ပစ္စည်းပေါင်းလဒ်၊ အမှန်ပေးငွေ နှင့် ကွာခြားချက် တွက်ချက်ခြင်း
                const itemsList = body.items || [];
                const itemsTotal = itemsList.reduce((acc, it) => acc + (parseFloat(it.subtotal) || (parseFloat(it.quantity || 0) * parseFloat(it.unit_cost || 0))), 0);
                
                const rawMethod = String(body.payment_method || "cash").toLowerCase();
                let paidAmount = 0;
                if (rawMethod === "credit") {
                    paidAmount = 0;
                } else if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== "") {
                    paidAmount = parseFloat(body.paid_amount);
                } else {
                    paidAmount = parseFloat(body.total_amount || itemsTotal);
                }

                const diffAmount = body.diff_amount !== undefined && body.diff_amount !== null && body.diff_amount !== "" 
                    ? parseFloat(body.diff_amount) 
                    : (paidAmount - itemsTotal);

                const finalPaymentMethod = paidAmount === 0 ? "credit" : rawMethod;

                // ၃။ ပွဲရုံအမည်အား customers ဇယားတွင် ရှိ/မရှိ စစ်ဆေးပြီး မရှိပါက Auto-Register ပြုလုပ်ပေးခြင်း
                let supplierRecord = await env.DB.prepare(
                    "SELECT id, current_payable FROM customers WHERE name = ? OR shop_name = ? LIMIT 1"
                ).bind(supplierName, supplierName).first();

                let supplierId = supplierRecord?.id;
                const payableToAdd = diffAmount < 0 ? Math.abs(diffAmount) : (finalPaymentMethod === "credit" ? itemsTotal : 0);

                if (!supplierRecord) {
                    const suppInsertRes = await env.DB.prepare(`
                        INSERT INTO customers (name, shop_name, entity_type, customer_type, current_debt, current_payable)
                        VALUES (?, ?, 'SUPPLIER', 'wholesale', 0, ?)
                    `).bind(supplierName, supplierName, payableToAdd).run().catch(() => null);

                    supplierId = suppInsertRes?.meta?.last_row_id;
                } else if (payableToAdd > 0) {
                    await env.DB.prepare(
                        "UPDATE customers SET current_payable = COALESCE(current_payable, 0) + ? WHERE id = ?"
                    ).bind(payableToAdd, supplierId).run().catch(() => {});
                }

                // ၄။ purchases ဇယားထဲသို့ မှတ်တမ်းတင်ခြင်း
                const purRes = await env.DB.prepare(`
                    INSERT INTO purchases (
                        purchase_no, ref_no, branch_id, supplier_name, 
                        items_total, total_amount, paid_amount, diff_amount, 
                        payment_method, bank_account_name, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    purchaseNo, refNo, targetBranch, supplierName,
                    itemsTotal, itemsTotal, paidAmount, diffAmount,
                    finalPaymentMethod, body.bank_account_name || null, currentUserId
                ).run();

                const newPurId = purRes.meta.last_row_id;
                const batchStatements = [];

                // ၅။ ပေးရန်ကျန်ငွေရှိပါက supplier_ledger သို့ စာရင်းသွင်းခြင်း
                if (payableToAdd > 0 && supplierId) {
                    batchStatements.push(
                        env.DB.prepare(`
                            INSERT INTO supplier_ledger (supplier_id, branch_id, purchase_id, type, amount, balance_after, payment_method, reference_note, created_by)
                            VALUES (?, ?, ?, 'PURCHASE_DEBT', ?, (SELECT COALESCE(current_payable, 0) FROM customers WHERE id = ?), ?, ?, ?)
                        `).bind(
                            supplierId, targetBranch, newPurId, payableToAdd, supplierId,
                            finalPaymentMethod, `အဝယ်ဘောင်ချာ ${purchaseNo}${refNo ? ` (Ref: ${refNo})` : ''}`, currentUserId
                        )
                    );
                }

                // ၆။ ပစ္စည်းများနှင့် စတော့ အဝင်မှတ်တမ်းတင်ခြင်း
                for (const item of itemsList) {
                    let targetProductId = item.product_id;

                    if (item.is_new && item.new_product) {
                        const np = item.new_product;
                        const prodRes = await env.DB.prepare(`
                            INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).bind(
                            np.sku || null, null, String(np.category), String(np.item_name),
                            np.pattern || null, np.size || "ထည်", np.color || null,
                            parseFloat(item.unit_cost), parseFloat(item.retail_price), parseFloat(item.wholesale_price)
                        ).run();

                        targetProductId = prodRes.meta.last_row_id;
                    } else {
                        batchStatements.push(
                            env.DB.prepare(`
                                UPDATE products SET cost_price = ?, retail_price = ?, wholesale_price = ? WHERE id = ?
                            `).bind(parseFloat(item.unit_cost), parseFloat(item.retail_price), parseFloat(item.wholesale_price), Number(targetProductId))
                        );
                    }

                    const q = parseFloat(item.quantity) || 0;
                    const c = parseFloat(item.unit_cost) || 0;
                    const sub = q * c;

                    batchStatements.push(
                        env.DB.prepare(`INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)`)
                        .bind(newPurId, Number(targetProductId), q, c, sub)
                    );

                    batchStatements.push(
                        env.DB.prepare(`
                            INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                            VALUES (?, ?, ?)
                            ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                            quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                        `).bind(targetBranch, Number(targetProductId), q)
                    );
                }

                // ၇။ အမှန်တကယ် ပေးခဲ့သော ငွေရှိပါက Cash Book တွင် စာရင်းသွင်းခြင်း
                if (paidAmount > 0) {
                    const cbRefNo = refNo || purchaseNo;
                    const cbDesc = supplierName;

                    batchStatements.push(
                        env.DB.prepare(`
                            INSERT INTO cashbook_entries (
                                branch_id, category_id, purchase_id, entry_type, 
                                payment_method, bank_account_name, amount, diff_amount, 
                                ref_no, description, entry_date, created_by
                            ) VALUES (?, 6, ?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)
                        `).bind(
                            targetBranch, newPurId, finalPaymentMethod,
                            body.bank_account_name || null, paidAmount, diffAmount,
                            cbRefNo, cbDesc, mmToday, currentUserId
                        )
                    );
                }

                if (batchStatements.length > 0) {
                    await env.DB.batch(batchStatements);
                }

                return jsonResponse({ message: "အဝယ်စာရင်းနှင့် စတော့အဝင် အောင်မြင်ပါသည်။", purchaseNo }, 201);
            }

            // 5.1. PURCHASES UPDATE
            if (path.startsWith("/api/purchases/") && method === "PUT") {
                const purId = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                const supplierName = String(body.supplier_name || "").trim();
                const refNo = body.ref_no ? String(body.ref_no).trim() : null;
                const itemsList = body.items || [];

                if (!purId || itemsList.length === 0) {
                    return errorResponse("အဝယ်မှတ်တမ်း ID နှင့် ပစ္စည်းများ လိုအပ်ပါသည်", 400);
                }

                const oldPur = await env.DB.prepare("SELECT branch_id, purchase_no FROM purchases WHERE id = ?").bind(purId).first();
                if (!oldPur) return errorResponse("အဝယ်မှတ်တမ်း ရှာမတွေ့ပါ", 404);
                const branchId = oldPur.branch_id;

                const { results: oldItems } = await env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId).all();
                const batch = [];

                (oldItems || []).forEach(it => {
                    batch.push(
                        env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ? WHERE branch_id = ? AND product_id = ?")
                            .bind(parseFloat(it.quantity), Number(branchId), Number(it.product_id))
                    );
                });

                batch.push(env.DB.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").bind(purId));

                let newItemsTotal = 0;
                for (const it of itemsList) {
                    const q = parseFloat(it.quantity) || 0;
                    const c = parseFloat(it.unit_cost) || 0;
                    const sub = q * c;
                    newItemsTotal += sub;

                    batch.push(
                        env.DB.prepare("INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)")
                            .bind(purId, Number(it.product_id), q, c, sub)
                    );

                    batch.push(
                        env.DB.prepare(`
                            INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                            ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity
                        `).bind(Number(branchId), Number(it.product_id), q)
                    );
                }

                const rawMethod = String(body.payment_method || "cash").toLowerCase();
                let newPaidAmount = 0;
                if (rawMethod === "credit") {
                    newPaidAmount = 0;
                } else if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== "") {
                    newPaidAmount = parseFloat(body.paid_amount);
                } else {
                    newPaidAmount = parseFloat(body.total_amount || newItemsTotal);
                }

                const newDiffAmount = body.diff_amount !== undefined && body.diff_amount !== null && body.diff_amount !== ""
                    ? parseFloat(body.diff_amount)
                    : (newPaidAmount - newItemsTotal);

                const finalPaymentMethod = newPaidAmount === 0 ? "credit" : rawMethod;

                batch.push(
                    env.DB.prepare(`
                        UPDATE purchases SET 
                            supplier_name = ?, ref_no = ?, items_total = ?, total_amount = ?, 
                            paid_amount = ?, diff_amount = ?, payment_method = ?, bank_account_name = ? 
                        WHERE id = ?
                    `).bind(
                        supplierName, refNo, newItemsTotal, newItemsTotal, 
                        newPaidAmount, newDiffAmount, finalPaymentMethod, 
                        body.bank_account_name || null, purId
                    )
                );

                batch.push(env.DB.prepare("DELETE FROM cashbook_entries WHERE purchase_id = ?").bind(purId));

                if (newPaidAmount > 0) {
                    const mmToday = getMyanmarTodayDate();
                    const cbRefNo = refNo || oldPur.purchase_no;
                    const cbDesc = supplierName;

                    batch.push(
                        env.DB.prepare(`
                            INSERT INTO cashbook_entries (
                                branch_id, category_id, purchase_id, entry_type, 
                                payment_method, bank_account_name, amount, diff_amount, 
                                ref_no, description, entry_date, created_by
                            ) VALUES (?, 6, ?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)
                        `).bind(
                            Number(branchId), purId, finalPaymentMethod, 
                            body.bank_account_name || null, newPaidAmount, newDiffAmount, 
                            cbRefNo, cbDesc, mmToday, currentUserId
                        )
                    );
                }

                await env.DB.batch(batch);
                return jsonResponse({ message: "အဝယ်စာရင်း ပြင်ဆင်ပြီး စတော့နှင့် ငွေစာရင်း ပြန်လည်ညှိနှိုင်းပြီးပါပြီ" });
            }

            // 5.2. PURCHASES DELETE
            if (path.startsWith("/api/purchases/") && method === "DELETE") {
                const purId = Number(path.split("/").pop());

                const { results: items } = await env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId).all();
                const pur = await env.DB.prepare("SELECT branch_id FROM purchases WHERE id = ?").bind(purId).first();
                const branchId = pur?.branch_id || userBranchId;

                const batchRollback = [];
                (items || []).forEach(it => {
                    batchRollback.push(
                        env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ? WHERE branch_id = ? AND product_id = ?")
                            .bind(parseFloat(it.quantity), Number(branchId), Number(it.product_id))
                    );
                });

                batchRollback.push(env.DB.prepare("DELETE FROM cashbook_entries WHERE purchase_id = ?").bind(purId));
                batchRollback.push(env.DB.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").bind(purId));
                batchRollback.push(env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(purId));

                await env.DB.batch(batchRollback);
                return jsonResponse({ message: "အဝယ်စာရင်း ဖျက်သိမ်းပြီး စတော့နှင့် ငွေစာရင်း ပြန်ညှိပြီးပါပြီ။" });
            }
            
            // =================================================================
            // 6. DAMAGE & WASTE LOGS
            // =================================================================
            if (path === "/api/waste" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || userBranchId;

                // ဇယားမရှိသေးပါက အလိုအလျောက် တည်ဆောက်ပေးမည်
                await env.DB.prepare(`
                    CREATE TABLE IF NOT EXISTS waste_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        reference_no TEXT NOT NULL UNIQUE,
                        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                        quantity REAL NOT NULL,
                        unit_cost REAL NOT NULL DEFAULT 0,
                        reason TEXT,
                        recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                `).run().catch(() => {});

                const sql = `
                    SELECT 
                        w.id, w.reference_no, w.branch_id, w.product_id, w.quantity, w.unit_cost, w.reason, w.created_at,
                        p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                        COALESCE(u.full_name, 'Admin') AS recorded_by_name
                    FROM waste_logs w
                    INNER JOIN products p ON w.product_id = p.id
                    LEFT JOIN users u ON w.recorded_by = u.id
                    WHERE w.branch_id = ?
                    ORDER BY w.id DESC LIMIT 300
                `;
                const { results } = await env.DB.prepare(sql).bind(Number(branchId)).all().catch(() => ({ results: [] }));
                return jsonResponse(results || []);
            }

            if (path === "/api/waste" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = currentUserRole === "cashier" ? userBranchId : Number(body.branch_id || userBranchId);
                const productId = Number(body.product_id || body.productId);
                const quantity = parseFloat(body.quantity);
                const unitCost = parseFloat(body.unit_cost ?? body.unitCost) || 0;
                const reason = String(body.reason || "").trim();

                if (!branchId || !productId || isNaN(quantity) || quantity <= 0) {
                    return errorResponse("ဆိုင်ခွဲ၊ ပစ္စည်းနှင့် ပျက်စီးပမာဏ မှန်ကန်စွာ ထည့်သွင်းပေးပါ", 400);
                }

                const inv = await env.DB.prepare(`
                    SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?
                `).bind(branchId, productId).first().catch(() => null);

                const currentStock = Number(inv?.quantity || 0);
                if (currentStock < quantity) {
                    return errorResponse(`လက်ကျန်စတော့ (${currentStock}) ထက် ပိုမို၍ ပျက်စီးစာရင်း သွင်း၍မရပါ`, 400);
                }

                const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
                const refNo = `WST-${branchId}-${dateStr}`;

                const batchStatements = [
                    env.DB.prepare(`
                        INSERT INTO waste_logs (reference_no, branch_id, product_id, quantity, unit_cost, reason, recorded_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).bind(refNo, branchId, productId, quantity, unitCost, reason || "ချည်/အထည် ပျက်စီးအလေအလွင့်", currentUserId),

                    env.DB.prepare(`
                        UPDATE branch_inventory 
                        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE branch_id = ? AND product_id = ?
                    `).bind(quantity, branchId, productId)
                ];

                try {
                    await env.DB.batch(batchStatements);
                    return jsonResponse({ message: "အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။", refNo }, 201);
                } catch (e) {
                    return errorResponse("ဒေတာသိမ်းဆည်းရာတွင် အမှားအယွင်းဖြစ်ပေါ်ခဲ့ပါသည်: " + e.message, 500);
                }
            }

            if (path.startsWith("/api/waste/") && method === "PUT") {
                const id = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                const newQty = parseFloat(body.quantity);
                const reason = String(body.reason || "").trim();
                const unitCost = body.unit_cost !== undefined ? parseFloat(body.unit_cost) : null;

                if (!id || isNaN(newQty) || newQty <= 0) {
                    return errorResponse("မှန်ကန်သော အရေအတွက်/ပမာဏ ထည့်သွင်းပါ", 400);
                }

                const oldLog = await env.DB.prepare("SELECT branch_id, product_id, quantity, unit_cost FROM waste_logs WHERE id = ?").bind(id).first().catch(() => null);
                if (!oldLog) return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

                const diff = Math.round((Number(oldLog.quantity) - newQty) * 1000) / 1000;
                
                // အရေအတွက် ပိုတိုးလာပါက (စတော့ထဲမှ ထပ်နှုတ်ရမည်ဖြစ်သဖြင့် စတော့အလုံအလောက်ရှိမရှိ စစ်ဆေးခြင်း)
                if (diff < 0) {
                    const inv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(oldLog.branch_id), Number(oldLog.product_id)).first().catch(() => null);
                    const currentStock = Number(inv?.quantity || 0);
                    if (currentStock + diff < 0) {
                        return errorResponse(`လက်ကျန်စတော့ မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
                    }
                }

                const finalUnitCost = unitCost !== null ? unitCost : Number(oldLog.unit_cost || 0);

                const batchStatements = [
                    env.DB.prepare("UPDATE waste_logs SET quantity = ?, unit_cost = ?, reason = ? WHERE id = ?")
                        .bind(newQty, finalUnitCost, reason, id),
                    env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                        .bind(diff, Number(oldLog.branch_id), Number(oldLog.product_id))
                ];

                try {
                    await env.DB.batch(batchStatements);
                    return jsonResponse({ message: "အလေအလွင့်စာရင်း ပြင်ဆင်ပြီး စတော့လက်ကျန် ပြန်ညှိပြီးပါပြီ။" });
                } catch (e) {
                    return errorResponse("ပြင်ဆင်ခြင်း မအောင်မြင်ပါ: " + e.message, 500);
                }
            }

            if (path.startsWith("/api/waste/") && method === "DELETE") {
                const id = Number(path.split("/").pop());
                const oldLog = await env.DB.prepare("SELECT branch_id, product_id, quantity FROM waste_logs WHERE id = ?").bind(id).first().catch(() => null);
                if (!oldLog) return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

                const batchStatements = [
                    env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(oldLog.quantity), Number(oldLog.branch_id), Number(oldLog.product_id)),
                    env.DB.prepare("DELETE FROM waste_logs WHERE id = ?").bind(id)
                ];

                try {
                    await env.DB.batch(batchStatements);
                    return jsonResponse({ message: "မှတ်တမ်း ဖျက်သိမ်းပြီး စတော့ထဲသို့ အပြည့်အဝ ပြန်လည် ထည့်သွင်းပြီးပါပြီ။" });
                } catch (e) {
                    return errorResponse("ပယ်ဖျက်ခြင်း မအောင်မြင်ပါ: " + e.message, 500);
                }
            }

            // =================================================================
            // 7. CASHBOOK CATEGORIES & ENTRIES (REF NO & SURPLUS/DEFICIT STANDARD)
            // =================================================================

            // 7.1 CATEGORIES GET
            if (path === "/api/cashbook/categories" && method === "GET") {
                await env.DB.prepare(`
                    INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) 
                    VALUES (10, 'ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ', 'EXPENSE', 1, 1)
                `).run().catch(() => {});

                const { results } = await env.DB.prepare(
                    "SELECT id, name, type, is_system FROM cash_categories WHERE is_active = 1 ORDER BY is_system DESC, id ASC"
                ).all();
                return jsonResponse(results || []);
            }

            // 7.2 CASHBOOK ENTRIES & SUMMARY GET
            if (path === "/api/cashbook/entries" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || userBranchId;
                const startDate = url.searchParams.get("start_date") || getMyanmarTodayDate();
                const endDate = url.searchParams.get("end_date") || startDate;

                // ၁။ စာရင်း အသေးစိတ် ဆွဲယူခြင်း (Ref No, Surplus/Deficit နှင့် တိုတိုတုတ်တုတ် Description စံနှုန်း)
                let sql = `
                    SELECT 
                        ce.id, 
                        ce.branch_id, 
                        COALESCE(b.name, 'Main Shop') AS branch_name,
                        ce.category_id, 
                        COALESCE(cc.name, 'အထွေထွေ') AS category_name,
                        ce.entry_type, 
                        ce.payment_method, 
                        ce.amount, 
                        -- Surplus (+) သို့မဟုတ် Deficit (-) ကွာခြားချက်ငွေ
                        COALESCE(ce.diff_amount, p.diff_amount, 0) AS diff_amount,
                        -- Ref No: ဆိုင်ဘောင်ချာနံပါတ် သို့မဟုတ် VR NO
                        COALESCE(ce.ref_no, p.ref_no, s.invoice_no, p.purchase_no, 'VR-CB-' || printf('%05d', ce.id)) AS ref_no,
                        COALESCE(s.invoice_no, p.purchase_no, 'VR-CB-' || printf('%05d', ce.id)) AS reference_no,
                        ce.entry_date,
                        ce.sale_id, 
                        ce.customer_ledger_id, 
                        ce.purchase_id,
                        COALESCE(u.full_name, 'System') AS created_by_name,
                        COALESCE(
                            (SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = ce.sale_id),
                            (SELECT SUM(pi.quantity) FROM purchase_items pi WHERE pi.purchase_id = ce.purchase_id),
                            NULL
                        ) AS total_quantity,
                        -- Unit Price
                        CASE 
                            WHEN COALESCE(
                                (SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = ce.sale_id),
                                (SELECT SUM(pi.quantity) FROM purchase_items pi WHERE pi.purchase_id = ce.purchase_id)
                            ) > 0 
                            THEN ROUND(ce.amount / COALESCE(
                                (SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = ce.sale_id),
                                (SELECT SUM(pi.quantity) FROM purchase_items pi WHERE pi.purchase_id = ce.purchase_id)
                            ))
                            ELSE NULL 
                        END AS unit_price,
                        -- Description: ပစ္စည်းအသေးစိတ်များ မထည့်တော့ဘဲ ပွဲရုံအမည် သို့မဟုတ် ဖောက်သည်အမည်ကိုသာ လိုရင်းတိုရှင်း ဖော်ပြခြင်း
                        CASE 
                            WHEN ce.purchase_id IS NOT NULL THEN COALESCE(p.supplier_name, ce.description, 'ကုန်ပစ္စည်းဝယ်ယူမှု')
                            WHEN ce.sale_id IS NOT NULL THEN COALESCE(c.shop_name, c.name, ce.description, 'အရောင်းရငွေ')
                            ELSE ce.description 
                        END AS description
                    FROM cashbook_entries ce
                    LEFT JOIN branches b ON ce.branch_id = b.id
                    LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                    LEFT JOIN sales s ON ce.sale_id = s.id
                    LEFT JOIN customers c ON s.customer_id = c.id
                    LEFT JOIN purchases p ON ce.purchase_id = p.id
                    LEFT JOIN users u ON ce.created_by = u.id
                    WHERE date(ce.entry_date) BETWEEN ? AND ?
                `;
                const bindings = [startDate, endDate];
                if (branchId) {
                    sql += " AND ce.branch_id = ?";
                    bindings.push(Number(branchId));
                }
                sql += " ORDER BY ce.entry_date DESC, ce.id DESC LIMIT 500";
                const { results } = await env.DB.prepare(sql).bind(...bindings).all();

                // ၂။ ဆိုင်နှင့် ဘဏ် လက်ကျန်ငွေ အစစ်အမှန် (Cumulative Closing Balance)
                let balanceSql = `
                    SELECT 
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                          WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_balance,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                          WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_balance
                    FROM cashbook_entries
                    WHERE date(entry_date) <= ?
                `;
                const balanceBindings = [endDate];
                if (branchId) {
                    balanceSql += " AND branch_id = ?";
                    balanceBindings.push(Number(branchId));
                }
                const balanceRow = await env.DB.prepare(balanceSql).bind(...balanceBindings).first();

                // ၃။ ရွေးချယ်ထားသော ရက်စွဲအတွက် စစ်မှန်သော အသုံးစရိတ် (Total Expense) နှင့် ပိုင်ရှင်ထံအပ်ငွေ (Owner Remittance)
                let summarySql = `
                    SELECT 
                        COALESCE(SUM(CASE WHEN ce.entry_type = 'EXPENSE' AND (cc.name LIKE '%ပိုင်ရှင်%' OR cc.name LIKE '%အပ်ငွေ%' OR cc.name LIKE '%လွှဲ%' OR ce.category_id = 10) THEN ce.amount ELSE 0 END), 0) AS today_remittance,
                        COALESCE(SUM(CASE WHEN ce.entry_type = 'EXPENSE' AND NOT (cc.name LIKE '%ပိုင်ရှင်%' OR cc.name LIKE '%အပ်ငွေ%' OR cc.name LIKE '%လွှဲ%' OR ce.category_id = 10) THEN ce.amount ELSE 0 END), 0) AS today_expense,
                        COALESCE(SUM(CASE WHEN ce.entry_type = 'INCOME' THEN ce.amount ELSE 0 END), 0) AS today_income
                    FROM cashbook_entries ce
                    LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                    WHERE date(ce.entry_date) BETWEEN ? AND ?
                `;
                const summaryBindings = [startDate, endDate];
                if (branchId) {
                    summarySql += " AND ce.branch_id = ?";
                    summaryBindings.push(Number(branchId));
                }
                const todaySummaryRow = await env.DB.prepare(summarySql).bind(...summaryBindings).first();

                return jsonResponse({
                    summary: {
                        cash_balance: Number(balanceRow?.cash_balance || 0),
                        bank_balance: Number(balanceRow?.bank_balance || 0),
                        today_expense: Number(todaySummaryRow?.today_expense || 0),
                        today_remittance: Number(todaySummaryRow?.today_remittance || 0),
                        today_income: Number(todaySummaryRow?.today_income || 0)
                    },
                    entries: results || []
                });
            }

            // 7.3 CASHBOOK ENTRY POST (စာရင်းအသစ်ထည့်သွင်းခြင်း - Ref No & Diff Amount ပါဝင်ခြင်း)
            if (path === "/api/cashbook/entries" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const targetBranch = currentUserRole === "cashier" ? userBranchId : Number(body.branchId || userBranchId);
                const { categoryId, entryType, paymentMethod = "cash", amount, description = "", entryDate, refNo = null, diffAmount = 0 } = body;

                const cleanDesc = String(description || "").trim();
                if (!cleanDesc) {
                    return errorResponse("အသေးစိတ် အကြောင်းအရာ (Description) ထည့်သွင်းပေးပါ", 400);
                }

                if (!categoryId || !amount || parseFloat(amount) <= 0) {
                    return errorResponse("ခေါင်းစဉ်နှင့် ငွေပမာဏ မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
                }

                if (Number(categoryId) === 10) {
                    await env.DB.prepare(`
                        INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) 
                        VALUES (10, 'ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ', 'EXPENSE', 1, 1)
                    `).run().catch(() => {});
                }

                const res = await env.DB.prepare(`
                    INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, amount, diff_amount, ref_no, description, entry_date, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    targetBranch, 
                    Number(categoryId), 
                    String(entryType || "EXPENSE").toUpperCase(),
                    String(paymentMethod).toLowerCase(), 
                    parseFloat(amount), 
                    parseFloat(diffAmount || 0),
                    refNo ? String(refNo).trim() : null,
                    cleanDesc,
                    entryDate || getMyanmarTodayDate(), 
                    currentUserId
                ).run();

                return jsonResponse({ message: "စာရင်းသွင်းပြီးပါပြီ", id: res.meta.last_row_id }, 201);
            }

            // 7.4 CASHBOOK ENTRY PUT (စာရင်းပြင်ဆင်ခြင်း - Ref No & Diff Amount ပါဝင်ခြင်း)
            if (path.startsWith("/api/cashbook/entries/") && method === "PUT") {
                const id = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                const { categoryId, entryType, paymentMethod = "cash", amount, description = "", entryDate, refNo = null, diffAmount = 0 } = body;

                const cleanDesc = String(description || "").trim();
                if (!cleanDesc) {
                    return errorResponse("အသေးစိတ် အကြောင်းအရာ (Description) ထည့်သွင်းပေးပါ", 400);
                }

                if (!categoryId || !amount || parseFloat(amount) <= 0) {
                    return errorResponse("ခေါင်းစဉ်နှင့် ငွေပမာဏ မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
                }

                if (Number(categoryId) === 10) {
                    await env.DB.prepare(`
                        INSERT OR IGNORE INTO cash_categories (id, name, type, is_system, is_active) 
                        VALUES (10, 'ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ', 'EXPENSE', 1, 1)
                    `).run().catch(() => {});
                }

                await env.DB.prepare(`
                    UPDATE cashbook_entries SET
                        category_id = ?,
                        entry_type = ?,
                        payment_method = ?,
                        amount = ?,
                        diff_amount = ?,
                        ref_no = ?,
                        description = ?,
                        entry_date = COALESCE(?, entry_date)
                    WHERE id = ?
                `).bind(
                    Number(categoryId),
                    String(entryType || "EXPENSE").toUpperCase(),
                    String(paymentMethod).toLowerCase(),
                    parseFloat(amount),
                    parseFloat(diffAmount || 0),
                    refNo ? String(refNo).trim() : null,
                    cleanDesc,
                    entryDate || null,
                    id
                ).run();

                return jsonResponse({ message: "ငွေစာရင်း ပြင်ဆင်ပြီးပါပြီ" });
            }

            // 7.5 CASHBOOK ENTRY DELETE (စာရင်းပယ်ဖျက်ခြင်း)
            if (path.startsWith("/api/cashbook/entries/") && method === "DELETE") {
                const id = Number(path.split("/").pop());
                await env.DB.prepare("DELETE FROM cashbook_entries WHERE id = ?").bind(id).run();
                return jsonResponse({ message: "ဖျက်ပြီးပါပြီ" });
            }
            // =================================================================
            // 8. POS CHECKOUT & SALES LOGS (ATOMIC TRANSACTION & STOCK INTEGRITY)
            // =================================================================
            if (path === "/api/pos/sales" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || userBranchId;
                const date = url.searchParams.get("date") || getMyanmarTodayDate();

                const sql = `
                    SELECT 
                        s.id AS sale_id,
                        s.invoice_no,
                        s.sale_type,
                        s.payment_method,
                        s.bank_account_name,
                        s.total_amount,
                        s.discount_amount,
                        s.final_amount,
                        s.paid_amount,
                        s.created_at,
                        COALESCE(c.name, 'Walk-in') AS customer_name,
                        si.id AS item_row_id,
                        si.quantity,
                        si.unit_price,
                        si.subtotal,
                        p.category,
                        p.item_name,
                        p.sku,
                        p.color,
                        p.size,
                        p.pattern
                    FROM sales s
                    LEFT JOIN customers c ON s.customer_id = c.id
                    JOIN sale_items si ON s.id = si.sale_id
                    JOIN products p ON si.product_id = p.id
                    WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ?
                    ORDER BY s.id DESC, si.id ASC
                `;
                const { results } = await env.DB.prepare(sql).bind(Number(branchId), date).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/pos/sales" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = currentUserRole === "cashier" ? userBranchId : Number(body.branchId || userBranchId);
                const {
                    customerId = null, saleType = "retail", items = [],
                    discountAmount = 0, paidAmount = 0, paymentMethod = "cash",
                    cashAmount = 0, bankAmount = 0, bankAccountName = null
                } = body;

                if (!branchId || items.length === 0) {
                    return errorResponse("ဆိုင်ခွဲနှင့် ပစ္စည်းစာရင်း လိုအပ်ပါသည်", 400);
                }

                // ၁။ စတော့နှင့် ပစ္စည်းအချက်အလက်များကို Database မှ ကြိုတင်တိုက်စစ်ခြင်း
                const verifiedItems = [];
                let calculatedTotal = 0;

                for (const item of items) {
                    const pid = Number(item.productId);
                    const qty = parseFloat(item.quantity) || 0;
                    if (!pid || qty <= 0) return errorResponse("ပစ္စည်းအရေအတွက် မှားယွင်းနေပါသည်", 400);

                    const product = await env.DB.prepare(`
                        SELECT p.id, p.item_name, p.cost_price, p.retail_price, p.wholesale_price,
                               COALESCE(bi.quantity, 0) AS current_stock
                        FROM products p
                        LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                        WHERE p.id = ? AND p.is_active = 1
                    `).bind(branchId, pid).first();

                    if (!product) {
                        return errorResponse(`ပစ္စည်း (ID: ${pid}) ရှာမတွေ့ပါ သို့မဟုတ် ရောင်းချခွင့်ပိတ်ထားပါသည်`, 404);
                    }

                    if (Number(product.current_stock) < qty) {
                        return errorResponse(`"${product.item_name}" လက်ကျန်စတော့ (${product.current_stock}) မလုံလောက်ပါ`, 400);
                    }

                    // Client က ပို့သော ဈေးနှုန်း (သို့မဟုတ် မူလရောင်းဈေး)
                    const unitPrice = parseFloat(item.unitPrice) || (saleType === "wholesale" ? Number(product.wholesale_price) : Number(product.retail_price));
                    const costPrice = Number(product.cost_price || 0); // အမြတ်တိကျစေရန် Backend DB cost_price ကိုသာ အသုံးပြု
                    const lineSubtotal = qty * unitPrice;
                    calculatedTotal += lineSubtotal;

                    verifiedItems.push({
                        productId: pid,
                        quantity: qty,
                        unitPrice,
                        costPrice,
                        subtotal: lineSubtotal
                    });
                }

                const discount = Math.max(0, parseFloat(discountAmount) || 0);
                const finalAmount = Math.max(0, calculatedTotal - discount);
                const rawPaid = Math.max(0, parseFloat(paidAmount) || 0);
                const effectivePaid = Math.min(rawPaid, finalAmount);
                const debtAmount = Math.max(0, finalAmount - effectivePaid);

                // ၂။ Customer Credit Limit စစ်ဆေးခြင်း
                if (debtAmount > 0) {
                    if (!customerId) return errorResponse("အကြွေးကျန်ငွေ ရှိနေပါသဖြင့် ဖောက်သည် ရွေးချယ်ပေးပါ", 400);
                    const cust = await env.DB.prepare("SELECT current_debt, credit_limit, name FROM customers WHERE id = ? AND is_active = 1").bind(Number(customerId)).first();
                    if (!cust) return errorResponse("ဖောက်သည် ရှာမတွေ့ပါ", 404);

                    const currentDebt = Number(cust.current_debt || 0);
                    const limit = Number(cust.credit_limit || 0);
                    if (limit > 0 && (currentDebt + debtAmount) > limit) {
                        return errorResponse(`ဖောက်သည် "${cust.name}" ၏ ခွင့်ပြုအကြွေးကန့်သတ်ချက် (${limit.toLocaleString()} Ks) ထက် ကျော်လွန်နေပါသည် (လက်ရှိအကြွေး: ${currentDebt.toLocaleString()} Ks)`, 400);
                    }
                }

                // ၃။ Collision-Free Invoice Number ထုတ်ယူခြင်း
                const todayDate = getMyanmarTodayDate();
                const dateStr = todayDate.replace(/-/g, "");
                const randomCode = Math.floor(1000 + Math.random() * 9000);
                const invoiceNo = `INV-B${branchId}-${dateStr}-${randomCode}`;

                let pCash = 0;
                let pBank = 0;
                if (paymentMethod === "cash") pCash = effectivePaid;
                else if (paymentMethod === "bank") pBank = effectivePaid;
                else if (paymentMethod === "credit") {
                    if (bankAccountName) pBank = effectivePaid;
                    else pCash = effectivePaid;
                } else {
                    pCash = parseFloat(cashAmount) || 0;
                    pBank = parseFloat(bankAmount) || 0;
                }

                // ၄။ Sale Header ထည့်သွင်းခြင်း
                const saleInsert = await env.DB.prepare(`
                    INSERT INTO sales (
                        invoice_no, branch_id, customer_id, sale_type,
                        total_amount, discount_amount, final_amount, paid_amount, debt_amount,
                        payment_method, cash_amount, bank_amount, bank_account_name, created_by, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `).bind(
                    invoiceNo, Number(branchId), customerId ? Number(customerId) : null, saleType,
                    calculatedTotal, discount, finalAmount, effectivePaid, debtAmount,
                    paymentMethod, pCash, pBank, bankAccountName, currentUserId
                ).run();

                const saleId = saleInsert.meta.last_row_id;
                const batchStatements = [];

                try {
                    // ၅။ Items ထည့်သွင်းခြင်းနှင့် Stock နုတ်ခြင်း
                    for (const item of verifiedItems) {
                        batchStatements.push(
                            env.DB.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)")
                                .bind(saleId, item.productId, item.quantity, item.unitPrice, item.costPrice, item.subtotal)
                        );

                        // ပုံမှန် UPDATE ဖြင့် စတော့နုတ်ခြင်း (Negative oversell ကို CHECK constraint မှ ကာကွယ်ပေးမည်)
                        batchStatements.push(
                            env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                                .bind(item.quantity, Number(branchId), item.productId)
                        );
                    }

                    // ၆။ Cashbook စာရင်းသွင်းခြင်း
                    if (effectivePaid > 0) {
                        if (pCash > 0) {
                            batchStatements.push(
                                env.DB.prepare(`
                                    INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, amount, description, entry_date, created_by)
                                    VALUES (?, 1, ?, 'INCOME', 'cash', ?, ?, ?, ?)
                                `).bind(Number(branchId), saleId, pCash, `အရောင်း ${invoiceNo} (ငွေသား)`, todayDate, currentUserId)
                            );
                        }
                        if (pBank > 0) {
                            batchStatements.push(
                                env.DB.prepare(`
                                    INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, bank_account_name, amount, description, entry_date, created_by)
                                    VALUES (?, 1, ?, 'INCOME', 'bank', ?, ?, ?, ?, ?)
                                `).bind(Number(branchId), saleId, bankAccountName || 'Bank', pBank, `အရောင်း ${invoiceNo} (${bankAccountName || 'Bank'})`, todayDate, currentUserId)
                            );
                        }
                    }

                    // ၇။ Customer အကြွေးစာရင်း အလိုအလျောက်တိုးခြင်း (SQL Atomic UPDATE)
                    if (debtAmount > 0 && customerId) {
                        batchStatements.push(
                            env.DB.prepare(`
                                INSERT INTO customer_ledger (customer_id, branch_id, sale_id, type, amount, balance_after, reference_note, created_by)
                                VALUES (?, ?, ?, 'DEBIT', ?, (SELECT current_debt + ? FROM customers WHERE id = ?), ?, ?)
                            `).bind(Number(customerId), Number(branchId), saleId, debtAmount, debtAmount, Number(customerId), `ဘောင်ချာ ${invoiceNo} အကြွေးကျန်`, currentUserId)
                        );

                        batchStatements.push(
                            env.DB.prepare("UPDATE customers SET current_debt = current_debt + ? WHERE id = ?")
                                .bind(debtAmount, Number(customerId))
                        );
                    }

                    await env.DB.batch(batchStatements);
                } catch (batchErr) {
                    // Batch ချို့ယွင်းပါက Orphaned Sale Header မကျန်စေရန် ချက်ချင်း Rollback လုပ်ခြင်း
                    await env.DB.prepare("DELETE FROM sales WHERE id = ?").bind(saleId).run();
                    throw new Error(`အရောင်းစာရင်း သိမ်းဆည်းမှု မအောင်မြင်ပါ (Rollback ပြုလုပ်ပြီးပါပြီ): ${batchErr.message}`);
                }

                return jsonResponse({ message: "အရောင်းဘောင်ချာ အောင်မြင်ပါသည်", invoiceNo, saleId, finalAmount }, 201);
            }

            // =================================================================
            // 9. YARN BALANCES & PRODUCTION ISSUE
            // =================================================================
            
            // ၉.၁ ချည်စာရင်း သီးသန့် ရယူခြင်း (Frontend တွင် /products ဖြင့်လည်း ယူနိုင်သော်လည်း သီးသန့် Endpoint ထားပေးထားသည်)
            if (path === "/api/yarns" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || userBranchId;
                const search = url.searchParams.get("search")?.trim() || "";

                let sql = `
                    SELECT 
                        p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, 
                        p.size, p.color, p.cost_price, p.retail_price, p.wholesale_price, 
                        p.alert_quantity,
                        COALESCE(bi.quantity, 0) AS current_stock
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                    WHERE p.is_active = 1 
                      AND (p.category = 'ချည်' OR p.category = 'Yarn' OR p.category LIKE 'ချည်%')
                      AND p.category NOT LIKE '%ပုဆိုး%' 
                      AND p.category NOT LIKE '%လုံချည်%'
                      AND p.category NOT LIKE '%အင်္ကျီ%'
                `;
                const bindings = [Number(branchId)];

                if (search) {
                    sql += ` AND (p.sku LIKE ? OR p.barcode LIKE ? OR p.item_name LIKE ? OR p.color LIKE ?) `;
                    bindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
                }

                sql += ` ORDER BY p.id DESC LIMIT 500`;
                const { results } = await env.DB.prepare(sql).bind(...bindings).all().catch(() => ({ results: [] }));
                return jsonResponse(results || []);
            }

            // (မှတ်ချက်: POST /api/yarns နှင့် PUT /api/yarns/:id များကို ဖယ်ရှားလိုက်ပါသည်။ အဘယ်ကြောင့်ဆိုသော်
            // Frontend မှ ချည်အသစ်သွင်းခြင်းနှင့် ပြင်ဆင်ခြင်းများကို ယခုအခါ POST/PUT /api/products မှတစ်ဆင့်သာ တိုက်ရိုက်လုပ်ဆောင်သောကြောင့်ဖြစ်သည်)


            // ၉.၂ ရက်ကန်းသို့ ချည်ထုတ်ပေးခြင်း (Yarn Issue)
            if (path === "/api/yarns/issue" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = currentUserRole === "cashier" ? userBranchId : Number(body.branchId || userBranchId);
                const yarnId = Number(body.yarnId || body.product_id);
                const weaverName = String(body.weaverName || body.weaver_name || "").trim();
                const qty = parseFloat(body.quantity) || 0;
                const notes = String(body.notes || "").trim();

                if (!yarnId || !weaverName || qty <= 0) {
                    return errorResponse("ချည်အမျိုးအစား၊ ရက်ကန်းသမားအမည်နှင့် ပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ", 400);
                }

                // yarn_issues ဇယား မရှိသေးပါက အလိုအလျောက် တည်ဆောက်ပေးမည်
                await env.DB.prepare(`
                    CREATE TABLE IF NOT EXISTS yarn_issues (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        yarn_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                        weaver_name TEXT NOT NULL,
                        quantity REAL NOT NULL,
                        issue_date TEXT NOT NULL,
                        notes TEXT,
                        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                `).run().catch(() => {});

                // လက်ရှိ စတော့လက်ကျန်အား စစ်ဆေးခြင်း
                const inv = await env.DB.prepare(`
                    SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?
                `).bind(branchId, yarnId).first();

                const currentStock = Number(inv?.quantity || 0);
                if (currentStock < qty) {
                    return errorResponse(`ချည်လက်ကျန် မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
                }

                const today = getMyanmarTodayDate();

                await env.DB.batch([
                    env.DB.prepare(`
                        INSERT INTO yarn_issues (yarn_id, branch_id, weaver_name, quantity, issue_date, notes, created_by) 
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).bind(yarnId, branchId, weaverName, qty, today, notes, currentUserId),

                    env.DB.prepare(`
                        UPDATE branch_inventory 
                        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE branch_id = ? AND product_id = ?
                    `).bind(qty, branchId, yarnId)
                ]);

                return jsonResponse({ message: "ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု အောင်မြင်ပါသည်။ ချည်စတော့မှ နှုတ်ပြီးပါပြီ။" });
            }

            // ၉.၃ ရက်ကန်းထုတ်ပေးမှု မှတ်တမ်းများ ရယူခြင်း (Issue Logs)
            if (path === "/api/yarns/issues" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || userBranchId;

                const sql = `
                    SELECT 
                        yi.id, yi.weaver_name, yi.quantity, yi.issue_date, yi.notes, yi.created_at,
                        p.sku, p.item_name, p.color, p.size AS unit,
                        COALESCE(u.full_name, 'Admin') AS created_by_name
                    FROM yarn_issues yi
                    INNER JOIN products p ON yi.yarn_id = p.id
                    LEFT JOIN users u ON yi.created_by = u.id
                    WHERE yi.branch_id = ?
                    ORDER BY yi.id DESC LIMIT 300
                `;
                const { results } = await env.DB.prepare(sql).bind(Number(branchId)).all().catch(() => ({ results: [] }));
                return jsonResponse(results || []);
            }

            // =================================================================
            // 10. CUSTOMERS & SUPPLIERS DEBT/LIABILITIES MANAGEMENT
            // =================================================================

            // ၁၀.၁ CUSTOMERS & SUPPLIERS LIST GET
            if (path === "/api/customers" && method === "GET") {
                // Table Columns စစ်ဆေးပြီး လိုအပ်ပါက အလိုအလျောက် ဖြည့်စွက်ခြင်း
                const custInfo = await env.DB.prepare("PRAGMA table_info(customers)").all().catch(() => ({ results: [] }));
                const cols = (custInfo.results || []).map(r => r.name.toLowerCase());
                
                if (!cols.includes("entity_type")) {
                    await env.DB.prepare("ALTER TABLE customers ADD COLUMN entity_type TEXT DEFAULT 'CUSTOMER'").run().catch(() => {});
                }
                if (!cols.includes("current_payable")) {
                    await env.DB.prepare("ALTER TABLE customers ADD COLUMN current_payable REAL DEFAULT 0").run().catch(() => {});
                }

                // supplier_ledger ဇယား မရှိသေးပါက အလိုအလျောက် တည်ဆောက်ပေးခြင်း
                await env.DB.prepare(`
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
                `).run().catch(() => {});

                const { results } = await env.DB.prepare(`
                    SELECT 
                        id, name, phone, shop_name, address,
                        COALESCE(entity_type, 'CUSTOMER') AS entity_type,
                        COALESCE(customer_type, 'retail') AS customer_type,
                        COALESCE(current_debt, 0) AS current_debt,
                        COALESCE(current_debt, 0) AS outstanding_balance,
                        COALESCE(current_payable, 0) AS current_payable,
                        is_active, created_at
                    FROM customers 
                    WHERE is_active = 1 
                    ORDER BY (COALESCE(current_debt, 0) + COALESCE(current_payable, 0)) DESC, name ASC
                `).all();

                return jsonResponse(results || []);
            }

            // ၁၀.၂ CUSTOMER OR SUPPLIER POST (အသစ်မှတ်ပုံတင်ခြင်း)
            if (path === "/api/customers" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                if (!body.name) return errorResponse("အမည် ထည့်သွင်းပေးပါ", 400);

                const entityType = String(body.entityType || body.entity_type || "CUSTOMER").toUpperCase();
                const openingBalance = parseFloat(body.initialDebt ?? body.initialPayable ?? body.current_debt ?? 0) || 0;
                
                const initialDebt = entityType === "CUSTOMER" ? openingBalance : 0;
                const initialPayable = entityType === "SUPPLIER" ? openingBalance : 0;

                const res = await env.DB.prepare(`
                    INSERT INTO customers (name, phone, shop_name, entity_type, customer_type, current_debt, current_payable, address)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    String(body.name).trim(),
                    body.phone ? String(body.phone).trim() : null,
                    body.shopName ? String(body.shopName).trim() : null,
                    entityType,
                    body.customerType || (entityType === "SUPPLIER" ? "wholesale" : "retail"),
                    initialDebt,
                    initialPayable,
                    body.address ? String(body.address).trim() : null
                ).run();

                const newId = res.meta.last_row_id;

                // ကနဦး အကြွေးလက်ကျန် ရှိပါက သက်ဆိုင်ရာ Ledger ထဲသို့ စာရင်းဖွင့်မှတ်တမ်း ထည့်သွင်းခြင်း
                if (entityType === "CUSTOMER" && initialDebt > 0) {
                    await env.DB.prepare(`
                        INSERT INTO customer_ledger (customer_id, branch_id, type, amount, balance_after, payment_method, reference_note, created_by)
                        VALUES (?, ?, 'DEBIT', ?, ?, 'cash', 'ကနဦး အကြွေးလက်ကျန် (Opening Debt)', ?)
                    `).bind(newId, userBranchId, initialDebt, initialDebt, currentUserId).run().catch(() => {});
                } else if (entityType === "SUPPLIER" && initialPayable > 0) {
                    await env.DB.prepare(`
                        INSERT INTO supplier_ledger (supplier_id, branch_id, type, amount, balance_after, payment_method, reference_note, created_by)
                        VALUES (?, ?, 'PURCHASE_DEBT', ?, ?, 'cash', 'ကနဦး ပေးရန်ကျန်ငွေ (Opening Payable)', ?)
                    `).bind(newId, userBranchId, initialPayable, initialPayable, currentUserId).run().catch(() => {});
                }

                return jsonResponse({ id: newId, message: `${entityType === 'SUPPLIER' ? 'ပွဲရုံ' : 'ဖောက်သည်'} အသစ် သိမ်းဆည်းပြီးပါပြီ` }, 201);
            }

            // ၁၀.၃ CUSTOMER OR SUPPLIER PUT (အချက်အလက် ပြင်ဆင်ခြင်း)
            if (path.startsWith("/api/customers/") && !path.endsWith("/ledger") && !path.endsWith("/repay") && method === "PUT") {
                const id = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                if (!id || !body.name) return errorResponse("အမည် အချက်အလက် လိုအပ်ပါသည်", 400);

                await env.DB.prepare(`
                    UPDATE customers SET 
                        name = ?, 
                        phone = ?, 
                        shop_name = ?, 
                        address = ?,
                        customer_type = COALESCE(?, customer_type)
                    WHERE id = ?
                `).bind(
                    String(body.name).trim(),
                    body.phone ? String(body.phone).trim() : null,
                    body.shopName ? String(body.shopName).trim() : null,
                    body.address ? String(body.address).trim() : null,
                    body.customerType || null,
                    id
                ).run();

                return jsonResponse({ message: "အချက်အလက် ပြင်ဆင်ပြီးပါပြီ" });
            }

            // ၁၀.၄ UNIVERSAL DEBT REPAYMENT POST (ဖောက်သည်အကြွေးဆပ်ငွေ လက်ခံခြင်း / ပွဲရုံသို့ အကြွေးဆပ်ခြင်း)
            if (path === "/api/customers/repay" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const targetBranch = currentUserRole === "cashier" ? userBranchId : Number(body.branchId || userBranchId);
                const { customerId, amount, paymentMethod = "cash", bankAccountName = null, note = "", entryDate } = body;

                const repayAmt = parseFloat(amount) || 0;
                if (!customerId || repayAmt <= 0) return errorResponse("ပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ", 400);

                const contact = await env.DB.prepare(
                    "SELECT name, COALESCE(entity_type, 'CUSTOMER') AS entity_type, COALESCE(current_debt, 0) AS current_debt, COALESCE(current_payable, 0) AS current_payable FROM customers WHERE id = ?"
                ).bind(Number(customerId)).first();

                if (!contact) return errorResponse("စာရင်း ရှာမတွေ့ပါ", 404);

                const isSupplier = String(contact.entity_type).toUpperCase() === "SUPPLIER";
                const today = entryDate || getMyanmarTodayDate();
                const payMethod = String(paymentMethod).toLowerCase();
                const methodLabel = payMethod === "bank" ? (bankAccountName || "Bank") : "ငွေသား";

                if (isSupplier) {
                    // ပွဲရုံသို့ ဆိုင်က အကြွေးသွားဆပ်ခြင်း (PAYABLE DECREASE & CASHBOOK EXPENSE)
                    const oldPayable = Number(contact.current_payable || 0);
                    const newPayable = Math.max(0, oldPayable - repayAmt);

                    await env.DB.batch([
                        env.DB.prepare(`
                            INSERT INTO supplier_ledger (supplier_id, branch_id, type, amount, balance_after, payment_method, bank_account_name, reference_note, created_by)
                            VALUES (?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?)
                        `).bind(
                            Number(customerId), targetBranch, repayAmt, newPayable,
                            payMethod, bankAccountName || null,
                            note || `ပွဲရုံသို့ အကြွေးဆပ်ငွေ (${methodLabel})`,
                            currentUserId
                        ),

                        env.DB.prepare("UPDATE customers SET current_payable = ? WHERE id = ?").bind(newPayable, Number(customerId)),

                        // Cash Book တွင် အသုံးစရိတ် (EXPENSE) အဖြစ် မှတ်တမ်းတင်ခြင်း
                        env.DB.prepare(`
                            INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, bank_account_name, amount, description, entry_date, created_by)
                            VALUES (?, 6, 'EXPENSE', ?, ?, ?, ?, ?, ?)
                        `).bind(
                            targetBranch, payMethod, bankAccountName || null,
                            repayAmt, `${contact.name} ပွဲရုံကြွေးဆပ် (${note || methodLabel})`,
                            today, currentUserId
                        )
                    ]);

                    return jsonResponse({ message: "ပွဲရုံသို့ အကြွေးဆပ်ငွေ မှတ်တမ်းတင်ပြီးပါပြီ", newBalance: newPayable });
                } else {
                    // ဖောက်သည်က ဆိုင်သို့ အကြွေးပြန်ဆပ်ခြင်း (RECEIVABLE DECREASE & CASHBOOK INCOME)
                    const oldDebt = Number(contact.current_debt || 0);
                    const newDebt = Math.max(0, oldDebt - repayAmt);

                    await env.DB.batch([
                        env.DB.prepare(`
                            INSERT INTO customer_ledger (customer_id, branch_id, type, amount, balance_after, payment_method, bank_account_name, reference_note, created_by)
                            VALUES (?, ?, 'CREDIT', ?, ?, ?, ?, ?, ?)
                        `).bind(
                            Number(customerId), targetBranch, repayAmt, newDebt,
                            payMethod, bankAccountName || null,
                            note || `အကြွေးဆပ် (${methodLabel})`,
                            currentUserId
                        ),

                        env.DB.prepare("UPDATE customers SET current_debt = ? WHERE id = ?").bind(newDebt, Number(customerId)),

                        // Cash Book တွင် ဝင်ငွေ (INCOME) အဖြစ် မှတ်တမ်းတင်ခြင်း
                        env.DB.prepare(`
                            INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, bank_account_name, amount, description, entry_date, created_by)
                            VALUES (?, 2, 'INCOME', ?, ?, ?, ?, ?, ?)
                        `).bind(
                            targetBranch, payMethod, bankAccountName || null,
                            repayAmt, `${contact.name} အကြွေးဆပ် (${note || methodLabel})`,
                            today, currentUserId
                        )
                    ]);

                    return jsonResponse({ message: "အကြွေးဆပ်ငွေ လက်ခံပြီးပါပြီ", newBalance: newDebt });
                }
            }

            // ၁၀.၅ STATEMENT LEDGER GET (Customer Statement သို့မဟုတ် Supplier Statement)
            if (path.startsWith("/api/customers/") && path.endsWith("/ledger") && method === "GET") {
                const parts = path.split("/");
                const customerId = Number(parts[3]);
                if (!customerId) return errorResponse("ID မမှန်ကန်ပါ", 400);

                const contact = await env.DB.prepare(
                    "SELECT COALESCE(entity_type, 'CUSTOMER') AS entity_type FROM customers WHERE id = ?"
                ).bind(customerId).first();

                const isSupplier = contact && String(contact.entity_type).toUpperCase() === "SUPPLIER";

                if (isSupplier) {
                    const sql = `
                        SELECT 
                            sl.id, sl.supplier_id AS customer_id, sl.branch_id, sl.purchase_id,
                            sl.type, sl.amount, sl.balance_after, sl.payment_method,
                            sl.reference_note, sl.created_at,
                            p.purchase_no AS invoice_no,
                            COALESCE(u.full_name, 'Admin') AS created_by_name
                        FROM supplier_ledger sl
                        LEFT JOIN purchases p ON sl.purchase_id = p.id
                        LEFT JOIN users u ON sl.created_by = u.id
                        WHERE sl.supplier_id = ?
                        ORDER BY sl.id DESC LIMIT 300
                    `;
                    const { results } = await env.DB.prepare(sql).bind(customerId).all();
                    return jsonResponse(results || []);
                } else {
                    const sql = `
                        SELECT 
                            cl.id, cl.customer_id, cl.branch_id, cl.sale_id,
                            cl.type, cl.amount, cl.balance_after, cl.payment_method,
                            cl.reference_note, cl.created_at,
                            s.invoice_no,
                            COALESCE(u.full_name, 'Admin') AS created_by_name
                        FROM customer_ledger cl
                        LEFT JOIN sales s ON cl.sale_id = s.id
                        LEFT JOIN users u ON cl.created_by = u.id
                        WHERE cl.customer_id = ?
                        ORDER BY cl.id DESC LIMIT 300
                    `;
                    const { results } = await env.DB.prepare(sql).bind(customerId).all();
                    return jsonResponse(results || []);
                }
            }
            // =================================================================
            // 11. INTER-BRANCH STOCK TRANSFERS
            // =================================================================
            if (path === "/api/transfers" && method === "GET") {
                const branchId = url.searchParams.get("branch_id");

                // stock_transfers ဇယား မရှိသေးပါက အလိုအလျောက် တည်ဆောက်ပေးမည်
                await env.DB.prepare(`
                    CREATE TABLE IF NOT EXISTS stock_transfers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        transfer_no TEXT NOT NULL UNIQUE,
                        from_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                        to_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
                        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
                        quantity REAL NOT NULL,
                        status TEXT DEFAULT 'COMPLETED',
                        notes TEXT,
                        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                `).run().catch(() => {});

                let sql = `
                    SELECT 
                        t.id, t.transfer_no, t.from_branch_id, t.to_branch_id, t.product_id, t.quantity, t.status, t.notes, t.created_at,
                        b1.name AS from_branch_name, b1.code AS from_branch_code,
                        b2.name AS to_branch_name, b2.code AS to_branch_code,
                        p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                        COALESCE(u.full_name, 'Admin') AS created_by_name
                    FROM stock_transfers t
                    LEFT JOIN branches b1 ON t.from_branch_id = b1.id
                    LEFT JOIN branches b2 ON t.to_branch_id = b2.id
                    LEFT JOIN products p ON t.product_id = p.id
                    LEFT JOIN users u ON t.created_by = u.id
                `;
                const bindings = [];
                if (branchId) {
                    sql += ` WHERE (t.from_branch_id = ? OR t.to_branch_id = ?) `;
                    bindings.push(Number(branchId), Number(branchId));
                }
                sql += ` ORDER BY t.id DESC LIMIT 300 `;

                const { results } = await env.DB.prepare(sql).bind(...bindings).all().catch(() => ({ results: [] }));
                return jsonResponse(results || []);
            }

            if (path === "/api/transfers" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const fromBranchId = Number(body.fromBranchId || body.from_branch_id);
                const toBranchId = Number(body.toBranchId || body.to_branch_id);
                const productId = Number(body.productId || body.product_id);
                const quantity = parseFloat(body.quantity);
                const notes = String(body.notes || "").trim();

                if (!fromBranchId || !toBranchId || !productId || isNaN(quantity) || quantity <= 0) {
                    return errorResponse("လွှဲပြောင်းပေးပို့မည့် ဆိုင်ခွဲများ၊ ပစ္စည်းနှင့် အရေအတွက် အပြည့်အစုံ ထည့်သွင်းပေးပါ", 400);
                }

                if (fromBranchId === toBranchId) {
                    return errorResponse("ပေးပို့မည့်ဆိုင်နှင့် လက်ခံမည့်ဆိုင် တူညီ၍ မရပါ", 400);
                }

                const sourceInv = await env.DB.prepare(`
                    SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?
                `).bind(fromBranchId, productId).first();

                const currentStock = Number(sourceInv?.quantity || 0);
                if (currentStock < quantity) {
                    return errorResponse(`လွှဲပြောင်းမည့်ဆိုင်တွင် လက်ကျန်ပစ္စည်း မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
                }

                const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
                const transferNo = `TRF-B${fromBranchId}TO${toBranchId}-${dateStr}`;

                await env.DB.batch([
                    env.DB.prepare(`
                        INSERT INTO stock_transfers (transfer_no, from_branch_id, to_branch_id, product_id, quantity, status, notes, created_by)
                        VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
                    `).bind(transferNo, fromBranchId, toBranchId, productId, quantity, notes || "ဆိုင်အချင်းချင်း ပစ္စည်းလွှဲပြောင်းမှု", currentUserId),

                    env.DB.prepare(`
                        UPDATE branch_inventory 
                        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE branch_id = ? AND product_id = ?
                    `).bind(quantity, fromBranchId, productId),

                    env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                        VALUES (?, ?, ?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                        quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                    `).bind(toBranchId, productId, quantity)
                ]);

                return jsonResponse({ message: "ဆိုင်ခွဲအချင်းချင်း ပစ္စည်းလွှဲပြောင်းခြင်း အောင်မြင်ပါသည်", transferNo }, 201);
            }

            if (path.startsWith("/api/transfers/") && method === "PUT") {
                const id = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                const newQty = parseFloat(body.quantity);
                const notes = String(body.notes || "").trim();

                if (!id || isNaN(newQty) || newQty <= 0) {
                    return errorResponse("မှန်ကန်သော အရေအတွက် ထည့်သွင်းပေးပါ", 400);
                }

                const trf = await env.DB.prepare("SELECT * FROM stock_transfers WHERE id = ?").bind(id).first();
                if (!trf) return errorResponse("လွှဲပြောင်းမှုမှတ်တမ်း ရှာမတွေ့ပါ", 404);

                const oldQty = Number(trf.quantity || 0);
                const diff = Math.round((newQty - oldQty) * 1000) / 1000;

                if (diff > 0) {
                    const fromInv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(trf.from_branch_id), Number(trf.product_id)).first();
                    const fromStock = Number(fromInv?.quantity || 0);
                    if (fromStock < diff) {
                        return errorResponse(`မူလပေးပို့သည့်ဆိုင်တွင် လက်ကျန် (${fromStock}) မလုံလောက်သဖြင့် အရေအတွက် တိုး၍မရပါ`, 400);
                    }
                } else if (diff < 0) {
                    const toInv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(trf.to_branch_id), Number(trf.product_id)).first();
                    const toStock = Number(toInv?.quantity || 0);
                    if (toStock < Math.abs(diff)) {
                        return errorResponse(`လက်ခံရရှိသည့်ဆိုင်တွင် လက်ကျန် (${toStock}) လျော့နည်းနေသဖြင့် အရေအတွက် လျှော့ချ၍မရပါ`, 400);
                    }
                }

                const batchStatements = [
                    env.DB.prepare("UPDATE stock_transfers SET quantity = ?, notes = ? WHERE id = ?").bind(newQty, notes, id)
                ];

                if (diff !== 0) {
                    batchStatements.push(
                        env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                            .bind(diff, Number(trf.from_branch_id), Number(trf.product_id))
                    );
                    batchStatements.push(
                        env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                            .bind(diff, Number(trf.to_branch_id), Number(trf.product_id))
                    );
                }

                await env.DB.batch(batchStatements);
                return jsonResponse({ message: "လွှဲပြောင်းမှုမှတ်တမ်း ပြင်ဆင်ပြီး ဆိုင်နှစ်ခုလုံးရှိ စတော့လက်ကျန်များကို အလိုအလျောက် ပြန်ညှိပြီးပါပြီ။" });
            }

            if (path.startsWith("/api/transfers/") && method === "DELETE") {
                const id = Number(path.split("/").pop());
                const trf = await env.DB.prepare("SELECT * FROM stock_transfers WHERE id = ?").bind(id).first();
                if (!trf) return errorResponse("လွှဲပြောင်းမှုမှတ်တမ်း ရှာမတွေ့ပါ", 404);

                const destInv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                    .bind(Number(trf.to_branch_id), Number(trf.product_id)).first();
                const destStock = Number(destInv?.quantity || 0);

                if (destStock < Number(trf.quantity)) {
                    return errorResponse(`လက်ခံဆိုင်တွင် ပစ္စည်းလက်ကျန် (${destStock}) လျော့နည်းနေသဖြင့် လွှဲပြောင်းမှုကို ပြန်ဖျက်၍ မရပါ`, 400);
                }

                await env.DB.batch([
                    env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(trf.quantity), Number(trf.from_branch_id), Number(trf.product_id)),
                    env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(trf.quantity), Number(trf.to_branch_id), Number(trf.product_id)),
                    env.DB.prepare("DELETE FROM stock_transfers WHERE id = ?").bind(id)
                ]);

                return jsonResponse({ message: "လွှဲပြောင်းမှုမှတ်တမ်းကို ပယ်ဖျက်ပြီး ဆိုင်နှစ်ခုလုံးရှိ စတော့များကို မူလအတိုင်း ပြန်ညှိပြီးပါပြီ" });
            }

            // =================================================================
            // 12. INVENTORY & STOCK REPORTS (OPTIMIZED & ERROR-FREE)
            // =================================================================
            if (path === "/api/reports/monthly-stock" && method === "GET") {
                const year = url.searchParams.get("year") || String(new Date().getFullYear());
                const branchId = url.searchParams.get("branch_id");

                // ၁။ Products နှင့် Branch Inventory ပေါင်းစပ်ဆွဲထုတ်ခြင်း (Barcode ပါ ထည့်သွင်းထားသည်)
                let prodSql = `
                    SELECT 
                        p.id, p.sku, p.barcode, p.category, p.item_name, p.cost_price,
                        COALESCE(bi.quantity, 0) AS current_balance
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                `;
                const prodBindings = [];
                if (branchId && branchId !== "ALL") {
                    prodSql += ` WHERE bi.branch_id = ? AND p.is_active = 1 `;
                    prodBindings.push(Number(branchId));
                } else {
                    prodSql += ` WHERE p.is_active = 1 `;
                }
                prodSql += ` GROUP BY p.id ORDER BY p.category ASC, p.item_name ASC `;
                
                const prodRes = await env.DB.prepare(prodSql).bind(...prodBindings).all().catch(() => ({ results: [] }));
                const products = prodRes.results || [];

                // ၂။ Purchases (အဝယ်အဝင်) ဆွဲထုတ်ခြင်း
                let purchases = [];
                try {
                    let purchSql = `
                        SELECT pi.product_id, CAST(SUBSTR(p.created_at, 6, 2) AS INTEGER) AS m, SUM(pi.quantity) AS qty
                        FROM purchase_items pi
                        JOIN purchases p ON pi.purchase_id = p.id
                        WHERE SUBSTR(p.created_at, 1, 4) = ?
                    `;
                    const purchBindings = [year];
                    if (branchId && branchId !== "ALL") {
                        purchSql += ` AND p.branch_id = ? `;
                        purchBindings.push(Number(branchId));
                    }
                    purchSql += ` GROUP BY pi.product_id, m `;
                    const res = await env.DB.prepare(purchSql).bind(...purchBindings).all();
                    purchases = res.results || [];
                } catch {
                    purchases = [];
                }

                // ၃။ Sales (အရောင်းအထွက်) ဆွဲထုတ်ခြင်း
                let sales = [];
                try {
                    let saleSql = `
                        SELECT si.product_id, CAST(SUBSTR(s.created_at, 6, 2) AS INTEGER) AS m, SUM(si.quantity) AS qty
                        FROM sale_items si
                        JOIN sales s ON si.sale_id = s.id
                        WHERE SUBSTR(s.created_at, 1, 4) = ?
                    `;
                    const saleBindings = [year];
                    if (branchId && branchId !== "ALL") {
                        saleSql += ` AND s.branch_id = ? `;
                        saleBindings.push(Number(branchId));
                    }
                    saleSql += ` GROUP BY si.product_id, m `;
                    const res = await env.DB.prepare(saleSql).bind(...saleBindings).all();
                    sales = res.results || [];
                } catch {
                    sales = [];
                }

                // ၄။ Waste (ပျက်စီးဆုံးရှုံးမှု) ဆွဲထုတ်ခြင်း
                let waste = [];
                try {
                    let wasteSql = `
                        SELECT product_id, CAST(SUBSTR(created_at, 6, 2) AS INTEGER) AS m, SUM(quantity) AS qty
                        FROM waste_logs
                        WHERE SUBSTR(created_at, 1, 4) = ?
                    `;
                    const wasteBindings = [year];
                    if (branchId && branchId !== "ALL") {
                        wasteSql += ` AND branch_id = ? `;
                        wasteBindings.push(Number(branchId));
                    }
                    wasteSql += ` GROUP BY product_id, m `;
                    const res = await env.DB.prepare(wasteSql).bind(...wasteBindings).all();
                    waste = res.results || [];
                } catch {
                    waste = [];
                }

                // ၅။ Stock Transfers (ဆိုင်အချင်းချင်း လွှဲပြောင်းမှု) ဆွဲထုတ်ခြင်း
                let trfIn = [];
                let trfOut = [];
                if (branchId && branchId !== "ALL") {
                    try {
                        const trfInRes = await env.DB.prepare(`
                            SELECT product_id, CAST(SUBSTR(created_at, 6, 2) AS INTEGER) AS m, SUM(quantity) AS qty
                            FROM stock_transfers
                            WHERE to_branch_id = ? AND SUBSTR(created_at, 1, 4) = ?
                            GROUP BY product_id, m
                        `).bind(Number(branchId), year).all();
                        trfIn = trfInRes.results || [];

                        const trfOutRes = await env.DB.prepare(`
                            SELECT product_id, CAST(SUBSTR(created_at, 6, 2) AS INTEGER) AS m, SUM(quantity) AS qty
                            FROM stock_transfers
                            WHERE from_branch_id = ? AND SUBSTR(created_at, 1, 4) = ?
                            GROUP BY product_id, m
                        `).bind(Number(branchId), year).all();
                        trfOut = trfOutRes.results || [];
                    } catch {
                        trfIn = [];
                        trfOut = [];
                    }
                }

                const report = products.map(prod => {
                    const pid = prod.id;
                    const inMap = {};
                    const outMap = {};

                    purchases.filter(r => r.product_id === pid).forEach(r => { inMap[r.m] = (inMap[r.m] || 0) + Number(r.qty || 0); });
                    trfIn.filter(r => r.product_id === pid).forEach(r => { inMap[r.m] = (inMap[r.m] || 0) + Number(r.qty || 0); });
                    
                    sales.filter(r => r.product_id === pid).forEach(r => { outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0); });
                    waste.filter(r => r.product_id === pid).forEach(r => { outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0); });
                    trfOut.filter(r => r.product_id === pid).forEach(r => { outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0); });

                    let totalIn = 0;
                    let totalOut = 0;
                    for (let m = 1; m <= 12; m++) {
                        totalIn += (inMap[m] || 0);
                        totalOut += (outMap[m] || 0);
                    }

                    const monthlyBalances = {};
                    let running = Number(prod.current_balance || 0);
                    for (let m = 12; m >= 1; m--) {
                        monthlyBalances[m] = Math.max(0, running);
                        running = running - (inMap[m] || 0) + (outMap[m] || 0);
                    }

                    return {
                        id: prod.id,
                        sku: prod.sku,
                        barcode: prod.barcode,
                        category: prod.category,
                        item_name: prod.item_name,
                        cost_price: Number(prod.cost_price || 0),
                        current_balance: Number(prod.current_balance || 0),
                        total_in: totalIn,
                        total_out: totalOut,
                        monthly_balances: monthlyBalances
                    };
                });

                return jsonResponse(report);
            }

            // =================================================================
            // 13. DUAL-MODE DASHBOARD SUMMARY (Corrected Accounting & Timezone)
            // =================================================================
            if (path === "/api/dashboard/summary" && method === "GET") {
                const year = url.searchParams.get("year") || String(new Date().getFullYear());
                const branchId = url.searchParams.get("branch_id");
                const today = getMyanmarTodayDate();

                const targetBranchId = (branchId && branchId !== "ALL") ? Number(branchId) : (currentUserRole === "cashier" ? userBranchId : 1);

                // -------------------------------------------------------------
                // (A) Staff / Cashier Metrics (Today Only & Branch-Specific)
                // -------------------------------------------------------------

                // ၁။ ယနေ့ အရောင်းငွေသား/ဘဏ် နှင့် အရေအတွက် (မြန်မာစံတော်ချိန် +390 mins ဖြင့် စစ်ဆေးခြင်း)
                const todaySalesRow = await env.DB.prepare(`
                    SELECT 
                        COALESCE(SUM(cash_amount), 0) AS today_cash,
                        COALESCE(SUM(bank_amount), 0) AS today_bank,
                        COALESCE(SUM(final_amount), 0) AS today_total
                    FROM sales
                    WHERE branch_id = ? AND date(created_at, '+390 minutes') = ?
                `).bind(targetBranchId, today).first();

                // ယနေ့ ရောင်းရသော အထည်အရေအတွက် စုစုပေါင်း
                const todayItemsRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(si.quantity), 0) AS items_sold
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ?
                `).bind(targetBranchId, today).first();

                // ဆိုင်လက်ကျန်ငွေ (Cash Drawer & Bank Balance from Cashbook)
                const drawerRow = await env.DB.prepare(`
                    SELECT 
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                          WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_drawer,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                          WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_balance
                    FROM cashbook_entries
                    WHERE branch_id = ? AND date(entry_date) <= ?
                `).bind(targetBranchId, today).first();

                // ယနေ့ ရောင်းရသော ပစ္စည်းအမျိုးအစား (Category Breakdown)
                const { results: catSales } = await env.DB.prepare(`
                    SELECT p.category, SUM(si.quantity) AS quantity, SUM(si.subtotal) AS total_amount
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    JOIN products p ON si.product_id = p.id
                    WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ?
                    GROUP BY p.category
                    ORDER BY total_amount DESC
                `).bind(targetBranchId, today).all();

                // ယနေ့ နောက်ဆုံးရောင်းချမှု (၅) စောင်
                const { results: recentSales } = await env.DB.prepare(`
                    SELECT s.invoice_no, s.final_amount, s.payment_method, c.name AS customer_name
                    FROM sales s
                    LEFT JOIN customers c ON s.customer_id = c.id
                    WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ?
                    ORDER BY s.id DESC LIMIT 5
                `).bind(targetBranchId, today).all();

                const staffMetrics = {
                    today_cash: Number(todaySalesRow?.today_cash || 0),
                    today_bank: Number(todaySalesRow?.today_bank || 0),
                    today_total: Number(todaySalesRow?.today_total || 0),
                    today_items_sold: Number(todayItemsRow?.items_sold || 0),
                    cash_drawer: Number(drawerRow?.cash_drawer || 0),
                    bank_balance: Number(drawerRow?.bank_balance || 0),
                    category_sales: catSales || [],
                    recent_sales: recentSales || []
                };

                // -------------------------------------------------------------
                // (B) Admin Metrics (Full Financials, Operating Profit & Expenses)
                // -------------------------------------------------------------
                let salesFilter = ` strftime('%Y', created_at, '+390 minutes') = ? `;
                let salesBindings = [year];
                if (branchId && branchId !== "ALL") {
                    salesFilter += ` AND branch_id = ? `;
                    salesBindings.push(Number(branchId));
                }

                // ၁။ တစ်နှစ်တာ စုစုပေါင်း ဝင်ငွေ (Revenue)
                const revRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(final_amount), 0) AS total_revenue
                    FROM sales
                    WHERE ${salesFilter}
                `).bind(...salesBindings).first();

                // ၂။ ရောင်းရသည့် ပစ္စည်းများ၏ မူလအရင်းစရိတ် (Cost of Goods Sold - COGS)
                let cogsFilter = ` strftime('%Y', s.created_at, '+390 minutes') = ? `;
                let cogsBindings = [year];
                if (branchId && branchId !== "ALL") {
                    cogsFilter += ` AND s.branch_id = ? `;
                    cogsBindings.push(Number(branchId));
                }

                const cogsRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(si.quantity * si.cost_price), 0) AS cogs
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    WHERE ${cogsFilter}
                `).bind(...cogsBindings).first();

                // ၃။ ဆိုင်လည်ပတ်စရိတ်များ (Operating Expenses from Cashbook)
                // COGS တွင် အရင်းပါပြီးဖြစ်သော ဝယ်ယူစရိတ် (5, 6) နှင့် ပင်မဆိုင်ငွေလွှဲ (10) တို့ကို အမြတ်ထဲမှ ၂ ထပ်ကွမ်း မနှုတ်မိစေရန် Exclude လုပ်ခြင်း
                let opexFilter = ` strftime('%Y', entry_date) = ? AND entry_type = 'EXPENSE' AND (purchase_id IS NULL OR category_id NOT IN (5, 6)) AND category_id != 10 `;
                let opexBindings = [year];
                if (branchId && branchId !== "ALL") {
                    opexFilter += ` AND branch_id = ? `;
                    opexBindings.push(Number(branchId));
                }

                const opexRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(amount), 0) AS total_opex
                    FROM cashbook_entries
                    WHERE ${opexFilter}
                `).bind(...opexBindings).first();

                // အသုံးစရိတ် ခေါင်းစဉ်အလိုက် စာရင်း (Expense Breakdown by Category)
                let expCatFilter = ` strftime('%Y', ce.entry_date) = ? AND ce.entry_type = 'EXPENSE' `;
                let expCatBindings = [year];
                if (branchId && branchId !== "ALL") {
                    expCatFilter += ` AND ce.branch_id = ? `;
                    expCatBindings.push(Number(branchId));
                }

                const { results: expBreakdown } = await env.DB.prepare(`
                    SELECT cc.name AS category_name, SUM(ce.amount) AS amount
                    FROM cashbook_entries ce
                    LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                    WHERE ${expCatFilter}
                    GROUP BY cc.name
                    ORDER BY amount DESC
                `).bind(...expCatBindings).all();

                const totalRev = Number(revRow?.total_revenue || 0);
                const cogs = Number(cogsRow?.cogs || 0);
                const operatingExpenses = Number(opexRow?.total_opex || 0);
                const grossProfit = totalRev - cogs;
                const netProfit = grossProfit - operatingExpenses; // စစ်မှန်သော လုပ်ငန်းအသားတင်အမြတ်

                // ၄။ ရရန်ကျန် စုစုပေါင်း အကြွေး (Outstanding Debt)
                const debtRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(current_debt), 0) AS total_debt
                    FROM customers
                    WHERE is_active = 1
                `).first();

                // ၅။ စတော့ စုစုပေါင်း တန်ဖိုး (Total Stock Value)
                let stockValFilter = ` p.is_active = 1 `;
                let stockValBindings = [];
                if (branchId && branchId !== "ALL") {
                    stockValFilter += ` AND bi.branch_id = ? `;
                    stockValBindings.push(Number(branchId));
                }

                const stockValRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(bi.quantity * p.cost_price), 0) AS total_stock_value
                    FROM branch_inventory bi
                    JOIN products p ON bi.product_id = p.id
                    WHERE ${stockValFilter}
                `).bind(...stockValBindings).first();

                // ၆။ ရောင်းအားအကောင်းဆုံး ပစ္စည်းများ (Top Selling Items)
                let topFilter = ` strftime('%Y', s.created_at, '+390 minutes') = ? `;
                let topBindings = [year];
                if (branchId && branchId !== "ALL") {
                    topFilter += ` AND s.branch_id = ? `;
                    topBindings.push(Number(branchId));
                }

                const { results: topItems } = await env.DB.prepare(`
                    SELECT p.item_name, p.category, SUM(si.quantity) AS quantity, SUM(si.subtotal) AS total_sales
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    JOIN products p ON si.product_id = p.id
                    WHERE ${topFilter}
                    GROUP BY p.id
                    ORDER BY quantity DESC LIMIT 6
                `).bind(...topBindings).all();

                // ၇။ ဆိုင်ခွဲတစ်ခုချင်းစီအလိုက် စတော့တန်ဖိုးနှင့် ငွေကြေးအခြေအနေ
                const { results: branches } = await env.DB.prepare("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id ASC").all();
                const branchMetrics = [];

                for (const b of (branches || [])) {
                    const bCashRow = await env.DB.prepare(`
                        SELECT 
                            COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                              WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_net,
                            COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                              WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_net
                        FROM cashbook_entries
                        WHERE branch_id = ?
                    `).bind(b.id).first();

                    const bStockRow = await env.DB.prepare(`
                        SELECT COALESCE(SUM(bi.quantity * p.cost_price), 0) AS stock_value
                        FROM branch_inventory bi
                        JOIN products p ON bi.product_id = p.id
                        WHERE bi.branch_id = ? AND p.is_active = 1
                    `).bind(b.id).first();

                    branchMetrics.push({
                        id: b.id,
                        name: b.name,
                        cash_net: Number(bCashRow?.cash_net || 0),
                        bank_net: Number(bCashRow?.bank_net || 0),
                        stock_value: Number(bStockRow?.stock_value || 0),
                        outstanding_debt: Number(debtRow?.total_debt || 0)
                    });
                }

                const adminMetrics = {
                    total_revenue: totalRev,
                    net_profit: netProfit,
                    gross_profit: grossProfit,
                    total_expenses: operatingExpenses,
                    total_outstanding_debt: Number(debtRow?.total_debt || 0),
                    total_stock_value: Number(stockValRow?.total_stock_value || 0),
                    expense_breakdown: expBreakdown || [],
                    top_selling_items: topItems || [],
                    branch_metrics: branchMetrics
                };

                return jsonResponse({
                    staff: staffMetrics,
                    admin: adminMetrics
                });
            }

            return errorResponse(`Route မတွေ့ပါ: ${method} ${path}`, 404);
        } catch (err) {
            return errorResponse(`Server Error: ${err.message}`, 500);
        }
    },

    async scheduled(event, env, ctx) {
        console.log(`[Cron] Daily maintenance triggered at ${new Date().toISOString()}`);
    }
};
