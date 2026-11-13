// =============================================================================
// FILE 3 OF 5: cashbook-api/routes-transactions.js
// PURCHASES (STOCK-IN + OWN PRODUCTION + SUPPLIER PAYABLE) & POS SALES
// Version: 4.1.0 (Ledger-Backed Stock Movements, Strict RBAC & Race-Safe VR)
// =============================================================================

import {
    jsonResponse,
    errorResponse,
    MM_OFFSET,
    getMyanmarTodayDate,
    getMyanmarDayUtcBounds,
    getMyanmarYearUtcBounds,
    roundKyat,
    roundQty,
    getQueryYear,
    can,
    requirePermission,
    resolveBranchId,
    logAudit,
    generateUniqueInvoice,
    createStockMovementStmt
} from "./utils.js";

export async function handleTransactionRoutes(request, env, url, path, method, auth) {
    const currentUserId = Number(auth.uid);
    const currentUserRole = auth.role;
    const userBranchId = Number(auth.branch_id || 1);

    // =========================================================================
    // 1. PURCHASES & STOCK IN (SUPPORTS EXTERNAL PURCHASE & OWN PRODUCTION)
    // =========================================================================
    if (path === "/api/purchases" && method === "GET") {
        requirePermission(auth, "purchase.view", "အဝယ်စာရင်း ကြည့်ရှုခွင့် မရှိပါ");

        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"), { allowAllForAdmin: true });
        const targetYear = getQueryYear(url);
        const { startUtc: yearStartUtc, endUtc: yearEndUtc } = getMyanmarYearUtcBounds(targetYear);

        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const limit = Math.max(1, Number(url.searchParams.get("limit")) || 2000);
        const offset = (page - 1) * limit;

        const isSpecificBranch = branchId !== "ALL";
        const branchClause = isSpecificBranch ? "p.branch_id = ? AND " : "";
        const countBindings = isSpecificBranch
            ? [Number(branchId), yearStartUtc, yearEndUtc]
            : [yearStartUtc, yearEndUtc];

        const countSql = `
            SELECT COUNT(DISTINCT p.id) AS total
            FROM purchases p
            WHERE ${branchClause}
              p.created_at >= ? 
              AND p.created_at <= ?
              AND COALESCE(p.status, 'completed') != 'cancelled'
        `;
        const countRes = await env.DB.prepare(countSql).bind(...countBindings).first();
        const totalItems = countRes?.total || 0;

        const sql = `
            SELECT 
                pi.id AS item_row_id,
                p.id AS purchase_id,
                p.branch_id,
                p.purchase_no,
                p.purchase_no AS vr_no,
                p.ref_no,
                p.supplier_id,
                p.supplier_name,
                COALESCE(p.purchase_date, date(p.created_at, '${MM_OFFSET}')) AS purchase_date,
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
            WHERE ${branchClause}
              p.created_at >= ? 
              AND p.created_at <= ?
              AND COALESCE(p.status, 'completed') != 'cancelled'
            ORDER BY p.id DESC, pi.id DESC LIMIT ? OFFSET ?
        `;
        const listBindings = isSpecificBranch
            ? [Number(branchId), yearStartUtc, yearEndUtc, limit, offset]
            : [yearStartUtc, yearEndUtc, limit, offset];

        const { results } = await env.DB.prepare(sql).bind(...listBindings).all();

        return jsonResponse({
            items: results || [],
            total: totalItems,
            page,
            limit
        });
    }

    if (path === "/api/purchases" && method === "POST") {
        requirePermission(auth, "purchase.create", "အဝယ်စာရင်း သွင်းခွင့် မရှိပါ");

        const body = await request.json().catch(() => ({}));
        const targetBranch = resolveBranchId(auth, body.branch_id ?? body.branchId, {
            isWrite: true,
            strictStaffCheck: true
        });
        const rawMethod = String(body.payment_method ?? body.paymentMethod ?? "cash").toLowerCase();
        const validMethod = ["cash", "bank", "credit", "production"].includes(rawMethod) ? rawMethod : "cash";
        const isOwnProduction = validMethod === "production";

        let supplierName = String(body.supplier_name ?? body.supplierName ?? "").trim();
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
            const c = roundKyat(it.unit_cost ?? it.unitCost);
            const rPrice = roundKyat(it.retail_price ?? it.retailPrice);
            const wPrice = roundKyat(it.wholesale_price ?? it.wholesalePrice);

            if (q <= 0 || c < 0 || rPrice < 0 || wPrice < 0) {
                return errorResponse("ပစ္စည်းအရေအတွက်နှင့် ဈေးနှုန်းများ မှန်ကန်စွာ ထည့်သွင်းပေးပါ", 400);
            }

            if (it.is_new && it.new_product) {
                requirePermission(auth, "product.create", "အဝယ်စာရင်းမှတစ်ဆင့် ပစ္စည်း Master အသစ် တိုက်ရိုက်ဖန်တီးခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");
                if (!it.new_product.category || !(it.new_product.item_name || it.new_product.itemName)) {
                    return errorResponse("ပစ္စည်းအသစ်အတွက် အမျိုးအစားနှင့် အမည် လိုအပ်ပါသည်", 400);
                }
            } else if (!Number(it.product_id ?? it.productId)) {
                return errorResponse("ပစ္စည်း ID မမှန်ကန်ပါ", 400);
            }

            const lineSub = roundKyat(q * c);
            itemsTotal += lineSub;

            validatedItems.push({
                product_id: Number(it.product_id ?? it.productId ?? 0),
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

        const purchaseNo = await generateUniqueInvoice(env.DB, "PUR", targetBranch);
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
            const rawPaidInput = body.paid_amount ?? body.paidAmount;
            if (rawPaidInput !== undefined && rawPaidInput !== null && rawPaidInput !== "") {
                paidAmount = Math.max(0, roundKyat(rawPaidInput));
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
            dbPaymentMethod, isOwnProduction ? null : (body.bank_account_name ?? body.bankAccountName ?? null), notesTag, currentUserId
        ).run();

        const newPurId = purRes.meta.last_row_id;
        const batchStatements = [];
        const canUpdateMasterPrice = can(auth, "product.update");

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
                    np.barcode && String(np.barcode).trim() !== "" ? String(np.barcode).trim() : null,
                    String(np.category).trim(),
                    String(np.item_name ?? np.itemName).trim(),
                    np.pattern ? String(np.pattern).trim() : null,
                    np.size ? String(np.size).trim() : "ထည်",
                    np.color ? String(np.color).trim() : null,
                    item.unit_cost, item.retail_price, item.wholesale_price
                ).run();

                targetProductId = prodRes.meta.last_row_id;
            } else if (canUpdateMasterPrice && item.retail_price > 0) {
                batchStatements.push(
                    env.DB.prepare(`
                        UPDATE products SET cost_price = ?, retail_price = ?, wholesale_price = ? WHERE id = ?
                    `).bind(item.unit_cost, item.retail_price, item.wholesale_price, Number(targetProductId))
                );
            }

            // Spec 2.1: Update branch_inventory AND insert PURCHASE_IN movement in the same batch
            batchStatements.push(
                env.DB.prepare(`INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)`)
                    .bind(newPurId, Number(targetProductId), item.quantity, item.unit_cost, item.subtotal),
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                    quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(targetBranch, Number(targetProductId), item.quantity),
                createStockMovementStmt(env.DB, {
                    branchId: targetBranch,
                    productId: Number(targetProductId),
                    movementType: "PURCHASE_IN",
                    quantity: item.quantity,
                    effectiveDate: purDate,
                    sourceTable: "purchases",
                    sourceId: newPurId,
                    reason: isOwnProduction ? `Own production ${purchaseNo}` : `Purchase ${purchaseNo}`,
                    createdBy: currentUserId
                })
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
                    body.bank_account_name ?? body.bankAccountName ?? null, paidAmount, diffAmount,
                    cbRefNo, supplierName, purDate, currentUserId
                )
            );
        }

        try {
            if (batchStatements.length > 0) {
                await env.DB.batch(batchStatements);
            }
        } catch (err) {
            await env.DB.prepare("DELETE FROM purchases WHERE id = ?").bind(newPurId).run().catch(() => {});
            throw new Error(`အဝယ်စာရင်း သိမ်းဆည်းမှု မအောင်မြင်ပါ: ${err.message}`);
        }

        return jsonResponse({
            message: isOwnProduction
                ? "ကိုယ်ပိုင်ထုတ်လုပ်မှု စတော့အဝင် မှတ်တမ်းတင်ပြီးပါပြီ (ငွေစာရင်းနှင့် အကြွေးမထိပါ)"
                : "အဝယ်စာရင်းနှင့် စတော့အဝင် အောင်မြင်ပါသည်။",
            purchaseNo,
            id: newPurId
        }, 201);
    }

    // PURCHASES UPDATE (FULL ATOMIC REVERSAL + APPEND-ONLY STOCK MOVEMENTS)
    if (path.startsWith("/api/purchases/") && method === "PUT") {
        requirePermission(auth, "purchase.update", "အဝယ်စာရင်း ပြင်ဆင်ခွင့် မရှိပါ");

        const purId = Number(path.split("/").pop());
        const body = await request.json().catch(() => ({}));
        const rawMethod = String(body.payment_method ?? body.paymentMethod ?? "cash").toLowerCase();
        const validMethod = ["cash", "bank", "credit", "production"].includes(rawMethod) ? rawMethod : "cash";
        const isOwnProduction = validMethod === "production";

        let supplierName = String(body.supplier_name ?? body.supplierName ?? "").trim();
        if (isOwnProduction && !supplierName) {
            supplierName = "ကိုယ်ပိုင်ရက်ကန်း / ထုတ်လုပ်မှု";
        }

        const refNo = body.ref_no && String(body.ref_no).trim() !== "" ? String(body.ref_no).trim() : null;
        const itemsList = Array.isArray(body.items) ? body.items : [];

        if (!purId || !supplierName || itemsList.length === 0) {
            return errorResponse("အဝယ်မှတ်တမ်း ID၊ ပွဲရုံအမည်နှင့် ပစ္စည်းများ လိုအပ်ပါသည်", 400);
        }

        const oldPur = await env.DB.prepare(
            "SELECT branch_id, purchase_no, supplier_id, supplier_name, purchase_date, status FROM purchases WHERE id = ?"
        ).bind(purId).first();
        if (!oldPur || oldPur.status === "cancelled") {
            return errorResponse("အဝယ်မှတ်တမ်း ရှာမတွေ့ပါ သို့မဟုတ် ပယ်ဖျက်ထားပြီး ဖြစ်ပါသည်", 404);
        }

        const branchId = Number(oldPur.branch_id);
        if (currentUserRole === "branch_manager" && branchId !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ အဝယ်မှတ်တမ်းအား ပြင်ဆင်ခွင့် မရှိပါ", 403);
        }

        const purDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.purchase_date || body.date || "").trim())
            ? String(body.purchase_date || body.date).trim()
            : (oldPur.purchase_date || getMyanmarTodayDate());

        const [oldItemsRes, oldLedgerRow, currentInvRes] = await env.DB.batch([
            env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("SELECT id, supplier_id, amount FROM supplier_ledger WHERE purchase_id = ? AND type = 'PURCHASE_DEBT' AND COALESCE(status, 'completed') != 'cancelled' LIMIT 1").bind(purId),
            env.DB.prepare("SELECT product_id, quantity FROM branch_inventory WHERE branch_id = ?").bind(branchId)
        ]);

        const oldItems = oldItemsRes.results || [];
        const oldDebtEntry = (oldLedgerRow.results || [])[0] || null;
        const invMap = new Map((currentInvRes.results || []).map(r => [Number(r.product_id), roundQty(r.quantity)]));

        const netDeltaByProduct = new Map();
        for (const oldIt of oldItems) {
            const pid = Number(oldIt.product_id);
            netDeltaByProduct.set(pid, roundQty((netDeltaByProduct.get(pid) || 0) - roundQty(oldIt.quantity)));
        }

        let newItemsTotal = 0;
        const validatedNewItems = [];
        for (const it of itemsList) {
            const pid = Number(it.product_id ?? it.productId);
            const q = roundQty(it.quantity);
            const c = roundKyat(it.unit_cost ?? it.unitCost);
            if (!pid || q <= 0 || c < 0) {
                return errorResponse("ပစ္စည်းအရေအတွက်နှင့် ဝယ်ဈေး မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
            }
            const sub = roundKyat(q * c);
            newItemsTotal += sub;
            netDeltaByProduct.set(pid, roundQty((netDeltaByProduct.get(pid) || 0) + q));
            validatedNewItems.push({
                product_id: pid,
                quantity: q,
                unit_cost: c,
                retail_price: it.retail_price !== undefined ? roundKyat(it.retail_price) : undefined,
                wholesale_price: it.wholesale_price !== undefined ? roundKyat(it.wholesale_price) : undefined,
                subtotal: sub
            });
        }

        for (const [pid, delta] of netDeltaByProduct.entries()) {
            const currentQty = invMap.get(pid) || 0;
            if (currentQty + delta < 0) {
                return errorResponse(
                    `ပစ္စည်း (ID: ${pid}) သည် ရောင်းချ/လွှဲပြောင်းထားပြီးဖြစ်သဖြင့် လက်ရှိလက်ကျန် (${currentQty}) ထက် လျှော့ချ၍ မရနိုင်ပါ`,
                    400
                );
            }
        }

        const batch = [];
        const canUpdateMasterPrice = can(auth, "product.update");

        // ၁။ Net Stock Delta အတိအကျ ပြန်ညှိခြင်း နှင့် Append-only stock_movements ထည့်ခြင်း (Spec 2.1)
        for (const [pid, delta] of netDeltaByProduct.entries()) {
            if (delta !== 0) {
                batch.push(
                    env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                            quantity = branch_inventory.quantity + excluded.quantity,
                            updated_at = CURRENT_TIMESTAMP
                    `).bind(branchId, pid, delta),
                    createStockMovementStmt(env.DB, {
                        branchId,
                        productId: pid,
                        movementType: delta > 0 ? "PURCHASE_IN" : "PURCHASE_VOID_OUT",
                        quantity: Math.abs(delta),
                        effectiveDate: purDate,
                        sourceTable: "purchases",
                        sourceId: purId,
                        reason: `Purchase ${oldPur.purchase_no} edited (net delta: ${delta > 0 ? "+" : ""}${delta})`,
                        createdBy: currentUserId
                    })
                );
            }
        }

        batch.push(env.DB.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").bind(purId));

        if (oldDebtEntry && oldDebtEntry.supplier_id) {
            batch.push(
                env.DB.prepare("UPDATE customers SET current_payable = MAX(0, COALESCE(current_payable, 0) - ?) WHERE id = ?")
                    .bind(roundKyat(oldDebtEntry.amount), Number(oldDebtEntry.supplier_id)),
                env.DB.prepare("DELETE FROM supplier_ledger WHERE purchase_id = ?").bind(purId)
            );
        }

        for (const it of validatedNewItems) {
            if (canUpdateMasterPrice && it.retail_price !== undefined && it.wholesale_price !== undefined) {
                batch.push(
                    env.DB.prepare("UPDATE products SET cost_price = ?, retail_price = ?, wholesale_price = ? WHERE id = ?")
                        .bind(it.unit_cost, it.retail_price, it.wholesale_price, it.product_id)
                );
            }

            batch.push(
                env.DB.prepare("INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (?, ?, ?, ?, ?)")
                    .bind(purId, it.product_id, it.quantity, it.unit_cost, it.subtotal)
            );
        }

        let newPaidAmount = 0;
        let newDiffAmount = 0;
        let dbPaymentMethod = "cash";
        let notesTag = null;

        if (isOwnProduction) {
            newPaidAmount = 0;
            newDiffAmount = 0;
            dbPaymentMethod = "production";
            notesTag = "OWN_PRODUCTION";
        } else if (validMethod === "credit") {
            newPaidAmount = 0;
            newDiffAmount = -newItemsTotal;
            dbPaymentMethod = "credit";
        } else {
            const rawPaidInput = body.paid_amount ?? body.paidAmount;
            if (rawPaidInput !== undefined && rawPaidInput !== null && rawPaidInput !== "") {
                newPaidAmount = Math.max(0, roundKyat(rawPaidInput));
            } else {
                newPaidAmount = newItemsTotal;
            }
            newDiffAmount = newPaidAmount - newItemsTotal;
            dbPaymentMethod = newPaidAmount === 0 ? "credit" : validMethod;
        }

        let supplierId = null;
        if (!isOwnProduction) {
            const suppRecord = await env.DB.prepare(
                "SELECT id FROM customers WHERE (name = ? OR shop_name = ?) AND is_active = 1 LIMIT 1"
            ).bind(supplierName, supplierName).first();
            supplierId = suppRecord?.id || oldPur.supplier_id || null;
            const newPayableToAdd = newDiffAmount < 0 ? Math.abs(newDiffAmount) : (dbPaymentMethod === "credit" ? newItemsTotal : 0);

            if (newPayableToAdd > 0 && supplierId) {
                batch.push(
                    env.DB.prepare("UPDATE customers SET current_payable = COALESCE(current_payable, 0) + ? WHERE id = ?")
                        .bind(newPayableToAdd, supplierId),
                    env.DB.prepare(`
                        INSERT INTO supplier_ledger (supplier_id, branch_id, purchase_id, type, amount, balance_after, payment_method, reference_note, status, created_by)
                        VALUES (?, ?, ?, 'PURCHASE_DEBT', ?, (SELECT COALESCE(current_payable, 0) FROM customers WHERE id = ?), ?, ?, 'completed', ?)
                    `).bind(
                        supplierId, branchId, purId, newPayableToAdd, supplierId,
                        dbPaymentMethod, `အဝယ်ဘောင်ချာ ${oldPur.purchase_no}${refNo ? ` (Ref: ${refNo})` : ""}`, currentUserId
                    )
                );
            }
        }

        batch.push(
            env.DB.prepare(`
                UPDATE purchases SET 
                    supplier_id = ?, supplier_name = ?, purchase_date = ?, ref_no = ?, 
                    items_total = ?, total_amount = ?, paid_amount = ?, diff_amount = ?, 
                    payment_method = ?, bank_account_name = ?, notes = ?
                WHERE id = ?
            `).bind(
                supplierId, supplierName, purDate, refNo,
                newItemsTotal, newItemsTotal, newPaidAmount, newDiffAmount,
                dbPaymentMethod, isOwnProduction ? null : (body.bank_account_name ?? body.bankAccountName ?? null), notesTag, purId
            ),
            env.DB.prepare("DELETE FROM cashbook_entries WHERE purchase_id = ?").bind(purId)
        );

        if (!isOwnProduction && newPaidAmount > 0) {
            const cbRefNo = refNo || oldPur.purchase_no;
            batch.push(
                env.DB.prepare(`
                    INSERT INTO cashbook_entries (
                        branch_id, category_id, purchase_id, entry_type, 
                        payment_method, bank_account_name, amount, diff_amount, 
                        ref_no, description, entry_date, status, created_by
                    ) VALUES (?, 6, ?, 'EXPENSE', ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
                `).bind(
                    branchId, purId, dbPaymentMethod,
                    body.bank_account_name ?? body.bankAccountName ?? null, newPaidAmount, newDiffAmount,
                    cbRefNo, supplierName, purDate, currentUserId
                )
            );
        }

        await env.DB.batch(batch);

        await logAudit(env.DB, {
            branchId,
            userId: currentUserId,
            action: "UPDATE_PURCHASE",
            tableName: "purchases",
            recordId: purId,
            details: { purchase_no: oldPur.purchase_no, newItemsTotal, newPaidAmount, isOwnProduction }
        });

        return jsonResponse({ message: "စာရင်း ပြင်ဆင်ပြီး စတော့၊ Movement Ledger၊ ငွေစာရင်းနှင့် ပွဲရုံအကြွေးပါ ပြန်လည်ညှိနှိုင်းပြီးပါပြီ" });
    }

    // PURCHASES VOID / SOFT-DELETE (FULL ATOMIC REVERSAL + PURCHASE_VOID_OUT MOVEMENT)
    if (path.startsWith("/api/purchases/") && method === "DELETE") {
        requirePermission(auth, "purchase.void", "အဝယ်ဘောင်ချာ ပယ်ဖျက်ခွင့် မရှိပါ");

        const purId = Number(path.split("/").pop());
        if (!purId) return errorResponse("အဝယ်မှတ်တမ်း ID မမှန်ကန်ပါ", 400);

        const [itemsRes, purRes, ledgerRes] = await env.DB.batch([
            env.DB.prepare("SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("SELECT id, purchase_no, branch_id, supplier_name, items_total, status FROM purchases WHERE id = ?").bind(purId),
            env.DB.prepare("SELECT supplier_id, amount FROM supplier_ledger WHERE purchase_id = ? AND type = 'PURCHASE_DEBT' AND COALESCE(status, 'completed') != 'cancelled'").bind(purId)
        ]);

        const pur = (purRes.results || [])[0];
        if (!pur) return errorResponse("အဝယ်မှတ်တမ်း ရှာမတွေ့ပါ", 404);
        if (pur.status === "cancelled") {
            return errorResponse("ဤအဝယ်မှတ်တမ်းသည် ပယ်ဖျက်ထားပြီး ဖြစ်ပါသည်", 400);
        }

        const branchId = Number(pur.branch_id);
        if (currentUserRole === "branch_manager" && branchId !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ အဝယ်မှတ်တမ်းအား ဖျက်သိမ်းခွင့် မရှိပါ", 403);
        }

        const items = itemsRes.results || [];
        const ledgerRows = ledgerRes.results || [];

        const { results: branchStockRows } = await env.DB.prepare(
            "SELECT product_id, quantity FROM branch_inventory WHERE branch_id = ?"
        ).bind(branchId).all();
        const stockMap = new Map((branchStockRows || []).map(r => [Number(r.product_id), roundQty(r.quantity)]));

        for (const it of items) {
            const currentQty = stockMap.get(Number(it.product_id)) || 0;
            const revQty = roundQty(it.quantity);
            if (currentQty < revQty) {
                return errorResponse(
                    `အဝယ်ဘောင်ချာပါ ပစ္စည်းအချို့ ရောင်းချ/လွှဲပြောင်းထားပြီးဖြစ်သဖြင့် လက်ကျန် (${currentQty}) မလုံလောက်၍ ဖျက်သိမ်းမရနိုင်ပါ`,
                    400
                );
            }
        }

        const today = getMyanmarTodayDate();
        const batchRollback = [];

        items.forEach(it => {
            const revQty = roundQty(it.quantity);
            batchRollback.push(
                env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ? AND quantity >= ?")
                    .bind(revQty, branchId, Number(it.product_id), revQty),
                createStockMovementStmt(env.DB, {
                    branchId,
                    productId: Number(it.product_id),
                    movementType: "PURCHASE_VOID_OUT",
                    quantity: revQty,
                    effectiveDate: today,
                    sourceTable: "purchases",
                    sourceId: purId,
                    reason: `Voided purchase ${pur.purchase_no}`,
                    createdBy: currentUserId
                })
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
            env.DB.prepare("UPDATE supplier_ledger SET status = 'cancelled' WHERE purchase_id = ?").bind(purId),
            env.DB.prepare("UPDATE cashbook_entries SET status = 'cancelled' WHERE purchase_id = ?").bind(purId),
            env.DB.prepare(`
                UPDATE purchases 
                SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = 'Voided by user'
                WHERE id = ?
            `).bind(currentUserId, purId)
        );

        await env.DB.batch(batchRollback);

        await logAudit(env.DB, {
            branchId,
            userId: currentUserId,
            action: "VOID_PURCHASE",
            tableName: "purchases",
            recordId: purId,
            details: { purchase_no: pur.purchase_no, supplier: pur.supplier_name, items_total: pur.items_total }
        });

        return jsonResponse({ message: "အဝယ်စာရင်း ပယ်ဖျက်ပြီး စတော့၊ Movement Ledger၊ ငွေစာရင်းနှင့် ပွဲရုံအကြွေးများ ပြန်ညှိပြီးပါပြီ။" });
    }

    // =========================================================================
    // 2. POS CHECKOUT, SPLIT PAYMENT & VOID/REFUND SALES (SECURITY HARDENED)
    // =========================================================================
    if (path === "/api/pos/sales" && method === "GET") {
        requirePermission(auth, "pos.sale");

        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"), { allowAllForAdmin: true });
        const date = url.searchParams.get("date") || getMyanmarTodayDate();
        const { startUtc, endUtc } = getMyanmarDayUtcBounds(date);

        const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
        const limit = Math.max(1, Number(url.searchParams.get("limit")) || 2000);
        const offset = (page - 1) * limit;

        const isSpecificBranch = branchId !== "ALL";
        const branchClause = isSpecificBranch ? "s.branch_id = ? AND " : "";
        const countBindings = isSpecificBranch
            ? [Number(branchId), startUtc, endUtc]
            : [startUtc, endUtc];

        const countSql = `
            SELECT COUNT(DISTINCT s.id) AS total
            FROM sales s
            WHERE ${branchClause}
              s.created_at >= ? 
              AND s.created_at <= ? 
              AND s.status = 'completed'
        `;
        const countRes = await env.DB.prepare(countSql).bind(...countBindings).first();
        const totalItems = countRes?.total || 0;

        const sql = `
            SELECT 
                s.id AS sale_id,
                s.branch_id,
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
            WHERE ${branchClause}
              s.created_at >= ? 
              AND s.created_at <= ? 
              AND s.status = 'completed'
            ORDER BY s.id DESC, si.id ASC LIMIT ? OFFSET ?
        `;
        const listBindings = isSpecificBranch
            ? [Number(branchId), startUtc, endUtc, limit, offset]
            : [startUtc, endUtc, limit, offset];

        const { results } = await env.DB.prepare(sql).bind(...listBindings).all();

        return jsonResponse({
            items: results || [],
            total: totalItems,
            page,
            limit
        });
    }

    if (path === "/api/pos/sales" && method === "POST") {
        requirePermission(auth, "pos.sale", "POS အရောင်းဘောင်ချာ ဖွင့်ခွင့် မရှိပါ");

        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branch_id ?? body.branchId, {
            isWrite: true,
            strictStaffCheck: true
        });
        const customerId = body.customer_id ?? body.customerId ?? null;
        const saleType = body.sale_type ?? body.saleType ?? "retail";
        const items = Array.isArray(body.items) ? body.items : [];
        const discountAmount = body.discount_amount ?? body.discountAmount ?? 0;
        const paidAmount = body.paid_amount ?? body.paidAmount ?? 0;
        const paymentMethod = body.payment_method ?? body.paymentMethod ?? "cash";
        const cashAmount = body.cash_amount ?? body.cashAmount ?? 0;
        const bankAmount = body.bank_amount ?? body.bankAmount ?? 0;
        const bankAccountName = body.bank_account_name ?? body.bankAccountName ?? null;

        if (!branchId || items.length === 0) {
            return errorResponse("ဆိုင်ခွဲနှင့် ပစ္စည်းစာရင်း လိုအပ်ပါသည်", 400);
        }

        const totalQtyByProd = new Map();
        for (const item of items) {
            const pid = Number(item.productId ?? item.product_id);
            const qty = roundQty(item.quantity);
            if (!pid || qty <= 0) return errorResponse("ပစ္စည်းအရေအတွက် မှားယွင်းနေပါသည်", 400);
            totalQtyByProd.set(pid, roundQty((totalQtyByProd.get(pid) || 0) + qty));
        }

        const verifiedItems = [];
        let calculatedTotal = 0;
        const canOverridePrice = can(auth, "pos.override_price");

        for (const item of items) {
            const pid = Number(item.productId ?? item.product_id);
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
            const clientPrice = roundKyat(item.unitPrice ?? item.unit_price);

            let unitPrice = ((item.priceType ?? item.price_type) === "wholesale" || saleType === "wholesale")
                ? dbWholesale
                : dbRetail;

            if (clientPrice > 0 && (clientPrice === dbRetail || clientPrice === dbWholesale)) {
                unitPrice = clientPrice;
            } else if (clientPrice > 0 && canOverridePrice && clientPrice >= costPrice) {
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

        const invoiceNo = await generateUniqueInvoice(env.DB, "INV", branchId);
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
                env.DB.prepare(`
                    UPDATE branch_inventory
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE branch_id = ? AND product_id = ? AND quantity >= ?
                `).bind(item.quantity, Number(branchId), item.productId, item.quantity),
                // Spec 2.1: Write SALE_OUT movement in the same atomic batch
                env.DB.prepare(`
                    INSERT INTO stock_movements (
                        branch_id, product_id, movement_type, quantity, effective_date,
                        source_table, source_id, reason, created_by, created_at
                    ) VALUES (?, ?, 'SALE_OUT', ?, ?, 'sales', ${saleIdSubquery}, ?, ?, CURRENT_TIMESTAMP)
                `).bind(
                    Number(branchId),
                    item.productId,
                    -Math.abs(item.quantity),
                    todayDate,
                    invoiceNo,
                    `POS Sale ${invoiceNo}`,
                    currentUserId
                )
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
            if (err.message.includes("CHECK constraint")) {
                return errorResponse("တောင်းဆိုသော အရေအတွက်အတိုင်း စတော့လက်ကျန် မလုံလောက်ပါ။ ပစ္စည်းတစ်မျိုးမျိုးသည် ရောင်းထွက်သွားပြီ ဖြစ်နိုင်ပါသည်။", 400);
            }
            throw err;
        }
    }

    // POS SALE VOID / CANCEL (SOFT-DELETE WITH FULL ATOMIC REVERSAL, SALE_VOID_IN MOVEMENT & AUDIT LOG)
    if ((path.startsWith("/api/pos/sales/") || path.startsWith("/api/sales/")) && method === "DELETE") {
        requirePermission(auth, "pos.void", "အရောင်းဘောင်ချာ ပယ်ဖျက်ခွင့် (Void) မရှိပါ");

        const saleId = Number(path.split("/").pop());
        if (!saleId) return errorResponse("ဘောင်ချာ ID မမှန်ကန်ပါ", 400);

        const sale = await env.DB.prepare(
            "SELECT id, invoice_no, branch_id, customer_id, final_amount, debt_amount, status FROM sales WHERE id = ?"
        ).bind(saleId).first();

        if (!sale) return errorResponse("အရောင်းဘောင်ချာ ရှာမတွေ့ပါ", 404);
        if (sale.status === "cancelled") {
            return errorResponse("ဤဘောင်ချာသည် ပယ်ဖျက်ထားပြီး ဖြစ်ပါသည်", 400);
        }

        if (currentUserRole === "branch_manager" && Number(sale.branch_id) !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ ဘောင်ချာအား ပယ်ဖျက်ခွင့် မရှိပါ", 403);
        }

        const { results: saleItems } = await env.DB.prepare(
            "SELECT product_id, quantity FROM sale_items WHERE sale_id = ?"
        ).bind(saleId).all();

        const todayDate = getMyanmarTodayDate();
        const batchRollback = [];

        // ၁။ ရောင်းထုတ်ခဲ့သော ပစ္စည်းအရေအတွက်များကို ဆိုင်ခွဲစတော့ထဲသို့ ပြန်ပေါင်းထည့်ခြင်း + SALE_VOID_IN movement
        for (const item of (saleItems || [])) {
            const qty = roundQty(item.quantity);
            batchRollback.push(
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(Number(sale.branch_id), Number(item.product_id), qty),
                createStockMovementStmt(env.DB, {
                    branchId: Number(sale.branch_id),
                    productId: Number(item.product_id),
                    movementType: "SALE_VOID_IN",
                    quantity: qty,
                    effectiveDate: todayDate,
                    sourceTable: "sales",
                    sourceId: saleId,
                    reason: `Voided sale ${sale.invoice_no}`,
                    createdBy: currentUserId
                })
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
                UPDATE sales 
                SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = 'Voided by user'
                WHERE id = ?
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

        return jsonResponse({ message: "အရောင်းဘောင်ချာ ပယ်ဖျက်ပြီး စတော့၊ Movement Ledger၊ ငွေစာရင်းနှင့် အကြွေးစာရင်းများ ပြန်ညှိပြီးပါပြီ" });
    }

    return null;
}
