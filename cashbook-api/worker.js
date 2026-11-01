// =============================================================================
// GARMENT POS & CASHBOOK ALL-IN-ONE BACKEND (Cloudflare Worker)
// File: cashbook-api/worker.js (Full Production Ready Version with Dashboard)
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

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Frontend Static Files (index.html, views/*, js/*) ကို ပြသပေးခြင်း
        if (!path.startsWith("/api")) {
            if (env && env.ASSETS) {
                return env.ASSETS.fetch(request);
            }
            return jsonResponse({
                status: "online",
                version: "2.8.0",
                note: "Frontend assets not bound."
            });
        }

        try {
            // =================================================================
            // 1. HEALTH CHECK
            // =================================================================
            if (path === "/api/health" && method === "GET") {
                return jsonResponse({ status: "online", version: "2.8.0" });
            }

            // =================================================================
            // 1.1. SYSTEM SETTING & EMAIL AUTOMATION (Resend API with Excel/CSV Attachment)
            // =================================================================
            if (path === "/api/system/send-report-email" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const targetYear = String(body.year || new Date().getFullYear());
                const targetEmail = body.email;

                if (!targetEmail) {
                    return errorResponse("အီးမေးလ်လိပ်စာ ထည့်သွင်းပေးပါ", 400);
                }

                if (!env.RESEND_API_KEY) {
                    return errorResponse("Resend API Key ကို Server တွင် ထည့်သွင်းထားခြင်း မရှိသေးပါ", 500);
                }

                // ၁။ D1 Database မှ သက်ဆိုင်ရာ နှစ်အတွက် Products နှင့် လအလိုက် စတော့အချက်အလက်များ ဆွဲယူခြင်း
                const { results: products } = await env.DB.prepare(`
                    SELECT 
                        p.id, p.sku, p.category, p.item_name, p.cost_price,
                        COALESCE(SUM(bi.quantity), 0) AS current_balance
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                    WHERE p.is_active = 1
                    GROUP BY p.id
                    ORDER BY p.category ASC, p.item_name ASC
                `).all();

                // အဝယ် (Purchases)
                const { results: purchases } = await env.DB.prepare(`
                    SELECT pi.product_id, CAST(strftime('%m', p.created_at) AS INTEGER) AS m, SUM(pi.quantity) AS qty
                    FROM purchase_items pi
                    JOIN purchases p ON pi.purchase_id = p.id
                    WHERE strftime('%Y', p.created_at) = ?
                    GROUP BY pi.product_id, m
                `).bind(targetYear).all();

                // အရောင်း (Sales)
                const { results: sales } = await env.DB.prepare(`
                    SELECT si.product_id, CAST(strftime('%m', s.created_at) AS INTEGER) AS m, SUM(si.quantity) AS qty
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    WHERE strftime('%Y', s.created_at) = ?
                    GROUP BY si.product_id, m
                `).bind(targetYear).all();

                // အလေအလွင့်/ပျက်စီး (Waste)
                let waste = [];
                try {
                    const resW = await env.DB.prepare(`
                        SELECT product_id, CAST(strftime('%m', created_at) AS INTEGER) AS m, SUM(quantity) AS qty
                        FROM waste_logs
                        WHERE strftime('%Y', created_at) = ?
                        GROUP BY product_id, m
                    `).bind(targetYear).all();
                    waste = resW.results || [];
                } catch (e) {
                    waste = [];
                }

                // ၂။ Excel တွင် မြန်မာစာ မှန်ကန်စွာဖတ်နိုင်ရန် UTF-8 BOM ဖြင့် CSV ဖိုင် တည်ဆောက်ခြင်း
                const MONTH_KEYS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                let csvContent = "\uFEFF"; // UTF-8 BOM for Microsoft Excel
                csvContent += `စဉ်,အမျိုးအစား,ပစ္စည်းအမည်,SKU,${MONTH_KEYS.map(m => `${m} ${targetYear.slice(-2)}`).join(",")},စုစုပေါင်းအဝင်,စုစုပေါင်းအထွက်,လက်ရှိလက်ကျန်,အရင်းဈေး,စတော့တန်ဖိုး (ကျပ်)\n`;

                let grandTotalStock = 0;
                let grandTotalValuation = 0;
                let grandTotalIn = 0;
                let grandTotalOut = 0;

                (products || []).forEach((prod, index) => {
                    const pid = prod.id;
                    const inMap = {};
                    const outMap = {};

                    purchases.filter(r => r.product_id === pid).forEach(r => {
                        inMap[r.m] = (inMap[r.m] || 0) + Number(r.qty || 0);
                    });

                    sales.filter(r => r.product_id === pid).forEach(r => {
                        outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0);
                    });

                    waste.filter(r => r.product_id === pid).forEach(r => {
                        outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0);
                    });

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

                    const curBal = Number(prod.current_balance || 0);
                    const cost = Number(prod.cost_price || 0);
                    const val = curBal * cost;

                    grandTotalStock += curBal;
                    grandTotalValuation += val;
                    grandTotalIn += totalIn;
                    grandTotalOut += totalOut;

                    const rowValues = [
                        index + 1,
                        `"${String(prod.category || '').replace(/"/g, '""')}"`,
                        `"${String(prod.item_name || '').replace(/"/g, '""')}"`,
                        `"${String(prod.sku || '').replace(/"/g, '""')}"`,
                        ...Array.from({ length: 12 }, (_, i) => monthlyBalances[i + 1] || 0),
                        totalIn,
                        totalOut,
                        curBal,
                        cost,
                        val
                    ];

                    csvContent += rowValues.join(",") + "\n";
                });

                // Total Summary Row
                csvContent += `စုစုပေါင်း,"-","-","-",${Array(12).fill("-").join(",")},${grandTotalIn},${grandTotalOut},${grandTotalStock},-,${grandTotalValuation}\n`;

                // ၃။ CSV Text ကို Base64 အဖြစ် ပြောင်းလဲခြင်း
                const utf8Bytes = new TextEncoder().encode(csvContent);
                let binaryStr = "";
                for (let i = 0; i < utf8Bytes.length; i++) {
                    binaryStr += String.fromCharCode(utf8Bytes[i]);
                }
                const base64Csv = btoa(binaryStr);

                // ၄။ Resend API သို့ Attached ဖိုင်နှင့်တကွ အီးမေးလ် ပေးပို့ခြင်း
                const resendResponse = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        from: "Garment ERP <onboarding@resend.dev>",
                        to: [targetEmail],
                        subject: `မြကမ္ဘာစိုး ပိုးထည်တိုက် - စတော့နှင့် ဘဏ္ဍာရေး အစီရင်ခံစာ (${targetYear})`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 24px; color: #1e293b; background-color: #f8fafc; border-radius: 12px; max-width: 650px; margin: auto;">
                                <div style="border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px;">
                                    <h2 style="color: #064e3b; margin: 0; font-size: 22px;">မြကမ္ဘာစိုး ပိုးထည်တိုက် (GARMENT ERP)</h2>
                                    <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Executive Financial & Stock Movement Report</p>
                                </div>
                                <p style="font-size: 14px; line-height: 1.6;">မင်္ဂလာပါရှင်၊</p>
                                <p style="font-size: 14px; line-height: 1.6;">
                                    Cloudflare D1 Database စနစ်မှ ထုတ်ယူထားသော <b>${targetYear} ခုနှစ်</b> အတွက် ကုန်လက်ကျန်နှင့် စတော့လှုပ်ရှားမှု စာရင်းချုပ် ဖြစ်ပါသည်။
                                </p>
                                <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                                    <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                                        <tr>
                                            <td style="padding: 8px 0; color: #475569;">လက်ရှိ စုစုပေါင်း လက်ကျန်:</td>
                                            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #2563eb;">${grandTotalStock.toLocaleString()} ထည်</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #475569;">စုစုပေါင်း စတော့တန်ဖိုး:</td>
                                            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #d97706;">${grandTotalValuation.toLocaleString()} ကျပ်</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #475569;">ယခုနှစ် စုစုပေါင်း အဝင်:</td>
                                            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #059669;">+${grandTotalIn.toLocaleString()}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 8px 0; color: #475569;">ယခုနှစ် စုစုပေါင်း အထွက်:</td>
                                            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #e11d48;">-${grandTotalOut.toLocaleString()}</td>
                                        </tr>
                                    </table>
                                </div>
                                <p style="font-size: 13px; color: #334155;">
                                    📎 အသေးစိတ် လအလိုက် ကုန်လက်ကျန်ဇယား အပြည့်အစုံကို ပူးတွဲပါ <b>Stock_Movement_Report_${targetYear}.csv</b> (Excel ဖြင့် ဖွင့်နိုင်သည်) ဖိုင်တွင် ကြည့်ရှုနိုင်ပါသည်။
                                </p>
                                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
                                <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
                                    ဤအီးမေးလ်သည် Cloudflare Workers & D1 Engine မှ အလိုအလျောက် ပေးပို့သော စနစ်သုံး အီးမေးလ် ဖြစ်ပါသည်။
                                </p>
                            </div>
                        `,
                        attachments: [
                            {
                                filename: `Stock_Movement_Report_${targetYear}.csv`,
                                content: base64Csv
                            }
                        ]
                    })
                });

                const resendData = await resendResponse.json();

                if (!resendResponse.ok) {
                    return errorResponse(resendData.message || "Failed to send email via Resend", 500);
                }

                return jsonResponse({ success: true, message: "Email with attachment sent successfully", data: resendData });
            }

            // =================================================================
            // 2. AUTH LOGIN
            // =================================================================
            if (path === "/api/auth/login" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { username, password } = body;
                if (!username || !password) {
                    return errorResponse("အသုံးပြုသူအမည်နှင့် စကားဝှက် ထည့်သွင်းပေးပါ", 400);
                }

                const query = `
                    SELECT u.id, u.branch_id, u.username, u.full_name, u.role,
                           b.code AS branch_code, b.name AS branch_name
                    FROM users u
                    LEFT JOIN branches b ON u.branch_id = b.id
                    WHERE LOWER(u.username) = LOWER(?) AND u.password_hash = ? AND u.is_active = 1
                `;
                const user = await env.DB.prepare(query).bind(String(username).trim(), String(password)).first();
                if (!user) {
                    return errorResponse("အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်", 401);
                }

                return jsonResponse({
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
            // 3. BRANCHES
            // =================================================================
            if (path === "/api/branches" && method === "GET") {
                const { results } = await env.DB.prepare(
                    "SELECT id, code, name, type, phone, address FROM branches WHERE is_active = 1 ORDER BY id ASC"
                ).all();
                return jsonResponse(results || []);
            }

            // =================================================================
            // 4. PRODUCTS & STOCK BALANCES
            // =================================================================
            if (path === "/api/products" && method === "GET") {
                const branchId = url.searchParams.get("branch_id");
                const search = url.searchParams.get("search")?.trim() || "";
                const category = url.searchParams.get("category")?.trim() || "";

                let sql = `
                    SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                           p.cost_price, p.retail_price, p.wholesale_price, p.alert_quantity,
                           COALESCE(${branchId ? "bi.quantity" : "0"}, 0) AS current_stock
                    FROM products p
                `;
                const bindings = [];
                if (branchId) {
                    sql += " LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ? ";
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
                const branchId = url.searchParams.get("branch_id");
                if (!code) return errorResponse("Barcode ထည့်သွင်းပေးပါ", 400);

                const sql = `
                    SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                           p.cost_price, p.retail_price, p.wholesale_price, COALESCE(bi.quantity, 0) AS current_stock
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                    WHERE (p.barcode = ? OR p.sku = ?) AND p.is_active = 1 LIMIT 1
                `;
                const product = await env.DB.prepare(sql).bind(branchId ? Number(branchId) : 1, code, code).first();
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
                const targetBranchId = parseInt(body.targetBranchId ?? body.branchId ?? 1, 10) || 1;

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

                if (body.quantity !== undefined && body.branchId) {
                    await env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = excluded.quantity
                    `).bind(Number(body.branchId), productId, parseFloat(body.quantity) || 0).run();
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
            // 5. PURCHASES & STOCK IN
            // =================================================================
            if (path === "/api/purchases" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || 1;

                const sql = `
                    SELECT 
                        pi.id AS item_row_id,
                        p.id AS purchase_id,
                        p.purchase_no,
                        p.supplier_name,
                        p.payment_method,
                        p.bank_account_name,
                        p.total_amount,
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
                const userId = 1;

                const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
                const purchaseNo = `PO-${body.branch_id}-${dateStr}`;

                const purRes = await env.DB.prepare(`
                    INSERT INTO purchases (purchase_no, branch_id, supplier_name, total_amount, payment_method, bank_account_name, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    purchaseNo, Number(body.branch_id), String(body.supplier_name), 
                    parseFloat(body.total_amount), String(body.payment_method), 
                    body.bank_account_name || null, userId
                ).run();

                const newPurId = purRes.meta.last_row_id;
                const batchStatements = [];

                for (const item of body.items) {
                    let targetProductId = item.product_id;

                    if (item.is_new && item.new_product) {
                        const np = item.new_product;
                        const prodRes = await env.DB.prepare(`
                            INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).bind(
                            np.sku || null, null, String(np.category), String(np.item_name),
                            null, np.size || "ထည်", np.color || null,
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

                    batchStatements.push(
                        env.DB.prepare(`INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)`)
                        .bind(newPurId, Number(targetProductId), parseFloat(item.quantity), parseFloat(item.unit_cost), parseFloat(item.subtotal))
                    );

                    batchStatements.push(
                        env.DB.prepare(`
                            INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                            VALUES (?, ?, ?)
                            ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                            quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                        `).bind(Number(body.branch_id), Number(targetProductId), parseFloat(item.quantity))
                    );
                }

                if (body.payment_method !== "credit") {
                    const desc = `${body.supplier_name} ထံမှ အဝယ်ဘောင်ချာ ${purchaseNo}`;
                    batchStatements.push(
                        env.DB.prepare(`
                            INSERT INTO cashbook_entries (branch_id, category_id, purchase_id, entry_type, payment_method, bank_account_name, amount, description, created_by)
                            VALUES (?, 4, ?, 'EXPENSE', ?, ?, ?, ?, ?)
                        `).bind(
                            Number(body.branch_id), newPurId, String(body.payment_method), 
                            body.bank_account_name || null, parseFloat(body.total_amount), 
                            desc, userId
                        )
                    );
                }

                await env.DB.batch(batchStatements);
                return jsonResponse({ message: "အဝယ်စာရင်းနှင့် စတော့အဝင် အောင်မြင်ပါသည်။", purchaseNo }, 201);
            }

            if (path.startsWith("/api/purchases/") && method === "DELETE") {
                const purId = Number(path.split("/").pop());

                const { results: items } = await env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId).all();
                const pur = await env.DB.prepare("SELECT branch_id FROM purchases WHERE id = ?").bind(purId).first();
                const branchId = pur?.branch_id || 1;

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
                const branchId = url.searchParams.get("branch_id") || 1;
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
                const { results } = await env.DB.prepare(sql).bind(Number(branchId)).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/waste" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = Number(body.branch_id || body.branchId || 1);
                const productId = Number(body.product_id || body.productId);
                const quantity = parseFloat(body.quantity);
                const unitCost = parseFloat(body.unit_cost ?? body.unitCost) || 0;
                const reason = String(body.reason || "").trim();
                const userId = Number(body.recorded_by || body.userId || 1);

                if (!branchId || !productId || isNaN(quantity) || quantity <= 0) {
                    return errorResponse("ဆိုင်ခွဲ၊ ပစ္စည်းနှင့် ပျက်စီးပမာဏ မှန်ကန်စွာ ထည့်သွင်းပေးပါ", 400);
                }

                const inv = await env.DB.prepare(`
                    SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?
                `).bind(branchId, productId).first();

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
                    `).bind(refNo, branchId, productId, quantity, unitCost, reason || "ချည်/အထည် ပျက်စီးအလေအလွင့်", userId),

                    env.DB.prepare(`
                        UPDATE branch_inventory 
                        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE branch_id = ? AND product_id = ?
                    `).bind(quantity, branchId, productId)
                ];

                await env.DB.batch(batchStatements);
                return jsonResponse({ message: "အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။", refNo }, 201);
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

                const oldLog = await env.DB.prepare("SELECT branch_id, product_id, quantity, unit_cost FROM waste_logs WHERE id = ?").bind(id).first();
                if (!oldLog) return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

                const diff = Math.round((Number(oldLog.quantity) - newQty) * 1000) / 1000;

                if (diff < 0) {
                    const inv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(oldLog.branch_id), Number(oldLog.product_id)).first();
                    const currentStock = Number(inv?.quantity || 0);
                    if (currentStock + diff < 0) {
                        return errorResponse(`လက်ကျန်စတော့ မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
                    }
                }

                const finalUnitCost = unitCost !== null ? unitCost : Number(oldLog.unit_cost || 0);

                await env.DB.batch([
                    env.DB.prepare("UPDATE waste_logs SET quantity = ?, unit_cost = ?, reason = ? WHERE id = ?")
                        .bind(newQty, finalUnitCost, reason, id),
                    env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                        .bind(diff, Number(oldLog.branch_id), Number(oldLog.product_id))
                ]);

                return jsonResponse({ message: "အလေအလွင့်စာရင်း ပြင်ဆင်ပြီး စတော့လက်ကျန် ပြန်ညှိပြီးပါပြီ။" });
            }

            if (path.startsWith("/api/waste/") && method === "DELETE") {
                const id = Number(path.split("/").pop());
                const oldLog = await env.DB.prepare("SELECT branch_id, product_id, quantity FROM waste_logs WHERE id = ?").bind(id).first();
                if (!oldLog) return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

                await env.DB.batch([
                    env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(oldLog.quantity), Number(oldLog.branch_id), Number(oldLog.product_id)),
                    env.DB.prepare("DELETE FROM waste_logs WHERE id = ?").bind(id)
                ]);

                return jsonResponse({ message: "မှတ်တမ်း ဖျက်သိမ်းပြီး စတော့ထဲသို့ အပြည့်အဝ ပြန်လည် ထည့်သွင်းပြီးပါပြီ။" });
            }

            // =================================================================
            // 7. CASHBOOK CATEGORIES & ENTRIES
            // =================================================================
            if (path === "/api/cashbook/categories" && method === "GET") {
                const { results } = await env.DB.prepare(
                    "SELECT id, name, type, is_system FROM cash_categories WHERE is_active = 1 ORDER BY is_system DESC, id ASC"
                ).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/cashbook/entries" && method === "GET") {
                const branchId = url.searchParams.get("branch_id");
                const startDate = url.searchParams.get("start_date") || getMyanmarTodayDate();
                const endDate = url.searchParams.get("end_date") || startDate;

                let sql = `
                    SELECT ce.id, ce.branch_id, COALESCE(b.name, 'Main Shop') AS branch_name,
                           ce.category_id, COALESCE(cc.name, 'အထွေထွေ') AS category_name,
                           ce.entry_type, ce.payment_method, ce.amount, ce.description, ce.entry_date,
                           ce.sale_id, ce.customer_ledger_id, ce.purchase_id,
                           COALESCE(u.full_name, 'System') AS created_by_name
                    FROM cashbook_entries ce
                    LEFT JOIN branches b ON ce.branch_id = b.id
                    LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                    LEFT JOIN users u ON ce.created_by = u.id
                    WHERE ce.entry_date BETWEEN ? AND ?
                `;
                const bindings = [startDate, endDate];
                if (branchId) {
                    sql += " AND ce.branch_id = ?";
                    bindings.push(String(branchId));
                }
                sql += " ORDER BY ce.entry_date DESC, ce.id DESC LIMIT 500";
                const { results } = await env.DB.prepare(sql).bind(...bindings).all();

                let totalCashIn = 0, totalCashOut = 0, totalBankIn = 0, totalBankOut = 0;
                (results || []).forEach(r => {
                    const amt = parseFloat(r.amount) || 0;
                    const method2 = String(r.payment_method || "cash").toLowerCase();
                    const type = String(r.entry_type || "EXPENSE").toUpperCase();
                    if (method2 === "cash") {
                        if (type === "INCOME") totalCashIn += amt;
                        else totalCashOut += amt;
                    } else {
                        if (type === "INCOME") totalBankIn += amt;
                        else totalBankOut += amt;
                    }
                });

                return jsonResponse({
                    summary: {
                        cash: { in: totalCashIn, out: totalCashOut, net: totalCashIn - totalCashOut },
                        bank: { in: totalBankIn, out: totalBankOut, net: totalBankIn - totalBankOut },
                        totalNet: (totalCashIn - totalCashOut) + (totalBankIn - totalBankOut)
                    },
                    entries: results || []
                });
            }

            if (path === "/api/cashbook/entries" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { branchId, categoryId, entryType, paymentMethod = "cash", amount, description = "", entryDate, createdBy = 1 } = body;
                if (!branchId || !categoryId || !amount) return errorResponse("အချက်အလက် မစုံလင်ပါ", 400);

                const res = await env.DB.prepare(`
                    INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, amount, description, entry_date, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    Number(branchId), Number(categoryId), String(entryType || "EXPENSE").toUpperCase(),
                    String(paymentMethod).toLowerCase(), parseFloat(amount), String(description).trim(),
                    entryDate || getMyanmarTodayDate(), Number(createdBy)
                ).run();

                return jsonResponse({ message: "စာရင်းသွင်းပြီးပါပြီ", id: res.meta.last_row_id }, 201);
            }

            if (path.startsWith("/api/cashbook/entries/") && method === "PUT") {
                const id = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                const { categoryId, entryType, paymentMethod = "cash", amount, description = "", entryDate } = body;

                if (!categoryId || !amount) return errorResponse("အချက်အလက် မစုံလင်ပါ", 400);

                await env.DB.prepare(`
                    UPDATE cashbook_entries SET
                        category_id = ?,
                        entry_type = ?,
                        payment_method = ?,
                        amount = ?,
                        description = ?,
                        entry_date = COALESCE(?, entry_date)
                    WHERE id = ?
                `).bind(
                    Number(categoryId),
                    String(entryType || "EXPENSE").toUpperCase(),
                    String(paymentMethod).toLowerCase(),
                    parseFloat(amount),
                    String(description).trim(),
                    entryDate || null,
                    id
                ).run();

                return jsonResponse({ message: "ငွေစာရင်း ပြင်ဆင်ပြီးပါပြီ" });
            }

            if (path.startsWith("/api/cashbook/entries/") && method === "DELETE") {
                const id = Number(path.split("/").pop());
                await env.DB.prepare("DELETE FROM cashbook_entries WHERE id = ?").bind(id).run();
                return jsonResponse({ message: "ဖျက်ပြီးပါပြီ" });
            }

            // =================================================================
            // 8. POS CHECKOUT & SALES LOGS
            // =================================================================
            if (path === "/api/pos/sales" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || 1;
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
                    WHERE s.branch_id = ? AND date(s.created_at) = ?
                    ORDER BY s.id DESC, si.id ASC
                `;
                const { results } = await env.DB.prepare(sql).bind(Number(branchId), date).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/pos/sales" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const {
                    branchId, customerId = null, saleType = "retail", items = [],
                    discountAmount = 0, paidAmount = 0, paymentMethod = "cash",
                    cashAmount = 0, bankAmount = 0, bankAccountName = null, createdBy = 1
                } = body;

                if (!branchId || items.length === 0) {
                    return errorResponse("ဆိုင်ခွဲနှင့် ပစ္စည်းစာရင်း လိုအပ်ပါသည်", 400);
                }

                let totalAmount = 0;
                for (const item of items) {
                    totalAmount += (parseFloat(item.quantity) * parseFloat(item.unitPrice));
                }
                
                const discount = Math.max(0, parseFloat(discountAmount) || 0);
                const finalAmount = Math.max(0, totalAmount - discount);
                const rawPaid = Math.max(0, parseFloat(paidAmount) || 0);
                const effectivePaid = Math.min(rawPaid, finalAmount);
                const debtAmount = Math.max(0, finalAmount - effectivePaid);

                const todayDate = getMyanmarTodayDate();
                const dateStr = todayDate.replace(/-/g, "");
                const countToday = await env.DB.prepare("SELECT COUNT(id) AS count FROM sales WHERE branch_id = ? AND date(created_at) = ?").bind(Number(branchId), todayDate).first();
                const seq = String((countToday?.count || 0) + 1).padStart(4, "0");
                const invoiceNo = `INV-B${branchId}-${dateStr}-${seq}`;

                // --- Accounting Integrity: Ensure proper cash/bank routing for deposits during credit sales ---
                let pCash = 0;
                let pBank = 0;

                if (paymentMethod === "cash") {
                    pCash = effectivePaid;
                } else if (paymentMethod === "bank") {
                    pBank = effectivePaid;
                } else if (paymentMethod === "credit") {
                    // Route partial paid amounts (deposits) correctly even on credit invoices
                    if (bankAccountName) {
                        pBank = effectivePaid;
                    } else {
                        pCash = effectivePaid;
                    }
                } else {
                    // Fallback to explicit payload values for mixed payments if specified
                    pCash = parseFloat(cashAmount) || 0;
                    pBank = parseFloat(bankAmount) || 0;
                }

                const saleInsert = await env.DB.prepare(`
                    INSERT INTO sales (
                        invoice_no, branch_id, customer_id, sale_type,
                        total_amount, discount_amount, final_amount, paid_amount, debt_amount,
                        payment_method, cash_amount, bank_amount, bank_account_name, created_by, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `).bind(
                    invoiceNo, Number(branchId), customerId ? Number(customerId) : null, saleType,
                    totalAmount, discount, finalAmount, effectivePaid, debtAmount,
                    paymentMethod, pCash, pBank, bankAccountName, Number(createdBy)
                ).run();

                const saleId = saleInsert.meta.last_row_id;
                const subQueries = [];

                for (const item of items) {
                    const qty = parseFloat(item.quantity);
                    const unitPrice = parseFloat(item.unitPrice) || 0;
                    const subtotal = qty * unitPrice;

                    subQueries.push(
                        env.DB.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)")
                            .bind(saleId, Number(item.productId), qty, unitPrice, parseFloat(item.costPrice) || 0, subtotal)
                    );

                    subQueries.push(
                        env.DB.prepare(`
                            INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                            ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity - excluded.quantity
                        `).bind(Number(branchId), Number(item.productId), qty)
                    );
                }

                if (effectivePaid > 0) {
                    if (pCash > 0) {
                        subQueries.push(
                            env.DB.prepare(`
                                INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, amount, description, entry_date, created_by)
                                VALUES (?, 1, ?, 'INCOME', 'cash', ?, ?, ?, ?)
                            `).bind(Number(branchId), saleId, pCash, `အရောင်း ${invoiceNo} (ငွေသား)`, todayDate, Number(createdBy))
                        );
                    }
                    if (pBank > 0) {
                        subQueries.push(
                            env.DB.prepare(`
                                INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, bank_account_name, amount, description, entry_date, created_by)
                                VALUES (?, 1, ?, 'INCOME', 'bank', ?, ?, ?, ?, ?)
                            `).bind(Number(branchId), saleId, bankAccountName || 'Bank', pBank, `အရောင်း ${invoiceNo} (${bankAccountName || 'Bank'})`, todayDate, Number(createdBy))
                        );
                    }
                }

                if (debtAmount > 0 && customerId) {
                    const cust = await env.DB.prepare("SELECT current_debt FROM customers WHERE id = ?").bind(Number(customerId)).first();
                    const newDebt = (Number(cust?.current_debt) || 0) + debtAmount;

                    subQueries.push(
                        env.DB.prepare(`
                            INSERT INTO customer_ledger (customer_id, branch_id, sale_id, type, amount, balance_after, reference_note, created_by)
                            VALUES (?, ?, ?, 'DEBIT', ?, ?, ?, ?)
                        `).bind(Number(customerId), Number(branchId), saleId, debtAmount, newDebt, `ဘောင်ချာ ${invoiceNo} အကြွေးကျန်`, Number(createdBy))
                    );

                    subQueries.push(
                        env.DB.prepare("UPDATE customers SET current_debt = ? WHERE id = ?").bind(newDebt, Number(customerId))
                    );
                }

                if (subQueries.length > 0) {
                    await env.DB.batch(subQueries);
                }

                return jsonResponse({ message: "အရောင်းဘောင်ချာ အောင်မြင်ပါသည်", invoiceNo, saleId, finalAmount }, 201);
            }

            // =================================================================
            // 9. YARN BALANCES & PRODUCTION ISSUE
            // =================================================================
            if (path === "/api/yarns" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || 1;
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
                const { results } = await env.DB.prepare(sql).bind(...bindings).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/yarns" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = Number(body.branch_id || body.branchId || 1);
                const code = body.code || body.sku;
                const name = body.name || body.itemName || body.item_name;

                if (!name) return errorResponse("ချည်အမည် ထည့်သွင်းပေးပါ", 400);

                const sku = code ? String(code).trim().toUpperCase() : `YARN-${Math.floor(1000 + Math.random() * 9000)}`;
                const unit = String(body.unit || body.size || "ပေါင်").trim();
                const costPrice = parseFloat(body.costPrice ?? body.cost_price) || 0;
                const retailPrice = parseFloat(body.retailPrice ?? body.retail_price) || 0;
                const wholesalePrice = parseFloat(body.wholesalePrice ?? body.wholesale_price ?? retailPrice) || 0;
                const initialStock = parseFloat(body.currentStock ?? body.quantity ?? 0) || 0;

                const res = await env.DB.prepare(`
                    INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                    VALUES (?, ?, 'ချည်', ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    sku, body.barcode || null, String(name).trim(),
                    body.pattern || null, unit, body.color || null,
                    costPrice, retailPrice, wholesalePrice
                ).run();

                const newProductId = res.meta.last_row_id;

                if (initialStock > 0) {
                    await env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity
                    `).bind(branchId, newProductId, initialStock).run();
                }

                return jsonResponse({ id: newProductId, sku, message: "ချည်အသစ် သိမ်းဆည်းပြီးပါပြီ" }, 201);
            }

            if (path === "/api/yarns/issue" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = Number(body.branchId || body.branch_id || 1);
                const yarnId = Number(body.yarnId || body.product_id);
                const weaverName = String(body.weaverName || body.weaver_name || "").trim();
                const qty = parseFloat(body.quantity) || 0;
                const notes = String(body.notes || "").trim();
                const createdBy = Number(body.createdBy || body.userId || 1);

                if (!yarnId || !weaverName || qty <= 0) {
                    return errorResponse("ချည်အမျိုးအစား၊ ရက်ကန်းသမားအမည်နှင့် ပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ", 400);
                }

                const inv = await env.DB.prepare(`
                    SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?
                `).bind(branchId, yarnId).first();

                const currentStock = Number(inv?.quantity || 0);
                if (currentStock < qty) {
                    return errorResponse(`ချည်လက်ကျန် မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
                }

                await env.DB.batch([
                    env.DB.prepare(`
                        INSERT INTO yarn_issues (yarn_id, weaver_name, quantity, issue_date, notes, created_by) 
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).bind(yarnId, weaverName, qty, getMyanmarTodayDate(), notes, createdBy),

                    env.DB.prepare(`
                        UPDATE branch_inventory 
                        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE branch_id = ? AND product_id = ?
                    `).bind(qty, branchId, yarnId)
                ]);

                return jsonResponse({ message: "ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု အောင်မြင်ပါသည်။ ချည်စတော့မှ နှုတ်ပြီးပါပြီ။" });
            }

            if (path === "/api/yarns/issues" && method === "GET") {
                const sql = `
                    SELECT 
                        yi.id, yi.weaver_name, yi.quantity, yi.issue_date, yi.notes, yi.created_at,
                        p.sku, p.item_name, p.color, p.size AS unit,
                        COALESCE(u.full_name, 'Admin') AS created_by_name
                    FROM yarn_issues yi
                    INNER JOIN products p ON yi.yarn_id = p.id
                    LEFT JOIN users u ON yi.created_by = u.id
                    ORDER BY yi.id DESC LIMIT 300
                `;
                const { results } = await env.DB.prepare(sql).all();
                return jsonResponse(results || []);
            }

            // =================================================================
            // 10. CUSTOMERS & DEBT LIABILITIES (ဖောက်သည်စာရင်း၊ အကြွေးနှင့် ကြွေးမြီမှတ်တမ်း)
            // =================================================================
            if (path === "/api/customers" && method === "GET") {
                const { results } = await env.DB.prepare(
                    "SELECT *, current_debt AS outstanding_balance FROM customers WHERE is_active = 1 ORDER BY current_debt DESC, name ASC"
                ).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/customers" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                if (!body.name) return errorResponse("ဖောက်သည်အမည် ထည့်သွင်းပေးပါ", 400);

                const initialDebt = parseFloat(body.initialDebt ?? body.current_debt) || 0;

                const res = await env.DB.prepare(`
                    INSERT INTO customers (name, phone, shop_name, customer_type, current_debt, address)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).bind(
                    String(body.name).trim(),
                    body.phone ? String(body.phone).trim() : null,
                    body.shopName ? String(body.shopName).trim() : null,
                    body.customerType || "retail",
                    initialDebt,
                    body.address ? String(body.address).trim() : null
                ).run();

                const newCustId = res.meta.last_row_id;

                if (initialDebt > 0) {
                    await env.DB.prepare(`
                        INSERT INTO customer_ledger (customer_id, branch_id, type, amount, balance_after, payment_method, reference_note, created_by)
                        VALUES (?, 1, 'DEBIT', ?, ?, 'အကြွေး', 'ကနဦး အကြွေးလက်ကျန် (Opening Debt)', 1)
                    `).bind(newCustId, initialDebt, initialDebt).run();
                }

                return jsonResponse({ id: newCustId, message: "ဖောက်သည်အသစ် သိမ်းဆည်းပြီးပါပြီ" }, 201);
            }

            if (path === "/api/customers/repay" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const {
                    customerId,
                    branchId = 1,
                    amount,
                    paymentMethod = "cash",
                    bankAccountName = null,
                    note = "",
                    entryDate,
                    createdBy = 1
                } = body;

                const repayAmt = parseFloat(amount) || 0;
                if (!customerId || repayAmt <= 0) return errorResponse("ပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ", 400);

                const cust = await env.DB.prepare("SELECT name, current_debt FROM customers WHERE id = ?").bind(Number(customerId)).first();
                if (!cust) return errorResponse("ဖောက်သည် ရှာမတွေ့ပါ", 404);

                const newDebt = Math.max(0, Number(cust.current_debt || 0) - repayAmt);
                const today = entryDate || getMyanmarTodayDate();

                await env.DB.batch([
                    env.DB.prepare(`
                        INSERT INTO customer_ledger (customer_id, branch_id, type, amount, balance_after, payment_method, reference_note, created_by)
                        VALUES (?, ?, 'CREDIT', ?, ?, ?, ?, ?)
                    `).bind(
                        Number(customerId),
                        Number(branchId),
                        repayAmt,
                        newDebt,
                        String(paymentMethod).toLowerCase(),
                        note || `အကြွေးဆပ် (${paymentMethod === 'bank' ? (bankAccountName || 'Bank') : 'ငွေသား'})`,
                        Number(createdBy)
                    ),

                    env.DB.prepare("UPDATE customers SET current_debt = ? WHERE id = ?").bind(newDebt, Number(customerId)),

                    env.DB.prepare(`
                        INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, bank_account_name, amount, description, entry_date, created_by)
                        VALUES (?, 2, 'INCOME', ?, ?, ?, ?, ?, ?)
                    `).bind(
                        Number(branchId),
                        String(paymentMethod).toLowerCase(),
                        bankAccountName || null,
                        repayAmt,
                        `${cust.name} အကြွေးဆပ် (${note || (paymentMethod === 'bank' ? bankAccountName : 'ငွေသား')})`,
                        today,
                        Number(createdBy)
                    )
                ]);

                return jsonResponse({ message: "အကြွေးဆပ်ငွေ လက်ခံပြီးပါပြီ", newDebt });
            }

            if (path.startsWith("/api/customers/") && path.endsWith("/ledger") && method === "GET") {
                const parts = path.split("/");
                const customerId = Number(parts[3]);

                if (!customerId) return errorResponse("Customer ID မမှန်ကန်ပါ", 400);

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

            // =================================================================
            // 11. INTER-BRANCH STOCK TRANSFERS (ဆိုင်ခွဲအချင်းချင်း ပစ္စည်းလွှဲပြောင်းပေးပို့ခြင်း)
            // =================================================================
            if (path === "/api/transfers" && method === "GET") {
                const branchId = url.searchParams.get("branch_id");

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

                const { results } = await env.DB.prepare(sql).bind(...bindings).all();
                return jsonResponse(results || []);
            }

            if (path === "/api/transfers" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const fromBranchId = Number(body.fromBranchId || body.from_branch_id);
                const toBranchId = Number(body.toBranchId || body.to_branch_id);
                const productId = Number(body.productId || body.product_id);
                const quantity = parseFloat(body.quantity);
                const notes = String(body.notes || "").trim();
                const createdBy = Number(body.createdBy || body.userId || 1);

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
                    `).bind(transferNo, fromBranchId, toBranchId, productId, quantity, notes || "ဆိုင်အချင်းချင်း ပစ္စည်းလွှဲပြောင်းမှု", createdBy),

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
                    env.DB.prepare("UPDATE stock_transfers SET quantity = ?, notes = ? WHERE id = ?")
                        .bind(newQty, notes, id)
                ];

                if (diff !== 0) {
                    batchStatements.push(
                        env.DB.prepare(`
                            UPDATE branch_inventory 
                            SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                            WHERE branch_id = ? AND product_id = ?
                        `).bind(diff, Number(trf.from_branch_id), Number(trf.product_id))
                    );

                    batchStatements.push(
                        env.DB.prepare(`
                            UPDATE branch_inventory 
                            SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP 
                            WHERE branch_id = ? AND product_id = ?
                        `).bind(diff, Number(trf.to_branch_id), Number(trf.product_id))
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
            // 12. INVENTORY & STOCK REPORTS (လစဉ် စတော့လှုပ်ရှားမှုနှင့် လက်ကျန် အစီရင်ခံစာ)
            // =================================================================
            if (path === "/api/reports/monthly-stock" && method === "GET") {
                const year = url.searchParams.get("year") || String(new Date().getFullYear());
                const branchId = url.searchParams.get("branch_id");

                await env.DB.prepare(`
                    CREATE TABLE IF NOT EXISTS waste_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        reference_no TEXT UNIQUE,
                        branch_id INTEGER NOT NULL DEFAULT 1,
                        product_id INTEGER NOT NULL,
                        quantity REAL NOT NULL,
                        unit_cost REAL DEFAULT 0,
                        reason TEXT,
                        recorded_by INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `).run();

                let prodSql = `
                    SELECT 
                        p.id, p.sku, p.category, p.item_name, p.cost_price,
                        COALESCE(SUM(bi.quantity), 0) AS current_balance
                    FROM products p
                    LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                `;
                const prodBindings = [];
                if (branchId && branchId !== "ALL") {
                    prodSql += ` AND bi.branch_id = ? `;
                    prodBindings.push(Number(branchId));
                }
                prodSql += ` WHERE p.is_active = 1 GROUP BY p.id ORDER BY p.category ASC, p.item_name ASC `;
                const { results: products } = await env.DB.prepare(prodSql).bind(...prodBindings).all();

                let purchases = [];
                try {
                    let purchSql = `
                        SELECT 
                            pi.product_id,
                            CAST(strftime('%m', p.created_at) AS INTEGER) AS m,
                            SUM(pi.quantity) AS qty
                        FROM purchase_items pi
                        JOIN purchases p ON pi.purchase_id = p.id
                        WHERE strftime('%Y', p.created_at) = ?
                    `;
                    const purchBindings = [year];
                    if (branchId && branchId !== "ALL") {
                        purchSql += ` AND p.branch_id = ? `;
                        purchBindings.push(Number(branchId));
                    }
                    purchSql += ` GROUP BY pi.product_id, m `;
                    const res = await env.DB.prepare(purchSql).bind(...purchBindings).all();
                    purchases = res.results || [];
                } catch (e) {
                    purchases = [];
                }

                let sales = [];
                try {
                    let saleSql = `
                        SELECT 
                            si.product_id,
                            CAST(strftime('%m', s.created_at) AS INTEGER) AS m,
                            SUM(si.quantity) AS qty
                        FROM sale_items si
                        JOIN sales s ON si.sale_id = s.id
                        WHERE strftime('%Y', s.created_at) = ?
                    `;
                    const saleBindings = [year];
                    if (branchId && branchId !== "ALL") {
                        saleSql += ` AND s.branch_id = ? `;
                        saleBindings.push(Number(branchId));
                    }
                    saleSql += ` GROUP BY si.product_id, m `;
                    const res = await env.DB.prepare(saleSql).bind(...saleBindings).all();
                    sales = res.results || [];
                } catch (e) {
                    sales = [];
                }

                let waste = [];
                try {
                    let wasteSql = `
                        SELECT 
                            product_id,
                            CAST(strftime('%m', created_at) AS INTEGER) AS m,
                            SUM(quantity) AS qty
                        FROM waste_logs
                        WHERE strftime('%Y', created_at) = ?
                    `;
                    const wasteBindings = [year];
                    if (branchId && branchId !== "ALL") {
                        wasteSql += ` AND branch_id = ? `;
                        wasteBindings.push(Number(branchId));
                    }
                    wasteSql += ` GROUP BY product_id, m `;
                    const res = await env.DB.prepare(wasteSql).bind(...wasteBindings).all();
                    waste = res.results || [];
                } catch (e) {
                    waste = [];
                }

                let trfIn = [];
                let trfOut = [];
                if (branchId && branchId !== "ALL") {
                    try {
                        const trfInRes = await env.DB.prepare(`
                            SELECT product_id, CAST(strftime('%m', created_at) AS INTEGER) AS m, SUM(quantity) AS qty
                            FROM stock_transfers
                            WHERE to_branch_id = ? AND strftime('%Y', created_at) = ?
                            GROUP BY product_id, m
                        `).bind(Number(branchId), year).all();
                        trfIn = trfInRes.results || [];

                        const trfOutRes = await env.DB.prepare(`
                            SELECT product_id, CAST(strftime('%m', created_at) AS INTEGER) AS m, SUM(quantity) AS qty
                            FROM stock_transfers
                            WHERE from_branch_id = ? AND strftime('%Y', created_at) = ?
                            GROUP BY product_id, m
                        `).bind(Number(branchId), year).all();
                        trfOut = trfOutRes.results || [];
                    } catch (e) {
                        trfIn = [];
                        trfOut = [];
                    }
                }

                const report = (products || []).map(prod => {
                    const pid = prod.id;
                    const inMap = {};
                    const outMap = {};

                    purchases.filter(r => r.product_id === pid).forEach(r => {
                        inMap[r.m] = (inMap[r.m] || 0) + Number(r.qty || 0);
                    });

                    trfIn.filter(r => r.product_id === pid).forEach(r => {
                        inMap[r.m] = (inMap[r.m] || 0) + Number(r.qty || 0);
                    });

                    sales.filter(r => r.product_id === pid).forEach(r => {
                        outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0);
                    });

                    waste.filter(r => r.product_id === pid).forEach(r => {
                        outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0);
                    });

                    trfOut.filter(r => r.product_id === pid).forEach(r => {
                        outMap[r.m] = (outMap[r.m] || 0) + Number(r.qty || 0);
                    });

                    let totalIn = 0;
                    let totalOut = 0;
                    const monthlyBalances = {};

                    for (let m = 1; m <= 12; m++) {
                        const mIn = inMap[m] || 0;
                        const mOut = outMap[m] || 0;
                        totalIn += mIn;
                        totalOut += mOut;
                    }

                    let running = Number(prod.current_balance || 0);
                    for (let m = 12; m >= 1; m--) {
                        monthlyBalances[m] = Math.max(0, running);
                        const mIn = inMap[m] || 0;
                        const mOut = outMap[m] || 0;
                        running = running - mIn + mOut;
                    }

                    return {
                        id: prod.id,
                        sku: prod.sku,
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
            // 13. DUAL-MODE DASHBOARD SUMMARY (Executive Admin & Staff Views)
            // =================================================================
            if (path === "/api/dashboard/summary" && method === "GET") {
                const year = url.searchParams.get("year") || String(new Date().getFullYear());
                const branchId = url.searchParams.get("branch_id"); // null, "ALL" or ID
                const today = getMyanmarTodayDate();

                // -------------------------------------------------------------
                // (A) Staff / Cashier Metrics (Today Only & Branch-Specific)
                // -------------------------------------------------------------
                const targetBranchId = (branchId && branchId !== "ALL") ? Number(branchId) : 1;

                // ၁။ ယနေ့ အရောင်းငွေသား/ဘဏ် နှင့် အရေအတွက်
                const todaySalesRow = await env.DB.prepare(`
                    SELECT 
                        COALESCE(SUM(cash_amount), 0) AS today_cash,
                        COALESCE(SUM(bank_amount), 0) AS today_bank,
                        COALESCE(SUM(final_amount), 0) AS today_total
                    FROM sales
                    WHERE branch_id = ? AND date(created_at) = ?
                `).bind(targetBranchId, today).first();

                // ယနေ့ ရောင်းရသော အထည်အရေအတွက် စုစုပေါင်း
                const todayItemsRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(si.quantity), 0) AS items_sold
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    WHERE s.branch_id = ? AND date(s.created_at) = ?
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
                    WHERE s.branch_id = ? AND date(s.created_at) = ?
                    GROUP BY p.category
                    ORDER BY total_amount DESC
                `).bind(targetBranchId, today).all();

                // ယနေ့ နောက်ဆုံးရောင်းချမှု (၅) စောင်
                const { results: recentSales } = await env.DB.prepare(`
                    SELECT s.invoice_no, s.final_amount, s.payment_method, c.name AS customer_name
                    FROM sales s
                    LEFT JOIN customers c ON s.customer_id = c.id
                    WHERE s.branch_id = ? AND date(s.created_at) = ?
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
                // (B) Admin Metrics (Full Financials, Profit, Expenses & Branches)
                // -------------------------------------------------------------
                let salesFilter = ` strftime('%Y', created_at) = ? `;
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

                // ၂။ တစ်နှစ်တာ ကုန်ကျစရိတ် စုစုပေါင်း (Expenses from Cashbook)
                let expFilter = ` strftime('%Y', entry_date) = ? AND entry_type = 'EXPENSE' `;
                let expBindings = [year];
                if (branchId && branchId !== "ALL") {
                    expFilter += ` AND branch_id = ? `;
                    expBindings.push(Number(branchId));
                }

                const expRow = await env.DB.prepare(`
                    SELECT COALESCE(SUM(amount), 0) AS total_expenses
                    FROM cashbook_entries
                    WHERE ${expFilter}
                `).bind(...expBindings).first();

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

                // ၃။ ကုန်ကျစရိတ်နှင့် အဝယ်တန်ဖိုးများ နုတ်ပြီး တစ်နှစ်တာ အသားတင်အမြတ် (Gross Profit & Net Profit)
                let cogsFilter = ` strftime('%Y', s.created_at) = ? `;
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

                const totalRev = Number(revRow?.total_revenue || 0);
                const totalExp = Number(expRow?.total_expenses || 0);
                const cogs = Number(cogsRow?.cogs || 0);
                const grossProfit = totalRev - cogs;
                const netProfit = grossProfit - totalExp;

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
                let topFilter = ` strftime('%Y', s.created_at) = ? `;
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

                // ၇။ ဆိုင်ခွဲတစ်ခုချင်းစီအလိုက် စတော့တန်ဖိုးနှင့် ငွေကြေးအခြေအနေ (Branch Valuation Breakdown)
                const { results: branches } = await env.DB.prepare("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id ASC").all();
                const branchMetrics = [];

                for (const b of (branches || [])) {
                    // Cash Net & Bank Net
                    const bCashRow = await env.DB.prepare(`
                        SELECT 
                            COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                              WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_net,
                            COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                              WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_net
                        FROM cashbook_entries
                        WHERE branch_id = ?
                    `).bind(b.id).first();

                    // Branch Stock Valuation
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
                        outstanding_debt: Number(debtRow?.total_debt || 0) // Customers are centralized
                    });
                }

                const adminMetrics = {
                    total_revenue: totalRev,
                    net_profit: netProfit,
                    gross_profit: grossProfit,
                    total_expenses: totalExp,
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
