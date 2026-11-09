// =============================================================================
// FILE 5 OF 5: cashbook-api/worker.js
// MAIN WORKER ENTRYPOINT, AUTH, REPORTS, DASHBOARD & AUTOMATED CRON CLOSING
// Version: 3.1.0 (Modular 5-File Architecture - D1 Quota Optimized & Security Hardened)
// =============================================================================

import {
    corsHeaders,
    configureRequestContext,
    jsonResponse,
    errorResponse,
    getMyanmarTodayDate,
    roundKyat,
    roundQty,
    ensureSchemaOnce,
    checkLoginRateLimit,
    recordLoginAttempt,
    getJwtSecret,
    hashPassword,
    verifyPassword,
    signToken,
    getAuthUser
} from "./utils.js";

import { handleInventoryRoutes } from "./routes-inventory.js";
import { handleTransactionRoutes } from "./routes-transactions.js";
import { handleFinanceRoutes } from "./routes-finance.js";

export default {
    async fetch(request, env, ctx) {
        // Apply Dynamic CORS Origin & Security Headers
        configureRequestContext(request, env);

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Frontend Static Assets
        if (!path.startsWith("/api")) {
            if (env && env.ASSETS) {
                return env.ASSETS.fetch(request);
            }
            return jsonResponse({
                status: "online",
                version: "3.1.0",
                note: "Frontend assets not bound."
            });
        }

        try {
            // 1. Health Check (Zero D1 Reads)
            if (path === "/api/health" && method === "GET") {
                return jsonResponse({ status: "online", version: "3.1.0" });
            }

            // One-time lazy schema & index verification per isolate
            await ensureSchemaOnce(env.DB);

            // 2. Auth Login (With Brute-Force Rate Limiting & Auto PBKDF2 Upgrade)
            if (path === "/api/auth/login" && method === "POST") {
                const rateCheck = checkLoginRateLimit(request);
                if (!rateCheck.allowed) {
                    return errorResponse(
                        `စကားဝှက် မှားယွင်းမှု များနေပါသဖြင့် (${rateCheck.waitSeconds}) စက္ကန့် စောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ`,
                        429
                    );
                }

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
                    recordLoginAttempt(request, false);
                    return errorResponse("အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်", 401);
                }

                // Clear failed login attempts on success
                recordLoginAttempt(request, true);

                // Auto-upgrade legacy seed password hash & sync plain_password for Admin view
                if (user.password_hash && !String(user.password_hash).startsWith("pbkdf2:")) {
                    const upgradedHash = await hashPassword(String(password));
                    await env.DB.prepare("UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?")
                        .bind(upgradedHash, String(password), user.id)
                        .run()
                        .catch(() => {});
                } else {
                    await env.DB.prepare("UPDATE users SET plain_password = ? WHERE id = ?")
                        .bind(String(password), user.id)
                        .run()
                        .catch(() => {});
                }
            
                const secret = getJwtSecret(env);
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

            // 2.1. Password Change (Self)
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

                const secureHash = await hashPassword(String(newPassword).trim());
                await env.DB.prepare("UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?")
                    .bind(secureHash, String(newPassword).trim(), currentUserId)
                    .run();
                return jsonResponse({ message: "စကားဝှက် အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ" });
            }

            // 2.2. Admin Only: Get All Users & Current Passwords (For System Setting)
            if (path === "/api/system/users" && method === "GET") {
                if (currentUserRole !== "admin") {
                    return errorResponse("အသုံးပြုသူစာရင်း ကြည့်ရှုခွင့်ကို Admin သာ ခွင့်ပြုပါသည်", 403);
                }

                const { results } = await env.DB.prepare(`
                    SELECT u.id, u.username, u.full_name, u.role, u.branch_id,
                           COALESCE(u.plain_password, '123456') AS current_password,
                           b.name AS branch_name, b.code AS branch_code
                    FROM users u
                    LEFT JOIN branches b ON u.branch_id = b.id
                    WHERE u.is_active = 1
                    ORDER BY u.id ASC
                `).all();

                return jsonResponse(results || []);
            }

            // 2.3. Admin Only: Direct Password Reset for Any User (Without Old Password)
            if (path === "/api/system/reset-password" && method === "POST") {
                if (currentUserRole !== "admin") {
                    return errorResponse("စကားဝှက် ပြောင်းလဲပေးခွင့်ကို Admin သာ ခွင့်ပြုပါသည်", 403);
                }

                const body = await request.json().catch(() => ({}));
                const targetUserId = Number(body.user_id || body.userId);
                const newPassword = String(body.new_password || body.newPassword || "").trim();

                if (!targetUserId || newPassword.length < 4) {
                    return errorResponse("အသုံးပြုသူ ရွေးချယ်ပြီး စကားဝှက်အသစ် (အနည်းဆုံး ၄ လုံး) ထည့်သွင်းပေးပါ", 400);
                }

                const targetUser = await env.DB.prepare("SELECT id, username, full_name FROM users WHERE id = ?").bind(targetUserId).first();
                if (!targetUser) {
                    return errorResponse("အသုံးပြုသူ ရှာမတွေ့ပါ", 404);
                }

                const secureHash = await hashPassword(newPassword);
                await env.DB.prepare("UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?")
                    .bind(secureHash, newPassword, targetUserId)
                    .run();

                return jsonResponse({
                    message: `${targetUser.full_name || targetUser.username} အတွက် စကားဝှက်အသစ် ပြောင်းလဲသိမ်းဆည်းပြီးပါပြီ`,
                    current_password: newPassword
                });
            }

            // =================================================================
            // DELEGATE TO MODULAR ROUTE HANDLERS (FILES 2, 3, 4)
            // =================================================================
            const invResponse = await handleInventoryRoutes(request, env, url, path, method, auth);
            if (invResponse) return invResponse;

            const txResponse = await handleTransactionRoutes(request, env, url, path, method, auth);
            if (txResponse) return txResponse;

            const finResponse = await handleFinanceRoutes(request, env, url, path, method, auth);
            if (finResponse) return finResponse;

            // =================================================================
            // 3. MONTHLY 12-MONTH STOCK REPORT (D1 BATCHED & ALL-BRANCH FIXED)
            // =================================================================
            if (path === "/api/reports/monthly-stock" && method === "GET") {
                const year = url.searchParams.get("year") || String(new Date().getFullYear());
                const branchId = url.searchParams.get("branch_id");
                const isSpecificBranch = Boolean(branchId && branchId !== "ALL");
                const yearStart = `${year}-01-01`;
                const yearEnd = `${year}-12-31 23:59:59`;

                let prodSql = "";
                const prodBindings = [];
                if (isSpecificBranch) {
                    prodSql = `
                        SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.cost_price,
                               COALESCE(bi.quantity, 0) AS current_balance
                        FROM products p
                        LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                        WHERE p.is_active = 1
                        ORDER BY p.category ASC, p.item_name ASC
                    `;
                    prodBindings.push(Number(branchId));
                } else {
                    prodSql = `
                        SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.cost_price,
                               COALESCE(SUM(bi.quantity), 0) AS current_balance
                        FROM products p
                        LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                        WHERE p.is_active = 1
                        GROUP BY p.id
                        ORDER BY p.category ASC, p.item_name ASC
                    `;
                }

                let purchSql = `
                    SELECT pi.product_id, CAST(SUBSTR(p.created_at, 6, 2) AS INTEGER) AS m, SUM(pi.quantity) AS qty
                    FROM purchase_items pi
                    JOIN purchases p ON pi.purchase_id = p.id
                    WHERE p.created_at >= ? AND p.created_at <= ?
                `;
                const purchBindings = [yearStart, yearEnd];
                if (isSpecificBranch) {
                    purchSql += ` AND p.branch_id = ? `;
                    purchBindings.push(Number(branchId));
                }
                purchSql += ` GROUP BY pi.product_id, m `;

                let saleSql = `
                    SELECT si.product_id, CAST(SUBSTR(s.created_at, 6, 2) AS INTEGER) AS m, SUM(si.quantity) AS qty
                    FROM sale_items si
                    JOIN sales s ON si.sale_id = s.id
                    WHERE s.created_at >= ? AND s.created_at <= ? AND s.status = 'completed'
                `;
                const saleBindings = [yearStart, yearEnd];
                if (isSpecificBranch) {
                    saleSql += ` AND s.branch_id = ? `;
                    saleBindings.push(Number(branchId));
                }
                saleSql += ` GROUP BY si.product_id, m `;

                let wasteSql = `
                    SELECT product_id, CAST(SUBSTR(created_at, 6, 2) AS INTEGER) AS m, SUM(quantity) AS qty
                    FROM waste_logs
                    WHERE created_at >= ? AND created_at <= ?
                `;
                const wasteBindings = [yearStart, yearEnd];
                if (isSpecificBranch) {
                    wasteSql += ` AND branch_id = ? `;
                    wasteBindings.push(Number(branchId));
                }
                wasteSql += ` GROUP BY product_id, m `;

                const batchQueries = [
                    env.DB.prepare(prodSql).bind(...prodBindings),
                    env.DB.prepare(purchSql).bind(...purchBindings),
                    env.DB.prepare(saleSql).bind(...saleBindings),
                    env.DB.prepare(wasteSql).bind(...wasteBindings)
                ];

                if (isSpecificBranch) {
                    batchQueries.push(
                        env.DB.prepare(`
                            SELECT product_id, CAST(SUBSTR(created_at, 6, 2) AS INTEGER) AS m, SUM(quantity) AS qty
                            FROM stock_transfers
                            WHERE to_branch_id = ? AND created_at >= ? AND created_at <= ?
                            GROUP BY product_id, m
                        `).bind(Number(branchId), yearStart, yearEnd),
                        env.DB.prepare(`
                            SELECT product_id, CAST(SUBSTR(created_at, 6, 2) AS INTEGER) AS m, SUM(quantity) AS qty
                            FROM stock_transfers
                            WHERE from_branch_id = ? AND created_at >= ? AND created_at <= ?
                            GROUP BY product_id, m
                        `).bind(Number(branchId), yearStart, yearEnd)
                    );
                }

                const batchResults = await env.DB.batch(batchQueries);
                const products = batchResults[0]?.results || [];
                const purchases = batchResults[1]?.results || [];
                const sales = batchResults[2]?.results || [];
                const waste = batchResults[3]?.results || [];
                const trfIn = isSpecificBranch ? (batchResults[4]?.results || []) : [];
                const trfOut = isSpecificBranch ? (batchResults[5]?.results || []) : [];

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
                    let running = roundQty(prod.current_balance || 0);
                    for (let m = 12; m >= 1; m--) {
                        monthlyBalances[m] = Math.max(0, roundQty(running));
                        running = running - (inMap[m] || 0) + (outMap[m] || 0);
                    }

                    return {
                        id: prod.id,
                        sku: prod.sku,
                        barcode: prod.barcode,
                        category: prod.category,
                        item_name: prod.item_name,
                        cost_price: roundKyat(prod.cost_price || 0),
                        current_balance: roundQty(prod.current_balance || 0),
                        total_in: roundQty(totalIn),
                        total_out: roundQty(totalOut),
                        monthly_balances: monthlyBalances
                    };
                });

                return jsonResponse(report);
            }

            // =================================================================
            // 4. DUAL-MODE DASHBOARD SUMMARY (OPEX BUG FIXED & SINGLE D1 BATCH)
            // =================================================================
            if (path === "/api/dashboard/summary" && method === "GET") {
                const year = url.searchParams.get("year") || String(new Date().getFullYear());
                const branchId = url.searchParams.get("branch_id");
                const today = getMyanmarTodayDate();
                const yearStart = `${year}-01-01`;
                const yearEnd = `${year}-12-31 23:59:59`;

                const isSpecificBranch = Boolean(branchId && branchId !== "ALL");
                const targetBranchId = isSpecificBranch ? Number(branchId) : (currentUserRole === "cashier" ? userBranchId : 1);

                let salesFilter = ` s.created_at >= ? AND s.created_at <= ? AND s.status = 'completed' `;
                const salesBindings = [yearStart, yearEnd];
                if (isSpecificBranch) {
                    salesFilter += ` AND s.branch_id = ? `;
                    salesBindings.push(Number(branchId));
                }

                let opexFilter = ` entry_date >= ? AND entry_date <= ? AND entry_type = 'EXPENSE' AND category_id NOT IN (5, 6, 10, 11) AND purchase_id IS NULL AND supplier_ledger_id IS NULL `;
                const opexBindings = [`${year}-01-01`, `${year}-12-31`];
                if (isSpecificBranch) {
                    opexFilter += ` AND branch_id = ? `;
                    opexBindings.push(Number(branchId));
                }

                let expCatFilter = ` ce.entry_date >= ? AND ce.entry_date <= ? AND ce.entry_type = 'EXPENSE' `;
                const expCatBindings = [`${year}-01-01`, `${year}-12-31`];
                if (isSpecificBranch) {
                    expCatFilter += ` AND ce.branch_id = ? `;
                    expCatBindings.push(Number(branchId));
                }

                let stockValFilter = ` p.is_active = 1 `;
                const stockValBindings = [];
                if (isSpecificBranch) {
                    stockValFilter += ` AND bi.branch_id = ? `;
                    stockValBindings.push(Number(branchId));
                }

                const [
                    todaySalesRes,
                    todayItemsRes,
                    drawerRes,
                    catSalesRes,
                    recentSalesRes,
                    revAndCogsRes,
                    opexRes,
                    expBreakdownRes,
                    debtRes,
                    stockValRes,
                    topItemsRes,
                    branchesRes,
                    branchCashGroupRes,
                    branchStockGroupRes
                ] = await env.DB.batch([
                    env.DB.prepare(`
                        SELECT COALESCE(SUM(cash_amount), 0) AS today_cash,
                               COALESCE(SUM(bank_amount), 0) AS today_bank,
                               COALESCE(SUM(final_amount), 0) AS today_total
                        FROM sales
                        WHERE branch_id = ? AND date(created_at, '+390 minutes') = ? AND status = 'completed'
                    `).bind(targetBranchId, today),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(si.quantity), 0) AS items_sold
                        FROM sale_items si
                        JOIN sales s ON si.sale_id = s.id
                        WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ? AND s.status = 'completed'
                    `).bind(targetBranchId, today),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                                  WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_drawer,
                               COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                                  WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_balance
                        FROM cashbook_entries
                        WHERE branch_id = ? AND entry_date <= ?
                    `).bind(targetBranchId, today),

                    env.DB.prepare(`
                        SELECT p.category, SUM(si.quantity) AS quantity, SUM(si.subtotal) AS total_amount
                        FROM sale_items si
                        JOIN sales s ON si.sale_id = s.id
                        JOIN products p ON si.product_id = p.id
                        WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ? AND s.status = 'completed'
                        GROUP BY p.category
                        ORDER BY total_amount DESC
                    `).bind(targetBranchId, today),

                    env.DB.prepare(`
                        SELECT s.invoice_no, s.final_amount, s.payment_method, COALESCE(c.name, 'Walk-in') AS customer_name
                        FROM sales s
                        LEFT JOIN customers c ON s.customer_id = c.id
                        WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ? AND s.status = 'completed'
                        ORDER BY s.id DESC LIMIT 5
                    `).bind(targetBranchId, today),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(s.final_amount), 0) AS total_revenue,
                               COALESCE((
                                   SELECT SUM(si.quantity * si.cost_price)
                                   FROM sale_items si
                                   JOIN sales s2 ON si.sale_id = s2.id
                                   WHERE ${salesFilter.replace(/s\./g, "s2.")}
                               ), 0) AS cogs
                        FROM sales s
                        WHERE ${salesFilter}
                    `).bind(...salesBindings, ...salesBindings),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(amount), 0) AS total_opex
                        FROM cashbook_entries
                        WHERE ${opexFilter}
                    `).bind(...opexBindings),

                    env.DB.prepare(`
                        SELECT COALESCE(cc.name, 'အထွေထွေ') AS category_name, SUM(ce.amount) AS amount
                        FROM cashbook_entries ce
                        LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                        WHERE ${expCatFilter}
                        GROUP BY cc.name
                        ORDER BY amount DESC
                    `).bind(...expCatBindings),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(current_debt), 0) AS total_debt,
                               COALESCE(SUM(current_payable), 0) AS total_payable
                        FROM customers
                        WHERE is_active = 1
                    `),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(bi.quantity * p.cost_price), 0) AS total_stock_value
                        FROM branch_inventory bi
                        JOIN products p ON bi.product_id = p.id
                        WHERE ${stockValFilter}
                    `).bind(...stockValBindings),

                    env.DB.prepare(`
                        SELECT p.item_name, p.category, SUM(si.quantity) AS quantity, SUM(si.subtotal) AS total_sales
                        FROM sale_items si
                        JOIN sales s ON si.sale_id = s.id
                        JOIN products p ON si.product_id = p.id
                        WHERE ${salesFilter}
                        GROUP BY p.id
                        ORDER BY quantity DESC LIMIT 6
                    `).bind(...salesBindings),

                    env.DB.prepare("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id ASC"),

                    env.DB.prepare(`
                        SELECT branch_id,
                               COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                                 WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_net,
                               COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                                 WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_net
                        FROM cashbook_entries
                        GROUP BY branch_id
                    `),

                    env.DB.prepare(`
                        SELECT bi.branch_id, COALESCE(SUM(bi.quantity * p.cost_price), 0) AS stock_value
                        FROM branch_inventory bi
                        JOIN products p ON bi.product_id = p.id
                        WHERE p.is_active = 1
                        GROUP BY bi.branch_id
                    `)
                ]);

                const todaySalesRow = (todaySalesRes.results || [])[0] || {};
                const todayItemsRow = (todayItemsRes.results || [])[0] || {};
                const drawerRow = (drawerRes.results || [])[0] || {};
                const revAndCogsRow = (revAndCogsRes.results || [])[0] || {};
                const opexRow = (opexRes.results || [])[0] || {};
                const debtRow = (debtRes.results || [])[0] || {};
                const stockValRow = (stockValRes.results || [])[0] || {};

                const staffMetrics = {
                    today_cash: roundKyat(todaySalesRow.today_cash || 0),
                    today_bank: roundKyat(todaySalesRow.today_bank || 0),
                    today_total: roundKyat(todaySalesRow.today_total || 0),
                    today_items_sold: roundQty(todayItemsRow.items_sold || 0),
                    cash_drawer: roundKyat(drawerRow.cash_drawer || 0),
                    bank_balance: roundKyat(drawerRow.bank_balance || 0),
                    category_sales: catSalesRes.results || [],
                    recent_sales: recentSalesRes.results || []
                };

                const totalRev = roundKyat(revAndCogsRow.total_revenue || 0);
                const cogs = roundKyat(revAndCogsRow.cogs || 0);
                const operatingExpenses = roundKyat(opexRow.total_opex || 0);
                const grossProfit = totalRev - cogs;
                const netProfit = grossProfit - operatingExpenses;

                const cashByBranch = {};
                (branchCashGroupRes.results || []).forEach(r => { cashByBranch[r.branch_id] = r; });

                const stockByBranch = {};
                (branchStockGroupRes.results || []).forEach(r => { stockByBranch[r.branch_id] = r; });

                const totalDebt = roundKyat(debtRow.total_debt || 0);
                const totalPayable = roundKyat(debtRow.total_payable || 0);

                const branchMetrics = (branchesRes.results || []).map(b => ({
                    id: b.id,
                    name: b.name,
                    cash_net: roundKyat(cashByBranch[b.id]?.cash_net || 0),
                    bank_net: roundKyat(cashByBranch[b.id]?.bank_net || 0),
                    stock_value: roundKyat(stockByBranch[b.id]?.stock_value || 0),
                    outstanding_debt: totalDebt
                }));

                const adminMetrics = {
                    total_revenue: totalRev,
                    net_profit: netProfit,
                    gross_profit: grossProfit,
                    total_expenses: operatingExpenses,
                    total_outstanding_debt: totalDebt,
                    total_payable: totalPayable,
                    total_stock_value: roundKyat(stockValRow.total_stock_value || 0),
                    expense_breakdown: expBreakdownRes.results || [],
                    top_selling_items: topItemsRes.results || [],
                    branch_metrics: branchMetrics
                };

                return jsonResponse({
                    staff: staffMetrics,
                    admin: adminMetrics
                });
            }

            // =================================================================
            // 5. SYSTEM SETTING & MULTI-SHEET EXCEL EMAIL BACKUP (ADMIN ONLY)
            // =================================================================
            if (path === "/api/system/send-report-email" && method === "POST") {
                if (currentUserRole !== "admin") {
                    return errorResponse("စနစ် အစီရင်ခံစာ ပို့ဆောင်ခွင့်ကို စနစ်ပိုင်ရှင် (Admin) သာ ခွင့်ပြုပါသည်", 403);
                }

                const body = await request.json().catch(() => ({}));
                const targetYear = String(body.year || new Date().getFullYear());
                const yearStart = `${targetYear}-01-01`;
                const yearEnd = `${targetYear}-12-31 23:59:59`;
                const targetEmail = body.email;

                if (!targetEmail) return errorResponse("အီးမေးလ်လိပ်စာ ထည့်သွင်းပေးပါ", 400);
                if (!env.RESEND_API_KEY) return errorResponse("Resend API Key ကို Server တွင် ထည့်သွင်းထားခြင်း မရှိသေးပါ", 500);

                const [prodRes, salesRes, cbRes, custRes, purRes, yarnRes, wasteRes] = await env.DB.batch([
                    env.DB.prepare(`
                        SELECT p.id, p.sku, p.category, p.item_name, p.pattern, p.size, p.color,
                               p.cost_price, p.retail_price, p.wholesale_price,
                               COALESCE(SUM(bi.quantity), 0) AS total_stock,
                               (COALESCE(SUM(bi.quantity), 0) * p.cost_price) AS total_value
                        FROM products p
                        LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                        WHERE p.is_active = 1
                        GROUP BY p.id
                        ORDER BY p.category ASC, p.item_name ASC
                    `),
                    env.DB.prepare(`
                        SELECT s.invoice_no, b.name AS branch_name, COALESCE(c.name, 'Walk-in') AS customer_name,
                               s.sale_type, s.payment_method, s.total_amount, s.discount_amount,
                               s.final_amount, s.paid_amount, s.debt_amount, s.created_at
                        FROM sales s
                        LEFT JOIN branches b ON s.branch_id = b.id
                        LEFT JOIN customers c ON s.customer_id = c.id
                        WHERE s.created_at >= ? AND s.created_at <= ?
                        ORDER BY s.id DESC LIMIT 2000
                    `).bind(yearStart, yearEnd),
                    env.DB.prepare(`
                        SELECT ce.entry_date, b.name AS branch_name, cc.name AS category_name,
                               ce.entry_type, ce.payment_method, ce.bank_account_name,
                               ce.amount, ce.description
                        FROM cashbook_entries ce
                        LEFT JOIN branches b ON ce.branch_id = b.id
                        LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                        WHERE ce.entry_date >= ? AND ce.entry_date <= ?
                        ORDER BY ce.entry_date DESC, ce.id DESC LIMIT 3000
                    `).bind(`${targetYear}-01-01`, `${targetYear}-12-31`),
                    env.DB.prepare(`
                        SELECT name, phone, shop_name, entity_type, customer_type, credit_limit, current_debt, current_payable, address
                        FROM customers
                        WHERE is_active = 1
                        ORDER BY (current_debt + current_payable) DESC, name ASC
                    `),
                    env.DB.prepare(`
                        SELECT p.purchase_no, p.ref_no, b.name AS branch_name, p.supplier_name,
                               p.payment_method, p.items_total, p.paid_amount, p.diff_amount, p.status, p.created_at
                        FROM purchases p
                        LEFT JOIN branches b ON p.branch_id = b.id
                        WHERE p.created_at >= ? AND p.created_at <= ?
                        ORDER BY p.id DESC LIMIT 1000
                    `).bind(yearStart, yearEnd),
                    env.DB.prepare(`
                        SELECT p.sku, p.item_name, p.color, p.size AS unit, p.cost_price,
                               COALESCE(SUM(bi.quantity), 0) AS current_stock
                        FROM products p
                        LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                        WHERE p.is_active = 1 AND (p.category = 'ချည်' OR p.category LIKE 'ချည်%')
                        GROUP BY p.id
                        ORDER BY p.id DESC
                    `),
                    env.DB.prepare(`
                        SELECT w.reference_no, b.name AS branch_name, p.item_name, p.sku,
                               w.quantity, w.unit_cost, (w.quantity * w.unit_cost) AS total_loss,
                               w.reason, w.created_at
                        FROM waste_logs w
                        LEFT JOIN branches b ON w.branch_id = b.id
                        LEFT JOIN products p ON w.product_id = p.id
                        WHERE w.created_at >= ? AND w.created_at <= ?
                        ORDER BY w.id DESC
                    `).bind(yearStart, yearEnd)
                ]);

                const products = prodRes.results || [];
                const sales = salesRes.results || [];
                const cashbook = cbRes.results || [];
                const customers = custRes.results || [];
                const purchases = purRes.results || [];
                const yarns = yarnRes.results || [];
                const waste = wasteRes.results || [];

                const cleanXml = (val) => String(val ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
                const buildSheet = (sheetName, headers, rows) => {
                    let xml = `<Worksheet ss:Name="${cleanXml(sheetName)}"><Table>`;
                    xml += `<Row ss:StyleID="Header">`;
                    headers.forEach(h => { xml += `<Cell><Data ss:Type="String">${cleanXml(h)}</Data></Cell>`; });
                    xml += `</Row>`;
                    rows.forEach(r => {
                        xml += `<Row>`;
                        r.forEach(c => {
                            const isNum = typeof c === "number" || (!isNaN(c) && c !== "" && typeof c !== "string");
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
                workbookXml += buildSheet("Products", ["ID", "SKU", "အမျိုးအစား", "ပစ္စည်းအမည်", "ဒီဇိုင်း/အဆင်", "ဆိုဒ်", "အရောင်", "အရင်းဈေး", "လက်လီဈေး", "လက်ကားဈေး", "လက်ကျန်အရေအတွက်", "စုစုပေါင်းတန်ဖိုး (Ks)"], products.map(p => [p.id, p.sku, p.category, p.item_name, p.pattern, p.size, p.color, p.cost_price, p.retail_price, p.wholesale_price, p.total_stock, p.total_value]));
                workbookXml += buildSheet("Sales", ["ဘောင်ချာအမှတ်", "ဆိုင်ခွဲ", "ဖောက်သည်", "အရောင်းအမျိုးအစား", "ငွေပေးချေမှု", "စုစုပေါင်း", "လျှော့ဈေး", "ကျသင့်ငွေ", "ပေးချေငွေ", "အကြွေးကျန်", "ရက်စွဲ"], sales.map(s => [s.invoice_no, s.branch_name, s.customer_name, s.sale_type, s.payment_method, s.total_amount, s.discount_amount, s.final_amount, s.paid_amount, s.debt_amount, s.created_at]));
                workbookXml += buildSheet("Cashbook", ["ရက်စွဲ", "ဆိုင်ခွဲ", "ခေါင်းစဉ်", "အမျိုးအစား (IN/OUT)", "ငွေပေးချေမှု", "ဘဏ်အကောင့်", "ပမာဏ (Ks)", "အကြောင်းအရာ"], cashbook.map(c => [c.entry_date, c.branch_name, c.category_name, c.entry_type, c.payment_method, c.bank_account_name, c.amount, c.description]));
                workbookXml += buildSheet("Customers", ["အမည်", "ဖုန်းနံပါတ်", "ဆိုင်/ပွဲရုံအမည်", "စာရင်းအမျိုးအစား", "လက်လီ/လက်ကား", "ရရန်ရှိအကြွေး (Ks)", "ပေးရန်ရှိအကြွေး (Ks)", "လိပ်စာ"], customers.map(c => [c.name, c.phone, c.shop_name, c.entity_type, c.customer_type, c.current_debt, c.current_payable, c.address]));
                workbookXml += buildSheet("Purchases", ["VR NO", "Ref No", "ဆိုင်ခွဲ", "ပွဲရုံအမည်", "ငွေပေးချေမှု", "ပစ္စည်းတန်ဖိုး (Ks)", "ပေးချေငွေ (Ks)", "ပိုငွေ/လိုငွေ", "အခြေအနေ", "ရက်စွဲ"], purchases.map(p => [p.purchase_no, p.ref_no, p.branch_name, p.supplier_name, p.payment_method, p.items_total, p.paid_amount, p.diff_amount, p.status, p.created_at]));
                workbookXml += buildSheet("Yarn", ["ကုတ်", "ချည်အမည်", "အရောင်", "ယူနစ်", "အရင်းဈေး", "လက်ကျန်စတော့"], yarns.map(y => [y.sku, y.item_name, y.color, y.unit, y.cost_price, y.current_stock]));
                workbookXml += buildSheet("Waste", ["မှတ်တမ်းအမှတ်", "ဆိုင်ခွဲ", "ပစ္စည်းအမည်", "SKU", "ပျက်စီးအရေအတွက်", "တစ်ခုအရင်း", "ဆုံးရှုံးမှုတန်ဖိုး (Ks)", "အကြောင်းရင်း", "ရက်စွဲ"], waste.map(w => [w.reference_no, w.branch_name, w.item_name, w.sku, w.quantity, w.unit_cost, w.total_loss, w.reason, w.created_at]));
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

            return errorResponse(`Route မတွေ့ပါ: ${method} ${path}`, 404);
        } catch (err) {
            return errorResponse(`Server Error: ${err.message}`, 500);
        }
    },

    // =========================================================================
    // AUTOMATED DAILY CASHBOOK CLOSING CRON (runs at 00:00 UTC)
    // =========================================================================
    async scheduled(event, env, ctx) {
        try {
            const closingDate = getMyanmarTodayDate();
            const { results: branches } = await env.DB.prepare(
                "SELECT id FROM branches WHERE is_active = 1"
            ).all();

            const batch = [];
            for (const b of (branches || [])) {
                const row = await env.DB.prepare(`
                    SELECT 
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' AND entry_date < ? THEN amount 
                                          WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' AND entry_date < ? THEN -amount ELSE 0 END), 0) AS open_cash,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' AND entry_date < ? THEN amount 
                                          WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' AND entry_date < ? THEN -amount ELSE 0 END), 0) AS open_bank,
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' AND entry_date = ? THEN amount ELSE 0 END), 0) AS cash_in,
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' AND entry_date = ? THEN amount ELSE 0 END), 0) AS cash_out,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' AND entry_date = ? THEN amount ELSE 0 END), 0) AS bank_in,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' AND entry_date = ? THEN amount ELSE 0 END), 0) AS bank_out
                    FROM cashbook_entries
                    WHERE branch_id = ? AND entry_date <= ?
                `).bind(
                    closingDate, closingDate, closingDate, closingDate,
                    closingDate, closingDate, closingDate, closingDate,
                    b.id, closingDate
                ).first();

                if (row) {
                    const openCash = roundKyat(row.open_cash);
                    const openBank = roundKyat(row.open_bank);
                    const cashIn = roundKyat(row.cash_in);
                    const cashOut = roundKyat(row.cash_out);
                    const bankIn = roundKyat(row.bank_in);
                    const bankOut = roundKyat(row.bank_out);
                    const closeCash = openCash + cashIn - cashOut;
                    const closeBank = openBank + bankIn - bankOut;

                    batch.push(
                        env.DB.prepare(`
                            INSERT INTO daily_closings (
                                branch_id, closing_date, opening_cash, opening_bank,
                                total_cash_in, total_cash_out, closing_cash,
                                total_bank_in, total_bank_out, closing_bank,
                                actual_cash_counted, cash_difference, closed_by, notes
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'Auto Daily Closing')
                            ON CONFLICT(branch_id, closing_date) DO UPDATE SET
                                opening_cash = excluded.opening_cash,
                                opening_bank = excluded.opening_bank,
                                total_cash_in = excluded.total_cash_in,
                                total_cash_out = excluded.total_cash_out,
                                closing_cash = excluded.closing_cash,
                                total_bank_in = excluded.total_bank_in,
                                total_bank_out = excluded.total_bank_out,
                                closing_bank = excluded.closing_bank
                        `).bind(
                            b.id, closingDate, openCash, openBank,
                            cashIn, cashOut, closeCash,
                            bankIn, bankOut, closeBank, closeCash
                        )
                    );
                }
            }

            if (batch.length > 0) {
                await env.DB.batch(batch);
            }
        } catch (err) {
            console.error("[Cron] Daily closing error:", err.message);
        }
    }
};
