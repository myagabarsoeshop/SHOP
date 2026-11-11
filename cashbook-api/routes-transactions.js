// =============================================================================
// FILE 3 OF 5: cashbook-api/routes-transactions.js
// PURCHASES (STOCK-IN + OWN PRODUCTION) & POS SALES
// Version: 4.0.0 (Server-Side Paginated, Collision-Proof VR, Race-Condition Safe)
// =============================================================================

import {
    jsonResponse,
    errorResponse,
    getMyanmarTodayDate,
    getMyanmarDayUtcBounds,
    getMyanmarYearUtcBounds,
    roundKyat,
    roundQty,
    getQueryYear,
    resolveBranchId,
    logAudit,
    generateUniqueInvoice // [NEW] Added for 100% Collision-Proof Invoice/VR Nos
} from "./utils.js";

export async function handleTransactionRoutes(request, env, url, path, method, auth) {
    const currentUserId = auth.uid;
    const currentUserRole = auth.role;
    const userBranchId = auth.branch_id;
    const isAdminOrFinance = ["admin", "finance", "manager"].includes(currentUserRole);

    // =========================================================================
    // 1. PURCHASES & STOCK IN (SUPPORTS EXTERNAL PURCHASE & OWN PRODUCTION)
    // =========================================================================
    if (path === "/api/purchases" && method === "GET") {
        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"));
        const targetYear = getQueryYear(url);
        const { startUtc: yearStartUtc, endUtc: yearEndUtc } = getMyanmarYearUtcBounds(targetYear);

        // [NEW] Server-Side Pagination
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const limit = Math.max(1, Number(url.searchParams.get("limit")) || 2000);
        const offset = (page - 1) * limit;

        const countSql = `
            SELECT COUNT(DISTINCT p.id) AS total
            FROM purchases p
            WHERE p.branch_id = ? 
              AND p.created_at >= ? 
              AND p.created_at <= ?
              AND COALESCE(p.status, 'completed') != 'cancelled'
        `;
        const countRes = await env.DB.prepare(countSql).bind(Number(branchId), yearStartUtc, yearEndUtc).first();
        const totalItems = countRes?.total || 0;

        const sql = `
            SELECT 
                pi.id AS item_row_id,
                p.id AS purchase_id,
                p.purchase_no,
                p.purchase_no AS vr_no,
                p.ref_no,
                p.supplier_id,
                p.supplier_name,
                COALESCE(p.purchase_date, date(p.created_at, '+390 minutes')) AS purchase_date,
                COALESCE(p.items_total, p.total_amount, 0) AS items_total,
                p.total_amount,
                COALESCE(p.paid_amount, p.total_amount, 0) AS paid_amount,
                COALESCE(p.diff_amount, 0) AS diff_amount,
                CASE 
                    WHEN p.notes = 'OWN_PRODUCTION' OR p.payment_method = 'production' THEN 'production'
                    ELSE p.payment_method 
                END AS payment_method,
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
              AND p.created_at >= ? 
              AND p.created_at <= ?
              AND COALESCE(p.status, 'completed') != 'cancelled'
            ORDER BY p.id DESC, pi.id DESC LIMIT ? OFFSET ?
        `;
        const { results } = await env.DB.prepare(sql).bind(Number(branchId), yearStartUtc, yearEndUtc, limit, offset).all();
        
        return jsonResponse({
            items: results || [],
            total: totalItems,
            page,
            limit
        });
    }

    if (path === "/api/purchases" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const targetBranch = resolveBranchId(auth, body.branch_id);
        const rawMethod = String(body.payment_method || "cash").toLowerCase();
        const validMethod = ["cash", "bank", "credit", "production"].includes(rawMethod) ? rawMethod : "cash";
        const isOwnProduction = validMethod === "production";

        let supplierName = String(body.supplier_name || "").trim();
        if (isOwnProduction && !supplierName) {
            supplierName = "ကိုယ်ပိုင်ရက်ကန်း / ထုတ်လုပ်မှု";
        }

        const itemsList = Array.isArray(body.items) ? body.items : [];
        if (!supplierName || itemsList.length === 0) {
            return errorResponse("ပေးသွင်းသူ (ပွဲရုံ) အမည်နှင့် ဝယ်ယူသည့်ပစ္စည်းများ လိုအပ်ပါသည်", 400);
        }

        let itemsTotal = 0;
        const validatedItems = [];

        for (const it of itemsList) {
            const q = roundQty(it.quantity);
            const c = roundKyat(it.unit_cost);
            const rPrice = roundKyat(it.retail_price);
            const wPrice = roundKyat(it.wholesale_price);

            if (q <= 0 || c < 0 || rPrice < 0 || wPrice < 0) {
                return errorResponse("ပစ္စည်းအရေအတွက်နှင့် ဈေးနှုန်းများ မှန်ကန်စွာ ထည့်သွင်းပေးပါ", 400);
            }

            if (it.is_new && it.new_product) {
                if (!it.new_product.category || !it.new_product.item_name) {
                    return errorResponse("ပစ္စည်းအသစ်အတွက် အမျိုးအစားနှင့် အမည် လိုအပ်ပါသည်", 400);
                }
            } else if (!Number(it.product_id)) {
                return errorResponse("ပစ္စည်း ID မမှန်ကန်ပါ", 400);
            }

            const lineSub = roundKyat(q * c);
            itemsTotal += lineSub;

            validatedItems.push({
                product_id: Number(it.product_id || 0),
                is_new: Boolean(it.is_new && it.new_product),
                new_product: it.new_product || null,
                quantity: q,
                unit_cost: c,
                retail_price: rPrice,
                wholesale_price: wPrice,
                subtotal: lineSub
            });
        }

        const purDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.purchase_date || body.date || "").trim())
            ? String(body.purchase_date || body.date).trim()
            : getMyanmarTodayDate();
        
        // [NEW] 100% Collision-Proof VR No Generator
        const purchaseNo = generateUniqueInvoice("PUR", targetBranch);
        const refNo = body.ref_no && String(body.ref_no).trim() !== "" ? String(body.ref_no).trim() : null;

        let paidAmount = 0;
        let diffAmount = 0;
        let dbPaymentMethod = "cash";
        let notesTag = null;

        if (isOwnProduction) {
            paidAmount = 0;
            diffAmount = 0;
            dbPaymentMethod = "production"; 
            notesTag = "OWN_PRODUCTION";
        } else if (validMethod === "credit") {
            paidAmount = 0;
            diffAmount = -itemsTotal;
            dbPaymentMethod = "credit";
        } else {
            if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== "") {
                paidAmount = Math.max(0, roundKyat(body.paid_amount));
            } else {
                paidAmount = itemsTotal;
            }
            diffAmount = paidAmount - itemsTotal;
            dbPaymentMethod = paidAmount === 0 ? "credit" : validMethod;
        }

        let supplierId = null;
        let payableToAdd = 0;

        if (!isOwnProduction) {
            const supplierRecord = await env.DB.prepare(
                "SELECT id, current_payable FROM customers WHERE (name = ? OR shop_name = ?) AND is_active = 1 LIMIT 1"
            ).bind(supplierName, supplierName).first();

            supplierId = supplierRecord?.id || null;
            payableToAdd = diffAmount < 0 ? Math.abs(diffAmount) : (dbPaymentMethod === "credit" ? itemsTotal : 0);

            if (!supplierRecord) {
                const suppInsertRes = await env.DB.prepare(`
                    INSERT INTO customers (name, shop_name, entity_type, customer_type, current_debt, current_payable)
                    VALUES (?, ?, 'SUPPLIER', 'wholesale', 0, 0)
                `).bind(supplierName, supplierName).run();
                supplierId = suppInsertRes?.meta?.last_row_id || null;
            }
        }

        const purRes = await env.DB.prepare(`
            INSERT INTO purchases (
                purchase_no, ref_no, branch_id, supplier_id, supplier_name, purchase_date,
                items_total, total_amount, paid_amount, diff_amount, 
                payment_method, bank_account_name, notes, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
        `).bind(
            purchaseNo, refNo, targetBranch, supplierId, supplierName, purDate,
            itemsTotal, itemsTotal, paidAmount, diffAmount,
            dbPaymentMethod, isOwnProduction ? null : (body.bank_account_name || null), notesTag, currentUserId
        ).run();

        const newPurId = purRes.meta.last_row_id;
        const batchStatements = [];

        if (!isOwnProduction && payableToAdd > 0 && supplierId) {
            batchStatements.push(
                env.DB.prepare("UPDATE customers SET current_payable = current_payable + ? WHERE id = ?")
                    .bind(payableToAdd, supplierId),
                env.DB.prepare(`
                    INSERT INTO supplier_ledger (supplier_id, branch_id, purchase_id, type, amount, balance_after, payment_method, reference_note, status, created_by)
                    VALUES (?, ?, ?, 'PURCHASE_DEBT', ?, (SELECT COALESCE(current_payable, 0) FROM customers WHERE id = ?), ?, ?, 'completed', ?)
                `).bind(
                    supplierId, targetBranch, newPurId, payableToAdd, supplierId,
                    dbPaymentMethod, `အဝယ်ဘောင်ချာ ${purchaseNo}${refNo ? ` (Ref: ${refNo})` : ""}`, currentUserId
                )
            );
        }

        for (const item of validatedItems) {
            let targetProductId = item.product_id;

            if (item.is_new && item.new_product) {
                const np = item.new_product;
                const prodRes = await env.DB.prepare(`
                    INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    np.sku && String(np.sku).trim() !== "" ? String(np.sku).trim() : null,
                    null,
                    String(np.category).trim(),
                    String(np.item_name).trim(),
                    np.pattern ? String(np.pattern).trim() : null,
                    np.size ? String(np.size).trim() : "ထည်",
                    np.color ? String(np.color).trim() : null,
                    item.unit_cost, item.retail_price, item.wholesale_price
                ).run();

                targetProductId = prodRes.meta.last_row_id;
            } else {
                batchStatements.push(
                    env.DB.prepare(`
                        UPDATE products SET cost_price = ?, retail_price = ?, wholesale_price = ? WHERE id = ?
                    `).bind(item.unit_cost, item.retail_price, item.wholesale_price, Number(targetProductId))
                );
            }

            batchStatements.push(
                env.DB.prepare(`INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)`)
                    .bind(newPurId, Number(targetProductId), item.quantity, item.unit_cost, item.subtotal),
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                    quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(targetBranch, Number(targetProductId), item.quantity)
            );
        }

        if (!isOwnProduction && paidAmount > 0) {
            const cbRefNo = refNo || purchaseNo;
            batchStatements.push(
                env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, purchase_id, entry_type, 
                        payment_method, bank_account_name, amount, diff_amount, 
                        ref_no, description, entry_date, status, created_by
                    ) VALUES (?, 6, ?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
                `).bind(
                    targetBranch, newPurId, dbPaymentMethod,
                    body.bank_account_name || null, paidAmount, diffAmount,
                    cbRefNo, supplierName, purDate, currentUserId
                )
            );
        }

        try {
            if (batchStatements.length > 0) await env.DB.batch(batchStatements);
        } catch (err) {
            await env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(newPurId).run().catch(() => {});
            throw new Error(`အဝယ်စာရင်း သိမ်းဆည်းမှု မအောင်မြင်ပါ: ${err.message}`);
        }

        return jsonResponse({
            message: isOwnProduction
                ? "ကိုယ်ပိုင်ထုတ်လုပ်မှု စတော့အဝင် မှတ်တမ်းတင်ပြီးပါပြီ (ငွေစာရင်းနှင့် အကြွေးမထိပါ)"
                : "အဝယ်စာရင်းနှင့် စတော့အဝင် အောင်မြင်ပါသည်။",
            purchaseNo
        }, 201);
    }

    // =========================================================================
    // 2. POS CHECKOUT, SPLIT PAYMENT & VOID/REFUND SALES (SECURITY HARDENED)
    // =========================================================================
    if (path === "/api/pos/sales" && method === "GET") {
        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"));
        const date = url.searchParams.get("date") || getMyanmarTodayDate();
        const { startUtc, endUtc } = getMyanmarDayUtcBounds(date);

        // [NEW] Server-Side Pagination for POS Sales History
        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const limit = Math.max(1, Number(url.searchParams.get("limit")) || 2000);
        const offset = (page - 1) * limit;

        const countSql = `
            SELECT COUNT(DISTINCT s.id) AS total
            FROM sales s
            WHERE s.branch_id = ? 
              AND s.created_at >= ? 
              AND s.created_at <= ? 
              AND s.status = 'completed'
        `;
        const countRes = await env.DB.prepare(countSql).bind(Number(branchId), startUtc, endUtc).first();
        const totalItems = countRes?.total || 0;

        const sql = `
            SELECT 
                s.id AS sale_id,
                s.invoice_no,
                s.sale_type,
                s.payment_method,
                s.cash_amount,
                s.bank_amount,
                s.bank_account_name,
                s.total_amount,
                s.discount_amount,
                s.final_amount,
                s.paid_amount,
                s.debt_amount,
                s.created_at,
                COALESCE(c.name, 'Walk-in') AS customer_name,
                si.id AS item_row_id,
                si.product_id,
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
            WHERE s.branch_id = ? 
              AND s.created_at >= ? 
              AND s.created_at <= ? 
              AND s.status = 'completed'
            ORDER BY s.id DESC, si.id ASC LIMIT ? OFFSET ?
        `;
        const { results } = await env.DB.prepare(sql).bind(Number(branchId), startUtc, endUtc, limit, offset).all();
        
        return jsonResponse({
            items: results || [],
            total: totalItems,
            page,
            limit
        });
    }

    if (path === "/api/pos/sales" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branchId);
        const {
            customerId = null, saleType = "retail", items = [],
            discountAmount = 0, paidAmount = 0, paymentMethod = "cash",
            cashAmount = 0, bankAmount = 0, bankAccountName = null
        } = body;

        if (!branchId || !Array.isArray(items) || items.length === 0) {
            return errorResponse("ဆိုင်ခွဲနှင့် ပစ္စည်းစာရင်း လိုအပ်ပါသည်", 400);
        }

        const totalQtyByProd = new Map();
        for (const item of items) {
            const pid = Number(item.productId || item.product_id);
            const qty = roundQty(item.quantity);
            if (!pid || qty <= 0) return errorResponse("ပစ္စည်းအရေအတွက် မှားယွင်းနေပါသည်", 400);
            totalQtyByProd.set(pid, roundQty((totalQtyByProd.get(pid) || 0) + qty));
        }

        const verifiedItems = [];
        let calculatedTotal = 0;

        for (const item of items) {
            const pid = Number(item.productId || item.product_id);
            const qty = roundQty(item.quantity);

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

            const totalRequestedForPid = totalQtyByProd.get(pid) || qty;
            if (Number(product.current_stock) < totalRequestedForPid) {
                return errorResponse(`"${product.item_name}" လက်ကျန်စတော့ (${product.current_stock}) မလုံလောက်ပါ`, 400);
            }

            const dbRetail = roundKyat(product.retail_price || 0);
            const dbWholesale = roundKyat(product.wholesale_price || product.retail_price || 0);
            const costPrice = roundKyat(product.cost_price || 0);
            const clientPrice = roundKyat(item.unitPrice);

            let unitPrice = (item.priceType === "wholesale" || saleType === "wholesale") ? dbWholesale : dbRetail;

            if (clientPrice > 0 && (clientPrice === dbRetail || clientPrice === dbWholesale)) {
                unitPrice = clientPrice;
            } else if (clientPrice > 0 && isAdminOrFinance && clientPrice >= costPrice) {
                unitPrice = clientPrice;
            }

            const lineSubtotal = roundKyat(qty * unitPrice);
            calculatedTotal += lineSubtotal;

            verifiedItems.push({
                productId: pid,
                quantity: qty,
                unitPrice,
                costPrice,
                subtotal: lineSubtotal
            });
        }

        const discount = Math.min(calculatedTotal, Math.max(0, roundKyat(discountAmount)));
        const finalAmount = Math.max(0, calculatedTotal - discount);

        let pCash = 0;
        let pBank = 0;
        let effectivePaid = 0;

        if (paymentMethod === "split") {
            pCash = Math.max(0, roundKyat(cashAmount));
            pBank = Math.max(0, roundKyat(bankAmount));
            effectivePaid = Math.min(finalAmount, pCash + pBank);
            if (pCash + pBank > finalAmount) pCash = Math.max(0, finalAmount - pBank);
        } else {
            const rawPaid = Math.max(0, roundKyat(paidAmount));
            effectivePaid = Math.min(rawPaid, finalAmount);
            if (paymentMethod === "cash") pCash = effectivePaid;
            else if (paymentMethod === "bank") pBank = effectivePaid;
            else if (paymentMethod === "credit") {
                if (bankAccountName) pBank = effectivePaid;
                else pCash = effectivePaid;
            }
        }

        const debtAmount = Math.max(0, finalAmount - effectivePaid);

        let custName = "Walk-in";
        if (customerId) {
            const cust = await env.DB.prepare(
                "SELECT current_debt, credit_limit, name, shop_name FROM customers WHERE id = ? AND is_active = 1"
            ).bind(Number(customerId)).first();
            if (!cust) return errorResponse("ဖောက်သည် ရှာမတွေ့ပါ", 404);
            custName = cust.shop_name || cust.name;

            if (debtAmount > 0) {
                const currentDebt = roundKyat(cust.current_debt || 0);
                const limit = roundKyat(cust.credit_limit || 0);
                if (limit > 0 && (currentDebt + debtAmount) > limit) {
                    return errorResponse(`ဖောက်သည် "${cust.name}" ၏ ခွင့်ပြုအကြွေးကန့်သတ်ချက် (${limit.toLocaleString()} Ks) ထက် ကျော်လွန်နေပါသည် (လက်ရှိအကြွေး: ${currentDebt.toLocaleString()} Ks)`, 400);
                }
            }
        } else if (debtAmount > 0) {
            return errorResponse("အကြွေးကျန်ငွေ ရှိနေပါသဖြင့် ဖောက်သည် ရွေးချယ်ပေးပါ", 400);
        }

        // [NEW] 100% Collision-Free POS Invoice No
        const invoiceNo = generateUniqueInvoice("INV", branchId);
        const todayDate = getMyanmarTodayDate();

        const saleIdSubquery = `(SELECT id FROM sales WHERE invoice_no = ?)`;
        const batchStatements = [
            env.DB.prepare(`
                INSERT INTO sales (
                    invoice_no, branch_id, customer_id, sale_type,
                    total_amount, discount_amount, final_amount, paid_amount, debt_amount,
                    payment_method, cash_amount, bank_amount, bank_account_name, status, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP)
            `).bind(
                invoiceNo, Number(branchId), customerId ? Number(customerId) : null, saleType,
                calculatedTotal, discount, finalAmount, effectivePaid, debtAmount,
                paymentMethod, pCash, pBank, bankAccountName || null, currentUserId
            )
        ];

        for (const item of verifiedItems) {
            batchStatements.push(
                env.DB.prepare(`
                    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, subtotal)
                    VALUES (${saleIdSubquery}, ?, ?, ?, ?, ?)
                `).bind(invoiceNo, item.productId, item.quantity, item.unitPrice, item.costPrice, item.subtotal),
                // [FIXED] Atomic Stock Update to prevent negative sales
                env.DB.prepare(`
                    UPDATE branch_inventory
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE branch_id = ? AND product_id = ? AND quantity >= ?
                `).bind(item.quantity, Number(branchId), item.productId, item.quantity)
            );
        }

        if (effectivePaid > 0) {
            if (pCash > 0) {
                batchStatements.push(
                    env.DB.prepare(`
                        INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, amount, ref_no, description, entry_date, status, created_by)
                        VALUES (?, 1, ${saleIdSubquery}, 'INCOME', 'cash', ?, ?, ?, ?, 'completed', ?)
                    `).bind(Number(branchId), invoiceNo, pCash, invoiceNo, `${custName} (အရောင်း - ငွေသား)`, todayDate, currentUserId)
                );
            }
            if (pBank > 0) {
                batchStatements.push(
                    env.DB.prepare(`
                        INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, bank_account_name, amount, ref_no, description, entry_date, status, created_by)
                        VALUES (?, 1, ${saleIdSubquery}, 'INCOME', 'bank', ?, ?, ?, ?, ?, 'completed', ?)
                    `).bind(Number(branchId), invoiceNo, bankAccountName || "KPay/Bank", pBank, invoiceNo, `${custName} (အရောင်း - ${bankAccountName || "Bank"})`, todayDate, currentUserId)
                );
            }
        }

        if (debtAmount > 0 && customerId) {
            batchStatements.push(
                env.DB.prepare("UPDATE customers SET current_debt = current_debt + ? WHERE id = ?")
                    .bind(debtAmount, Number(customerId)),
                env.DB.prepare(`
                    INSERT INTO customer_ledger (customer_id, branch_id, sale_id, type, amount, balance_after, payment_method, reference_note, status, created_by)
                    VALUES (?, ?, ${saleIdSubquery}, 'DEBIT', ?, (SELECT COALESCE(current_debt, 0) FROM customers WHERE id = ?), 'credit', ?, 'completed', ?)
                `).bind(Number(customerId), Number(branchId), invoiceNo, debtAmount, Number(customerId), `ဘောင်ချာ ${invoiceNo} အကြွေးကျန်`, currentUserId)
            );
        }

        try {
            const batchResults = await env.DB.batch(batchStatements);
            const saleId = batchResults[0]?.meta?.last_row_id || null;
            return jsonResponse({ message: "အရောင်းဘောင်ချာ အောင်မြင်ပါသည်", invoiceNo, saleId, finalAmount }, 201);
        } catch (err) {
            // Rollback is automatic in D1 batch if any statement fails (e.g. CHECK constraint fails for negative stock)
            if (err.message.includes("CHECK constraint")) {
                return errorResponse("တောင်းဆိုသော အရေအတွက်အတိုင်း စတော့လက်ကျန် မလုံလောက်ပါ။ ပစ္စည်းတစ်မျိုးမျိုးသည် ရောင်းထွက်သွားပြီ ဖြစ်နိုင်ပါသည်။", 400);
            }
            throw err;
        }
    }

    // POS SALE VOID / CANCEL (SOFT-DELETE WITH FULL ATOMIC REVERSAL & AUDIT LOG)
    if ((path.startsWith("/api/pos/sales/") || path.startsWith("/api/sales/")) && method === "DELETE") {
        const saleId = Number(path.split("/").pop());
        if (!saleId) return errorResponse("ဘောင်ချာ ID မမှန်ကန်ပါ", 400);

        const sale = await env.DB.prepare(
            "SELECT id, invoice_no, branch_id, customer_id, final_amount, debt_amount, status FROM sales WHERE id = ?"
        ).bind(saleId).first();
        
        if (!sale) return errorResponse("အရောင်းဘောင်ချာ ရှာမတွေ့ပါ", 404);
        if (sale.status === "cancelled") return errorResponse("ဤဘောင်ချာသည် ပယ်ဖျက်ထားပြီး ဖြစ်ပါသည်", 400);

        if (!isAdminOrFinance && Number(sale.branch_id) !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ ဘောင်ချာအား ပယ်ဖျက်ခွင့် မရှိပါ", 403);
        }

        const { results: saleItems } = await env.DB.prepare("SELECT product_id, quantity FROM sale_items WHERE sale_id = ?").bind(saleId).all();
        const batchRollback = [];

        for (const item of (saleItems || [])) {
            batchRollback.push(
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(Number(sale.branch_id), Number(item.product_id), roundQty(item.quantity))
            );
        }

        if (Number(sale.debt_amount) > 0 && sale.customer_id) {
            batchRollback.push(
                env.DB.prepare("UPDATE customers SET current_debt = MAX(0, COALESCE(current_debt, 0) - ?) WHERE id = ?")
                    .bind(roundKyat(sale.debt_amount), Number(sale.customer_id)),
                env.DB.prepare("UPDATE customer_ledger SET status = 'cancelled' WHERE sale_id = ?").bind(saleId)
            );
        }

        batchRollback.push(
            env.DB.prepare("UPDATE cashbook_entries SET status = 'cancelled' WHERE sale_id = ?").bind(saleId),
            env.DB.prepare(`
                UPDATE sales SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = 'Voided by user' WHERE id = ?
            `).bind(currentUserId, saleId)
        );

        await env.DB.batch(batchRollback);

        await logAudit(env.DB, {
            branchId: sale.branch_id,
            userId: currentUserId,
            action: "VOID_SALE",
            tableName: "sales",
            recordId: saleId,
            details: { invoice_no: sale.invoice_no, final_amount: sale.final_amount, debt_amount: sale.debt_amount }
        });

        return jsonResponse({ message: "အရောင်းဘောင်ချာ ပယ်ဖျက်ပြီး စတော့၊ ငွေစာရင်းနှင့် အကြွေးစာရင်းများ ပြန်ညှိပြီးပါပြီ" });
    }

    return null;
}
