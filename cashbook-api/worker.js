// =============================================================================
// GARMENT POS & CASHBOOK ALL-IN-ONE BACKEND (Cloudflare Worker)
// File: cashbook-api/worker.js (Full Updated Version)
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

        // 1. Frontend Static Files (index.html, views/*, js/*) ကို ပြသပေးခြင်း
        if (!path.startsWith("/api")) {
            if (env && env.ASSETS) {
                return env.ASSETS.fetch(request);
            }
            return jsonResponse({
                status: "online",
                version: "2.5.0",
                note: "Frontend assets not bound. Please deploy via 'npx wrangler deploy' or GitHub push."
            });
        }

        try {
            // =================================================================
            // 1. HEALTH CHECK
            // =================================================================
            if (path === "/api/health") {
                return jsonResponse({ status: "online", version: "2.5.0" });
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
                /** @type {any[]} */
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
                const initialStock = parseInt(body.initialStock ?? body.quantity ?? 0, 10) || 0;
                const targetBranchId = parseInt(body.targetBranchId ?? body.branchId ?? 1, 10) || 1;

                const res = await env.DB.prepare(`
                    INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    sku, barcode, String(body.category).trim(), String(itemName).trim(),
                    body.pattern ? String(body.pattern).trim() : null,
                    body.size ? String(body.size).trim() : "Free Size",
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
                    `).bind(Number(body.branchId), productId, parseInt(body.quantity, 10) || 0).run();
                }

                return jsonResponse({ message: "ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ" });
            }

            // ပစ္စည်းအား စာရင်းမှ ဖျက်ပစ်ခြင်း (Soft Delete: is_active = 0)
            if (path.startsWith("/api/products/") && method === "DELETE") {
                const productId = Number(path.split("/").pop());
                if (!productId) return errorResponse("Product ID မမှန်ကန်ပါ", 400);

                await env.DB.prepare("UPDATE products SET is_active = 0 WHERE id = ?").bind(productId).run();
                return jsonResponse({ message: "အထည်စာရင်းမှ အောင်မြင်စွာ ဖျက်ပြီးပါပြီ" });
            }

            // =================================================================
            // 5. PURCHASES & STOCK IN (အဝယ်၊ စတော့အဝင်၊ ပြင်ဆင်ခြင်းနှင့် ဖျက်သိမ်းခြင်း)
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

                    // ပစ္စည်းအသစ်ဖြစ်ပါက products ဇယားထဲ ဦးစွာ ထည့်သွင်းမည်
                    if (item.is_new && item.new_product) {
                        const np = item.new_product;
                        const prodRes = await env.DB.prepare(`
                            INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).bind(
                            np.sku || null, null, String(np.category), String(np.item_name),
                            null, np.size || "Free Size", np.color || null,
                            parseFloat(item.unit_cost), parseFloat(item.retail_price), parseFloat(item.wholesale_price)
                        ).run();

                        targetProductId = prodRes.meta.last_row_id;
                    } else {
                        // ရှိပြီးသားပစ္စည်းဖြစ်ပါက ဝယ်ဈေးနှင့် ရောင်းဈေးများကို နောက်ဆုံးဈေးနှုန်းဖြင့် Update လုပ်မည်
                        batchStatements.push(
                            env.DB.prepare(`
                                UPDATE products SET cost_price = ?, retail_price = ?, wholesale_price = ? WHERE id = ?
                            `).bind(parseFloat(item.unit_cost), parseFloat(item.retail_price), parseFloat(item.wholesale_price), Number(targetProductId))
                        );
                    }

                    // Purchase Items ထည့်သွင်းခြင်း
                    batchStatements.push(
                        env.DB.prepare(`INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)`)
                        .bind(newPurId, Number(targetProductId), Number(item.quantity), parseFloat(item.unit_cost), parseFloat(item.subtotal))
                    );
                    
                    // Stock Balances (branch_inventory) တိုးမြှင့်ခြင်း
                    batchStatements.push(
                        env.DB.prepare(`
                            INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                            VALUES (?, ?, ?)
                            ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                            quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                        `).bind(Number(body.branch_id), Number(targetProductId), Number(item.quantity))
                    );
                }

                // Cashbook Expense (ချည်/အထည်ဝယ်ယူစရိတ် Category 4) သို့ အလိုအလျောက် သွင်းခြင်း
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

            // အဝယ်ဘောင်ချာ ဖျက်သိမ်းခြင်း (စတော့နှင့် Cashbook ပါ ပြန်လည် နုတ်ယူရှင်းလင်းမည်)
            if (path.startsWith("/api/purchases/") && method === "DELETE") {
                const purId = Number(path.split("/").pop());
                
                const { results: items } = await env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId).all();
                const pur = await env.DB.prepare("SELECT branch_id FROM purchases WHERE id = ?").bind(purId).first();
                const branchId = pur?.branch_id || 1;

                const batchRollback = [];

                (items || []).forEach(it => {
                    batchRollback.push(
                        env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ? WHERE branch_id = ? AND product_id = ?")
                            .bind(Number(it.quantity), Number(branchId), Number(it.product_id))
                    );
                });

                batchRollback.push(env.DB.prepare("DELETE FROM cashbook_entries WHERE purchase_id = ?").bind(purId));
                batchRollback.push(env.DB.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").bind(purId));
                batchRollback.push(env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(purId));

                await env.DB.batch(batchRollback);
                return jsonResponse({ message: "အဝယ်စာရင်း ဖျက်သိမ်းပြီး စတော့နှင့် ငွေစာရင်း ပြန်ညှိပြီးပါပြီ။" });
            }

            // =================================================================
            // 6. WASTE / DAMAGE LOGS (အလေအလွင့် စာရင်း ရယူခြင်း၊ သွင်းခြင်း၊ ပြင်ခြင်း၊ ဖျက်ခြင်း)
            // =================================================================
            
            // (၁) အလေအလွင့် စာရင်းများကို ဆွဲယူပြသပေးမည့် GET Route
            if (path === "/api/waste" && method === "GET") {
                const branchId = url.searchParams.get("branch_id") || 1;
                const sql = `
                    SELECT 
                        w.id, w.reference_no, w.branch_id, w.quantity, w.unit_cost, w.reason, w.created_at,
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

            // (၂) အလေအလွင့် စာရင်း အသစ်သွင်းမည့် POST Route (ချည် ဒသမကိန်း lb ပါ လက်ခံသည်)
            if (path === "/api/waste" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = Number(body.branch_id || body.branchId);
                const productId = Number(body.product_id || body.productId);
                // ချည် ပေါင် (lb) ဒသမကိန်းများပါ လက်ခံနိုင်ရန် parseFloat အသုံးပြုထားပါသည်
                const quantity = parseFloat(body.quantity);
                const unitCost = parseFloat(body.unit_cost ?? body.unitCost) || 0;
                const reason = String(body.reason || "").trim();
                const userId = Number(body.recorded_by || body.userId || 1);

                if (!branchId || !productId || isNaN(quantity) || quantity <= 0) {
                    return errorResponse("ဆိုင်ခွဲ၊ ပစ္စည်းနှင့် ပျက်စီးပမာဏ မှန်ကန်စွာ ထည့်သွင်းပေးပါ", 400);
                }

                // လက်ကျန်စတော့ စစ်ဆေးခြင်း
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

            // (၃) အလေအလွင့် စာရင်း ပြင်ဆင်မည့် PUT Route (စတော့ အလိုအလျောက် ပြန်ညှိမည်)
            if (path.startsWith("/api/waste/") && method === "PUT") {
                const id = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                const newQty = parseFloat(body.quantity);
                const reason = String(body.reason || "").trim();

                if (!id || isNaN(newQty) || newQty <= 0) {
                    return errorResponse("မှန်ကန်သော အရေအတွက်/ပမာဏ ထည့်သွင်းပါ", 400);
                }

                const oldLog = await env.DB.prepare("SELECT branch_id, product_id, quantity FROM waste_logs WHERE id = ?").bind(id).first();
                if (!oldLog) return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

                // ကွာခြားချက် ရှာဖွေခြင်း (ဒသမကိန်း တိကျစေရန် တွက်ချက်ထားပါသည်)
                const diff = Math.round((Number(oldLog.quantity) - newQty) * 1000) / 1000;

                // အရေအတွက် ပိုတိုး၍ လျော့မည်ဆိုပါက စတော့လက်ကျန် လုံလောက်မှု ရှိ/မရှိ စစ်ဆေးခြင်း
                if (diff < 0) {
                    const inv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                        .bind(Number(oldLog.branch_id), Number(oldLog.product_id)).first();
                    const currentStock = Number(inv?.quantity || 0);
                    if (currentStock + diff < 0) {
                        return errorResponse(`လက်ကျန်စတော့ မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
                    }
                }

                await env.DB.batch([
                    env.DB.prepare("UPDATE waste_logs SET quantity = ?, reason = ? WHERE id = ?")
                        .bind(newQty, reason, id),
                    env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                        .bind(diff, Number(oldLog.branch_id), Number(oldLog.product_id))
                ]);

                return jsonResponse({ message: "အလေအလွင့်စာရင်း ပြင်ဆင်ပြီး စတော့လက်ကျန် ပြန်ညှိပြီးပါပြီ။" });
            }

            // (၄) အလေအလွင့် စာရင်း ဖျက်ပစ်မည့် DELETE Route (စတော့ထဲသို့ အပြည့်အဝ ပြန်ပေါင်းထည့်မည်)
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

            // Cashbook Entry ပြင်ဆင်ခြင်း (Edit)
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
            // 8. POS CHECKOUT (Auto Cashbook, Stock Deduction & Customer Debt)
            // =================================================================
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
                    totalAmount += (parseInt(item.quantity, 10) * parseFloat(item.unitPrice));
                }
                const discount = Math.max(0, parseFloat(discountAmount) || 0);
                const finalAmount = Math.max(0, totalAmount - discount);
                const rawPaid = Math.max(0, parseFloat(paidAmount) || 0);
                const effectivePaid = Math.min(rawPaid, finalAmount);
                const debtAmount = Math.max(0, finalAmount - effectivePaid);

                const todayDate = getMyanmarTodayDate();
                const dateStr = todayDate.replace(/-/g, "");
                const countToday = await env.DB.prepare("SELECT COUNT(id) AS count FROM sales WHERE branch_id = ?").bind(Number(branchId)).first();
                const seq = String((countToday?.count || 0) + 1).padStart(4, "0");
                const invoiceNo = `INV-B${branchId}-${dateStr}-${seq}`;

                const pCash = paymentMethod === "cash" ? effectivePaid : (parseFloat(cashAmount) || 0);
                const pBank = paymentMethod === "bank" ? effectivePaid : (parseFloat(bankAmount) || 0);

                const saleInsert = await env.DB.prepare(`
                    INSERT INTO sales (
                        invoice_no, branch_id, customer_id, sale_type,
                        total_amount, discount_amount, final_amount, paid_amount, debt_amount,
                        payment_method, cash_amount, bank_amount, bank_account_name, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    invoiceNo, Number(branchId), customerId ? Number(customerId) : null, saleType,
                    totalAmount, discount, finalAmount, effectivePaid, debtAmount,
                    paymentMethod, pCash, pBank, bankAccountName, Number(createdBy)
                ).run();

                const saleId = saleInsert.meta.last_row_id;
                const subQueries = [];

                for (const item of items) {
                    const qty = parseInt(item.quantity, 10);
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
                            `).bind(Number(branchId), saleId, bankAccountName, pBank, `အရောင်း ${invoiceNo} (${bankAccountName || "Bank"})`, todayDate, Number(createdBy))
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
            // 9. YARN BALANCES & PRODUCTION ISSUE (ချည်စတို နှင့် ရက်ကန်းထုတ်ပေးမှု)
            // =================================================================
            
            // (၁) ချည်စာရင်းများနှင့် လက်ကျန်စတော့ ဆွဲယူခြင်း (products & branch_inventory JOIN)
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
                      AND (p.category LIKE '%ချည်%' OR p.category LIKE '%yarn%' OR p.item_name LIKE '%ချည်%')
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

            // (၂) ချည်အသစ် တိုက်ရိုက်မှတ်ပုံတင်ခြင်း (products နှင့် branch_inventory ထဲသို့ ထည့်သွင်းခြင်း)
            if (path === "/api/yarns" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const branchId = Number(body.branch_id || body.branchId || 1);
                const code = body.code || body.sku;
                const name = body.name || body.itemName || body.item_name;

                if (!name) return errorResponse("ချည်အမည် ထည့်သွင်းပေးပါ", 400);

                const sku = code ? String(code).trim().toUpperCase() : `YARN-${Math.floor(1000 + Math.random() * 9000)}`;
                const unit = String(body.unit || body.size || "lb").trim();
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

            // (၃) ရက်ကန်းသမားထံ ချည်ထုတ်ပေးခြင်း (branch_inventory မှ စတော့ နှုတ်ယူခြင်း)
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

                // branch_inventory ရှိ ချည်လက်ကျန်စစ်ဆေးခြင်း
                const inv = await env.DB.prepare(`
                    SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?
                `).bind(branchId, yarnId).first();

                const currentStock = Number(inv?.quantity || 0);
                if (currentStock < qty) {
                    return errorResponse(`ချည်လက်ကျန် မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
                }

                await env.DB.batch([
                    // ရက်ကန်းထုတ် မှတ်တမ်းသွင်းခြင်း
                    env.DB.prepare(`
                        INSERT INTO yarn_issues (yarn_id, weaver_name, quantity, issue_date, notes, created_by) 
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).bind(yarnId, weaverName, qty, getMyanmarTodayDate(), notes, createdBy),
                    
                    // branch_inventory ထဲမှ ချည်လက်ကျန် တိုက်ရိုက်နှုတ်ယူခြင်း
                    env.DB.prepare(`
                        UPDATE branch_inventory 
                        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE branch_id = ? AND product_id = ?
                    `).bind(qty, branchId, yarnId)
                ]);

                return jsonResponse({ message: "ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု အောင်မြင်ပါသည်။ ချည်စတော့မှ နှုတ်ပြီးပါပြီ။" });
            }

            // (၄) ရက်ကန်းထုတ်ပေးခဲ့သော မှတ်တမ်းဟောင်းများ ဆွဲယူခြင်း (Audit Log)
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
            // 10. CUSTOMERS & DEBT LIABILITIES
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
                const res = await env.DB.prepare(`
                    INSERT INTO customers (name, phone, shop_name, customer_type, current_debt, address)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).bind(
                    String(body.name).trim(), body.phone ? String(body.phone).trim() : null,
                    body.shopName ? String(body.shopName).trim() : null, body.customerType || "retail",
                    parseFloat(body.initialDebt) || 0, body.address ? String(body.address).trim() : null
                ).run();
                return jsonResponse({ id: res.meta.last_row_id, message: "ဖောက်သည်အသစ် သိမ်းဆည်းပြီးပါပြီ" }, 201);
            }

            if (path === "/api/customers/repay" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { customerId, branchId = 1, amount, paymentMethod = "cash", note = "", createdBy = 1 } = body;
                const repayAmt = parseFloat(amount) || 0;
                if (!customerId || repayAmt <= 0) return errorResponse("ပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ", 400);

                const cust = await env.DB.prepare("SELECT name, current_debt FROM customers WHERE id = ?").bind(Number(customerId)).first();
                if (!cust) return errorResponse("ဖောက်သည် ရှာမတွေ့ပါ", 404);

                const newDebt = Math.max(0, Number(cust.current_debt || 0) - repayAmt);
                const today = getMyanmarTodayDate();

                await env.DB.batch([
                    env.DB.prepare(`
                        INSERT INTO customer_ledger (customer_id, branch_id, type, amount, balance_after, payment_method, reference_note, created_by)
                        VALUES (?, ?, 'CREDIT', ?, ?, ?, ?, ?)
                    `).bind(Number(customerId), Number(branchId), repayAmt, newDebt, paymentMethod, note || "အကြွေးဆပ်", Number(createdBy)),
                    env.DB.prepare("UPDATE customers SET current_debt = ? WHERE id = ?").bind(newDebt, Number(customerId)),
                    env.DB.prepare(`
                        INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, amount, description, entry_date, created_by)
                        VALUES (?, 2, 'INCOME', ?, ?, ?, ?, ?)
                    `).bind(Number(branchId), paymentMethod, repayAmt, `${cust.name} အကြွေးဆပ် (${note || paymentMethod})`, today, Number(createdBy))
                ]);

                return jsonResponse({ message: "အကြွေးဆပ်ငွေ လက်ခံပြီးပါပြီ", newDebt });
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
