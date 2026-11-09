// =============================================================================
// FILE 3 OF 5: cashbook-api/routes-transactions.js
// PURCHASES (STOCK-IN + SUPPLIER PAYABLE SYNC) & POS SALES (SECURITY HARDENED)
// Version: 3.1.0 (Server-Side Price Validation & 100% Atomic Single-Batch POS)
// =============================================================================

import {
    jsonResponse,
    errorResponse,
    getMyanmarTodayDate,
    roundKyat,
    roundQty
} from "./utils.js";

export async function handleTransactionRoutes(request, env, url, path, method, auth) {
    const currentUserId = auth.uid;
    const currentUserRole = auth.role;
    const userBranchId = auth.branch_id;

    // =========================================================================
    // 1. PURCHASES & STOCK IN (AUTO SUPPLIER REGISTRATION & PAYABLES SYNC)
    // =========================================================================
    if (path === "/api/purchases" && method === "GET") {
        const branchId = url.searchParams.get("branch_id") || userBranchId;

        const sql = `
            SELECT 
                pi.id AS item_row_id,
                p.id AS purchase_id,
                p.purchase_no,
                p.purchase_no AS vr_no,
                p.ref_no,
                p.supplier_id,
                p.supplier_name,
                COALESCE(p.purchase_date, date(p.created_at)) AS purchase_date,
                COALESCE(p.items_total, p.total_amount, 0) AS items_total,
                p.total_amount,
                COALESCE(p.paid_amount, p.total_amount, 0) AS paid_amount,
                COALESCE(p.diff_amount, 0) AS diff_amount,
                p.payment_method,
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
            ORDER BY p.id DESC, pi.id DESC LIMIT 300
        `;
        const { results } = await env.DB.prepare(sql).bind(Number(branchId)).all();
        return jsonResponse(results || []);
    }

    if (path === "/api/purchases" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const targetBranch = currentUserRole === "cashier" ? userBranchId : Number(body.branch_id || userBranchId);
        const supplierName = String(body.supplier_name || "").trim();
        const itemsList = Array.isArray(body.items) ? body.items : [];

        if (!supplierName || itemsList.length === 0) {
            return errorResponse("ပေးသွင်းသူ (ပွဲရုံ) အမည်နှင့် ဝယ်ယူသည့်ပစ္စည်းများ လိုအပ်ပါသည်", 400);
        }

        // ၁။ အဝယ်ရက်စွဲ နှင့် VR NO အား DDMMYY-01 ပုံစံဖြင့် Auto Sequence ထုတ်ယူခြင်း
        const purDate = body.purchase_date || body.date || getMyanmarTodayDate();
        const [yyyy, mth, day] = purDate.split("-");
        const prefix = `${day}${mth}${yyyy.slice(-2)}`;

        const lastPo = await env.DB.prepare(
            "SELECT purchase_no FROM purchases WHERE purchase_no LIKE ? AND branch_id = ? ORDER BY id DESC LIMIT 1"
        ).bind(`${prefix}-%`, targetBranch).first();

        let nextSeq = "01";
        if (lastPo && lastPo.purchase_no) {
            const parts = lastPo.purchase_no.split("-");
            const lastNum = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(lastNum)) {
                nextSeq = String(lastNum + 1).padStart(2, "0");
            }
        }
        const purchaseNo = `${prefix}-${nextSeq}`;
        const refNo = body.ref_no && String(body.ref_no).trim() !== "" ? String(body.ref_no).trim() : null;

        // ၂။ ပစ္စည်းပေါင်းလဒ်၊ အမှန်ပေးငွေ နှင့် ကွာခြားချက် (Surplus / Deficit) တွက်ချက်ခြင်း
        const itemsTotal = roundKyat(
            itemsList.reduce((acc, it) => acc + (parseFloat(it.subtotal) || (roundQty(it.quantity) * roundKyat(it.unit_cost))), 0)
        );

        const rawMethod = String(body.payment_method || "cash").toLowerCase();
        let paidAmount = 0;
        if (rawMethod === "credit") {
            paidAmount = 0;
        } else if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== "") {
            paidAmount = roundKyat(body.paid_amount);
        } else {
            paidAmount = roundKyat(body.total_amount ?? itemsTotal);
        }

        const diffAmount = body.diff_amount !== undefined && body.diff_amount !== null && body.diff_amount !== ""
            ? roundKyat(body.diff_amount)
            : (paidAmount - itemsTotal);

        const finalPaymentMethod = paidAmount === 0 ? "credit" : rawMethod;

        // ၃။ ပွဲရုံအမည်အား customers ဇယားတွင် စစ်ဆေးပြီး မရှိပါက Auto-Register ပြုလုပ်ပေးခြင်း
        let supplierRecord = await env.DB.prepare(
            "SELECT id, current_payable FROM customers WHERE (name = ? OR shop_name = ?) AND is_active = 1 LIMIT 1"
        ).bind(supplierName, supplierName).first();

        let supplierId = supplierRecord?.id || null;
        const payableToAdd = diffAmount < 0 ? Math.abs(diffAmount) : (finalPaymentMethod === "credit" ? itemsTotal : 0);

        if (!supplierRecord) {
            const suppInsertRes = await env.DB.prepare(`
                INSERT INTO customers (name, shop_name, entity_type, customer_type, current_debt, current_payable)
                VALUES (?, ?, 'SUPPLIER', 'wholesale', 0, 0)
            `).bind(supplierName, supplierName).run().catch(() => null);
            supplierId = suppInsertRes?.meta?.last_row_id || null;
        }

        // ၄။ purchases ဇယားထဲသို့ မှတ်တမ်းတင်ခြင်း
        const purRes = await env.DB.prepare(`
            INSERT INTO purchases (
                purchase_no, ref_no, branch_id, supplier_id, supplier_name, purchase_date,
                items_total, total_amount, paid_amount, diff_amount, 
                payment_method, bank_account_name, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            purchaseNo, refNo, targetBranch, supplierId, supplierName, purDate,
            itemsTotal, itemsTotal, paidAmount, diffAmount,
            finalPaymentMethod, body.bank_account_name || null, currentUserId
        ).run();

        const newPurId = purRes.meta.last_row_id;
        const batchStatements = [];

        // ၅။ ပေးရန်ကျန်ငွေရှိပါက customers.current_payable နှင့် supplier_ledger သို့ တစ်ပြိုင်နက် စာရင်းသွင်းခြင်း
        if (payableToAdd > 0 && supplierId) {
            batchStatements.push(
                env.DB.prepare("UPDATE customers SET current_payable = COALESCE(current_payable, 0) + ? WHERE id = ?")
                    .bind(payableToAdd, supplierId),
                env.DB.prepare(`
                    INSERT INTO supplier_ledger (supplier_id, branch_id, purchase_id, type, amount, balance_after, payment_method, reference_note, created_by)
                    VALUES (?, ?, ?, 'PURCHASE_DEBT', ?, (SELECT COALESCE(current_payable, 0) FROM customers WHERE id = ?), ?, ?, ?)
                `).bind(
                    supplierId, targetBranch, newPurId, payableToAdd, supplierId,
                    finalPaymentMethod, `အဝယ်ဘောင်ချာ ${purchaseNo}${refNo ? ` (Ref: ${refNo})` : ""}`, currentUserId
                )
            );
        }

        // ၆။ ပစ္စည်းများနှင့် စတော့ အဝင်မှတ်တမ်းတင်ခြင်း
        for (const item of itemsList) {
            let targetProductId = item.product_id;
            const q = roundQty(item.quantity);
            const c = roundKyat(item.unit_cost);
            const rPrice = roundKyat(item.retail_price);
            const wPrice = roundKyat(item.wholesale_price);
            const sub = roundKyat(q * c);

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
                    c, rPrice, wPrice
                ).run();

                targetProductId = prodRes.meta.last_row_id;
            } else {
                batchStatements.push(
                    env.DB.prepare(`
                        UPDATE products SET cost_price = ?, retail_price = ?, wholesale_price = ? WHERE id = ?
                    `).bind(c, rPrice, wPrice, Number(targetProductId))
                );
            }

            batchStatements.push(
                env.DB.prepare(`INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)`)
                    .bind(newPurId, Number(targetProductId), q, c, sub),
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                    quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(targetBranch, Number(targetProductId), q)
            );
        }

        // ၇။ အမှန်တကယ် ပေးခဲ့သော ငွေရှိပါက Cash Book တွင် စာရင်းသွင်းခြင်း
        if (paidAmount > 0) {
            const cbRefNo = refNo || purchaseNo;
            batchStatements.push(
                env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, purchase_id, entry_type, 
                        payment_method, bank_account_name, amount, diff_amount, 
                        ref_no, description, entry_date, created_by
                    ) VALUES (?, 6, ?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    targetBranch, newPurId, finalPaymentMethod,
                    body.bank_account_name || null, paidAmount, diffAmount,
                    cbRefNo, supplierName, purDate, currentUserId
                )
            );
        }

        try {
            if (batchStatements.length > 0) {
                await env.DB.batch(batchStatements);
            }
        } catch (err) {
            await env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(newPurId).run();
            throw new Error(`အဝယ်စာရင်း သိမ်းဆည်းမှု မအောင်မြင်ပါ: ${err.message}`);
        }

        return jsonResponse({ message: "အဝယ်စာရင်းနှင့် စတော့အဝင် အောင်မြင်ပါသည်။", purchaseNo }, 201);
    }

    // PURCHASES UPDATE (FULL ATOMIC REVERSAL + RE-APPLICATION OF STOCK, CASHBOOK & SUPPLIER PAYABLE)
    if (path.startsWith("/api/purchases/") && method === "PUT") {
        const purId = Number(path.split("/").pop());
        const body = await request.json().catch(() => ({}));
        const supplierName = String(body.supplier_name || "").trim();
        const refNo = body.ref_no && String(body.ref_no).trim() !== "" ? String(body.ref_no).trim() : null;
        const itemsList = Array.isArray(body.items) ? body.items : [];

        if (!purId || itemsList.length === 0) {
            return errorResponse("အဝယ်မှတ်တမ်း ID နှင့် ပစ္စည်းများ လိုအပ်ပါသည်", 400);
        }

        const oldPur = await env.DB.prepare(
            "SELECT branch_id, purchase_no, supplier_id, supplier_name, purchase_date FROM purchases WHERE id = ?"
        ).bind(purId).first();
        if (!oldPur) return errorResponse("အဝယ်မှတ်တမ်း ရှာမတွေ့ပါ", 404);

        const branchId = Number(oldPur.branch_id);
        const purDate = body.purchase_date || body.date || oldPur.purchase_date || getMyanmarTodayDate();

        const [oldItemsRes, oldLedgerRow] = await env.DB.batch([
            env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("SELECT id, supplier_id, amount FROM supplier_ledger WHERE purchase_id = ? AND type = 'PURCHASE_DEBT' LIMIT 1").bind(purId)
        ]);

        const oldItems = oldItemsRes.results || [];
        const oldDebtEntry = (oldLedgerRow.results || [])[0] || null;

        const batch = [];

        // ၁။ မူလစတော့အဝင်ကို ပြန်နှုတ်ခြင်း
        oldItems.forEach(it => {
            batch.push(
                env.DB.prepare("UPDATE branch_inventory SET quantity = MAX(0, quantity - ?) WHERE branch_id = ? AND product_id = ?")
                    .bind(roundQty(it.quantity), branchId, Number(it.product_id))
            );
        });
        batch.push(env.DB.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").bind(purId));

        // ၂။ မူလ ပွဲရုံအကြွေး (ရှိခဲ့ပါက) ပြန်နှုတ်ပြီး Ledger မှ ဖျက်ခြင်း
        if (oldDebtEntry && oldDebtEntry.supplier_id) {
            batch.push(
                env.DB.prepare("UPDATE customers SET current_payable = MAX(0, COALESCE(current_payable, 0) - ?) WHERE id = ?")
                    .bind(roundKyat(oldDebtEntry.amount), Number(oldDebtEntry.supplier_id)),
                env.DB.prepare("DELETE FROM supplier_ledger WHERE purchase_id = ?").bind(purId)
            );
        }

        // ၃။ ပစ္စည်းအသစ်များနှင့် ဈေးနှုန်းများ ပြန်ထည့်ခြင်း
        let newItemsTotal = 0;
        for (const it of itemsList) {
            const q = roundQty(it.quantity);
            const c = roundKyat(it.unit_cost);
            const sub = roundKyat(q * c);
            newItemsTotal += sub;

            if (it.retail_price !== undefined && it.wholesale_price !== undefined) {
                batch.push(
                    env.DB.prepare("UPDATE products SET cost_price = ?, retail_price = ?, wholesale_price = ? WHERE id = ?")
                        .bind(c, roundKyat(it.retail_price), roundKyat(it.wholesale_price), Number(it.product_id))
                );
            }

            batch.push(
                env.DB.prepare("INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)")
                    .bind(purId, Number(it.product_id), q, c, sub),
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(branchId, Number(it.product_id), q)
            );
        }

        const rawMethod = String(body.payment_method || "cash").toLowerCase();
        let newPaidAmount = 0;
        if (rawMethod === "credit") {
            newPaidAmount = 0;
        } else if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== "") {
            newPaidAmount = roundKyat(body.paid_amount);
        } else {
            newPaidAmount = roundKyat(body.total_amount ?? newItemsTotal);
        }

        const newDiffAmount = body.diff_amount !== undefined && body.diff_amount !== null && body.diff_amount !== ""
            ? roundKyat(body.diff_amount)
            : (newPaidAmount - newItemsTotal);

        const finalPaymentMethod = newPaidAmount === 0 ? "credit" : rawMethod;

        // ၄။ ပွဲရုံ ID ရှာဖွေခြင်းနှင့် ပေးရန်ကျန်ငွေ အသစ် (ရှိပါက) ပြန်ထည့်ခြင်း
        const suppRecord = await env.DB.prepare(
            "SELECT id FROM customers WHERE (name = ? OR shop_name = ?) AND is_active = 1 LIMIT 1"
        ).bind(supplierName, supplierName).first();
        const supplierId = suppRecord?.id || oldPur.supplier_id || null;
        const newPayableToAdd = newDiffAmount < 0 ? Math.abs(newDiffAmount) : (finalPaymentMethod === "credit" ? newItemsTotal : 0);

        if (newPayableToAdd > 0 && supplierId) {
            batch.push(
                env.DB.prepare("UPDATE customers SET current_payable = COALESCE(current_payable, 0) + ? WHERE id = ?")
                    .bind(newPayableToAdd, supplierId),
                env.DB.prepare(`
                    INSERT INTO supplier_ledger (supplier_id, branch_id, purchase_id, type, amount, balance_after, payment_method, reference_note, created_by)
                    VALUES (?, ?, ?, 'PURCHASE_DEBT', ?, (SELECT COALESCE(current_payable, 0) FROM customers WHERE id = ?), ?, ?, ?)
                `).bind(
                    supplierId, branchId, purId, newPayableToAdd, supplierId,
                    finalPaymentMethod, `အဝယ်ဘောင်ချာ ${oldPur.purchase_no}${refNo ? ` (Ref: ${refNo})` : ""}`, currentUserId
                )
            );
        }

        // ၅။ Purchases Header နှင့် Cashbook ပြန်ညှိခြင်း
        batch.push(
            env.DB.prepare(`
                UPDATE purchases SET 
                    supplier_id = ?, supplier_name = ?, purchase_date = ?, ref_no = ?, 
                    items_total = ?, total_amount = ?, paid_amount = ?, diff_amount = ?, 
                    payment_method = ?, bank_account_name = ? 
                WHERE id = ?
            `).bind(
                supplierId, supplierName, purDate, refNo,
                newItemsTotal, newItemsTotal, newPaidAmount, newDiffAmount,
                finalPaymentMethod, body.bank_account_name || null, purId
            ),
            env.DB.prepare("DELETE FROM cashbook_entries WHERE purchase_id = ?").bind(purId)
        );

        if (newPaidAmount > 0) {
            const cbRefNo = refNo || oldPur.purchase_no;
            batch.push(
                env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, purchase_id, entry_type, 
                        payment_method, bank_account_name, amount, diff_amount, 
                        ref_no, description, entry_date, created_by
                    ) VALUES (?, 6, ?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    branchId, purId, finalPaymentMethod,
                    body.bank_account_name || null, newPaidAmount, newDiffAmount,
                    cbRefNo, supplierName, purDate, currentUserId
                )
            );
        }

        await env.DB.batch(batch);
        return jsonResponse({ message: "အဝယ်စာရင်း ပြင်ဆင်ပြီး စတော့၊ ငွေစာရင်းနှင့် ပွဲရုံအကြွေးပါ ပြန်လည်ညှိနှိုင်းပြီးပါပြီ" });
    }

    // PURCHASES DELETE (FULL ATOMIC REVERSAL OF STOCK, CASHBOOK & SUPPLIER PAYABLE)
    if (path.startsWith("/api/purchases/") && method === "DELETE") {
        const purId = Number(path.split("/").pop());

        const [itemsRes, purRes, ledgerRes] = await env.DB.batch([
            env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("SELECT branch_id FROM purchases WHERE id = ?").bind(purId),
            env.DB.prepare("SELECT supplier_id, amount FROM supplier_ledger WHERE purchase_id = ? AND type = 'PURCHASE_DEBT'").bind(purId)
        ]);

        const items = itemsRes.results || [];
        const pur = (purRes.results || [])[0];
        const ledgerRows = ledgerRes.results || [];
        const branchId = Number(pur?.branch_id || userBranchId);

        const batchRollback = [];
        items.forEach(it => {
            batchRollback.push(
                env.DB.prepare("UPDATE branch_inventory SET quantity = MAX(0, quantity - ?) WHERE branch_id = ? AND product_id = ?")
                    .bind(roundQty(it.quantity), branchId, Number(it.product_id))
            );
        });

        ledgerRows.forEach(lr => {
            if (lr.supplier_id && lr.amount > 0) {
                batchRollback.push(
                    env.DB.prepare("UPDATE customers SET current_payable = MAX(0, COALESCE(current_payable, 0) - ?) WHERE id = ?")
                        .bind(roundKyat(lr.amount), Number(lr.supplier_id))
                );
            }
        });

        batchRollback.push(
            env.DB.prepare("DELETE FROM supplier_ledger WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("DELETE FROM cashbook_entries WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(purId)
        );

        await env.DB.batch(batchRollback);
        return jsonResponse({ message: "အဝယ်စာရင်း ဖျက်သိမ်းပြီး စတော့၊ ငွေစာရင်းနှင့် ပွဲရုံအကြွေးများ ပြန်ညှိပြီးပါပြီ။" });
    }

    // =========================================================================
    // 2. POS CHECKOUT, SPLIT PAYMENT & VOID/REFUND SALES (SECURITY HARDENED)
    // =========================================================================
    if (path === "/api/pos/sales" && method === "GET") {
        const branchId = url.searchParams.get("branch_id") || userBranchId;
        const date = url.searchParams.get("date") || getMyanmarTodayDate();

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
            WHERE s.branch_id = ? AND date(s.created_at, '+390 minutes') = ? AND s.status = 'completed'
            ORDER BY s.id DESC, si.id ASC
        `;
        const { results } = await env.DB.prepare(sql).bind(Number(branchId), date).all();
        return jsonResponse(results || []);
    }

    if (path === "/api/pos/sales" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const branchId = currentUserRole === "cashier" ? userBranchId : Number(body.branchId || userBranchId);
        const {
            customerId = null, saleType = "retail", items = [],
            discountAmount = 0, paidAmount = 0, paymentMethod = "cash",
            cashAmount = 0, bankAmount = 0, bankAccountName = null
        } = body;

        if (!branchId || !Array.isArray(items) || items.length === 0) {
            return errorResponse("ဆိုင်ခွဲနှင့် ပစ္စည်းစာရင်း လိုအပ်ပါသည်", 400);
        }

        // ၁။ စတော့နှင့် ပစ္စည်းဈေးနှုန်းအမှန်ကို Database မှ တိုက်ရိုက်စစ်ဆေးခြင်း (Tamper-Proof Pricing)
        const verifiedItems = [];
        let calculatedTotal = 0;

        for (const item of items) {
            const pid = Number(item.productId || item.product_id);
            const qty = roundQty(item.quantity);
            if (!pid || qty <= 0) return errorResponse("ပစ္စည်းအရေအတွက် မှားယွင်းနေပါသည်", 400);

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

            if (Number(product.current_stock) < qty) {
                return errorResponse(`"${product.item_name}" လက်ကျန်စတော့ (${product.current_stock}) မလုံလောက်ပါ`, 400);
            }

            const dbRetail = roundKyat(product.retail_price || 0);
            const dbWholesale = roundKyat(product.wholesale_price || product.retail_price || 0);
            const costPrice = roundKyat(product.cost_price || 0);
            const clientPrice = roundKyat(item.unitPrice);

            // Server-side Authoritative Price Determination
            let unitPrice = (item.priceType === "wholesale" || saleType === "wholesale") ? dbWholesale : dbRetail;

            // Client က လက်လီ သို့မဟုတ် လက်ကား ဈေးနှုန်းအမှန်နှစ်ခုထဲမှ တစ်ခုကို ရွေးထားပါက ခွင့်ပြုမည်
            if (clientPrice > 0 && (clientPrice === dbRetail || clientPrice === dbWholesale)) {
                unitPrice = clientPrice;
            } else if (clientPrice > 0 && ["admin", "manager", "finance"].includes(currentUserRole) && clientPrice >= costPrice) {
                // Admin/Manager က အရင်းဈေးအထက် သီးသန့်ဈေးနှုန်း သတ်မှတ်ပါက ခွင့်ပြုမည်
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
            if (pCash + pBank > finalAmount) {
                pCash = Math.max(0, finalAmount - pBank);
            }
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

        // ၂။ Customer Credit Limit စစ်ဆေးခြင်း
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

        // ၃။ Collision-Free Invoice Number ထုတ်ယူခြင်း
        const todayDate = getMyanmarTodayDate();
        const dateStr = todayDate.replace(/-/g, "");
        const timeSuffix = Date.now().toString(36).slice(-4).toUpperCase() + Math.floor(10 + Math.random() * 89);
        const invoiceNo = `INV-B${branchId}-${dateStr}-${timeSuffix}`;

        // ၄။ 100% Atomic Single-Batch Transaction (Sale Header + Items + Stock + Cashbook + Ledger)
        const saleIdSubquery = `(SELECT id FROM sales WHERE invoice_no = ?)`;
        const batchStatements = [
            env.DB.prepare(`
                INSERT INTO sales (
                    invoice_no, branch_id, customer_id, sale_type,
                    total_amount, discount_amount, final_amount, paid_amount, debt_amount,
                    payment_method, cash_amount, bank_amount, bank_account_name, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).bind(
                invoiceNo, Number(branchId), customerId ? Number(customerId) : null, saleType,
                calculatedTotal, discount, finalAmount, effectivePaid, debtAmount,
                paymentMethod, pCash, pBank, bankAccountName || null, currentUserId
            )
        ];

        // ၅။ Items ထည့်သွင်းခြင်းနှင့် Stock နုတ်ခြင်း
        for (const item of verifiedItems) {
            batchStatements.push(
                env.DB.prepare(`
                    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, subtotal)
                    VALUES (${saleIdSubquery}, ?, ?, ?, ?, ?)
                `).bind(invoiceNo, item.productId, item.quantity, item.unitPrice, item.costPrice, item.subtotal),
                env.DB.prepare(`
                    UPDATE branch_inventory
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE branch_id = ? AND product_id = ?
                `).bind(item.quantity, Number(branchId), item.productId)
            );
        }

        // ၆။ Cashbook စာရင်းသွင်းခြင်း
        if (effectivePaid > 0) {
            if (pCash > 0) {
                batchStatements.push(
                    env.DB.prepare(`
                        INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, amount, ref_no, description, entry_date, created_by)
                        VALUES (?, 1, ${saleIdSubquery}, 'INCOME', 'cash', ?, ?, ?, ?, ?)
                    `).bind(Number(branchId), invoiceNo, pCash, invoiceNo, `${custName} (အရောင်း - ငွေသား)`, todayDate, currentUserId)
                );
            }
            if (pBank > 0) {
                batchStatements.push(
                    env.DB.prepare(`
                        INSERT INTO cashbook_entries (branch_id, category_id, sale_id, entry_type, payment_method, bank_account_name, amount, ref_no, description, entry_date, created_by)
                        VALUES (?, 1, ${saleIdSubquery}, 'INCOME', 'bank', ?, ?, ?, ?, ?, ?)
                    `).bind(Number(branchId), invoiceNo, bankAccountName || "KPay/Bank", pBank, invoiceNo, `${custName} (အရောင်း - ${bankAccountName || "Bank"})`, todayDate, currentUserId)
                );
            }
        }

        // ၇။ Customer အကြွေးစာရင်း အလိုအလျောက်တိုးခြင်း
        if (debtAmount > 0 && customerId) {
            batchStatements.push(
                env.DB.prepare("UPDATE customers SET current_debt = COALESCE(current_debt, 0) + ? WHERE id = ?")
                    .bind(debtAmount, Number(customerId)),
                env.DB.prepare(`
                    INSERT INTO customer_ledger (customer_id, branch_id, sale_id, type, amount, balance_after, payment_method, reference_note, created_by)
                    VALUES (?, ?, ${saleIdSubquery}, 'DEBIT', ?, (SELECT COALESCE(current_debt, 0) FROM customers WHERE id = ?), 'credit', ?, ?)
                `).bind(Number(customerId), Number(branchId), invoiceNo, debtAmount, Number(customerId), `ဘောင်ချာ ${invoiceNo} အကြွေးကျန်`, currentUserId)
            );
        }

        const batchResults = await env.DB.batch(batchStatements);
        const saleId = batchResults[0]?.meta?.last_row_id || null;

        return jsonResponse({ message: "အရောင်းဘောင်ချာ အောင်မြင်ပါသည်", invoiceNo, saleId, finalAmount }, 201);
    }

    // POS SALE VOID / CANCEL / DELETE (FULL ATOMIC REVERSAL OF STOCK, CASHBOOK & CUSTOMER DEBT)
    if ((path.startsWith("/api/pos/sales/") || path.startsWith("/api/sales/")) && method === "DELETE") {
        const saleId = Number(path.split("/").pop());
        if (!saleId) return errorResponse("ဘောင်ချာ ID မမှန်ကန်ပါ", 400);

        const sale = await env.DB.prepare(
            "SELECT id, branch_id, customer_id, debt_amount, status FROM sales WHERE id = ?"
        ).bind(saleId).first();
        if (!sale) return errorResponse("အရောင်းဘောင်ချာ ရှာမတွေ့ပါ", 404);

        const { results: saleItems } = await env.DB.prepare(
            "SELECT product_id, quantity FROM sale_items WHERE sale_id = ?"
        ).bind(saleId).all();

        const batchRollback = [];

        // ၁။ ရောင်းထုတ်ခဲ့သော ပစ္စည်းအရေအတွက်များကို ဆိုင်ခွဲစတော့ထဲသို့ ပြန်ပေါင်းထည့်ခြင်း
        for (const item of (saleItems || [])) {
            batchRollback.push(
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(Number(sale.branch_id), Number(item.product_id), roundQty(item.quantity))
            );
        }

        // ၂။ အကြွေးပါခဲ့ပါက ဖောက်သည်အကြွေးမှ ပြန်နှုတ်ပြီး Ledger မှ ဖျက်ခြင်း
        if (Number(sale.debt_amount) > 0 && sale.customer_id) {
            batchRollback.push(
                env.DB.prepare("UPDATE customers SET current_debt = MAX(0, COALESCE(current_debt, 0) - ?) WHERE id = ?")
                    .bind(roundKyat(sale.debt_amount), Number(sale.customer_id)),
                env.DB.prepare("DELETE FROM customer_ledger WHERE sale_id = ?").bind(saleId)
            );
        }

        // ၃။ Cashbook နှင့် Sale မှတ်တမ်းအား ဖျက်သိမ်းခြင်း
        batchRollback.push(
            env.DB.prepare("DELETE FROM cashbook_entries WHERE sale_id = ?").bind(saleId),
            env.DB.prepare("DELETE FROM sale_items WHERE sale_id = ?").bind(saleId),
            env.DB.prepare("DELETE FROM sales WHERE id = ?").bind(saleId)
        );

        await env.DB.batch(batchRollback);
        return jsonResponse({ message: "အရောင်းဘောင်ချာ ပယ်ဖျက်ပြီး စတော့၊ ငွေစာရင်းနှင့် အကြွေးစာရင်းများ ပြန်ညှိပြီးပါပြီ" });
    }

    return null;
}
