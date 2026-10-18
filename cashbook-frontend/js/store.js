/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - STORE & INVENTORY MANAGEMENT ENGINE
 * File: cashbook-frontend/js/store.js
 * Standard: Built strictly on js/bank-cash.js Architectural Standards
 * ==============================================================================
 */

"use strict";

var storePage = 1;
var storeLimit = 20;
var storeTotalRows = 0;
var storeActiveData = [];
var currentStoreShop = "main";
var searchTimeoutStore = null;
var isStoreSubmitting = false;

// 💡 Units Dynamic Memory
var availableUnits = ["ထည်", "ကိုက်", "ပေါင်", "ထုပ်", "လိပ်", "စုံ"];
try {
  var savedUnits = localStorage.getItem("mya_stored_units");
  if (savedUnits) availableUnits = JSON.parse(savedUnits);
} catch (e) {}

function saveNewUnitToMemory(newUnit) {
  var u = String(newUnit || "").trim();
  if (u && !availableUnits.includes(u)) {
    availableUnits.push(u);
    try {
      localStorage.setItem("mya_stored_units", JSON.stringify(availableUnits));
    } catch (e) {}
  }
}

/**
 * 💡 Adjust Font Sizes to Prevent Truncation on Large Numbers
 */
function adjustStoreKpiFontSizes() {
  const kpiIds = ['store-total-items', 'store-total-stock', 'store-total-value', 'store-low-stock'];
  kpiIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.fontSize = '24px';
    el.style.whiteSpace = 'nowrap';
    let currentSize = 24;
    while (el.scrollWidth > el.clientWidth && currentSize > 12) {
      currentSize--;
      el.style.fontSize = currentSize + 'px';
    }
  });
}
window.addEventListener('resize', adjustStoreKpiFontSizes);

/**
 * 🔍 Filter Store Data
 */
function filterStoreData(list, searchVal, categoryVal) {
  var safeList = Array.isArray(list) ? list : [];
  return safeList.filter(function(row) {
    if (categoryVal && row.category !== categoryVal) return false;
    if (!searchVal || !searchVal.trim()) return true;

    var q = searchVal.trim().toLowerCase();
    var codeMatch = String(row.item_code || '').toLowerCase().includes(q);
    var nameMatch = String(row.item_name || '').toLowerCase().includes(q);
    var catMatch = String(row.category || '').toLowerCase().includes(q);
    var subMatch = String(row.sub_category || '').toLowerCase().includes(q);

    return codeMatch || nameMatch || catMatch || subMatch;
  });
}

function onSearchInputStore() {
  if (searchTimeoutStore) clearTimeout(searchTimeoutStore);
  searchTimeoutStore = setTimeout(function() {
    storePage = 1;
    renderTableStore();
  }, 200);
}

/**
 * 💡 Load Store Inventory Data from D1
 */
