/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - CASHBOOK & VOUCHER HANDLER
 * File: cashbook-api/handler.cashbook.js
 * ==============================================================================
 */

export async function handleCashbookAction(action, db, body, url, corsHeaders) {
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

  if (action === "saveCashbookEntry") {
    const shopId = String(body.shop_id || "main").trim().toLowerCase();
    const txDate = String(body.tx_date || new Date().toISOString().slice(0, 10)).trim();
    const myVal = String(body.my || "").trim();
    const category = String(body.category || "အရောင်း").trim();
    const subCategoryVal = String(body.sub_category || "").trim();
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
        shop_id, tx_date, my, category, sub_category, description, voucher_no,
        subtotal, discount, net_total, cash_amount, bank_amount,
        bank_name, debit, credit, transfer_target, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);
    `).bind(
      shopId, txDate, myVal, category, subCategoryVal, description, voucherNo,
      subtotal, discount, netTotal, cashAmount, bankAmount,
      bankName, debit, credit, transferTarget
    ).run();

    if (category.includes("ငွေလွှဲ") && transferTarget) {
      const destShopId = transferTarget.trim().toLowerCase();
      await db.prepare(`
        INSERT INTO cashbook (
          shop_id, tx_date, my, category, sub_category, description, voucher_no,
          subtotal, discount, net_total, cash_amount, bank_amount,
          bank_name, debit, credit, transfer_target, created_at
        ) VALUES (?, ?, ?, 'ငွေလွှဲ (အဝင်)', '', ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP);
      `).bind(
        destShopId, txDate, myVal, `${shopId.toUpperCase()} မှ လွှဲပြောင်းရရှိငွေ`, `${voucherNo}-TR`,
        netTotal, netTotal, netTotal, cashAmount, bankAmount, bankName, netTotal, shopId
      ).run();
    }

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

        if (isSale) {
          if (itemType === "yarn") {
            await db.prepare("UPDATE yarn_inventory SET current_stock = current_stock + ? WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(qty, shopId, itemCode).run();
          } else {
            await db.prepare("UPDATE shop_inventory SET current_stock = current_stock + ? WHERE LOWER(shop_id) = ? AND UPPER(item_code) = ?").bind(qty, shopId, itemCode).run();
          }
        }

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

  return null;
}
