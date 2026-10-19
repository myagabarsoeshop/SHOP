/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - CASHBOOK & INVOICING ENGINE
 * File: cashbook-frontend/js/cashbook.js
 * Standard: Multi-Branch Support, Split Payment, Category-First Cascading & Twin Print
 * ==============================================================================
 */

"use strict";

var cbPage = 1;
var cbLimit = 20;
var cbTotalRows = 0;
var cbActiveData = [];
var currentCashbookShop = "main";
var currentEntryMode = "sale"; // sale, purchase, expense, transfer
var lineItemsBuffer = [];
var searchTimeoutCb = null;
var isCbSubmitting = false;

// Preloaded inventory cache for instant stock display in modal
var cachedGarments = [];
var cachedYarns = [];

var SHOP_NAMES_MAP = {
  main: "Main Home Shop (ပင်မ)",
  shop1: "ဆိုင်ခွဲ (၁)",
  shop2: "ဆိုင်ခွဲ (၂)",
  shop3: "ဆိုင်ခွဲ (၃)",
  shop4: "ဆိုင်ခွဲ (၄)",
  shop5: "ဆိုင်ခွဲ (၅)"
};

function parseCleanNumber(val) {
  if (val === undefined || val === null || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  var str = String(val).replace(/[၀-၉]/g, function (d) {
    return d.charCodeAt(0) - 4160;
  }).replace(/,/g, "").trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function formatMoney(num) {
  return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 💡 Load Cashbook Entries from D1
 */
async function loadCashbookData(isSilent, forceRefresh) {
  var token = localStorage.getItem("golden_auth_token");
  if (!token) return;

  try {
    if (!isSilent && typeof toggleLoading === "function") toggleLoading(true);

    var fromDate = document.getElementById("cb-from-date")?.value || "";
    var toDate = document.getElementById("cb-to-date")?.value || "";
    var category = document.getElementById("cb-category-filter")?.value || "";

    var res = await callApi("getCashbookEntries", {
      shop_id: currentCashbookShop,
      from_date: fromDate,
      to_date: toDate,
      category: category,
      forceRefresh: forceRefresh
    });

    if (!res || !res.success) {
      throw new Error(res?.message || "ငွေစာရင်း ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    cbActiveData = res.data || [];
    cbTotalRows = cbActiveData.length;

    renderCashbookSummary(res.summary);
    renderTableCashbook();

  } catch (err) {
    console.error("Cashbook Load Error:", err);
    if (!isSilent && typeof showToast === "function") {
      showToast("ERROR", "ငွေစာရင်း ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === "function") toggleLoading(false);
  }
}

/**
 * 💡 Preload Garment and Yarn inventories to show real-time stock
 */
async function preloadShopInventoryForModal() {
  try {
    var resG = await callApi("getStoreInventory", { shop_id: currentCashbookShop });
    if (resG && resG.success) cachedGarments = resG.data || [];

    var resY = await callApi("getYarnInventory", { shop_id: currentCashbookShop });
    if (resY && resY.success) cachedYarns = resY.data || [];
  } catch (e) {}
}

/**
 * 💡 Render Top 4 KPI Cards (Income, Expense, Cash in Hand, Bank/KPay)
 */
function renderCashbookSummary(summary) {
  var inc = summary?.total_income || 0;
  var exp = summary?.total_expense || 0;
  var cash = summary?.cash_in_hand || 0;
  var bank = summary?.bank_balance || 0;

  var elInc = document.getElementById("cb-total-income");
  var elExp = document.getElementById("cb-total-expense");
  var elCash = document.getElementById("cb-cash-in-hand");
  var elBank = document.getElementById("cb-bank-balance");

  if (elInc) elInc.textContent = Number(inc).toLocaleString("en-US");
  if (elExp) elExp.textContent = Number(exp).toLocaleString("en-US");
  if (elCash) elCash.textContent = Number(cash).toLocaleString("en-US");
  if (elBank) elBank.textContent = Number(bank).toLocaleString("en-US");
}

/**
 * 💡 Render 11-Column Table
 */
function renderTableCashbook() {
  var tbody = document.getElementById("cb-table-body");
  if (!tbody) return;

  var searchInput = document.getElementById("cb-search");
  var q = (searchInput?.value || "").trim().toLowerCase();

  var filteredRows = cbActiveData.filter(function (row) {
    if (!q) return true;
    return String(row.description || "").toLowerCase().includes(q) ||
           String(row.category || "").toLowerCase().includes(q) ||
           String(row.voucher_no || "").toLowerCase().includes(q) ||
           String(row.bank_name || "").toLowerCase().includes(q);
  });

  var totalEntries = filteredRows.length;

  if (!filteredRows || totalEntries === 0) {
    var shopName = SHOP_NAMES_MAP[currentCashbookShop] || currentCashbookShop.toUpperCase();
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-10 text-slate-500 font-bold">${shopName} တွင် ငွေစာရင်း မရှိသေးပါ။</td></tr>`;
    updatePaginationUICb(0);
    return;
  }

  var totalPages = Math.ceil(totalEntries / cbLimit) || 1;
  if (cbPage > totalPages) cbPage = totalPages;
  var startIndex = (cbPage - 1) * cbLimit;
  var endIndex = Math.min(startIndex + cbLimit, totalEntries);
  var pageItems = filteredRows.slice(startIndex, endIndex);

  tbody.innerHTML = pageItems.map(function (row, idx) {
    var debit = Number(row.debit || 0);
    var credit = Number(row.credit || 0);

    var catBadge = typeof window.formatCategoryBadgeHtml === "function"
      ? window.formatCategoryBadgeHtml(row.category)
      : window.escapeHtml(row.category);

    var methodStr = row.bank_name && row.bank_amount > 0 && row.cash_amount > 0
      ? `Cash + ${row.bank_name}`
      : (row.bank_name && row.bank_amount > 0 ? row.bank_name : "Cash");

    return '<tr class="hover:bg-slate-800/30 text-slate-300">' +
        '<td class="text-center font-semibold text-slate-500 py-3 px-2">' + (startIndex + idx + 1) + '</td>' +
        '<td class="font-mono text-xs text-slate-300 py-3 px-2">' + (row.tx_date || "-") + '</td>' +
        '<td class="py-3 px-2">' + catBadge + '</td>' +
        '<td class="font-bold text-slate-100 max-w-sm truncate py-3 px-2" title="' + window.escapeHtml(row.description) + '">' + (window.escapeHtml(row.description) || "-") + '</td>' +
        '<td class="text-center font-bold text-slate-400 py-3 px-2 text-[11px]">' + window.escapeHtml(methodStr) + '</td>' +
        '<td class="text-right font-mono font-bold py-3 px-2 text-emerald-400">' + (debit > 0 ? formatMoney(debit) : "-") + '</td>' +
        '<td class="text-right font-mono font-bold py-3 px-2 text-rose-400">' + (credit > 0 ? formatMoney(credit) : "-") + '</td>' +
        '<td class="text-right font-mono font-bold py-3 px-2 text-slate-200">' + formatMoney(row.balance) + '</td>' +
        '<td class="text-center font-mono font-bold py-3 px-2 text-sky-400 text-xs">' + (row.transfer_target ? window.escapeHtml(row.transfer_target.toUpperCase()) : "-") + '</td>' +
        '<td class="font-mono text-xs font-bold text-amber-400 py-3 px-2">' + (window.escapeHtml(row.voucher_no) || "-") + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-2.5">' +
            '<!-- 🖨️ Print Voucher -->' +
            '<button onclick="CashbookEngine.openPrintVoucher(\'' + window.escapeJsAttr(row.voucher_no) + '\')" class="text-slate-300 hover:text-white transition" title="Print Voucher">' +
              '<i class="fa-solid fa-print"></i>' +
            '</button>' +
            '<!-- ✏️ Edit Entry -->' +
            '<button onclick="CashbookEngine.editEntry(' + row.id + ')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Entry">' +
              '<i class="fa-solid fa-pen-to-square"></i>' +
            '</button>' +
            '<!-- 🗑️ Delete Entry (Always Last) -->' +
            '<button onclick="CashbookEngine.removeEntry(' + row.id + ')" class="text-rose-400 hover:text-rose-300 transition" title="Delete Entry">' +
              '<i class="fa-solid fa-trash-can"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join("");

  updatePaginationUICb(totalEntries);
}

function updatePaginationUICb(currentCount) {
  var info = document.getElementById("cb-pagination-info");
  var totalToDisplay = (currentCount !== undefined) ? currentCount : cbTotalRows;

  if (info) {
    var start = totalToDisplay === 0 ? 0 : (cbPage - 1) * cbLimit + 1;
    var end = Math.min(cbPage * cbLimit, totalToDisplay);
    info.innerHTML = 'Showing <span class="text-indigo-400 font-extrabold">' + start + '</span> to <span class="text-indigo-400 font-extrabold">' + end + '</span> of <span class="text-indigo-400 font-extrabold">' + totalToDisplay + '</span> entries';
  }

  var prevBtn = document.getElementById("cb-btn-prev");
  if (prevBtn) prevBtn.disabled = (cbPage === 1);

  var nextBtn = document.getElementById("cb-btn-next");
  if (nextBtn) nextBtn.disabled = (cbPage * cbLimit >= totalToDisplay);
}

function changePageCb(dir) {
  var totalPages = Math.ceil(cbTotalRows / cbLimit) || 1;
  if (dir === -1 && cbPage > 1) {
    cbPage--;
    renderTableCashbook();
  } else if (dir === 1 && cbPage < totalPages) {
    cbPage++;
    renderTableCashbook();
  }
}

/**
 * 💡 Entry Modal Management
 */
function setEntryMode(mode) {
  currentEntryMode = mode;

  var tabs = ["sale", "purchase", "expense", "transfer"];
  tabs.forEach(t => {
    var btn = document.getElementById("tab-mode-" + t);
    if (!btn) return;
    btn.className = (t === mode)
      ? "py-2 rounded-lg text-center transition bg-indigo-600 text-white shadow"
      : "py-2 rounded-lg text-center transition text-slate-400 hover:text-white";
  });

  var itemSection = document.getElementById("cb-item-section");
  var transferSection = document.getElementById("cb-transfer-section");
  var purchasePricingRow = document.getElementById("cb-purchase-pricing-row");
  var labelDesc = document.getElementById("cb-label-desc");

  if (mode === "sale" || mode === "purchase") {
    if (itemSection) itemSection.classList.remove("hidden");
    if (transferSection) transferSection.classList.add("hidden");
    if (labelDesc) labelDesc.textContent = mode === "sale" ? "Customer Name (ဝယ်သူအမည်) *" : "Supplier Name (ရောင်းသူ/ဆိုင်အမည်) *";
    if (purchasePricingRow) {
      if (mode === "purchase") purchasePricingRow.classList.remove("hidden");
      else purchasePricingRow.classList.add("hidden");
    }
  } else if (mode === "transfer") {
    if (itemSection) itemSection.classList.add("hidden");
    if (transferSection) transferSection.classList.remove("hidden");
    if (labelDesc) labelDesc.textContent = "Transfer Description (ငွေလွှဲအကြောင်းအရာ) *";
    populateTransferDestinations();
  } else {
    // Expense
    if (itemSection) itemSection.classList.add("hidden");
    if (transferSection) transferSection.classList.add("hidden");
    if (labelDesc) labelDesc.textContent = "Expense Description (အသုံးစရိတ် အကြောင်းအရာ) *";
  }

  recalculateNetTotal();
}

function populateTransferDestinations() {
  var select = document.getElementById("cb-transfer-target");
  if (!select) return;

  var destinations = [
    { id: "main", name: "Main Home Shop (ပင်မ)" },
    { id: "shop1", name: "ဆိုင်ခွဲ (၁)" },
    { id: "shop2", name: "ဆိုင်ခွဲ (၂)" },
    { id: "shop3", name: "ဆိုင်ခွဲ (၃)" },
    { id: "shop4", name: "ဆိုင်ခွဲ (၄)" },
    { id: "shop5", name: "ဆိုင်ခွဲ (၅)" }
  ].filter(s => s.id !== currentCashbookShop);

  select.innerHTML = destinations.map(s => `<option value="${s.id}" class="bg-[#0c1424]">${s.name}</option>`).join("");
}

/**
 * 💡 Category-First Cascading Selector Logic
 */
function onCategorySelectChangeCb() {
  var catSelect = document.getElementById("cb-item-category-select");
  var itemSelect = document.getElementById("cb-item-select");
  var stockBadge = document.getElementById("cb-stock-badge");

  if (!catSelect || !itemSelect) return;
  var selectedCat = catSelect.value;

  itemSelect.innerHTML = '<option value="">-- ပစ္စည်း ရွေးရန် --</option>';
  if (stockBadge) stockBadge.textContent = "လက်ကျန်: -";

  if (!selectedCat) return;

  var isYarn = selectedCat.includes("ချည်");
  if (isYarn) {
    var items = cachedYarns.filter(y => y.yarn_type === selectedCat);
    items.forEach(y => {
      itemSelect.innerHTML += `<option value="${y.item_code}" data-type="yarn" data-retail="${y.retail_price}" data-wholesale="${y.wholesale_price}" data-cost="${y.cost_price}" data-stock="${y.current_stock}" data-unit="${y.unit || 'ထုပ်'}" class="bg-[#0c1424]">${y.item_code} - ${y.color_name} (${y.color_code})</option>`;
    });
  } else {
    var gItems = cachedGarments.filter(g => g.category === selectedCat);
    gItems.forEach(g => {
      itemSelect.innerHTML += `<option value="${g.item_code}" data-type="garment" data-retail="${g.retail_price}" data-wholesale="${g.wholesale_price}" data-cost="${g.cost_price}" data-stock="${g.current_stock}" data-unit="${g.unit || 'ထည်'}" class="bg-[#0c1424]">${g.item_code} - ${g.item_name}</option>`;
    });
  }
}

function onItemSelectChangeCb() {
  var itemSelect = document.getElementById("cb-item-select");
  var opt = itemSelect.selectedOptions[0];
  var stockBadge = document.getElementById("cb-stock-badge");
  var priceInput = document.getElementById("cb-line-price");

  if (!opt || !opt.value) {
    if (stockBadge) stockBadge.textContent = "လက်ကျန်: -";
    return;
  }

  var stock = Number(opt.getAttribute("data-stock") || 0);
  var unit = opt.getAttribute("data-unit") || "ခု";
  var retail = Number(opt.getAttribute("data-retail") || 0);
  var wholesale = Number(opt.getAttribute("data-wholesale") || 0);
  var cost = Number(opt.getAttribute("data-cost") || 0);

  if (stockBadge) {
    stockBadge.textContent = `လက်ရှိလက်ကျန်: ${stock} ${unit}`;
    stockBadge.className = stock > 0 ? "font-mono font-bold text-[11px] text-emerald-400" : "font-mono font-bold text-[11px] text-rose-400 animate-pulse";
  }

  if (currentEntryMode === "sale") {
    if (priceInput) priceInput.value = retail || wholesale || 0;
  } else if (currentEntryMode === "purchase") {
    if (priceInput) priceInput.value = cost || 0;
    var rEl = document.getElementById("cb-purchase-retail");
    var wEl = document.getElementById("cb-purchase-wholesale");
    if (rEl) rEl.value = retail || 0;
    if (wEl) wEl.value = wholesale || 0;
  }
}

function addLineItemToBill() {
  var itemSelect = document.getElementById("cb-item-select");
  var opt = itemSelect.selectedOptions[0];

  if (!opt || !opt.value) {
    alert("⚠️ ပစ္စည်း ရွေးချယ်ပေးပါ။");
    return;
  }

  var itemCode = opt.value;
  var itemType = opt.getAttribute("data-type") || "garment";
  var itemName = opt.text;
  var availableStock = Number(opt.getAttribute("data-stock") || 0);
  var unitPrice = parseCleanNumber(document.getElementById("cb-line-price")?.value);
  var qty = parseCleanNumber(document.getElementById("cb-line-qty")?.value);

  if (qty <= 0) {
    alert("⚠️ အရေအတွက် ထည့်သွင်းပေးပါ။");
    return;
  }

  // 🎯 STOCK VALIDATION GUARD: အရောင်းတွင် လက်ကျန်ထက် ကျော်ရောင်းမရအောင် တားမြစ်ခြင်း
  if (currentEntryMode === "sale") {
    if (availableStock <= 0) {
      alert(`⚠️ [${itemCode}] လက်ကျန် (၀) ဖြစ်နေသဖြင့် ရောင်းချ၍ မရပါ။`);
      return;
    }
    if (qty > availableStock) {
      alert(`⚠️ ဆိုင်ထဲတွင် လက်ကျန် (${availableStock}) သာ ရှိပါသည်။ အရေအတွက် (${qty}) ရောင်းချ၍ မရပါ။`);
      return;
    }
  }

  // အဝယ်တွင် ဈေးနှုန်း ၃ မျိုး စစ်ဆေးခြင်း
  var retailPrice = 0;
  var wholesalePrice = 0;
  var costPrice = 0;

  if (currentEntryMode === "purchase") {
    costPrice = unitPrice;
    retailPrice = parseCleanNumber(document.getElementById("cb-purchase-retail")?.value);
    wholesalePrice = parseCleanNumber(document.getElementById("cb-purchase-wholesale")?.value);

    if (costPrice <= 0 || retailPrice <= 0 || wholesalePrice <= 0) {
      alert("⚠️ မူရင်းဝယ်ဈေး၊ လက်လီဈေးနှင့် လက်ကားဈေးများကို သုညထက်ကြီးသော တန်ဖိုး မဖြစ်မနေ သတ်မှတ်ပေးရပါမည်။");
      return;
    }
  }

  var lineTotal = qty * unitPrice;

  lineItemsBuffer.push({
    item_code: itemCode,
    item_type: itemType,
    item_name: itemName,
    quantity: qty,
    unit_price: unitPrice,
    total_price: lineTotal,
    cost_price: costPrice,
    retail_price: retailPrice,
    wholesale_price: wholesalePrice
  });

  renderLineItemsTable();
}

function removeLineItem(index) {
  lineItemsBuffer.splice(index, 1);
  renderLineItemsTable();
}

function renderLineItemsTable() {
  var wrap = document.getElementById("cb-items-table-wrap");
  var tbody = document.getElementById("cb-line-items-body");

  if (!wrap || !tbody) return;

  if (lineItemsBuffer.length === 0) {
    wrap.classList.add("hidden");
    tbody.innerHTML = "";
    recalculateNetTotal();
    return;
  }

  wrap.classList.remove("hidden");
  tbody.innerHTML = lineItemsBuffer.map((l, i) => `
    <tr class="hover:bg-slate-800/40">
      <td class="p-2 font-mono">${window.escapeHtml(l.item_name)}</td>
      <td class="p-2 text-center font-bold text-sky-400">${l.quantity}</td>
      <td class="p-2 text-right font-mono">${formatMoney(l.unit_price)}</td>
      <td class="p-2 text-right font-mono font-bold text-emerald-400">${formatMoney(l.total_price)}</td>
      <td class="p-2 text-center">
        <button type="button" onclick="CashbookEngine.removeLineItem(${i})" class="text-rose-400 hover:text-rose-300"><i class="fa-solid fa-xmark"></i></button>
      </td>
    </tr>
  `).join("");

  recalculateNetTotal();
}

function recalculateNetTotal() {
  var subtotal = 0;

  if (currentEntryMode === "sale" || currentEntryMode === "purchase") {
    subtotal = lineItemsBuffer.reduce((sum, item) => sum + item.total_price, 0);
  } else if (currentEntryMode === "transfer") {
    subtotal = parseCleanNumber(document.getElementById("cb-transfer-amount")?.value);
  } else {
    // Expense
    subtotal = parseCleanNumber(document.getElementById("cb-bill-subtotal")?.value);
  }

  var discount = parseCleanNumber(document.getElementById("cb-bill-discount")?.value);
  var netTotal = Math.max(0, subtotal - discount);

  var subEl = document.getElementById("cb-bill-subtotal");
  var netEl = document.getElementById("cb-bill-net");
  var cashPay = document.getElementById("cb-pay-cash");
  var bankPay = document.getElementById("cb-pay-bank");

  if (subEl) subEl.value = subtotal;
  if (netEl) netEl.value = netTotal;

  // Auto assign payment: Default to Cash or Bank
  if (cashPay && bankPay) {
    if (parseCleanNumber(cashPay.value) === 0 && parseCleanNumber(bankPay.value) === 0) {
      cashPay.value = netTotal;
    }
  }
}

function onPaymentInputChange(type) {
  var netTotal = parseCleanNumber(document.getElementById("cb-bill-net")?.value);
  var cashEl = document.getElementById("cb-pay-cash");
  var bankEl = document.getElementById("cb-pay-bank");

  if (type === "cash") {
    var cash = parseCleanNumber(cashEl.value);
    bankEl.value = Math.max(0, netTotal - cash);
  } else {
    var bank = parseCleanNumber(bankEl.value);
    cashEl.value = Math.max(0, netTotal - bank);
  }
}

function openEntryModalCb() {
  lineItemsBuffer = [];
  document.getElementById("cb-form-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("cb-form-shop-display").value = SHOP_NAMES_MAP[currentCashbookShop] || currentCashbookShop.toUpperCase();
  document.getElementById("cb-form-vrno").value = "VR-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(100 + Math.random() * 900);
  document.getElementById("cb-form-desc").value = "";
  document.getElementById("cb-bill-subtotal").value = 0;
  document.getElementById("cb-bill-discount").value = 0;
  document.getElementById("cb-bill-net").value = 0;
  document.getElementById("cb-pay-cash").value = 0;
  document.getElementById("cb-pay-bank").value = 0;

  preloadShopInventoryForModal();
  setEntryMode("sale");
  renderLineItemsTable();

  var modal = document.getElementById("cb-entry-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeEntryModalCb() {
  var modal = document.getElementById("cb-entry-modal");
  if (modal) modal.classList.add("hidden");
}

async function saveEntrySubmitCb(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isCbSubmitting) return;

  var dateVal = document.getElementById("cb-form-date")?.value;
  var vrNo = document.getElementById("cb-form-vrno")?.value;
  var desc = document.getElementById("cb-form-desc")?.value.trim();
  var subtotal = parseCleanNumber(document.getElementById("cb-bill-subtotal")?.value);
  var discount = parseCleanNumber(document.getElementById("cb-bill-discount")?.value);
  var netTotal = parseCleanNumber(document.getElementById("cb-bill-net")?.value);
  var cashAmt = parseCleanNumber(document.getElementById("cb-pay-cash")?.value);
  var bankAmt = parseCleanNumber(document.getElementById("cb-pay-bank")?.value);
  var bankName = document.getElementById("cb-pay-bank-name")?.value;

  if (currentEntryMode === "sale" || currentEntryMode === "purchase") {
    if (lineItemsBuffer.length === 0) {
      alert("⚠️ ဘောင်ချာထဲသို့ အနည်းဆုံး ပစ္စည်း (၁) မျိုး ထည့်သွင်းပေးပါ။");
      return;
    }
  }

  if (netTotal <= 0 && currentEntryMode !== "transfer") {
    alert("⚠️ ကျသင့်ငွေ မရှိပါ။");
    return;
  }

  // 🎯 SPLIT PAYMENT VALIDATION: ငွေသား + ဘဏ် = စုစုပေါင်းကျသင့်ငွေ တိကျစွာ ကိုက်ညီရမည်
  if (Math.abs((cashAmt + bankAmt) - netTotal) > 0.01) {
    alert(`⚠️ ပေးချေငွေ မကိုက်ညီပါ! ကျသင့်ငွေ (${netTotal}) နှင့် ပေးချေငွေ (ငွေသား: ${cashAmt} + ဘဏ်: ${bankAmt} = ${cashAmt + bankAmt}) တူညီရပါမည်။`);
    return;
  }

  isCbSubmitting = true;

  var categoryName = "အရောင်း";
  if (currentEntryMode === "purchase") categoryName = "အဝယ်";
  if (currentEntryMode === "expense") categoryName = "အသုံးစရိတ်";
  if (currentEntryMode === "transfer") categoryName = "ငွေလွှဲ";

  var payload = {
    shop_id: currentCashbookShop,
    tx_date: dateVal,
    category: categoryName,
    description: desc,
    voucher_no: vrNo,
    subtotal: subtotal,
    discount: discount,
    net_total: netTotal,
    cash_amount: cashAmt,
    bank_amount: bankAmt,
    bank_name: bankName,
    transfer_target: document.getElementById("cb-transfer-target")?.value || "",
    items: lineItemsBuffer
  };

  try {
    closeEntryModalCb();
    if (typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("saveCashbookEntry", payload);
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", res.message || "စာရင်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ!");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadCashbookData(true, true);
    } else {
      throw new Error(res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    console.error("Save Entry Error:", err);
    if (typeof showToast === "function") showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isCbSubmitting = false;
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

async function removeEntryCb(id) {
  if (!confirm("⚠️ ဤငွေစာရင်းကို အမှန်တကယ် ဖျက်မှာ သေချာပါသလား? (စတိုထဲက ပစ္စည်းလက်ကျန်များပါ အလိုအလျောက် ပြန်လည် ထိန်းညှိပေးသွားပါမည်)")) return;

  try {
    if (typeof toggleLoading === "function") toggleLoading(true);
    var res = await callApi("deleteCashbookEntry", { id: id });
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", "ငွေစာရင်း ဖျက်ပြီး စတိုလက်ကျန် ပြန်ညှိပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadCashbookData(true, true);
    } else {
      throw new Error(res?.message || "ဖျက်ဆီးမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

/**
 * 💡 A5 Twin Slip (2-in-1 on A4 Landscape) Voucher Print
 */
async function openPrintVoucherCb(voucherNo) {
  if (!voucherNo) return;

  try {
    if (typeof toggleLoading === "function") toggleLoading(true);
    var res = await callApi("getVoucherDetails", { voucher_no: voucherNo });

    if (!res || !res.success || !res.voucher) {
      alert("ဘောင်ချာ အချက်အလက် မတွေ့ရှိပါ။");
      return;
    }

    var v = res.voucher;
    var items = res.items || [];
    var area = document.getElementById("cb-printable-area");

    function renderSlipHalf(title) {
      var itemRows = items.map((it, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 6px 4px; text-align: center;">${idx + 1}</td>
          <td style="padding: 6px 4px;"><strong>${window.escapeHtml(it.item_name)}</strong> (${window.escapeHtml(it.item_code)})</td>
          <td style="padding: 6px 4px; text-align: center;">${it.quantity} ${it.unit}</td>
          <td style="padding: 6px 4px; text-align: right;">${Number(it.unit_price).toLocaleString()}</td>
          <td style="padding: 6px 4px; text-align: right; font-weight: bold;">${Number(it.total_price).toLocaleString()}</td>
        </tr>
      `).join("");

      return `
        <div style="flex: 1; padding: 12px; border: 1px dashed #cbd5e1; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 8px;">
              <h2 style="font-size: 14px; font-weight: 900; margin: 0; color: #0f172a;">မြကမ္ဘာစိုး ပိုးထည်တိုက်</h2>
              <p style="font-size: 10px; color: #64748b; margin: 2px 0 0 0;">${title}</p>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 8px;">
              <div>
                <p style="margin: 0;"><strong>ဘောင်ချာ:</strong> ${v.voucher_no}</p>
                <p style="margin: 2px 0 0 0;"><strong>ဝယ်သူ:</strong> ${window.escapeHtml(v.description)}</p>
              </div>
              <div style="text-align: right;">
                <p style="margin: 0;"><strong>ရက်စွဲ:</strong> ${v.tx_date}</p>
                <p style="margin: 2px 0 0 0;"><strong>ဆိုင်:</strong> ${SHOP_NAMES_MAP[v.shop_id] || v.shop_id.toUpperCase()}</p>
              </div>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
              <thead>
                <tr style="background: #f1f5f9; border-bottom: 1.5px solid #0f172a;">
                  <th style="padding: 4px; text-align: center; width: 24px;">စဉ်</th>
                  <th style="padding: 4px;">ပစ္စည်း</th>
                  <th style="padding: 4px; text-align: center;">ခုရေ</th>
                  <th style="padding: 4px; text-align: right;">နှုန်း</th>
                  <th style="padding: 4px; text-align: right;">သင့်ငွေ</th>
                </tr>
              </thead>
              <tbody>${itemRows}</tbody>
            </table>
          </div>

          <div style="margin-top: 12px; border-top: 1.5px solid #0f172a; padding-top: 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 10px;">
              <span>စုစုပေါင်းငွေ:</span>
              <span>${Number(v.subtotal).toLocaleString()} ကျပ်</span>
            </div>
            ${v.discount > 0 ? `
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #e11d48;">
              <span>လျှော့ငွေ (Discount):</span>
              <span>- ${Number(v.discount).toLocaleString()} ကျပ်</span>
            </div>` : ""}
            <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; margin-top: 2px; border-top: 1px solid #e2e8f0; padding-top: 2px;">
              <span>အသားတင် ကျသင့်ငွေ:</span>
              <span style="color: #059669;">${Number(v.net_total).toLocaleString()} ကျပ်</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: #64748b; margin-top: 4px;">
              <span>ငွေပေးချေမှု: ငွေသား (${Number(v.cash_amount).toLocaleString()}) + ${v.bank_name || 'Bank'} (${Number(v.bank_amount).
