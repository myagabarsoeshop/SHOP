/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - GARMENT STORE HANDLER
 * File: cashbook-api/handler.store.js
 * ==============================================================================
 */

export async function handleStoreAction(action, db, body, url, corsHeaders) {
  if (action === "getStoreInventory") {
    const shopId = String(body.shop_id || url.searchParams.get("shop_id") || "main").trim().toLowerCase();

    let query = "";
    if (shopId === "main") {
      query = `
        SELECT 
          i.id AS item_id,
          i.item_code,
          i.item_name,
          i.category,
          i.sub_category,
          i.color_code,
          i.unit,
          COALESCE(i.retail_price, 0) AS retail_price,
          COALESCE(i.wholesale_price, 0) AS wholesale_price,
          COALESCE(s.current_stock, 0) AS current_stock,
          COALESCE(s.cost_price, 0) AS cost_price,
          COALESCE(s.remark, '') AS remark
        FROM items i
        LEFT JOIN shop_inventory s 
          ON UPPER(i.item_code) = UPPER(s.item_code) AND LOWER(s.shop_id) = ?
        ORDER BY i.id ASC;
      `;
    } else {
      query = `
        SELECT 
          i.id AS item_id,
          i.item_code,
          i.item_name,
          i.category,
          i.sub_category,
          i.color_code,
          i.unit,
          COALESCE(i.retail_price, 0) AS retail_price,
          COALESCE(i.wholesale_price, 0) AS wholesale_price,
          s.current_stock,
          s.cost_price,
          COALESCE(s.remark, '') AS remark
        FROM shop_inventory s
        INNER JOIN items i 
          ON UPPER(i.item_code) = UPPER(s.item_code)
        WHERE LOWER(s.shop_id) = ?
        ORDER BY i.id ASC;
      `;
    }

    const { results } = await db.prepare(query).bind(shopId).all();
    return new Response(
      JSON.stringify({ success: true, shop_id: shopId, data: results || [] }),
      { headers: corsHeaders }
    );
  }

  if (action === "saveItem") {
    const itemCode = String(body.item_code || "").trim().toUpperCase();
    const itemName = String(body.item_name || "").trim();
    const category = String(body.category || "ပုဆိုး").trim();
    const subCategory = String(body.sub_category || "").trim();
    const colorCode = String(body.color_code || "").trim();
    const unit = String(body.unit || "ထည်").trim();
    const retailPrice = Number(body.retail_price) || 0;
    const wholesalePrice = Number(body.wholesale_price || body.default_price) || 0;
    const remark = String(body.remark || "").trim();

    if (!itemCode || !itemName) {
      return new Response(
        JSON.stringify({ success: false, message: "Item Code နှင့် အမည် ထည့်သွင်းပေးပါ။" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const existingItem = await db.prepare(
      "SELECT id FROM items WHERE UPPER(item_code) = ?"
    ).bind(itemCode).first();

    if (existingItem) {
      await db.prepare(`
        UPDATE items SET
          item_name = ?, category = ?, sub_category = ?, color_code = ?,
          unit = ?, retail_price = ?, wholesale_price = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(itemName, category, subCategory, colorCode, unit, retailPrice, wholesalePrice, remark, existingItem.id).run();
    } else {
      await db.prepare(`
        INSERT INTO items (item_code, item_name, category, sub_category, color_code, unit, retail_price, wholesale_price, remark, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(itemCode, itemName, category, subCategory, colorCode, unit, retailPrice, wholesalePrice, remark).run();
    }

    if (body.shop_id) {
      const shopId = String(body.shop_id).trim().toLowerCase();
      const stock = Number(body.current_stock) || 0;
      const cost = Number(body.cost_price) || 0;

      const existingInv = await db.prepare(
        "SELECT id FROM shop_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
      ).bind(shopId, itemCode).first();

      if (existingInv) {
        await db.prepare(
          "UPDATE shop_inventory SET current_stock = ?, cost_price = ?, remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(stock, cost, remark || "Updated Stock", existingInv.id).run();
      } else {
        await db.prepare(
          "INSERT INTO shop_inventory (shop_id, item_code, current_stock, cost_price, remark, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ).bind(shopId, itemCode, stock, cost, remark || "Initial Stock").run();
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "ပစ္စည်းနှင့် စတိုလက်ကျန် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ!" }),
      { headers: corsHeaders }
    );
  }

  if (action === "transferStock") {
    const itemCode = String(body.item_code || "").trim().toUpperCase();
    const fromShop = String(body.from_shop || "").trim().toLowerCase();
    const toShop = String(body.to_shop || "").trim().toLowerCase();
    const qty = parseInt(body.quantity, 10) || 0;
    const remark = String(body.remark || "").trim();

    if (!itemCode || !fromShop || !toShop || qty <= 0) {
      return new Response(
        JSON.stringify({ success: false, message: "လွှဲပြောင်းမည့် အချက်အလက်များ မပြည့်စုံပါ။" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (fromShop === toShop) {
      return new Response(
        JSON.stringify({ success: false, message: "မူရင်းဆိုင်နှင့် လွှဲမည့်ဆိုင် မတူညီရပါ။" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const sourceInv = await db.prepare(
      "SELECT id, current_stock, cost_price FROM shop_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(fromShop, itemCode).first();

    if (!sourceInv || sourceInv.current_stock < qty) {
      return new Response(
        JSON.stringify({ success: false, message: `မူရင်းဆိုင်တွင် လက်ကျန် မလုံလောက်ပါ (လက်ရှိ: ${sourceInv ? sourceInv.current_stock : 0} ထည်)` }),
        { status: 400, headers: corsHeaders }
      );
    }

    await db.prepare(
      "UPDATE shop_inventory SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(qty, sourceInv.id).run();

    const destInv = await db.prepare(
      "SELECT id FROM shop_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(toShop, itemCode).first();

    if (destInv) {
      await db.prepare(
        "UPDATE shop_inventory SET current_stock = current_stock + ?, cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(qty, sourceInv.cost_price, destInv.id).run();
    } else {
      await db.prepare(
        "INSERT INTO shop_inventory (shop_id, item_code, current_stock, cost_price, remark, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
      ).bind(toShop, itemCode, qty, sourceInv.cost_price, `Transferred from ${fromShop.toUpperCase()}`).run();
    }

    try {
      await db.prepare(
        "INSERT INTO stock_transfers (item_code, from_shop, to_shop, quantity, remark) VALUES (?, ?, ?, ?, ?)"
      ).bind(itemCode, fromShop, toShop, qty, remark).run();
    } catch (e) {}

    return new Response(
      JSON.stringify({ success: true, message: `အထည် (${qty}) ထည်ကို ${toShop.toUpperCase()} သို့ အောင်မြင်စွာ လွှဲပြောင်းပြီးပါပြီ!` }),
      { headers: corsHeaders }
    );
  }

  if (action === "updateStock") {
    const shopId = String(body.shop_id || "main").trim().toLowerCase();
    const itemCode = String(body.item_code || "").trim().toUpperCase();
    const stock = Number(body.current_stock) || 0;
    const cost = Number(body.cost_price) || 0;
    const remark = String(body.remark || "").trim();

    const existingInv = await db.prepare(
      "SELECT id FROM shop_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(shopId, itemCode).first();

    if (existingInv) {
      await db.prepare(
        "UPDATE shop_inventory SET current_stock = ?, cost_price = ?, remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(stock, cost, remark, existingInv.id).run();
    } else {
      await db.prepare(
        "INSERT INTO shop_inventory (shop_id, item_code, current_stock, cost_price, remark, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
      ).bind(shopId, itemCode, stock, cost, remark).run();
    }

    return new Response(
      JSON.stringify({ success: true, message: "စတိုလက်ကျန် အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ!" }),
      { headers: corsHeaders }
    );
  }

  if (action === "deleteItem") {
    const shopId = String(body.shop_id || "main").trim().toLowerCase();
    const itemCode = String(body.item_code || "").trim().toUpperCase();

    await db.prepare(
      "DELETE FROM shop_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(shopId, itemCode).run();

    return new Response(
      JSON.stringify({ success: true, message: "ပစ္စည်း စာရင်း ဖျက်ပြီးပါပြီ!" }),
      { headers: corsHeaders }
    );
  }

  return null;
}
