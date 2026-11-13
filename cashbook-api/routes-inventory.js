// =============================================================================
// FILE 2 OF 5: cashbook-api/routes-inventory.js
// PRODUCTS, BRANCHES, TRANSFERS (STATE MACHINE), WASTE, YARN, OPENING & ADJUSTMENTS
// Version: 4.1.0 (Ledger-Backed Stock Movements, Strict RBAC & Atomic D1 Batch)
// =============================================================================

import {
    jsonResponse,
    errorResponse,
    HttpError,
    getMyanmarTodayDate,
    getMyanmarYearUtcBounds,
    roundKyat,
    roundQty,
    getQueryYear,
    can,
    requirePermission,
    resolveBranchId,
    generateUniqueInvoice,
    createStockMovementStmt,
    logAudit,
    HIGH_VALUE_ADJUSTMENT_THRESHOLD_KYAT
} from "./utils.js";

/**
 * Helper to strip cost_price for Cashiers (Spec 1.3 & 10)
 */
function sanitizeProductForRole(productRow, canViewCost) {
    const clean = {
        ...productRow,
        retail_price: roundKyat(productRow.retail_price || 0),
        wholesale_price: roundKyat(productRow.wholesale_price || 0),
        alert_quantity: roundQty(productRow.alert_quantity ?? 5),
        quantity: roundQty(productRow.quantity || 0),
        stock: roundQty(productRow.quantity || 0)
    };
    if (canViewCost) {
        clean.cost_price = roundKyat(productRow.cost_price || 0);
    } else {
        delete clean.cost_price;
    }
    return clean;
}

