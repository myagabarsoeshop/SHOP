/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - STORE & INVENTORY MANAGEMENT ENGINE
 * File: cashbook-frontend/js/store.js
 * Standard: Pixel-Perfect Match with GOLDEN CASH BOOK UI (cash-book-c4o.pages.dev)
 * ==============================================================================
 */

"use strict";

const StoreEngine = (function () {
  let currentShop = "main";
  let allInventory = [];
  let filteredInventory = [];
  let currentPage = 1;
  const rowsPerPage = 20;

  // 💡 Default Units & Dynamic Memory System
  let availableUnits = ["ထည်", "ကိုက်", "ပေါင်", "ထုပ်", "လိပ်", "စုံ"];
  try {
    const savedUnits = localStorage.getItem("mya_stored_units");
    if (savedUnits) availableUnits = JSON.parse(savedUnits);
  } catch (e) {}

  function formatMoney(num) {
    return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatQty(num) {
    return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function saveNewUnitToMemory(newUnit) {
    const u = String(newUnit || "").trim();
    if (u && !availableUnits.includes(u)) {
      availableUnits.push(u);
      try {
        localStorage.setItem("mya_stored_units", JSON.stringify(availableUnits));
      } catch (e) {}
    }
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

      // 💡 animate-in ကို ဖယ်ရှားထားသဖြင့် Modal ပေါ်သို့ အောက်က စာသားများ လုံးဝ မထိုးဖောက်နိုင်တော့ပါ
      container.innerHTML = `
        <div id="store-view-root" style="padding-top: 10px;" class="space-y-4">
          
          <!-- 💡 1. TOP 4 KPI CARDS (GOLDEN CASH BOOK မူရင်းပုံစံအတိုင်း ဘယ်ဘက် Icon / ညာဘက် စာသား) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <!-- Card 1: TOTAL ITEMS -->
            <div class="bg-[#0e1726] border border-slate-800/80 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
              <div class="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-xl shrink-0">
                <i class="fa-solid fa-shapes"></i>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">TOTAL ITEMS</p>
                <h3 id="card-total-items" class="text-2xl font-black text-white font-mono tracking-tight mt-0.5">0</h3>
              </div>
            </div>

            <!-- Card 2: TOTAL STOCK QTY -->
            <div class="bg-[#0e1726] border border-slate-800/80 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
              <div class="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 text-xl shrink-0">
                <i class="fa-solid fa-boxes-stacked"></i>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">TOTAL STOCK QTY</p>
                <h3 id="card-total-stock" class="text-2xl font-black text-white font-mono tracking-tight mt-0.5">0</h3>
              </div>
            </div>

            <!-- Card 3: TOTAL VALUATION -->
            <div class="bg-[#0e1726] border border-slate-800/80 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
              <div class="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 text-xl shrink-0">
                <i class="fa-solid fa-scale-balanced"></i>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">TOTAL VALUATION (MMK)</p>
                <h3 id="card-total-value" class="text-2xl font-black text-white font-mono tracking-tight mt-0.5">0</h3>
              </div>
            </div>

            <!-- Card 4: TOTAL ENTRIES / LOW STOCK -->
            <div class="bg-[#0e1726] border border-slate-800/80 rounded-2xl p-4 flex items-center gap-4 shadow-lg">
              <div class="w-12 h-12 rounded-xl bg-slate-500/10 border border-slate-700/40 flex items-center justify-center text-slate-300 text-xl shrink-0">
                <i class="fa-solid fa-list-check"></i>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">LOW STOCK ALERTS</p>
                <h3 id="card-low-stock" class="text-2xl font-black text-white font-mono tracking-tight mt-0.5">0</h3>
              </div>
            </div>

          </div>

          <!-- 💡 2. FILTER & ACTION TOOLBAR (မူရင်းပုံစံအတိုင်း သန့်ရှင်းသပ်ရပ်သော ဘား) -->
          <div class="bg-[#0e1726] border border-slate-800/80 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
            
            <!-- Left: Search & Filter Dropdowns -->
            <div class="flex flex-wrap items-center gap-2.5">
              <!-- Search Box -->
              <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                <input type="text" id="store-search-input" oninput="StoreEngine.applyFilter()" placeholder="Search description, category, code..." 
                  class="bg-[#070d18] border border-slate-700/80 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-500 w-56 md:w-64 transition">
              </div>

              <!-- Shop Selector -->
              <div class="flex items-center bg-[#070d18] border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-200">
                <span class="text-slate-500 font-bold mr-2 text-[11px] uppercase">STORE:</span>
                <select id="store-shop-select" onchange="StoreEngine.changeShop(this.value)" class="bg-transparent font-bold text-slate-100 outline-none cursor-pointer">
                  <option value="main" ${currentShop === 'main' ? 'selected' : ''}>Main Home Shop (ပင်မ)</option>
                  <option value="shop1" ${currentShop === 'shop1' ? 'selected' : ''}>ဆိုင်ခွဲ (၁)</option>
                  <option value="shop2" ${currentShop === 'shop2' ? 'selected' : ''}>ဆိုင်ခွဲ (၂)</option>
                  <option value="shop3" ${currentShop === 'shop3' ? 'selected' : ''}>ဆိုင်ခွဲ (၃)</option>
                  <option value="shop4" ${currentShop === 'shop4' ? 'selected' : ''}>ဆိုင်ခွဲ (၄)</option>
                  <option value="shop5" ${currentShop === 'shop5' ? 'selected' : ''}>ဆိုင်ခွဲ (၅)</option>
                </select>
              </div>

              <!-- Category Filter -->
              <div class="flex items-center bg-[#070d18] border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-200">
                <span class="text-slate-500 font-bold mr-2 text-[11px] uppercase">TYPE:</span>
                <select id="store-category-filter" onchange="StoreEngine.applyFilter()" class="bg-transparent font-bold text-slate-100 outline-none cursor-pointer">
                  <option value="">အားလုံး (All)</option>
                  <option value="ပုဆိုး">ပုဆိုး</option>
                  <option value="လုံချည်">လုံချည်</option>
                  <option value="အင်္ကျီ">အင်္ကျီ</option>
                  <option value="ဝမ်းဆက်">ဝမ်းဆက်</option>
                  <option value="ပိတ်စ">ပိတ်စ</option>
                  <option value="ချည်">ချည်</option>
                </select>
              </div>
            </div>

            <!-- Right: Action Buttons (မူရင်းပုံစံအတိုင်း ခလုတ်များ) -->
            <div class="flex items-center gap-2">
              <button onclick="StoreEngine.loadInventory()" class="px-3.5 py-2 bg-[#070d18] hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-xl transition text-xs font-bold flex items-center gap-2">
                <i class="fa-solid fa-rotate"></i> <span>Refresh</span>
              </button>
              <button onclick="StoreEngine.exportCsv()" class="px-3.5 py-2 bg-[#070d18] hover:bg-slate-800 text-slate-200 border border-slate-700/80 rounded-xl transition text-xs font-bold flex items-center gap-2">
                <i class="fa-solid fa-file-csv text-emerald-400"></i> <span>Export CSV</span>
              </button>
              <button onclick="StoreEngine.openItemModal()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-95">
                <i class="fa-solid fa-plus text-xs"></i> <span>+ Add New Item</span>
              </button>
            </div>
          </div>

          <!-- 💡 3. LUXURY DATA TABLE -->
          <div class="bg-[#0e1726] border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs text-slate-300">
                <thead class="bg-[#070d17] text-slate-400 text-[11px] font-black uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th class="px-4 py-3.5 text-center w-12">NO</th>
                    <th class="px-4 py-3.5">CODE</th>
                    <th class="px-4 py-3.5">ITEM NAME</th>
                    <th class="px-4 py-3.5">CATEGORY</th>
                    <th class="px-4 py-3.5 text-center">UNIT</th>
                    <th class="px-4 py-3.5 text-right font-black">CURRENT STOCK</th>
                    <th class="px-4 py-3.5 text-right text-rose-400 font-bold">COST PRICE</th>
                    <th class="px-4 py-3.5 text-right text-emerald-400 font-bold">RETAIL PRICE</th>
                    <th class="px-4 py-3.5 text-right text-amber-400 font-bold">WHOLESALE PRICE</th>
                    <th class="px-4 py-3.5 text-center w-28">ACTION</th>
                  </tr>
                </thead>
                <tbody id="store-table-body" class="divide-y divide-slate-800/60 font-medium">
                  <tr>
                    <td colspan="10" class="text-center py-10 text-slate-500">
                      <i class="fa-solid fa-circle-notch fa-spin text-lg mb-2 text-indigo-400"></i>
                      <p>စတိုဒေတာများကို ဆွဲယူနေပါသည်...</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 💡 4. PAGINATION FOOTER -->
            <div class="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 bg-[#070d17]">
              <span id="store-pagination-info">Showing 0 to 0 of 0 entries</span>
              <div class="flex items-center gap-1.5" id="store-pagination-controls">
                <button onclick="StoreEngine.prevPage()" id="btn-prev-page" class="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition font-semibold">Previous</button>
                <span id="store-current-page" class="px-3 py-1 font-bold font-mono text-amber-400">1</span>
                <button onclick="StoreEngine.nextPage()" id="btn-next-page" class="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition font-semibold">Next</button>
              </div>
            </div>
          </div>

          <!-- ============================================================================ -->
          <!-- 💡 5. SMART MODAL: 100% OPAQUE SOLID BACKGROUND (လုံးဝ မထိုးဖောက်နိုင်သော ဒီဇိုင်း) -->
          <!-- ============================================================================ -->
          <div id="item-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 999999; background: rgba(3, 7, 18, 0.94); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; padding: 1rem;">
            <div style="background: #0d1527; border: 1px solid #1e293b; box-shadow: 0 25px 60px rgba(0,0,0,0.95);" class="rounded-3xl w-full max-w-xl overflow-hidden p-6 text-slate-200 space-y-4">
              
              <!-- Modal Header -->
              <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-sm">
                    <i class="fa-solid fa-boxes-packing"></i>
                  </div>
                  <h3 id="modal-item-title" class="text-sm font-black text-white tracking-wide">Add New Item & Stock</h3>
                </div>
                <button type="button" onclick="StoreEngine.closeItemModal()" class="text-slate-400 hover:text-white transition p-1.5 rounded-lg hover:bg-slate-800"><i class="fa-solid fa-xmark text-base"></i></button>
              </div>

              <!-- Form -->
              <form onsubmit="StoreEngine.saveItemSubmit(event)" class="space-y-3.5 text-xs">
                
                <!-- Row 1: Target Shop & Item Code -->
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block font-bold text-slate-300 mb-1">စတိုဆိုင်ခွဲ (STORE LOCATION) *</label>
                    <select id="modal-item-shop" class="w-full p-2.5 bg-[#050913] border border-slate-700/80 rounded-xl text-slate-100 outline-none font-bold focus:border-indigo-500 cursor-pointer">
                      <option value="main">Main Home Shop (ပင်မ)</option>
                      <option value="shop1">ဆိုင်ခွဲ (၁)</option>
                      <option value="shop2">ဆိုင်ခွဲ (၂)</option>
                      <option value="shop3">ဆိုင်ခွဲ (၃)</option>
                      <option value="shop4">ဆိုင်ခွဲ (၄)</option>
                      <option value="shop5">ဆိုင်ခွဲ (၅)</option>
                    </select>
                  </div>
                  <div>
                    <label class="block font-bold text-slate-300 mb-1">ITEM CODE (ပစ္စည်းကုတ်) *</label>
                    <input type="text" id="modal-item-code" required placeholder="e.g. PAS-006" class="w-full p-2.5 bg-[#050913] border border-slate-700/80 rounded-xl text-slate-100 outline-none uppercase font-mono font-bold focus:border-indigo-500">
                  </div>
                </div>

                <!-- Row 2: Item Name & Unit (with Auto-Memory Datalist) -->
                <div class="grid grid-cols-3 gap-3">
                  <div class="col-span-2">
                    <label class="block font-bold text-slate-300 mb-1">ပစ္စည်းအမည် (ITEM NAME) *</label>
                    <input type="text" id="modal-item-name" required placeholder="e.g. ရွှေချည်ထိုး ပုဆိုး" class="w-full p-2.5 bg-[#050913] border border-slate-700/80 rounded-xl text-slate-100 outline-none font-bold focus:border-indigo-500">
                  </div>
                  <div>
                    <label class="block font-bold text-slate-300 mb-1">ယူနစ် (UNIT) *</label>
                    <input list="unit-options" id="modal-item-unit" value="ထည်" placeholder="ရွေး/ရိုက်ပါ" class="w-full p-2.5 bg-[#050913] border border-slate-700/80 rounded-xl text-slate-100 outline-none focus:border-indigo-500 font-bold">
                    <datalist id="unit-options">
                      ${availableUnits.map(u => `<option value="${u}">`).join("")}
                    </datalist>
                  </div>
                </div>

                <!-- Row 3: Category & Sub-Category -->
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block font-bold text-slate-400 mb-1">ပင်မအမျိုးအစား</label>
                    <input type="text" id="modal-item-category" value="ပုဆိုး" class="w-full p-2.5 bg-[#050913] border border-slate-700/80 rounded-xl text-slate-100 outline-none">
                  </div>
                  <div>
                    <label class="block font-bold text-slate-400 mb-1">အမျိုးအစားစိပ်</label>
                    <input type="text" id="modal-item-subcategory" placeholder="e.g. ရွှေချည်ထိုး" class="w-full p-2.5 bg-[#050913] border border-slate-700/80 rounded-xl text-slate-100 outline-none">
                  </div>
                </div>

                <!-- Row 4: Pricing & Stock Box -->
                <div style="background: #080f1d; border: 1px solid #1a273e;" class="p-3.5 rounded-2xl space-y-3">
                  <p class="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <i class="fa-solid fa-coins"></i> <span>ဈေးနှုန်းနှင့် အဖွင့်လက်ကျန် သတ်မှတ်ခြင်း</span>
                  </p>
                  
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="block font-bold text-emerald-400 mb-1">လက်လီဈေး (RETAIL PRICE)</label>
                      <input type="number" id="modal-item-retail" value="0" min="0" class="w-full p-2 bg-[#040812] border border-slate-700 rounded-xl text-emerald-400 font-bold outline-none font-mono">
                    </div>
                    <div>
                      <label class="block font-bold text-amber-400 mb-1">လက်ကားဈေး (WHOLESALE PRICE)</label>
                      <input type="number" id="modal-item-wholesale" value="0" min="0" class="w-full p-2 bg-[#040812] border border-slate-700 rounded-xl text-amber-400 font-bold outline-none font-mono">
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800/60">
                    <div>
                      <label class="block font-bold text-slate-300 mb-1">စတိုအဖွင့်လက်ကျန် (STOCK QTY)</label>
                      <input type="number" id="modal-item-stock" value="0" min="0" class="w-full p-2 bg-[#040812] border border-slate-700 rounded-xl text-slate-100 font-bold outline-none font-mono">
                    </div>
                    <div>
                      <label class="block font-bold text-rose-400 mb-1">မူရင်းဝယ်ဈေး (COST PRICE)</label>
                      <input type="number" id="modal-item-cost" value="0" min="0" class="w-full p-2 bg-[#040812] border border-slate-700 rounded-xl text-rose-300 font-bold outline-none font-mono">
                    </div>
                  </div>
                </div>

                <!-- Row 5: Remark -->
                <div>
                  <label class="block font-bold text-slate-400 mb-1">မှတ်ချက် (REMARK / COLOR)</label>
                  <input type="text" id="modal-item-remark" placeholder="အရောင် သို့မဟုတ် အထွေထွေ..." class="w-full p-2.5 bg-[#050913] border border-slate-700/80 rounded-xl text-slate-100 outline-none">
                </div>

                <!-- Footer Buttons -->
                <div class="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
                  <button type="button" onclick="StoreEngine.closeItemModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold transition">Cancel</button>
                  <button type="submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition">Save Item & Stock</button>
                </div>
              </form>
            </div>
          </div>

          <!-- 💡 6. MODAL: ADJUST STOCK ONLY (100% OPAQUE) -->
          <div id="stock-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 999999; background: rgba(3, 7, 18, 0.94); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; padding: 1rem;">
            <div style="background: #0d1527; border: 1px solid #1e293b; box-shadow: 0 25px 60px rgba(0,0,0,0.95);" class="rounded-3xl w-full max-w-sm overflow-hidden p-6 text-slate-200 space-y-4">
              <div class="flex justify-between items-center border-b border-slate-800 pb-3">
                <h3 class="text-sm font-black text-emerald-400 flex items-center gap-2">
                  <i class="fa-solid fa-boxes-packing"></i> <span>စတိုလက်ကျန် ညှိယူခြင်း</span>
                </h3>
                <button type="button" onclick="StoreEngine.closeStockModal()" class="text-slate-400 hover:text-white transition p-1"><i class="fa-solid fa-xmark text-sm"></i></button>
              </div>
              <form onsubmit="StoreEngine.saveStockSubmit(event)" class="space-y-3.5 text-xs">
                <input type="hidden" id="stock-modal-code">
                <div>
                  <p class="text-[11px] text-slate-400 font-bold">ပစ္စည်း:</p>
                  <p id="stock-modal-name" class="text-sm font-black text-amber-400 font-mono"></p>
                  <p id="stock-modal-shop" class="text-[10px] text-slate-500 uppercase font-bold mt-0.5"></p>
                </div>
                <div>
                  <label class="block font-bold text-slate-300 mb-1">လက်ကျန် အရေအတွက် (STOCK)</label>
                  <input type="number" id="stock-modal-qty" required min="0" class="w-full p-2.5 bg-[#050913] border border-slate-700 rounded-xl text-emerald-400 font-black text-lg outline-none font-mono">
                </div>
                <div>
                  <label class="block font-bold text-rose-400 mb-1">မူရင်းဝယ်ဈေး (COST PRICE MMK)</label>
                  <input type="number" id="stock-modal-cost" required min="0" class="w-full p-2.5 bg-[#050913] border border-slate-700 rounded-xl text-rose-300 font-bold outline-none font-mono">
                </div>
                <div>
                  <label class="block font-bold text-slate-400 mb-1">မှတ်ချက်</label>
                  <input type="text" id="stock-modal-remark" placeholder="ညှိယူရသည့် အကြောင်းအရင်း..." class="w-full p-2.5 bg-[#050913] border border-slate-700 rounded-xl text-slate-100 outline-none">
                </div>
                <div class="pt-3 border-t border-slate-800 flex justify-end gap-2">
                  <button type="button" onclick="StoreEngine.closeStockModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold transition">Cancel</button>
                  <button type="submit" class="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl transition">Update Stock</button>
                </div>
              </form>
            </div>
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

      const elItems = document.getElementById("card-total-items");
      const elStock = document.getElementById("card-total-stock");
      const elVal = document.getElementById("card-total-value");
      const elLow = document.getElementById("card-low-stock");

      if (elItems) elItems.textContent = formatQty(filteredInventory.length);
      if (elStock) elStock.textContent = formatQty(totalStock);
      if (elVal) elVal.textContent = Number(totalValuation).toLocaleString("en-US", { minimumFractionDigits: 0 });
      if (elLow) elLow.textContent = formatQty(lowStockCount);
    },

    renderTable() {
      const tbody = document.getElementById("store-table-body");
      if (!tbody) return;

      if (filteredInventory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-10 text-slate-500 font-bold">ပစ္စည်းစာရင်း မရှိသေးပါ</td></tr>`;
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
        const wholesalePrice = item.wholesale_price || item.default_price || 0;

        html += `
          <tr class="hover:bg-slate-800/40 transition">
            <td class="px-4 py-3.5 text-center text-slate-500 font-mono font-bold">${startIndex + index + 1}</td>
            <td class="px-4 py-3.5 font-mono font-bold text-amber-400">${window.escapeHtml(item.item_code)}</td>
            <td class="px-4 py-3.5 font-bold text-white">${window.escapeHtml(item.item_name)}</td>
            <td class="px-4 py-3.5">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#070d18] text-slate-200 border border-slate-700">
                ${window.escapeHtml(item.category)}${item.sub_category ? ` / ${window.escapeHtml(item.sub_category)}` : ""}
              </span>
            </td>
            <td class="px-4 py-3.5 text-center text-slate-300 font-bold">${window.escapeHtml(item.unit || "ထည်")}</td>
            <td class="px-4 py-3.5 text-right font-black font-mono ${isLow ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}">
              ${formatQty(item.current_stock)}
            </td>
            <td class="px-4 py-3.5 text-right font-mono text-slate-400">${formatMoney(item.cost_price)}</td>
            <td class="px-4 py-3.5 text-right font-mono text-emerald-400 font-bold">${formatMoney(item.retail_price)}</td>
            <td class="px-4 py-3.5 text-right font-mono text-amber-400 font-bold">${formatMoney(wholesalePrice)}</td>
            <td class="px-4 py-3.5 text-center">
              <div class="flex items-center justify-center gap-2">
                <button onclick="StoreEngine.openStockModal('${item.item_code}')" class="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition" title="Adjust Stock">
                  <i class="fa-solid fa-boxes-packing text-xs"></i>
                </button>
                <button onclick="StoreEngine.openEditModal('${item.item_code}')" class="p-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition" title="Edit Item Details">
                  <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
              </div>
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

      if (info) info.textContent = `Showing ${start} to ${end} of ${total} entries`;
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
      document.getElementById("modal-item-title").textContent = "Add New Item & Stock";
      
      const shopSelect = document.getElementById("modal-item-shop");
      if (shopSelect) shopSelect.value = currentShop;

      const codeEl = document.getElementById("modal-item-code");
      codeEl.value = "";
      codeEl.disabled = false;
      document.getElementById("modal-item-name").value = "";
      document.getElementById("modal-item-unit").value = "ထည်";
      document.getElementById("modal-item-category").value = "ပုဆိုး";
      document.getElementById("modal-item-subcategory").value = "";
      document.getElementById("modal-item-retail").value = 0;
      document.getElementById("modal-item-wholesale").value = 0;
      document.getElementById("modal-item-stock").value = 0;
      document.getElementById("modal-item-cost").value = 0;
      document.getElementById("modal-item-remark").value = "";

      const dl = document.getElementById("unit-options");
      if (dl) {
        dl.innerHTML = availableUnits.map(u => `<option value="${u}">`).join("");
      }

      const modal = document.getElementById("item-modal");
      if (modal) modal.style.display = "flex";
    },

    openEditModal(itemCode) {
      const item = allInventory.find(i => i.item_code === itemCode);
      if (!item) return;

      document.getElementById("modal-item-title").textContent = `Edit Item (${item.item_code})`;
      
      const shopSelect = document.getElementById("modal-item-shop");
      if (shopSelect) shopSelect.value = currentShop;

      const codeEl = document.getElementById("modal-item-code");
      codeEl.value = item.item_code;
      codeEl.disabled = true;
      document.getElementById("modal-item-name").value = item.item_name;
      document.getElementById("modal-item-unit").value = item.unit || "ထည်";
      document.getElementById("modal-item-category").value = item.category;
      document.getElementById("modal-item-subcategory").value = item.sub_category || "";
      document.getElementById("modal-item-retail").value = item.retail_price || 0;
      document.getElementById("modal-item-wholesale").value = item.wholesale_price || item.default_price || 0;
      document.getElementById("modal-item-stock").value = item.current_stock || 0;
      document.getElementById("modal-item-cost").value = item.cost_price || 0;
      document.getElementById("modal-item-remark").value = item.remark || "";

      const modal = document.getElementById("item-modal");
      if (modal) modal.style.display = "flex";
    },

    closeItemModal() {
      const modal = document.getElementById("item-modal");
      if (modal) modal.style.display = "none";
    },

    async saveItemSubmit(e) {
      e.preventDefault();
      const targetShop = document.getElementById("modal-item-shop").value || currentShop;
      const itemCode = document.getElementById("modal-item-code").value.trim().toUpperCase();
      const unitVal = document.getElementById("modal-item-unit").value.trim() || "ထည်";
      const initialStock = parseInt(document.getElementById("modal-item-stock").value, 10) || 0;
      const costPrice = parseFloat(document.getElementById("modal-item-cost").value) || 0;

      saveNewUnitToMemory(unitVal);

      const itemPayload = {
        item_code: itemCode,
        item_name: document.getElementById("modal-item-name").value.trim(),
        unit: unitVal,
        category: document.getElementById("modal-item-category").value.trim(),
        sub_category: document.getElementById("modal-item-subcategory").value.trim(),
        retail_price: parseFloat(document.getElementById("modal-item-retail").value) || 0,
        wholesale_price: parseFloat(document.getElementById("modal-item-wholesale").value) || 0,
        remark: document.getElementById("modal-item-remark").value.trim()
      };

      try {
        if (window.toggleLoading) window.toggleLoading(true);

        const resItem = await window.callApi("saveItem", itemPayload);

        if (resItem && resItem.success) {
          await window.callApi("updateStock", {
            shop_id: targetShop,
            item_code: itemCode,
            current_stock: initialStock,
            cost_price: costPrice,
            remark: itemPayload.remark || "Initial Stock"
          });

          if (window.showToast) window.showToast("SUCCESS", "ပစ္စည်းနှင့် စတိုလက်ကျန် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ!");
          this.closeItemModal();

          if (targetShop !== currentShop) {
            currentShop = targetShop;
            const sSelect = document.getElementById("store-shop-select");
            if (sSelect) sSelect.value = targetShop;
          }
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
      document.getElementById("stock-modal-shop").textContent = `ဆိုင်ခွဲ: ${currentShop.toUpperCase()}`;
      document.getElementById("stock-modal-qty").value = item.current_stock || 0;
      document.getElementById("stock-modal-cost").value = item.cost_price || 0;
      document.getElementById("stock-modal-remark").value = item.remark || "";

      const modal = document.getElementById("stock-modal");
      if (modal) modal.style.display = "flex";
    },

    closeStockModal() {
      const modal = document.getElementById("stock-modal");
      if (modal) modal.style.display = "none";
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
          if (window.showToast) window.showToast("SUCCESS", "စတိုလက်ကျန် အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ!");
          this.closeStockModal();
          await this.loadInventory();
        }
      } catch (err) {
        console.error("Update Stock Error:", err);
      } finally {
        if (window.toggleLoading) window.toggleLoading(false);
      }
    },

    exportCsv() {
      if (filteredInventory.length === 0) {
        if (window.showToast) window.showToast("ERROR", "Export လုပ်ရန် စာရင်း မရှိသေးပါ။");
        return;
      }

      let csv = "\uFEFFNO,CODE,ITEM NAME,CATEGORY,UNIT,CURRENT STOCK,COST PRICE,RETAIL PRICE,WHOLESALE PRICE,SHOP\n";
      filteredInventory.forEach((item, idx) => {
        const wholesale = item.wholesale_price || item.default_price || 0;
        csv += `"${idx + 1}","${item.item_code}","${item.item_name.replace(/"/g, '""')}","${item.category}","${item.unit || 'ထည်'}","${item.current_stock || 0}","${item.cost_price || 0}","${item.retail_price || 0}","${wholesale}","${currentShop.toUpperCase()}"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `MyaGabarSoe_Store_${currentShop}_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
    }
  };
})();

// Global Window တွင် Register ပြုလုပ်ခြင်း
window.StoreEngine = StoreEngine;
