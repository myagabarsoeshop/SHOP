// =============================================================================
// FILE 2 OF 5: cashbook-api/routes-inventory.js
// BRANCHES, PRODUCTS (OPENING STOCK & BULK CSV), YARN, WASTE LOGS & STOCK TRANSFERS
// Version: 3.2.0 (RBAC Hardened, Cost-Price Masked, CSV Stock Sync & UTC Indexed)
// =============================================================================

import {
    jsonResponse,
    errorResponse,
    getMyanmarTodayDate,
    getMyanmarYearUtcBounds,
    roundKyat,
    roundQty,
    getQueryYear,
    resolveBranchId,
    requireRole,
    logAudit
} from "./utils.js";

export async function handleInventoryRoutes(request, env, url, path, method, auth) {
    const currentUserId = auth.uid;
    const currentUserRole = auth.role;
    const userBranchId = auth.branch_id;
    const isAdminOrFinance = requireRole(auth, ["admin", "finance", "manager"]);

    // =========================================================================
    // 1. BRANCHES
    // =========================================================================
    if (path === "/api/branches" && method === "GET") {
        const { results } = await env.DB.prepare(
            "SELECT id, code, name, type, phone, address FROM branches WHERE is_active = 1 ORDER BY id ASC"
        ).all();
        return jsonResponse(results || []);
    }

    // =========================================================================
    // 2. PRODUCTS & STOCK BALANCES (INDEX-OPTIMIZED JOIN & RBAC COST MASKING)
    // =========================================================================
    if (path === "/api/products" && method === "GET") {
        const requestedBranch = url.searchParams.get("branch_id");
        const branchId = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const search = url.searchParams.get("search")?.trim() || "";
        const category = url.searchParams.get("category")?.trim() || "";

        let sql = "";
        const bindings = [];

        if (branchId && branchId !== "ALL") {
            sql = `
                SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                       p.cost_price, p.retail_price, p.wholesale_price, p.alert_quantity,
                       COALESCE(bi.quantity, 0) AS current_stock
                FROM products p
                LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
                WHERE p.is_active = 1
            `;
            bindings.push(Number(branchId));
        } else {
            sql = `
                SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                       p.cost_price, p.retail_price, p.wholesale_price, p.alert_quantity,
                       COALESCE(SUM(bi.quantity), 0) AS current_stock
                FROM products p
                LEFT JOIN branch_inventory bi ON p.id = bi.product_id
                WHERE p.is_active = 1
            `;
        }

        if (search) {
            sql += " AND (p.barcode = ? OR p.sku LIKE ? OR p.item_name LIKE ? OR p.pattern LIKE ? OR p.color LIKE ? OR p.category LIKE ?) ";
            bindings.push(search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (category) {
            sql += " AND p.category = ? ";
            bindings.push(category);
        }

        if (!branchId || branchId === "ALL") {
            sql += " GROUP BY p.id ";
        }

        sql += " ORDER BY p.item_name ASC, p.id DESC LIMIT 1000";

        const { results } = await env.DB.prepare(sql).bind(...bindings).all();
        const maskedResults = (results || []).map(row => ({
            ...row,
            cost_price: isAdminOrFinance ? roundKyat(row.cost_price || 0) : 0
        }));

        return jsonResponse(maskedResults);
    }

    if (path === "/api/products/scan" && method === "GET") {
        const code = url.searchParams.get("code")?.trim();
        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"));
        if (!code) return errorResponse("Barcode ထည့်သွင်းပေးပါ", 400);

        const sql = `
            SELECT p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                   p.cost_price, p.retail_price, p.wholesale_price, COALESCE(bi.quantity, 0) AS current_stock
            FROM products p
            LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
            WHERE (p.barcode = ? OR p.sku = ?) AND p.is_active = 1 LIMIT 1
        `;
        const product = await env.DB.prepare(sql).bind(Number(branchId), code, code).first();
        if (!product) return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);

        if (!isAdminOrFinance) {
            product.cost_price = 0;
        }
        return jsonResponse(product);
    }

    if (path === "/api/products" && method === "POST") {
        if (!isAdminOrFinance) {
            return errorResponse("ပစ္စည်းအသစ် ထည့်သွင်းခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်", 403);
        }

        const body = await request.json().catch(() => ({}));
        const itemName = body.itemName || body.item_name;
        if (!body.category || !itemName) {
            return errorResponse("အမျိုးအစားနှင့် ပစ္စည်းအမည် ထည့်သွင်းပေးပါ", 400);
        }

        const cleanCategory = String(body.category).trim();
        const sku = body.sku && String(body.sku).trim() !== "" ? String(body.sku).trim() : null;
        const barcode = body.barcode && String(body.barcode).trim() !== "" ? String(body.barcode).trim() : null;
        const costPrice = roundKyat(body.costPrice ?? body.cost_price ?? 0);
        const retailPrice = roundKyat(body.retailPrice ?? body.retail_price ?? 0);
        const wholesalePrice = roundKyat(body.wholesalePrice ?? body.wholesale_price ?? retailPrice);
        const initialStock = roundQty(body.initialStock ?? body.quantity ?? 0);
        const defaultAlert = cleanCategory.startsWith("ချည်") ? 10 : 5;
        const alertQty = body.alertQuantity !== undefined || body.alert_quantity !== undefined
            ? Math.max(0, roundQty(body.alertQuantity ?? body.alert_quantity))
            : defaultAlert;
        const targetBranchId = parseInt(body.targetBranchId ?? body.branchId ?? userBranchId, 10) || 1;

        if (costPrice < 0 || retailPrice < 0 || wholesalePrice < 0 || initialStock < 0) {
            return errorResponse("ဈေးနှုန်းနှင့် အရေအတွက်များ အနှုတ်ဖြစ်၍ မရပါ", 400);
        }

        const res = await env.DB.prepare(`
            INSERT INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price, alert_quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            sku, barcode, cleanCategory, String(itemName).trim(),
            body.pattern && String(body.pattern).trim() !== "" ? String(body.pattern).trim() : null,
            body.size && String(body.size).trim() !== "" ? String(body.size).trim() : "ထည်",
            body.color && String(body.color).trim() !== "" ? String(body.color).trim() : null,
            costPrice, retailPrice, wholesalePrice, alertQty
        ).run();

        const newProductId = res.meta.last_row_id;
        if (initialStock > 0) {
            await env.DB.prepare(`
                INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
            `).bind(targetBranchId, newProductId, initialStock).run();
        }

        await logAudit(env.DB, {
            branchId: targetBranchId,
            userId: currentUserId,
            action: "CREATE_PRODUCT",
            tableName: "products",
            recordId: newProductId,
            details: { sku, itemName, initialStock, costPrice, retailPrice }
        });

        return jsonResponse({ id: newProductId, message: "အထည်အသစ် သိမ်းဆည်းပြီးပါပြီ" }, 201);
    }

    // BULK CSV IMPORT (Saves 95% of D1 Roundtrips, Syncs Opening Stock & Reports Exact Inserted vs Skipped Count)
    if (path === "/api/products/bulk" && method === "POST") {
        if (!isAdminOrFinance) {
            return errorResponse("CSV ဖြင့် ပစ္စည်းသွင်းယူခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်", 403);
        }

        const body = await request.json().catch(() => ({}));
        const items = Array.isArray(body.items) ? body.items : [];
        const targetBranchId = parseInt(body.branchId ?? body.targetBranchId ?? userBranchId, 10) || 1;
        if (items.length === 0) return errorResponse("သွင်းယူမည့် ပစ္စည်းစာရင်း မရှိပါ", 400);

        const validItems = [];
        for (const item of items) {
            const itemName = String(item.itemName || item.item_name || "").trim();
            const category = String(item.category || "အထွေထွေ").trim();
            if (!itemName) continue;

            const sku = item.sku && String(item.sku).trim() !== "" ? String(item.sku).trim() : null;
            const barcode = item.barcode && String(item.barcode).trim() !== "" ? String(item.barcode).trim() : null;
            const costPrice = Math.max(0, roundKyat(item.costPrice ?? item.cost_price ?? 0));
            const retailPrice = Math.max(0, roundKyat(item.retailPrice ?? item.retail_price ?? 0));
            const wholesalePrice = Math.max(0, roundKyat(item.wholesalePrice ?? item.wholesale_price ?? retailPrice));
            const stockQty = Math.max(0, roundQty(item.quantity ?? item.stock ?? item.initialStock ?? 0));

            validItems.push({
                sku,
                barcode,
                category,
                itemName,
                pattern: item.pattern && String(item.pattern).trim() !== "" ? String(item.pattern).trim() : null,
                size: item.size && String(item.size).trim() !== "" ? String(item.size).trim() : "ထည်",
                color: item.color && String(item.color).trim() !== "" ? String(item.color).trim() : null,
                costPrice,
                retailPrice,
                wholesalePrice,
                stockQty
            });
        }

        if (validItems.length === 0) {
            return errorResponse("သွင်းယူနိုင်သော ပစ္စည်းအချက်အလက် မတွေ့ပါ", 400);
        }

        let insertedCount = 0;
        let stockUpdatedCount = 0;

        for (let i = 0; i < validItems.length; i += 40) {
            const chunk = validItems.slice(i, i + 40);
            const stmts = chunk.map(it =>
                env.DB.prepare(`
                    INSERT OR IGNORE INTO products (sku, barcode, category, item_name, pattern, size, color, cost_price, retail_price, wholesale_price)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    it.sku, it.barcode, it.category, it.itemName,
                    it.pattern, it.size, it.color,
                    it.costPrice, it.retailPrice, it.wholesalePrice
                )
            );

            const chunkResults = await env.DB.batch(stmts);
            const stockBatch = [];

            chunkResults.forEach((r, idx) => {
                const changes = Number(r?.meta?.changes || 0);
                const newProdId = r?.meta?.last_row_id;
                const it = chunk[idx];

                if (changes > 0) {
                    insertedCount += 1;
                    if (it.stockQty > 0 && newProdId) {
                        stockUpdatedCount += 1;
                        stockBatch.push(
                            env.DB.prepare(`
                                INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                                ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP
                            `).bind(targetBranchId, newProdId, it.stockQty)
                        );
                    }
                } else if (it.stockQty > 0 && (it.sku || it.barcode)) {
                    // If product already existed by SKU/Barcode and CSV specifies a stock balance, sync its stock balance
                    stockUpdatedCount += 1;
                    stockBatch.push(
                        env.DB.prepare(`
                            INSERT INTO branch_inventory (branch_id, product_id, quantity)
                            SELECT ?, id, ? FROM products WHERE (sku = ? OR barcode = ?) AND is_active = 1 LIMIT 1
                            ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP
                        `).bind(targetBranchId, it.stockQty, it.sku || "", it.barcode || "")
                    );
                }
            });

            if (stockBatch.length > 0) {
                await env.DB.batch(stockBatch);
            }
        }

        const skippedCount = Math.max(0, validItems.length - insertedCount);

        await logAudit(env.DB, {
            branchId: targetBranchId,
            userId: currentUserId,
            action: "BULK_IMPORT_PRODUCTS",
            tableName: "products",
            recordId: null,
            details: { totalRows: validItems.length, insertedCount, skippedCount, stockUpdatedCount }
        });

        return jsonResponse({
            message: skippedCount > 0
                ? `ပစ္စည်းအသစ် (${insertedCount}) မျိုး သွင်းယူပြီး ရှိပြီးသား (${skippedCount}) မျိုးအနက် စတော့ပါသော ပစ္စည်းများကို လက်ကျန်ညှိပေးပြီးပါပြီ`
                : `ပစ္စည်း (${insertedCount}) မျိုးနှင့် စာရင်းဖွင့်လက်ကျန်များ အောင်မြင်စွာ သွင်းယူပြီးပါပြီ`,
            count: insertedCount,
            insertedCount,
            skippedCount,
            stockUpdatedCount
        }, 201);
    }

    if (path.startsWith("/api/products/") && method === "PUT") {
        if (!isAdminOrFinance) {
            return errorResponse("ပစ္စည်းအချက်အလက်နှင့် ဈေးနှုန်းပြင်ဆင်ခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်", 403);
        }

        const productId = Number(path.split("/").pop());
        const body = await request.json().catch(() => ({}));
        if (!productId) return errorResponse("Product ID မမှန်ကန်ပါ", 400);

        const cleanSku = body.sku !== undefined ? (String(body.sku).trim() || null) : null;
        const cleanBarcode = body.barcode !== undefined ? (String(body.barcode).trim() || null) : null;
        const alertQty = body.alertQuantity !== undefined || body.alert_quantity !== undefined
            ? Math.max(0, roundQty(body.alertQuantity ?? body.alert_quantity))
            : null;

        await env.DB.prepare(`
            UPDATE products SET
                sku = COALESCE(?, sku),
                barcode = COALESCE(?, barcode),
                category = COALESCE(?, category),
                item_name = COALESCE(?, item_name),
                pattern = COALESCE(?, pattern),
                size = COALESCE(?, size),
                color = COALESCE(?, color),
                cost_price = COALESCE(?, cost_price),
                retail_price = COALESCE(?, retail_price),
                wholesale_price = COALESCE(?, wholesale_price),
                alert_quantity = COALESCE(?, alert_quantity)
            WHERE id = ?
        `).bind(
            cleanSku,
            cleanBarcode,
            body.category ? String(body.category).trim() : null,
            body.itemName ?? body.item_name ?? null,
            body.pattern !== undefined ? (String(body.pattern).trim() || null) : null,
            body.size ? String(body.size).trim() : null,
            body.color !== undefined ? (String(body.color).trim() || null) : null,
            body.costPrice !== undefined ? roundKyat(body.costPrice) : (body.cost_price !== undefined ? roundKyat(body.cost_price) : null),
            body.retailPrice !== undefined ? roundKyat(body.retailPrice) : (body.retail_price !== undefined ? roundKyat(body.retail_price) : null),
            body.wholesalePrice !== undefined ? roundKyat(body.wholesalePrice) : (body.wholesale_price !== undefined ? roundKyat(body.wholesale_price) : null),
            alertQty,
            productId
        ).run();

        // Admin / Finance / Manager can set or adjust Opening / Current Stock balance (strictly audited)
        if (body.quantity !== undefined && body.quantity !== null && body.quantity !== "" && isAdminOrFinance && (body.branchId || userBranchId)) {
            const targetBranch = Number(body.branchId || userBranchId);
            const newQty = Math.max(0, roundQty(body.quantity));
            const oldInv = await env.DB.prepare(
                "SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?"
            ).bind(targetBranch, productId).first();
            const oldQty = roundQty(oldInv?.quantity || 0);

            if (oldQty !== newQty) {
                await env.DB.prepare(`
                    INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                    ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP
                `).bind(targetBranch, productId, newQty).run();

                await logAudit(env.DB, {
                    branchId: targetBranch,
                    userId: currentUserId,
                    action: "MANUAL_STOCK_ADJUST",
                    tableName: "branch_inventory",
                    recordId: productId,
                    details: { productId, branchId: targetBranch, oldQty, newQty }
                });
            }
        }

        return jsonResponse({ message: "ပစ္စည်းအချက်အလက်နှင့် လက်ကျန်စာရင်း ပြင်ဆင်ပြီးပါပြီ" });
    }

    if (path.startsWith("/api/products/") && method === "DELETE") {
        if (!isAdminOrFinance) {
            return errorResponse("ပစ္စည်းဖျက်သိမ်းခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်", 403);
        }

        const productId = Number(path.split("/").pop());
        if (!productId) return errorResponse("Product ID မမှန်ကန်ပါ", 400);

        await env.DB.prepare("UPDATE products SET is_active = 0 WHERE id = ?").bind(productId).run();
        await logAudit(env.DB, {
            branchId: userBranchId,
            userId: currentUserId,
            action: "DELETE_PRODUCT",
            tableName: "products",
            recordId: productId,
            details: "Soft-deleted product (is_active = 0)"
        });
        return jsonResponse({ message: "အထည်စာရင်းမှ အောင်မြင်စွာ ဖျက်ပြီးပါပြီ" });
    }

    // =========================================================================
    // 3. YARN BALANCES & PRODUCTION ISSUE
    // =========================================================================
    if (path === "/api/yarns" && method === "GET") {
        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"));
        const search = url.searchParams.get("search")?.trim() || "";

        let sql = `
            SELECT 
                p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, 
                p.size, p.color, p.cost_price, p.retail_price, p.wholesale_price, 
                p.alert_quantity,
                COALESCE(bi.quantity, 0) AS current_stock
            FROM products p
            LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
            WHERE p.is_active = 1 
              AND (p.category = 'ချည်' OR p.category = 'Yarn' OR p.category LIKE 'ချည်%')
              AND p.category NOT LIKE '%ပုဆိုး%' 
              AND p.category NOT LIKE '%လုံချည်%'
              AND p.category NOT LIKE '%အင်္ကျီ%'
        `;
        const bindings = [Number(branchId)];

        if (search) {
            sql += ` AND (p.sku LIKE ? OR p.barcode LIKE ? OR p.item_name LIKE ? OR p.color LIKE ?) `;
            bindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }

        sql += ` ORDER BY p.id DESC LIMIT 500`;
        const { results } = await env.DB.prepare(sql).bind(...bindings).all().catch(() => ({ results: [] }));
        const masked = (results || []).map(r => ({
            ...r,
            cost_price: isAdminOrFinance ? roundKyat(r.cost_price || 0) : 0
        }));
        return jsonResponse(masked);
    }

    if (path === "/api/yarns/issue" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branchId);
        const yarnId = Number(body.yarnId || body.product_id);
        const weaverName = String(body.weaverName || body.weaver_name || "").trim();
        const qty = roundQty(body.quantity);
        const notes = String(body.notes || "").trim();

        if (!yarnId || !weaverName || qty <= 0) {
            return errorResponse("ချည်အမျိုးအစား၊ ရက်ကန်းသမားအမည်နှင့် ပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ", 400);
        }

        const inv = await env.DB.prepare(
            "SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?"
        ).bind(branchId, yarnId).first();

        const currentStock = Number(inv?.quantity || 0);
        if (currentStock < qty) {
            return errorResponse(`ချည်လက်ကျန် မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
        }

        const today = getMyanmarTodayDate();

        await env.DB.batch([
            env.DB.prepare(`
                INSERT INTO yarn_issues (yarn_id, branch_id, weaver_name, quantity, issue_date, notes, created_by) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(yarnId, branchId, weaverName, qty, today, notes, currentUserId),

            env.DB.prepare(`
                UPDATE branch_inventory 
                SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                WHERE branch_id = ? AND product_id = ?
            `).bind(qty, branchId, yarnId)
        ]);

        return jsonResponse({ message: "ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု အောင်မြင်ပါသည်။ ချည်စတော့မှ နှုတ်ပြီးပါပြီ။" });
    }

    if (path === "/api/yarns/issues" && method === "GET") {
        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"));

        const sql = `
            SELECT 
                yi.id, yi.yarn_id, yi.branch_id, yi.weaver_name, yi.quantity, yi.issue_date, yi.notes, yi.created_at,
                p.sku, p.item_name, p.color, p.size AS unit,
                COALESCE(u.full_name, 'Admin') AS created_by_name
            FROM yarn_issues yi
            INNER JOIN products p ON yi.yarn_id = p.id
            LEFT JOIN users u ON yi.created_by = u.id
            WHERE yi.branch_id = ?
            ORDER BY yi.id DESC LIMIT 300
        `;
        const { results } = await env.DB.prepare(sql).bind(Number(branchId)).all().catch(() => ({ results: [] }));
        return jsonResponse(results || []);
    }

    if (path.startsWith("/api/yarns/issues/") && method === "DELETE") {
        const id = Number(path.split("/").pop());
        const issue = await env.DB.prepare("SELECT yarn_id, branch_id, quantity, weaver_name FROM yarn_issues WHERE id = ?").bind(id).first();
        if (!issue) return errorResponse("ချည်ထုတ်ပေးမှုမှတ်တမ်း ရှာမတွေ့ပါ", 404);

        const targetBranch = Number(issue.branch_id || userBranchId);
        if (!isAdminOrFinance && targetBranch !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ မှတ်တမ်းအား ပယ်ဖျက်ခွင့် မရှိပါ", 403);
        }

        await env.DB.batch([
            env.DB.prepare(`
                INSERT INTO branch_inventory (branch_id, product_id, quantity) VALUES (?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
            `).bind(targetBranch, Number(issue.yarn_id), roundQty(issue.quantity)),
            env.DB.prepare("DELETE FROM yarn_issues WHERE id = ?").bind(id)
        ]);

        await logAudit(env.DB, {
            branchId: targetBranch,
            userId: currentUserId,
            action: "VOID_YARN_ISSUE",
            tableName: "yarn_issues",
            recordId: id,
            details: { yarn_id: issue.yarn_id, quantity: issue.quantity, weaver_name: issue.weaver_name }
        });

        return jsonResponse({ message: "ချည်ထုတ်ပေးမှုမှတ်တမ်း ပယ်ဖျက်ပြီး လက်ကျန်ပြန်ပေါင်းပြီးပါပြီ" });
    }

    // =========================================================================
    // 4. DAMAGE & WASTE LOGS (UTC Index Optimized & Branch Scoped)
    // =========================================================================
    if (path === "/api/waste" && method === "GET") {
        const branchId = resolveBranchId(auth, url.searchParams.get("branch_id"));
        const targetYear = getQueryYear(url);
        const { startUtc: yearStartUtc, endUtc: yearEndUtc } = getMyanmarYearUtcBounds(targetYear);

        const sql = `
            SELECT 
                w.id, w.reference_no, w.branch_id, w.product_id, w.quantity, w.unit_cost, w.reason, w.created_at,
                p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                COALESCE(u.full_name, 'Admin') AS recorded_by_name
            FROM waste_logs w
            INNER JOIN products p ON w.product_id = p.id
            LEFT JOIN users u ON w.recorded_by = u.id
            WHERE w.branch_id = ? 
              AND w.created_at >= ? 
              AND w.created_at <= ?
              AND COALESCE(w.status, 'completed') != 'cancelled'
            ORDER BY w.id DESC LIMIT 300
        `;
        const { results } = await env.DB.prepare(sql).bind(Number(branchId), yearStartUtc, yearEndUtc).all().catch(() => ({ results: [] }));
        return jsonResponse(results || []);
    }

    if (path === "/api/waste" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const branchId = resolveBranchId(auth, body.branch_id);
        const productId = Number(body.product_id || body.productId);
        const quantity = roundQty(body.quantity);
        const unitCost = roundKyat(body.unit_cost ?? body.unitCost ?? 0);
        const reason = String(body.reason || "").trim();

        if (!branchId || !productId || quantity <= 0) {
            return errorResponse("ဆိုင်ခွဲ၊ ပစ္စည်းနှင့် ပျက်စီးပမာဏ မှန်ကန်စွာ ထည့်သွင်းပေးပါ", 400);
        }

        const inv = await env.DB.prepare(
            "SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?"
        ).bind(branchId, productId).first();

        const currentStock = Number(inv?.quantity || 0);
        if (currentStock < quantity) {
            return errorResponse(`လက်ကျန်စတော့ (${currentStock}) ထက် ပိုမို၍ ပျက်စီးစာရင်း သွင်း၍မရပါ`, 400);
        }

        const dateStr = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        const randSuffix = Math.floor(10 + Math.random() * 89);
        const refNo = `WST-B${branchId}-${dateStr}${randSuffix}`;

        await env.DB.batch([
            env.DB.prepare(`
                INSERT INTO waste_logs (reference_no, branch_id, product_id, quantity, unit_cost, reason, status, recorded_by)
                VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
            `).bind(refNo, branchId, productId, quantity, unitCost, reason || "ချည်/အထည် ပျက်စီးအလေအလွင့်", currentUserId),

            env.DB.prepare(`
                UPDATE branch_inventory 
                SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                WHERE branch_id = ? AND product_id = ?
            `).bind(quantity, branchId, productId)
        ]);

        return jsonResponse({ message: "အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။", refNo }, 201);
    }

    if (path.startsWith("/api/waste/") && method === "PUT") {
        const id = Number(path.split("/").pop());
        const body = await request.json().catch(() => ({}));
        const newQty = roundQty(body.quantity);
        const reason = String(body.reason || "").trim();
        const unitCost = body.unit_cost !== undefined ? roundKyat(body.unit_cost) : null;

        if (!id || newQty <= 0) {
            return errorResponse("မှန်ကန်သော အရေအတွက်/ပမာဏ ထည့်သွင်းပါ", 400);
        }

        const oldLog = await env.DB.prepare(
            "SELECT branch_id, product_id, quantity, unit_cost, status FROM waste_logs WHERE id = ?"
        ).bind(id).first();
        if (!oldLog || oldLog.status === "cancelled") return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

        if (!isAdminOrFinance && Number(oldLog.branch_id) !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ မှတ်တမ်းအား ပြင်ဆင်ခွင့် မရှိပါ", 403);
        }

        const diff = roundQty(Number(oldLog.quantity) - newQty);

        if (diff < 0) {
            const inv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                .bind(Number(oldLog.branch_id), Number(oldLog.product_id)).first();
            const currentStock = Number(inv?.quantity || 0);
            if (currentStock + diff < 0) {
                return errorResponse(`လက်ကျန်စတော့ မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
            }
        }

        const finalUnitCost = unitCost !== null ? unitCost : roundKyat(oldLog.unit_cost || 0);

        await env.DB.batch([
            env.DB.prepare("UPDATE waste_logs SET quantity = ?, unit_cost = ?, reason = ? WHERE id = ?")
                .bind(newQty, finalUnitCost, reason, id),
            env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                .bind(diff, Number(oldLog.branch_id), Number(oldLog.product_id))
        ]);

        return jsonResponse({ message: "အလေအလွင့်စာရင်း ပြင်ဆင်ပြီး စတော့လက်ကျန် ပြန်ညှိပြီးပါပြီ။" });
    }

    if (path.startsWith("/api/waste/") && method === "DELETE") {
        const id = Number(path.split("/").pop());
        const oldLog = await env.DB.prepare(
            "SELECT reference_no, branch_id, product_id, quantity, status FROM waste_logs WHERE id = ?"
        ).bind(id).first();
        if (!oldLog || oldLog.status === "cancelled") return errorResponse("မှတ်တမ်း ရှာမတွေ့ပါ", 404);

        if (!isAdminOrFinance && Number(oldLog.branch_id) !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ မှတ်တမ်းအား ဖျက်သိမ်းခွင့် မရှိပါ", 403);
        }

        await env.DB.batch([
            env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                .bind(roundQty(oldLog.quantity), Number(oldLog.branch_id), Number(oldLog.product_id)),
            env.DB.prepare("UPDATE waste_logs SET status = 'cancelled' WHERE id = ?").bind(id)
        ]);

        await logAudit(env.DB, {
            branchId: oldLog.branch_id,
            userId: currentUserId,
            action: "VOID_WASTE_LOG",
            tableName: "waste_logs",
            recordId: id,
            details: { reference_no: oldLog.reference_no, product_id: oldLog.product_id, quantity: oldLog.quantity }
        });

        return jsonResponse({ message: "မှတ်တမ်း ဖျက်သိမ်းပြီး စတော့ထဲသို့ အပြည့်အဝ ပြန်လည် ထည့်သွင်းပြီးပါပြီ။" });
    }

    // =========================================================================
    // 5. INTER-BRANCH STOCK TRANSFERS (UTC Index Optimized & RBAC Scoped)
    // =========================================================================
    if (path === "/api/transfers" && method === "GET") {
        const requestedBranch = url.searchParams.get("branch_id");
        const branchId = resolveBranchId(auth, requestedBranch, { allowAllForAdmin: true });
        const targetYear = getQueryYear(url);
        const { startUtc: yearStartUtc, endUtc: yearEndUtc } = getMyanmarYearUtcBounds(targetYear);

        let sql = `
            SELECT 
                t.id, t.transfer_no, t.from_branch_id, t.to_branch_id, t.product_id, t.quantity, t.status, t.notes, t.created_at,
                b1.name AS from_branch_name, b1.code AS from_branch_code,
                b2.name AS to_branch_name, b2.code AS to_branch_code,
                p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                COALESCE(u.full_name, 'Admin') AS created_by_name
            FROM stock_transfers t
            LEFT JOIN branches b1 ON t.from_branch_id = b1.id
            LEFT JOIN branches b2 ON t.to_branch_id = b2.id
            LEFT JOIN products p ON t.product_id = p.id
            LEFT JOIN users u ON t.created_by = u.id
            WHERE t.created_at >= ? AND t.created_at <= ?
              AND COALESCE(t.status, 'received') != 'cancelled'
        `;
        const bindings = [yearStartUtc, yearEndUtc];
        if (branchId && branchId !== "ALL") {
            sql += ` AND (t.from_branch_id = ? OR t.to_branch_id = ?) `;
            bindings.push(Number(branchId), Number(branchId));
        }
        sql += ` ORDER BY t.id DESC LIMIT 300 `;

        const { results } = await env.DB.prepare(sql).bind(...bindings).all().catch(() => ({ results: [] }));
        return jsonResponse(results || []);
    }

    if (path === "/api/transfers" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const fromBranchId = currentUserRole === "cashier"
            ? Number(userBranchId)
            : Number(body.fromBranchId || body.from_branch_id);
        const toBranchId = Number(body.toBranchId || body.to_branch_id);
        const productId = Number(body.productId || body.product_id);
        const quantity = roundQty(body.quantity);
        const notes = String(body.notes || "").trim();

        if (!fromBranchId || !toBranchId || !productId || quantity <= 0) {
            return errorResponse("လွှဲပြောင်းပေးပို့မည့် ဆိုင်ခွဲများ၊ ပစ္စည်းနှင့် အရေအတွက် အပြည့်အစုံ ထည့်သွင်းပေးပါ", 400);
        }

        if (fromBranchId === toBranchId) {
            return errorResponse("ပေးပို့မည့်ဆိုင်နှင့် လက်ခံမည့်ဆိုင် တူညီ၍ မရပါ", 400);
        }

        const sourceInv = await env.DB.prepare(
            "SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?"
        ).bind(fromBranchId, productId).first();

        const currentStock = Number(sourceInv?.quantity || 0);
        if (currentStock < quantity) {
            return errorResponse(`လွှဲပြောင်းမည့်ဆိုင်တွင် လက်ကျန်ပစ္စည်း မလုံလောက်ပါ (လက်ရှိလက်ကျန်: ${currentStock})`, 400);
        }

        const dateStr = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
        const randSuffix = Math.floor(10 + Math.random() * 89);
        const transferNo = `TRF-B${fromBranchId}TO${toBranchId}-${dateStr}${randSuffix}`;

        await env.DB.batch([
            env.DB.prepare(`
                INSERT INTO stock_transfers (transfer_no, from_branch_id, to_branch_id, product_id, quantity, status, notes, created_by)
                VALUES (?, ?, ?, ?, ?, 'received', ?, ?)
            `).bind(transferNo, fromBranchId, toBranchId, productId, quantity, notes || "ဆိုင်အချင်းချင်း ပစ္စည်းလွှဲပြောင်းမှု", currentUserId),

            env.DB.prepare(`
                UPDATE branch_inventory 
                SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP 
                WHERE branch_id = ? AND product_id = ?
            `).bind(quantity, fromBranchId, productId),

            env.DB.prepare(`
                INSERT INTO branch_inventory (branch_id, product_id, quantity) 
                VALUES (?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET 
                quantity = branch_inventory.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP
            `).bind(toBranchId, productId, quantity)
        ]);

        return jsonResponse({ message: "ဆိုင်ခွဲအချင်းချင်း ပစ္စည်းလွှဲပြောင်းခြင်း အောင်မြင်ပါသည်", transferNo }, 201);
    }

    if (path.startsWith("/api/transfers/") && method === "PUT") {
        const id = Number(path.split("/").pop());
        const body = await request.json().catch(() => ({}));
        const newQty = roundQty(body.quantity);
        const notes = String(body.notes || "").trim();

        if (!id || newQty <= 0) {
            return errorResponse("မှန်ကန်သော အရေအတွက် ထည့်သွင်းပေးပါ", 400);
        }

        const trf = await env.DB.prepare("SELECT * FROM stock_transfers WHERE id = ?").bind(id).first();
        if (!trf || trf.status === "cancelled") return errorResponse("လွှဲပြောင်းမှုမှတ်တမ်း ရှာမတွေ့ပါ", 404);

        if (!isAdminOrFinance && Number(trf.from_branch_id) !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ လွှဲပြောင်းမှုမှတ်တမ်းအား ပြင်ဆင်ခွင့် မရှိပါ", 403);
        }

        const oldQty = roundQty(trf.quantity || 0);
        const diff = roundQty(newQty - oldQty);

        if (diff > 0) {
            const fromInv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                .bind(Number(trf.from_branch_id), Number(trf.product_id)).first();
            const fromStock = Number(fromInv?.quantity || 0);
            if (fromStock < diff) {
                return errorResponse(`မူလပေးပို့သည့်ဆိုင်တွင် လက်ကျန် (${fromStock}) မလုံလောက်သဖြင့် အရေအတွက် တိုး၍မရပါ`, 400);
            }
        } else if (diff < 0) {
            const toInv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
                .bind(Number(trf.to_branch_id), Number(trf.product_id)).first();
            const toStock = Number(toInv?.quantity || 0);
            if (toStock < Math.abs(diff)) {
                return errorResponse(`လက်ခံရရှိသည့်ဆိုင်တွင် လက်ကျန် (${toStock}) လျော့နည်းနေသဖြင့် အရေအတွက် လျှော့ချ၍မရပါ`, 400);
            }
        }

        const batchStatements = [
            env.DB.prepare("UPDATE stock_transfers SET quantity = ?, notes = ? WHERE id = ?").bind(newQty, notes, id)
        ];

        if (diff !== 0) {
            batchStatements.push(
                env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                    .bind(diff, Number(trf.from_branch_id), Number(trf.product_id)),
                env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                    .bind(diff, Number(trf.to_branch_id), Number(trf.product_id))
            );
        }

        await env.DB.batch(batchStatements);
        return jsonResponse({ message: "လွှဲပြောင်းမှုမှတ်တမ်း ပြင်ဆင်ပြီး ဆိုင်နှစ်ခုလုံးရှိ စတော့လက်ကျန်များကို အလိုအလျောက် ပြန်ညှိပြီးပါပြီ။" });
    }

    if (path.startsWith("/api/transfers/") && method === "DELETE") {
        const id = Number(path.split("/").pop());
        const trf = await env.DB.prepare("SELECT * FROM stock_transfers WHERE id = ?").bind(id).first();
        if (!trf || trf.status === "cancelled") return errorResponse("လွှဲပြောင်းမှုမှတ်တမ်း ရှာမတွေ့ပါ", 404);

        if (!isAdminOrFinance && Number(trf.from_branch_id) !== Number(userBranchId)) {
            return errorResponse("အခြားဆိုင်ခွဲ၏ လွှဲပြောင်းမှုမှတ်တမ်းအား ဖျက်သိမ်းခွင့် မရှိပါ", 403);
        }

        const destInv = await env.DB.prepare("SELECT quantity FROM branch_inventory WHERE branch_id = ? AND product_id = ?")
            .bind(Number(trf.to_branch_id), Number(trf.product_id)).first();
        const destStock = Number(destInv?.quantity || 0);

        if (destStock < roundQty(trf.quantity)) {
            return errorResponse(`လက်ခံဆိုင်တွင် ပစ္စည်းလက်ကျန် (${destStock}) လျော့နည်းနေသဖြင့် လွှဲပြောင်းမှုကို ပြန်ဖျက်၍ မရပါ`, 400);
        }

        await env.DB.batch([
            env.DB.prepare("UPDATE branch_inventory SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                .bind(roundQty(trf.quantity), Number(trf.from_branch_id), Number(trf.product_id)),
            env.DB.prepare("UPDATE branch_inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?")
                .bind(roundQty(trf.quantity), Number(trf.to_branch_id), Number(trf.product_id)),
            env.DB.prepare("UPDATE stock_transfers SET status = 'cancelled' WHERE id = ?").bind(id)
        ]);

        await logAudit(env.DB, {
            branchId: trf.from_branch_id,
            userId: currentUserId,
            action: "VOID_STOCK_TRANSFER",
            tableName: "stock_transfers",
            recordId: id,
            details: { transfer_no: trf.transfer_no, product_id: trf.product_id, quantity: trf.quantity }
        });

        return jsonResponse({ message: "လွှဲပြောင်းမှုမှတ်တမ်းကို ပယ်ဖျက်ပြီး ဆိုင်နှစ်ခုလုံးရှိ စတော့များကို မူလအတိုင်း ပြန်ညှိပြီးပါပြီ" });
    }

    return null;
}
