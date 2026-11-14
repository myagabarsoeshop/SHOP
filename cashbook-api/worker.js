// =============================================================================
// FILE 5 OF 5: cashbook-api/worker.js  
// MAIN WORKER ENTRYPOINT, AUTH, LEDGER STOCK REPORT, DASHBOARD & CRON JOBS
// Version: 4.1.0 (Ledger-Backed Stock Report, Nightly Reconciliation & RBAC)
// =============================================================================

import {
    APP_VERSION,
    HttpError,
    configureRequestContext,
    jsonResponse,
    errorResponse,
    getMyanmarTodayDate,
    getMyanmarYesterdayDate,
    getMyanmarDayUtcBounds,
    getMyanmarYearUtcBounds,
    roundKyat,
    roundQty,
    checkLoginRateLimit,
    recordLoginAttempt,
    getJwtSecret,
    hashPassword,
    verifyPassword,
    signToken,
    getAuthUser,
    invalidateUserTokenCache,
    getQueryYear,
    can,
    requirePermission,
    normalizeRole,
    resolveBranchId,
    summarizeD1Meta,
    logAudit
} from "./utils.js";

import { handleInventoryRoutes } from "./routes-inventory.js";
import { handleTransactionRoutes } from "./routes-transactions.js";
import { handleFinanceRoutes } from "./routes-finance.js";

