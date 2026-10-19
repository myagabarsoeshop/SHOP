/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - YARN STORE MANAGEMENT ENGINE
 * File: cashbook-frontend/js/yarn.js
 * Standard: Strictly aligned with store.js architectural standards
 * Prefixes: YON-xxx (ယုံချည်), Y2/80-xx (၂/၈၀ ချည်), Y2/100-xx (၂/၁၀၀ ချည်)
 * ==============================================================================
 */

"use strict";

var yarnPage = 1;
var yarnLimit = 20;
var yarnTotalRows = 0;
var yarnActiveData = [];
var currentYarnShop = "main";
var searchTimeoutYarn = null;
var isYarnSubmitting = false;

var ALL_YARN_SHOPS = [
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

var availableYarnUnits = ["ထုပ်", "ပေါင်", "အောင်စ", "လိပ်", "ခွေ"];
try {
  var savedUnits = localStorage.getItem("mya_yarn_units");
  if (savedUnits) availableYarnUnits = JSON.parse(savedUnits);
} catch (e) {}

function saveNewYarnUnitToMemory(newUnit) {
  var u = String(newUnit || "").trim();
  if (u && !availableYarnUnits.includes(u)) {
    availableYarnUnits.push(u);
    try { localStorage.setItem("mya_yarn_units", JSON.stringify(availableYarnUnits)); } catch (e) {}
  }
}

/**
 * 💡 Generate Next Yarn Code (YON-xxx, Y2/80-xx, Y2/100-xx)
 */
function getNextAutoYarnCode(yarnType) {
  var typeStr = String(yarnType || "ယုံချည်").trim();
  var prefix = "YON-";
  if (typeStr.includes("၂/၈၀")) prefix = "Y2/80-";
  if (typeStr.includes("၂/၁၀၀")) prefix = "Y2/100-";

  var existingNums = yarnActiveData
    .map(function (i) { return i.item_code; })
    .filter(function (code) { return code && code.startsWith(prefix); })
    .map(function (code) {
      var part = code.replace(prefix, "");
      return parseInt(part, 10);
    })
    .filter(function (n) { return !isNaN(n); });

  var nextNum = existingNums.length > 0 ? Math.max.apply(null, existingNums) + 1 : 1;
  var padLength = prefix === "YON-" ? 3 : 2;
  return prefix + String(nextNum).padStart(padLength, "0");
}

function onYarnTypeChangeStore() {
  var typeEl = document.getElementById("yarn-modal-type");
  var codeEl = document.getElementById("yarn-modal-code");
  if (typeEl && codeEl && !codeEl.disabled) {
    codeEl.value = getNextAutoYarnCode(typeEl.value);
  }
}

function filterYarnData(list, searchVal, typeVal) {
  var safeList = Array.isArray(list) ? list : [];
  return safeList.filter(function (row) {
    if (typeVal && row.yarn_type !== typeVal) return false;
    if (!searchVal || !searchVal.trim()) return true;

    var q = searchVal.trim().toLowerCase();
    var codeMatch = String(row.item_code || "").toLowerCase().includes(q);
    var colorMatch = String(row.color_name || "").toLowerCase().includes(q);
    var noMatch = String(row.color_code || "").toLowerCase().includes(q);
    var typeMatch = String(row.yarn_type || "").toLowerCase().includes(q);

    return codeMatch || colorMatch || noMatch || typeMatch;
  });
}

function onSearchInputYarn() {
  if (searchTimeoutYarn) clearTimeout(searchTimeoutYarn);
  searchTimeoutYarn = setTimeout(function () {
    yarnPage = 1;
    renderTableYarn();
  }, 200);
}

async function loadYarnInventoryData(isSilent, forceRefresh) {
  var token = localStorage.getItem("golden_auth_token");
  if (!token) return;

  try {
    if (!isSilent && typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("getYarnInventory", {
      shop_id: currentYarnShop,
      forceRefresh: forceRefresh
    });

    if (!res || !res.success) {
      throw new Error(res?.message || "ချည်စတို အချက်အလက်များ ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    yarnActiveData = res.data || [];
    yarnTotalRows = yarnActiveData.length;

    yarnActiveData.forEach(function (i) {
      if (i.unit) saveNewYarnUnitToMemory(i.unit);
    });

    renderStatsYarn();
    renderTableYarn();

  } catch (err) {
    console.error("Yarn Load Error:", err);
    if (!isSilent && typeof showToast === "function") {
      showToast("ERROR", "ချည်ဒေတာ ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === "function") toggleLoading(false);
  }
}

function renderStatsYarn() {
  var searchInput = document.getElementById("yarn-search");
  var typeFilter = document.getElementById("yarn-type-filter");
  var filtered = filterYarnData(yarnActiveData, searchInput?.value, typeFilter?.value);

  var totalStock = 0;
  var totalValuation = 0;
  var lowStockCount = 0;

  filtered.forEach(function (item) {
    var stock = Number(item.current_stock || 0);
    var cost = Number(item.cost_price || 0);
    totalStock += stock;
    totalValuation += stock * cost;
    if (stock <= 10) lowStockCount++;
  });

  var elItems = document.getElementById("yarn-total-items");
  var elStock = document.getElementById("yarn-total-stock");
  var elVal = document.getElementById("yarn-total-value");
  var elLow = document.getElementById("yarn-low-stock");

  if (elItems) elItems.textContent = Number(filtered.length).toLocaleString("en-US");
  if (elStock) elStock.textContent = Number(totalStock).toLocaleString("en-US");
  if (elVal) elVal.textContent = Number(totalValuation).toLocaleString("en-US");
  if (elLow) elLow.textContent = Number(lowStockCount).toLocaleString("en-US");
}

function renderTableYarn() {
  var tbody = document.getElementById("yarn-table-body");
  if (!tbody) return;

  var searchInput = document.getElementById("yarn-search");
  var typeFilter = document.getElementById("yarn-type-filter");

  var filteredRows = filterYarnData(yarnActiveData, searchInput?.value, typeFilter?.value);
  var totalEntries = filteredRows.length;

  renderStatsYarn();

  if (!filteredRows || totalEntries === 0) {
    var currentShopName = (ALL_YARN_SHOPS.find(s => s.id === currentYarnShop)?.name) || currentYarnShop.toUpperCase();
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-10 text-slate-500 font-bold">${currentShopName} တွင် ချည်စာရင်း မရှိသေးပါ။</td></tr>`;
    updatePaginationUIYarn(0);
    return;
  }

  var totalPages = Math.ceil(totalEntries / yarnLimit) || 1;
  if (yarnPage > totalPages) yarnPage = totalPages;
  var startIndex = (yarnPage - 1) * yarnLimit;
  var endIndex = Math.min(startIndex + yarnLimit, totalEntries);
  var pageItems = filteredRows.slice(startIndex, endIndex);

  tbody.innerHTML = pageItems.map(function (row, idx) {
    var isLow = Number(row.current_stock || 0) <= 10;
    var wholesale = row.wholesale_price || 0;

    return '<tr class="hover:bg-slate-800/30 text-slate-300">' +
        '<td class="text-center font-semibold text-slate-500 py-3 px-2">' + (startIndex + idx + 1) + '</td>' +
        '<td class="font-mono text-xs font-bold text-amber-400 py-3 px-2">' + (window.escapeHtml(row.item_code) || "-") + '</td>' +
        '<td class="font-bold text-slate-200 py-3 px-2">' + (window.escapeHtml(row.yarn_type) || "-") + '</td>' +
        '<td class="text-center font-mono font-bold text-sky-400 py-3 px-2">' + (window.escapeHtml(row.color_code) || "-") + '</td>' +
        '<td class="font-bold text-slate-100 max-w-sm truncate py-3 px-2" title="' + window.escapeHtml(row.color_name) + '">' + (window.escapeHtml(row.color_name) || "-") + '</td>' +
        '<td class="text-center font-bold text-slate-400 py-3 px-2">' + (window.escapeHtml(row.unit || "ထုပ်")) + '</td>' +
        '<td class="text-right font-mono font-black py-3 px-2 ' + (isLow ? "text-rose-400 animate-pulse" : "text-emerald-400") + '">' + Number(row.current_stock || 0).toLocaleString("en-US") + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-bold py-3 px-2">' + Number(row.cost_price || 0).toLocaleString("en-US", {minimumFractionDigits: 2}) + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">' + Number(row.retail_price || 0).toLocaleString("en-US", {minimumFractionDigits: 2}) + '</td>' +
        '<td class="text-right text-amber-400 font-mono font-bold py-3 px-2">' + Number(wholesale).toLocaleString("en-US", {minimumFractionDigits: 2}) + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-2">' +
            '<button onclick="YarnEngine.openStockModal(\'' + window.escapeJsAttr(row.item_code) + '\')" class="text-emerald-400 hover:text-emerald-300 transition" title="Adjust Stock">' +
              '<i class="fa-solid fa-boxes-packing"></i>' +
            '</button>' +
            '<button onclick="YarnEngine.openTransferModal(\'' + window.escapeJsAttr(row.item_code) + '\')" class="text-sky-400 hover:text-sky-300 transition" title="Transfer Yarn">' +
              '<i class="fa-solid fa-right-left"></i>' +
            '</button>' +
            '<button onclick="YarnEngine.openEditModal(\'' + window.escapeJsAttr(row.item_code) + '\')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Yarn">' +
              '<i class="fa-solid fa-pen-to-square"></i>' +
            '</button>' +
            '<button onclick="YarnEngine.removeEntry(\'' + window.escapeJsAttr(row.item_code) + '\')" class="text-rose-400 hover:text-rose-300 transition" title="Remove Yarn">' +
              '<i class="fa-solid fa-trash-can"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join("");

  updatePaginationUIYarn(totalEntries);
}

function updatePaginationUIYarn(currentCount) {
  var info = document.getElementById("yarn-pagination-info");
  var totalToDisplay = (currentCount !== undefined) ? currentCount : yarnTotalRows;

  if (info) {
    var start = totalToDisplay === 0 ? 0 : (yarnPage - 1) * yarnLimit + 1;
    var end = Math.min(yarnPage * yarnLimit, totalToDisplay);
    info.innerHTML = 'Showing <span class="text-indigo-400 font-extrabold">' + start + '</span> to <span class="text-indigo-400 font-extrabold">' + end + '</span> of <span class="text-indigo-400 font-extrabold">' + totalToDisplay + '</span> entries';
  }

  var prevBtn = document.getElementById("yarn-btn-prev");
  if (prevBtn) prevBtn.disabled = (yarnPage === 1);

  var nextBtn = document.getElementById("yarn-btn-next");
  if (nextBtn) nextBtn.disabled = (yarnPage * yarnLimit >= totalToDisplay);
}

function changePageYarn(dir) {
  var searchInput = document.getElementById("yarn-search");
  var typeFilter = document.getElementById("yarn-type-filter");
  var filtered = filterYarnData(yarnActiveData, searchInput?.value, typeFilter?.value);
  var totalPages = Math.ceil(filtered.length / yarnLimit) || 1;

  if (dir === -1 && yarnPage > 1) {
    yarnPage--;
    renderTableYarn();
  } else if (dir === 1 && yarnPage < totalPages) {
    yarnPage++;
    renderTableYarn();
  }
}

function openItemModalYarn() {
  var titleEl = document.getElementById("yarn-form-title");
  if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-scroll text-indigo-400"></i> <span>Add New Yarn & Stock</span>';

  var shopSelect = document.getElementById("yarn-modal-shop");
  if (shopSelect) shopSelect.value = currentYarnShop;

  var dlUnit = document.getElementById("yarn-unit-options");
  if (dlUnit) dlUnit.innerHTML = availableYarnUnits.map(u => `<option value="${u}">`).join("");

  var typeEl = document.getElementById("yarn-modal-type");
  if (typeEl) typeEl.value = "ယုံချည်";

  var codeEl = document.getElementById("yarn-modal-code");
  if (codeEl) {
    codeEl.disabled = false;
    codeEl.value = getNextAutoYarnCode("ယုံချည်");
  }

  document.getElementById("yarn-modal-color-code").value = "";
  document.getElementById("yarn-modal-color-name").value = "";
  document.getElementById("yarn-modal-unit").value = "ထုပ်";
  document.getElementById("yarn-modal-retail").value = "";
  document.getElementById("yarn-modal-wholesale").value = "";
  document.getElementById("yarn-modal-stock").value = 0;
  document.getElementById("yarn-modal-cost").value = "";
  document.getElementById("yarn-modal-remark").value = "";

  var modalEl = document.getElementById("yarn-item-modal");
  if (modalEl) modalEl.classList.remove("hidden");
}

function openEditModalYarn(itemCode) {
  var item = yarnActiveData.find(i => i.item_code === itemCode);
  if (!item) return;

  var titleEl = document.getElementById("yarn-form-title");
  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen-to-square text-indigo-400"></i> <span>Edit Yarn (${item.item_code})</span>`;

  var shopSelect = document.getElementById("yarn-modal-shop");
  if (shopSelect) shopSelect.value = currentYarnShop;

  var codeEl = document.getElementById("yarn-modal-code");
  if (codeEl) { codeEl.value = item.item_code; codeEl.disabled = true; }

  document.getElementById("yarn-modal-type").value = item.yarn_type || "ယုံချည်";
  document.getElementById("yarn-modal-color-code").value = item.color_code || "";
  document.getElementById("yarn-modal-color-name").value = item.color_name || "";
  document.getElementById("yarn-modal-unit").value = item.unit || "ထုပ်";
  document.getElementById("yarn-modal-retail").value = item.retail_price || "";
  document.getElementById("yarn-modal-wholesale").value = item.wholesale_price || "";
  document.getElementById("yarn-modal-stock").value = item.current_stock || 0;
  document.getElementById("yarn-modal-cost").value = item.cost_price || "";
  document.getElementById("yarn-modal-remark").value = item.remark || "";

  var modalEl = document.getElementById("yarn-item-modal");
  if (modalEl) modalEl.classList.remove("hidden");
}

function closeItemModalYarn() {
  var modalEl = document.getElementById("yarn-item-modal");
  if (modalEl) modalEl.classList.add("hidden");
}

async function saveItemSubmitYarn(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isYarnSubmitting) return;

  var targetShop = document.getElementById("yarn-modal-shop")?.value || currentYarnShop;
  var itemCode = document.getElementById("yarn-modal-code")?.value.trim().toUpperCase() || "";
  var yarnType = document.getElementById("yarn-modal-type")?.value.trim() || "ယုံချည်";
  var colorCode = document.getElementById("yarn-modal-color-code")?.value.trim() || "";
  var colorName = document.getElementById("yarn-modal-color-name")?.value.trim() || "";
  var unitVal = document.getElementById("yarn-modal-unit")?.value.trim() || "ထုပ်";

  var retailPrice = parseCleanNumber(document.getElementById("yarn-modal-retail")?.value);
  var wholesalePrice = parseCleanNumber(document.getElementById("yarn-modal-wholesale")?.value);
  var costPrice = parseCleanNumber(document.getElementById("yarn-modal-cost")?.value);
  var initialStock = parseCleanNumber(document.getElementById("yarn-modal-stock")?.value);
  var remark = document.getElementById("yarn-modal-remark")?.value.trim() || "";

  if (costPrice <= 0) {
    alert("⚠️ မူရင်းဝယ်ဈေး (Cost Price) ကို သုညထက်ကြီးသော တန်ဖိုး ဖြည့်သွင်းပေးပါ။");
    document.getElementById("yarn-modal-cost")?.focus();
    return;
  }
  if (retailPrice <= 0) {
    alert("⚠️ လက်လီရောင်းဈေး (Retail Price) ကို သုညထက်ကြီးသော တန်ဖိုး ဖြည့်သွင်းပေးပါ။");
    document.getElementById("yarn-modal-retail")?.focus();
    return;
  }
  if (wholesalePrice <= 0) {
    alert("⚠️ လက်ကားဈေး (Wholesale Price) ကို သုညထက်ကြီးသော တန်ဖိုး ဖြည့်သွင်းပေးပါ။");
    document.getElementById("yarn-modal-wholesale")?.focus();
    return;
  }

  isYarnSubmitting = true;
  saveNewYarnUnitToMemory(unitVal);

  var payload = {
    shop_id: targetShop,
    item_code: itemCode,
    yarn_type: yarnType,
    color_code: colorCode,
    color_name: colorName,
    unit: unitVal,
    retail_price: retailPrice,
    wholesale_price: wholesalePrice,
    current_stock: initialStock,
    cost_price: costPrice,
    remark: remark
  };

  try {
    closeItemModalYarn();
    if (typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("saveYarnItem", payload);
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", "ချည်နှင့် စတိုလက်ကျန် သိမ်းဆည်းပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();

      if (targetShop !== currentYarnShop) {
        currentYarnShop = targetShop;
        var sSelect = document.getElementById("yarn-shop-select");
        if (sSelect) sSelect.value = targetShop;
      }
      await loadYarnInventoryData(true, true);
    } else {
      throw new Error(res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    console.error("Yarn Save Error:", err);
    if (typeof showToast === "function") showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isYarnSubmitting = false;
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

async function removeEntryYarn(itemCode) {
  if (!confirm(`⚠️ အမှန်တကယ် ဖျက်မှာ သေချာပါသလား (${itemCode})?`)) return;

  try {
    if (typeof toggleLoading === "function") toggleLoading(true);
    var res = await callApi("deleteYarnItem", { shop_id: currentYarnShop, item_code: itemCode });
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", "ချည် စာရင်း ဖျက်ပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadYarnInventoryData(true, true);
    } else {
      throw new Error(res?.message || "ဖျက်ဆီးမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("ERROR", "ဖျက်၍မရပါ: " + err.message);
  } finally {
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

function openTransferModalYarn(itemCode) {
  var item = yarnActiveData.find(i => i.item_code === itemCode);
  if (!item) return;

  var currentStock = Number(item.current_stock || 0);
  if (currentStock <= 0) {
    if (typeof showToast === "function") showToast("ERROR", "ဤဆိုင်တွင် ချည်လက်ကျန် (၀) ဖြစ်နေသဖြင့် လွှဲပြောင်း၍ မရပါ။");
    return;
  }

  document.getElementById("yarn-transfer-code").value = item.item_code;
  document.getElementById("yarn-transfer-name").textContent = `${item.item_code} - ${item.yarn_type} (${item.color_name})`;

  var fromShopName = (ALL_YARN_SHOPS.find(s => s.id === currentYarnShop)?.name) || currentYarnShop.toUpperCase();
  document.getElementById("yarn-transfer-from-display").value = fromShopName;
  document.getElementById("yarn-transfer-from").value = currentYarnShop;
  document.getElementById("yarn-transfer-current-stock").value = `${currentStock} ${item.unit || "ထုပ်"}`;

  // 💡 ယက်ကန်းလုပ်ငန်း ကို ထိပ်ဆုံး နံပါတ် (၁) ဦးစားပေး အဖြစ် ထားရှိခြင်း
  var toShopSelect = document.getElementById("yarn-transfer-to");
  var destinations = [];

  // ၁။ ယက်ကန်းလုပ်ငန်း ကို ပထမဆုံး ထည့်မည်
  destinations.push({ id: "weaving", name: "🧵 ယက်ကန်းလုပ်ငန်း (Weaving Workshop)" });

  // ၂။ အခြား ဆိုင်ခွဲများကို နောက်မှ ထည့်မည်
  ALL_YARN_SHOPS.forEach(function(s) {
    if (s.id !== currentYarnShop) {
      destinations.push(s);
    }
  });

  toShopSelect.innerHTML = destinations.map(function(s) {
    return `<option value="${s.id}" class="bg-[#0c1424]">${s.name}</option>`;
  }).join("");
  
  var qtyInput = document.getElementById("yarn-transfer-qty");
  qtyInput.value = "";
  qtyInput.max = currentStock;

  document.getElementById("yarn-transfer-remark").value = "";

  var modal = document.getElementById("yarn-transfer-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeTransferModalYarn() {
  var modal = document.getElementById("yarn-transfer-modal");
  if (modal) modal.classList.add("hidden");
}

async function saveTransferSubmitYarn(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isYarnSubmitting) return;

  var itemCode = document.getElementById("yarn-transfer-code")?.value;
  var fromShop = document.getElementById("yarn-transfer-from")?.value;
  var toShop = document.getElementById("yarn-transfer-to")?.value;
  var qty = parseCleanNumber(document.getElementById("yarn-transfer-qty")?.value);
  var remark = document.getElementById("yarn-transfer-remark")?.value.trim() || "";

  var item = yarnActiveData.find(i => i.item_code === itemCode);
  var maxStock = Number(item?.current_stock || 0);

  if (qty <= 0) {
    alert("⚠️ လွှဲပြောင်းမည့် အရေအတွက်ကို သုညထက်ကြီးသော ဂဏန်း ထည့်သွင်းပေးပါ။");
    return;
  }

  if (qty > maxStock) {
    alert(`⚠️ မူရင်းဆိုင်တွင် လက်ကျန် (${maxStock}) သာ ရှိသဖြင့် (${qty}) လွှဲပြောင်း၍ မရပါ။`);
    return;
  }

  isYarnSubmitting = true;

  try {
    closeTransferModalYarn();
    if (typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("transferYarnStock", {
      item_code: itemCode,
      from_shop: fromShop,
      to_shop: toShop,
      quantity: qty,
      remark: remark
    });

    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", res.message || "ချည် လွှဲပြောင်းမှု အောင်မြင်ပါသည်။");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadYarnInventoryData(true, true);
    } else {
      throw new Error(res?.message || "လွှဲပြောင်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    console.error("Yarn Transfer Error:", err);
    if (typeof showToast === "function") showToast("ERROR", "လွှဲပြောင်းမှု အမှား: " + err.message);
  } finally {
    isYarnSubmitting = false;
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

function openStockModalYarn(itemCode) {
  var item = yarnActiveData.find(i => i.item_code === itemCode);
  if (!item) return;

  document.getElementById("yarn-stock-code").value = item.item_code;
  document.getElementById("yarn-stock-name").textContent = `${item.item_code} - ${item.yarn_type} (${item.color_name})`;
  document.getElementById("yarn-stock-shop").textContent = `STORE: ${currentYarnShop.toUpperCase()}`;
  document.getElementById("yarn-stock-qty").value = item.current_stock || 0;
  document.getElementById("yarn-stock-cost").value = item.cost_price || 0;
  document.getElementById("yarn-stock-remark").value = item.remark || "";

  var modalEl = document.getElementById("yarn-stock-modal");
  if (modalEl) modalEl.classList.remove("hidden");
}

function closeStockModalYarn() {
  var modalEl = document.getElementById("yarn-stock-modal");
  if (modalEl) modalEl.classList.add("hidden");
}

async function saveStockSubmitYarn(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isYarnSubmitting) return;
  isYarnSubmitting = true;

  var payload = {
    shop_id: currentYarnShop,
    item_code: document.getElementById("yarn-stock-code")?.value || "",
    current_stock: parseCleanNumber(document.getElementById("yarn-stock-qty")?.value),
    cost_price: parseCleanNumber(document.getElementById("yarn-stock-cost")?.value),
    remark: document.getElementById("yarn-stock-remark")?.value.trim() || ""
  };

  try {
    closeStockModalYarn();
    if (typeof toggleLoading === "function") toggleLoading(true);

    var res = await callApi("updateYarnStock", payload);
    if (res && res.success) {
      if (typeof showToast === "function") showToast("SUCCESS", "ချည်စတိုလက်ကျန် ပြင်ဆင်ပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === "function") window.clearAllApiCache();
      await loadYarnInventoryData(true, true);
    } else {
      throw new Error(res?.message || "ပြင်ဆင်မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === "function") showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isYarnSubmitting = false;
    if (typeof toggleLoading === "function") toggleLoading(false);
  }
}

function exportCsvYarn() {
  if (!yarnActiveData || yarnActiveData.length === 0) {
    if (typeof showToast === "function") showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  var csv = "NO,CODE,YARN TYPE,COLOR NO,COLOR NAME,UNIT,CURRENT STOCK,COST PRICE,RETAIL PRICE,WHOLESALE PRICE,SHOP\n";
  yarnActiveData.forEach(function (r, idx) {
    csv += (idx + 1) + "," +
           window.safeCsvCell(r.item_code || "") + "," +
           window.safeCsvCell(r.yarn_type || "") + "," +
           window.safeCsvCell(r.color_code || "") + "," +
           window.safeCsvCell(r.color_name || "") + "," +
           window.safeCsvCell(r.unit || "ထုပ်") + "," + // 💡 Default Unit ကို "ထုပ်" ဟု ပြင်ထားသည်
           (r.current_stock || 0) + "," +
           (r.cost_price || 0) + "," +
           (r.retail_price || 0) + "," +
           (r.wholesale_price || 0) + "," +
           window.safeCsvCell(currentYarnShop.toUpperCase()) + "\n";
  });

  var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `YarnStore_${currentYarnShop}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 Global Export
window.YarnEngine = {
  async init(shopId) {
    currentYarnShop = shopId || "main";
    yarnPage = 1;

    var container = document.getElementById("view-container");
    if (container) {
      if (!window.viewCache["yarn"]) {
        try {
          var res = await fetch("views/yarn.html?v=20261008");
          if (res.ok) {
            window.viewCache["yarn"] = await res.text();
          }
        } catch (e) {}
      }
      if (window.viewCache["yarn"]) {
        container.innerHTML = window.viewCache["yarn"];
      }
    }

    var shopSelect = document.getElementById("yarn-shop-select");
    if (shopSelect) shopSelect.value = currentYarnShop;

    await loadYarnInventoryData(false, false);
  },
  loadInventory: loadYarnInventoryData,
  changeShop: function (shopId) {
    currentYarnShop = shopId;
    yarnPage = 1;
    loadYarnInventoryData(false, false);
  },
  applyFilter: function () {
    yarnPage = 1;
    renderTableYarn();
  },
  onSearchInput: onSearchInputYarn,
  changePage: changePageYarn,
  prevPage: function () { changePageYarn(-1); },
  nextPage: function () { changePageYarn(1); },
  openItemModal: openItemModalYarn,
  openEditModal: openEditModalYarn,
  closeItemModal: closeItemModalYarn,
  saveItemSubmit: saveItemSubmitYarn,
  removeEntry: removeEntryYarn,
  deleteItem: removeEntryYarn, // 💡 Compatibility အတွက် ထည့်သွင်းထားသည်
  openStockModal: openStockModalYarn,
  closeStockModal: closeStockModalYarn,
  saveStockSubmit: saveStockSubmitYarn,
  openTransferModal: openTransferModalYarn,
  closeTransferModal: closeTransferModalYarn,
  saveTransferSubmit: saveTransferSubmitYarn,
  exportCsv: exportCsvYarn,
  onYarnTypeChange: onYarnTypeChangeStore,
  onModalShopChange: function () {
    var typeEl = document.getElementById("yarn-modal-type");
    var codeEl = document.getElementById("yarn-modal-code");
    if (typeEl && codeEl && !codeEl.disabled) {
      codeEl.value = getNextAutoYarnCode(typeEl.value);
    }
  }
};
