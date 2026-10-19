/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - YARN STORE HANDLER
 * File: cashbook-api/handler.yarn.js
 * ==============================================================================
 */

export async function handleYarnAction(action, db, body, url, corsHeaders) {
  if (action === "getYarnInventory") {
    const shopId = String(body.shop_id || url.searchParams.get("shop_id") || "main").trim().toLowerCase();

    let query = "";
    if (shopId === "main") {
      query = `
        SELECT 
          y.id AS item_id,
          y.item_code,
          y.yarn_type,
          y.color_code,
          y.color_name,
          y.unit,
          COALESCE(y.retail_price, 0) AS retail_price,
          COALESCE(y.wholesale_price, 0) AS wholesale_price,
          COALESCE(s.current_stock, 0) AS current_stock,
          COALESCE(s.cost_price, 0) AS cost_price,
          COALESCE(s.remark, '') AS remark
        FROM yarn_items y
        LEFT JOIN yarn_inventory s 
          ON UPPER(y.item_code) = UPPER(s.item_code) AND LOWER(s.shop_id) = ?
        ORDER BY y.id ASC;
      `;
    } else {
      query = `
        SELECT 
          y.id AS item_id,
          y.item_code,
          y.yarn_type,
          y.color_code,
          y.color_name,
          y.unit,
          COALESCE(y.retail_price, 0) AS retail_price,
          COALESCE(y.wholesale_price, 0) AS wholesale_price,
          s.current_stock,
          s.cost_price,
          COALESCE(s.remark, '') AS remark
        FROM yarn_inventory s
        INNER JOIN yarn_items y 
          ON UPPER(y.item_code) = UPPER(s.item_code)
        WHERE LOWER(s.shop_id) = ?
        ORDER BY y.id ASC;
      `;
    }

    const { results } = await db.prepare(query).bind(shopId).all();
    return new Response(
      JSON.stringify({ success: true, shop_id: shopId, data: results || [] }),
      { headers: corsHeaders }
    );
  }

  if (action === "saveYarnItem") {
    const itemCode = String(body.item_code || "").trim().toUpperCase();
    const yarnType = String(body.yarn_type || "ယုံချည်").trim();
    const colorCode = String(body.color_code || "").trim();
    const colorName = String(body.color_name || "").trim();
    const unit = String(body.unit || "ထုပ်").trim();
    const retailPrice = Number(body.retail_price) || 0;
    const wholesalePrice = Number(body.wholesale_price) || 0;
    const remark = String(body.remark || "").trim();

    if (!itemCode || !colorName) {
      return new Response(
        JSON.stringify({ success: false, message: "ချည်ကုတ်နှင့် အရောင်အမည် ထည့်သွင်းပေးပါ။" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const existingItem = await db.prepare(
      "SELECT id FROM yarn_items WHERE UPPER(item_code) = ?"
    ).bind(itemCode).first();

    if (existingItem) {
      await db.prepare(`
        UPDATE yarn_items SET
          yarn_type = ?, color_code = ?, color_name = ?, unit = ?,
          retail_price = ?, wholesale_price = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(yarnType, colorCode, colorName, unit, retailPrice, wholesalePrice, remark, existingItem.id).run();
    } else {
      await db.prepare(`
        INSERT INTO yarn_items (item_code, yarn_type, color_code, color_name, unit, retail_price, wholesale_price, remark, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(itemCode, yarnType, colorCode, colorName, unit, retailPrice, wholesalePrice, remark).run();
    }

    if (body.shop_id) {
      const shopId = String(body.shop_id).trim().toLowerCase();
      const stock = Number(body.current_stock) || 0;
      const cost = Number(body.cost_price) || 0;

      const existingInv = await db.prepare(
        "SELECT id FROM yarn_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
      ).bind(shopId, itemCode).first();

      if (existingInv) {
        await db.prepare(
          "UPDATE yarn_inventory SET current_stock = ?, cost_price = ?, remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(stock, cost, remark || "Updated", existingInv.id).run();
      } else {
        await db.prepare(
          "INSERT INTO yarn_inventory (shop_id, item_code, current_stock, cost_price, remark, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ).bind(shopId, itemCode, stock, cost, remark || "Initial").run();
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: "ချည်နှင့် စတိုလက်ကျန် သိမ်းဆည်းပြီးပါပြီ!" }),
      { headers: corsHeaders }
    );
  }

  if (action === "transferYarnStock") {
    const itemCode = String(body.item_code || "").trim().toUpperCase();
    const fromShop = String(body.from_shop || "").trim().toLowerCase();
    const toShop = String(body.to_shop || "").trim().toLowerCase();
    const qty = Number(body.quantity) || 0;
    const remark = String(body.remark || "").trim();

    if (!itemCode || !fromShop || !toShop || qty <= 0) {
      return new Response(
        JSON.stringify({ success: false, message: "လွှဲပြောင်းမည့် အချက်အလက်များ မပြည့်စုံပါ။" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const sourceInv = await db.prepare(
      "SELECT id, current_stock, cost_price FROM yarn_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(fromShop, itemCode).first();

    if (!sourceInv || sourceInv.current_stock < qty) {
      return new Response(
        JSON.stringify({ success: false, message: `မူရင်းဆိုင်တွင် လက်ကျန် မလုံလောက်ပါ (လက်ရှိ: ${sourceInv ? sourceInv.current_stock : 0})` }),
        { status: 400, headers: corsHeaders }
      );
    }

    await db.prepare(
      "UPDATE yarn_inventory SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(qty, sourceInv.id).run();

    const destInv = await db.prepare(
      "SELECT id FROM yarn_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(toShop, itemCode).first();

    if (destInv) {
      await db.prepare(
        "UPDATE yarn_inventory SET current_stock = current_stock + ?, cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(qty, sourceInv.cost_price, destInv.id).run();
    } else {
      await db.prepare(
        "INSERT INTO yarn_inventory (shop_id, item_code, current_stock, cost_price, remark, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
      ).bind(toShop, itemCode, qty, sourceInv.cost_price, `Transferred from ${fromShop.toUpperCase()}`).run();
    }

    try {
      await db.prepare(
        "INSERT INTO yarn_transfers (item_code, from_shop, to_shop, quantity, remark) VALUES (?, ?, ?, ?, ?)"
      ).bind(itemCode, fromShop, toShop, qty, remark).run();
    } catch (e) {}

    return new Response(
      JSON.stringify({ success: true, message: `ချည် (${qty}) ကို ${toShop.toUpperCase()} သို့ အောင်မြင်စွာ လွှဲပြောင်းပြီးပါပြီ!` }),
      { headers: corsHeaders }
    );
  }

  if (action === "updateYarnStock") {
    const shopId = String(body.shop_id || "main").trim().toLowerCase();
    const itemCode = String(body.item_code || "").trim().toUpperCase();
    const stock = Number(body.current_stock) || 0;
    const cost = Number(body.cost_price) || 0;
    const remark = String(body.remark || "").trim();

    const existingInv = await db.prepare(
      "SELECT id FROM yarn_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(shopId, itemCode).first();

    if (existingInv) {
      await db.prepare(
        "UPDATE yarn_inventory SET current_stock = ?, cost_price = ?, remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(stock, cost, remark, existingInv.id).run();
    } else {
      await db.prepare(
        "INSERT INTO yarn_inventory (shop_id, item_code, current_stock, cost_price, remark, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
      ).bind(shopId, itemCode, stock, cost, remark).run();
    }

    return new Response(
      JSON.stringify({ success: true, message: "ချည်စတိုလက်ကျန် အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ!" }),
      { headers: corsHeaders }
    );
  }

  if (action === "deleteYarnItem") {
    const shopId = String(body.shop_id || "main").trim().toLowerCase();
    const itemCode = String(body.item_code || "").trim().toUpperCase();

    await db.prepare(
      "DELETE FROM yarn_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?"
    ).bind(shopId, itemCode).run();

    return new Response(
      JSON.stringify({ success: true, message: "ချည် စာရင်း ဖျက်ပြီးပါပြီ!" }),
      { headers: corsHeaders }
    );
  }

  return null;
}