export default {
    async fetch(request, env, ctx) {
        const reqCorsHeaders = configureRequestContext(request, env);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: reqCorsHeaders });
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
                version: APP_VERSION,
                note: "Frontend assets not bound."
            });
        }

        try {
            // 1. Health Check (Zero D1 Reads)
            if (path === "/api/health" && method === "GET") {
                return jsonResponse({ status: "online", version: APP_VERSION });
            }

            // 2. Auth Login (With Persistent D1 Brute-Force Rate Limiting)
            if (path === "/api/auth/login" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { username, password } = body;
                if (!username || !password) {
                    return errorResponse("အသုံးပြုသူအမည်နှင့် စကားဝှက် ထည့်သွင်းပေးပါ", 400);
                }

                const cleanUsername = String(username).trim();
                const rateCheck = await checkLoginRateLimit(request, env.DB, cleanUsername);
                if (!rateCheck.allowed) {
                    return errorResponse(
                        `စကားဝှက် မှားယွင်းမှု များနေပါသဖြင့် (${rateCheck.waitSeconds}) စက္ကန့် စောင့်ဆိုင်းပြီးမှ ပြန်လည်ကြိုးစားပါ`,
                        429
                    );
                }

                const query = `
                    SELECT u.id, u.branch_id, u.username, u.full_name, u.role, u.password_hash,
                           COALESCE(u.token_version, 1) AS token_version,
                           b.code AS branch_code, b.name AS branch_name
                    FROM users u
                    LEFT JOIN branches b ON u.branch_id = b.id
                    WHERE LOWER(u.username) = LOWER(?) AND u.is_active = 1
                `;
                const user = await env.DB.prepare(query).bind(cleanUsername).first();

                if (!user || !(await verifyPassword(String(password), user.password_hash))) {
                    await recordLoginAttempt(request, env.DB, cleanUsername, false);
                    return errorResponse("အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်", 401);
                }

                await recordLoginAttempt(request, env.DB, cleanUsername, true);

                const normalizedRole = normalizeRole(user.role);
                const secret = getJwtSecret(env);
                const token = await signToken({
                    uid: user.id,
                    username: user.username,
                    role: normalizedRole,
                    branch_id: user.branch_id || 1,
                    branch_code: user.branch_code || "MAIN",
                    tv: Number(user.token_version || 1)
                }, secret);

                return jsonResponse({
                    token,
                    user: {
                        id: user.id,
                        username: user.username,
                        fullName: user.full_name || user.username,
                        role: normalizedRole,
                        branchId: user.branch_id || 1,
                        branchCode: user.branch_code || "MAIN",
                        branchName: user.branch_name || "Main Home Shop"
                    },
                    message: "Login အောင်မြင်ပါသည်"
                });
            }

            // =================================================================
            // PROTECTED ROUTE GATEWAY (JWT + Token Version Verification)
            // =================================================================
            const auth = await getAuthUser(request, env);
            if (!auth) {
                return errorResponse("အကောင့်ဝင်ရောက်ထားခြင်း မရှိပါ သို့မဟုတ် Token သက်တမ်းကုန်ဆုံးသွားပါသည် (401 Unauthorized)", 401);
            }

            const currentUserId = Number(auth.uid);
            const currentUserRole = auth.role;
            const userBranchId = Number(auth.branch_id || 1);

            // 2.1. Password Change (Self) - Increments token_version & never stores plaintext
            if (path === "/api/auth/change-password" && method === "POST") {
                const body = await request.json().catch(() => ({}));
                const { oldPassword, newPassword } = body;
                if (!oldPassword || !newPassword || String(newPassword).trim().length < 6) {
                    return errorResponse("စကားဝှက်အသစ်သည် အနည်းဆုံး ၆ လုံး ရှိရပါမည်", 400);
                }

                const currentUser = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(currentUserId).first();
                if (!currentUser || !(await verifyPassword(String(oldPassword), currentUser.password_hash))) {
                    return errorResponse("မူလ စကားဝှက် မှားယွင်းနေပါသည်", 400);
                }

                const secureHash = await hashPassword(String(newPassword).trim());
                await env.DB.prepare(`
                    UPDATE users 
                    SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1 
                    WHERE id = ?
                `).bind(secureHash, currentUserId).run();

                invalidateUserTokenCache(currentUserId);

                await logAudit(env.DB, {
                    branchId: userBranchId,
                    userId: currentUserId,
                    action: "CHANGE_PASSWORD_SELF",
                    tableName: "users",
                    recordId: currentUserId,
                    details: "User changed own password"
                });

                return jsonResponse({ message: "စကားဝှက် အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ။ စကားဝှက်အသစ်ဖြင့် ပြန်လည်ဝင်ရောက်ပါ။" });
            }

            // 2.2. Admin Only: User Management (GET, POST, PUT, Reset Password)
            if (path === "/api/system/users" && method === "GET") {
                requirePermission(auth, "user.manage", "အသုံးပြုသူစာရင်း ကြည့်ရှုခွင့်ကို Admin သာ ခွင့်ပြုပါသည်");

                const { results } = await env.DB.prepare(`
                    SELECT u.id, u.username, u.full_name, u.phone, u.role, u.branch_id, u.is_active,
                           b.name AS branch_name, b.code AS branch_code
                    FROM users u
                    LEFT JOIN branches b ON u.branch_id = b.id
                    WHERE u.is_active = 1
                    ORDER BY u.id ASC
                `).all();

                return jsonResponse((results || []).map(u => ({
                    ...u,
                    role: normalizeRole(u.role)
                })));
            }

            if (path === "/api/system/users" && method === "POST") {
                requirePermission(auth, "user.manage", "ဝန်ထမ်းအကောင့် အသစ်ဖွင့်ခွင့်ကို Admin သာ ခွင့်ပြုပါသည်");

                const body = await request.json().catch(() => ({}));
                const username = String(body.username || "").trim();
                const fullName = String(body.full_name ?? body.fullName ?? "").trim();
                const password = String(body.password || "").trim();
                const role = normalizeRole(body.role || "cashier");
                const branchId = body.branch_id ?? body.branchId ? Number(body.branch_id ?? body.branchId) : null;
                const phone = body.phone ? String(body.phone).trim() : null;

                if (!username || !fullName || password.length < 6) {
                    return errorResponse("Username၊ အမည်အပြည့်အစုံနှင့် စကားဝှက် (အနည်းဆုံး ၆ လုံး) လိုအပ်ပါသည်", 400);
                }
                if ((role === "branch_manager" || role === "cashier") && (!branchId || branchId <= 0)) {
                    return errorResponse("Branch Manager နှင့် Cashier အတွက် သက်ဆိုင်ရာ ဆိုင်ခွဲ (branch_id) မဖြစ်မနေ သတ်မှတ်ပေးရပါမည်", 400);
                }

                const dupUser = await env.DB.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1").bind(username).first();
                if (dupUser) {
                    return errorResponse("ဤ Username သည် စနစ်ထဲတွင် ရှိပြီးသား ဖြစ်နေပါသည်", 409);
                }

                const secureHash = await hashPassword(password);
                const res = await env.DB.prepare(`
                    INSERT INTO users (branch_id, username, password_hash, token_version, full_name, phone, role, is_active)
                    VALUES (?, ?, ?, 1, ?, ?, ?, 1)
                `).bind(branchId, username, secureHash, fullName, phone, role).run();

                await logAudit(env.DB, {
                    branchId: userBranchId,
                    userId: currentUserId,
                    action: "CREATE_USER",
                    tableName: "users",
                    recordId: res.meta.last_row_id,
                    details: { username, role, branch_id: branchId }
                });

                return jsonResponse({
                    id: res.meta.last_row_id,
                    message: "ဝန်ထမ်းအကောင့်အသစ် ဖွင့်လှစ်ပြီးပါပြီ"
                }, 201);
            }

            if (path.startsWith("/api/system/users/") && method === "PUT") {
                requirePermission(auth, "user.manage", "ဝန်ထမ်းအကောင့် ပြင်ဆင်ခွင့်ကို Admin သာ ခွင့်ပြုပါသည်");

                const targetId = Number(path.split("/").pop());
                const body = await request.json().catch(() => ({}));
                if (!targetId) return errorResponse("User ID မမှန်ကန်ပါ", 400);

                const existing = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(targetId).first();
                if (!existing) return errorResponse("အသုံးပြုသူ ရှာမတွေ့ပါ", 404);

                const role = body.role ? normalizeRole(body.role) : normalizeRole(existing.role);
                const branchId = (body.branch_id !== undefined || body.branchId !== undefined)
                    ? Number(body.branch_id ?? body.branchId)
                    : existing.branch_id;
                const fullName = String(body.full_name ?? body.fullName ?? existing.full_name).trim();
                const isActive = body.is_active !== undefined ? (Number(body.is_active) ? 1 : 0) : existing.is_active;

                if ((role === "branch_manager" || role === "cashier") && (!branchId || branchId <= 0)) {
                    return errorResponse("Branch Manager နှင့် Cashier အတွက် သက်ဆိုင်ရာ ဆိုင်ခွဲ (branch_id) မဖြစ်မနေ သတ်မှတ်ပေးရပါမည်", 400);
                }

                await env.DB.prepare(`
                    UPDATE users
                    SET full_name = ?, role = ?, branch_id = ?, is_active = ?, token_version = COALESCE(token_version, 1) + 1
                    WHERE id = ?
                `).bind(fullName, role, branchId, isActive, targetId).run();

                invalidateUserTokenCache(targetId);

                await logAudit(env.DB, {
                    branchId: userBranchId,
                    userId: currentUserId,
                    action: "UPDATE_USER_ROLE_OR_BRANCH",
                    tableName: "users",
                    recordId: targetId,
                    details: { role, branch_id: branchId, is_active: isActive }
                });

                return jsonResponse({ message: "ဝန်ထမ်းအချက်အလက်နှင့် လုပ်ပိုင်ခွင့် ပြင်ဆင်ပြီးပါပြီ" });
            }

            if (path === "/api/system/reset-password" && method === "POST") {
                requirePermission(auth, "user.manage", "စကားဝှက် ပြောင်းလဲပေးခွင့်ကို Admin သာ ခွင့်ပြုပါသည်");

                const body = await request.json().catch(() => ({}));
                const targetUserId = Number(body.user_id || body.userId);
                const newPassword = String(body.new_password || body.newPassword || "").trim();

                if (!targetUserId || newPassword.length < 6) {
                    return errorResponse("အသုံးပြုသူ ရွေးချယ်ပြီး စကားဝှက်အသစ် (အနည်းဆုံး ၆ လုံး) ထည့်သွင်းပေးပါ", 400);
                }

                const targetUser = await env.DB.prepare("SELECT id, username, full_name FROM users WHERE id = ?").bind(targetUserId).first();
                if (!targetUser) {
                    return errorResponse("အသုံးပြုသူ ရှာမတွေ့ပါ", 404);
                }

                const secureHash = await hashPassword(newPassword);
                await env.DB.prepare(`
                    UPDATE users 
                    SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1 
                    WHERE id = ?
                `).bind(secureHash, targetUserId).run();

                invalidateUserTokenCache(targetUserId);

                await logAudit(env.DB, {
                    branchId: userBranchId,
                    userId: currentUserId,
                    action: "ADMIN_RESET_PASSWORD",
                    tableName: "users",
                    recordId: targetUserId,
                    details: `Admin reset password for user ${targetUser.username}`
                });

                return jsonResponse({
                    message: `${targetUser.full_name || targetUser.username} အတွက် စကားဝှက်အသစ် ပြောင်းလဲသိမ်းဆည်းပြီးပါပြီ`
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
            // 3. MONTHLY 12-MONTH STOCK REPORT FROM STOCK_MOVEMENTS (Spec Section 7)
            // Reconstructed in a SINGLE SQL QUERY from stock_movements ledger
            // =================================================================
            if (path === "/api/reports/monthly-stock" && method === "GET") {
                requirePermission(auth, "report.monthly_stock", "Stock Report ကြည့်ရှုခွင့် မရှိပါ");

                const year = getQueryYear(url);
                const requestedBranch = url.searchParams.get("branch_id");
                const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
                const isSpecificBranch = resolvedBranch !== "ALL";
                const branchIdNum = isSpecificBranch ? Number(resolvedBranch) : null;
                const canViewCost = can(auth, "product.view_cost");

                const yearStart = `${year}-01-01`;
                const yearEnd = `${year}-12-31`;

                // Single SQL Query using CTE over stock_movements indexed by (branch_id, product_id, effective_date)
                const branchWhere = isSpecificBranch ? "WHERE sm.branch_id = ? AND sm.effective_date <= ?" : "WHERE sm.effective_date <= ?";
                const sqlBindings = isSpecificBranch
                    ? [branchIdNum, yearEnd, yearStart, yearStart, yearStart, yearStart, yearStart, yearStart, yearStart]
                    : [yearEnd, yearStart, yearStart, yearStart, yearStart, yearStart, yearStart, yearStart];

                const singleReportSql = `
                    WITH agg_movements AS (
                        SELECT 
                            sm.product_id,
                            SUM(CASE WHEN sm.effective_date < ? THEN sm.quantity ELSE 0 END) AS year_opening,
                            SUM(CASE WHEN sm.effective_date >= ? AND sm.quantity > 0 THEN sm.quantity ELSE 0 END) AS year_total_in,
                            SUM(CASE WHEN sm.effective_date >= ? AND sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END) AS year_total_out,
                            SUM(CASE WHEN sm.effective_date >= ? AND sm.movement_type = 'OPENING' THEN sm.quantity ELSE 0 END) AS year_opening_added,
                            SUM(CASE WHEN sm.effective_date >= ? AND sm.movement_type = 'ADJUSTMENT_IN' THEN sm.quantity ELSE 0 END) AS year_adj_in,
                            SUM(CASE WHEN sm.effective_date >= ? AND sm.movement_type = 'ADJUSTMENT_OUT' THEN ABS(sm.quantity) ELSE 0 END) AS year_adj_out,
                            SUM(CASE WHEN sm.effective_date <= '${year}-01-31' THEN sm.quantity ELSE 0 END) AS m1,
                            SUM(CASE WHEN sm.effective_date <= '${year}-02-29' THEN sm.quantity ELSE 0 END) AS m2,
                            SUM(CASE WHEN sm.effective_date <= '${year}-03-31' THEN sm.quantity ELSE 0 END) AS m3,
                            SUM(CASE WHEN sm.effective_date <= '${year}-04-30' THEN sm.quantity ELSE 0 END) AS m4,
                            SUM(CASE WHEN sm.effective_date <= '${year}-05-31' THEN sm.quantity ELSE 0 END) AS m5,
                            SUM(CASE WHEN sm.effective_date <= '${year}-06-30' THEN sm.quantity ELSE 0 END) AS m6,
                            SUM(CASE WHEN sm.effective_date <= '${year}-07-31' THEN sm.quantity ELSE 0 END) AS m7,
                            SUM(CASE WHEN sm.effective_date <= '${year}-08-31' THEN sm.quantity ELSE 0 END) AS m8,
                            SUM(CASE WHEN sm.effective_date <= '${year}-09-30' THEN sm.quantity ELSE 0 END) AS m9,
                            SUM(CASE WHEN sm.effective_date <= '${year}-10-31' THEN sm.quantity ELSE 0 END) AS m10,
                            SUM(CASE WHEN sm.effective_date <= '${year}-11-30' THEN sm.quantity ELSE 0 END) AS m11,
                            SUM(CASE WHEN sm.effective_date <= '${year}-12-31' THEN sm.quantity ELSE 0 END) AS m12
                        FROM stock_movements sm
                        ${branchWhere}
                        GROUP BY sm.product_id
                    )
                    SELECT 
                        p.id, p.sku, p.barcode, p.category, p.item_name, p.cost_price,
                        COALESCE(am.year_opening, 0) AS opening_balance,
                        COALESCE(am.year_total_in, 0) AS total_in,
                        COALESCE(am.year_total_out, 0) AS total_out,
                        COALESCE(am.year_opening_added, 0) AS opening_added,
                        COALESCE(am.year_adj_in, 0) AS adjustment_in,
                        COALESCE(am.year_adj_out, 0) AS adjustment_out,
                        COALESCE(am.m1, 0) AS m1,
                        COALESCE(am.m2, 0) AS m2,
                        COALESCE(am.m3, 0) AS m3,
                        COALESCE(am.m4, 0) AS m4,
                        COALESCE(am.m5, 0) AS m5,
                        COALESCE(am.m6, 0) AS m6,
                        COALESCE(am.m7, 0) AS m7,
                        COALESCE(am.m8, 0) AS m8,
                        COALESCE(am.m9, 0) AS m9,
                        COALESCE(am.m10, 0) AS m10,
                        COALESCE(am.m11, 0) AS m11,
                        COALESCE(am.m12, 0) AS m12
                    FROM products p
                    LEFT JOIN agg_movements am ON p.id = am.product_id
                    WHERE p.is_active = 1
                    ORDER BY p.category ASC, p.item_name ASC
                `;

                const { results } = await env.DB.prepare(singleReportSql).bind(...sqlBindings).all();

                const report = (results || []).map(row => {
                    const unitCost = canViewCost ? roundKyat(row.cost_price || 0) : 0;
                    const adjInQty = roundQty(row.adjustment_in || 0);
                    const adjOutQty = roundQty(row.adjustment_out || 0);

                    const itemReport = {
                        id: row.id,
                        sku: row.sku,
                        barcode: row.barcode,
                        category: row.category,
                        item_name: row.item_name,
                        opening_balance: roundQty(row.opening_balance || 0),
                        total_in: roundQty(row.total_in || 0),
                        total_out: roundQty(row.total_out || 0),
                        current_balance: roundQty(row.m12 || 0),
                        adjustment_in_qty: adjInQty,
                        adjustment_out_qty: adjOutQty,
                        adjustment_net_value: canViewCost ? roundKyat((adjInQty - adjOutQty) * unitCost) : 0,
                        monthly_balances: {
                            1: roundQty(row.m1 || 0),
                            2: roundQty(row.m2 || 0),
                            3: roundQty(row.m3 || 0),
                            4: roundQty(row.m4 || 0),
                            5: roundQty(row.m5 || 0),
                            6: roundQty(row.m6 || 0),
                            7: roundQty(row.m7 || 0),
                            8: roundQty(row.m8 || 0),
                            9: roundQty(row.m9 || 0),
                            10: roundQty(row.m10 || 0),
                            11: roundQty(row.m11 || 0),
                            12: roundQty(row.m12 || 0)
                        }
                    };

                    if (canViewCost) {
                        itemReport.cost_price = unitCost;
                    }
                    return itemReport;
                });

                return jsonResponse(report);
            }

            // =================================================================
            // 3.1. STOCK RECONCILIATION CHECK API (Spec Section 2.3)
            // Compares SUM(stock_movements.quantity) vs branch_inventory.quantity
            // =================================================================
            if (path === "/api/system/reconcile-stock" && method === "GET") {
                requirePermission(auth, "opening.approve", "Stock Reconciliation စစ်ဆေးခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

                const { results: discrepancies } = await env.DB.prepare(`
                    SELECT 
                        b.id AS branch_id, b.name AS branch_name,
                        p.id AS product_id, p.sku, p.item_name,
                        COALESCE(bi.quantity, 0) AS cached_quantity,
                        COALESCE(SUM(sm.quantity), 0) AS ledger_quantity,
                        ROUND(COALESCE(SUM(sm.quantity), 0) - COALESCE(bi.quantity, 0), 3) AS diff
                    FROM products p
                    CROSS JOIN branches b
                    LEFT JOIN branch_inventory bi ON bi.branch_id = b.id AND bi.product_id = p.id
                    LEFT JOIN stock_movements sm ON sm.branch_id = b.id AND sm.product_id = p.id
                    WHERE b.is_active = 1 AND p.is_active = 1
                    GROUP BY b.id, p.id
                    HAVING ABS(COALESCE(SUM(sm.quantity), 0) - COALESCE(bi.quantity, 0)) > 0.001
                `).all();

                return jsonResponse({
                    checked_at: new Date().toISOString(),
                    mismatch_count: (discrepancies || []).length,
                    discrepancies: discrepancies || []
                });
            }

            // =================================================================
            // 4. DUAL-MODE DASHBOARD SUMMARY (RBAC, APPROVAL QUEUE & D1 META)
            // =================================================================
            if (path === "/api/dashboard/summary" && method === "GET") {
                const year = getQueryYear(url);
                const requestedBranch = url.searchParams.get("branch_id");
                const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
                const isSpecificBranch = resolvedBranch !== "ALL";
                const targetBranchId = isSpecificBranch ? Number(resolvedBranch) : (userBranchId || 1);
                const canViewAdminMetrics = can(auth, "dashboard.admin_metrics");

                const today = getMyanmarTodayDate();
                const { startUtc: todayStartUtc, endUtc: todayEndUtc } = getMyanmarDayUtcBounds(today);
                const { startUtc: yearStartUtc, endUtc: yearEndUtc } = getMyanmarYearUtcBounds(year);

                const staffBatch = [
                    env.DB.prepare(`
                        SELECT COALESCE(SUM(cash_amount), 0) AS today_cash,
                               COALESCE(SUM(bank_amount), 0) AS today_bank,
                               COALESCE(SUM(final_amount), 0) AS today_total
                        FROM sales
                        WHERE branch_id = ? AND created_at >= ? AND created_at <= ? AND status = 'completed'
                    `).bind(targetBranchId, todayStartUtc, todayEndUtc),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(si.quantity), 0) AS items_sold
                        FROM sale_items si
                        JOIN sales s ON si.sale_id = s.id
                        WHERE s.branch_id = ? AND s.created_at >= ? AND s.created_at <= ? AND s.status = 'completed'
                    `).bind(targetBranchId, todayStartUtc, todayEndUtc),

                    env.DB.prepare(`
                        SELECT COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                                 WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_drawer,
                               COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                                 WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_balance
                        FROM cashbook_entries
                        WHERE branch_id = ? AND entry_date <= ? AND COALESCE(status, 'completed') != 'cancelled'
                    `).bind(targetBranchId, today),

                    env.DB.prepare(`
                        SELECT p.category, SUM(si.quantity) AS quantity, SUM(si.subtotal) AS total_amount
                        FROM sale_items si
                        JOIN sales s ON si.sale_id = s.id
                        JOIN products p ON si.product_id = p.id
                        WHERE s.branch_id = ? AND s.created_at >= ? AND s.created_at <= ? AND s.status = 'completed'
                        GROUP BY p.category
                        ORDER BY total_amount DESC
                    `).bind(targetBranchId, todayStartUtc, todayEndUtc),

                    env.DB.prepare(`
                        SELECT s.invoice_no, s.final_amount, s.payment_method, COALESCE(c.name, 'Walk-in') AS customer_name
                        FROM sales s
                        LEFT JOIN customers c ON s.customer_id = c.id
                        WHERE s.branch_id = ? AND s.created_at >= ? AND s.created_at <= ? AND s.status = 'completed'
                        ORDER BY s.id DESC LIMIT 5
                    `).bind(targetBranchId, todayStartUtc, todayEndUtc)
                ];

                if (!canViewAdminMetrics) {
                    const staffResults = await env.DB.batch(staffBatch);
                    const d1Stats = summarizeD1Meta(staffResults);

                    const todaySalesRow = (staffResults[0].results || [])[0] || {};
                    const todayItemsRow = (staffResults[1].results || [])[0] || {};
                    const drawerRow = (staffResults[2].results || [])[0] || {};

                    return jsonResponse({
                        staff: {
                            today_cash: roundKyat(todaySalesRow.today_cash || 0),
                            today_bank: roundKyat(todaySalesRow.today_bank || 0),
                            today_total: roundKyat(todaySalesRow.today_total || 0),
                            today_items_sold: roundQty(todayItemsRow.items_sold || 0),
                            cash_drawer: roundKyat(drawerRow.cash_drawer || 0),
                            bank_balance: roundKyat(drawerRow.bank_balance || 0),
                            category_sales: staffResults[3].results || [],
                            recent_sales: staffResults[4].results || []
                        },
                        admin: null,
                        d1_meta: d1Stats
                    });
                }

                let salesFilter = ` s.created_at >= ? AND s.created_at <= ? AND s.status = 'completed' `;
                const salesBindings = [yearStartUtc, yearEndUtc];
                if (isSpecificBranch) {
                    salesFilter += ` AND s.branch_id = ? `;
                    salesBindings.push(targetBranchId);
                }

                let opexFilter = `
                    ce.entry_date >= ? AND ce.entry_date <= ?
                    AND ce.entry_type = 'EXPENSE'
                    AND COALESCE(ce.status, 'completed') != 'cancelled'
                    AND ce.purchase_id IS NULL
                    AND ce.supplier_ledger_id IS NULL
                    AND COALESCE(cc.is_remittance, 0) = 0
                    AND ce.category_id NOT IN (5, 6, 10, 11)
                `;
                const opexBindings = [`${year}-01-01`, `${year}-12-31`];
                if (isSpecificBranch) {
                    opexFilter += ` AND ce.branch_id = ? `;
                    opexBindings.push(targetBranchId);
                }

                let expCatFilter = `
                    ce.entry_date >= ? AND ce.entry_date <= ?
                    AND ce.entry_type = 'EXPENSE'
                    AND COALESCE(ce.status, 'completed') != 'cancelled'
                `;
                const expCatBindings = [`${year}-01-01`, `${year}-12-31`];
                if (isSpecificBranch) {
                    expCatFilter += ` AND ce.branch_id = ? `;
                    expCatBindings.push(targetBranchId);
                }

                let stockValFilter = ` p.is_active = 1 `;
                const stockValBindings = [];
                if (isSpecificBranch) {
                    stockValFilter += ` AND bi.branch_id = ? `;
                    stockValBindings.push(targetBranchId);
                }

                const adminBatch = [
                    ...staffBatch,
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
                        SELECT COALESCE(SUM(ce.amount), 0) AS total_opex
                        FROM cashbook_entries ce
                        LEFT JOIN cash_categories cc ON ce.category_id = cc.id
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
                        WHERE COALESCE(status, 'completed') != 'cancelled'
                        GROUP BY branch_id
                    `),

                    env.DB.prepare(`
                        SELECT bi.branch_id, COALESCE(SUM(bi.quantity * p.cost_price), 0) AS stock_value
                        FROM branch_inventory bi
                        JOIN products p ON bi.product_id = p.id
                        WHERE p.is_active = 1
                        GROUP BY bi.branch_id
                    `),

                    // Spec 5.6: Approval Queue Counts for Admin/Finance Dashboard
                    env.DB.prepare(`
                        SELECT 
                            (SELECT COUNT(id) FROM opening_stock_counts WHERE status = 'submitted') AS pending_openings,
                            (SELECT COUNT(id) FROM stock_adjustments WHERE status = 'submitted') AS pending_adjustments,
                            (SELECT COUNT(id) FROM stock_transfers WHERE status IN ('pending', 'dispatched')) AS active_transfers
                    `)
                ];

                const allResults = await env.DB.batch(adminBatch);
                const d1Stats = summarizeD1Meta(allResults);

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
                    branchStockGroupRes,
                    approvalQueueRes
                ] = allResults;

                const todaySalesRow = (todaySalesRes.results || [])[0] || {};
                const todayItemsRow = (todayItemsRes.results || [])[0] || {};
                const drawerRow = (drawerRes.results || [])[0] || {};
                const revAndCogsRow = (revAndCogsRes.results || [])[0] || {};
                const opexRow = (opexRes.results || [])[0] || {};
                const debtRow = (debtRes.results || [])[0] || {};
                const stockValRow = (stockValRes.results || [])[0] || {};
                const approvalRow = (approvalQueueRes.results || [])[0] || {};

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
                    branch_metrics: branchMetrics,
                    approval_queue: {
                        pending_openings: Number(approvalRow.pending_openings || 0),
                        pending_adjustments: Number(approvalRow.pending_adjustments || 0),
                        active_transfers: Number(approvalRow.active_transfers || 0)
                    }
                };

                return jsonResponse({
                    staff: staffMetrics,
                    admin: adminMetrics,
                    d1_meta: d1Stats
                });
            }

            // =================================================================
            // 5. DATE-BOUNDED JSON BACKUP DOWNLOAD (ADMIN ONLY - Spec Section 8.4)
            // =================================================================
            if (path === "/api/system/backup-json" && method === "GET") {
                requirePermission(auth, "system.backup", "Backup ဒေါင်းလုဒ်ဆွဲခွင့်ကို Admin သာ ခွင့်ပြုပါသည်");

                const year = getQueryYear(url);
                const { startUtc: yearStartUtc, endUtc: yearEndUtc, startDate, endDate } = getMyanmarYearUtcBounds(year);

                const [
                    branchesRes,
                    productsRes,
                    branchInvRes,
                    customersRes,
                    movementsRes,
                    salesRes,
                    purchasesRes,
                    cashbookRes,
                    transfersRes,
                    wasteRes
                ] = await env.DB.batch([
                    env.DB.prepare("SELECT id, code, name, type, phone, address, is_active FROM branches"),
                    env.DB.prepare("SELECT id, sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price, alert_quantity, is_active FROM products"),
                    env.DB.prepare("SELECT branch_id, product_id, quantity, updated_at FROM branch_inventory"),
                    env.DB.prepare("SELECT id, name, phone, shop_name, entity_type, customer_type, credit_limit, current_debt, current_payable, address, is_active FROM customers"),
                    env.DB.prepare("SELECT id, branch_id, product_id, movement_type, quantity, effective_date, source_table, source_id, reason, created_by, approved_by, created_at FROM stock_movements WHERE effective_date >= ? AND effective_date <= ? ORDER BY id DESC LIMIT 10000").bind(startDate, endDate),
                    env.DB.prepare("SELECT id, invoice_no, branch_id, customer_id, sale_type, total_amount, discount_amount, final_amount, paid_amount, debt_amount, payment_method, status, created_at FROM sales WHERE created_at >= ? AND created_at <= ? ORDER BY id DESC LIMIT 10000").bind(yearStartUtc, yearEndUtc),
                    env.DB.prepare("SELECT id, purchase_no, ref_no, branch_id, supplier_id, supplier_name, purchase_date, items_total, paid_amount, diff_amount, payment_method, status, created_at FROM purchases WHERE created_at >= ? AND created_at <= ? ORDER BY id DESC LIMIT 10000").bind(yearStartUtc, yearEndUtc),
                    env.DB.prepare("SELECT id, branch_id, category_id, entry_type, payment_method, bank_account_name, amount, ref_no, description, entry_date, status, created_at FROM cashbook_entries WHERE entry_date >= ? AND entry_date <= ? ORDER BY id DESC LIMIT 10000").bind(startDate, endDate),
                    env.DB.prepare("SELECT id, transfer_no, from_branch_id, to_branch_id, product_id, quantity, status, notes, created_at FROM stock_transfers WHERE created_at >= ? AND created_at <= ? ORDER BY id DESC LIMIT 5000").bind(yearStartUtc, yearEndUtc),
                    env.DB.prepare("SELECT id, reference_no, branch_id, product_id, quantity, unit_cost, reason, status, created_at FROM waste_logs WHERE created_at >= ? AND created_at <= ? ORDER BY id DESC LIMIT 5000").bind(yearStartUtc, yearEndUtc)
                ]);

                return jsonResponse({
                    exported_at: new Date().toISOString(),
                    version: APP_VERSION,
                    target_year: year,
                    exported_by: auth.username,
                    tables: {
                        branches: branchesRes.results || [],
                        products: productsRes.results || [],
                        branch_inventory: branchInvRes.results || [],
                        customers: customersRes.results || [],
                        stock_movements: movementsRes.results || [],
                        sales: salesRes.results || [],
                        purchases: purchasesRes.results || [],
                        cashbook_entries: cashbookRes.results || [],
                        stock_transfers: transfersRes.results || [],
                        waste_logs: wasteRes.results || []
                    }
                });
            }

            // =================================================================
            // 6. MULTI-SHEET EXCEL EMAIL BACKUP (ADMIN ONLY)
            // =================================================================
            if (path === "/api/system/send-report-email" && method === "POST") {
                requirePermission(auth, "system.backup", "စနစ် အစီရင်ခံစာ ပို့ဆောင်ခွင့်ကို Admin သာ ခွင့်ပြုပါသည်");

                const body = await request.json().catch(() => ({}));
                const targetYear = getQueryYear(url);
                const { startUtc: yearStartUtc, endUtc: yearEndUtc, startDate, endDate } = getMyanmarYearUtcBounds(targetYear);
                const targetEmail = String(body.email || "").trim();

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
                               s.final_amount, s.paid_amount, s.debt_amount, s.status, s.created_at
                        FROM sales s
                        LEFT JOIN branches b ON s.branch_id = b.id
                        LEFT JOIN customers c ON s.customer_id = c.id
                        WHERE s.created_at >= ? AND s.created_at <= ?
                        ORDER BY s.id DESC LIMIT 5000
                    `).bind(yearStartUtc, yearEndUtc),
                    env.DB.prepare(`
                        SELECT ce.entry_date, b.name AS branch_name, cc.name AS category_name,
                               ce.entry_type, ce.payment_method, ce.bank_account_name,
                               ce.amount, ce.description
                        FROM cashbook_entries ce
                        LEFT JOIN branches b ON ce.branch_id = b.id
                        LEFT JOIN cash_categories cc ON ce.category_id = cc.id
                        WHERE ce.entry_date >= ? AND ce.entry_date <= ?
                        ORDER BY ce.entry_date DESC, ce.id DESC LIMIT 5000
                    `).bind(startDate, endDate),
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
                        ORDER BY p.id DESC LIMIT 5000
                    `).bind(yearStartUtc, yearEndUtc),
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
                    `).bind(yearStartUtc, yearEndUtc)
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
                    let xml = `<Worksheet ss:Name="${cleanXml(sheetName)}"><Table><Row ss:StyleID="Header">`;
                    headers.forEach(h => { xml += `<Cell><Data ss:Type="String">${cleanXml(h)}</Data></Cell>`; });
                    xml += `</Row>`;
                    rows.forEach(r => {
                        xml += `<Row>`;
                        r.forEach(c => {
                            const isNum = typeof c === "number" && Number.isFinite(c);
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
                workbookXml += buildSheet("Sales", ["ဘောင်ချာအမှတ်", "ဆိုင်ခွဲ", "ဖောက်သည်", "အရောင်းအမျိုးအစား", "ငွေပေးချေမှု", "စုစုပေါင်း", "လျှော့ဈေး", "ကျသင့်ငွေ", "ပေးချေငွေ", "အကြွေးကျန်", "အခြေအနေ", "ရက်စွဲ"], sales.map(s => [s.invoice_no, s.branch_name, s.customer_name, s.sale_type, s.payment_method, s.total_amount, s.discount_amount, s.final_amount, s.paid_amount, s.debt_amount, s.status, s.created_at]));
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

                const senderEmail = env.RESEND_FROM_EMAIL || "Garment ERP <onboarding@resend.dev>";
                const resendResponse = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        from: senderEmail,
                        to: [targetEmail],
                        subject: `မြကမ္ဘာစိုး ပိုးထည်တိုက် - Database Report (${targetYear})`,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 24px; color: #1e293b; background-color: #f8fafc; border-radius: 12px; max-width: 650px; margin: auto;">
                                <h2 style="color: #064e3b; margin: 0 0 10px 0;">မြကမ္ဘာစိုး ပိုးထည်တိုက် (GARMENT ERP)</h2>
                                <p style="font-size: 14px;"><b>${targetYear} ခုနှစ်</b> အတွက် Cloudflare D1 Database ဇယားများကို ပူးတွဲတင်ပြအပ်ပါသည်။</p>
                                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                                <p style="font-size: 11px; color: #94a3b8;">Admin အသုံးပြုသူ ${auth.username} မှ တောင်းဆိုထားသော စနစ်အစီရင်ခံစာ ဖြစ်ပါသည်။</p>
                            </div>
                        `,
                        attachments: [
                            {
                                filename: `Garment_ERP_Report_${targetYear}.xls`,
                                content: base64Excel
                            }
                        ]
                    })
                });

                const resendData = await resendResponse.json().catch(() => ({}));
                if (!resendResponse.ok) {
                    return errorResponse(resendData.message || "Failed to send email via Resend", 500);
                }
                return jsonResponse({ success: true, message: "Multi-sheet Excel report sent successfully", data: resendData });
            }

            return errorResponse(`Route မတွေ့ပါ: ${method} ${path}`, 404);
        } catch (err) {
            if (err instanceof HttpError) {
                return errorResponse(err.message, err.status);
            }
            console.error("[Worker API Error]:", err.message, err.stack);
            const isDev = env?.ENVIRONMENT === "development";
            return errorResponse(
                isDev ? `Server Error: ${err.message}` : "စနစ်အတွင်း အမှားအယွင်းတစ်ခု ဖြစ်ပေါ်နေပါသည်။ ခေတ္တစောင့်ပြီး ပြန်လည်ကြိုးစားပါ။",
                500
            );
        }
    },

    // =========================================================================
    // AUTOMATED DAILY CASHBOOK CLOSING & NIGHTLY STOCK RECONCILIATION CRON
    // Runs at 17:30 UTC (00:00 MMT)
    // =========================================================================
    async scheduled(event, env, ctx) {
        try {
            const closingDate = getMyanmarYesterdayDate();

            // 1. Nightly Stock Reconciliation Check (Spec Section 2.3)
            const { results: mismatches } = await env.DB.prepare(`
                SELECT 
                    b.id AS branch_id, b.name AS branch_name,
                    p.id AS product_id, p.sku, p.item_name,
                    COALESCE(bi.quantity, 0) AS cached_quantity,
                    COALESCE(SUM(sm.quantity), 0) AS ledger_quantity
                FROM products p
                CROSS JOIN branches b
                LEFT JOIN branch_inventory bi ON bi.branch_id = b.id AND bi.product_id = p.id
                LEFT JOIN stock_movements sm ON sm.branch_id = b.id AND sm.product_id = p.id
                WHERE b.is_active = 1 AND p.is_active = 1
                GROUP BY b.id, p.id
                HAVING ABS(COALESCE(SUM(sm.quantity), 0) - COALESCE(bi.quantity, 0)) > 0.001
            `).all().catch(() => ({ results: [] }));

            if (mismatches && mismatches.length > 0) {
                await logAudit(env.DB, {
                    branchId: 1,
                    userId: 1,
                    action: "STOCK_RECONCILIATION_MISMATCH",
                    tableName: "branch_inventory",
                    recordId: closingDate,
                    details: mismatches
                });
                console.warn("[Nightly Stock Reconciliation Mismatch]:", JSON.stringify(mismatches));
            }

            // 2. Incremental Daily Cashbook Closing
            const { results: branches } = await env.DB.prepare(
                "SELECT id FROM branches WHERE is_active = 1"
            ).all();

            const batch = [];
            for (const b of (branches || [])) {
                const lastClosing = await env.DB.prepare(`
                    SELECT closing_date, closing_cash, closing_bank
                    FROM daily_closings
                    WHERE branch_id = ? AND closing_date < ?
                    ORDER BY closing_date DESC LIMIT 1
                `).bind(b.id, closingDate).first();

                const baseDate = lastClosing ? lastClosing.closing_date : "1970-01-01";
                const baseCash = lastClosing ? roundKyat(lastClosing.closing_cash) : 0;
                const baseBank = lastClosing ? roundKyat(lastClosing.closing_bank) : 0;

                const row = await env.DB.prepare(`
                    SELECT 
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' AND entry_date > ? AND entry_date < ? THEN amount 
                                          WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' AND entry_date > ? AND entry_date < ? THEN -amount ELSE 0 END), 0) AS delta_open_cash,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' AND entry_date > ? AND entry_date < ? THEN amount 
                                          WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' AND entry_date > ? AND entry_date < ? THEN -amount ELSE 0 END), 0) AS delta_open_bank,
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' AND entry_date = ? THEN amount ELSE 0 END), 0) AS cash_in,
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' AND entry_date = ? THEN amount ELSE 0 END), 0) AS cash_out,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' AND entry_date = ? THEN amount ELSE 0 END), 0) AS bank_in,
                        COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' AND entry_date = ? THEN amount ELSE 0 END), 0) AS bank_out
                    FROM cashbook_entries
                    WHERE branch_id = ? AND entry_date > ? AND entry_date <= ? AND COALESCE(status, 'completed') != 'cancelled'
                `).bind(
                    baseDate, closingDate, baseDate, closingDate,
                    baseDate, closingDate, baseDate, closingDate,
                    closingDate, closingDate, closingDate, closingDate,
                    b.id, baseDate, closingDate
                ).first();

                if (row) {
                    const openCash = baseCash + roundKyat(row.delta_open_cash);
                    const openBank = baseBank + roundKyat(row.delta_open_bank);
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

            // 3. Optional Daily Email Summary (+ Reconciliation Alert if any mismatch)
            if (env.RESEND_API_KEY && env.ADMIN_EMAIL) {
                const { startUtc: dayStartUtc, endUtc: dayEndUtc } = getMyanmarDayUtcBounds(closingDate);
                const [prodRes, salesRes] = await env.DB.batch([
                    env.DB.prepare(`
                        SELECT p.id, p.sku, p.category, p.item_name, p.cost_price, COALESCE(SUM(bi.quantity), 0) AS total_stock
                        FROM products p
                        LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                        WHERE p.is_active = 1
                        GROUP BY p.id
                    `),
                    env.DB.prepare(`
                        SELECT s.invoice_no, b.name AS branch_name, s.final_amount, s.status, s.created_at
                        FROM sales s
                        LEFT JOIN branches b ON s.branch_id = b.id
                        WHERE s.created_at >= ? AND s.created_at <= ?
                        ORDER BY s.id DESC
                    `).bind(dayStartUtc, dayEndUtc)
                ]);

                const cleanXml = (val) => String(val ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
                const buildSheet = (sheetName, headers, rows) => {
                    let xml = `<Worksheet ss:Name="${cleanXml(sheetName)}"><Table><Row ss:StyleID="Header">`;
                    headers.forEach(h => { xml += `<Cell><Data ss:Type="String">${cleanXml(h)}</Data></Cell>`; });
                    xml += `</Row>`;
                    rows.forEach(r => {
                        xml += `<Row>`;
                        r.forEach(c => {
                            const isNum = typeof c === "number" && Number.isFinite(c);
                            xml += `<Cell><Data ss:Type="${isNum ? "Number" : "String"}">${cleanXml(c)}</Data></Cell>`;
                        });
                        xml += `</Row>`;
                    });
                    xml += `</Table></Worksheet>`;
                    return xml;
                };

                let workbookXml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#064E3B" ss:Pattern="Solid"/></Style></Styles>`;
                workbookXml += buildSheet("Products", ["ID", "SKU", "အမျိုးအစား", "ပစ္စည်းအမည်", "အရင်းဈေး", "လက်ကျန်"], (prodRes.results || []).map(p => [p.id, p.sku, p.category, p.item_name, p.cost_price, p.total_stock]));
                workbookXml += buildSheet("Daily_Sales", ["ဘောင်ချာ", "ဆိုင်ခွဲ", "ကျသင့်ငွေ", "အခြေအနေ", "ရက်စွဲ"], (salesRes.results || []).map(s => [s.invoice_no, s.branch_name, s.final_amount, s.status, s.created_at]));
                workbookXml += `</Workbook>`;

                const utf8Bytes = new TextEncoder().encode(workbookXml);
                let binaryStr = "";
                const chunkSize = 8192;
                for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
                    binaryStr += String.fromCharCode.apply(null, utf8Bytes.subarray(i, i + chunkSize));
                }
                const base64Excel = btoa(binaryStr);

                const mismatchWarningHtml = (mismatches && mismatches.length > 0)
                    ? `<p style="color:#dc2626;font-weight:bold;">⚠️ သတိပေးချက်: Stock Movement Ledger နှင့် Branch Inventory ကြား ကွဲလွဲမှု (${mismatches.length}) ခု တွေ့ရှိရပါသည်။ System Reconciliation တွင် စစ်ဆေးပါ။</p>`
                    : `<p style="color:#059669;">✅ Nightly Stock Reconciliation: Movement Ledger နှင့် ဆိုင်ခွဲလက်ကျန် အားလုံး ၁၀၀% ကိုက်ညီပါသည်။</p>`;

                const senderEmail = env.RESEND_FROM_EMAIL || "Garment ERP <onboarding@resend.dev>";
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        from: senderEmail,
                        to: [env.ADMIN_EMAIL],
                        subject: `မြကမ္ဘာစိုး ပိုးထည်တိုက် - Auto Daily Closing & Reconciliation (${closingDate})`,
                        html: `<p><b>${closingDate}</b> ရက်နေ့အတွက် နေ့စဉ် အလိုအလျောက် ငွေစာရင်းပိတ်သိမ်းခြင်းနှင့် အရောင်းမှတ်တမ်းဖိုင်ကို ပူးတွဲတင်ပြအပ်ပါသည်။</p>${mismatchWarningHtml}`,
                        attachments: [{ filename: `Daily_Closing_${closingDate}.xls`, content: base64Excel }]
                    })
                });

                if (!res.ok) {
                    const errBody = await res.text().catch(() => "");
                    console.error("[Cron Resend Email Error]:", res.status, errBody);
                }
            }
        } catch (err) {
            console.error("[Cron Error]:", err.message, err.stack);
        }
    }
};
