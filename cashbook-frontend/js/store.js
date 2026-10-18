/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - STORE & INVENTORY MANAGEMENT ENGINE
 * File: cashbook-frontend/js/store.js
 * Features:
 *   1. Top 4 Inventory KPI Cards (Items, Stock, Valuation, Low Stock Alert)
 *   2. Multi-Shop Selector (Main, Shop 1..5)
 *   3. Search, Category Filter, Excel Export
 *   4. Clean 20-row Pagination (Prev/Next)
 *   5. Quick Modal for Adding Item & Adjusting Stock
 * ==============================================================================
 */

"use strict";

const StoreEngine = (function () {
  let currentShop = "main";
  let allInventory = [];
  let filteredInventory = [];
  let currentPage = 1;
  const rowsPerPage = 20;

  const SHOPS = [
    { id: "main", name: "Main Home Shop (ပင်မ)" },
    { id: "shop1", name: "ဆိုင်ခွဲ (၁)" },
    { id: "shop2", name: "ဆိုင်ခွဲ (၂)" },
    { id: "shop3", name: "ဆိုင်ခွဲ (၃)" },
    { id: "shop4", name: "ဆိုင်ခွဲ (၄)" },
    { id: "shop5", name: "ဆိုင်ခွဲ (၅)" }
  ];

  function formatMoney(num) {
    return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 0 });
  }

  return {
    async init(shopId = "main") {
      currentShop = shopId;
      currentPage = 1;
      this.renderLayout();
      await this.loadInventory();
    },

    renderLayout() {
      const container = document.getElementById("view-container");
      if (!container) return;

      container.innerHTML = `
        <div class="space-y-4">
          <!-- 💡 1. TOP 4 KPI CARDS -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <!-- Card 1: Total Items -->
            <div class="bg-[#0e172a] border border-slate-800 p-3.5 rounded-2xl shadow-lg relative overflow-hidden">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ပစ္စည်းအမျိုးအစားစုံ</p>
                  <h3 id="card-total-items" class="text-xl font-black text-indigo-400 mt-1">0</h3>
                </div>
                <div class="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 text-lg">
                  <i class="fa-solid fa-shapes"></i>
                </div>
              </div>
            </div>

            <!-- Card 2: Total Stock Qty -->
            <div class="bg-[#0e172a] border border-slate-800 p-3.5 rounded-2xl shadow-lg relative overflow-hidden">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">စုစုပေါင်း အထည်လက်ကျန်</p>
                  <h3 id="card-total-stock" class="text-xl font-black text-emerald-400 mt-1">0</h3>
                </div>
                <div class="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-lg">
                  <i class="fa-solid fa-boxes-stacked"></i>
                </div>
              </div>
            </div>

            <!-- Card 3: Store Valuation -->
            <div class="bg-[#0e172a] border border-slate-800 p-3.5 rounded-2xl shadow-lg relative overflow-hidden">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">စတို စုစုပေါင်းတန်ဖိုး (ကျပ်)</p>
                  <h3 id="card-total-value" class="text-xl font-black text-amber-400 mt-1">0</h3>
                </div>
                <div class="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 text-lg">
                  <i class="fa-solid fa-coins"></i>
                </div>
              </div>
            </div>

            <!-- Card 4: Low Stock Alert -->
            <div class="bg-[#0e172a] border border-slate-800 p-3.5 rounded-2xl shadow-lg relative overflow-hidden">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">လက်ကျန်နည်း အထည် (≤ 10)</p>
                  <h3 id="card-low-stock" class="text-xl font-black text-rose-400 mt-1">0</h3>
                </div>
                <div class="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-400 text-lg">
                  <i class="fa-solid fa-triangle-exclamation"></i>
                </div>
              </div>
            </div>
          </div>

          <!-- 💡 2. FILTER & ACTION TOOLBAR -->
          <div class="bg-[#0e172a] border border-slate-800 p-3 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 shadow-md">
            <div class="flex flex-wrap items-center gap-2">
              <!-- Shop Selector -->
              <div class="flex items-center bg-[#070a12] border border-slate-700/60 rounded-xl px-2.5 py-1.5">
                <i class="fa-solid fa-shop text-amber-400 text-xs mr-2"></i>
                <select id="store-shop-select" onchange="StoreEngine.changeShop(this.value)" class="bg-transparent text-xs font-bold text-slate-100 outline-none cursor-pointer">
                  ${SHOPS.map(s => `<option value="${s.id}" ${s.id === currentShop ? "selected" : ""}>${s.name}</option>`).join("")}
                </select>
              </div>

              <!-- Search Input -->
              <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                <input type="text" id="store-search-input" oninput="StoreEngine.applyFilter()" placeholder="ကုတ် သို့မဟုတ် အမည်ဖြင့် ရှာရန်..." 
                  class="bg-[#070a12] border border-slate-700/60 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-amber-400 w-48 md:w-60">
              </div>

              <!-- Category Filter -->
              <select id="store-category-filter" onchange="StoreEngine.applyFilter()" class="bg-[#070a12] border border-slate-700/60 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none font-semibold">
                <option value="">အမျိုးအစား အားလုံး</option>
                <option value="ပုဆိုး">ပုဆိုး</option>
                <option value="လုံချည်">လုံချည်</option>
                <option value="အင်္ကျီ">အင်္ကျီ</option>
                <option value="ဝမ်းဆက်">ဝမ်းဆက်</option>
                <option value="ပိတ်စ">ပိတ်စ</option>
                <option value="ချည်">ချည်</option>
              </select>
            </div>

            <!-- Action Buttons -->
            <div class="flex items-center gap-2">
              <button onclick="StoreEngine.loadInventory()" class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition text-xs" title="Refresh">
                <i class="fa-solid fa-rotate"></i>
              </button>
              <button onclick="StoreEngine.exportExcel()" class="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-bold rounded-xl transition text-xs flex items-center gap-1.5">
                <i class="fa-solid fa-file-excel"></i> <span>Export</span>
              </button>
              <button onclick="StoreEngine.openItemModal()" class="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl transition text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20">
                <i class="fa-solid fa-plus"></i> <span>ပစ္စည်းအသစ်</span>
              </button>
            </div>
          </div>

          <!-- 💡 3. INVENTORY DATA TABLE -->
          <div class="bg-[#0e172a] border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs text-slate-300">
                <thead class="bg-[#0b1120] text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th class="px-4 py-3 text-center w-12">#</th>
                    <th class="px-4 py-3">Item Code</th>
                    <th class="px-4 py-3">ပစ္စည်းအမည်</th>
                    <th class="px-4 py-3">အမျိုးအစား</th>
                    <th class="px-4 py-3 text-center">ယူနစ်</th>
                    <th class="px-4 py-3 text-right">လက်ကျန်</th>
                    <th class="px-4 py-3 text-right text-slate-400">မူရင်းဈေး</th>
                    <th class="px-4 py-3 text-right text-emerald-400">လက်လီဈေး</th>
                    <th class="px-4 py-3 text-right text-amber-400">လက်ကားဈေး</th>
                    <th class="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody id="store-table-body" class="divide-y divide-slate-800/60 font-medium">
                  <tr>
                    <td colspan="10" class="text-center py-8 text-slate-500">ဒေတာများကို ဆွဲယူနေပါသည်...</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 💡 4. PAGINATION FOOTER (20 rows) -->
            <div class="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 bg-[#090f1d]">
              <span id="store-pagination-info">Showing 0 to 0 of 0 entries</span>
              <div class="flex items-center gap-1.5" id="store-pagination-controls">
                <button onclick="StoreEngine.prevPage()" id="btn-prev-page" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">Previous</button>
                <span id="store-current-page" class="px-3 py-1 font-bold text-amber-400">1</span>
                <button onclick="StoreEngine.nextPage()" id="btn-next-page" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 💡 5. MODAL: ADD / EDIT ITEM -->
        <div id="item-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] hidden items-center justify-center p-4">
          <div class="bg-[#0e172a] border border-amber-500/20 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden p-6 text-slate-200 space-y-4">
            <div class="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 class="text-sm font-black text-amber-400 flex items-center gap-2">
                <i class="fa-solid fa-box-open"></i> <span id="modal-item-title">ပစ္စည်းအသစ် ထည့်သွင်းခြင်း</span>
              </h3>
              <button onclick="StoreEngine.closeItemModal()" class="text-slate-500 hover:text-white"><i class="fa-solid fa-xmark text-sm"></i></button>
            </div>
            <form onsubmit="StoreEngine.saveItemSubmit(event)" class="space-y-3 text-xs">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-400 mb-1">Item Code *</label>
                  <input type="text" id="modal-item-code" required placeholder="e.g. PAS-006" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-100 outline-none uppercase font-mono">
                </div>
                <div>
                  <label class="block font-bold text-slate-400 mb-1">ယူနစ်</label>
                  <input type="text" id="modal-item-unit" value="ထည်" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-100 outline-none">
                </div>
              </div>
              <div>
                <label class="block font-bold text-slate-400 mb-1">ပစ္စည်းအမည် *</label>
                <input type="text" id="modal-item-name" required placeholder="e.g. မိုးကင်းတက် ပုဆိုး" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-100 outline-none font-bold">
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-400 mb-1">ပင်မအမျိုးအစား</label>
                  <input type="text" id="modal-item-category" value="ပုဆိုး" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-100 outline-none">
                </div>
                <div>
                  <label class="block font-bold text-slate-400 mb-1">အမျိုးအစားစိပ်</label>
                  <input type="text" id="modal-item-subcategory" placeholder="e.g. မိုးကင်း တက်" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-100 outline-none">
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-slate-400 mb-1">လက်လီရောင်းဈေး</label>
                  <input type="number" id="modal-item-retail" value="0" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-emerald-400 font-bold outline-none">
                </div>
                <div>
                  <label class="block font-bold text-slate-400 mb-1">လက်ကားဈေး (Default)</label>
                  <input type="number" id="modal-item-default" value="0" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-amber-400 font-bold outline-none">
                </div>
              </div>
              <div>
                <label class="block font-bold text-slate-400 mb-1">မှတ်ချက်</label>
                <input type="text" id="modal-item-remark" placeholder="အရောင် သို့မဟုတ် အထွေထွေ..." class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-100 outline-none">
              </div>
              <div class="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button type="button" onclick="StoreEngine.closeItemModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold">Cancel</button>
                <button type="submit" class="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl">Save Item</button>
              </div>
            </form>
          </div>
        </div>

        <!-- 💡 6. MODAL: ADJUST STOCK -->
        <div id="stock-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[200] hidden items-center justify-center p-4">
          <div class="bg-[#0e172a] border border-emerald-500/20 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden p-6 text-slate-200 space-y-4">
            <div class="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 class="text-sm font-black text-emerald-400 flex items-center gap-2">
                <i class="fa-solid fa-boxes-packing"></i> <span>စတိုလက်ကျန် ညှိယူခြင်း</span>
              </h3>
              <button onclick="StoreEngine.closeStockModal()" class="text-slate-500 hover:text-white"><i class="fa-solid fa-xmark text-sm"></i></button>
            </div>
            <form onsubmit="StoreEngine.saveStockSubmit(event)" class="space-y-3 text-xs">
              <input type="hidden" id="stock-modal-code">
              <div>
                <p class="text-[11px] text-slate-400 font-bold">ပစ္စည်း:</p>
                <p id="stock-modal-name" class="text-sm font-black text-amber-400"></p>
                <p id="stock-modal-shop" class="text-[10px] text-slate-500 uppercase font-bold mt-0.5"></p>
              </div>
              <div>
                <label class="block font-bold text-slate-400 mb-1">လက်ကျန် အရေအတွက်</label>
                <input type="number" id="stock-modal-qty" required min="0" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-emerald-400 font-black text-base outline-none">
              </div>
              <div>
                <label class="block font-bold text-slate-400 mb-1">မူရင်းဝယ်ဈေး (Cost Price)</label>
                <input type="number" id="stock-modal-cost" required min="0" class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-200 font-bold outline-none">
              </div>
              <div>
                <label class="block font-bold text-slate-400 mb-1">မှတ်ချက်</label>
                <input type="text" id="stock-modal-remark" placeholder="အကြောင်းအရာ..." class="w-full p-2.5 bg-[#070a12] border border-slate-700 rounded-xl text-slate-100 outline-none">
              </div>
              <div class="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button type="button" onclick="StoreEngine.closeStockModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold">Cancel</button>
                <button type="submit" class="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl">Update Stock</button>
              </div>
            </form>
          </div>
        </div>
      `;
    },

    async loadInventory() {
      try {
        if (window.toggleLoading) window.toggleLoading(true);
        const res = await window.callApi("getStoreInventory", { shop_id: currentShop });
        if (res && res.success) {
          allInventory = res.data || [];
          this.applyFilter();
        }
      } catch (err) {
        console.error("Load Inventory Error:", err);
      } finally {
        if (window.toggleLoading) window.toggleLoading(false);
      }
    },

    changeShop(newShopId) {
      currentShop = newShopId;
      currentPage = 1;
      this.loadInventory();
    },

    applyFilter() {
      const search = (document.getElementById("store-search-input")?.value || "").toLowerCase().trim();
      const cat = (document.getElementById("store-category-filter")?.value || "").trim();

      filteredInventory = allInventory.filter(item => {
        const matchSearch = !search || 
          (item.item_code && item.item_code.toLowerCase().includes(search)) ||
          (item.item_name && item.item_name.toLowerCase().includes(search)) ||
          (item.sub_category && item.sub_category.toLowerCase().includes(search));
        const matchCat = !cat || item.category === cat;
        return matchSearch && matchCat;
      });

      this.updateCards();
      currentPage = 1;
      this.renderTable();
    },

    updateCards() {
      let totalStock = 0;
      let totalValuation = 0;
      let lowStockCount = 0;

      filteredInventory.forEach(item => {
        const stock = Number(item.current_stock || 0);
        const cost = Number(item.cost_price || 0);
        totalStock += stock;
        totalValuation += stock * cost;
        if (stock <= 10) lowStockCount++;
      });

      document.getElementById("card-total-items").textContent = filteredInventory.length;
      document.getElementById("card-total-stock").textContent = formatMoney(totalStock);
      document.getElementById("card-total-value").textContent = formatMoney(totalValuation);
      document.getElementById("card-low-stock").textContent = lowStockCount;
    },

    renderTable() {
      const tbody = document.getElementById("store-table-body");
      if (!tbody) return;

      if (filteredInventory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-500 font-bold">ပစ္စည်းစာရင်း မရှိသေးပါ</td></tr>`;
        this.updatePagination(0);
        return;
      }

      const totalItems = filteredInventory.length;
      const totalPages = Math.ceil(totalItems / rowsPerPage) || 1;
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const startIndex = (currentPage - 1) * rowsPerPage;
      const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
      const pageData = filteredInventory.slice(startIndex, endIndex);

      let html = "";
      pageData.forEach((item, index) => {
        const isLow = Number(item.current_stock || 0) <= 10;
        html += `
          <tr class="hover:bg-slate-800/40 transition">
            <td class="px-4 py-2.5 text-center text-slate-500 font-mono">${startIndex + index + 1}</td>
            <td class="px-4 py-2.5 font-mono font-bold text-amber-400">${window.escapeHtml(item.item_code)}</td>
            <td class="px-4 py-2.5 font-bold text-slate-100">${window.escapeHtml(item.item_name)}</td>
            <td class="px-4 py-2.5 text-slate-400">${window.escapeHtml(item.category)}${item.sub_category ? ` / ${window.escapeHtml(item.sub_category)}` : ""}</td>
            <td class="px-4 py-2.5 text-center">${window.escapeHtml(item.unit || "ထည်")}</td>
            <td class="px-4 py-2.5 text-right font-black ${isLow ? 'text-rose-400 font-mono animate-pulse' : 'text-emerald-400 font-mono'}">
              ${formatMoney(item.current_stock)}
            </td>
            <td class="px-4 py-2.5 text-right font-mono text-slate-400">${formatMoney(item.cost_price)}</td>
            <td class="px-4 py-2.5 text-right font-mono text-emerald-400 font-bold">${formatMoney(item.retail_price)}</td>
            <td class="px-4 py-2.5 text-right font-mono text-amber-400">${formatMoney(item.default_price)}</td>
            <td class="px-4 py-2.5 text-center">
              <button onclick="StoreEngine.openStockModal('${item.item_code}')" class="px-2.5 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 rounded-lg font-bold text-[11px] transition">
                <i class="fa-solid fa-pen-to-square"></i> Stock
              </button>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = html;
      this.updatePagination(totalItems, startIndex + 1, endIndex, totalPages);
    },

    updatePagination(total, start = 0, end = 0, totalPages = 1) {
      const info = document.getElementById("store-pagination-info");
      const current = document.getElementById("store-current-page");
      const prevBtn = document.getElementById("btn-prev-page");
      const nextBtn = document.getElementById("btn-next-page");

      if (info) info.textContent = `Showing ${start} to ${end} of ${total} items`;
      if (current) current.textContent = `${currentPage} / ${totalPages}`;
      if (prevBtn) prevBtn.disabled = currentPage <= 1;
      if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    },

    prevPage() {
      if (currentPage > 1) {
        currentPage--;
        this.renderTable();
      }
    },

    nextPage() {
      const totalPages = Math.ceil(filteredInventory.length / rowsPerPage);
      if (currentPage < totalPages) {
        currentPage++;
        this.renderTable();
      }
    },

    openItemModal() {
      document.getElementById("modal-item-title").textContent = "ပစ္စည်းအသစ် ထည့်သွင်းခြင်း";
      document.getElementById("modal-item-code").value = "";
      document.getElementById("modal-item-code").disabled = false;
      document.getElementById("modal-item-name").value = "";
      document.getElementById("modal-item-category").value = "ပုဆိုး";
      document.getElementById("modal-item-subcategory").value = "";
      document.getElementById("modal-item-retail").value = 0;
      document.getElementById("modal-item-default").value = 0;
      document.getElementById("modal-item-remark").value = "";

      const modal = document.getElementById("item-modal");
      if (modal) { modal.classList.remove("hidden"); modal.classList.add("flex"); }
    },

    closeItemModal() {
      const modal = document.getElementById("item-modal");
      if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
    },

    async saveItemSubmit(e) {
      e.preventDefault();
      const payload = {
        item_code: document.getElementById("modal-item-code").value.trim().toUpperCase(),
        item_name: document.getElementById("modal-item-name").value.trim(),
        unit: document.getElementById("modal-item-unit").value.trim() || "ထည်",
        category: document.getElementById("modal-item-category").value.trim(),
        sub_category: document.getElementById("modal-item-subcategory").value.trim(),
        retail_price: parseFloat(document.getElementById("modal-item-retail").value) || 0,
        default_price: parseFloat(document.getElementById("modal-item-default").value) || 0,
        remark: document.getElementById("modal-item-remark").value.trim()
      };

      try {
        if (window.toggleLoading) window.toggleLoading(true);
        const res = await window.callApi("saveItem", payload);
        if (res && res.success) {
          if (window.showToast) window.showToast("SUCCESS", res.message);
          this.closeItemModal();
          await this.loadInventory();
        }
      } catch (err) {
        console.error("Save Item Error:", err);
      } finally {
        if (window.toggleLoading) window.toggleLoading(false);
      }
    },

    openStockModal(itemCode) {
      const item = allInventory.find(i => i.item_code === itemCode);
      if (!item) return;

      document.getElementById("stock-modal-code").value = item.item_code;
      document.getElementById("stock-modal-name").textContent = `${item.item_code} - ${item.item_name}`;
      document.getElementById("stock-modal-shop").textContent = `ဆိုင်: ${currentShop.toUpperCase()}`;
      document.getElementById("stock-modal-qty").value = item.current_stock || 0;
      document.getElementById("stock-modal-cost").value = item.cost_price || 0;
      document.getElementById("stock-modal-remark").value = item.remark || "";

      const modal = document.getElementById("stock-modal");
      if (modal) { modal.classList.remove("hidden"); modal.classList.add("flex"); }
    },

    closeStockModal() {
      const modal = document.getElementById("stock-modal");
      if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
    },

    async saveStockSubmit(e) {
      e.preventDefault();
      const payload = {
        shop_id: currentShop,
        item_code: document.getElementById("stock-modal-code").value,
        current_stock: parseInt(document.getElementById("stock-modal-qty").value, 10) || 0,
        cost_price: parseFloat(document.getElementById("stock-modal-cost").value) || 0,
        remark: document.getElementById("stock-modal-remark").value.trim()
      };

      try {
        if (window.toggleLoading) window.toggleLoading(true);
        const res = await window.callApi("updateStock", payload);
        if (res && res.success) {
          if (window.showToast) window.showToast("SUCCESS", res.message);
          this.closeStockModal();
          await this.loadInventory();
        }
      } catch (err) {
        console.error("Update Stock Error:", err);
      } finally {
        if (window.toggleLoading) window.toggleLoading(false);
      }
    },

    exportExcel() {
      if (!window.XLSX || filteredInventory.length === 0) {
        if (window.showToast) window.showToast("ERROR", "Export လုပ်ရန် ဒေတာ မရှိသေးပါ။");
        return;
      }

      const rows = filteredInventory.map((item, idx) => ({
        "စဉ်": idx + 1,
        "Item Code": item.item_code,
        "ပစ္စည်းအမည်": item.item_name,
        "အမျိုးအစား": item.category,
        "အမျိုးအစားစိပ်": item.sub_category || "",
        "ယူနစ်": item.unit || "ထည်",
        "လက်ကျန်": item.current_stock || 0,
        "မူရင်းဈေး": item.cost_price || 0,
        "လက်လီဈေး": item.retail_price || 0,
        "လက်ကားဈေး": item.default_price || 0,
        "ဆိုင်ခွဲ": currentShop.toUpperCase()
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Store_${currentShop}`);
      XLSX.writeFile(wb, `MyaGabarSoe_Store_${currentShop}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    }
  };
})();

// Global Window တွင် Register ပြုလုပ်ခြင်း
window.StoreEngine = StoreEngine;
