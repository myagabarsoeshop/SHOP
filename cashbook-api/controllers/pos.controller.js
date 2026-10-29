// cashbook-api/controllers/pos.controller.js
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * ၁။ အရောင်းဘောင်ချာ အသစ်ဖွင့်ခြင်း (POS Checkout Engine)
 * POST /api/pos/sales
 */
export async function handleCreateSale(request, env) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.branchId || !body.items || !Array.isArray(body.items) || body.items.length === 0) {
            return errorResponse("ဆိုင်ခွဲ (branchId) နှင့် အထည်ပစ္စည်းစာရင်း (items) မဖြစ်မနေ လိုအပ်ပါသည်", 400);
        }

        const {
            branchId,
            customerId = null,
            saleType = "retail",            // 'retail' သို့မဟုတ် 'wholesale'
            items,                          // [{ productId, quantity, unitPrice, costPrice }]
            discountAmount = 0.0,
            paidAmount = 0.0,
            paymentMethod = "cash",         // 'cash', 'bank', 'credit', 'split'
            cashAmount = 0.0,
            bankAmount = 0.0,
            bankAccountName = null,
            createdBy = 1
        } = body;

        // ၁။ စုစုပေါင်းသင့်ငွေ (Total Amount) ကို Backend မှ ပြန်လည်စစ်ဆေးတွက်ချက်ခြင်း
        let calculatedTotal = 0;
        for (const item of items) {
            const qty = parseInt(item.quantity) || 0;
            const price = parseFloat(item.unitPrice) || 0;
            if (qty <= 0) return errorResponse("ပစ္စည်းအရေအတွက်သည် သုညထက် ကြီးရပါမည်", 400);
            calculatedTotal += (qty * price);
        }

        const discount = parseFloat(discountAmount) || 0;
        const finalAmount = Math.max(0, calculatedTotal - discount);
        const paid = parseFloat(paidAmount) || 0;
        const debtAmount = Math.max(0, finalAmount - paid);

        // အကြွေးကျန်ရှိသော်လည်း ဖောက်သည် (Customer) မရွေးချယ်ထားပါက တားမြစ်ခြင်း
        if (debtAmount > 0 && !customerId) {
            return errorResponse("အကြွေးကျန်ရှိပါက ဖောက်သည် (Customer Profile) ကို မဖြစ်မနေ ရွေးချယ်ပေးရပါမည်", 400);
        }

        // ၂။ ဘောင်ချာနံပါတ် အလိုအလျောက် သတ်မှတ်ခြင်း (ဥပမာ - INV-SH1-20261029-0001)
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const branchCodeResult = await env.DB.prepare("SELECT code FROM branches WHERE id = ?").bind(branchId).first();
        const branchCode = branchCodeResult ? branchCodeResult.code : `B${branchId}`;

        const countToday = await env.DB.prepare(
            "SELECT COUNT(id) AS count FROM sales WHERE branch_id = ? AND date(created_at) = date('now')"
        ).bind(branchId).first();

        const seq = String((countToday?.count || 0) + 1).padStart(4, "0");
        const invoiceNo = `INV-${branchCode}-${dateStr}-${seq}`;

        // ၃။ D1 Batch Operations (Atomic Transaction) ပြုလုပ်ရန် Statement များ စုစည်းခြင်း
        const statements = [];

        // (က) sales table ထဲ ဘောင်ချာ Header သွင်းခြင်း
        const insertSaleSql = `
            INSERT INTO sales (
                invoice_no, branch_id, customer_id, sale_type,
                total_amount, discount_amount, final_amount, paid_amount, debt_amount,
                payment_method, cash_amount, bank_amount, bank_account_name, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        statements.push(env.DB.prepare(insertSaleSql).bind(
            invoiceNo,
            branchId,
            customerId,
            saleType,
            calculatedTotal,
            discount,
            finalAmount,
            paid,
            debtAmount,
            paymentMethod,
            parseFloat(cashAmount) || 0,
            parseFloat(bankAmount) || 0,
            bankAccountName ? bankAccountName.trim() : null,
            createdBy
        ));

        // (ခ) batch execute လုပ်ပြီးမှ ရရှိလာသော sale_id ဖြင့် ကျန်တာဆက်လုပ်ရမည် ဖြစ်သောကြောင့်
        // ပထမဆုံး အရောင်း Header ကို အရင်သွင်းယူပါမည်
        const saleInsertResult = await env.DB.prepare(insertSaleSql).bind(
            invoiceNo, branchId, customerId, saleType,
            calculatedTotal, discount, finalAmount, paid, debtAmount,
            paymentMethod, parseFloat(cashAmount) || 0, parseFloat(bankAmount) || 0,
            bankAccountName ? bankAccountName.trim() : null, createdBy
        ).run();

        const saleId = saleInsertResult.meta.last_row_id;
        const subStatements = [];

        // (ဂ) sale_items သွင်းခြင်း နှင့် branch_inventory မှ အထည်အရေအတွက် အလိုအလျောက် နှုတ်ခြင်း
        for (const item of items) {
            const qty = parseInt(item.quantity);
            const unitPrice = parseFloat(item.unitPrice);
            const costPrice = parseFloat(item.costPrice) || 0;
            const subtotal = qty * unitPrice;

            // sale_items ထဲ သွင်းခြင်း
            subStatements.push(env.DB.prepare(`
                INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(saleId, item.productId, qty, unitPrice, costPrice, subtotal));

            // သက်ဆိုင်ရာ ဆိုင်ခွဲ၏ လက်ကျန်မှ နှုတ်ခြင်း (မရှိသေးပါက အနှုတ်ပြသွားမည်)
            subStatements.push(env.DB.prepare(`
                INSERT INTO branch_inventory (branch_id, product_id, quantity)
                VALUES (?, ?, -?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = quantity - excluded.quantity
            `).bind(branchId, item.productId, qty));
        }

        // (ဃ) Cashbook သို့ Auto-Entry ငွေစာရင်း ထည့်သွင်းပေးခြင်း
        // အကယ်၍ ချက်ချင်း ပေးချေငွေ (paid > 0) ရှိပါက
        if (paid > 0) {
            // Cash ဖြင့် ပေးချေငွေ ရှိပါက
            const paidCash = parseFloat(cashAmount) > 0 ? parseFloat(cashAmount) : (paymentMethod === "cash" ? paid : 0);
            if (paidCash > 0) {
                subStatements.push(env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, sale_id, entry_type, payment_method, amount, description, created_by
                    ) VALUES (?, 1, ?, 'INCOME', 'cash', ?, ?, ?)
                `).bind(branchId, saleId, paidCash, `အရောင်းဘောင်ချာ ${invoiceNo} (ငွေသား)`, createdBy));
            }

            // Bank ဖြင့် ပေးချေငွေ ရှိပါက
            const paidBank = parseFloat(bankAmount) > 0 ? parseFloat(bankAmount) : (paymentMethod === "bank" ? paid : 0);
            if (paidBank > 0) {
                subStatements.push(env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, sale_id, entry_type, payment_method, bank_account_name, amount, description, created_by
                    ) VALUES (?, 1, ?, 'INCOME', 'bank', ?, ?, ?, ?)
                `).bind(branchId, saleId, bankAccountName, paidBank, `အရောင်းဘောင်ချာ ${invoiceNo} (${bankAccountName || 'Bank'})`, createdBy));
            }
        }

        // (င) အကြွေးကျန်ရှိပါက ဖောက်သည်၏ စာရင်း (customer_ledger & current_debt) သို့ အလိုအလျောက် စာရင်းသွင်းခြင်း
        if (debtAmount > 0 && customerId) {
            // Customer လက်ရှိအကြွေး စုစုပေါင်းကို အရင်ယူခြင်း
            const cust = await env.DB.prepare("SELECT current_debt FROM customers WHERE id = ?").bind(customerId).first();
            const newTotalDebt = (cust?.current_debt || 0) + debtAmount;

            subStatements.push(env.DB.prepare(`
                INSERT INTO customer_ledger (
                    customer_id, branch_id, sale_id, type, amount, balance_after, reference_note, created_by
                ) VALUES (?, ?, ?, 'DEBIT', ?, ?, ?, ?)
            `).bind(customerId, branchId, saleId, debtAmount, newTotalDebt, `ဘောင်ချာ ${invoiceNo} မှ အကြွေးကျန်`, createdBy));

            subStatements.push(env.DB.prepare(`
                UPDATE customers SET current_debt = ? WHERE id = ?
            `).bind(newTotalDebt, customerId));
        }

        // ကျန်ရှိသော Query အားလုံးကို D1 batch ဖြင့် တစ်ပြိုင်နက် execute လုပ်ခြင်း
        await env.DB.batch(subStatements);

        return successResponse({
            message: "အရောင်းဘောင်ချာ အောင်မြင်စွာ ဖွင့်ပြီးပါပြီ",
            invoiceNo,
            saleId,
            finalAmount,
            paidAmount: paid,
            debtAmount
        }, 201);

    } catch (err) {
        return errorResponse(`အရောင်းဘောင်ချာ ဖွင့်ရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ၂။ အရောင်းဘောင်ချာများ စာရင်းနှင့် ရှာဖွေခြင်း
 * GET /api/pos/sales?branch_id=1&date=2026-10-29
 */
export async function handleGetSales(request, env) {
    try {
        const url = new URL(request.url);
        const branchId = url.searchParams.get("branch_id");
        const date = url.searchParams.get("date") || new Date().toISOString().split("T")[0];
        const search = url.searchParams.get("search")?.trim() || "";

        let query = `
            SELECT 
                s.id,
                s.invoice_no,
                s.branch_id,
                b.name AS branch_name,
                s.customer_id,
                c.name AS customer_name,
                c.phone AS customer_phone,
                s.sale_type,
                s.total_amount,
                s.discount_amount,
                s.final_amount,
                s.paid_amount,
                s.debt_amount,
                s.payment_method,
                s.status,
                u.full_name AS cashier_name,
                s.created_at
            FROM sales s
            JOIN branches b ON s.branch_id = b.id
            LEFT JOIN customers c ON s.customer_id = c.id
            JOIN users u ON s.created_by = u.id
            WHERE date(s.created_at) = ?
        `;

        const bindings = [date];

        if (branchId) {
            query += " AND s.branch_id = ?";
            bindings.push(branchId);
        }

        if (search) {
            query += " AND (s.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)";
            bindings.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += " ORDER BY s.id DESC LIMIT 100";

        const { results } = await env.DB.prepare(query).bind(...bindings).all();
        return successResponse(results || []);
    } catch (err) {
        return errorResponse(`အရောင်းစာရင်းများ ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ၃။ ဘောင်ချာတစ်ခုချင်းစီ၏ အသေးစိတ် ပစ္စည်းစာရင်း ရယူခြင်း (Voucher Print အတွက်)
 * GET /api/pos/sales/:id
 */
export async function handleGetSaleDetails(request, env, saleId) {
    try {
        const saleSql = `
            SELECT 
                s.*,
                b.name AS branch_name, b.phone AS branch_phone, b.address AS branch_address,
                c.name AS customer_name, c.phone AS customer_phone,
                u.full_name AS cashier_name
            FROM sales s
            JOIN branches b ON s.branch_id = b.id
            LEFT JOIN customers c ON s.customer_id = c.id
            JOIN users u ON s.created_by = u.id
            WHERE s.id = ?
        `;
        const sale = await env.DB.prepare(saleSql).bind(saleId).first();

        if (!sale) return errorResponse("ဘောင်ချာ ရှာမတွေ့ပါ", 404);

        const itemsSql = `
            SELECT 
                si.id,
                si.product_id,
                p.category,
                p.item_name,
                p.pattern,
                p.size,
                p.color,
                (p.item_name || ' ' || p.category) AS display_name,
                si.quantity,
                si.unit_price,
                si.subtotal
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = ?
        `;
        const { results: items } = await env.DB.prepare(itemsSql).bind(saleId).all();

        return successResponse({
            sale,
            items: items || []
        });
    } catch (err) {
        return errorResponse(`ဘောင်ချာ အသေးစိတ် ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}
