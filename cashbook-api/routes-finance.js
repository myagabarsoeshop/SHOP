// =============================================================================
// FILE 4 OF 5: cashbook-api/routes-finance.js
// MULTI-STORE CASHBOOK & CUSTOMERS / SUPPLIERS DEBT & PAYABLE LEDGERS
// Version: 3.2.0 (Desync-Protected Cashbook, Overpayment Guard & Atomic Ledgers)
// =============================================================================

import {
    jsonResponse,
    errorResponse,
    getMyanmarTodayDate,
    roundKyat,
    getQueryYear,
    resolveBranchId,
    requireRole,
    logAudit
} from "./utils.js";

export async function handleFinanceRoutes(request, env, url, path, method, auth) {
    const currentUserId = auth.uid;
    const currentUserRole = auth.role;
    const userBranchId = auth.branch_id;
    const isAdminOrFinance = requireRole(auth, ["admin", "finance", "manager"]);

    // =========================================================================
    // 1. CASHBOOK CATEGORIES & ENTRIES (D1 BATCHED, SOFT-DELETE AWARE & PROTECTED)
    // =========================================================================
    if (path === "/api/cashbook/categories" && method === "GET") {
        const { results } = await env.DB.prepare(
            "SELECT id, name, type, is_system, COALESCE(is_remittance, 0) AS is_remittance FROM cash_categories WHERE is_active = 1 ORDER BY is_system DESC, id ASC"
        ).all();
        return jsonResponse(results || []);
    }

    if (path === "/api/cashbook/entries" && method === "GET") {
        const requestedBranch = url.searchParams.get("branch_id");
        const branchId = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });

        const targetYear = getQueryYear(url);
        const yearStart = `${targetYear}-01-01`;
        const yearEnd = `${targetYear}-12-31`;

        const startDate = url.searchParams.get("start_date") || yearStart;
        const endDate = url.searchParams.get("end_date") || yearEnd;

        // ၁။ စာရင်း အသေးစိတ် ဆွဲယူခြင်း (Soft-deleted/cancelled မှတ်တမ်းများ မပါဝင်စေရ)
        let sql = `
            SELECT 
                ce.id, 
                ce.branch_id, 
                COALESCE(b.name, 'Main Shop') AS branch_name,
                ce.category_id, 
                COALESCE(cc.name, 'အထွေထွေ') AS category_name,
                ce.entry_type, 
                ce.payment_method, 
                ce.bank_account_name,
                ce.amount, 
                COALESCE(ce.diff_amount, p.diff_amount, 0) AS diff_amount,
                COALESCE(ce.ref_no, p.ref_no, s.invoice_no, p.purchase_no, 'VR-CB-' || printf('%05d', ce.id)) AS ref_no,
                COALESCE(s.invoice_no, p.purchase_no, 'VR-CB-' || printf('%05d', ce.id)) AS reference_no,
                ce.entry_date,
                ce.sale_id, 
                ce.customer_ledger_id, 
                ce.supplier_ledger_id,
                ce.purchase_id,
                COALESCE(u.full_name, 'System') AS created_by_name,
                COALESCE(
                    (SELECT SUM(si.quantity) FROM sale_items si WHERE si.sale_id = ce.sale_id),
                    (SELECT SUM(pi.quantity) FROM purchase_items pi WHERE pi.purchase_id = ce.purchase_id),
                    NULL
                ) AS total_quantity,
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
            WHERE ce.entry_date >= ? AND ce.entry_date <= ? 
              AND ce.entry_date >= ? AND ce.entry_date <= ?
              AND COALESCE(ce.status, 'completed') != 'cancelled'
        `;
        const bindings = [startDate, endDate, yearStart, yearEnd];
        if (branchId && branchId !== "ALL") {
            sql += " AND ce.branch_id = ?";
            bindings.push(Number(branchId));
        }
        sql += " ORDER BY ce.entry_date DESC, ce.id DESC LIMIT 500";

        // ၂။ ဆိုင်နှင့် ဘဏ် လက်ကျန်ငွေ အစစ်အမှန် (သတ်မှတ်ရက်စွဲအထိ စုစုပေါင်းလက်ကျန်အမှန်)
        let balanceSql = `
            SELECT 
                COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount 
                                  WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS cash_balance,
                COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount 
                                  WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS bank_balance
            FROM cashbook_entries
            WHERE entry_date <= ?
              AND COALESCE(status, 'completed') != 'cancelled'
        `;
        const balanceBindings = [endDate];
        if (branchId && branchId !== "ALL") {
            balanceSql += " AND branch_id = ?";
            balanceBindings.push(Number(branchId));
        }

        // ၃။ ရွေးချယ်ထားသော ရက်စွဲအတွက် အသုံးစရိတ် နှင့် ဝင်ငွေ စာရင်းချုပ်
        let summarySql = `
            SELECT 
                COALESCE(SUM(CASE WHEN ce.entry_type = 'EXPENSE' AND (COALESCE(cc.is_remittance, 0) = 1 OR cc.name LIKE '%ပိုင်ရှင်%' OR cc.name LIKE '%အပ်ငွေ%' OR cc.name LIKE '%လွှဲ%' OR ce.category_id = 10) THEN ce.amount ELSE 0 END), 0) AS today_remittance,
                COALESCE(SUM(CASE WHEN ce.entry_type = 'EXPENSE' AND NOT (COALESCE(cc.is_remittance, 0) = 1 OR cc.name LIKE '%ပိုင်ရှင်%' OR cc.name LIKE '%အပ်ငွေ%' OR cc.name LIKE '%လွှဲ%' OR ce.category_id = 10) THEN ce.amount ELSE 0 END), 0) AS today_expense,
                COALESCE(SUM(CASE WHEN ce.entry_type = 'INCOME' THEN ce.amount ELSE 0 END), 0) AS today_income
            FROM cashbook_entries ce
            LEFT JOIN cash_categories cc ON ce.category_id = cc.id
            WHERE ce.entry_date >= ? AND ce.entry_date <= ? 
              AND ce.entry_date >= ? AND ce.entry_date <= ?
              AND COALESCE(ce.status, 'completed') != 'cancelled'
        `;
        const summaryBindings = [startDate, endDate, yearStart, yearEnd];
        if (branchId && branchId !== "ALL") {
            summarySql += " AND ce.branch_id = ?";
            summaryBindings.push(Number(branchId));
        }

        const [entriesRes, balanceRes, summaryRes] = await env.DB.batch([
            env.DB.prepare(sql).bind(...bindings),
            env.DB.prepare(balanceSql).bind(...balanceBindings),
            env.DB.prepare(summarySql).bind(...summaryBindings)
        ]);

        const entries = (entriesRes.results || []).map(row => ({
            ...row,
            unit_price: row.total_quantity && Number(row.total_quantity) > 0
                ? Math.round(Number(row.amount || 0) / Number(row.total_quantity))
                : null
        }));
        const balanceRow = (balanceRes.results || [])[0] || {};
        const todaySummaryRow = (summaryRes.results || [])[0] || {};

        return jsonResponse({
            summary: {
                cash_balance: roundKyat(balanceRow.cash_balance || 0),
                bank_balance: roundKyat(balanceRow.bank_balance || 0),
                today_expense: roundKyat(todaySummaryRow.today_expense || 0),
                today_remittance: roundKyat(todaySummaryRow.today_remittance || 0),
                today_income: roundKyat(todaySummaryRow.today_income || 0)
            },
            entries
        });
    }

    if (path === "/api/cashbook/entries" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const targetBranch = resolveBranchId(auth, body.branchId);
        const { categoryId, entryType, paymentMethod = "cash", bankAccountName = null, amount, description = "", entryDate, refNo = null, diffAmount = 0 } = body;

        const cleanDesc = String(description || "").trim();
        if (!cleanDesc) {
            return errorResponse("အသေးစိတ် အကြောင်းအရာ (Description) ထည့်သွင်းပေးပါ", 400);
        }

        const cleanAmt = roundKyat(amount);
        if (!categoryId || cleanAmt <= 0) {
            return errorResponse("ခေါင်းစဉ်နှင့် ငွေပမာဏ မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
        }

        const validPayMethod = ["cash", "bank"].includes(String(paymentMethod).toLowerCase())
            ? String(paymentMethod).toLowerCase()
            : "cash";

        const res = await env.DB.prepare(`
            INSERT INTO cashbook_entries (branch_id, category_id, entry_type, payment_method, bank_account_name, amount, diff_amount, ref_no, description, entry_date, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
        `).bind(
            targetBranch,
            Number(categoryId),
            String(entryType || "EXPENSE").toUpperCase() === "INCOME" ? "INCOME" : "EXPENSE",
            validPayMethod,
            bankAccountName || null,
            cleanAmt,
            roundKyat(diffAmount || 0),
            refNo && String(refNo).trim() !== "" ? String(refNo).trim() : null,
            cleanDesc,
            entryDate || getMyanmarTodayDate(),
            currentUserId
        ).run();

        return jsonResponse({ message: "စာရင်းသွင်းပြီးပါပြီ", id: res.meta.last_row_id }, 201);
    }

    if (path.startsWith("/api/cashbook/entries/") && method === "PUT") {
        const id = Number(path.split("/").pop());
        const body = await request.json().catch(() => ({}));
        const { categoryId, entryType, paymentMethod = "cash", bankAccountName = null, amount, description = "", entryDate, refNo = null, diffAmount = 0 } = body;

        const existing = await env.DB.prepare(
            "SELECT id, branch_id, sale_id, purchase_id, customer_ledger_id, supplier_ledger_id, status FROM cashbook_entries WHERE id = ?"
        ).bind(id).first();

        if (!existing || existing.status === "cancelled") {
            return errorResponse("ငွေစာရင်းမှတ်တမ်း ရှာမတွေ့ပါ", 404);
        }

        if (!isAdminOrFinance && Number(existing.branch_id) !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ ငွေစာရင်းအား ပြင်ဆင်ခွင့် မရှိပါ", 403);
        }

        // Prevent direct tampering of POS / Purchase / Debt-Repayment linked cashbook entries
        if (existing.sale_id || existing.purchase_id || existing.customer_ledger_id || existing.supplier_ledger_id) {
            return errorResponse(
                "ဤငွေစာရင်းသည် အရောင်း/အဝယ်/အကြွေးဆပ် ဘောင်ချာနှင့် တိုက်ရိုက်ချိတ်ဆက်ထားသဖြင့် Cashbook မှ တိုက်ရိုက်ပြင်၍ မရပါ။ မူရင်းဘောင်ချာမှသာ ပြင်ဆင်ပေးပါ။",
                400
            );
        }

        const cleanDesc = String(description || "").trim();
        if (!cleanDesc) {
            return errorResponse("အသေးစိတ် အကြောင်းအရာ (Description) ထည့်သွင်းပေးပါ", 400);
        }

        const cleanAmt = roundKyat(amount);
        if (!categoryId || cleanAmt <= 0) {
            return errorResponse("ခေါင်းစဉ်နှင့် ငွေပမာဏ မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
        }

        await env.DB.prepare(`
            UPDATE cashbook_entries SET
                category_id = ?,
                entry_type = ?,
                payment_method = ?,
                bank_account_name = COALESCE(?, bank_account_name),
                amount = ?,
                diff_amount = ?,
                ref_no = ?,
                description = ?,
                entry_date = COALESCE(?, entry_date)
            WHERE id = ?
        `).bind(
            Number(categoryId),
            String(entryType || "EXPENSE").toUpperCase() === "INCOME" ? "INCOME" : "EXPENSE",
            ["cash", "bank"].includes(String(paymentMethod).toLowerCase()) ? String(paymentMethod).toLowerCase() : "cash",
            bankAccountName || null,
            cleanAmt,
            roundKyat(diffAmount || 0),
            refNo && String(refNo).trim() !== "" ? String(refNo).trim() : null,
            cleanDesc,
            entryDate || null,
            id
        ).run();

        await logAudit(env.DB, {
            branchId: existing.branch_id,
            userId: currentUserId,
            action: "UPDATE_CASHBOOK_ENTRY",
            tableName: "cashbook_entries",
            recordId: id,
            details: { amount: cleanAmt, description: cleanDesc }
        });

        return jsonResponse({ message: "ငွေစာရင်း ပြင်ဆင်ပြီးပါပြီ" });
    }

    if (path.startsWith("/api/cashbook/entries/") && method === "DELETE") {
        const id = Number(path.split("/").pop());
        const existing = await env.DB.prepare(
            "SELECT id, branch_id, amount, description, sale_id, purchase_id, customer_ledger_id, supplier_ledger_id, status FROM cashbook_entries WHERE id = ?"
        ).bind(id).first();

        if (!existing || existing.status === "cancelled") {
            return errorResponse("ငွေစာရင်းမှတ်တမ်း ရှာမတွေ့ပါ", 404);
        }

        if (!isAdminOrFinance && Number(existing.branch_id) !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ ငွေစာရင်းအား ဖျက်သိမ်းခွင့် မရှိပါ", 403);
        }

        // Prevent direct deletion of linked entries to avoid ledger/inventory desynchronization
        if (existing.sale_id || existing.purchase_id || existing.customer_ledger_id || existing.supplier_ledger_id) {
            return errorResponse(
                "ဤငွေစာရင်းသည် အရောင်း/အဝယ်/အကြွေးဆပ် ဘောင်ချာနှင့် တိုက်ရိုက်ချိတ်ဆက်ထားသဖြင့် Cashbook မှ တိုက်ရိုက်ဖျက်၍ မရပါ။ သက်ဆိုင်ရာ ဘောင်ချာစာရင်းမှသာ ပယ်ဖျက် (Void) ပေးပါ။",
                400
            );
        }

        await env.DB.prepare("UPDATE cashbook_entries SET status = 'cancelled' WHERE id = ?").bind(id).run();

        await logAudit(env.DB, {
            branchId: existing.branch_id,
            userId: currentUserId,
            action: "VOID_CASHBOOK_ENTRY",
            tableName: "cashbook_entries",
            recordId: id,
            details: { amount: existing.amount, description: existing.description }
        });

        return jsonResponse({ message: "ဖျက်ပြီးပါပြီ" });
    }

    // =========================================================================
    // 2. CUSTOMERS & SUPPLIERS DEBT / LIABILITIES MANAGEMENT
    // =========================================================================
    if (path === "/api/customers" && method === "GET") {
        const { results } = await env.DB.prepare(`
            SELECT 
                id, name, phone, shop_name, address,
                COALESCE(entity_type, 'CUSTOMER') AS entity_type,
                COALESCE(customer_type, 'retail') AS customer_type,
                COALESCE(credit_limit, 0) AS credit_limit,
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

    if (path === "/api/customers" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (!body.name || !String(body.name).trim()) {
            return errorResponse("အမည် ထည့်သွင်းပေးပါ", 400);
        }

        const cleanName = String(body.name).trim();
        const entityType = String(body.entityType || body.entity_type || "CUSTOMER").toUpperCase();
        const openingBalance = Math.max(0, roundKyat(body.initialDebt ?? body.initialPayable ?? body.current_debt ?? 0));
        const creditLimit = Math.max(0, roundKyat(body.creditLimit ?? body.credit_limit ?? 0));

        const initialDebt = entityType === "CUSTOMER" ? openingBalance : 0;
        const initialPayable = entityType === "SUPPLIER" ? openingBalance : 0;
        const cleanPhone = body.phone && String(body.phone).trim() !== "" ? String(body.phone).trim() : null;
        const cleanShop = (body.shopName || body.shop_name) ? String(body.shopName || body.shop_name).trim() : null;
        const cleanAddr = body.address ? String(body.address).trim() : null;

        const res = await env.DB.prepare(`
            INSERT INTO customers (name, phone, shop_name, entity_type, customer_type, credit_limit, current_debt, current_payable, address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            cleanName,
            cleanPhone,
            cleanShop,
            entityType,
            body.customerType || body.customer_type || (entityType === "SUPPLIER" ? "wholesale" : "retail"),
            creditLimit,
            initialDebt,
            initialPayable,
            cleanAddr
        ).run();

        const newId = res.meta.last_row_id;

        try {
            if (entityType === "CUSTOMER" && initialDebt > 0) {
                await env.DB.prepare(`
                    INSERT INTO customer_ledger (customer_id, branch_id, type, amount, balance_after, payment_method, reference_note, status, created_by)
                    VALUES (?, ?, 'DEBIT', ?, ?, 'opening', 'ကနဦး အကြွေးလက်ကျန် (Opening Debt)', 'completed', ?)
                `).bind(newId, userBranchId, initialDebt, initialDebt, currentUserId).run();
            } else if (entityType === "SUPPLIER" && initialPayable > 0) {
                await env.DB.prepare(`
                    INSERT INTO supplier_ledger (supplier_id, branch_id, type, amount, balance_after, payment_method, reference_note, status, created_by)
                    VALUES (?, ?, 'PURCHASE_DEBT', ?, ?, 'opening', 'ကနဦး ပေးရန်ကျန်ငွေ (Opening Payable)', 'completed', ?)
                `).bind(newId, userBranchId, initialPayable, initialPayable, currentUserId).run();
            }
        } catch (err) {
            await env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(newId).run().catch(() => {});
            throw new Error(`ကနဦးအကြွေးစာရင်း သိမ်းဆည်းမှု မအောင်မြင်ပါ: ${err.message}`);
        }

        return jsonResponse({ id: newId, message: `${entityType === "SUPPLIER" ? "ပွဲရုံ" : "ဖောက်သည်"} အသစ် သိမ်းဆည်းပြီးပါပြီ` }, 201);
    }

    if (path.startsWith("/api/customers/") && !path.endsWith("/ledger") && !path.endsWith("/repay") && method === "PUT") {
        const id = Number(path.split("/").pop());
        const body = await request.json().catch(() => ({}));
        if (!id || !body.name) return errorResponse("အမည် အချက်အလက် လိုအပ်ပါသည်", 400);

        const existing = await env.DB.prepare(
            "SELECT id, name, entity_type, COALESCE(current_debt, 0) AS current_debt, COALESCE(current_payable, 0) AS current_payable FROM customers WHERE id = ?"
        ).bind(id).first();
        if (!existing) return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

        const cleanPhone = body.phone && String(body.phone).trim() !== "" ? String(body.phone).trim() : null;
        const cleanShop = (body.shopName ?? body.shop_name) ? String(body.shopName ?? body.shop_name).trim() : null;
        const cleanAddr = body.address ? String(body.address).trim() : null;
        const entityType = body.entityType || body.entity_type ? String(body.entityType || body.entity_type).toUpperCase() : existing.entity_type;
        const creditLimit = (isAdminOrFinance && (body.creditLimit !== undefined || body.credit_limit !== undefined))
            ? Math.max(0, roundKyat(body.creditLimit ?? body.credit_limit))
            : null;

        await env.DB.prepare(`
            UPDATE customers SET 
                name = ?, 
                phone = ?, 
                shop_name = ?, 
                address = ?,
                entity_type = COALESCE(?, entity_type),
                customer_type = COALESCE(?, customer_type),
                credit_limit = COALESCE(?, credit_limit)
            WHERE id = ?
        `).bind(
            String(body.name).trim(),
            cleanPhone,
            cleanShop,
            cleanAddr,
            entityType,
            body.customerType || body.customer_type || null,
            creditLimit,
            id
        ).run();

        await logAudit(env.DB, {
            branchId: userBranchId,
            userId: currentUserId,
            action: "UPDATE_CUSTOMER_OR_SUPPLIER",
            tableName: "customers",
            recordId: id,
            details: { name: String(body.name).trim(), entityType }
        });

        return jsonResponse({ message: "အချက်အလက် ပြင်ဆင်ပြီးပါပြီ" });
    }

    if (path.startsWith("/api/customers/") && !path.endsWith("/ledger") && !path.endsWith("/repay") && method === "DELETE") {
        if (!isAdminOrFinance) {
            return errorResponse("ဖောက်သည်/ပွဲရုံ စာရင်းဖျက်သိမ်းခွင့်ကို Admin / Finance သာ ခွင့်ပြုပါသည်", 403);
        }

        const id = Number(path.split("/").pop());
        if (!id) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const cust = await env.DB.prepare(
            "SELECT name, COALESCE(current_debt, 0) AS current_debt, COALESCE(current_payable, 0) AS current_payable FROM customers WHERE id = ?"
        ).bind(id).first();

        if (cust && (Number(cust.current_debt) > 0 || Number(cust.current_payable) > 0)) {
            return errorResponse("အကြွေးလက်ကျန် ရှိနေသော ဖောက်သည်/ပွဲရုံအား စာရင်းမှ ပယ်ဖျက်၍ မရပါ", 400);
        }

        await env.DB.prepare("UPDATE customers SET is_active = 0 WHERE id = ?").bind(id).run();

        await logAudit(env.DB, {
            branchId: userBranchId,
            userId: currentUserId,
            action: "DEACTIVATE_CUSTOMER",
            tableName: "customers",
            recordId: id,
            details: { name: cust?.name }
        });

        return jsonResponse({ message: "စာရင်းမှ အောင်မြင်စွာ ပယ်ဖျက်ပြီးပါပြီ" });
    }

    // UNIVERSAL DEBT REPAYMENT POST (ဖောက်သည်အကြွေးဆပ်ငွေ လက်ခံခြင်း / ပွဲရုံသို့ အကြွေးဆပ်ခြင်း - Atomic & Overpayment Guarded)
    if (path === "/api/customers/repay" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const targetBranch = resolveBranchId(auth, body.branchId);
        const { customerId, amount, paymentMethod = "cash", bankAccountName = null, note = "", entryDate } = body;

        const repayAmt = roundKyat(amount);
        if (!customerId || repayAmt <= 0) return errorResponse("ပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ", 400);

        const contact = await env.DB.prepare(
            "SELECT name, shop_name, COALESCE(entity_type, 'CUSTOMER') AS entity_type, COALESCE(current_debt, 0) AS current_debt, COALESCE(current_payable, 0) AS current_payable FROM customers WHERE id = ?"
        ).bind(Number(customerId)).first();

        if (!contact) return errorResponse("စာရင်း ရှာမတွေ့ပါ", 404);

        const isSupplier = String(contact.entity_type).toUpperCase() === "SUPPLIER";
        const today = entryDate || getMyanmarTodayDate();
        const payMethod = ["cash", "bank"].includes(String(paymentMethod).toLowerCase())
            ? String(paymentMethod).toLowerCase()
            : "cash";
        const methodLabel = payMethod === "bank" ? (bankAccountName || "Bank") : "ငွေသား";
        const displayName = contact.shop_name || contact.name;
        const refCode = `PAY-${isSupplier ? "SUP" : "CUS"}-${customerId}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

        if (isSupplier) {
            const oldPayable = roundKyat(contact.current_payable || 0);
            if (oldPayable <= 0) {
                return errorResponse(`"${displayName}" အတွက် ပေးရန်ကျန်ငွေ မရှိတော့ပါ`, 400);
            }
            if (repayAmt > oldPayable) {
                return errorResponse(`ပေးချေသည့်ငွေ (${repayAmt.toLocaleString()} Ks) သည် လက်ရှိပေးရန်ကျန်ငွေ (${oldPayable.toLocaleString()} Ks) ထက် ပိုများနေပါသည်`, 400);
            }

            const newPayable = oldPayable - repayAmt;

            await env.DB.batch([
                env.DB.prepare(`
                    INSERT INTO supplier_ledger (supplier_id, branch_id, type, amount, balance_after, payment_method, bank_account_name, reference_note, status, created_by)
                    VALUES (?, ?, 'PAYMENT', ?, ?, ?, ?, ?, 'completed', ?)
                `).bind(
                    Number(customerId), targetBranch, repayAmt, newPayable,
                    payMethod, bankAccountName || null,
                    note || `ပွဲရုံသို့ အကြွေးဆပ်ငွေ (${methodLabel})`,
                    currentUserId
                ),
                env.DB.prepare("UPDATE customers SET current_payable = ? WHERE id = ?").bind(newPayable, Number(customerId)),
                env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, supplier_ledger_id, entry_type, payment_method, bank_account_name, amount, ref_no, description, entry_date, status, created_by
                    ) VALUES (
                        ?, 11, (SELECT MAX(id) FROM supplier_ledger WHERE supplier_id = ?), 'EXPENSE', ?, ?, ?, ?, ?, ?, 'completed', ?
                    )
                `).bind(
                    targetBranch, Number(customerId), payMethod, bankAccountName || null,
                    repayAmt, refCode, `${displayName} - ပွဲရုံကြွေးဆပ် (${note || methodLabel})`,
                    today, currentUserId
                )
            ]);

            return jsonResponse({ message: "ပွဲရုံသို့ အကြွေးဆပ်ငွေ မှတ်တမ်းတင်ပြီးပါပြီ", newBalance: newPayable });
        } else {
            const oldDebt = roundKyat(contact.current_debt || 0);
            if (oldDebt <= 0) {
                return errorResponse(`"${displayName}" တွင် ရရန်ကျန်အကြွေး မရှိတော့ပါ`, 400);
            }
            if (repayAmt > oldDebt) {
                return errorResponse(`လက်ခံရရှိငွေ (${repayAmt.toLocaleString()} Ks) သည် လက်ရှိအကြွေးလက်ကျန် (${oldDebt.toLocaleString()} Ks) ထက် ပိုများနေပါသည်`, 400);
            }

            const newDebt = oldDebt - repayAmt;

            await env.DB.batch([
                env.DB.prepare(`
                    INSERT INTO customer_ledger (customer_id, branch_id, type, amount, balance_after, payment_method, bank_account_name, reference_note, status, created_by)
                    VALUES (?, ?, 'CREDIT', ?, ?, ?, ?, ?, 'completed', ?)
                `).bind(
                    Number(customerId), targetBranch, repayAmt, newDebt,
                    payMethod, bankAccountName || null,
                    note || `အကြွေးဆပ် (${methodLabel})`,
                    currentUserId
                ),
                env.DB.prepare("UPDATE customers SET current_debt = ? WHERE id = ?").bind(newDebt, Number(customerId)),
                env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, customer_ledger_id, entry_type, payment_method, bank_account_name, amount, ref_no, description, entry_date, status, created_by
                    ) VALUES (
                        ?, 2, (SELECT MAX(id) FROM customer_ledger WHERE customer_id = ?), 'INCOME', ?, ?, ?, ?, ?, ?, 'completed', ?
                    )
                `).bind(
                    targetBranch, Number(customerId), payMethod, bankAccountName || null,
                    repayAmt, refCode, `${displayName} - အကြွေးဆပ် (${note || methodLabel})`,
                    today, currentUserId
                )
            ]);

            return jsonResponse({ message: "အကြွေးဆပ်ငွေ လက်ခံပြီးပါပြီ", newBalance: newDebt });
        }
    }

    // STATEMENT LEDGER GET (Customer Statement သို့မဟုတ် Supplier Statement)
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
                    sl.type, sl.amount, sl.balance_after, sl.payment_method, sl.bank_account_name,
                    sl.reference_note, sl.created_at,
                    p.purchase_no AS invoice_no,
                    COALESCE(u.full_name, 'Admin') AS created_by_name
                FROM supplier_ledger sl
                LEFT JOIN purchases p ON sl.purchase_id = p.id
                LEFT JOIN users u ON sl.created_by = u.id
                WHERE sl.supplier_id = ? AND COALESCE(sl.status, 'completed') != 'cancelled'
                ORDER BY sl.id DESC LIMIT 300
            `;
            const { results } = await env.DB.prepare(sql).bind(customerId).all();
            return jsonResponse(results || []);
        } else {
            const sql = `
                SELECT 
                    cl.id, cl.customer_id, cl.branch_id, cl.sale_id,
                    cl.type, cl.amount, cl.balance_after, cl.payment_method, cl.bank_account_name,
                    cl.reference_note, cl.created_at,
                    s.invoice_no,
                    COALESCE(u.full_name, 'Admin') AS created_by_name
                FROM customer_ledger cl
                LEFT JOIN sales s ON cl.sale_id = s.id
                LEFT JOIN users u ON cl.created_by = u.id
                WHERE cl.customer_id = ? AND COALESCE(cl.status, 'completed') != 'cancelled'
                ORDER BY cl.id DESC LIMIT 300
            `;
            const { results } = await env.DB.prepare(sql).bind(customerId).all();
            return jsonResponse(results || []);
        }
    }

    return null;
}
