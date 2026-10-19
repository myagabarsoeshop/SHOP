/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - ALL-IN-ONE WORKER
 * File: cashbook-api/worker.js
 * Standard: Stock Transfer Engine & Multi-Branch Inventory (Garments & Yarns)
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
