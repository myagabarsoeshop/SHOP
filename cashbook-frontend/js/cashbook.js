/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - MULTI-BRANCH CASHBOOK & INVOICING ENGINE
 * File: cashbook-frontend/js/cashbook.js
 * Standard: Split Payment (Cash + Bank), Discount, Subcategory, Auto MY & A5 Twin Print
 * 💡 Features: 🛡️ Resilient Dual-Token Auth, Graceful 401 Session Expiry Catch,
 *              Full Edit Modal & Twin Invoice Print Engine
 * ==============================================================================
 */

"use strict";

var cbPage = 1;
var cbLimit = 20;
var cbTotalRows = 0;
var cbActiveData = [];
var currentCashbookShop = "main";
var currentMode = "sale";
var currentBillItems = [];
var storeGarmentItems = [];
var storeYarnItems = [];
var searchTimeoutCb = null;
var isCbSubmitting = false;
var editingEntryId = null;

var ALL_CB_SHOPS = [
  { id: "main", name: "Main Home Shop (ပင်မ)" },
  { id: "shop1", name: "ဆိုင်ခွဲ (၁)" },
  { id: "shop2", name: "ဆိုင်ခွဲ (၂)" },
  { id: "shop3", name: "ဆိုင်ခွဲ (၃)" },
  { id: "shop4", name: "ဆိုင်ခွဲ (၄)" },
  { id: "shop5", name: "ဆိုင်ခွဲ (၅)" }
];

// 💡 Auth Token ရယူခြင်း (token သို့မဟုတ် golden_auth_token နှစ်မျိုးလုံး ထောက်ပံ့သည်)
function getCbAuthToken() {
  return localStorage.getItem("token") || localStorage.getItem("golden_auth_token") || "";
}

// 💡 နေ့စွဲမှ Month-Year (ဥပမာ - Oct 26) အလိုအလျောက် ထုတ်ပေးသည့် ဖန်ရှင်
function getMonthYearString(dateString) {
  if (!dateString) return "";
  var date = new Date(dateString);
  if (isNaN(date.getTime())) return "";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var m = months[date.getMonth()];
  var y = String(date.getFullYear()).slice(-2);
  return m + " " + y;
}

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

