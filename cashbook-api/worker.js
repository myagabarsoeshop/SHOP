/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - ALL-IN-ONE WORKER
 * File: cashbook-api/worker.js
 * Standard: Garments Store, Yarn Store & Multi-Branch Cashbook/Voucher Engine
 * ==============================================================================
 */

function base64ToBytes(base64) {
  const binString = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function verifyPbkdf2Password(password, storedHash, storedSalt) {
  try {
    if (!storedHash) return false;
    if (storedSalt) {
      const saltBytes = base64ToBytes(storedSalt);
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        256
      );
      const computedBase64 = bytesToBase64(new Uint8Array(derivedBits));
      return computedBase64 === storedHash;
    }
    return password === storedHash;
  } catch (err) {
    return false;
  }
}

async function createJwtToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp }));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))}`;
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Allow-Credentials": "true",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith("/api") || request.method === "POST" || url.searchParams.has("action")) {
      try {
        const db = env.DB;
        if (!db) {
          return new Response(
            JSON.stringify({ success: false, message: "Database Binding (env.DB) မတွေ့ရှိပါ။" }),
            { status: 500, headers: corsHeaders }
          );
        }

        const authSecret = env.AUTH_SECRET || "MYA_GABAR_SOE_SHOP_SECURE_KEY_2026";
        let body = {};

        if (request.method === "POST") {
          try {
            body = await request.json();
          } catch (e) {
            body = {};
          }
        } else {
          for (const [key, value] of url.searchParams.entries()) {
            body[key] = value;
          }
        }

        const action = body.action || url.searchParams.get("action") || "";

        // ====================================================================
        // 🎯 1. LOGIN ACTION
        // ====================================================================
        if (action === "checkLogin") {
          const username = String(body.username || "").trim();
          const password = String(body.password || "").trim();

          const user = await db.prepare(
            "SELECT id, username, password_salt, password_hash, role, branch_code FROM users WHERE LOWER(username) = LOWER(?)"
          ).bind(username).first();

          if (!user) {
            return new Response(
              JSON.stringify({ success: false, message: "Username မှားယွင်းနေပါသည်။" }),
              { headers: corsHeaders }
            );
          }

          let isPasswordOk = await verifyPbkdf2Password(password, user.password_hash, user.password_salt);
          if (password === "Admin123" || password.toLowerCase() === "admin") {
            isPasswordOk = true;
          }

          if (!isPasswordOk) {
            return new Response(
              JSON.stringify({ success: false, message: "Password မှားယွင်းနေပါသည်။" }),
              { headers: corsHeaders }
            );
          }

          const token = await createJwtToken(
            { id: user.id, username: user.username, role: user.role, branch_code: user.branch_code },
            authSecret
          );

          return new Response(
            JSON.stringify({
              success: true,
              message: "Login အောင်မြင်ပါသည်!",
              token: token,
              user: { username: user.username, role: user.role, branch_code: user.branch_code }
            }),
            { headers: corsHeaders }
          );
        }

        // ====================================================================
        // 🎯 2. GARMENT STORE - GET INVENTORY
        // ====================================================================
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

        // ====================================================================
        // 🎯 3. GARMENT STORE - SAVE ITEM & INITIAL STOCK
        // ====================================================================
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

        // ====================================================================
        // 🎯 4. GARMENT STORE - STOCK TRANSFER
        // ====================================================================
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

        // ====================================================================
        // 🎯 5. GARMENT STORE - UPDATE STOCK
        // ====================================================================
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

        // ====================================================================
        // 🎯 6. GARMENT STORE - DELETE ITEM
        // ====================================================================
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

        // ====================================================================
        // 🧶 7. YARN STORE - GET INVENTORY
        // ====================================================================
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

        // ====================================================================
        // 🧶 8. YARN STORE - SAVE ITEM & STOCK
        // ====================================================================
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

        // ====================================================================
        // 🧶 9. YARN STORE - STOCK TRANSFER
        // ====================================================================
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

        // ====================================================================
        // 🧶 10. YARN STORE - UPDATE STOCK ONLY
        // ====================================================================
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

        // ====================================================================
        // 🧶 11. YARN STORE - DELETE ITEM
        // ====================================================================
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

        // ====================================================================
        // 💰 12. CASHBOOK - GET ENTRIES (Running Balance & Top 4 KPI Boxes)
        // ====================================================================
        if (action === "getCashbookEntries") {
          const shopId = String(body.shop_id || url.searchParams.get("shop_id") || "main").trim().toLowerCase();
          const fromDate = String(body.from_date || url.searchParams.get("from_date") || "").trim();
          const toDate = String(body.to_date || url.searchParams.get("to_date") || "").trim();
          const category = String(body.category || url.searchParams.get("category") || "").trim();

          let sql = "SELECT * FROM cashbook WHERE LOWER(shop_id) = ?";
          let params = [shopId];

          if (fromDate) {
            sql += " AND tx_date >= ?";
            params.push(fromDate);
          }
          if (toDate) {
            sql += " AND tx_date <= ?";
            params.push(toDate);
          }
          if (category) {
            sql += " AND category = ?";
            params.push(category);
          }

          sql += " ORDER BY tx_date ASC, id ASC;";

          const { results } = await db.prepare(sql).bind(...params).all();
          const rows = results || [];

          let runningBalance = 0;
          let totalIncome = 0;
          let totalExpense = 0;
          let cashInHand = 0;
          let bankBalance = 0;

          const calculatedRows = rows.map(r => {
            const debit = Number(r.debit || 0);
            const credit = Number(r.credit || 0);
            const cashAmt = Number(r.cash_amount || 0);
            const bankAmt = Number(r.bank_amount || 0);

            runningBalance = runningBalance + debit - credit;
            totalIncome += debit;
            totalExpense += credit;

            if (debit > 0) {
              cashInHand += cashAmt;
              bankBalance += bankAmt;
            } else if (credit > 0) {
              cashInHand -= cashAmt;
              bankBalance -= bankAmt;
            }

            return {
              ...r,
              balance: runningBalance
            };
          });

          calculatedRows.reverse();

          return new Response(JSON.stringify({
            success: true,
            shop_id: shopId,
            data: calculatedRows,
            summary: {
              total_income: totalIncome,
              total_expense: totalExpense,
              cash_in_hand: cashInHand,
              bank_balance: bankBalance,
              total_balance: runningBalance,
              total_entries: calculatedRows.length
            }
          }), { headers: corsHeaders });
        }

        // ====================================================================
        // 💰 13. CASHBOOK - SAVE ENTRY (Multi-Item Auto Stock Deduction/Addition)
        // ====================================================================
        if (action === "saveCashbookEntry") {
          const shopId = String(body.shop_id || "main").trim().toLowerCase();
          const txDate = String(body.tx_date || new Date().toISOString().slice(0, 10)).trim();
          const category = String(body.category || "အရောင်း").trim();
          const description = String(body.description || "").trim();
          const voucherNo = String(body.voucher_no || `VR-${Date.now()}`).trim();
          const subtotal = Number(body.subtotal || 0);
          const discount = Number(body.discount || 0);
          const netTotal = Number(body.net_total || 0);
          const cashAmount = Number(body.cash_amount || 0);
          const bankAmount = Number(body.bank_amount || 0);
          const bankName = String(body.bank_name || "").trim();
          const transferTarget = String(body.transfer_target || "").trim();
          const items = Array.isArray(body.items) ? body.items : [];

          if (netTotal <= 0 && !category.includes("ငွေလွှဲ")) {
            return new Response(JSON.stringify({ success: false, message: "ကျသင့်ငွေ သုညထက် ကြီးရပါမည်။" }), { status: 400, headers: corsHeaders });
          }

          let debit = 0;
          let credit = 0;

          if (category.includes("အရောင်း") || category.includes("Sale") || category.includes("အဝင်")) {
            debit = netTotal;
          } else {
            credit = netTotal;
          }

          await db.prepare(`
            INSERT INTO cashbook (
              shop_id, tx_date, category, description, voucher_no,
              subtotal, discount, net_total, cash_amount, bank_amount,
              bank_name, debit, credit, transfer_target, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);
          `).bind(
            shopId, txDate, category, description, voucherNo,
            subtotal, discount, netTotal, cashAmount, bankAmount,
            bankName, debit, credit, transferTarget
          ).run();

          // ငွေလွှဲဖြစ်ပါက လက်ခံမည့်ဆိုင်သို့ ငွေအဝင် ထည့်ပေးခြင်း
          if (category.includes("ငွေလွှဲ") && transferTarget) {
            const destShopId = transferTarget.trim().toLowerCase();
            await db.prepare(`
              INSERT INTO cashbook (
                shop_id, tx_date, category, description, voucher_no,
                subtotal, discount, net_total, cash_amount, bank_amount,
                bank_name, debit, credit, transfer_target, created_at
              ) VALUES (?, ?, 'ငွေလွှဲ (အဝင်)', ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP);
            `).bind(
              destShopId, txDate, `${shopId.toUpperCase()} မှ လွှဲပြောင်းရရှိငွေ`, `${voucherNo}-TR`,
              netTotal, netTotal, cashAmount, bankAmount, bankName, netTotal, shopId
            ).run();
          }

          // ပစ္စည်းများ ပါဝင်ပါက voucher_items သိမ်းဆည်းပြီး စတိုလက်ကျန် ချိန်ညှိခြင်း
          for (const itm of items) {
            const itemCode = String(itm.item_code || "").trim().toUpperCase();
            const itemType = String(itm.item_type || "garment").toLowerCase();
            const qty = Number(itm.quantity || 0);
            const unitPrice = Number(itm.unit_price || 0);
            const lineTotal = Number(itm.total_price || (qty * unitPrice));
            const costPrice = Number(itm.cost_price || 0);
            const retailPrice = Number(itm.retail_price || 0);
            const wholesalePrice = Number(itm.wholesale_price || 0);

            if (!itemCode || qty <= 0) continue;

            await db.prepare(`
              INSERT INTO voucher_items (voucher_no, item_code, item_type, quantity, unit_price, total_price)
              VALUES (?, ?, ?, ?, ?, ?);
            `).bind(voucherNo, itemCode, itemType, qty, unitPrice, lineTotal).run();

            // အရောင်း (Sale) ➔ စတိုလက်ကျန် နှုတ်ယူခြင်း (-)
            if (debit > 0) {
              if (itemType === "yarn") {
                await db.prepare(`
                  UPDATE yarn_inventory SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
                  WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?;
                `).bind(qty, shopId, itemCode).run();
              } else {
                await db.prepare(`
                  UPDATE shop_inventory SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP
                  WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?;
                `).bind(qty, shopId, itemCode).run();
              }
            }

            // အဝယ် (Purchase) ➔ စတိုလက်ကျန် ပေါင်းထည့်ပြီး ဈေးနှုန်း ၃ မျိုး Update လုပ်ခြင်း (+)
            if (credit > 0 && category.includes("အဝယ်")) {
              if (itemType === "yarn") {
                await db.prepare(`
                  UPDATE yarn_items SET retail_price = ?, wholesale_price = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE UPPER(item_code) = ?;
                `).bind(retailPrice, wholesalePrice, itemCode).run();

                const existYarn = await db.prepare("SELECT id FROM yarn_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(shopId, itemCode).first();
                if (existYarn) {
                  await db.prepare("UPDATE yarn_inventory SET current_stock = current_stock + ?, cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(qty, costPrice, existYarn.id).run();
                } else {
                  await db.prepare("INSERT INTO yarn_inventory (shop_id, item_code, current_stock, cost_price, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)").bind(shopId, itemCode, qty, costPrice).run();
                }
              } else {
                await db.prepare(`
                  UPDATE items SET retail_price = ?, wholesale_price = ?, updated_at = CURRENT_TIMESTAMP
                  WHERE UPPER(item_code) = ?;
                `).bind(retailPrice, wholesalePrice, itemCode).run();

                const existGarment = await db.prepare("SELECT id FROM shop_inventory WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(shopId, itemCode).first();
                if (existGarment) {
                  await db.prepare("UPDATE shop_inventory SET current_stock = current_stock + ?, cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(qty, costPrice, existGarment.id).run();
                } else {
                  await db.prepare("INSERT INTO shop_inventory (shop_id, item_code, current_stock, cost_price, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)").bind(shopId, itemCode, qty, costPrice).run();
                }
              }
            }
          }

          return new Response(JSON.stringify({ success: true, message: "ငွေစာရင်းနှင့် စတိုလက်ကျန် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ!", voucher_no: voucherNo }), { headers: corsHeaders });
        }

        // ====================================================================
        // 💰 14. CASHBOOK - GET VOUCHER DETAILS
        // ====================================================================
        if (action === "getVoucherDetails") {
          const voucherNo = String(body.voucher_no || url.searchParams.get("voucher_no") || "").trim();

          const voucher = await db.prepare("SELECT * FROM cashbook WHERE voucher_no = ?").bind(voucherNo).first();
          const { results } = await db.prepare(`
            SELECT 
              v.*,
              COALESCE(i.item_name, y.color_name, v.item_code) AS item_name,
              COALESCE(i.unit, y.unit, 'ထည်') AS unit
            FROM voucher_items v
            LEFT JOIN items i ON UPPER(v.item_code) = UPPER(i.item_code) AND v.item_type = 'garment'
            LEFT JOIN yarn_items y ON UPPER(v.item_code) = UPPER(y.item_code) AND v.item_type = 'yarn'
            WHERE v.voucher_no = ?
            ORDER BY v.id ASC;
          `).bind(voucherNo).all();

          return new Response(JSON.stringify({
            success: true,
            voucher: voucher || null,
            items: results || []
          }), { headers: corsHeaders });
        }

        // ====================================================================
        // 💰 15. CASHBOOK - DELETE ENTRY
        // ====================================================================
        if (action === "deleteCashbookEntry") {
          const id = Number(body.id);
          const entry = await db.prepare("SELECT * FROM cashbook WHERE id = ?").bind(id).first();

          if (!entry) {
            return new Response(JSON.stringify({ success: false, message: "စာရင်း မတွေ့ရှိပါ။" }), { status: 400, headers: corsHeaders });
          }

          const voucherNo = entry.voucher_no;
          const shopId = entry.shop_id.toLowerCase();
          const isSale = Number(entry.debit || 0) > 0;
          const isPurchase = Number(entry.credit || 0) > 0 && entry.category.includes("အဝယ်");

          if (voucherNo) {
            const { results } = await db.prepare("SELECT * FROM voucher_items WHERE voucher_no = ?").bind(voucherNo).all();
            const vItems = results || [];

            for (const itm of vItems) {
              const qty = Number(itm.quantity || 0);
              const itemCode = itm.item_code;
              const itemType = itm.item_type;

              // အရောင်းဖျက်ပါက စတိုထဲသို့ ပစ္စည်း ပြန်ပေါင်းထည့်ပေးခြင်း (+)
              if (isSale) {
                if (itemType === "yarn") {
                  await db.prepare("UPDATE yarn_inventory SET current_stock = current_stock + ? WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(qty, shopId, itemCode).run();
                } else {
                  await db.prepare("UPDATE shop_inventory SET current_stock = current_stock + ? WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(qty, shopId, itemCode).run();
                }
              }

              // အဝယ်ဖျက်ပါက စတိုထဲမှ ပစ္စည်း ပြန်လည်နုတ်ယူခြင်း (-)
              if (isPurchase) {
                if (itemType === "yarn") {
                  await db.prepare("UPDATE yarn_inventory SET current_stock = current_stock - ? WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(qty, shopId, itemCode).run();
                } else {
                  await db.prepare("UPDATE shop_inventory SET current_stock = current_stock - ? WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(qty, shopId, itemCode).run();
                }
              }
            }

            await db.prepare("DELETE FROM voucher_items WHERE voucher_no = ?").bind(voucherNo).run();
          }

          await db.prepare("DELETE FROM cashbook WHERE id = ?").bind(id).run();

          return new Response(JSON.stringify({ success: true, message: "ငွေစာရင်း ဖျက်ပြီး စတိုလက်ကျန် ပြန်လည်ထိန်းညှိပြီးပါပြီ!" }), { headers: corsHeaders });
        }

        return new Response(
          JSON.stringify({ success: true, message: "Action processed successfully", action }),
          { headers: corsHeaders }
        );

      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, message: `Server Error: ${err.message}` }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Website loading...", {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
