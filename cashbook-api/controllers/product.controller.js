// cashbook-api/controllers/product.controller.js
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * အထည်ပစ္စည်းများ စာရင်းနှင့် လက်ကျန်ရယူခြင်း (POS Search & Inventory Table)
 * GET /api/products?branch_id=1&search=ကချင်&category=ပုဆိုး
 */
export async function handleGetProducts(request, env) {
    try {
        const url = new URL(request.url);
        const branchId = url.searchParams.get("branch_id"); // မထည့်ပါက All Branches Total ပြမည်
        const search = url.searchParams.get("search")?.trim() || "";
        const category = url.searchParams.get("category")?.trim() || "";

        let query = `
            SELECT 
                p.id,
                p.sku,
                p.barcode,
                p.category,
                p.item_name,
                p.pattern,
                p.size,
                p.color,
                p.product_type,
                p.cost_price,
                p.retail_price,
                p.wholesale_price,
                p.alert_quantity,
                p.is_active,
                (p.item_name || ' ' || p.category || CASE WHEN p.pattern IS NOT NULL AND p.pattern != '' THEN ' (' || p.pattern || ')' ELSE '' END) AS display_name,
                COALESCE(
                    ${branchId ? "bi.quantity" : "(SELECT SUM(quantity) FROM branch_inventory WHERE product_id = p.id)"},
                    0
                ) AS current_stock
            FROM products p
        `;

        const bindings = [];

        // သတ်မှတ်ထားသော ဆိုင်ခွဲရှိပါက branch_inventory နှင့် ချိတ်ဆက်ခြင်း
        if (branchId) {
            query += ` LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ? `;
            bindings.push(branchId);
        }

        query += ` WHERE p.is_active = 1 `;

        // Barcode / SKU / အမည် / အဆင် ရှာဖွေမှု (Manual Input သို့မဟုတ် Scanner)
        if (search) {
            query += ` AND (
                p.barcode = ? OR 
                p.sku LIKE ? OR 
                p.item_name LIKE ? OR 
                p.pattern LIKE ? OR 
                p.category LIKE ?
            ) `;
            bindings.push(search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (category) {
            query += ` AND p.category = ? `;
            bindings.push(category);
        }

        query += ` ORDER BY p.item_name ASC, p.id DESC LIMIT 100 `;

        const { results } = await env.DB.prepare(query).bind(...bindings).all();
        return successResponse(results || []);
    } catch (err) {
        return errorResponse(`အထည်စာရင်းများ ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * Barcode သို့မဟုတ် SKU ဖြင့် အမြန်ဆုံး သီးသန့်ရှာဖွေခြင်း (Scanner Instant Scan အတွက်)
 * GET /api/products/scan?code=123456&branch_id=1
 */
export async function handleScanProduct(request, env) {
    try {
        const url = new URL(request.url);
        const code = url.searchParams.get("code")?.trim();
        const branchId = url.searchParams.get("branch_id");

        if (!code) {
            return errorResponse("Barcode သို့မဟုတ် SKU ထည့်သွင်းပေးပါ", 400);
        }

        const query = `
            SELECT 
                p.id, p.sku, p.barcode, p.category, p.item_name, p.pattern, p.size, p.color,
                p.cost_price, p.retail_price, p.wholesale_price,
                (p.item_name || ' ' || p.category) AS display_name,
                COALESCE(bi.quantity, 0) AS current_stock
            FROM products p
            LEFT JOIN branch_inventory bi ON p.id = bi.product_id AND bi.branch_id = ?
            WHERE (p.barcode = ? OR p.sku = ?) AND p.is_active = 1
            LIMIT 1
        `;

        const product = await env.DB.prepare(query).bind(branchId || null, code, code).first();

        if (!product) {
            return errorResponse("ပစ္စည်း ရှာမတွေ့ပါ", 404);
        }

        return successResponse(product);
    } catch (err) {
        return errorResponse(`Barcode ဖတ်ရှုရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * အထည်အချော ပစ္စည်းအသစ် စာရင်းသွင်းခြင်း
 * POST /api/products
 */
export async function handleCreateProduct(request, env) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.category || !body.itemName) {
            return errorResponse("အမျိုးအစား (category) နှင့် ပစ္စည်းအမည် (itemName) မဖြစ်မနေ ထည့်သွင်းပေးပါ", 400);
        }

        const {
            sku = null,
            barcode = null,
            category,
            itemName,
            pattern = null,
            size = "Free Size",
            color = null,
            productType = "manufactured",
            costPrice = 0.0,
            retailPrice = 0.0,
            wholesalePrice = 0.0,
            initialStock = 0,
            targetBranchId = 1 // မူလအားဖြင့် Main Home Shop ထဲ လက်ကျန်စထည့်ပေးမည်
        } = body;

        // SKU သို့မဟုတ် Barcode ထပ်နေခြင်း ရှိ/မရှိ စစ်ဆေးခြင်း
        if (sku) {
            const existingSku = await env.DB.prepare("SELECT id FROM products WHERE sku = ?").bind(sku).first();
            if (existingSku) return errorResponse(`ကုတ်နံပါတ် '${sku}' သည် သုံးပြီးသား ဖြစ်နေပါသည်`, 409);
        }
        if (barcode) {
            const existingBarcode = await env.DB.prepare("SELECT id FROM products WHERE barcode = ?").bind(barcode).first();
            if (existingBarcode) return errorResponse(`Barcode '${barcode}' သည် သုံးပြီးသား ဖြစ်နေပါသည်`, 409);
        }

        // ၁။ Products Table ထဲသို့ ပစ္စည်းအသစ် ထည့်သွင်းခြင်း
        const insertProductSql = `
            INSERT INTO products (
                sku, barcode, category, item_name, pattern, size, color,
                product_type, cost_price, retail_price, wholesale_price
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const result = await env.DB.prepare(insertProductSql).bind(
            sku ? sku.trim() : null,
            barcode ? barcode.trim() : null,
            category.trim(),
            itemName.trim(),
            pattern ? pattern.trim() : null,
            size.trim(),
            color ? color.trim() : null,
            productType,
            parseFloat(costPrice) || 0,
            parseFloat(retailPrice) || 0,
            parseFloat(wholesalePrice) || 0
        ).run();

        const newProductId = result.meta.last_row_id;

        // ၂။ အကယ်၍ စတင်သွင်းချိန်တွင် ကနဦးလက်ကျန် (initialStock) ပါရှိပါက branch_inventory တွင် တစ်ခါတည်း ထည့်သွင်းပေးခြင်း
        if (parseInt(initialStock) > 0) {
            await env.DB.prepare(`
                INSERT INTO branch_inventory (branch_id, product_id, quantity)
                VALUES (?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity
            `).bind(targetBranchId, newProductId, parseInt(initialStock)).run();
        }

        return successResponse({
            id: newProductId,
            message: "အထည်ပစ္စည်း အသစ် အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ"
        }, 201);

    } catch (err) {
        return errorResponse(`ပစ္စည်းသစ် သွင်းရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * အထည်ပစ္စည်း အချက်အလက်နှင့် ဈေးနှုန်းများ ပြင်ဆင်ခြင်း
 * PUT /api/products/:id
 */
export async function handleUpdateProduct(request, env, productId) {
    try {
        const body = await request.json().catch(() => null);
        if (!body) return errorResponse("ပြင်ဆင်မည့် အချက်အလက်များ ထည့်သွင်းပေးပါ", 400);

        const updateSql = `
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
                is_active = COALESCE(?, is_active)
            WHERE id = ?
        `;

        await env.DB.prepare(updateSql).bind(
            body.sku ?? null,
            body.barcode ?? null,
            body.category ?? null,
            body.itemName ?? null,
            body.pattern ?? null,
            body.size ?? null,
            body.color ?? null,
            body.costPrice !== undefined ? parseFloat(body.costPrice) : null,
            body.retailPrice !== undefined ? parseFloat(body.retailPrice) : null,
            body.wholesalePrice !== undefined ? parseFloat(body.wholesalePrice) : null,
            body.isActive !== undefined ? parseInt(body.isActive) : null,
            productId
        ).run();

        return successResponse({ message: "ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ" });
    } catch (err) {
        return errorResponse(`ပစ္စည်း ပြင်ဆင်ရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}