async function loadStoreInventoryData(isSilent, forceRefresh) {
  var token = localStorage.getItem('golden_auth_token');
  if (!token) return;

  try {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

    var res = await callApi('getStoreInventory', {
      shop_id: currentStoreShop,
      forceRefresh: forceRefresh
    });

    if (!res || !res.success) {
      throw new Error(res?.message || "စတို အချက်အလက်များ ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    storeActiveData = res.data || [];
    storeTotalRows = storeActiveData.length;

    renderStatsStore();
    renderTableStore();

  } catch (err) {
    console.error("Store Load Error:", err);
    if (!isSilent && typeof showToast === 'function') {
      showToast("ERROR", "စတိုဒေတာ ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Render Stats Box 4 ခု
 */
function renderStatsStore() {
  var searchInput = document.getElementById('store-search');
  var catFilter = document.getElementById('store-category-filter');
  var filtered = filterStoreData(storeActiveData, searchInput?.value, catFilter?.value);

  var totalStock = 0;
  var totalValuation = 0;
  var lowStockCount = 0;

  filtered.forEach(item => {
    var stock = Number(item.current_stock || 0);
    var cost = Number(item.cost_price || 0);
    totalStock += stock;
    totalValuation += stock * cost;
    if (stock <= 10) lowStockCount++;
  });

  var elItems = document.getElementById('store-total-items');
  var elStock = document.getElementById('store-total-stock');
  var elVal = document.getElementById('store-total-value');
  var elLow = document.getElementById('store-low-stock');

  if (elItems) elItems.textContent = Number(filtered.length).toLocaleString('en-US');
  if (elStock) elStock.textContent = Number(totalStock).toLocaleString('en-US');
  if (elVal) elVal.textContent = Number(totalValuation).toLocaleString('en-US') + " MMK";
  if (elLow) elLow.textContent = Number(lowStockCount).toLocaleString('en-US');

  setTimeout(adjustStoreKpiFontSizes, 50);
}

/**
 * 💡 Render Table Grid Rows with sticky Action
 */
function renderTableStore() {
  var tbody = document.getElementById('store-table-body');
  if (!tbody) return;

  var searchInput = document.getElementById('store-search');
  var catFilter = document.getElementById('store-category-filter');

  var filteredRows = filterStoreData(storeActiveData, searchInput?.value, catFilter?.value);
  var totalEntries = filteredRows.length;

  renderStatsStore();

  if (!filteredRows || totalEntries === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ပစ္စည်း မရှိပါ။</td></tr>';
    updatePaginationUIStore(0);
    return;
  }

  var totalPages = Math.ceil(totalEntries / storeLimit) || 1;
  if (storePage > totalPages) storePage = totalPages;
  var startIndex = (storePage - 1) * storeLimit;
  var endIndex = Math.min(startIndex + storeLimit, totalEntries);
  var pageItems = filteredRows.slice(startIndex, endIndex);

  tbody.innerHTML = pageItems.map(function(row, idx) {
    var isLow = Number(row.current_stock || 0) <= 10;
    var wholesale = row.wholesale_price || row.default_price || 0;

    var catBadge = typeof window.formatCategoryBadgeHtml === 'function' 
      ? window.formatCategoryBadgeHtml(row.category + (row.sub_category ? ' / ' + row.sub_category : '')) 
      : window.escapeHtml(row.category);

    return '<tr class="hover:bg-slate-800/30 text-slate-300">' +
        '<td class="text-center font-semibold text-slate-500 py-3 px-2">' + (startIndex + idx + 1) + '</td>' +
        '<td class="font-mono text-xs font-bold text-amber-400 py-3 px-2">' + (window.escapeHtml(row.item_code) || '-') + '</td>' +
        '<td class="font-bold text-slate-100 max-w-sm truncate py-3 px-2" title="' + window.escapeHtml(row.item_name) + '">' + (window.escapeHtml(row.item_name) || '-') + '</td>' +
        '<td class="py-3 px-2">' + catBadge + '</td>' +
        '<td class="text-center font-bold text-slate-400 py-3 px-2">' + (window.escapeHtml(row.unit || 'ထည်')) + '</td>' +
        '<td class="text-right font-mono font-black py-3 px-2 ' + (isLow ? 'text-rose-400 animate-pulse' : 'text-emerald-400') + '">' + Number(row.current_stock || 0).toLocaleString('en-US') + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-bold py-3 px-2">' + Number(row.cost_price || 0).toLocaleString('en-US', {minimumFractionDigits: 2}) + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">' + Number(row.retail_price || 0).toLocaleString('en-US', {minimumFractionDigits: 2}) + '</td>' +
        '<td class="text-right text-amber-400 font-mono font-bold py-3 px-2">' + Number(wholesale).toLocaleString('en-US', {minimumFractionDigits: 2}) + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-3">' +
            '<button onclick="StoreEngine.openStockModal(\'' + window.escapeJsAttr(row.item_code) + '\')" class="text-emerald-400 hover:text-emerald-300 transition" title="Adjust Stock">' +
              '<i class="fa-solid fa-boxes-packing"></i>' +
            '</button>' +
            '<button onclick="StoreEngine.openEditModal(\'' + window.escapeJsAttr(row.item_code) + '\')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Item">' +
              '<i class="fa-solid fa-pen-to-square"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join('');

  updatePaginationUIStore(totalEntries);
}

function updatePaginationUIStore(currentCount) {
  var info = document.getElementById('store-pagination-info');
  var totalToDisplay = (currentCount !== undefined) ? currentCount : storeTotalRows;

  if (info) {
    var start = totalToDisplay === 0 ? 0 : (storePage - 1) * storeLimit + 1;
    var end = Math.min(storePage * storeLimit, totalToDisplay);
    info.innerHTML = 'Showing <span class="text-indigo-400 font-extrabold">' + start + '</span> to <span class="text-indigo-400 font-extrabold">' + end + '</span> of <span class="text-indigo-400 font-extrabold">' + totalToDisplay + '</span> entries';
  }

  var prevBtn = document.getElementById('store-btn-prev');
  if (prevBtn) prevBtn.disabled = (storePage === 1);

  var nextBtn = document.getElementById('store-btn-next');
  if (nextBtn) nextBtn.disabled = (storePage * storeLimit >= totalToDisplay);
}

function changePageStore(dir) {
  var searchInput = document.getElementById('store-search');
  var catFilter = document.getElementById('store-category-filter');
  var filtered = filterStoreData(storeActiveData, searchInput?.value, catFilter?.value);
  var totalPages = Math.ceil(filtered.length / storeLimit) || 1;

  if (dir === -1 && storePage > 1) {
    storePage--;
    renderTableStore();
  } else if (dir === 1 && storePage < totalPages) {
    storePage++;
    renderTableStore();
  }
}

/**
 * 💡 Modal Controls (One-Stop Auto-Registration)
 */
function openItemModalStore() {
  var titleEl = document.getElementById('store-form-title');
  if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-boxes-packing text-indigo-400"></i> <span>Add New Item & Stock</span>';

  var shopSelect = document.getElementById('modal-item-shop');
  if (shopSelect) shopSelect.value = currentStoreShop;

  var codeEl = document.getElementById('modal-item-code');
  if (codeEl) { codeEl.value = ""; codeEl.disabled = false; }

  document.getElementById('modal-item-name').value = "";
  document.getElementById('modal-item-unit').value = "ထည်";
  document.getElementById('modal-item-category').value = "ပုဆိုး";
  document.getElementById('modal-item-subcategory').value = "";
  document.getElementById('modal-item-retail').value = 0;
  document.getElementById('modal-item-wholesale').value = 0;
  document.getElementById('modal-item-stock').value = 0;
  document.getElementById('modal-item-cost').value = 0;
  document.getElementById('modal-item-remark').value = "";

  var dl = document.getElementById('unit-options');
  if (dl) dl.innerHTML = availableUnits.map(u => `<option value="${u}">`).join("");

  var modalEl = document.getElementById('store-item-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function openEditModalStore(itemCode) {
  var item = storeActiveData.find(i => i.item_code === itemCode);
  if (!item) return;

  var titleEl = document.getElementById('store-form-title');
  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen-to-square text-indigo-400"></i> <span>Edit Item (${item.item_code})</span>`;

  var shopSelect = document.getElementById('modal-item-shop');
  if (shopSelect) shopSelect.value = currentStoreShop;

  var codeEl = document.getElementById('modal-item-code');
  if (codeEl) { codeEl.value = item.item_code; codeEl.disabled = true; }

  document.getElementById('modal-item-name').value = item.item_name || "";
  document.getElementById('modal-item-unit').value = item.unit || "ထည်";
  document.getElementById('modal-item-category').value = item.category || "ပုဆိုး";
  document.getElementById('modal-item-subcategory').value = item.sub_category || "";
  document.getElementById('modal-item-retail').value = item.retail_price || 0;
  document.getElementById('modal-item-wholesale').value = item.wholesale_price || item.default_price || 0;
  document.getElementById('modal-item-stock').value = item.current_stock || 0;
  document.getElementById('modal-item-cost').value = item.cost_price || 0;
  document.getElementById('modal-item-remark').value = item.remark || "";

  var modalEl = document.getElementById('store-item-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeItemModalStore() {
  var modalEl = document.getElementById('store-item-modal');
  if (modalEl) modalEl.classList.add('hidden');
}

async function saveItemSubmitStore(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isStoreSubmitting) return;
  isStoreSubmitting = true;

  var targetShop = document.getElementById('modal-item-shop')?.value || currentStoreShop;
  var itemCode = document.getElementById('modal-item-code')?.value.trim().toUpperCase() || "";
  var unitVal = document.getElementById('modal-item-unit')?.value.trim() || "ထည်";
  var initialStock = parseInt(document.getElementById('modal-item-stock')?.value, 10) || 0;
  var costPrice = parseFloat(document.getElementById('modal-item-cost')?.value) || 0;

  saveNewUnitToMemory(unitVal);

  var payload = {
    item_code: itemCode,
    item_name: document.getElementById('modal-item-name')?.value.trim() || "",
    unit: unitVal,
    category: document.getElementById('modal-item-category')?.value.trim() || "ပုဆိုး",
    sub_category: document.getElementById('modal-item-subcategory')?.value.trim() || "",
    retail_price: parseFloat(document.getElementById('modal-item-retail')?.value) || 0,
    wholesale_price: parseFloat(document.getElementById('modal-item-wholesale')?.value) || 0,
    remark: document.getElementById('modal-item-remark')?.value.trim() || ""
  };

  try {
    closeItemModalStore();
    if (typeof toggleLoading === 'function') toggleLoading(true);

    var res = await callApi('saveItem', payload);
    if (res && res.success) {
      await callApi('updateStock', {
        shop_id: targetShop,
        item_code: itemCode,
        current_stock: initialStock,
        cost_price: costPrice,
        remark: payload.remark || "Initial Stock"
      });

      if (typeof showToast === 'function') showToast("SUCCESS", "ပစ္စည်းနှင့် စတိုလက်ကျန် သိမ်းဆည်းပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();

      if (targetShop !== currentStoreShop) {
        currentStoreShop = targetShop;
        var sSelect = document.getElementById('store-shop-select');
        if (sSelect) sSelect.value = targetShop;
      }
      await loadStoreInventoryData(true, true);
    } else {
      throw new Error(res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isStoreSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function openStockModalStore(itemCode) {
  var item = storeActiveData.find(i => i.item_code === itemCode);
  if (!item) return;

  document.getElementById('stock-modal-code').value = item.item_code;
  document.getElementById('stock-modal-name').textContent = `${item.item_code} - ${item.item_name}`;
  document.getElementById('stock-modal-shop').textContent = `STORE: ${currentStoreShop.toUpperCase()}`;
  document.getElementById('stock-modal-qty').value = item.current_stock || 0;
  document.getElementById('stock-modal-cost').value = item.cost_price || 0;
  document.getElementById('stock-modal-remark').value = item.remark || "";

  var modalEl = document.getElementById('store-stock-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeStockModalStore() {
  var modalEl = document.getElementById('store-stock-modal');
  if (modalEl) modalEl.classList.add('hidden');
}

async function saveStockSubmitStore(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isStoreSubmitting) return;
  isStoreSubmitting = true;

  var payload = {
    shop_id: currentStoreShop,
    item_code: document.getElementById('stock-modal-code')?.value || "",
    current_stock: parseInt(document.getElementById('stock-modal-qty')?.value, 10) || 0,
    cost_price: parseFloat(document.getElementById('stock-modal-cost')?.value) || 0,
    remark: document.getElementById('stock-modal-remark')?.value.trim() || ""
  };

  try {
    closeStockModalStore();
    if (typeof toggleLoading === 'function') toggleLoading(true);

    var res = await callApi('updateStock', payload);
    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "စတိုလက်ကျန် ပြင်ဆင်ပြီးပါပြီ။");
      if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();
      await loadStoreInventoryData(true, true);
    } else {
      throw new Error(res?.message || "ပြင်ဆင်မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isStoreSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function exportCsvStore() {
  if (!storeActiveData || storeActiveData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  var csv = "NO,CODE,ITEM NAME,CATEGORY,UNIT,CURRENT STOCK,COST PRICE,RETAIL PRICE,WHOLESALE PRICE,SHOP\n";
  storeActiveData.forEach(function(r, idx) {
    var wholesale = r.wholesale_price || r.default_price || 0;
    csv += (idx + 1) + ',' +
           window.safeCsvCell(r.item_code || '') + ',' +
           window.safeCsvCell(r.item_name || '') + ',' +
           window.safeCsvCell(r.category || '') + ',' +
           window.safeCsvCell(r.unit || 'ထည်') + ',' +
           (r.current_stock || 0) + ',' +
           (r.cost_price || 0) + ',' +
           (r.retail_price || 0) + ',' +
           wholesale + ',' +
           window.safeCsvCell(currentStoreShop.toUpperCase()) + '\n';
  });

  var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Store_${currentStoreShop}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 Export Engine Methods globally to window.StoreEngine
window.StoreEngine = {
  async init(shopId) {
    currentStoreShop = shopId || "main";
    storePage = 1;

    // Load views/store.html template
    var container = document.getElementById("view-container");
    if (container) {
      if (!window.viewCache["store"]) {
        try {
          var res = await fetch("views/store.html?v=20261008");
          if (res.ok) {
            window.viewCache["store"] = await res.text();
          }
        } catch (e) {}
      }
      if (window.viewCache["store"]) {
        container.innerHTML = window.viewCache["store"];
      }
    }

    var shopSelect = document.getElementById("store-shop-select");
    if (shopSelect) shopSelect.value = currentStoreShop;

    await loadStoreInventoryData(false, false);
  },
  loadInventory: loadStoreInventoryData,
  changeShop: function(shopId) {
    currentStoreShop = shopId;
    storePage = 1;
    loadStoreInventoryData(false, false);
  },
  applyFilter: function() {
    storePage = 1;
    renderTableStore();
  },
  onSearchInput: onSearchInputStore,
  changePage: changePageStore,
  prevPage: function() { changePageStore(-1); },
  nextPage: function() { changePageStore(1); },
  openItemModal: openItemModalStore,
  openEditModal: openEditModalStore,
  closeItemModal: closeItemModalStore,
  saveItemSubmit: saveItemSubmitStore,
  openStockModal: openStockModalStore,
  closeStockModal: closeStockModalStore,
  saveStockSubmit: saveStockSubmitStore,
  exportCsv: exportCsvStore
};