export async function handleInventoryRoutes(request, env, url, path, method, auth) {
    const currentUserId = Number(auth.uid);
    const currentUserRole = auth.role;
    const userBranchId = Number(auth.branch_id || 1);
    const canViewCost = can(auth, "product.view_cost");

    // =========================================================================
    // 1. BRANCHES API (Spec Section 1.3)
    // =========================================================================
    if (path === "/api/branches" && method === "GET") {
        // Cashier sees only their own branch (Spec 1.3)
        if (currentUserRole === "cashier") {
            const { results } = await env.DB.prepare(`
                SELECT id, code, name, type, phone, address, is_active
                FROM branches
                WHERE id = ? AND is_active = 1
            `).bind(userBranchId).all();
            return jsonResponse(results || []);
        }

        const { results } = await env.DB.prepare(`
            SELECT id, code, name, type, phone, address, is_active
            FROM branches
            WHERE is_active = 1
            ORDER BY id ASC
        `).all();
        return jsonResponse(results || []);
    }

    // =========================================================================
    // 2. PRODUCTS MASTER & BRANCH INVENTORY (Spec Section 1.3, 5.4, 6.1)
    // =========================================================================
    if (path === "/api/products" && method === "GET") {
        const requestedBranch = url.searchParams.get("branch_id");
        const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const categoryFilter = url.searchParams.get("category");
        const searchFilter = url.searchParams.get("q") || url.searchParams.get("search");
        const includeInactive = url.searchParams.get("include_inactive") === "1" && can(auth, "product.update");

        const whereClauses = [];
        const bindings = [];

        if (!includeInactive) {
            whereClauses.push("p.is_active = 1");
        }
        if (categoryFilter && String(categoryFilter).trim() !== "") {
            whereClauses.push("p.category = ?");
            bindings.push(String(categoryFilter).trim());
        }
        if (searchFilter && String(searchFilter).trim() !== "") {
            const likeTerm = `%${String(searchFilter).trim()}%`;
            whereClauses.push("(p.item_name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.category LIKE ?)");
            bindings.push(likeTerm, likeTerm, likeTerm, likeTerm);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

        let sql = "";
        let queryBindings = [];

        if (resolvedBranch === "ALL") {
            sql = `
                SELECT 
                    p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                    p.product_type, p.cost_price, p.retail_price, p.wholesale_price, p.alert_quantity,
                    p.is_active, p.created_at,
                    COALESCE(SUM(bi.quantity), 0) AS quantity
                FROM products p
                LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                ${whereSql}
                GROUP BY p.id
                ORDER BY p.category ASC, p.item_name ASC, p.id DESC
            `;
            queryBindings = [...bindings];
        } else {
            sql = `
                SELECT 
                    p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                    p.product_type, p.cost_price, p.retail_price, p.wholesale_price, p.alert_quantity,
                    p.is_active, p.created_at,
                    ? AS branch_id,
                    COALESCE(bi.quantity, 0) AS quantity
                FROM products p
                LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                ${whereSql}
                ORDER BY p.category ASC, p.item_name ASC, p.id DESC
            `;
            queryBindings = [Number(resolvedBranch), Number(resolvedBranch), ...bindings];
        }

        const { results } = await env.DB.prepare(sql).bind(...queryBindings).all();
        const sanitized = (results || []).map(r => sanitizeProductForRole(r, canViewCost));
        return jsonResponse(sanitized);
    }

    if (path === "/api/products" && method === "POST") {
        requirePermission(auth, "product.create", "ပစ္စည်းအသစ် ဖန်တီးခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const body = await request.json().catch(() => ({}));
        const category = String(body.category || "").trim();
        const itemName = String(body.item_name ?? body.itemName ?? "").trim();

        if (!category || !itemName) {
            return errorResponse("ပစ္စည်းအမျိုးအစား (category) နှင့် ပစ္စည်းအမည် (item_name) မဖြစ်မနေ လိုအပ်ပါသည်", 400);
        }

        // Spec 5.4: Do not accept initialStock / quantity in product creation
        const rawInitStock = body.initial_stock ?? body.initialStock ?? body.quantity;
        if (rawInitStock !== undefined && rawInitStock !== null && Number(rawInitStock) > 0) {
            return errorResponse(
                "ပစ္စည်းအသစ် ဖန်တီးရာတွင် ကနဦးလက်ကျန် (initialStock / quantity) တိုက်ရိုက်ထည့်သွင်းခွင့် မရှိပါ။ ပစ္စည်းဖန်တီးပြီးနောက် Opening Stock သို့မဟုတ် အဝယ်စာရင်းမှတစ်ဆင့် ထည့်သွင်းပါ။",
                400
            );
        }

        const sku = body.sku && String(body.sku).trim() !== "" ? String(body.sku).trim() : null;
        const barcode = body.barcode && String(body.barcode).trim() !== "" ? String(body.barcode).trim() : null;
        const pattern = body.pattern && String(body.pattern).trim() !== "" ? String(body.pattern).trim() : null;
        const color = body.color && String(body.color).trim() !== "" ? String(body.color).trim() : null;
        const size = body.size && String(body.size).trim() !== "" ? String(body.size).trim() : "ထည်";
        const productType = ["manufactured", "trading"].includes(String(body.product_type ?? body.productType || "").toLowerCase())
            ? String(body.product_type ?? body.productType).toLowerCase()
            : "manufactured";

        const costPrice = roundKyat(body.cost_price ?? body.costPrice ?? 0);
        const retailPrice = roundKyat(body.retail_price ?? body.retailPrice ?? 0);
        const wholesalePrice = roundKyat(body.wholesale_price ?? body.wholesalePrice ?? retailPrice);
        const alertQuantity = roundQty(body.alert_quantity ?? body.alertQuantity ?? 5);

        if (costPrice < 0 || retailPrice < 0 || wholesalePrice < 0 || alertQuantity < 0) {
            return errorResponse("ဈေးနှုန်းနှင့် သတိပေးအရေအတွက်များသည် သုညအောက် မငယ်ရပါ", 400);
        }

        // Check unique SKU / Barcode (Spec 1.3: 409 on duplicate)
        if (sku || barcode) {
            const dup = await env.DB.prepare(`
                SELECT id, sku, barcode FROM products
                WHERE (sku IS NOT NULL AND sku = ?) OR (barcode IS NOT NULL AND barcode = ?)
                LIMIT 1
            `).bind(sku || "__NONE__", barcode || "__NONE__").first();

            if (dup) {
                return errorResponse("SKU သို့မဟုတ် Barcode သည် အခြားပစ္စည်းတစ်ခုတွင် အသုံးပြုထားပြီး ဖြစ်နေပါသည်", 409);
            }
        }

        const res = await env.DB.prepare(`
            INSERT INTO products (
                sku, barcode, category, item_name, pattern, size, color,
                product_type, cost_price, retail_price, wholesale_price, alert_quantity, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(
            sku, barcode, category, itemName, pattern, size, color,
            productType, costPrice, retailPrice, wholesalePrice, alertQuantity
        ).run();

        const newProductId = res.meta.last_row_id;

        await logAudit(env.DB, {
            branchId: userBranchId,
            userId: currentUserId,
            action: "CREATE_PRODUCT",
            tableName: "products",
            recordId: newProductId,
            details: { sku, barcode, category, item_name: itemName, cost_price: costPrice, retail_price: retailPrice }
        });

        return jsonResponse({
            id: newProductId,
            message: "ပစ္စည်း Master အသစ် သိမ်းဆည်းပြီးပါပြီ"
        }, 201);
    }

    if (path.startsWith("/api/products/") && path !== "/api/products/bulk" && method === "PUT") {
        requirePermission(auth, "product.update", "ပစ္စည်းအချက်အလက် ပြင်ဆင်ခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const productId = Number(path.split("/").pop());
        if (!productId) return errorResponse("ပစ္စည်း ID မမှန်ကန်ပါ", 400);

        const body = await request.json().catch(() => ({}));

        // Spec 1.3, 6.1 & 10: Reject quantity / initialStock in Product PUT
        if (body.quantity !== undefined || body.initial_stock !== undefined || body.initialStock !== undefined) {
            return errorResponse(
                "ပစ္စည်းအချက်အလက် ပြင်ဆင်ရာတွင် လက်ကျန်စတော့ (quantity) ကို တိုက်ရိုက်ပြင်ဆင်ခွင့် မရှိပါ။ Stock Adjustment စနစ်ကို အသုံးပြုပါ။",
                400
            );
        }

        const existing = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(productId).first();
        if (!existing) return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);

        const category = String(body.category ?? existing.category ?? "").trim();
        const itemName = String(body.item_name ?? body.itemName ?? existing.item_name ?? "").trim();
        if (!category || !itemName) {
            return errorResponse("ပစ္စည်းအမျိုးအစားနှင့် အမည် မဖြစ်မနေ လိုအပ်ပါသည်", 400);
        }

        const sku = body.sku !== undefined
            ? (body.sku && String(body.sku).trim() !== "" ? String(body.sku).trim() : null)
            : existing.sku;
        const barcode = body.barcode !== undefined
            ? (body.barcode && String(body.barcode).trim() !== "" ? String(body.barcode).trim() : null)
            : existing.barcode;
        const pattern = body.pattern !== undefined
            ? (body.pattern && String(body.pattern).trim() !== "" ? String(body.pattern).trim() : null)
            : existing.pattern;
        const color = body.color !== undefined
            ? (body.color && String(body.color).trim() !== "" ? String(body.color).trim() : null)
            : existing.color;
        const size = body.size !== undefined && String(body.size).trim() !== ""
            ? String(body.size).trim()
            : existing.size;

        const costPrice = (body.cost_price !== undefined || body.costPrice !== undefined)
            ? roundKyat(body.cost_price ?? body.costPrice)
            : roundKyat(existing.cost_price);
        const retailPrice = (body.retail_price !== undefined || body.retailPrice !== undefined)
            ? roundKyat(body.retail_price ?? body.retailPrice)
            : roundKyat(existing.retail_price);
        const wholesalePrice = (body.wholesale_price !== undefined || body.wholesalePrice !== undefined)
            ? roundKyat(body.wholesale_price ?? body.wholesalePrice)
            : roundKyat(existing.wholesale_price);
        const alertQuantity = (body.alert_quantity !== undefined || body.alertQuantity !== undefined)
            ? roundQty(body.alert_quantity ?? body.alertQuantity)
            : roundQty(existing.alert_quantity);

        if (costPrice < 0 || retailPrice < 0 || wholesalePrice < 0 || alertQuantity < 0) {
            return errorResponse("ဈေးနှုန်းနှင့် သတိပေးအရေအတွက်များသည် သုညအောက် မငယ်ရပါ", 400);
        }

        if (sku || barcode) {
            const dup = await env.DB.prepare(`
                SELECT id FROM products
                WHERE ((sku IS NOT NULL AND sku = ?) OR (barcode IS NOT NULL AND barcode = ?))
                  AND id != ?
                LIMIT 1
            `).bind(sku || "__NONE__", barcode || "__NONE__", productId).first();

            if (dup) {
                return errorResponse("SKU သို့မဟုတ် Barcode သည် အခြားပစ္စည်းတစ်ခုတွင် အသုံးပြုထားပြီး ဖြစ်နေပါသည်", 409);
            }
        }

        await env.DB.prepare(`
            UPDATE products SET
                sku = ?, barcode = ?, category = ?, item_name = ?, pattern = ?, size = ?, color = ?,
                cost_price = ?, retail_price = ?, wholesale_price = ?, alert_quantity = ?
            WHERE id = ?
        `).bind(
            sku, barcode, category, itemName, pattern, size, color,
            costPrice, retailPrice, wholesalePrice, alertQuantity, productId
        ).run();

        await logAudit(env.DB, {
            branchId: userBranchId,
            userId: currentUserId,
            action: "UPDATE_PRODUCT",
            tableName: "products",
            recordId: productId,
            details: { sku, item_name: itemName, cost_price: costPrice, retail_price: retailPrice, wholesale_price: wholesalePrice }
        });

        return jsonResponse({ message: "ပစ္စည်းအချက်အလက် ပြင်ဆင်သိမ်းဆည်းပြီးပါပြီ" });
    }

    if (path.startsWith("/api/products/") && method === "DELETE") {
        requirePermission(auth, "product.delete", "ပစ္စည်းဖျက်သိမ်းခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const productId = Number(path.split("/").pop());
        if (!productId) return errorResponse("ပစ္စည်း ID မမှန်ကန်ပါ", 400);

        const existing = await env.DB.prepare("SELECT id, item_name, sku FROM products WHERE id = ?").bind(productId).first();
        if (!existing) return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);

        // Spec 1.3: Always soft delete (is_active = 0)
        await env.DB.prepare("UPDATE products SET is_active = 0 WHERE id = ?").bind(productId).run();

        await logAudit(env.DB, {
            branchId: userBranchId,
            userId: currentUserId,
            action: "SOFT_DELETE_PRODUCT",
            tableName: "products",
            recordId: productId,
            details: { sku: existing.sku, item_name: existing.item_name }
        });

        return jsonResponse({ message: "ပစ္စည်းအား စာရင်းမှ ပိတ်သိမ်း (Soft Delete) ပြီးပါပြီ" });
    }

    if (path === "/api/products/bulk" && method === "POST") {
        requirePermission(auth, "product.bulk_import", "CSV အစုလိုက် သွင်းယူခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const body = await request.json().catch(() => ({}));
        const rows = Array.isArray(body.items) ? body.items : (Array.isArray(body.products) ? body.products : []);
        if (rows.length === 0) {
            return errorResponse("သွင်းယူမည့် ပစ္စည်းစာရင်း မပါဝင်ပါ", 400);
        }
        if (rows.length > 500) {
            return errorResponse("တစ်ကြိမ်လျှင် ပစ္စည်း အမျိုးအစား ၅၀၀ အထိသာ သွင်းယူနိုင်ပါသည်", 400);
        }

        const batch = [];
        for (const r of rows) {
            const category = String(r.category || "").trim();
            const itemName = String(r.item_name ?? r.itemName ?? "").trim();
            if (!category || !itemName) continue;

            const sku = r.sku && String(r.sku).trim() !== "" ? String(r.sku).trim() : null;
            const barcode = r.barcode && String(r.barcode).trim() !== "" ? String(r.barcode).trim() : null;
            const pattern = r.pattern && String(r.pattern).trim() !== "" ? String(r.pattern).trim() : null;
            const color = r.color && String(r.color).trim() !== "" ? String(r.color).trim() : null;
            const size = r.size && String(r.size).trim() !== "" ? String(r.size).trim() : "ထည်";
            const costPrice = Math.max(0, roundKyat(r.cost_price ?? r.costPrice ?? 0));
            const retailPrice = Math.max(0, roundKyat(r.retail_price ?? r.retailPrice ?? 0));
            const wholesalePrice = Math.max(0, roundKyat(r.wholesale_price ?? r.wholesalePrice ?? retailPrice));
            const alertQuantity = Math.max(0, roundQty(r.alert_quantity ?? r.alertQuantity ?? 5));

            if (sku) {
                batch.push(
                    env.DB.prepare(`
                        INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price, alert_quantity, is_active)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                        ON CONFLICT(sku) DO UPDATE SET
                            category = excluded.category,
                            item_name = excluded.item_name,
                            pattern = COALESCE(excluded.pattern, products.pattern),
                            size = excluded.size,
                            color = COALESCE(excluded.color, products.color),
                            cost_price = excluded.cost_price,
                            retail_price = excluded.retail_price,
                            wholesale_price = excluded.wholesale_price,
                            is_active = 1
                    `).bind(sku, barcode, category, itemName, pattern, size, color, costPrice, retailPrice, wholesalePrice, alertQuantity)
                );
            } else {
                batch.push(
                    env.DB.prepare(`
                        INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price, alert_quantity, is_active)
                        VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    `).bind(barcode, category, itemName, pattern, size, color, costPrice, retailPrice, wholesalePrice, alertQuantity)
                );
            }
        }

        if (batch.length === 0) {
            return errorResponse("မှန်ကန်သော ပစ္စည်းအချက်အလက် မတွေ့ရှိပါ", 400);
        }

        await env.DB.batch(batch);

        await logAudit(env.DB, {
            branchId: userBranchId,
            userId: currentUserId,
            action: "BULK_IMPORT_PRODUCTS",
            tableName: "products",
            recordId: null,
            details: { imported_count: batch.length }
        });

        return jsonResponse({
            importedCount: batch.length,
            message: `ပစ္စည်း Master (${batch.length}) မျိုး အောင်မြင်စွာ သွင်းယူပြီးပါပြီ`
        }, 201);
    }

    // =========================================================================
    // 3. BRANCH TRANSFERS — STATE MACHINE (Spec Section 1.3 & 4.3)
    // pending ──► dispatched (TRANSFER_OUT) ──► received (TRANSFER_IN) ──► completed
    //   │             │
    //   └──► cancelled ◄┘ (If dispatched, reversal TRANSFER_IN to from_branch)
    // =========================================================================
    if (path === "/api/transfers" && method === "GET") {
        requirePermission(auth, "transfer.view");

        const requestedBranch = url.searchParams.get("branch_id");
        const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const statusFilter = url.searchParams.get("status");
        const year = getQueryYear(url);
        const { startUtc, endUtc } = getMyanmarYearUtcBounds(year);

        const whereClauses = ["t.created_at >= ? AND t.created_at <= ?"];
        const bindings = [startUtc, endUtc];

        if (resolvedBranch !== "ALL") {
            // Spec 4.3: Both sending and receiving branch managers/staff see the transfer
            whereClauses.push("(t.from_branch_id = ? OR t.to_branch_id = ?)");
            bindings.push(Number(resolvedBranch), Number(resolvedBranch));
        }

        if (statusFilter && String(statusFilter).trim() !== "") {
            whereClauses.push("t.status = ?");
            bindings.push(String(statusFilter).trim().toLowerCase());
        }

        const sql = `
            SELECT 
                t.id, t.transfer_no, t.from_branch_id, t.to_branch_id,
                fb.name AS from_branch_name, fb.code AS from_branch_code,
                tb.name AS to_branch_name, tb.code AS to_branch_code,
                t.product_id, p.sku, p.category, p.item_name, p.color, p.size,
                t.quantity, t.status, t.notes,
                t.created_by, cu.full_name AS created_by_name,
                t.dispatched_by, t.dispatched_at,
                t.received_by, t.received_at,
                t.cancelled_by, t.cancelled_at, t.cancel_reason,
                t.created_at
            FROM stock_transfers t
            JOIN branches fb ON t.from_branch_id = fb.id
            JOIN branches tb ON t.to_branch_id = tb.id
            JOIN products p ON t.product_id = p.id
            LEFT JOIN users cu ON t.created_by = cu.id
            WHERE ${whereClauses.join(" AND ")}
            ORDER BY t.id DESC
            LIMIT 1000
        `;

        const { results } = await env.DB.prepare(sql).bind(...bindings).all();
        return jsonResponse(results || []);
    }

    if (path === "/api/transfers" && method === "POST") {
        requirePermission(auth, "transfer.create", "ဆိုင်ခွဲလွှဲပြောင်းမှု ဖန်တီးခွင့် မရှိပါ");

        const body = await request.json().catch(() => ({}));
        const fromBranchId = resolveBranchId(
            auth,
            body.from_branch_id ?? body.fromBranchId ?? body.branch_id ?? body.branchId,
            { isWrite: true, strictStaffCheck: true }
        );
        const toBranchId = Number(body.to_branch_id ?? body.toBranchId);
        const productId = Number(body.product_id ?? body.productId);
        const quantity = roundQty(body.quantity);
        const notes = body.notes ? String(body.notes).trim() : null;

        if (!toBranchId || toBranchId <= 0 || fromBranchId === toBranchId) {
            return errorResponse("ပေးပို့မည့်ဆိုင်ခွဲနှင့် လက်ခံမည့်ဆိုင်ခွဲ မတူညီရပါ", 400);
        }
        if (!productId || quantity <= 0) {
            return errorResponse("ပစ္စည်းနှင့် လွှဲပြောင်းမည့် အရေအတွက် မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
        }

        const [destBranch, stockRow] = await env.DB.batch([
            env.DB.prepare("SELECT id, name FROM branches WHERE id = ? AND is_active = 1").bind(toBranchId),
            env.DB.prepare(`
                SELECT p.id, p.item_name, COALESCE(bi.quantity, 0) AS current_stock
                FROM products p
                LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                WHERE p.id = ? AND p.is_active = 1
            `).bind(fromBranchId, productId)
        ]);

        if (!(destBranch.results || [])[0]) {
            return errorResponse("လက်ခံမည့် ဆိုင်ခွဲ ရှာမတွေ့ပါ", 404);
        }
        const prod = (stockRow.results || [])[0];
        if (!prod) {
            return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);
        }
        if (Number(prod.current_stock) < quantity) {
            return errorResponse(`"${prod.item_name}" လက်ကျန်စတော့ (${prod.current_stock}) မလုံလောက်ပါ`, 400);
        }

        const transferNo = await generateUniqueInvoice(env.DB, "TRF", fromBranchId);

        const res = await env.DB.prepare(`
            INSERT INTO stock_transfers (
                transfer_no, from_branch_id, to_branch_id, product_id, quantity, status, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        `).bind(transferNo, fromBranchId, toBranchId, productId, quantity, notes, currentUserId).run();

        const transferId = res.meta.last_row_id;

        await logAudit(env.DB, {
            branchId: fromBranchId,
            userId: currentUserId,
            action: "CREATE_TRANSFER_PENDING",
            tableName: "stock_transfers",
            recordId: transferId,
            details: { transfer_no: transferNo, from_branch_id: fromBranchId, to_branch_id: toBranchId, product_id: productId, quantity }
        });

        return jsonResponse({
            id: transferId,
            transfer_no: transferNo,
            status: "pending",
            message: "ဆိုင်ခွဲလွှဲပြောင်းစာရင်း (Pending) စတင်ဖန်တီးပြီးပါပြီ။ ပစ္စည်းပို့ဆောင်ချိန်တွင် Dispatch နှိပ်ပါ။"
        }, 201);
    }

    // Unified Transfer State Transitions: PUT /api/transfers/:id or POST /api/transfers/:id/(dispatch|receive|complete|cancel)
    if (path.startsWith("/api/transfers/") && (method === "PUT" || method === "POST" || method === "DELETE")) {
        const parts = path.split("/").filter(Boolean); // ["api", "transfers", ":id", optionalAction]
        const transferId = Number(parts[2]);
        const subAction = parts[3] ? parts[3].toLowerCase() : null;

        if (!transferId) return errorResponse("လွှဲပြောင်းမှတ်တမ်း ID မမှန်ကန်ပါ", 400);

        const body = method !== "DELETE" ? await request.json().catch(() => ({})) : {};
        const requestedAction = (
            subAction ||
            (method === "DELETE" ? "cancel" : String(body.action || body.status || "").trim().toLowerCase())
        );

        const trf = await env.DB.prepare("SELECT * FROM stock_transfers WHERE id = ?").bind(transferId).first();
        if (!trf) return errorResponse("ဆိုင်ခွဲလွှဲပြောင်းမှတ်တမ်း ရှာမတွေ့ပါ", 404);

        const today = getMyanmarTodayDate();

        // Transition 1: pending -> dispatched (Deducts from_branch stock + writes TRANSFER_OUT)
        if (requestedAction === "dispatch" || requestedAction === "dispatched") {
            requirePermission(auth, "transfer.dispatch", "ပစ္စည်းပို့ဆောင်အတည်ပြုခွင့် (Dispatch) မရှိပါ");

            if (currentUserRole === "branch_manager" && Number(trf.from_branch_id) !== userBranchId) {
                return errorResponse("ပေးပို့သည့် ဆိုင်ခွဲ၏ မန်နေဂျာမှသာ Dispatch ပြုလုပ်နိုင်ပါသည်", 403);
            }
            if (trf.status !== "pending") {
                return errorResponse(`လက်ရှိအခြေအနေ (${trf.status}) မှ Dispatch ပြုလုပ်၍ မရပါ`, 400);
            }

            const stockCheck = await env.DB.prepare(
                "SELECT COALESCE(quantity, 0) AS qty FROM branch_inventory WHERE branch_id = ? AND product_id = ?"
            ).bind(Number(trf.from_branch_id), Number(trf.product_id)).first();

            if (!stockCheck || Number(stockCheck.qty) < Number(trf.quantity)) {
                return errorResponse(`ထွက်ဆိုင်တွင် လက်ကျန်စတော့ (${stockCheck?.qty || 0}) မလုံလောက်ပါ`, 400);
            }

            const batchRes = await env.DB.batch([
                env.DB.prepare(`
                    UPDATE stock_transfers
                    SET status = 'dispatched', dispatched_by = ?, dispatched_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status = 'pending'
                `).bind(currentUserId, transferId),
                env.DB.prepare(`
                    UPDATE branch_inventory
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE branch_id = ? AND product_id = ? AND quantity >= ?
                `).bind(roundQty(trf.quantity), Number(trf.from_branch_id), Number(trf.product_id), roundQty(trf.quantity)),
                createStockMovementStmt(env.DB, {
                    branchId: Number(trf.from_branch_id),
                    productId: Number(trf.product_id),
                    movementType: "TRANSFER_OUT",
                    quantity: roundQty(trf.quantity),
                    effectiveDate: today,
                    sourceTable: "stock_transfers",
                    sourceId: transferId,
                    reason: `Transfer ${trf.transfer_no} dispatched to branch #${trf.to_branch_id}`,
                    createdBy: currentUserId
                })
            ]);

            if (!batchRes[0]?.meta?.changes) {
                return errorResponse("ဤလွှဲပြောင်းမှတ်တမ်းသည် အခြေအနေ ပြောင်းလဲသွားပြီ ဖြစ်ပါသည်", 409);
            }

            return jsonResponse({
                id: transferId,
                status: "dispatched",
                message: "ပစ္စည်းပို့ဆောင်မှု (Dispatched) မှတ်တမ်းတင်ပြီး ထွက်ဆိုင်စတော့မှ နုတ်ယူပြီးပါပြီ"
            });
        }

        // Transition 2: dispatched -> received (Adds to_branch stock + writes TRANSFER_IN)
        if (requestedAction === "receive" || requestedAction === "received") {
            requirePermission(auth, "transfer.receive", "လွှဲပြောင်းပစ္စည်း လက်ခံခွင့် မရှိပါ");

            if ((currentUserRole === "branch_manager" || currentUserRole === "cashier") && Number(trf.to_branch_id) !== userBranchId) {
                return errorResponse("လက်ခံမည့် ဆိုင်ခွဲမှ ဝန်ထမ်းသာ ပစ္စည်းလက်ခံအတည်ပြုနိုင်ပါသည်", 403);
            }
            if (trf.status !== "dispatched") {
                return errorResponse(`ပစ္စည်းလက်ခံရန် Dispatched အခြေအနေ ဖြစ်ရပါမည် (လက်ရှိ: ${trf.status})`, 400);
            }

            const batchRes = await env.DB.batch([
                env.DB.prepare(`
                    UPDATE stock_transfers
                    SET status = 'received', received_by = ?, received_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status = 'dispatched'
                `).bind(currentUserId, transferId),
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity)
                    VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET
                        quantity = branch_inventory.quantity + excluded.quantity,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(Number(trf.to_branch_id), Number(trf.product_id), roundQty(trf.quantity)),
                createStockMovementStmt(env.DB, {
                    branchId: Number(trf.to_branch_id),
                    productId: Number(trf.product_id),
                    movementType: "TRANSFER_IN",
                    quantity: roundQty(trf.quantity),
                    effectiveDate: today,
                    sourceTable: "stock_transfers",
                    sourceId: transferId,
                    reason: `Transfer ${trf.transfer_no} received from branch #${trf.from_branch_id}`,
                    createdBy: currentUserId
                })
            ]);

            if (!batchRes[0]?.meta?.changes) {
                return errorResponse("ဤလွှဲပြောင်းမှတ်တမ်းသည် အခြေအနေ ပြောင်းလဲသွားပြီ ဖြစ်ပါသည်", 409);
            }

            return jsonResponse({
                id: transferId,
                status: "received",
                message: "လွှဲပြောင်းပစ္စည်း လက်ခံရရှိပြီး ဝင်ဆိုင်စတော့သို့ ပေါင်းထည့်ပြီးပါပြီ"
            });
        }

        // Transition 3: received -> completed
        if (requestedAction === "complete" || requestedAction === "completed") {
            requirePermission(auth, "transfer.receive");
            if (trf.status !== "received") {
                return errorResponse("Completed သတ်မှတ်ရန် ပစ္စည်းလက်ခံပြီး (received) ဖြစ်ရပါမည်", 400);
            }
            await env.DB.prepare("UPDATE stock_transfers SET status = 'completed' WHERE id = ? AND status = 'received'")
                .bind(transferId).run();
            return jsonResponse({ id: transferId, status: "completed", message: "လွှဲပြောင်းမှု လုပ်ငန်းစဉ် ပြီးဆုံးပါပြီ" });
        }

        // Transition 4: pending / dispatched -> cancelled (Spec 4.3: Reverses stock if dispatched)
        if (requestedAction === "cancel" || requestedAction === "cancelled") {
            requirePermission(auth, "transfer.cancel", "လွှဲပြောင်းမှု ပယ်ဖျက်ခွင့် မရှိပါ");

            if (currentUserRole === "branch_manager" && Number(trf.from_branch_id) !== userBranchId && Number(trf.to_branch_id) !== userBranchId) {
                return errorResponse("အခြားဆိုင်ခွဲ၏ လွှဲပြောင်းမှုအား ပယ်ဖျက်ခွင့် မရှိပါ", 403);
            }
            if (trf.status !== "pending" && trf.status !== "dispatched") {
                return errorResponse(`လက်ခံပြီးသား (${trf.status}) လွှဲပြောင်းမှုအား ပယ်ဖျက်၍ မရနိုင်ပါ`, 400);
            }

            const cancelReason = body.reason || body.cancel_reason || "Cancelled by user";

            if (trf.status === "pending") {
                await env.DB.prepare(`
                    UPDATE stock_transfers
                    SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?
                    WHERE id = ? AND status = 'pending'
                `).bind(currentUserId, String(cancelReason).trim(), transferId).run();

                return jsonResponse({ id: transferId, status: "cancelled", message: "Pending လွှဲပြောင်းမှုကို ပယ်ဖျက်ပြီးပါပြီ" });
            }

            // If status was 'dispatched', restore stock to from_branch_id with TRANSFER_IN reversal
            const batchRes = await env.DB.batch([
                env.DB.prepare(`
                    UPDATE stock_transfers
                    SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?
                    WHERE id = ? AND status = 'dispatched'
                `).bind(currentUserId, String(cancelReason).trim(), transferId),
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity)
                    VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET
                        quantity = branch_inventory.quantity + excluded.quantity,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(Number(trf.from_branch_id), Number(trf.product_id), roundQty(trf.quantity)),
                createStockMovementStmt(env.DB, {
                    branchId: Number(trf.from_branch_id),
                    productId: Number(trf.product_id),
                    movementType: "TRANSFER_IN",
                    quantity: roundQty(trf.quantity),
                    effectiveDate: today,
                    sourceTable: "stock_transfers",
                    sourceId: transferId,
                    reason: `Reversal for cancelled dispatched transfer ${trf.transfer_no}: ${cancelReason}`,
                    createdBy: currentUserId
                })
            ]);

            if (!batchRes[0]?.meta?.changes) {
                return errorResponse("ဤလွှဲပြောင်းမှတ်တမ်းသည် အခြေအနေ ပြောင်းလဲသွားပြီ ဖြစ်ပါသည်", 409);
            }

            return jsonResponse({
                id: transferId,
                status: "cancelled",
                message: "Dispatched လွှဲပြောင်းမှုကို ပယ်ဖျက်ပြီး ထွက်ဆိုင်သို့ စတော့ ပြန်လည်ပေါင်းထည့်ပေးပြီးပါပြီ"
            });
        }

        return errorResponse("Transfer action မမှန်ကန်ပါ (dispatch / receive / complete / cancel သာ ခွင့်ပြုပါသည်)", 400);
    }

    // =========================================================================
    // 4. WASTE LOGS API (Spec Section 1.3 & 2.1)
    // =========================================================================
    if (path === "/api/waste" && method === "GET") {
        const requestedBranch = url.searchParams.get("branch_id");
        const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const year = getQueryYear(url);
        const { startUtc, endUtc } = getMyanmarYearUtcBounds(year);

        let sql = `
            SELECT 
                w.id, w.reference_no, w.branch_id, b.name AS branch_name,
                w.product_id, p.sku, p.category, p.item_name, p.color, p.size,
                w.quantity, w.unit_cost, (w.quantity * w.unit_cost) AS total_loss,
                w.reason, w.status, w.recorded_by, u.full_name AS recorded_by_name, w.created_at
            FROM waste_logs w
            JOIN branches b ON w.branch_id = b.id
            JOIN products p ON w.product_id = p.id
            LEFT JOIN users u ON w.recorded_by = u.id
            WHERE w.created_at >= ? AND w.created_at <= ?
              AND COALESCE(w.status, 'completed') != 'cancelled'
        `;
        const bindings = [startUtc, endUtc];

        if (resolvedBranch !== "ALL") {
            sql += " AND w.branch_id = ?";
            bindings.push(Number(resolvedBranch));
        }
        sql += " ORDER BY w.id DESC LIMIT 1000";

        const { results } = await env.DB.prepare(sql).bind(...bindings).all();
        return jsonResponse(results || []);
    }

    if (path === "/api/waste" && method === "POST") {
        requirePermission(auth, "waste.create", "အလေအလွင့်/ပျက်စီးစာရင်း သွင်းခွင့် မရှိပါ");

        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branch_id ?? body.branchId, { isWrite: true, strictStaffCheck: true });
        const productId = Number(body.product_id ?? body.productId);
        const quantity = roundQty(body.quantity);
        const reason = String(body.reason || "").trim();

        if (!productId || quantity <= 0 || !reason) {
            return errorResponse("ပစ္စည်း၊ အရေအတွက်နှင့် ပျက်စီးရသည့် အကြောင်းရင်း လိုအပ်ပါသည်", 400);
        }

        const prod = await env.DB.prepare(`
            SELECT p.id, p.item_name, p.cost_price, COALESCE(bi.quantity, 0) AS current_stock
            FROM products p
            LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
            WHERE p.id = ? AND p.is_active = 1
        `).bind(branchId, productId).first();

        if (!prod) return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);
        if (Number(prod.current_stock) < quantity) {
            return errorResponse(`"${prod.item_name}" လက်ကျန်စတော့ (${prod.current_stock}) မလုံလောက်ပါ`, 400);
        }

        const refNo = await generateUniqueInvoice(env.DB, "WST", branchId);
        const unitCost = roundKyat(prod.cost_price || 0);
        const today = getMyanmarTodayDate();

        const wasteInsert = await env.DB.prepare(`
            INSERT INTO waste_logs (reference_no, branch_id, product_id, quantity, unit_cost, reason, status, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
        `).bind(refNo, branchId, productId, quantity, unitCost, reason, currentUserId).run();

        const wasteId = wasteInsert.meta.last_row_id;

        try {
            await env.DB.batch([
                env.DB.prepare(`
                    UPDATE branch_inventory
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE branch_id = ? AND product_id = ? AND quantity >= ?
                `).bind(quantity, branchId, productId, quantity),
                createStockMovementStmt(env.DB, {
                    branchId,
                    productId,
                    movementType: "WASTE_OUT",
                    quantity,
                    effectiveDate: today,
                    sourceTable: "waste_logs",
                    sourceId: wasteId,
                    reason,
                    createdBy: currentUserId
                })
            ]);
        } catch (err) {
            await env.DB.prepare("DELETE FROM waste_logs WHERE id = ?").bind(wasteId).run().catch(() => {});
            throw err;
        }

        return jsonResponse({
            id: wasteId,
            reference_no: refNo,
            message: "အလေအလွင့်စာရင်း မှတ်တမ်းတင်ပြီး စတော့မှ နုတ်ယူပြီးပါပြီ"
        }, 201);
    }

    if (path.startsWith("/api/waste/") && method === "DELETE") {
        requirePermission(auth, "waste.delete", "အလေအလွင့်မှတ်တမ်း ပယ်ဖျက်ခွင့် မရှိပါ");

        const wasteId = Number(path.split("/").pop());
        if (!wasteId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const waste = await env.DB.prepare("SELECT * FROM waste_logs WHERE id = ?").bind(wasteId).first();
        if (!waste || waste.status === "cancelled") {
            return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ သို့မဟုတ် ပယ်ဖျက်ထားပြီး ဖြစ်ပါသည်", 404);
        }

        if (currentUserRole === "branch_manager" && Number(waste.branch_id) !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ မှတ်တမ်းအား ပယ်ဖျက်ခွင့် မရှိပါ", 403);
        }

        await env.DB.batch([
            env.DB.prepare("UPDATE waste_logs SET status = 'cancelled' WHERE id = ?").bind(wasteId),
            env.DB.prepare(`
                INSERT INTO branch_inventory (branch_id, product_id, quantity)
                VALUES (?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET
                    quantity = branch_inventory.quantity + excluded.quantity,
                    updated_at = CURRENT_TIMESTAMP
            `).bind(Number(waste.branch_id), Number(waste.product_id), roundQty(waste.quantity)),
            createStockMovementStmt(env.DB, {
                branchId: Number(waste.branch_id),
                productId: Number(waste.product_id),
                movementType: "ADJUSTMENT_IN",
                quantity: roundQty(waste.quantity),
                effectiveDate: getMyanmarTodayDate(),
                sourceTable: "waste_logs",
                sourceId: wasteId,
                reason: `Reversal of cancelled waste log ${waste.reference_no}`,
                createdBy: currentUserId
            })
        ]);

        return jsonResponse({ message: "အလေအလွင့်မှတ်တမ်း ပယ်ဖျက်ပြီး စတော့ ပြန်လည်ပေါင်းထည့်ပြီးပါပြီ" });
    }

    // =========================================================================
    // 5. YARN INVENTORY & WEAVER ISSUE / RETURN (Spec Section 1.3 & 9.13)
    // =========================================================================
    if (path === "/api/yarns" && method === "GET") {
        requirePermission(auth, "yarn.view");

        const requestedBranch = url.searchParams.get("branch_id");
        const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const branchNum = resolvedBranch === "ALL" ? null : Number(resolvedBranch);

        const yarnSql = branchNum
            ? `
                SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.color, p.size,
                       p.cost_price, p.alert_quantity, COALESCE(bi.quantity, 0) AS quantity
                FROM products p
                LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                WHERE p.is_active = 1 AND (p.category = 'ချည်' OR p.category LIKE 'ချည်%')
                ORDER BY p.item_name ASC
            `
            : `
                SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.color, p.size,
                       p.cost_price, p.alert_quantity, COALESCE(SUM(bi.quantity), 0) AS quantity
                FROM products p
                LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                WHERE p.is_active = 1 AND (p.category = 'ချည်' OR p.category LIKE 'ချည်%')
                GROUP BY p.id
                ORDER BY p.item_name ASC
            `;

        const issueSql = branchNum
            ? `
                SELECT yi.*, p.item_name AS yarn_name, p.color AS yarn_color, p.size AS unit
                FROM yarn_issues yi
                JOIN products p ON yi.yarn_id = p.id
                WHERE yi.branch_id = ? AND COALESCE(yi.status, 'completed') != 'cancelled'
                ORDER BY yi.id DESC LIMIT 300
            `
            : `
                SELECT yi.*, p.item_name AS yarn_name, p.color AS yarn_color, p.size AS unit
                FROM yarn_issues yi
                JOIN products p ON yi.yarn_id = p.id
                WHERE COALESCE(yi.status, 'completed') != 'cancelled'
                ORDER BY yi.id DESC LIMIT 300
            `;

        const [yarnsRes, issuesRes] = await env.DB.batch([
            branchNum ? env.DB.prepare(yarnSql).bind(branchNum) : env.DB.prepare(yarnSql),
            branchNum ? env.DB.prepare(issueSql).bind(branchNum) : env.DB.prepare(issueSql)
        ]);

        return jsonResponse({
            yarns: (yarnsRes.results || []).map(y => sanitizeProductForRole(y, canViewCost)),
            issues: issuesRes.results || []
        });
    }

    if (path === "/api/yarns/issue" && method === "POST") {
        requirePermission(auth, "yarn.issue", "ရက်ကန်းသို့ ချည်ထုတ်ပေးခွင့် မရှိပါ");

        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branch_id ?? body.branchId, { isWrite: true, strictStaffCheck: true });
        const yarnId = Number(body.yarn_id ?? body.yarnId ?? body.product_id ?? body.productId);
        const weaverName = String(body.weaver_name ?? body.weaverName ?? "").trim();
        const quantity = roundQty(body.quantity);
        const issueType = String(body.issue_type ?? body.issueType ?? "ISSUE").toUpperCase() === "RETURN" ? "RETURN" : "ISSUE";
        const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.issue_date || "").trim())
            ? String(body.issue_date).trim()
            : getMyanmarTodayDate();
        const notes = body.notes ? String(body.notes).trim() : null;

        if (!yarnId || !weaverName || quantity <= 0) {
            return errorResponse("ချည်အမျိုးအစား၊ ရက်ကန်းသမားအမည်နှင့် အရေအတွက် လိုအပ်ပါသည်", 400);
        }

        const yarnProd = await env.DB.prepare(`
            SELECT p.id, p.item_name, COALESCE(bi.quantity, 0) AS current_stock
            FROM products p
            LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
            WHERE p.id = ? AND p.is_active = 1
        `).bind(branchId, yarnId).first();

        if (!yarnProd) return errorResponse("ချည်ပစ္စည်း ရှာမတွေ့ပါ", 404);
        if (issueType === "ISSUE" && Number(yarnProd.current_stock) < quantity) {
            return errorResponse(`"${yarnProd.item_name}" လက်ကျန် (${yarnProd.current_stock}) မလုံလောက်ပါ`, 400);
        }

        const refNo = await generateUniqueInvoice(env.DB, "YRN", branchId);
        const insRes = await env.DB.prepare(`
            INSERT INTO yarn_issues (reference_no, branch_id, yarn_id, weaver_name, issue_type, quantity, issue_date, notes, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
        `).bind(refNo, branchId, yarnId, weaverName, issueType, quantity, issueDate, notes, currentUserId).run();

        const issueId = insRes.meta.last_row_id;

        try {
            const invStmt = issueType === "ISSUE"
                ? env.DB.prepare(`
                    UPDATE branch_inventory
                    SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE branch_id = ? AND product_id = ? AND quantity >= ?
                `).bind(quantity, branchId, yarnId, quantity)
                : env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity)
                    VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET
                        quantity = branch_inventory.quantity + excluded.quantity,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(branchId, yarnId, quantity);

            await env.DB.batch([
                invStmt,
                createStockMovementStmt(env.DB, {
                    branchId,
                    productId: yarnId,
                    movementType: issueType === "ISSUE" ? "YARN_ISSUE_OUT" : "YARN_RETURN_IN",
                    quantity,
                    effectiveDate: issueDate,
                    sourceTable: "yarn_issues",
                    sourceId: issueId,
                    reason: `${issueType === "ISSUE" ? "Issued to" : "Returned from"} weaver: ${weaverName}`,
                    createdBy: currentUserId
                })
            ]);
        } catch (err) {
            await env.DB.prepare("DELETE FROM yarn_issues WHERE id = ?").bind(issueId).run().catch(() => {});
            throw err;
        }

        return jsonResponse({
            id: issueId,
            reference_no: refNo,
            message: issueType === "ISSUE"
                ? "ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု မှတ်တမ်းတင်ပြီး စတော့နုတ်ယူပြီးပါပြီ"
                : "ချည်အပို ပြန်အပ်နှံမှု မှတ်တမ်းတင်ပြီး စတော့ပေါင်းထည့်ပြီးပါပြီ"
        }, 201);
    }

    // =========================================================================
    // 6. OPENING STOCK WORKFLOW API (Spec Section 5)
    // =========================================================================
    if (path === "/api/opening-stock" && method === "GET") {
        requirePermission(auth, "opening.view", "Opening Stock ကြည့်ရှုခွင့် မရှိပါ");

        const requestedBranch = url.searchParams.get("branch_id");
        const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const statusFilter = url.searchParams.get("status");

        const whereClauses = [];
        const bindings = [];

        if (resolvedBranch !== "ALL") {
            whereClauses.push("osc.branch_id = ?");
            bindings.push(Number(resolvedBranch));
        }
        if (statusFilter && String(statusFilter).trim() !== "") {
            whereClauses.push("osc.status = ?");
            bindings.push(String(statusFilter).trim().toLowerCase());
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

        const { results } = await env.DB.prepare(`
            SELECT 
                osc.*,
                b.name AS branch_name, b.code AS branch_code,
                cu.full_name AS created_by_name,
                du.full_name AS decided_by_name,
                (SELECT COUNT(id) FROM opening_stock_items osi WHERE osi.count_id = osc.id) AS item_count,
                (SELECT COALESCE(SUM(quantity), 0) FROM opening_stock_items osi WHERE osi.count_id = osc.id) AS total_quantity
            FROM opening_stock_counts osc
            JOIN branches b ON osc.branch_id = b.id
            LEFT JOIN users cu ON osc.created_by = cu.id
            LEFT JOIN users du ON osc.decided_by = du.id
            ${whereSql}
            ORDER BY osc.id DESC
        `).bind(...bindings).all();

        return jsonResponse(results || []);
    }

    if (path.startsWith("/api/opening-stock/") && path.split("/").filter(Boolean).length === 3 && method === "GET") {
        requirePermission(auth, "opening.view");
        const countId = Number(path.split("/").pop());
        if (!countId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const header = await env.DB.prepare(`
            SELECT osc.*, b.name AS branch_name, b.code AS branch_code,
                   cu.full_name AS created_by_name, du.full_name AS decided_by_name
            FROM opening_stock_counts osc
            JOIN branches b ON osc.branch_id = b.id
            LEFT JOIN users cu ON osc.created_by = cu.id
            LEFT JOIN users du ON osc.decided_by = du.id
            WHERE osc.id = ?
        `).bind(countId).first();

        if (!header) return errorResponse("Opening Stock စာရွက် ရှာမတွေ့ပါ", 404);
        if (currentUserRole === "branch_manager" && Number(header.branch_id) !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ Opening Stock အား ကြည့်ရှုခွင့် မရှိပါ", 403);
        }

        const { results: items } = await env.DB.prepare(`
            SELECT osi.id, osi.product_id, osi.quantity,
                   p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color, p.cost_price
            FROM opening_stock_items osi
            JOIN products p ON osi.product_id = p.id
            WHERE osi.count_id = ?
            ORDER BY p.category ASC, p.item_name ASC
        `).bind(countId).all();

        return jsonResponse({ ...header, items: items || [] });
    }

    if (path === "/api/opening-stock" && method === "POST") {
        requirePermission(auth, "opening.create", "Opening Stock Draft ဖန်တီးခွင့် မရှိပါ");

        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branch_id ?? body.branchId, { isWrite: true, strictStaffCheck: true });
        const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.as_of_date ?? body.asOfDate ?? "").trim())
            ? String(body.as_of_date ?? body.asOfDate).trim()
            : getMyanmarTodayDate();
        const notes = body.notes ? String(body.notes).trim() : null;

        // Spec 5.4: Only one approved opening stock allowed per branch, and cannot create opening if movements already exist
        const [approvedCheck, existingMovementsCheck] = await env.DB.batch([
            env.DB.prepare("SELECT id FROM opening_stock_counts WHERE branch_id = ? AND status = 'approved' LIMIT 1").bind(branchId),
            env.DB.prepare("SELECT id FROM stock_movements WHERE branch_id = ? LIMIT 1").bind(branchId)
        ]);

        if ((approvedCheck.results || [])[0]) {
            return errorResponse("ဤဆိုင်ခွဲအတွက် အတည်ပြုပြီးသား Opening Stock ရှိနေပြီဖြစ်သဖြင့် ထပ်မံဖန်တီး၍ မရပါ။ Stock Adjustment စနစ်ကို သုံးပါ။", 409);
        }
        if ((existingMovementsCheck.results || [])[0]) {
            return errorResponse("ဤဆိုင်ခွဲတွင် စတော့အဝင်/အထွက် မှတ်တမ်းများ ရှိနေပြီဖြစ်သဖြင့် Opening Stock အသစ်သွင်း၍ မရတော့ပါ။ Stock Adjustment စနစ်ကို သုံးပါ။", 400);
        }

        const res = await env.DB.prepare(`
            INSERT INTO opening_stock_counts (branch_id, status, as_of_date, created_by, notes)
            VALUES (?, 'draft', ?, ?, ?)
        `).bind(branchId, asOfDate, currentUserId, notes).run();

        const countId = res.meta.last_row_id;
        const items = Array.isArray(body.items) ? body.items : [];

        if (items.length > 0) {
            const itemStmts = [];
            for (const it of items) {
                const pid = Number(it.product_id ?? it.productId);
                const qty = roundQty(it.quantity);
                if (!pid || qty < 0) {
                    await env.DB.prepare("DELETE FROM opening_stock_counts WHERE id = ?").bind(countId).run();
                    return errorResponse("ပစ္စည်း ID နှင့် အရေအတွက် (>= 0) မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
                }
                itemStmts.push(
                    env.DB.prepare(`
                        INSERT INTO opening_stock_items (count_id, product_id, quantity)
                        VALUES (?, ?, ?)
                        ON CONFLICT(count_id, product_id) DO UPDATE SET quantity = excluded.quantity
                    `).bind(countId, pid, qty)
                );
            }
            await env.DB.batch(itemStmts);
        }

        return jsonResponse({
            id: countId,
            branch_id: branchId,
            status: "draft",
            as_of_date: asOfDate,
            message: "Opening Stock မူကြမ်း (Draft) ဖန်တီးပြီးပါပြီ"
        }, 201);
    }

    if (path.startsWith("/api/opening-stock/") && path.endsWith("/items") && method === "PUT") {
        requirePermission(auth, "opening.create");
        const countId = Number(path.split("/")[3]);
        if (!countId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const header = await env.DB.prepare("SELECT * FROM opening_stock_counts WHERE id = ?").bind(countId).first();
        if (!header) return errorResponse("Opening Stock စာရွက် ရှာမတွေ့ပါ", 404);

        if (currentUserRole === "branch_manager" && Number(header.branch_id) !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ Opening Stock အား ပြင်ဆင်ခွင့် မရှိပါ", 403);
        }
        if (header.status !== "draft" && header.status !== "rejected") {
            return errorResponse(`လက်ရှိအခြေအနေ (${header.status}) တွင် ပစ္စည်းစာရင်း ပြင်ဆင်၍ မရပါ`, 400);
        }

        const body = await request.json().catch(() => ({}));
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) {
            return errorResponse("အနည်းဆုံး ပစ္စည်း (၁) မျိုး ပါဝင်ရပါမည်", 400);
        }

        const batch = [
            env.DB.prepare("DELETE FROM opening_stock_items WHERE count_id = ?").bind(countId),
            env.DB.prepare("UPDATE opening_stock_counts SET status = 'draft', reject_reason = NULL WHERE id = ?").bind(countId)
        ];

        for (const it of items) {
            const pid = Number(it.product_id ?? it.productId);
            const qty = roundQty(it.quantity);
            if (!pid || qty < 0) {
                return errorResponse("ပစ္စည်း ID နှင့် အရေအတွက် (>= 0) မှန်ကန်စွာ ထည့်သွင်းပါ", 400);
            }
            batch.push(
                env.DB.prepare(`
                    INSERT INTO opening_stock_items (count_id, product_id, quantity)
                    VALUES (?, ?, ?)
                    ON CONFLICT(count_id, product_id) DO UPDATE SET quantity = excluded.quantity
                `).bind(countId, pid, qty)
            );
        }

        await env.DB.batch(batch);
        return jsonResponse({ id: countId, status: "draft", message: "Opening Stock ပစ္စည်းစာရင်း သိမ်းဆည်းပြီးပါပြီ" });
    }

    if (path.startsWith("/api/opening-stock/") && path.endsWith("/submit") && method === "POST") {
        requirePermission(auth, "opening.submit");
        const countId = Number(path.split("/")[3]);
        if (!countId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const header = await env.DB.prepare("SELECT * FROM opening_stock_counts WHERE id = ?").bind(countId).first();
        if (!header) return errorResponse("Opening Stock စာရွက် ရှာမတွေ့ပါ", 404);

        if (currentUserRole === "branch_manager" && Number(header.branch_id) !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ Opening Stock အား Submit လုပ်ခွင့် မရှိပါ", 403);
        }
        if (header.status !== "draft" && header.status !== "rejected") {
            return errorResponse(`လက်ရှိအခြေအနေ (${header.status}) မှ Submit ပြုလုပ်၍ မရပါ`, 400);
        }

        const itemCountRow = await env.DB.prepare(
            "SELECT COUNT(id) AS cnt FROM opening_stock_items WHERE count_id = ? AND quantity > 0"
        ).bind(countId).first();

        if (!itemCountRow || Number(itemCountRow.cnt) < 1) {
            return errorResponse("Opening Stock အတည်ပြုရန် အရေအတွက် (> 0) ရှိသော ပစ္စည်း အနည်းဆုံး ၁ မျိုး ထည့်သွင်းပေးပါ", 400);
        }

        await env.DB.prepare(`
            UPDATE opening_stock_counts
            SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, reject_reason = NULL
            WHERE id = ? AND status IN ('draft', 'rejected')
        `).bind(countId).run();

        return jsonResponse({ id: countId, status: "submitted", message: "Opening Stock အတည်ပြုချက်တောင်းခံရန် (Submitted) ပေးပို့ပြီးပါပြီ" });
    }

    if (path.startsWith("/api/opening-stock/") && path.endsWith("/approve") && method === "POST") {
        requirePermission(auth, "opening.approve", "Opening Stock အတည်ပြုခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const countId = Number(path.split("/")[3]);
        if (!countId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const body = await request.json().catch(() => ({}));
        const header = await env.DB.prepare("SELECT * FROM opening_stock_counts WHERE id = ?").bind(countId).first();
        if (!header) return errorResponse("Opening Stock စာရွက် ရှာမတွေ့ပါ", 404);

        if (header.status === "approved") {
            return errorResponse("ဤ Opening Stock စာရွက်သည် အတည်ပြုပြီးသား ဖြစ်ပါသည် (Idempotent Guard)", 409);
        }
        if (header.status !== "submitted") {
            return errorResponse(`Submitted တင်ထားသော စာရွက်ကိုသာ Approve လုပ်နိုင်ပါသည် (လက်ရှိ: ${header.status})`, 400);
        }

        const branchId = Number(header.branch_id);
        const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.as_of_date || "").trim())
            ? String(body.as_of_date).trim()
            : header.as_of_date;

        // Spec 5.4: Check if another approved opening or any stock movement already exists for this branch
        const [dupOpening, existingMovements, itemsRes] = await env.DB.batch([
            env.DB.prepare("SELECT id FROM opening_stock_counts WHERE branch_id = ? AND status = 'approved' LIMIT 1").bind(branchId),
            env.DB.prepare("SELECT id FROM stock_movements WHERE branch_id = ? LIMIT 1").bind(branchId),
            env.DB.prepare(`
                SELECT osi.product_id, osi.quantity, p.is_active
                FROM opening_stock_items osi
                JOIN products p ON osi.product_id = p.id
                WHERE osi.count_id = ?
            `).bind(countId)
        ]);

        if ((dupOpening.results || [])[0]) {
            return errorResponse("ဤဆိုင်ခွဲတွင် အတည်ပြုပြီးသား Opening Stock ရှိနေပြီ ဖြစ်ပါသည်", 409);
        }
        if ((existingMovements.results || [])[0]) {
            return errorResponse("ဤဆိုင်ခွဲတွင် စတော့အဝင်/အထွက် Movement များ ရှိနေပြီဖြစ်သဖြင့် Opening Stock Approve လုပ်၍ မရနိုင်ပါ", 400);
        }

        const items = (itemsRes.results || []).filter(i => roundQty(i.quantity) > 0);
        if (items.length === 0) {
            return errorResponse("Opening Stock ပစ္စည်းစာရင်း မရှိပါ", 400);
        }
        for (const it of items) {
            if (Number(it.is_active) !== 1) {
                return errorResponse(`ပစ္စည်း (ID: ${it.product_id}) သည် Active မဟုတ်ပါ`, 400);
            }
        }

        const batch = [
            env.DB.prepare(`
                UPDATE opening_stock_counts
                SET status = 'approved', as_of_date = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'submitted'
            `).bind(effectiveDate, currentUserId, countId)
        ];

        for (const it of items) {
            const qty = roundQty(it.quantity);
            batch.push(
                env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity)
                    VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET
                        quantity = branch_inventory.quantity + excluded.quantity,
                        updated_at = CURRENT_TIMESTAMP
                `).bind(branchId, Number(it.product_id), qty),
                createStockMovementStmt(env.DB, {
                    branchId,
                    productId: Number(it.product_id),
                    movementType: "OPENING",
                    quantity: qty,
                    effectiveDate,
                    sourceTable: "opening_stock_counts",
                    sourceId: countId,
                    reason: `Approved Opening Stock #${countId}`,
                    createdBy: Number(header.created_by),
                    approvedBy: currentUserId
                })
            );
        }

        const batchResults = await env.DB.batch(batch);
        if (!batchResults[0]?.meta?.changes) {
            return errorResponse("Opening Stock စာရွက် အခြေအနေ ပြောင်းလဲသွားပြီ ဖြစ်ပါသည်", 409);
        }

        await logAudit(env.DB, {
            branchId,
            userId: currentUserId,
            action: "APPROVE_OPENING_STOCK",
            tableName: "opening_stock_counts",
            recordId: countId,
            details: { branch_id: branchId, as_of_date: effectiveDate, item_count: items.length }
        });

        return jsonResponse({
            id: countId,
            status: "approved",
            message: "Opening Stock အတည်ပြုပြီး ဆိုင်ခွဲလက်ကျန်နှင့် Movement Ledger ထဲသို့ ထည့်သွင်းပြီးပါပြီ"
        });
    }

    if (path.startsWith("/api/opening-stock/") && path.endsWith("/reject") && method === "POST") {
        requirePermission(auth, "opening.reject", "Opening Stock ငြင်းပယ်ခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const countId = Number(path.split("/")[3]);
        const body = await request.json().catch(() => ({}));
        const reason = String(body.reason ?? body.reject_reason ?? "").trim();

        if (!countId || !reason) {
            return errorResponse("ငြင်းပယ်ရသည့် အကြောင်းပြချက် (reason) မဖြစ်မနေ ရေးသားပေးပါ", 400);
        }

        const res = await env.DB.prepare(`
            UPDATE opening_stock_counts
            SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP, reject_reason = ?
            WHERE id = ? AND status = 'submitted'
        `).bind(currentUserId, reason, countId).run();

        if (!res.meta.changes) {
            return errorResponse("Submitted အခြေအနေရှိသော Opening Stock စာရွက်ကိုသာ Reject လုပ်နိုင်ပါသည်", 400);
        }

        return jsonResponse({ id: countId, status: "rejected", message: "Opening Stock အား ပြန်လည်ပြင်ဆင်ရန် Reject ပြုလုပ်ပြီးပါပြီ" });
    }

    // =========================================================================
    // 7. PHYSICAL STOCK COUNT & ADJUSTMENTS API (Spec Section 6)
    // =========================================================================
    if (path === "/api/adjustments" && method === "GET") {
        requirePermission(auth, "adjustment.view", "Stock Adjustment ကြည့်ရှုခွင့် မရှိပါ");

        const requestedBranch = url.searchParams.get("branch_id");
        const resolvedBranch = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const statusFilter = url.searchParams.get("status");

        const whereClauses = [];
        const bindings = [];

        if (resolvedBranch !== "ALL") {
            whereClauses.push("sa.branch_id = ?");
            bindings.push(Number(resolvedBranch));
        }
        if (statusFilter && String(statusFilter).trim() !== "") {
            whereClauses.push("sa.status = ?");
            bindings.push(String(statusFilter).trim().toLowerCase());
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

        const { results } = await env.DB.prepare(`
            SELECT 
                sa.*,
                b.name AS branch_name, b.code AS branch_code,
                cu.full_name AS created_by_name,
                du.full_name AS decided_by_name,
                (SELECT COUNT(id) FROM stock_adjustment_items sai WHERE sai.adjustment_id = sa.id) AS item_count
            FROM stock_adjustments sa
            JOIN branches b ON sa.branch_id = b.id
            LEFT JOIN users cu ON sa.created_by = cu.id
            LEFT JOIN users du ON sa.decided_by = du.id
            ${whereSql}
            ORDER BY sa.id DESC LIMIT 500
        `).bind(...bindings).all();

        return jsonResponse(results || []);
    }

    if (path.startsWith("/api/adjustments/") && path.split("/").filter(Boolean).length === 3 && method === "GET") {
        requirePermission(auth, "adjustment.view");
        const adjId = Number(path.split("/").pop());
        if (!adjId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const header = await env.DB.prepare(`
            SELECT sa.*, b.name AS branch_name, b.code AS branch_code,
                   cu.full_name AS created_by_name, du.full_name AS decided_by_name
            FROM stock_adjustments sa
            JOIN branches b ON sa.branch_id = b.id
            LEFT JOIN users cu ON sa.created_by = cu.id
            LEFT JOIN users du ON sa.decided_by = du.id
            WHERE sa.id = ?
        `).bind(adjId).first();

        if (!header) return errorResponse("Adjustment စာရွက် ရှာမတွေ့ပါ", 404);
        if (currentUserRole === "branch_manager" && Number(header.branch_id) !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ Adjustment အား ကြည့်ရှုခွင့် မရှိပါ", 403);
        }

        const { results: items } = await env.DB.prepare(`
            SELECT sai.*, p.sku, p.barcode, p.category, p.item_name, p.color, p.size
            FROM stock_adjustment_items sai
            JOIN products p ON sai.product_id = p.id
            WHERE sai.adjustment_id = ?
            ORDER BY p.category ASC, p.item_name ASC
        `).bind(adjId).all();

        return jsonResponse({ ...header, items: items || [] });
    }

    if (path === "/api/adjustments" && method === "POST") {
        requirePermission(auth, "adjustment.create", "Stock Count / Adjustment ဖန်တီးခွင့် မရှိပါ");

        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branch_id ?? body.branchId, { isWrite: true, strictStaffCheck: true });
        const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.effective_date ?? body.effectiveDate ?? "").trim())
            ? String(body.effective_date ?? body.effectiveDate).trim()
            : getMyanmarTodayDate();
        const notes = body.notes ? String(body.notes).trim() : null;
        const autoSubmit = Boolean(body.submit || body.status === "submitted");
        const items = Array.isArray(body.items) ? body.items : [];

        if (items.length === 0) {
            return errorResponse("စစ်ဆေးထားသော ပစ္စည်းစာရင်း (items) ထည့်သွင်းပေးပါ", 400);
        }

        // Load current system stock & cost_price for the branch
        const { results: sysRows } = await env.DB.prepare(`
            SELECT p.id, p.item_name, p.cost_price, COALESCE(bi.quantity, 0) AS system_qty
            FROM products p
            LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
            WHERE p.is_active = 1
        `).bind(branchId).all();

        const prodMap = new Map((sysRows || []).map(r => [Number(r.id), r]));
        const validatedItems = [];
        let totalVarianceValue = 0;

        for (const it of items) {
            const pid = Number(it.product_id ?? it.productId);
            const prod = prodMap.get(pid);
            if (!prod) {
                return errorResponse(`ပစ္စည်း (ID: ${pid}) ရှာမတွေ့ပါ`, 404);
            }

            const countedQty = roundQty(it.counted_qty ?? it.countedQty);
            if (countedQty < 0) {
                return errorResponse(`"${prod.item_name}" ရေတွက်အရေအတွက်သည် သုညအောက် မငယ်ရပါ`, 400);
            }

            const systemQty = roundQty(prod.system_qty);
            const diffQty = roundQty(countedQty - systemQty);
            const reason = String(it.reason || "").trim();

            // Spec 6.2 & 10: Every item with a discrepancy MUST have a reason
            if (diffQty !== 0 && !reason) {
                return errorResponse(`"${prod.item_name}" တွင် ကွဲလွဲမှု (${diffQty}) ရှိနေပါသဖြင့် အကြောင်းရင်း (reason) မဖြစ်မနေ ထည့်သွင်းပေးပါ`, 400);
            }

            const unitCost = roundKyat(prod.cost_price || 0);
            totalVarianceValue += roundKyat(Math.abs(diffQty) * unitCost);

            validatedItems.push({
                product_id: pid,
                system_qty: systemQty,
                counted_qty: countedQty,
                diff_qty: diffQty,
                unit_cost: unitCost,
                reason: reason || "No variance"
            });
        }

        const refNo = await generateUniqueInvoice(env.DB, "ADJ", branchId);
        const initialStatus = autoSubmit ? "submitted" : "draft";

        const insRes = await env.DB.prepare(`
            INSERT INTO stock_adjustments (
                reference_no, branch_id, status, effective_date, total_variance_value, notes, created_by, submitted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ${autoSubmit ? "CURRENT_TIMESTAMP" : "NULL"})
        `).bind(refNo, branchId, initialStatus, effectiveDate, totalVarianceValue, notes, currentUserId).run();

        const adjId = insRes.meta.last_row_id;
        const itemBatch = validatedItems.map(vi =>
            env.DB.prepare(`
                INSERT INTO stock_adjustment_items (
                    adjustment_id, product_id, system_qty, counted_qty, diff_qty, unit_cost, reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(adjId, vi.product_id, vi.system_qty, vi.counted_qty, vi.diff_qty, vi.unit_cost, vi.reason)
        );

        await env.DB.batch(itemBatch);

        return jsonResponse({
            id: adjId,
            reference_no: refNo,
            status: initialStatus,
            total_variance_value: totalVarianceValue,
            requires_admin_approval: totalVarianceValue > HIGH_VALUE_ADJUSTMENT_THRESHOLD_KYAT,
            message: autoSubmit
                ? "Stock Count & Adjustment တင်ပြပြီးပါပြီ (Approve စောင့်ဆိုင်းနေပါသည်)"
                : "Stock Count မူကြမ်း (Draft) သိမ်းဆည်းပြီးပါပြီ"
        }, 201);
    }

    if (path.startsWith("/api/adjustments/") && path.endsWith("/submit") && method === "POST") {
        requirePermission(auth, "adjustment.submit");
        const adjId = Number(path.split("/")[3]);
        if (!adjId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const header = await env.DB.prepare("SELECT * FROM stock_adjustments WHERE id = ?").bind(adjId).first();
        if (!header) return errorResponse("Adjustment စာရွက် ရှာမတွေ့ပါ", 404);
        if (currentUserRole === "branch_manager" && Number(header.branch_id) !== userBranchId) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ Adjustment အား Submit လုပ်ခွင့် မရှိပါ", 403);
        }
        if (header.status !== "draft" && header.status !== "rejected") {
            return errorResponse(`လက်ရှိအခြေအနေ (${header.status}) မှ Submit လုပ်၍ မရပါ`, 400);
        }

        await env.DB.prepare(`
            UPDATE stock_adjustments
            SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, reject_reason = NULL
            WHERE id = ? AND status IN ('draft', 'rejected')
        `).bind(adjId).run();

        return jsonResponse({ id: adjId, status: "submitted", message: "Adjustment အတည်ပြုချက်တောင်းခံရန် ပေးပို့ပြီးပါပြီ" });
    }

    if (path.startsWith("/api/adjustments/") && path.endsWith("/approve") && method === "POST") {
        requirePermission(auth, "adjustment.approve", "Stock Adjustment အတည်ပြုခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const adjId = Number(path.split("/")[3]);
        if (!adjId) return errorResponse("ID မမှန်ကန်ပါ", 400);

        const header = await env.DB.prepare("SELECT * FROM stock_adjustments WHERE id = ?").bind(adjId).first();
        if (!header) return errorResponse("Adjustment စာရွက် ရှာမတွေ့ပါ", 404);
        if (header.status === "approved") {
            return errorResponse("ဤ Adjustment စာရွက်သည် အတည်ပြုပြီးသား ဖြစ်ပါသည်", 409);
        }
        if (header.status !== "submitted") {
            return errorResponse(`Submitted တင်ထားသော စာရွက်ကိုသာ Approve လုပ်နိုင်ပါသည် (လက်ရှိ: ${header.status})`, 400);
        }

        // Spec 6.3: High-value variance threshold check (> 50,000 Ks requires admin)
        if (Number(header.total_variance_value) > HIGH_VALUE_ADJUSTMENT_THRESHOLD_KYAT) {
            requirePermission(
                auth,
                "adjustment.approve_high_value",
                `ကွဲလွဲမှုတန်ဖိုး (${Number(header.total_variance_value).toLocaleString()} Ks) သည် သတ်မှတ်ပမာဏ (${HIGH_VALUE_ADJUSTMENT_THRESHOLD_KYAT.toLocaleString()} Ks) ထက် ကျော်လွန်နေပါသဖြင့် Admin တစ်ဦးတည်းသာ အတည်ပြုနိုင်ပါသည်`
            );
        }

        const branchId = Number(header.branch_id);
        const [itemsRes, stockRes] = await env.DB.batch([
            env.DB.prepare("SELECT * FROM stock_adjustment_items WHERE adjustment_id = ?").bind(adjId),
            env.DB.prepare("SELECT product_id, quantity FROM branch_inventory WHERE branch_id = ?").bind(branchId)
        ]);

        const items = itemsRes.results || [];
        const stockMap = new Map((stockRes.results || []).map(r => [Number(r.product_id), roundQty(r.quantity)]));

        const batch = [
            env.DB.prepare(`
                UPDATE stock_adjustments
                SET status = 'approved', decided_by = ?, decided_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'submitted'
            `).bind(currentUserId, adjId)
        ];

        for (const it of items) {
            const diffQty = roundQty(it.diff_qty);
            if (diffQty === 0) continue;

            const pid = Number(it.product_id);
            const currentQty = stockMap.get(pid) || 0;
            if (currentQty + diffQty < 0) {
                return errorResponse(`ပစ္စည်း (ID: ${pid}) ၏ လက်ရှိလက်ကျန် (${currentQty}) သည် ပြင်ဆင်မည့်ပမာဏ (${diffQty}) အတွက် မလုံလောက်ပါ`, 400);
            }

            if (diffQty > 0) {
                batch.push(
                    env.DB.prepare(`
                        INSERT INTO branch_inventory (branch_id, product_id, quantity)
                        VALUES (?, ?, ?)
                        ON CONFLICT(branch_id, product_id) DO UPDATE SET
                            quantity = branch_inventory.quantity + excluded.quantity,
                            updated_at = CURRENT_TIMESTAMP
                    `).bind(branchId, pid, diffQty),
                    createStockMovementStmt(env.DB, {
                        branchId,
                        productId: pid,
                        movementType: "ADJUSTMENT_IN",
                        quantity: diffQty,
                        effectiveDate: header.effective_date,
                        sourceTable: "stock_adjustments",
                        sourceId: adjId,
                        reason: it.reason,
                        createdBy: Number(header.created_by),
                        approvedBy: currentUserId
                    })
                );
            } else {
                const absOut = Math.abs(diffQty);
                batch.push(
                    env.DB.prepare(`
                        UPDATE branch_inventory
                        SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                        WHERE branch_id = ? AND product_id = ? AND quantity >= ?
                    `).bind(absOut, branchId, pid, absOut),
                    createStockMovementStmt(env.DB, {
                        branchId,
                        productId: pid,
                        movementType: "ADJUSTMENT_OUT",
                        quantity: absOut,
                        effectiveDate: header.effective_date,
                        sourceTable: "stock_adjustments",
                        sourceId: adjId,
                        reason: it.reason,
                        createdBy: Number(header.created_by),
                        approvedBy: currentUserId
                    })
                );
            }
        }

        const batchResults = await env.DB.batch(batch);
        if (!batchResults[0]?.meta?.changes) {
            return errorResponse("Adjustment အခြေအနေ ပြောင်းလဲသွားပြီ ဖြစ်ပါသည်", 409);
        }

        await logAudit(env.DB, {
            branchId,
            userId: currentUserId,
            action: "APPROVE_STOCK_ADJUSTMENT",
            tableName: "stock_adjustments",
            recordId: adjId,
            details: { reference_no: header.reference_no, total_variance_value: header.total_variance_value }
        });

        return jsonResponse({
            id: adjId,
            status: "approved",
            message: "Stock Adjustment အတည်ပြုပြီး လက်ကျန်စတော့နှင့် Movement Ledger ပြင်ဆင်ပြီးပါပြီ"
        });
    }

    if (path.startsWith("/api/adjustments/") && path.endsWith("/reject") && method === "POST") {
        requirePermission(auth, "adjustment.reject", "Stock Adjustment ငြင်းပယ်ခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်");

        const adjId = Number(path.split("/")[3]);
        const body = await request.json().catch(() => ({}));
        const reason = String(body.reason ?? body.reject_reason ?? "").trim();

        if (!adjId || !reason) {
            return errorResponse("ငြင်းပယ်ရသည့် အကြောင်းပြချက် (reason) မဖြစ်မနေ ရေးသားပေးပါ", 400);
        }

        const res = await env.DB.prepare(`
            UPDATE stock_adjustments
            SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP, reject_reason = ?
            WHERE id = ? AND status = 'submitted'
        `).bind(currentUserId, reason, adjId).run();

        if (!res.meta.changes) {
            return errorResponse("Submitted အခြေအနေရှိသော Adjustment စာရွက်ကိုသာ Reject လုပ်နိုင်ပါသည်", 400);
        }

        return jsonResponse({ id: adjId, status: "rejected", message: "Stock Adjustment အား Reject ပြုလုပ်ပြီးပါပြီ" });
    }

    return null;
}
