// cashbook-frontend/js/modules/inventory.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";

let products = [];

function escapeHtml(str) {
    return String(str !== null && str !== undefined ? str : "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initInventory() {
    bindEvents();
    await loadInventory();
}

function bindEvents() {
    const addBtn = document.getElementById("btn-add-product");
    if (addBtn) {
        addBtn.onclick = () => openProductModal(null);
    }

    const closeBtn = document.getElementById("btn-close-product-modal");
    if (closeBtn) {
        closeBtn.onclick = () => {
            const modal = document.getElementById("product-modal");
            if (modal) modal.classList.add("hidden");
        };
    }

    const form = document.getElementById("product-form");
    if (form) {
        form.onsubmit = submitProduct;
    }

    const catFilter = document.getElementById("inv-category-filter");
    if (catFilter) {
        catFilter.onchange = filterAndRender;
    }

    const searchInput = document.getElementById("inv-search");
    if (searchInput) {
        searchInput.oninput = filterAndRender;
    }
}

async function loadInventory() {
    const tbody = document.getElementById("inv-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const branchId = (state.currentBranch && state.currentBranch.id) ? state.currentBranch.id : 1;
        const res = await api.get("/products", { branch_id: branchId });
        products = res.data || [];

        populateCategoryFilter();
        updateInventoryKPIs();
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryFilter() {
    const select = document.getElementById("inv-category-filter");
    if (!select) return;
    const current = select.value;
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${products.length})</option>`;
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (cats.includes(current)) {
        select.value = current;
    }
}

function updateInventoryKPIs() {
    const totalTypes = products.length;
    const totalPieces = products.reduce((sum, p) => sum + Number(p.current_stock || 0), 0);
    const totalCostValue = products.reduce((sum, p) => sum + (Number(p.current_stock || 0) * Number(p.cost_price || 0)), 0);
    const lowStockCount = products.filter(p => Number(p.current_stock || 0) <= Number(p.alert_quantity || 5)).length;

    setKPI(1, "အထည်အမျိုးအစားပေါင်း (SKUs)", totalTypes, "fa-tags", "blue");
    setKPI(2, "စုစုပေါင်း အထည်လက်ကျန် (Pieces)", totalPieces, "fa-shirt", "emerald");
    setKPI(3, "လက်ကျန် အရင်းတန်ဖိုး (Stock Value)", totalCostValue, "fa-vault", "amber");
    setKPI(4, "လက်ကျန်နည်းနေသော အထည် (Low Stock)", lowStockCount, "fa-triangle-exclamation", "rose");
}

function filterAndRender() {
    const catEl = document.getElementById("inv-category-filter");
    const searchEl = document.getElementById("inv-search");
    const cat = catEl ? catEl.value : "";
    const kw = (searchEl ? searchEl.value : "").trim().toLowerCase();

    const filtered = products.filter(p => {
        if (cat && p.category !== cat) return false;
        if (!kw) return true;
        const hay = `${p.sku || ""} ${p.barcode || ""} ${p.category || ""} ${p.item_name || ""} ${p.pattern || ""} ${p.color || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderTable(filtered);
}

function renderTable(list) {
    const tbody = document.getElementById("inv-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-12 text-center text-slate-400 font-bold">အထည်စာရင်း မတွေ့ရှိပါ</td></tr>`;
        return;
    }

    list.forEach(item => {
        const stock = Number(item.current_stock || 0);
        const isLow = stock <= Number(item.alert_quantity || 5);

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                <div class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(item.sku || "-")}</div>
                <div>${escapeHtml(item.barcode || "")}</div>
            </td>
            <td class="p-4">
                <span class="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                    ${escapeHtml(item.category)}
                </span>
            </td>
            <td class="p-4">
                <div class="font-bold text-slate-900 dark:text-white">${escapeHtml(item.item_name)}</div>
                <div class="text-xs text-slate-400">${escapeHtml(item.pattern || "-")}</div>
            </td>
            <td class="p-4 text-xs">
                <div>${escapeHtml(item.color || "-")}</div>
                <div class="text-slate-400">${escapeHtml(item.size || "Free Size")}</div>
            </td>
            <td class="p-4 text-right font-mono text-slate-500">${Number(item.cost_price || 0).toLocaleString()}</td>
            <td class="p-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">${Number(item.retail_price || 0).toLocaleString()}</td>
            <td class="p-4 text-right font-mono font-bold text-blue-600 dark:text-blue-400">${Number(item.wholesale_price || 0).toLocaleString()}</td>
            <td class="p-4 text-center">
                <span class="px-3 py-1 rounded-xl font-mono font-black text-sm ${isLow ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}">
                    ${stock.toLocaleString()}
                </span>
            </td>
            <td class="p-4 text-center">
                <button type="button" data-id="${item.id}" class="btn-edit-prod px-3 py-1.5 bg-slate-100 dark:bg-slate-900 hover:bg-emerald-600 hover:text-white rounded-lg text-xs font-bold transition cursor-pointer">
                    <i class="fa-solid fa-pen-to-square mr-1"></i> ပြင်မည်
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-edit-prod").forEach(btn => {
        btn.onclick = () => {
            const prod = products.find(p => p.id === Number(btn.dataset.id));
            if (prod) openProductModal(prod);
        };
    });
}

function openProductModal(prod) {
    const modal = document.getElementById("product-modal");
    const title = document.getElementById("product-modal-title");
    const form = document.getElementById("product-form");
    if (form) form.reset();

    if (prod) {
        if (title) title.textContent = "အထည်အချက်အလက်နှင့် လက်ကျန် ပြင်ဆင်မည်";
        document.getElementById("prod-id").value = prod.id;
        document.getElementById("prod-sku").value = prod.sku || "";
        document.getElementById("prod-barcode").value = prod.barcode || "";
        document.getElementById("prod-category").value = prod.category || "";
        document.getElementById("prod-name").value = prod.item_name || "";
        document.getElementById("prod-pattern").value = prod.pattern || "";
        document.getElementById("prod-color").value = prod.color || "";
        document.getElementById("prod-size").value = prod.size || "Free Size";
        document.getElementById("prod-cost").value = prod.cost_price || 0;
        document.getElementById("prod-retail").value = prod.retail_price || 0;
        document.getElementById("prod-wholesale").value = prod.wholesale_price || 0;
        document.getElementById("prod-stock").value = prod.current_stock !== undefined ? prod.current_stock : 0;
    } else {
        if (title) title.textContent = "အထည်ပစ္စည်း အသစ်ထည့်သွင်းမည်";
        document.getElementById("prod-id").value = "";
        document.getElementById("prod-size").value = "Free Size";
    }

    if (modal) {
        modal.classList.remove("hidden");
    }
}

async function submitProduct(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-product");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("prod-id").value;
    const branchId = (state.currentBranch && state.currentBranch.id) ? state.currentBranch.id : 1;
    const stockVal = parseInt(document.getElementById("prod-stock").value, 10) || 0;

    const payload = {
        sku: document.getElementById("prod-sku").value.trim() || null,
        barcode: document.getElementById("prod-barcode").value.trim() || null,
        category: document.getElementById("prod-category").value.trim(),
        itemName: document.getElementById("prod-name").value.trim(),
        pattern: document.getElementById("prod-pattern").value.trim() || null,
        color: document.getElementById("prod-color").value.trim() || null,
        size: document.getElementById("prod-size").value.trim() || "Free Size",
        costPrice: parseFloat(document.getElementById("prod-cost").value) || 0,
        retailPrice: parseFloat(document.getElementById("prod-retail").value) || 0,
        wholesalePrice: parseFloat(document.getElementById("prod-wholesale").value) || 0,
        initialStock: stockVal,
        quantity: stockVal,
        targetBranchId: branchId,
        branchId: branchId
    };

    try {
        if (prodId) {
            await api.put(`/products/${prodId}`, payload);
        } else {
            await api.post("/products", payload);
        }
        const modal = document.getElementById("product-modal");
        if (modal) modal.classList.add("hidden");
        await loadInventory();
    } catch (err) {
        alert("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}
