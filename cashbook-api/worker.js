// =============================================================================
// GARMENT POS & CASHBOOK ALL-IN-ONE BACKEND (Cloudflare Worker)
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
        headers: { ...corsHeaders, "Content-Type": "application/json;charset=UTF-8" }
    });
}

function errorResponse(message, status = 400) {
    return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json;charset=UTF-8" }
    });
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            // Health Check
            if (path === "/api/health" || path === "/") {
                return jsonResponse({ status: "online", version: "2.3.0" });
            }

            // Auth Login
            if (path === "/api/auth/login" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { username, password } = body;
                if (!username || !password) return errorResponse("အသုံးပြုသူအမည်နှင့် စကားဝှက် ထည့်သွင်းပေးပါ", 400);

                const query = `
                    SELECT u.id, u.branch_id, u.username, u.full_name, u.role, b.code AS branch_code, b.name AS branch_name
                    FROM users u LEFT JOIN branches b ON u.branch_id = b.id
                    WHERE u.username = ? AND u.password_hash = ? AND u.is_active = 1
                `;
                const user = await env.DB.prepare(query).bind(username.trim(), password).first();
                if (!user) return errorResponse("အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်", 401);

                return jsonResponse({
                    user: {
                        id: user.id, username: user.username, fullName: user.full_name,
                        role: user.role, branchId: user.branch_id, branchCode: user.branch_code, branchName: user.branch_name
                    },
                    message: "Login အောင်မြင်ပါသည်"
                });
            }

            // Branches
            if (path === "/api/branches" && method === "GET") {
                const { results } = await env.DB.prepare("SELECT id, code, name, type, phone, address FROM branches WHERE is_active = 1 ORDER BY id ASC").all();
                return jsonResponse(results || []);
            }

            // Products & Stock
            if (path === "/api/products" && method === "GET") {
                const branchId = url.searchParams.get("branch_id");
                const search = url.searchParams.get("search")?.trim() || "";
                const category = url.searchParams.get("category")?.trim() || "";

                let sql = `
                    SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                           p.cost_price, p.retail_price, p.wholesale_price,
                           COALESCE(${branchId ? "bi.quantity" : "(SELECT SUM(quantity) FROM branch_inventory WHERE product_id = p.id)"}, 0) AS current_stock
                    FROM products p
                `;
                const bindings = [];
                if (branchId) {
                    sql += " LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ? ";
                    bindings.push(branchId);
                }
                sql += " WHERE p.is_active = 1 ";
                if (search) {
                    sql += " AND (p.barcode = ? OR p.sku LIKE ? OR p.item_name LIKE ? OR p.pattern LIKE ? OR p.category LIKE ?) ";
                    bindings.push(search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
                }
                if (category) {
                    sql += " AND p.category = ? ";
                    bindings.push(category);
                }
                sql += " ORDER BY p.item_name ASC LIMIT 100";
                const { results } = await env.DB.prepare(sql).bind(...bindings).all();
                return jsonResponse(results || []);
            }

            // Scan Barcode
            if (path === "/api/products/scan" && method === "GET") {
                const code = url.searchParams.get("code")?.trim();
                const branchId = url.searchParams.get("branch_id");
                const sql = `
                    SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                           p.cost_price, p.retail_price, p.wholesale_price, COALESCE(bi.quantity, 0) AS current_stock
                    FROM products p LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                    WHERE (p.barcode = ? OR p.sku = ?) AND p.is_active = 1 LIMIT 1
                `;
                const product = await env.DB.prepare(sql).bind(branchId || null, code, code).first();
                if (!product) return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);
                return jsonResponse(product);
            }

            // Cashbook Categories & Entries
            if (path === "/api/cashbook/categories" && method === "GET") {
                const { results } = await env.DB.prepare("SELECT id, name, type FROM cash_categories WHERE is_active = 1 ORDER BY is_system DESC, name ASC").all();
                return jsonResponse(results || []);
            }

            if (path === "/api/cashbook/entries" && method === "GET") {
                const branchId = url.searchParams.get("branch_id");
                const startDate = url.searchParams.get("start_date") || new Date().toISOString().split("T")[0];
                const endDate = url.searchParams.get("end_date") || startDate;

                let sql = `
                    SELECT ce.id, ce.branch_id, b.name AS branch_name, ce.category_id, cc.name AS category_name,
                           ce.entry_type, ce.payment_method, ce.amount, ce.description, ce.entry_date, u.full_name AS created_by_name
                    FROM cashbook_entries ce
                    JOIN branches b ON ce.branch_id = b.id
                    JOIN cash_categories cc ON ce.category_id = cc.id
                    JOIN users u ON ce.created_by = u.id
                    WHERE ce.entry_date BETWEEN ? AND ?
                `;
                const bindings = [startDate, endDate];
                if (branchId) {
                    sql += " AND ce.branch_id = ?";
                    bindings.push(branchId);
                }
                sql += " ORDER BY ce.id DESC LIMIT 200";
                const { results } = await env.DB.prepare(sql).bind(...bindings).all();

                let totalCashIn = 0, totalCashOut = 0, totalBankIn = 0, totalBankOut = 0;
                (results || []).forEach(r => {
                    const amt = parseFloat(r.amount) || 0;
                    if (r.payment_method === "cash") {
                        if (r.entry_type === "INCOME") totalCashIn += amt; else totalCashOut += amt;
                    } else {
                        if (r.entry_type === "INCOME") totalBankIn += amt; else totalBankOut += amt;
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
                const { branchId, categoryId, entryType, paymentMethod, amount, description, entryDate, createdBy } = body;
                if (!branchId || !categoryId || !amount) return errorResponse("အချက်အလက် မစုံလင်ပါ", 400);

                const res = await env.DB.prepare(`
                    INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, amount, description, entry_date, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(branchId, categoryId, entryType, paymentMethod, parseFloat(amount), description || "", entryDate || new Date().toISOString().split("T")[0], createdBy || 1).run();

                return jsonResponse({ message: "စာရင်းသွင်းပြီးပါပြီ", id: res.meta.last_row_id }, 201);
            }

            if (path.startsWith("/api/cashbook/entries/") && method === "DELETE") {
                const id = path.split("/").pop();
                await env.DB.prepare("DELETE FROM cashbook_entries WHERE id = ?").bind(id).run();
                return jsonResponse({ message: "ဖျက်ပြီးပါပြီ" });
            }

            // POS Checkout (Auto Cashbook & Stock Deduction)
            if (path === "/api/pos/sales" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const {
                    branchId, customerId = null, saleType = "retail", items = [],
                    discountAmount = 0, paidAmount = 0, paymentMethod = "cash",
                    cashAmount = 0, bankAmount = 0, bankAccountName = null, createdBy = 1
                } = body;

                if (!branchId || items.length === 0) return errorResponse("ဆိုင်ခွဲနှင့် ပစ္စည်းစာရင်း လိုအပ်ပါသည်", 400);

                let totalAmount = 0;
                for (const item of items) {
                    totalAmount += (parseInt(item.quantity) * parseFloat(item.unitPrice));
                }
                const discount = parseFloat(discountAmount) || 0;
                const finalAmount = Math.max(0, totalAmount - discount);
                const paid = parseFloat(paidAmount) || 0;
                const debtAmount = Math.max(0, finalAmount - paid);

                const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                const countToday = await env.DB.prepare("SELECT COUNT(id) AS count FROM sales WHERE branch_id = ?").bind(branchId).first();
                const seq = String((countToday?.count || 0) + 1).padStart(4, "0");
                const invoiceNo = `INV-B${branchId}-${dateStr}-${seq}`;

                const saleInsert = await env.DB.prepare(`
                    INSERT INTO sales (invoice_no, branch_id, customer_id, sale_type, total_amount, discount_amount, final_amount, paid_amount, debt_amount, payment_method, cash_amount, bank_amount, bank_account_name, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(invoiceNo, branchId, customerId, saleType, totalAmount, discount, finalAmount, paid, debtAmount, paymentMethod, parseFloat(cashAmount) || 0, parseFloat(bankAmount) || 0, bankAccountName, createdBy).run();

                const saleId = saleInsert.meta.last_row_id;
                const subQueries = [];

                for (const item of items) {
                    const qty = parseInt(item.quantity);
                    const unitPrice = parseFloat(item.unitPrice);
                    const subtotal = qty * unitPrice;

                    subQueries.push(env.DB.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)").bind(saleId, item.productId, qty, unitPrice, item.costPrice || 0, subtotal));
                    subQueries.push(env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, -?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = quantity - excluded.quantity
                    `).bind(branchId, item.productId, qty));
                }

                if (paid > 0) {
                    const pCash = parseFloat(cashAmount) > 0 ? parseFloat(cashAmount) : (paymentMethod === "cash" ? paid : 0);
                    if (pCash > 0) {
                        subQueries.push(env.DB.prepare("INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, amount, description, created_by) VALUES (?, 1, ?, 'INCOME', 'cash', ?, ?, ?)").bind(branchId, saleId, pCash, `အရောင်း ${invoiceNo} (ငွေသား)`, createdBy));
                    }
                    const pBank = parseFloat(bankAmount) > 0 ? parseFloat(bankAmount) : (paymentMethod === "bank" ? paid : 0);
                    if (pBank > 0) {
                        subQueries.push(env.DB.prepare("INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, bank_account_name, amount, description, created_by) VALUES (?, 1, ?, 'INCOME', 'bank', ?, ?, ?, ?)").bind(branchId, saleId, bankAccountName, pBank, `အရောင်း ${invoiceNo} (${bankAccountName || 'Bank'})`, createdBy));
                    }
                }

                await env.DB.batch(subQueries);
                return jsonResponse({ message: "အရောင်းဘောင်ချာ အောင်မြင်ပါသည်", invoiceNo, saleId, finalAmount }, 201);
            }

            return errorResponse(`Route မတွေ့ပါ: ${method} ${path}`, 404);
        } catch (err) {
            return errorResponse(`Server Error: ${err.message}`, 500);
        }
    }
};
