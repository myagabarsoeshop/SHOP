// cashbook-api/controllers/cashbook.controller.js
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * ၁။ ငွေစာရင်း ခေါင်းစဉ်များ ရယူခြင်း (Dropdown ရွေးချယ်ရန်)
 * GET /api/cashbook/categories?type=INCOME
 */
export async function handleGetCategories(request, env) {
    try {
        const url = new URL(request.url);
        const type = url.searchParams.get("type"); // INCOME သို့မဟုတ် EXPENSE

        let query = "SELECT id, name, type, is_system FROM cash_categories WHERE is_active = 1";
        const bindings = [];

        if (type) {
            query += " AND type = ?";
            bindings.push(type.toUpperCase());
        }

        query += " ORDER BY is_system DESC, name ASC";

        const { results } = await env.DB.prepare(query).bind(...bindings).all();
        return successResponse(results || []);
    } catch (err) {
        return errorResponse(`ခေါင်းစဉ်များ ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ၂။ ဆိုင်ခွဲအလိုက် နေ့စဉ် ငွေစာရင်း အဝင်/အထွက် မှတ်တမ်းများ ရယူခြင်း
 * GET /api/cashbook/entries?branch_id=1&start_date=2026-10-01&end_date=2026-10-29
 */
export async function handleGetEntries(request, env) {
    try {
        const url = new URL(request.url);
        const branchId = url.searchParams.get("branch_id"); // NULL ဆိုပါက Admin/Finance အတွက် All Branches
        const startDate = url.searchParams.get("start_date") || new Date().toISOString().split("T")[0];
        const endDate = url.searchParams.get("end_date") || startDate;
        const paymentMethod = url.searchParams.get("payment_method"); // cash သို့မဟုတ် bank

        let query = `
            SELECT 
                ce.id,
                ce.branch_id,
                b.name AS branch_name,
                ce.category_id,
                cc.name AS category_name,
                ce.entry_type,
                ce.payment_method,
                ce.bank_account_name,
                ce.amount,
                ce.description,
                ce.entry_date,
                ce.sale_id,
                ce.customer_ledger_id,
                ce.purchase_id,
                u.full_name AS created_by_name,
                ce.created_at
            FROM cashbook_entries ce
            JOIN branches b ON ce.branch_id = b.id
            JOIN cash_categories cc ON ce.category_id = cc.id
            JOIN users u ON ce.created_by = u.id
            WHERE ce.entry_date BETWEEN ? AND ?
        `;

        const bindings = [startDate, endDate];

        if (branchId) {
            query += " AND ce.branch_id = ?";
            bindings.push(branchId);
        }

        if (paymentMethod) {
            query += " AND ce.payment_method = ?";
            bindings.push(paymentMethod);
        }

        query += " ORDER BY ce.entry_date DESC, ce.id DESC LIMIT 300";

        const { results } = await env.DB.prepare(query).bind(...bindings).all();

        // Cash နှင့် Bank လက်ကျန် စုစုပေါင်း တွက်ချက်ခြင်း
        let totalCashIn = 0, totalCashOut = 0;
        let totalBankIn = 0, totalBankOut = 0;

        (results || []).forEach(row => {
            const amount = parseFloat(row.amount) || 0;
            if (row.payment_method === "cash") {
                if (row.entry_type === "INCOME") totalCashIn += amount;
                else totalCashOut += amount;
            } else if (row.payment_method === "bank") {
                if (row.entry_type === "INCOME") totalBankIn += amount;
                else totalBankOut += amount;
            }
        });

        return successResponse({
            summary: {
                cash: {
                    in: totalCashIn,
                    out: totalCashOut,
                    net: totalCashIn - totalCashOut
                },
                bank: {
                    in: totalBankIn,
                    out: totalBankOut,
                    net: totalBankIn - totalBankOut
                },
                totalNet: (totalCashIn - totalCashOut) + (totalBankIn - totalBankOut)
            },
            entries: results || []
        });

    } catch (err) {
        return errorResponse(`ငွေစာရင်း ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ၃။ နေ့စဉ် ငွေဝင်/ငွေထွက် စာရင်း လက်ဖြင့် သွင်းခြင်း (Manual Income/Expense)
 * POST /api/cashbook/entries
 */
export async function handleCreateEntry(request, env) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.branchId || !body.categoryId || !body.amount || !body.entryType) {
            return errorResponse("ဆိုင်ခွဲ (branchId)၊ ခေါင်းစဉ် (categoryId)၊ ပမာဏ (amount) နှင့် အမျိုးအစား (entryType) မဖြစ်မနေ ထည့်သွင်းပေးပါ", 400);
        }

        const {
            branchId,
            categoryId,
            entryType, // 'INCOME' သို့မဟုတ် 'EXPENSE'
            paymentMethod = "cash", // 'cash' သို့မဟုတ် 'bank'
            bankAccountName = null,
            amount,
            description = "",
            entryDate = new Date().toISOString().split("T")[0],
            createdBy = 1
        } = body;

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return errorResponse("ငွေပမာဏသည် သုညထက် ကြီးရပါမည်", 400);
        }

        const insertSql = `
            INSERT INTO cashbook_entries (
                branch_id, category_id, entry_type, payment_method,
                bank_account_name, amount, description, entry_date, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const result = await env.DB.prepare(insertSql).bind(
            branchId,
            categoryId,
            entryType.toUpperCase(),
            paymentMethod.toLowerCase(),
            bankAccountName ? bankAccountName.trim() : null,
            parsedAmount,
            description ? description.trim() : "",
            entryDate,
            createdBy
        ).run();

        return successResponse({
            id: result.meta.last_row_id,
            message: "ငွေစာရင်း မှတ်တမ်းတင်ပြီးပါပြီ"
        }, 201);

    } catch (err) {
        return errorResponse(`ငွေစာရင်း ထည့်သွင်းရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ၄။ လက်ဖြင့်သွင်းထားသော စာရင်းကို ပြန်လည်ဖျက်ပစ်ခြင်း
 * DELETE /api/cashbook/entries/:id
 */
export async function handleDeleteEntry(request, env, entryId) {
    try {
        // အရောင်းဘောင်ချာ သို့မဟုတ် အကြွေးမှ အလိုအလျောက် ဝင်လာသော စာရင်းဟုတ်/မဟုတ် စစ်ဆေးခြင်း
        const entry = await env.DB.prepare(
            "SELECT id, sale_id, customer_ledger_id, purchase_id FROM cashbook_entries WHERE id = ?"
        ).bind(entryId).first();

        if (!entry) {
            return errorResponse("ဖျက်မည့် စာရင်း ရှာမတွေ့ပါ", 404);
        }

        if (entry.sale_id || entry.customer_ledger_id || entry.purchase_id) {
            return errorResponse("အရောင်းဘောင်ချာ သို့မဟုတ် အကြွေးဆပ်ငွေမှ အလိုအလျောက် ဝင်ထားသော စာရင်းကို ဤနေရာမှ တိုက်ရိုက်ဖျက်၍ မရပါ", 403);
        }

        await env.DB.prepare("DELETE FROM cashbook_entries WHERE id = ?").bind(entryId).run();
        return successResponse({ message: "ငွေစာရင်းမှတ်တမ်း ဖျက်ပြီးပါပြီ" });

    } catch (err) {
        return errorResponse(`စာရင်းဖျက်ရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ၅။ နေ့ချုပ် စာရင်း ပိတ်သိမ်းခြင်း (Daily Closing)
 * POST /api/cashbook/close-day
 */
export async function handleCloseDay(request, env) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.branchId || body.actualCashCounted === undefined) {
            return errorResponse("ဆိုင်ခွဲ (branchId) နှင့် လက်တွေ့ရေတွက်ရရှိငွေ (actualCashCounted) လိုအပ်ပါသည်", 400);
        }

        const {
            branchId,
            closingDate = new Date().toISOString().split("T")[0],
            actualCashCounted = 0,
            closedBy = 1,
            notes = ""
        } = body;

        // ထိုနေ့၏ Cash/Bank အဝင်အထွက် တွက်ချက်ခြင်း
        const summarySql = `
            SELECT 
                COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'INCOME' THEN amount ELSE 0 END), 0) AS total_cash_in,
                COALESCE(SUM(CASE WHEN payment_method = 'cash' AND entry_type = 'EXPENSE' THEN amount ELSE 0 END), 0) AS total_cash_out,
                COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'INCOME' THEN amount ELSE 0 END), 0) AS total_bank_in,
                COALESCE(SUM(CASE WHEN payment_method = 'bank' AND entry_type = 'EXPENSE' THEN amount ELSE 0 END), 0) AS total_bank_out
            FROM cashbook_entries
            WHERE branch_id = ? AND entry_date = ?
        `;

        const stats = await env.DB.prepare(summarySql).bind(branchId, closingDate).first();

        const expectedCash = (stats.total_cash_in || 0) - (stats.total_cash_out || 0);
        const expectedBank = (stats.total_bank_in || 0) - (stats.total_bank_out || 0);
        const cashDifference = parseFloat(actualCashCounted) - expectedCash;

        const insertClosingSql = `
            INSERT INTO daily_closings (
                branch_id, closing_date,
                total_cash_in, total_cash_out, closing_cash,
                total_bank_in, total_bank_out, closing_bank,
                actual_cash_counted, cash_difference, closed_by, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(branch_id, closing_date) DO UPDATE SET
                total_cash_in = excluded.total_cash_in,
                total_cash_out = excluded.total_cash_out,
                closing_cash = excluded.closing_cash,
                total_bank_in = excluded.total_bank_in,
                total_bank_out = excluded.total_bank_out,
                closing_bank = excluded.closing_bank,
                actual_cash_counted = excluded.actual_cash_counted,
                cash_difference = excluded.cash_difference,
                closed_by = excluded.closed_by,
                notes = excluded.notes,
                created_at = CURRENT_TIMESTAMP
        `;

        await env.DB.prepare(insertClosingSql).bind(
            branchId,
            closingDate,
            stats.total_cash_in,
            stats.total_cash_out,
            expectedCash,
            stats.total_bank_in,
            stats.total_bank_out,
            expectedBank,
            parseFloat(actualCashCounted),
            cashDifference,
            closedBy,
            notes
        ).run();

        return successResponse({
            message: "နေ့ချုပ်စာရင်း အောင်မြင်စွာ ပိတ်သိမ်းပြီးပါပြီ",
            closing: {
                date: closingDate,
                expectedCash,
                actualCash: parseFloat(actualCashCounted),
                difference: cashDifference,
                expectedBank
            }
        });

    } catch (err) {
        return errorResponse(`နေ့ချုပ်စာရင်း ပိတ်ရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}
