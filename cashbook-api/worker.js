// =============================================================================
// GARMENT POS & CASHBOOK ALL-IN-ONE BACKEND (Cloudflare Worker)
// File: cashbook-api/worker.js (Zero TypeScript Warnings Version)
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
                version: "2.4.0",
                note: "Frontend assets not bound. Please deploy via 'npx wrangler deploy' or GitHub push."
            });
        }

        try {
            // =================================================================
            // 1. HEALTH CHECK
            // =================================================================
            if (path === "/api/health") {
                return jsonResponse({ status: "online", version: "2.4.0" });
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
                           COALESCE(${branchId ? "bi.quantity" : "(SELECT SUM(quantity) FROM branch_inventory WHERE product_id = p.id)"}, 0) AS current_stock
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
                    sku,
                    barcode,
                    String(body.category).trim(),
                    String(itemName).trim(),
                    body.pattern ? String(body.pattern).trim() : null,
                    body.size ? String(body.size).trim() : "Free Size",
                    body.color ? String(body.color).trim() : null,
                    costPrice,
                    retailPrice,
                    wholesalePrice
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
                    body.sku ?? null,
                    body.barcode ?? null,
                    body.category ?? null,
                    body.itemName ?? body.item_name ?? null,
                    body.pattern ?? null,
                    body.size ?? null,
                    body.color ?? null,
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

            // =================================================================
            // 5. CASHBOOK CATEGORIES & ENTRIES
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
                // ✅ FIXED: String(branchId) သုံးထားသဖြင့် ts(2345) အနီရောင်မျဉ်း လုံးဝ မတက်တော့ပါ
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
                    Number(branchId),
                    Number(categoryId),
                    String(entryType || "EXPENSE").toUpperCase(),
                    String(paymentMethod).toLowerCase(),
                    parseFloat(amount),
                    String(description).trim(),
                    entryDate || getMyanmarTodayDate(),
                    Number(createdBy)
                ).run();

                return jsonResponse({ message: "စာရင်းသွင်းပြီးပါပြီ", id: res.meta.last_row_id }, 201);
            }

            if (path.startsWith("/api/cashbook/entries/") && method === "DELETE") {
                const id = Number(path.split("/").pop());
                await env.DB.prepare("DELETE FROM cashbook_entries WHERE id = ?").bind(id).run();
                return jsonResponse({ message: "ဖျက်ပြီးပါပြီ" });
            }

            // =================================================================
            // 6. POS CHECKOUT (Auto Cashbook, Stock Deduction & Customer Debt)
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
                    invoiceNo,
                    Number(branchId),
                    customerId ? Number(customerId) : null,
                    saleType,
                    totalAmount,
                    discount,
                    finalAmount,
                    effectivePaid,
                    debtAmount,
                    paymentMethod,
                    pCash,
                    pBank,
                    bankAccountName,
                    Number(createdBy)
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
                            ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity
                        `).bind(Number(branchId), Number(item.productId), -qty)
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
            // 7. YARN BALANCES (ချည်စတို)
            // =================================================================
            if (path === "/api/yarns" && method === "GET") {
                const { results } = await env.DB.prepare("SELECT * FROM yarn_items WHERE is_active = 1 ORDER BY id DESC").all();
                return jsonResponse(results || []);
            }

            if (path === "/api/yarns" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                if (!body.code || !body.name) return errorResponse("ချည်ကုတ်နှင့် အမည် ထည့်သွင်းပေးပါ", 400);
                const res = await env.DB.prepare(`
                    INSERT INTO yarn_items (code, name, color, unit, current_stock, alert_stock)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).bind(
                    String(body.code).trim().toUpperCase(),
                    String(body.name).trim(),
                    body.color ? String(body.color).trim() : null,
                    body.unit || "lb",
                    parseFloat(body.currentStock) || 0,
                    parseFloat(body.alertStock) || 0
                ).run();
                return jsonResponse({ id: res.meta.last_row_id, message: "ချည်အသစ် သိမ်းဆည်းပြီးပါပြီ" }, 201);
            }

            if (path === "/api/yarns/issue" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { yarnId, weaverName, quantity, notes = "", createdBy = 1 } = body;
                const qty = parseFloat(quantity) || 0;
                if (!yarnId || !weaverName || qty <= 0) return errorResponse("အချက်အလက် ပြည့်စုံစွာ ဖြည့်သွင်းပါ", 400);

                await env.DB.batch([
                    env.DB.prepare("INSERT INTO yarn_issues (yarn_id, weaver_name, quantity, issue_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)")
                        .bind(Number(yarnId), String(weaverName).trim(), qty, getMyanmarTodayDate(), String(notes).trim(), Number(createdBy)),
                    env.DB.prepare("UPDATE yarn_items SET current_stock = current_stock - ? WHERE id = ?")
                        .bind(qty, Number(yarnId))
                ]);
                return jsonResponse({ message: "ချည်ထုတ်ပေးမှု မှတ်တမ်းတင်ပြီးပါပြီ" });
            }

            // =================================================================
            // 8. CUSTOMERS & DEBT LIABILITIES
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
                    String(body.name).trim(),
                    body.phone ? String(body.phone).trim() : null,
                    body.shopName ? String(body.shopName).trim() : null,
                    body.customerType || "retail",
                    parseFloat(body.initialDebt) || 0,
                    body.address ? String(body.address).trim() : null
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
