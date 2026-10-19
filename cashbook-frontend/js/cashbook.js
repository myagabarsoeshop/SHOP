/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - MULTI-BRANCH CASHBOOK & INVOICING ENGINE
 * File: cashbook-frontend/js/cashbook.js
 * Standard: Split Payment (Cash + Bank), Discount, Stock Guard & Twin Slip Print
 * ==============================================================================
 */

"use strict";

var cbPage = 1;
var cbLimit = 20;
var cbTotalRows = 0;
var cbActiveData = [];
var currentCashbookShop = "main";
var currentMode = "sale"; // 'sale', 'purchase', 'expense', 'transfer'
var currentBillItems = [];
var storeGarmentItems = [];
var storeYarnItems = [];
var searchTimeoutCb = null;
var isCbSubmitting = false;

var ALL_CB_SHOPS = [
  { id: "main", name: "Main Home Shop (ပင်မ)" },
  { id: "shop1", name: "ဆိုင်ခွဲ (၁)" },
  { id: "shop2", name: "ဆိုင်ခွဲ (၂)" },
  { id: "shop3", name: "ဆိုင်ခွဲ (၃)" },
  { id: "shop4", name: "ဆိုင်ခွဲ (၄)" },
  { id: "shop5", name: "ဆိုင်ခွဲ (၅)" }
];

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

  var fromDate = document.getElementById("cb-from-date")?.value || "";
  var toDate = document.getElementById("cb-to-date")?.value || "";
  var category = document.getElementById("cb-category-filter")?.value || "";

  try {
    if (!isSilent && typeof toggleLoading === "function") toggleLoading(true);

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

    renderStatsCashbook(res.summary);
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
 * 💡 Render Top 4 KPI Boxes (Income, Expense, Cash in Hand, Bank/KPay)
 */
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

/**
 * 💡 Filter & Search Table
 */
function filterCashbookData(list, searchVal) {
  var safeList = Array.isArray(list) ? list : [];
  if (!searchVal || !searchVal.trim()) return safeList;

  var q = searchVal.trim().toLowerCase();
  return safeList.filter(function (row) {
    var descMatch = String(row.description || "").toLowerCase().includes(q);
    var vrMatch = String(row.voucher_no || "").toLowerCase().includes(q);
    var catMatch = String(row.category || "").toLowerCase().includes(q);
    var methodMatch = String(row.bank_name || "").toLowerCase().includes(q);
    return descMatch || vrMatch || catMatch || methodMatch;
  });
}

function onSearchInputCashbook() {
  if (searchTimeoutCb) clearTimeout(searchTimeoutCb);
  searchTimeoutCb = setTimeout(function () {
    cbPage = 1;
    renderTableCashbook();
  }, 200);
}

/**
 * 💡 Render 11 Columns Data Grid Table
 */
function renderTableCashbook() {
  var tbody = document.getElementById("cb-table-body");
  if (!tbody) return;

  var searchInput = document.getElementById("cb-search");
  var filteredRows = filterCashbookData(cbActiveData, searchInput?.value);
  var totalEntries = filteredRows.length;

  if (!filteredRows || totalEntries === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="text-center py-10 text-slate-500 font-bold">ဤဆိုင်ခွဲတွင် ငွေစာရင်း မရှိသေးပါ။</td></tr>';
    updatePaginationUICashbook(0);
    return;
  }

  var totalPages = Math.ceil(totalEntries / cbLimit) || 1;
  if (cbPage > totalPages) cbPage = totalPages;
  var startIndex = (cbPage - 1) * cbLimit;
  var endIndex = Math.min(startIndex + cbLimit, totalEntries);
  var pageItems = filteredRows.slice(startIndex, endIndex);

  tbody.innerHTML = pageItems.map(function (row, idx) {
    var isIncome = Number(row.debit || 0) > 0;
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
        '<td class="font-mono text-xs text-slate-300 py-3 px-2">' + (row.tx_date || "-") + '</td>' +
        '<td class="py-3 px-2">' + catBadge + '</td>' +
        '<td class="font-bold text-slate-100 max-w-sm truncate py-3 px-2" title="' + window.escapeHtml(row.description) + '">' + (window.escapeHtml(row.description) || "-") + '</td>' +
        '<td class="text-center text-xs font-semibold text-slate-400 py-3 px-2">' + window.escapeHtml(payMethod) + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">' + (Number(row.debit) > 0 ? formatMoney(row.debit) : "-") + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-bold py-3 px-2">' + (Number(row.credit) > 0 ? formatMoney(row.credit) : "-") + '</td>' +
        '<td class="text-right font-mono font-black text-white py-3 px-2">' + formatMoney(row.balance) + '</td>' +
        '<td class="text-center text-sky-400 font-bold text-xs py-3 px-2">' + (window.escapeHtml(row.transfer_target) || "-") + '</td>' +
        '<td class="font-mono text-xs font-bold text-amber-400 py-3 px-2">' + (window.escapeHtml(row.voucher_no) || "-") + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-2.5">' +
            '<!-- 🖨️ Print Voucher -->' +
            '<button onclick="CashbookEngine.openPrintModal(\'' + window.escapeJsAttr(row.voucher_no) + '\')" class="text-slate-300 hover:text-white transition" title="Print A5 Twin Voucher">' +
              '<i class="fa-solid fa-print"></i>' +
            '</button>' +
            '<!-- ✏️ Edit -->' +
            '<button onclick="CashbookEngine.openEditModal(' + row.id + ')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Entry">' +
              '<i class="fa-solid fa-pen-to-square"></i>' +
            '</button>' +
            '<!-- 🗑️ Delete (အမြဲတမ်း နောက်ဆုံးတွင် ထားရှိသည်) -->' +
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

/**
 * 💡 Mode Switcher (Sale, Purchase, Expense, Transfer)
 */
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
  var purchaseRow = document.getElementById("cb-purchase-pricing-row");
  var labelPriceType = document.getElementById("cb-label-price-type");
  var labelDesc = document.getElementById("cb-label-desc");

  if (mode === "sale" || mode === "purchase") {
    if (itemSection) itemSection.classList.remove("hidden");
    if (transferSection) transferSection.classList.add("hidden");
    if (purchaseRow) {
      if (mode === "purchase") purchaseRow.classList.remove("hidden");
      else purchaseRow.classList.add("hidden");
    }
    if (labelPriceType) labelPriceType.textContent = (mode === "sale" ? "ရောင်းဈေး (Selling Price) *" : "ဝယ်ဈေး (Cost Price) *");
    if (labelDesc) labelDesc.textContent = (mode === "sale" ? "ဝယ်သူအမည် (Customer Name) *" : "ရောင်းသူ/ဆိုင်အမည် (Supplier / Vendor) *");
  } else if (mode === "transfer") {
    if (itemSection) itemSection.classList.add("hidden");
    if (transferSection) transferSection.classList.remove("hidden");
    if (labelDesc) labelDesc.textContent = "ငွေလွှဲအကြောင်းအရာ (Transfer Note) *";
  } else { // expense
    if (itemSection) itemSection.classList.add("hidden");
    if (transferSection) transferSection.classList.add("hidden");
    if (labelDesc) labelDesc.textContent = "အသုံးစရိတ် အကြောင်းအရာ (Expense Description) *";
  }
}

/**
 * 💡 Pre-load Store & Yarn Catalog for Cascading Dropdown
 */
async function preloadCatalogData() {
  try {
    const resGarment = await callApi("getStoreInventory", { shop_id: currentCashbookShop });
    if (resGarment && resGarment.success) storeGarmentItems = resGarment.data || [];

    const resYarn = await callApi("getYarnInventory", { shop_id: currentCashbookShop });
    if (resYarn && resYarn.success) storeYarnItems = resYarn.data || [];
  } catch (e) {
    console.warn("Preload Catalog Error:", e);
  }
}

/**
 * 💡 Cascading Category Change ➔ Filter Items Dropdown
 */
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

/**
 * 💡 Item Selected ➔ Auto Display Shop Stock & Prices
 */
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
    badge.textContent = `လက်ရှိလက်ကျန်: ${stock} ထည်/ထုပ်`;
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

/**
 * 💡 Add Line Item to Bill Grid
 */
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

  if (qty <= 0) {
    alert("⚠️ အရေအတွက် ထည့်သွင်းပေးပါ။");
    return;
  }
  if (unitPrice <= 0) {
    alert("⚠️ ဈေးနှုန်း ထည့်သွင်းပေးပါ။");
    return;
  }

  // 🎯 STOCK GUARD (အရောင်းတွင် လက်ကျန်ထက် ကျော်ရောင်းမရအောင် တားခြင်း)
  if (currentMode === "sale" && qty > currentStock) {
    alert(`⚠️ လက်ကျန် မလုံလောက်ပါ! (ဤဆိုင်တွင် လက်ကျန်: ${currentStock} သာ ရှိပါသည်)`);
    return;
  }

  var costPrice = unitPrice;
  var retailPrice = parseCleanNumber(document.getElementById("cb-purchase-retail")?.value);
  var wholesalePrice = parseCleanNumber(document.getElementById("cb-purchase-wholesale")?.value);

  if (currentMode === "purchase") {
    if (retailPrice <= 0 || wholesalePrice <= 0) {
      alert("⚠️ အဝယ်စာရင်းတွင် လက်လီဈေးနှင့် လက်ကားဈေး မဖြစ်မနေ သတ်မှတ်ပေးရပါမည်။");
      return;
    }
  }

  currentBillItems.push({
    item_code: itemCode,
    item_name: itemName,
    item_type: itemType,
    quantity: qty,
    unit_price: unitPrice,
    total_price: qty * unitPrice,
    cost_price: costPrice,
    retail_price: retailPrice,
    wholesale_price: wholesalePrice
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

  document.getElementById("cb-bill-subtotal").value = subtotal;
  recalculateBillingTotals();
}

/**
 * 💡 Billing Calculations: Subtotal - Discount = Net Total ➔ Auto Split Payment
 */
function recalculateBillingTotals() {
  var subtotal = parseCleanNumber(document.getElementById("cb-bill-subtotal")?.value);
  var discount = parseCleanNumber(document.getElementById("cb-bill-discount")?.value);

  // If in pure expense/transfer mode
  if (currentMode === "expense" || currentMode === "transfer") {
    var manualAmt = parseCleanNumber(document.getElementById("cb-transfer-amount")?.value || document.getElementById("cb-pay-cash")?.value || 0);
    subtotal = manualAmt;
    discount = 0;
  }

  var net = Math.max(0, subtotal - discount);
  var netEl = document.getElementById("cb-bill-net");
  if (netEl) netEl.value = net;

  // Auto assign to Cash by default if untouched
  var cashInput = document.getElementById("cb-pay-cash");
  var bankInput = document.getElementById("cb-pay-bank");
  if (cashInput && bankInput) {
    if (parseCleanNumber(bankInput.value) <= 0) {
      cashInput.value = net;
    }
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

/**
 * 💡 Open / Close Modal Handlers
 */
function openEntryModalCashbook() {
  currentBillItems = [];
  setModeCashbook("sale");

  var d = new Date();
  document.getElementById("cb-form-date").value = d.toISOString().slice(0, 10);

  var shopName = (ALL_CB_SHOPS.find(s => s.id === currentCashbookShop)?.name) || currentCashbookShop.toUpperCase();
  document.getElementById("cb-form-shop-display").value = shopName;

  var prefix = currentCashbookShop === "main" ? "MVR" : `VR-${currentCashbookShop.toUpperCase()}`;
  document.getElementById("cb-form-vrno").value = `${prefix}-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Date.now().toString().slice(-4)}`;

  document.getElementById("cb-form-desc").value = "";
  document.getElementById("cb-bill-subtotal").value = 0;
  document.getElementById("cb-bill-discount").value = 0;
  document.getElementById("cb-bill-net").value = 0;
  document.getElementById("cb-pay-cash").value = 0;
  document.getElementById("cb-pay-bank").value = 0;

  // Populate Transfer Destinations (excluding current shop)
  var toShopSelect = document.getElementById("cb-transfer-target");
  var otherShops = ALL_CB_SHOPS.filter(s => s.id !== currentCashbookShop);
  if (toShopSelect) {
    toShopSelect.innerHTML = otherShops.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
  }

  preloadCatalogData().then(() => {
    onCategorySelectChangeCashbook();
  });

  renderLineItemsGrid();

  var modal = document.getElementById("cb-entry-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeEntryModalCashbook() {
  var modal = document.getElementById("cb-entry-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * 💡 Submit Entry to Backend API
 */
async function saveEntrySubmitCashbook(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isCbSubmitting) return;

  var txDate = document.getElementById("cb-form-date")?.value;
  var desc = document.getElementById("cb-form-desc")?.value.trim();
  var vrNo = document.getElementById("cb-form-vrno")?.value;
  var subtotal = parseCleanNumber(document.getElementById("cb-bill-subtotal")?.value);
  var discount = parseCleanNumber(document.getElementById("cb-bill-discount")?.value);
  var netTotal = parseCleanNumber(document.getElementById("cb-bill-net")?.value);
  var cashAmount = parseCleanNumber(document.getElementById("cb-pay-cash")?.value);
  var bankAmount = parseCleanNumber(document.getElementById("cb-pay-bank")?.value);
  var bankName = document.getElementById("cb-pay-bank-name")?.value;
  var transferTarget = document.getElementById("cb-transfer-target")?.value;

  if (currentMode === "transfer") {
    netTotal = parseCleanNumber(document.getElementById("cb-transfer-amount")?.value);
    subtotal = netTotal;
    cashAmount = netTotal;
  }

  if (netTotal <= 0) {
    alert("⚠️ ကျသင့်ငွေ သုည (၀) ထက် ကြီးရပါမည်။");
    return;
  }

  if (currentMode === "sale" || currentMode === "purchase") {
    if (currentBillItems.length === 0) {
      alert("⚠️ ကုန်ပစ္စည်း အနည်းဆုံး (၁) မျိုး ထည့်သွင်းပေးပါ။");
      return;
    }
  }

  var catLabel = currentMode === "sale" ? "အရောင်း" : currentMode === "purchase" ? "အဝယ်" : currentMode === "expense" ? "အသုံးစရိတ်" : "ငွေလွှဲ";

  var payload = {
    shop_id: currentCashbookShop,
    tx_date: txDate,
    category: catLabel,
    description: desc,
    voucher_no: vrNo,
    subtotal: subtotal,
    discount: discount,
    net_total: netTotal,
    cash_amount: cashAmount,
    bank_amount: bankAmount,
    bank_name: bankAmount > 0 ? bankName : "",
    transfer_target: currentMode === "transfer" ? transferTarget : "",
    items: currentBillItems
  };

  isCbSubmitting = true;

  try {
    closeEntryModalCashbook();
    if (typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("saveCashbookEntry", payload);
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", res.message || "ငွေစာရင်း သိမ်းဆည်းပြီးပါပြီ!");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadCashbookData(true, true);
    } else {
      throw new Error(res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    console.error("Save Cashbook Error:", err);
    if (typeof showToast === "function") showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isCbSubmitting = false;
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

/**
 * 💡 Delete Entry with Automatic Stock Reversal
 */
async function deleteEntryCashbook(id) {
  if (!confirm("⚠️ ဤငွေစာရင်းကို အမှန်တကယ် ဖျက်မှာ သေချာပါသလား? (စတိုလက်ကျန်ပါ မူလအတိုင်း ပြန်လည်ညှိပေးပါမည်)")) return;

  try {
    if (typeof toggleLoading === "function") toggleLoading(true);
    var res = await callApi("deleteCashbookEntry", { id: id });
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", res.message);
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

/**
 * 💡 A5 Twin Slip Print Engine (ဝယ်သူမိတ္တူ + ဆိုင်လက်ခံမိတ္တူ)
 */
async function openPrintModalCashbook(voucherNo) {
  if (!voucherNo) return;

  try {
    if (typeof toggleLoading === "function") toggleLoading(true);
    var res = await callApi("getVoucherDetails", { voucher_no: voucherNo });
    if (!res || !res.success) throw new Error("ဘောင်ချာ အသေးစိတ် ရယူ၍ မရပါ။");

    var v = res.voucher || {};
    var items = res.items || [];
    var area = document.getElementById("cb-printable-area");
    if (!area) return;

    var shopName = (ALL_CB_SHOPS.find(s => s.id === (v.shop_id || "").toLowerCase())?.name) || "မြကမ္ဘာစိုး ပိုးထည်တိုက်";

    // Generate Single Slip Template
    function generateSingleSlipHtml(copyTitle) {
      var itemRows = items.map((itm, i) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 4px; text-align: center;">${i+1}</td>
          <td style="padding: 4px;"><strong>[${itm.item_code}]</strong> ${window.escapeHtml(itm.item_name)}</td>
          <td style="padding: 4px; text-align: center;">${itm.quantity} ${itm.unit || "ထည်"}</td>
          <td style="padding: 4px; text-align: right;">${formatMoney(itm.unit_price)}</td>
          <td style="padding: 4px; text-align: right;"><strong>${formatMoney(itm.total_price)}</strong></td>
        </tr>
      `).join("");

      return `
        <div style="flex: 1; padding: 12px; border: 1px dashed #94a3b8; border-radius: 8px; font-size: 11px; line-height: 1.4;">
          <div style="text-align: center; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 8px;">
            <h2 style="font-size: 14px; font-weight: 900; margin: 0; color: #0f172a;">မြကမ္ဘာစိုး ပိုးထည်တိုက်</h2>
            <p style="font-size: 9px; margin: 2px 0; color: #64748b;">${shopName} • Cash Book System</p>
            <span style="display: inline-block; padding: 2px 8px; background: #f1f5f9; border-radius: 4px; font-weight: bold; font-size: 9px; color: #334155; margin-top: 2px;">${copyTitle}</span>
          </div>

          <table style="width: 100%; margin-bottom: 8px; font-size: 10px;">
            <tr><td><strong>ဘောင်ချာ:</strong> ${v.voucher_no}</td><td style="text-align: right;"><strong>ရက်စွဲ:</strong> ${v.tx_date}</td></tr>
            <tr><td colspan="2"><strong>ဝယ်သူ:</strong> ${window.escapeHtml(v.description)}</td></tr>
          </table>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10px;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 1.5px solid #cbd5e1; font-weight: bold;">
                <th style="padding: 4px; text-align: center; width: 24px;">စဉ်</th>
                <th style="padding: 4px; text-align: left;">ပစ္စည်း</th>
                <th style="padding: 4px; text-align: center; width: 45px;">ခုရေ</th>
                <th style="padding: 4px; text-align: right; width: 60px;">နှုန်း</th>
                <th style="padding: 4px; text-align: right; width: 70px;">သင့်ငွေ</th>
              </tr>
            </thead>
            <tbody>${itemRows || '<tr><td colspan="5" style="text-align: center; padding: 8px;">ပစ္စည်းစာရင်း မရှိပါ</td></tr>'}</tbody>
          </table>

          <div style="border-top: 1.5px solid #cbd5e1; padding-top: 4px; font-size: 10px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span>ကုန်ပစ္စည်း စုစုပေါင်း:</span><span>${formatMoney(v.subtotal)} ကျပ်</span>
            </div>
            ${Number(v.discount) > 0 ? `
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px; color: #e11d48;">
                <span>လျှော့ငွေ (Discount):</span><span>- ${formatMoney(v.discount)} ကျပ်</span>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 900; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #cbd5e1; color: #0f172a;">
              <span>အသားတင် ကျသင့်ငွေ:</span><span>${formatMoney(v.net_total)} ကျပ်</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: #64748b; margin-top: 4px;">
              <span>ငွေပေးချေမှု:</span><span>${Number(v.cash_amount) > 0 ? `Cash: ${formatMoney(v.cash_amount)} ` : ''}${Number(v.bank_amount) > 0 ? `(${v.bank_name || 'Bank'}: ${formatMoney(v.bank_amount)})` : ''}</span>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; margin-top: 24px; padding-top: 8px; font-size: 9px; text-align: center;">
            <div style="width: 80px; border-top: 1px solid #94a3b8; padding-top: 2px;">ဝယ်သူလက်မှတ်</div>
            <div style="width: 80px; border-top: 1px solid #94a3b8; padding-top: 2px;">စာရင်းကိုင်လက်မှတ်</div>
          </div>
        </div>
      `;
    }

    // Render A4 2-in-1 Landscape Layout (Left: Customer Copy / Right: Shop Copy)
    area.innerHTML = `
      <div style="display: flex; gap: 16px; width: 100%;">
        ${generateSingleSlipHtml("ဝယ်သူမိတ္တူ (Customer Copy)")}
        ${generateSingleSlipHtml("ဆိုင်လက်ခံမိတ္တူ (Office Copy)")}
      </div>
    `;

    var modal = document.getElementById("cb-print-modal");
    if (modal) modal.classList.remove("hidden");

  } catch (err) {
    if (typeof showToast === "function") showToast("ERROR", "Print မရပါ: " + err.message);
  } finally {
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

function closePrintModalCashbook() {
  var modal = document.getElementById("cb-print-modal");
  if (modal) modal.classList.add("hidden");
}

function triggerBrowserPrintCashbook() {
  var printContent = document.getElementById("cb-printable-area")?.innerHTML;
  if (!printContent) return;

  var win = window.open("", "_blank", "width=900,height=650");
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Print Voucher - Mya Gabar Soe</title>
        <style>
          @page { size: A4 landscape; margin: 10mm; }
          body { font-family: sans-serif; margin: 0; padding: 0; background: #fff; }
        </style>
      </head>
      <body onload="window.print(); window.close();">
        ${printContent}
      </body>
    </html>
  `);
  win.document.close();
}

function exportCsvCashbook() {
  if (!cbActiveData || cbActiveData.length === 0) {
    if (typeof showToast === "function") showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  var csv = "NO,DATE,CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCE,TRANSFER,VR NO\n";
  cbActiveData.forEach(function (r, idx) {
    var method = Number(r.bank_amount) > 0 ? (r.bank_name || "Bank") : "Cash";
    csv += (idx + 1) + "," +
           window.safeCsvCell(r.tx_date || "") + "," +
           window.safeCsvCell(r.category || "") + "," +
           window.safeCsvCell(r.description || "") + "," +
           window.safeCsvCell(method) + "," +
           (r.debit || 0) + "," +
           (r.credit || 0) + "," +
           (r.balance || 0) + "," +
           window.safeCsvCell(r.transfer_target || "") + "," +
           window.safeCsvCell(r.voucher_no || "") + "\n";
  });

  var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Cashbook_${currentCashbookShop}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 Global Export
window.CashbookEngine = {
  async init(shopId) {
    // Map 'bank' to 'main'
    currentCashbookShop = (shopId === "bank" || !shopId) ? "main" : shopId.toLowerCase();
    cbPage = 1;

    var container = document.getElementById("view-container");
    if (container) {
      if (!window.viewCache["cashbook"]) {
        try {
          var res = await fetch("views/cashbook.html?v=20261008");
          if (res.ok) {
            window.viewCache["cashbook"] = await res.text();
          }
        } catch (e) {}
      }
      if (window.viewCache["cashbook"]) {
        container.innerHTML = window.viewCache["cashbook"];
      }
    }

    await loadCashbookData(false, false);
  },
  loadCashbook: loadCashbookData,
  applyFilter: function () {
    cbPage = 1;
    loadCashbookData(false, false);
  },
  clearDateFilter: function () {
    var f = document.getElementById("cb-from-date");
    var t = document.getElementById("cb-to-date");
    if (f) f.value = "";
    if (t) t.value = "";
    cbPage = 1;
    loadCashbookData(false, false);
  },
  onSearchInput: onSearchInputCashbook,
  changePage: changePageCashbook,
  setMode: setModeCashbook,
  onCategorySelectChange: onCategorySelectChangeCashbook,
  onItemSelectChange: onItemSelectChangeCashbook,
  addLineItem: addLineItemCashbook,
  removeLineItem: removeLineItemCashbook,
  recalculateNetTotal: recalculateBillingTotals,
  onPaymentInputChange: onPaymentInputChangeCashbook,
  openEntryModal: openEntryModalCashbook,
  closeEntryModal: closeEntryModalCashbook,
  saveEntrySubmit: saveEntrySubmitCashbook,
  deleteEntry: deleteEntryCashbook,
  openPrintModal: openPrintModalCashbook,
  closePrintModal: closePrintModalCashbook,
  triggerBrowserPrint: triggerBrowserPrintCashbook,
  exportCsv: exportCsvCashbook
};