// 💡 ငွေစာရင်း ဒေတာများ ဆွဲယူခြင်း
async function loadCashbookData(isSilent, forceRefresh) {
  var token = getCbAuthToken();
  if (!token) {
    console.warn("[Cashbook] Token မရှိသေးသဖြင့် ဒေတာ ခေါ်ယူခြင်းကို ရပ်တန့်ထားပါသည်။");
    if (typeof showLogin === "function") showLogin();
    return;
  }

  var category = document.getElementById("cb-category-filter")?.value || "";

  try {
    if (!isSilent && typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("getCashbookEntries", {
      shop_id: currentCashbookShop,
      branch: currentCashbookShop, // Worker Compatibility အတွက် ပူးတွဲပေးပို့ခြင်း
      category: category,
      forceRefresh: forceRefresh
    });

    if (!res || !res.success) {
      throw new Error(res?.message || "ငွေစာရင်း ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    cbActiveData = res.data || [];
    cbTotalRows = cbActiveData.length;

    renderStatsCashbook(res.summary);
    renderTableCashbook();

  } catch (err) {
    console.error("Cashbook Load Error:", err);
    // 💡 Session သက်တမ်းကုန်သွားပါက Login ဖောင်သို့ ပြန်ပို့ပေးခြင်း
    if (err && err.message && err.message.includes("401")) {
      if (typeof showLogin === "function") showLogin();
      return;
    }
    if (!isSilent && typeof showToast === "function") {
      showToast("ERROR", "ငွေစာရင်း ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === "function") toggleLoading(false);
  }
}

function renderStatsCashbook(summary) {
  var s = summary || {};
  var elIncome = document.getElementById("cb-total-income");
  var elExpense = document.getElementById("cb-total-expense");
  var elCash = document.getElementById("cb-cash-in-hand");
  var elBank = document.getElementById("cb-bank-balance");

  if (elIncome) elIncome.textContent = Number(s.total_income || 0).toLocaleString("en-US");
  if (elExpense) elExpense.textContent = Number(s.total_expense || 0).toLocaleString("en-US");
  if (elCash) elCash.textContent = Number(s.cash_in_hand || 0).toLocaleString("en-US");
  if (elBank) elBank.textContent = Number(s.bank_balance || 0).toLocaleString("en-US");
}

function filterCashbookData(list, searchVal) {
  var safeList = Array.isArray(list) ? list : [];
  if (!searchVal || !searchVal.trim()) return safeList;

  var q = searchVal.trim().toLowerCase();
  return safeList.filter(function (row) {
    var descMatch = String(row.description || "").toLowerCase().includes(q);
    var vrMatch = String(row.voucher_no || "").toLowerCase().includes(q);
    var catMatch = String(row.category || "").toLowerCase().includes(q);
    var subCatMatch = String(row.sub_category || "").toLowerCase().includes(q);
    var myMatch = String(row.my || "").toLowerCase().includes(q);
    var methodMatch = String(row.bank_name || "").toLowerCase().includes(q);
    return descMatch || vrMatch || catMatch || subCatMatch || myMatch || methodMatch;
  });
}

function onSearchInputCashbook() {
  if (searchTimeoutCb) clearTimeout(searchTimeoutCb);
  searchTimeoutCb = setTimeout(function () {
    cbPage = 1;
    renderTableCashbook();
  }, 200);
}

function renderTableCashbook() {
  var tbody = document.getElementById("cb-table-body");
  if (!tbody) return;

  var searchInput = document.getElementById("cb-search");
  var filteredRows = filterCashbookData(cbActiveData, searchInput?.value);
  var totalEntries = filteredRows.length;

  if (!filteredRows || totalEntries === 0) {
    var shopName = (ALL_CB_SHOPS.find(s => s.id === currentCashbookShop)?.name) || currentCashbookShop.toUpperCase();
    tbody.innerHTML = `<tr><td colspan="13" class="text-center py-10 text-slate-500 font-bold">${shopName} တွင် ငွေစာရင်း မရှိသေးပါ။</td></tr>`;
    updatePaginationUICashbook(0);
    return;
  }

  var totalPages = Math.ceil(totalEntries / cbLimit) || 1;
  if (cbPage > totalPages) cbPage = totalPages;
  var startIndex = (cbPage - 1) * cbLimit;
  var endIndex = Math.min(startIndex + cbLimit, totalEntries);
  var pageItems = filteredRows.slice(startIndex, endIndex);

  tbody.innerHTML = pageItems.map(function (row, idx) {
    var catBadge = typeof window.formatCategoryBadgeHtml === "function" 
      ? window.formatCategoryBadgeHtml(row.category) 
      : window.escapeHtml(row.category);

    var payMethod = "Cash";
    if (Number(row.cash_amount) > 0 && Number(row.bank_amount) > 0) {
      payMethod = "Split (" + (row.bank_name || "Bank") + ")";
    } else if (Number(row.bank_amount) > 0) {
      payMethod = row.bank_name || "Bank";
    }

    return '<tr class="hover:bg-slate-800/30 text-slate-300">' +
        '<td class="text-center font-semibold text-slate-500 py-3 px-2">' + (startIndex + idx + 1) + '</td>' +
        '<td class="font-mono text-xs font-bold text-amber-400 text-center py-3 px-2">' + (window.escapeHtml(row.my) || "-") + '</td>' +
        '<td class="font-mono text-xs text-slate-300 py-3 px-2">' + (row.tx_date || "-") + '</td>' +
        '<td class="py-3 px-2">' + catBadge + '</td>' +
        '<td class="font-semibold text-slate-300 py-3 px-2">' + (window.escapeHtml(row.sub_category) || "-") + '</td>' +
        '<td class="font-bold text-slate-100 max-w-sm truncate py-3 px-2" title="' + window.escapeHtml(row.description) + '">' + (window.escapeHtml(row.description) || "-") + '</td>' +
        '<td class="text-center text-xs font-semibold text-slate-400 py-3 px-2">' + window.escapeHtml(payMethod) + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">' + (Number(row.debit) > 0 ? formatMoney(row.debit) : "-") + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-bold py-3 px-2">' + (Number(row.credit) > 0 ? formatMoney(row.credit) : "-") + '</td>' +
        '<td class="text-right font-mono font-black text-white py-3 px-2">' + formatMoney(row.balance) + '</td>' +
        '<td class="text-center text-sky-400 font-bold text-xs py-3 px-2">' + (window.escapeHtml(row.transfer_target) || "-") + '</td>' +
        '<td class="font-mono text-xs font-bold text-amber-400 py-3 px-2">' + (window.escapeHtml(row.voucher_no) || "-") + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-2.5">' +
            '<button onclick="CashbookEngine.openPrintModal(\'' + window.escapeJsAttr(row.voucher_no) + '\')" class="text-slate-300 hover:text-white transition" title="Print A5 Twin Voucher">' +
              '<i class="fa-solid fa-print"></i>' +
            '</button>' +
            '<button onclick="CashbookEngine.openEditModal(' + row.id + ')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Entry">' +
              '<i class="fa-solid fa-pen-to-square"></i>' +
            '</button>' +
            '<button onclick="CashbookEngine.deleteEntry(' + row.id + ')" class="text-rose-400 hover:text-rose-300 transition" title="Delete Entry">' +
              '<i class="fa-solid fa-trash-can"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join("");

  updatePaginationUICashbook(totalEntries);
}

function updatePaginationUICashbook(currentCount) {
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

function changePageCashbook(dir) {
  var filteredRows = filterCashbookData(cbActiveData, document.getElementById("cb-search")?.value);
  var totalPages = Math.ceil(filteredRows.length / cbLimit) || 1;

  if (dir === -1 && cbPage > 1) {
    cbPage--;
    renderTableCashbook();
  } else if (dir === 1 && cbPage < totalPages) {
    cbPage++;
    renderTableCashbook();
  }
}

function setModeCashbook(mode) {
  currentMode = mode;
  var modes = ["sale", "purchase", "expense", "transfer"];
  modes.forEach(function (m) {
    var btn = document.getElementById("tab-mode-" + m);
    if (!btn) return;
    if (m === mode) {
      btn.className = "py-2 rounded-lg text-center transition font-black text-white shadow " + 
        (m === "sale" ? "bg-emerald-600" : m === "purchase" ? "bg-rose-600" : m === "expense" ? "bg-slate-700" : "bg-sky-600");
    } else {
      btn.className = "py-2 rounded-lg text-center transition text-slate-400 hover:text-white";
    }
  });

  var itemSection = document.getElementById("cb-item-section");
  var transferSection = document.getElementById("cb-transfer-section");
  var expenseSubcatSection = document.getElementById("cb-expense-subcat-section");
  var purchaseRow = document.getElementById("cb-purchase-pricing-row");
  var labelPriceType = document.getElementById("cb-label-price-type");
  var labelDesc = document.getElementById("cb-label-desc");

  if (mode === "sale" || mode === "purchase") {
    if (itemSection) itemSection.classList.remove("hidden");
    if (transferSection) transferSection.classList.add("hidden");
    if (expenseSubcatSection) expenseSubcatSection.classList.add("hidden");
    if (purchaseRow) {
      if (mode === "purchase") purchaseRow.classList.remove("hidden");
      else purchaseRow.classList.add("hidden");
    }
    if (labelPriceType) labelPriceType.textContent = (mode === "sale" ? "ရောင်းဈေး (Selling Price) *" : "ဝယ်ဈေး (Cost Price) *");
    if (labelDesc) labelDesc.textContent = (mode === "sale" ? "ဝယ်သူအမည် (Customer Name) *" : "ရောင်းသူအမည် (Supplier Name) *");
  } else if (mode === "transfer") {
    if (itemSection) itemSection.classList.add("hidden");
    if (transferSection) transferSection.classList.remove("hidden");
    if (expenseSubcatSection) expenseSubcatSection.classList.add("hidden");
    if (labelDesc) labelDesc.textContent = "ငွေလွှဲအကြောင်းအရာ *";
  } else { // expense
    if (itemSection) itemSection.classList.add("hidden");
    if (transferSection) transferSection.classList.add("hidden");
    if (expenseSubcatSection) expenseSubcatSection.classList.remove("hidden");
    if (labelDesc) labelDesc.textContent = "အသုံးစရိတ် အကြောင်းအရာ *";
  }
}

async function preloadCatalogData() {
  try {
    const resGarment = await callApi("getStoreInventory", { shop_id: currentCashbookShop, branch: currentCashbookShop });
    if (resGarment && resGarment.success) storeGarmentItems = resGarment.data || [];

    const resYarn = await callApi("getYarnInventory", { shop_id: currentCashbookShop, branch: currentCashbookShop });
    if (resYarn && resYarn.success) storeYarnItems = resYarn.data || [];
  } catch (e) {
    console.warn("Preload Catalog Error:", e);
  }
}

function onCategorySelectChangeCashbook() {
  var cat = document.getElementById("cb-item-category-select")?.value || "";
  var itemSelect = document.getElementById("cb-item-select");
  if (!itemSelect) return;

  var optionsHtml = '<option value="">-- ပစ္စည်း ရွေးရန် --</option>';

  if (["ယုံချည်", "၂/၈၀ ချည်", "၂/၁၀၀ ချည်"].includes(cat)) {
    var filteredYarns = storeYarnItems.filter(y => y.yarn_type === cat);
    filteredYarns.forEach(y => {
      optionsHtml += `<option value="${y.item_code}" data-type="yarn" data-stock="${y.current_stock}" data-retail="${y.retail_price}" data-wholesale="${y.wholesale_price}" data-cost="${y.cost_price}" data-name="${y.color_name}">[${y.item_code}] ${y.color_name} (လက်ကျန်: ${y.current_stock})</option>`;
    });
  } else if (cat) {
    var filteredGarments = storeGarmentItems.filter(g => g.category === cat);
    filteredGarments.forEach(g => {
      optionsHtml += `<option value="${g.item_code}" data-type="garment" data-stock="${g.current_stock}" data-retail="${g.retail_price}" data-wholesale="${g.wholesale_price}" data-cost="${g.cost_price}" data-name="${g.item_name}">[${g.item_code}] ${g.item_name} (လက်ကျန်: ${g.current_stock})</option>`;
    });
  }

  itemSelect.innerHTML = optionsHtml;
  onItemSelectChangeCashbook();
}

function onItemSelectChangeCashbook() {
  var select = document.getElementById("cb-item-select");
  var selectedOption = select?.options[select.selectedIndex];
  var badge = document.getElementById("cb-stock-badge");
  var priceInput = document.getElementById("cb-line-price");
  var retailInput = document.getElementById("cb-purchase-retail");
  var wholesaleInput = document.getElementById("cb-purchase-wholesale");

  if (!selectedOption || !selectedOption.value) {
    if (badge) badge.textContent = "လက်ကျန်: -";
    if (priceInput) priceInput.value = "";
    return;
  }

  var stock = Number(selectedOption.getAttribute("data-stock") || 0);
  var retail = Number(selectedOption.getAttribute("data-retail") || 0);
  var wholesale = Number(selectedOption.getAttribute("data-wholesale") || 0);
  var cost = Number(selectedOption.getAttribute("data-cost") || 0);

  if (badge) {
    badge.textContent = `လက်ရှိလက်ကျန်: ${stock}`;
    badge.className = stock <= 0 ? "font-mono font-bold text-[11px] text-rose-400 animate-pulse" : "font-mono font-bold text-[11px] text-emerald-400";
  }

  if (currentMode === "sale") {
    if (priceInput) priceInput.value = retail || wholesale || 0;
  } else {
    if (priceInput) priceInput.value = cost || 0;
    if (retailInput) retailInput.value = retail || 0;
    if (wholesaleInput) wholesaleInput.value = wholesale || 0;
  }
}

function addLineItemCashbook() {
  var select = document.getElementById("cb-item-select");
  var selectedOption = select?.options[select.selectedIndex];
  if (!selectedOption || !selectedOption.value) {
    alert("⚠️ ပစ္စည်း ရွေးချယ်ပေးပါခင်ဗျာ။");
    return;
  }

  var itemCode = selectedOption.value;
  var itemName = selectedOption.getAttribute("data-name") || itemCode;
  var itemType = selectedOption.getAttribute("data-type") || "garment";
  var currentStock = Number(selectedOption.getAttribute("data-stock") || 0);
  var qty = parseCleanNumber(document.getElementById("cb-line-qty")?.value);
  var unitPrice = parseCleanNumber(document.getElementById("cb-line-price")?.value);

  if (qty <= 0 || unitPrice <= 0) {
    alert("⚠️ အရေအတွက်နှင့် ဈေးနှုန်း မှန်ကန်စွာ ထည့်သွင်းပေးပါ။");
    return;
  }

  if (currentMode === "sale" && qty > currentStock) {
    alert(`⚠️ လက်ကျန် မလုံလောက်ပါ! (ဤဆိုင်တွင် လက်ကျန်: ${currentStock} သာ ရှိပါသည်)`);
    return;
  }

  currentBillItems.push({
    item_code: itemCode,
    item_name: itemName,
    item_type: itemType,
    quantity: qty,
    unit_price: unitPrice,
    total_price: qty * unitPrice,
    cost_price: unitPrice,
    retail_price: parseCleanNumber(document.getElementById("cb-purchase-retail")?.value),
    wholesale_price: parseCleanNumber(document.getElementById("cb-purchase-wholesale")?.value)
  });

  renderLineItemsGrid();
}

function removeLineItemCashbook(index) {
  currentBillItems.splice(index, 1);
  renderLineItemsGrid();
}

function renderLineItemsGrid() {
  var wrap = document.getElementById("cb-items-table-wrap");
  var tbody = document.getElementById("cb-line-items-body");
  if (!wrap || !tbody) return;

  if (currentBillItems.length === 0) {
    wrap.classList.add("hidden");
    tbody.innerHTML = "";
    recalculateBillingTotals();
    return;
  }

  wrap.classList.remove("hidden");
  var subtotal = 0;

  tbody.innerHTML = currentBillItems.map((itm, idx) => {
    subtotal += itm.total_price;
    return `
      <tr class="hover:bg-slate-800/40">
        <td class="p-2 font-bold">[${itm.item_code}] ${window.escapeHtml(itm.item_name)}</td>
        <td class="p-2 text-center font-mono font-bold text-sky-400">${itm.quantity}</td>
        <td class="p-2 text-right font-mono">${formatMoney(itm.unit_price)}</td>
        <td class="p-2 text-right font-mono font-bold text-emerald-400">${formatMoney(itm.total_price)}</td>
        <td class="p-2 text-center">
          <button type="button" onclick="CashbookEngine.removeLineItem(${idx})" class="text-rose-400 hover:text-rose-300"><i class="fa-solid fa-xmark"></i></button>
        </td>
      </tr>
    `;
  }).join("");

  var subtotalEl = document.getElementById("cb-bill-subtotal");
  if (subtotalEl) subtotalEl.value = subtotal;
  recalculateBillingTotals();
}

function recalculateBillingTotals() {
  var subtotal = parseCleanNumber(document.getElementById("cb-bill-subtotal")?.value);
  var discount = parseCleanNumber(document.getElementById("cb-bill-discount")?.value);

  if (currentMode === "expense" || currentMode === "transfer") {
    subtotal = parseCleanNumber(document.getElementById("cb-transfer-amount")?.value || document.getElementById("cb-pay-cash")?.value || 0);
    discount = 0;
  }

  var net = Math.max(0, subtotal - discount);
  var netEl = document.getElementById("cb-bill-net");
  if (netEl) netEl.value = net;

  var cashInput = document.getElementById("cb-pay-cash");
  var bankInput = document.getElementById("cb-pay-bank");
  if (cashInput && bankInput && parseCleanNumber(bankInput.value) <= 0) {
    cashInput.value = net;
  }
}

function onPaymentInputChangeCashbook(changedType) {
  var net = parseCleanNumber(document.getElementById("cb-bill-net")?.value);
  var cashInput = document.getElementById("cb-pay-cash");
  var bankInput = document.getElementById("cb-pay-bank");

  if (changedType === "cash") {
    var cashVal = parseCleanNumber(cashInput?.value);
    if (bankInput) bankInput.value = Math.max(0, net - cashVal);
  } else {
    var bankVal = parseCleanNumber(bankInput?.value);
    if (cashInput) cashInput.value = Math.max(0, net - bankVal);
  }
}

function openEntryModalCashbook() {
  editingEntryId = null;
  currentBillItems = [];
  setModeCashbook("sale");

  var titleEl = document.getElementById("cb-modal-title");
  if (titleEl) titleEl.textContent = "New Transaction Entry";

  var d = new Date();
  var dateStr = d.toISOString().slice(0, 10);
  document.getElementById("cb-form-date").value = dateStr;
  
  document.getElementById("cb-form-shop-display").value = (ALL_CB_SHOPS.find(s => s.id === currentCashbookShop)?.name) || currentCashbookShop.toUpperCase();

  var prefix = currentCashbookShop === "main" ? "MVR" : `VR-${currentCashbookShop.toUpperCase()}`;
  document.getElementById("cb-form-vrno").value = `${prefix}-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Date.now().toString().slice(-4)}`;

  document.getElementById("cb-form-desc").value = "";
  document.getElementById("cb-bill-subtotal").value = 0;
  document.getElementById("cb-bill-discount").value = 0;
  document.getElementById("cb-bill-net").value = 0;
  document.getElementById("cb-pay-cash").value = 0;
  document.getElementById("cb-pay-bank").value = 0;

  var toShopSelect = document.getElementById("cb-transfer-target");
  if (toShopSelect) {
    toShopSelect.innerHTML = ALL_CB_SHOPS.filter(s => s.id !== currentCashbookShop).map(s => `<option value="${s.id}">${s.name}</option>`).join("");
  }

  preloadCatalogData().then(() => onCategorySelectChangeCashbook());
  renderLineItemsGrid();

  var modal = document.getElementById("cb-entry-modal");
  if (modal) modal.classList.remove("hidden");
}

// 💡 စာရင်းဟောင်း ပြင်ဆင်ရန် ဖွင့်ခြင်း (Edit Entry)
function openEditModalCashbook(id) {
  var row = cbActiveData.find(r => r.id === id);
  if (!row) return;

  editingEntryId = id;
  currentBillItems = Array.isArray(row.items) ? [...row.items] : [];

  var mode = row.category === "အရောင်း" ? "sale" : 
             row.category === "အဝယ်" ? "purchase" : 
             row.category === "အသုံးစရိတ်" ? "expense" : "transfer";
  setModeCashbook(mode);

  var titleEl = document.getElementById("cb-modal-title");
  if (titleEl) titleEl.textContent = `Edit Transaction (#${row.voucher_no || row.id})`;

  document.getElementById("cb-form-date").value = row.tx_date || "";
  document.getElementById("cb-form-shop-display").value = (ALL_CB_SHOPS.find(s => s.id === currentCashbookShop)?.name) || currentCashbookShop.toUpperCase();
  document.getElementById("cb-form-vrno").value = row.voucher_no || "";
  document.getElementById("cb-form-desc").value = row.description || "";

  if (mode === "expense") {
    var subCatSelect = document.getElementById("cb-expense-subcat");
    if (subCatSelect && row.sub_category) subCatSelect.value = row.sub_category;
  }

  var netAmount = Number(row.debit || row.credit || 0);
  document.getElementById("cb-bill-subtotal").value = row.subtotal || netAmount;
  document.getElementById("cb-bill-discount").value = row.discount || 0;
  document.getElementById("cb-bill-net").value = netAmount;
  document.getElementById("cb-pay-cash").value = row.cash_amount || 0;
  document.getElementById("cb-pay-bank").value = row.bank_amount || 0;

  if (row.bank_name) {
    var bankNameSelect = document.getElementById("cb-pay-bank-name");
    if (bankNameSelect) bankNameSelect.value = row.bank_name;
  }

  preloadCatalogData().then(() => onCategorySelectChangeCashbook());
  renderLineItemsGrid();

  var modal = document.getElementById("cb-entry-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeEntryModalCashbook() {
  editingEntryId = null;
  var modal = document.getElementById("cb-entry-modal");
  if (modal) modal.classList.add("hidden");
}

async function saveEntrySubmitCashbook(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isCbSubmitting) return;

  var txDate = document.getElementById("cb-form-date")?.value;
  var myVal = getMonthYearString(txDate);
  var subCategoryVal = currentMode === "expense" ? (document.getElementById("cb-expense-subcat")?.value || "အထွေထွေ အသုံးစရိတ်") : "";

  var payload = {
    id: editingEntryId || undefined,
    shop_id: currentCashbookShop,
    branch: currentCashbookShop,
    tx_date: txDate,
    my: myVal,
    category: currentMode === "sale" ? "အရောင်း" : currentMode === "purchase" ? "အဝယ်" : currentMode === "expense" ? "အသုံးစရိတ်" : "ငွေလွှဲ",
    sub_category: subCategoryVal,
    description: document.getElementById("cb-form-desc")?.value.trim(),
    voucher_no: document.getElementById("cb-form-vrno")?.value,
    subtotal: parseCleanNumber(document.getElementById("cb-bill-subtotal")?.value),
    discount: parseCleanNumber(document.getElementById("cb-bill-discount")?.value),
    net_total: parseCleanNumber(document.getElementById("cb-bill-net")?.value),
    cash_amount: parseCleanNumber(document.getElementById("cb-pay-cash")?.value),
    bank_amount: parseCleanNumber(document.getElementById("cb-pay-bank")?.value),
    bank_name: parseCleanNumber(document.getElementById("cb-pay-bank")?.value) > 0 ? document.getElementById("cb-pay-bank-name")?.value : "",
    transfer_target: currentMode === "transfer" ? document.getElementById("cb-transfer-target")?.value : "",
    items: currentBillItems
  };

  if (payload.net_total <= 0) {
    alert("⚠️ ကျသင့်ငွေ သုည (၀) ထက် ကြီးရပါမည်။");
    return;
  }

  isCbSubmitting = true;
  try {
    closeEntryModalCashbook();
    if (typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("saveCashbookEntry", payload);
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", res.message || "သိမ်းဆည်းပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadCashbookData(true, true);
    } else {
      throw new Error(res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isCbSubmitting = false;
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

async function deleteEntryCashbook(id) {
  if (!confirm("⚠️ ဤငွေစာရင်းကို အမှန်တကယ် ဖျက်မှာ သေချာပါသလား?")) return;
  try {
    if (typeof toggleLoading === "function") toggleLoading(true);
    var res = await callApi("deleteCashbookEntry", { id: id, shop_id: currentCashbookShop });
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", "ဖျက်ပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadCashbookData(true, true);
    } else {
      throw new Error(res?.message || "ဖျက်၍ မရပါ။");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

function exportCsvCashbook() {
  if (!cbActiveData || cbActiveData.length === 0) {
    if (typeof showToast === "function") showToast("ERROR", "ထုတ်ယူရန် စာရင်း မရှိပါ။");
    return;
  }

  var csv = "NO,MY,DATE,CATEGORY,SUB CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCE,TRANSFER,VR NO,SHOP\n";
  cbActiveData.forEach(function (r, idx) {
    var method = Number(r.bank_amount) > 0 ? (r.bank_name || "Bank") : "Cash";
    csv += (idx + 1) + "," +
           window.safeCsvCell(r.my || "") + "," +
           window.safeCsvCell(r.tx_date || "") + "," +
           window.safeCsvCell(r.category || "") + "," +
           window.safeCsvCell(r.sub_category || "") + "," +
           window.safeCsvCell(r.description || "") + "," +
           window.safeCsvCell(method) + "," +
           (r.debit || 0) + "," +
           (r.credit || 0) + "," +
           (r.balance || 0) + "," +
           window.safeCsvCell(r.transfer_target || "") + "," +
           window.safeCsvCell(r.voucher_no || "") + "," +
           window.safeCsvCell(currentCashbookShop.toUpperCase()) + "\n";
  });

  var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Cashbook_${currentCashbookShop}_FY2026.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 A5 Twin Voucher Print Engine (ဝယ်သူမိတ္တူ + ဆိုင်မိတ္တူ)
function openPrintModalCashbook(voucherNo) {
  var row = cbActiveData.find(r => r.voucher_no === voucherNo);
  if (!row) {
    alert("ဘောက်ချာ အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  var printable = document.getElementById("cb-printable-area");
  if (!printable) return;

  var shopObj = ALL_CB_SHOPS.find(s => s.id === currentCashbookShop) || { name: "မြကမ္ဘာစိုး ပိုးထည်တိုက်" };
  var payMethod = "Cash";
  if (Number(row.cash_amount) > 0 && Number(row.bank_amount) > 0) {
    payMethod = `Split (Cash: ${formatMoney(row.cash_amount)} + ${row.bank_name || 'Bank'}: ${formatMoney(row.bank_amount)})`;
  } else if (Number(row.bank_amount) > 0) {
    payMethod = `${row.bank_name || 'Bank'} (${formatMoney(row.bank_amount)})`;
  }

  var itemsList = Array.isArray(row.items) && row.items.length > 0 ? row.items : [
    { item_name: row.description || "ပိုးထည်နှင့် အထည်များ", quantity: 1, unit_price: row.debit || row.credit || 0, total_price: row.debit || row.credit || 0 }
  ];

  var renderSingleVoucher = function (title) {
    return `
      <div class="border border-slate-400 p-4 rounded-lg bg-white text-slate-900 mb-4">
        <div class="flex justify-between items-start border-b border-slate-300 pb-2 mb-2">
          <div>
            <h2 class="font-extrabold text-base text-slate-900">မြကမ္ဘာစိုး ပိုးထည်တိုက်</h2>
            <p class="text-[10px] text-slate-600">${shopObj.name} | ဖုန်း: 09-xxxxxxxxx</p>
          </div>
          <div class="text-right">
            <span class="inline-block px-2 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-bold uppercase tracking-wider">${title}</span>
            <p class="text-[10px] font-mono font-bold mt-1 text-slate-700">VR: ${window.escapeHtml(row.voucher_no || "-")}</p>
            <p class="text-[10px] text-slate-500">ရက်စွဲ: ${row.tx_date || "-"}</p>
          </div>
        </div>

        <div class="text-[11px] mb-2 flex justify-between">
          <p><span class="font-bold">ဝယ်သူ/အကြောင်းအရာ:</span> ${window.escapeHtml(row.description || "-")}</p>
          <p><span class="font-bold">ငွေပေးချေမှု:</span> ${window.escapeHtml(payMethod)}</p>
        </div>

        <table class="w-full text-left text-[10px] border border-slate-300 mb-2">
          <thead class="bg-slate-100 border-b border-slate-300 font-bold">
            <tr>
              <th class="p-1 border-r border-slate-300 w-8 text-center">စဉ်</th>
              <th class="p-1 border-r border-slate-300">အမျိုးအမည်</th>
              <th class="p-1 border-r border-slate-300 text-center w-14">အရေအတွက်</th>
              <th class="p-1 border-r border-slate-300 text-right w-20">နှုန်း</th>
              <th class="p-1 text-right w-24">စုစုပေါင်း</th>
            </tr>
          </thead>
          <tbody>
            ${itemsList.map((itm, i) => `
              <tr class="border-b border-slate-200">
                <td class="p-1 border-r border-slate-200 text-center">${i + 1}</td>
                <td class="p-1 border-r border-slate-200 font-bold">${window.escapeHtml(itm.item_name || "-")}</td>
                <td class="p-1 border-r border-slate-200 text-center font-mono">${itm.quantity || 1}</td>
                <td class="p-1 border-r border-slate-200 text-right font-mono">${formatMoney(itm.unit_price || 0)}</td>
                <td class="p-1 text-right font-mono font-bold">${formatMoney(itm.total_price || 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="flex justify-between items-end text-[10px] pt-1">
          <div class="text-slate-500">
            <p>ဝယ်ယူအားပေးမှုကို အထူးကျေးဇူးတင်ရှိပါသည်။</p>
          </div>
          <div class="text-right space-y-0.5">
            <p class="font-bold text-xs">ကျသင့်ငွေ စုစုပေါင်း: <span class="font-mono text-sm">${formatMoney(row.debit || row.credit || 0)} ကျပ်</span></p>
          </div>
        </div>
      </div>
    `;
  };

  printable.innerHTML = `
    ${renderSingleVoucher("ဝယ်သူမိတ္တူ (Customer Copy)")}
    <div class="border-t border-dashed border-slate-400 my-3 text-center text-[10px] text-slate-400 font-mono">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂</div>
    ${renderSingleVoucher("ဆိုင်မိတ္တူ (Shop Copy)")}
  `;

  var printModal = document.getElementById("cb-print-modal");
  if (printModal) printModal.classList.remove("hidden");
}

function triggerBrowserPrintCashbook() {
  window.print();
}

window.CashbookEngine = {
  async init(shopId) {
    currentCashbookShop = shopId || "main";
    cbPage = 1;

    var container = document.getElementById("view-container");
    if (container) {
      if (!window.viewCache["cashbook"]) {
        try {
          var res = await fetch("views/cashbook.html?v=20261019");
          if (res.ok) {
            window.viewCache["cashbook"] = await res.text();
          } else {
            var res2 = await fetch("cashbook.html?v=20261019");
            if (res2.ok) window.viewCache["cashbook"] = await res2.text();
          }
        } catch (e) {
          try {
            var resFallback = await fetch("cashbook.html?v=20261019");
            if (resFallback.ok) window.viewCache["cashbook"] = await resFallback.text();
          } catch (err) {}
        }
      }
      if (window.viewCache["cashbook"]) container.innerHTML = window.viewCache["cashbook"];
    }

    await loadCashbookData(false, false);
  },
  loadCashbook: loadCashbookData,
  changeShop: function (shopId) {
    currentCashbookShop = shopId;
    cbPage = 1;
    loadCashbookData(false, false);
  },
  applyFilter: function () { cbPage = 1; renderTableCashbook(); },
  onSearchInput: onSearchInputCashbook,
  changePage: changePageCashbook,
  openEntryModal: openEntryModalCashbook,
  openEditModal: openEditModalCashbook,
  closeEntryModal: closeEntryModalCashbook,
  setMode: setModeCashbook,
  addLineItem: addLineItemCashbook,
  removeLineItem: removeLineItemCashbook,
  recalculateBillingTotals: recalculateBillingTotals,
  onPaymentInputChange: onPaymentInputChangeCashbook,
  onCategorySelectChange: onCategorySelectChangeCashbook,
  onItemSelectChange: onItemSelectChangeCashbook,
  saveEntrySubmit: saveEntrySubmitCashbook,
  deleteEntry: deleteEntryCashbook,
  exportCsv: exportCsvCashbook,
  openPrintModal: openPrintModalCashbook,
  closePrintModal: function() { document.getElementById("cb-print-modal")?.classList.add("hidden"); },
  triggerBrowserPrint: triggerBrowserPrintCashbook
};
