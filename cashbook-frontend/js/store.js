/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - STORE & INVENTORY MANAGEMENT ENGINE
 * File: cashbook-frontend/js/store.js
 * Standard: Smart Auto-Registration (Items + Shop Inventory in 1 Click)
 * ==============================================================================
 */

"use strict";

const StoreEngine = (function () {
  let currentShop = "main";
  let allInventory = [];
  let filteredInventory = [];
  let currentPage = 1;
  const rowsPerPage = 20;

  function formatMoney(num) {
    return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatQty(num) {
    return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  return {
    async init(shopId = "main") {
      currentShop = shopId;
      currentPage = 1;

      // 💡 View HTML Template ကို Container ထဲသို့ ဆွဲတင်ခြင်း (သို့မဟုတ် တိုက်ရိုက်ဆွဲတင်ခြင်း)
      const container = document.getElementById("view-container");
      if (!container) return;

      // အကယ်၍ view-container ထဲတွင် store view မရှိသေးပါက ဆွဲယူထည့်သွင်းမည်
      if (!document.getElementById("store-view-root")) {
        try {
          const res = await fetch("views/store.html?v=20261008");
          if (res.ok) {
            container.innerHTML = await res.text();
          }
        } catch (e) {
          console.warn("Could not fetch views/store.html:", e);
        }
      }

      const shopSelect = document.getElementById("store-shop-select");
      if (shopSelect) shopSelect.value = currentShop;

      await this.loadInventory();
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
            <td class="px-4 py-3 text-center text-slate-500 font-mono">${startIndex + index + 1}</td>
            <td class="px-4 py-3 font-mono font-bold text-amber-400">${window.escapeHtml(item.item_code)}</td>
            <td class="px-4 py-3 font-bold text-slate-100">${window.escapeHtml(item.item_name)}</td>
            <td class="px-4 py-3">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                ${window.escapeHtml(item.category)}${item.sub_category ? ` / ${window.escapeHtml(item.sub_category)}` : ""}
              </span>
            </td>
            <td class="px-4 py-3 text-center text-slate-300 font-bold">${window.escapeHtml(item.unit || "ထည်")}</td>
            <td class="px-4 py-3 text-right font-black font-mono ${isLow ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}">
              ${formatQty(item.current_stock)}
            </td>
            <td class="px-4 py-3 text-right font-mono text-slate-400">${formatMoney(item.cost_price)}</td>
            <td class="px-4 py-3 text-right font-mono text-emerald-400 font-bold">${formatMoney(item.retail_price)}</td>
            <td class="px-4 py-3 text-right font-mono text-amber-400 font-bold">${formatMoney(wholesalePrice)}</td>
            <td class="px-4 py-3 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <!-- Adjust Stock Icon -->
                <button onclick="StoreEngine.openStockModal('${item.item_code}')" class="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition" title="Adjust Stock">
                  <i class="fa-solid fa-boxes-packing text-xs"></i>
                </button>
                <!-- Edit Item Icon -->
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
      document.getElementById("modal-item-title").textContent = "ပစ္စည်းသစ်နှင့် စတိုလက်ကျန် တစ်ခါတည်းသွင်းခြင်း";
      const codeEl = document.getElementById("modal-item-code");
      codeEl.value = "";
      codeEl.disabled = false;
      document.getElementById("modal-item-name").value = "";
      document.getElementById("modal-item-category").value = "ပုဆိုး";
      document.getElementById("modal-item-subcategory").value = "";
      document.getElementById("modal-item-retail").value = 0;
      document.getElementById("modal-item-wholesale").value = 0;
      document.getElementById("modal-item-stock").value = 0;
      document.getElementById("modal-item-cost").value = 0;
      document.getElementById("modal-item-remark").value = "";

      const modal = document.getElementById("item-modal");
      if (modal) { modal.classList.remove("hidden"); modal.classList.add("flex"); }
    },

    openEditModal(itemCode) {
      const item = allInventory.find(i => i.item_code === itemCode);
      if (!item) return;

      document.getElementById("modal-item-title").textContent = `ပစ္စည်းပြင်ဆင်ခြင်း (${item.item_code})`;
      const codeEl = document.getElementById("modal-item-code");
      codeEl.value = item.item_code;
      codeEl.disabled = true; // Code ပြင်မရအောင် Lock ခတ်ထားမည်
      document.getElementById("modal-item-name").value = item.item_name;
      document.getElementById("modal-item-category").value = item.category;
      document.getElementById("modal-item-subcategory").value = item.sub_category || "";
      document.getElementById("modal-item-retail").value = item.retail_price || 0;
      document.getElementById("modal-item-wholesale").value = item.wholesale_price || item.default_price || 0;
      document.getElementById("modal-item-stock").value = item.current_stock || 0;
      document.getElementById("modal-item-cost").value = item.cost_price || 0;
      document.getElementById("modal-item-remark").value = item.remark || "";

      const modal = document.getElementById("item-modal");
      if (modal) { modal.classList.remove("hidden"); modal.classList.add("flex"); }
    },

    closeItemModal() {
      const modal = document.getElementById("item-modal");
      if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
    },

    // 💡 SMART AUTO-REGISTRATION: items နှင့် shop_inventory ကို တစ်ပြိုင်နက် Auto သိမ်းခြင်း
    async saveItemSubmit(e) {
      e.preventDefault();
      const itemCode = document.getElementById("modal-item-code").value.trim().toUpperCase();
      const initialStock = parseInt(document.getElementById("modal-item-stock").value, 10) || 0;
      const costPrice = parseFloat(document.getElementById("modal-item-cost").value) || 0;

      const itemPayload = {
        item_code: itemCode,
        item_name: document.getElementById("modal-item-name").value.trim(),
        unit: document.getElementById("modal-item-unit").value.trim() || "ထည်",
        category: document.getElementById("modal-item-category").value.trim(),
        sub_category: document.getElementById("modal-item-subcategory").value.trim(),
        retail_price: parseFloat(document.getElementById("modal-item-retail").value) || 0,
        wholesale_price: parseFloat(document.getElementById("modal-item-wholesale").value) || 0,
        remark: document.getElementById("modal-item-remark").value.trim()
      };

      try {
        if (window.toggleLoading) window.toggleLoading(true);

        // ၁။ items ဇယားထဲသို့ သိမ်းဆည်းခြင်း
        const resItem = await window.callApi("saveItem", itemPayload);

        // ၂။ အဖွင့်လက်ကျန် သို့မဟုတ် မူရင်းဝယ်ဈေး ပါဝင်ပါက shop_inventory ထဲသို့ပါ Auto တစ်ခါတည်း သွင်းပေးခြင်း
        if (resItem && resItem.success) {
          await window.callApi("updateStock", {
            shop_id: currentShop,
            item_code: itemCode,
            current_stock: initialStock,
            cost_price: costPrice,
            remark: itemPayload.remark || "Auto Initial Stock"
          });

          if (window.showToast) window.showToast("SUCCESS", "ပစ္စည်းနှင့် စတိုလက်ကျန် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ!");
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
      document.getElementById("stock-modal-shop").textContent = `ဆိုင်ခွဲ: ${currentShop.toUpperCase()}`;
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

      let csv = "\uFEFFNO,ITEM CODE,ITEM NAME,CATEGORY,UNIT,CURRENT STOCK,COST PRICE,RETAIL PRICE,WHOLESALE PRICE,SHOP\n";
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
