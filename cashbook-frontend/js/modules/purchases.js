// cashbook-frontend/js/modules/purchases.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { PaginationController } from "../core/pagination.js";

let purchasesList = [];
let currentFilteredPurchases = [];
let masterProducts = [];
let selectedOrderItems = [];

const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderPurchasesTable()
});

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initPurchases() {
    bindEvents();
    await loadMasterProducts();
    await loadPurchases();
}

function bindEvents() {
    document.getElementById("btn-add-purchase")?.addEventListener("click", () => openPurchaseModal());
    document.getElementById("btn-close-purchase-modal")?.addEventListener("click", closePurchaseModal);
    document.getElementById("btn-cancel-purchase")?.addEventListener("click", closePurchaseModal);
    document.getElementById("btn-submit-purchase")?.addEventListener("click", submitPurchase);
    document.getElementById("pur-search")?.addEventListener("input", filterAndRenderPurchases);

    // Payment Method Change
    document.getElementById("pur-payment-method")?.addEventListener("change", (e) => {
        const bankContainer = document.getElementById("pur-bank-container");
        if (e.target.value === "bank") {
            bankContainer?.classList.remove("hidden");
            document.getElementById("pur-bank-name")?.focus();
        } else {
            bankContainer?.classList.add("hidden");
            const bankInput = document.getElementById("pur-bank-name");
            if (bankInput) bankInput.value = "";
        }
    });

    // Quick Search Input Events
    const searchInput = document.getElementById("pur-quick-search-input");
    const catFilter = document.getElementById("pur-quick-cat-filter");
    const clearBtn = document.getElementById("btn-clear-quick-search");

    searchInput?.addEventListener("input", (e) => {
        if (e.target.value) clearBtn?.classList.remove("hidden");
        else clearBtn?.classList.add("hidden");
        renderQuickSuggestions();
    });
    searchInput?.addEventListener("focus", renderQuickSuggestions);
    catFilter?.addEventListener("change", renderQuickSuggestions);

    clearBtn?.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        clearBtn.classList.add("hidden");
        renderQuickSuggestions();
        searchInput?.focus();
    });

    // Close Dropdown on outside click
    document.addEventListener("click", (e) => {
        if (!e.target.closest("#pur-quick-suggestions") && !e.target.closest("#pur-quick-search-input") && !e.target.closest("#pur-quick-cat-filter")) {
            document.getElementById("pur-quick-suggestions")?.classList.add("hidden");
        }
    });

    // Dedicated New Product Sub-Modal Events (Fixed Event Listener)
    document.getElementById("btn-open-create-prod-modal")?.addEventListener("click", () => openNewProductModal());
    document.getElementById("btn-close-new-prod-modal")?.addEventListener("click", () => {
        document.getElementById("new-prod-modal")?.classList.add("hidden");
    });
    document.getElementById("new-prod-form")?.addEventListener("submit", submitNewProductSubModal);
    document.getElementById("sub-cat")?.addEventListener("input", (e) => {
        document.getElementById("sub-sku").value = generateAutoSKU(e.target.value.trim());
    });
}

async function loadMasterProducts() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        masterProducts = res.data || [];
        populateCategoryFilters();
    } catch (err) {
        console.error("Master Products ရယူ၍ မရပါ:", err);
    }
}

function populateCategoryFilters() {
    const categories = [...new Set(masterProducts.map(p => (p.category || "").trim()).filter(Boolean))];
    const catSelect = document.getElementById("pur-quick-cat-filter");
    const datalist = document.getElementById("sub-cat-datalist");

    if (catSelect) {
        catSelect.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${categories.length})</option>`;
        categories.forEach(c => {
            catSelect.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
        });
    }

    if (datalist) {
        datalist.innerHTML = "";
        categories.forEach(c => {
            datalist.innerHTML += `<option value="${escapeHtml(c)}">`;
        });
    }
}

async function loadPurchases() {
    const tbody = document.getElementById("pur-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/purchases", { branch_id: branchId });
        purchasesList = res.data || [];
        currentFilteredPurchases = [...purchasesList];
        pagination.reset();
        renderPurchasesTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function filterAndRenderPurchases() {
    const kw = (document.getElementById("pur-search")?.value || "").trim().toLowerCase();

    currentFilteredPurchases = purchasesList.filter(p => {
        if (!kw) return true;
        const hay = `${p.purchase_no || ""} ${p.sku || ""} ${p.barcode || ""} ${p.item_name || ""} ${p.supplier_name || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderPurchasesTable();
}

function renderPurchasesTable() {
    const tbody = document.getElementById("pur-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredPurchases.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-slate-400 font-bold text-base">အဝယ်စာရင်း မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        pagination.renderControls("purchases-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredPurchases);

    pageItems.forEach(pur => {
        const dateStr = pur.created_at ? new Date(pur.created_at).toLocaleDateString("en-GB") : "-";
        
        let paymentBadge = "";
        if (pur.payment_method === "cash") {
            paymentBadge = `<span class="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold">လက်ငင်း</span>`;
        } else if (pur.payment_method === "bank") {
            paymentBadge = `<span class="px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold">ဘဏ် (${escapeHtml(pur.bank_account_name || "Bank")})</span>`;
        } else {
            paymentBadge = `<span class="px-2.5 py-1 bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold">အကြွေး</span>`;
        }

        const unitDisplay = pur.size || "ထည်";

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-blue-600 dark:text-blue-400 text-sm">${escapeHtml(pur.purchase_no || "-")}</div>
                <div class="text-xs text-slate-400">${dateStr}</div>
            </td>
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-slate-800 dark:text-slate-200 text-base">${escapeHtml(pur.sku || "-")}</div>
                <div class="text-xs">${escapeHtml(pur.barcode || "")}</div>
            </td>
            <td class="p-4">
                <span class="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm font-bold">
                    ${escapeHtml(pur.category || "-")}
                </span>
            </td>
            <td class="p-4">
                <div class="font-bold text-slate-900 dark:text-white text-base">${escapeHtml(pur.item_name || "-")}</div>
                <div class="text-sm text-slate-400">${escapeHtml(pur.pattern || "-")}</div>
            </td>
            <td class="p-4 text-sm">
                <div class="font-bold text-slate-700 dark:text-slate-300">${escapeHtml(pur.color || "-")}</div>
                <div class="text-xs text-emerald-600 dark:text-emerald-400 font-bold">${escapeHtml(unitDisplay)}</div>
            </td>
            <td class="p-4 text-center">
                <span class="px-3.5 py-1.5 rounded-xl font-mono font-black text-base bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    ${Number(pur.quantity || 0).toLocaleString()} <span class="text-xs font-normal font-sans">${escapeHtml(unitDisplay)}</span>
                </span>
            </td>
            <td class="p-4 text-center">${paymentBadge}</td>
            <td class="p-4 text-right font-mono text-base text-slate-500">${Number(pur.unit_cost || 0).toLocaleString()}</td>
            <td class="p-4 text-right font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">${Number(pur.retail_price || 0).toLocaleString()}</td>
            <td class="p-4 text-right font-mono font-bold text-base text-blue-600 dark:text-blue-400">${Number(pur.wholesale_price || 0).toLocaleString()}</td>
            <td class="p-4 font-bold text-slate-800 dark:text-slate-200 text-base">${escapeHtml(pur.supplier_name || "-")}</td>
            <td class="p-4 text-center">
                <span class="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold uppercase">
                    ${escapeHtml(pur.status || "COMPLETED")}
                </span>
            </td>
            <td class="p-4 text-center">
                <button type="button" data-id="${pur.purchase_id || pur.id}" title="ဖျက်သိမ်းပြီး စတော့ပြန်ညှိမည်" class="btn-delete-pur w-8 h-8 inline-flex items-center justify-center bg-rose-500/10 hover:bg-rose-600 hover:text-white rounded-lg text-rose-500 dark:text-rose-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-delete-pur").forEach(btn => {
        btn.onclick = () => deletePurchase(btn.dataset.id);
    });

    pagination.renderControls("purchases-pagination");
}

function generateAutoSKU(categoryName = "") {
    let prefix = "GAR";
    const cat = categoryName.toLowerCase();
    if (cat.includes("ချည်") || cat.includes("yarn")) prefix = "YARN";
    else if (cat.includes("အင်္ကျီ") || cat.includes("shirt")) prefix = "SHRT";
    else if (cat.includes("ပုဆိုး") || cat.includes("pasho")) prefix = "PASHO";
    else if (cat.includes("လုံချည်") || cat.includes("lon")) prefix = "LON";

    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${rand}`;
}

// =========================================================================
// --- MODAL WORKSPACE LOGIC (4-SECTIONS) ----------------------------------
// =========================================================================

function openPurchaseModal() {
    const modal = document.getElementById("purchase-modal");
    document.getElementById("pur-supplier").value = "";
    document.getElementById("pur-payment-method").value = "cash";
    document.getElementById("pur-bank-name").value = "";
    document.getElementById("pur-bank-container")?.classList.add("hidden");
    
    // Set default order date to today
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    document.getElementById("pur-date").value = todayStr;

    selectedOrderItems = [];
    renderOrderItemsTable();
    modal?.classList.remove("hidden");
    document.getElementById("pur-supplier")?.focus();
}

function closePurchaseModal() {
    document.getElementById("purchase-modal")?.classList.add("hidden");
}

function renderQuickSuggestions() {
    const input = document.getElementById("pur-quick-search-input");
    const catFilter = document.getElementById("pur-quick-cat-filter");
    const container = document.getElementById("pur-quick-suggestions");

    if (!input || !container) return;

    const kw = input.value.trim().toLowerCase();
    const selectedCat = catFilter?.value.trim().toLowerCase() || "";

    const matches = masterProducts.filter(p => {
        if (selectedCat && (p.category || "").trim().toLowerCase() !== selectedCat) return false;
        if (!kw) return true;
        const hay = `${p.sku || ""} ${p.barcode || ""} ${p.item_name || ""} ${p.color || ""} ${p.pattern || ""}`.toLowerCase();
        return hay.includes(kw);
    }).slice(0, 20);

    container.innerHTML = "";

    if (matches.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center text-slate-400">
                <i class="fa-solid fa-box-open text-2xl mb-2 opacity-50"></i>
                <div class="text-xs font-bold mb-2">ကိုက်ညီသော ပစ္စည်း ရှာမတွေ့ပါ</div>
                <button type="button" id="btn-quick-create-from-search" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer">
                    + "${escapeHtml(kw)}" ဖြင့် အသစ်မှတ်ပုံတင်မည်
                </button>
            </div>
        `;
        container.querySelector("#btn-quick-create-from-search")?.addEventListener("click", () => {
            container.classList.add("hidden");
            openNewProductModal(kw, selectedCat);
        });
    } else {
        matches.forEach(p => {
            const card = document.createElement("div");
            card.className = "p-3 hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer flex items-center justify-between transition";
            card.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold text-xs shrink-0">
                        ${escapeHtml((p.category || "Item").slice(0, 2))}
                    </div>
                    <div>
                        <div class="font-extrabold text-slate-900 dark:text-white text-xs">${escapeHtml(p.item_name)}</div>
                        <div class="text-[11px] text-slate-400 font-mono">
                            ${escapeHtml(p.sku || "-")} • <span class="text-emerald-500 font-bold">${escapeHtml(p.category || "-")}</span> ${p.color ? `• ${escapeHtml(p.color)}` : ''}
                        </div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs">ဝယ်ရင်း: ${Number(p.cost_price || 0).toLocaleString()} Ks</div>
                    <div class="text-[10px] text-slate-400">လက်ရှိစတော့: ${Number(p.current_stock || 0).toLocaleString()} ${escapeHtml(p.size || 'ထည်')}</div>
                </div>
            `;
            card.onclick = () => {
                addOrderItem(p);
                container.classList.add("hidden");
                input.value = "";
                document.getElementById("btn-clear-quick-search")?.classList.add("hidden");
            };
            container.appendChild(card);
        });
    }

    container.classList.remove("hidden");
}

function addOrderItem(prod, isNew = false) {
    const existing = selectedOrderItems.find(it => !it.is_new && it.product_id === prod.id);
    if (existing) {
        existing.quantity += 1;
        existing.subtotal = existing.quantity * existing.unit_cost;
    } else {
        const cost = Number(prod.cost_price || 0);
        const retail = Number(prod.retail_price || 0);
        const wholesale = Number(prod.wholesale_price || 0);

        selectedOrderItems.push({
            is_new: isNew,
            product_id: isNew ? null : prod.id,
            item_name: prod.item_name,
            sku: prod.sku,
            category: prod.category,
            pattern: prod.pattern || "",
            color: prod.color || "",
            size: prod.size || "ထည်",
            quantity: 1,
            unit_cost: cost,
            retail_price: retail,
            wholesale_price: wholesale,
            retail_margin_pct: cost > 0 && retail > cost ? Math.round(((retail - cost) / cost) * 100) : 0,
            wholesale_margin_pct: cost > 0 && wholesale > cost ? Math.round(((wholesale - cost) / cost) * 100) : 0,
            subtotal: cost * 1
        });
    }

    renderOrderItemsTable();
}

function renderOrderItemsTable() {
    const tbody = document.getElementById("pur-items-container");
    const rowCountEl = document.getElementById("pur-row-count");
    if (!tbody) return;

    if (rowCountEl) rowCountEl.textContent = selectedOrderItems.length;

    if (selectedOrderItems.length === 0) {
        tbody.innerHTML = `
            <tr id="pur-empty-row">
                <td colspan="8" class="p-12 text-center text-slate-400 font-bold text-sm">
                    <i class="fa-solid fa-cart-arrow-down text-3xl mb-2 opacity-40"></i>
                    <div>ပစ္စည်း ရွေးချယ်ထားခြင်း မရှိသေးပါ။ အပေါ်ရှိ Search Bar တွင် ရှာဖွေရွေးချယ်ပါ။</div>
                </td>
            </tr>
        `;
        updateOrderSummary();
        return;
    }

    tbody.innerHTML = "";

    selectedOrderItems.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition";
        tr.innerHTML = `
            <td class="p-3.5 text-center text-slate-400 font-mono">${index + 1}</td>
            <td class="p-3.5">
                <div class="font-extrabold text-slate-900 dark:text-white text-xs">${escapeHtml(item.item_name)}</div>
                <div class="text-[11px] text-slate-400 font-mono">
                    ${escapeHtml(item.sku || "-")} • <span class="text-emerald-500 font-bold">${escapeHtml(item.category || "-")}</span>
                    ${item.color ? `• ${escapeHtml(item.color)}` : ''} (${escapeHtml(item.size || 'ထည်')})
                </div>
            </td>
            <td class="p-3.5 text-center">
                <input type="number" min="0.1" step="any" value="${item.quantity}" data-idx="${index}"
                    class="item-qty w-20 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-1.5 text-center text-slate-900 dark:text-white focus:ring-1 focus:ring-emerald-500">
            </td>
            <td class="p-3.5 text-right">
                <input type="number" min="0" step="any" value="${item.unit_cost}" data-idx="${index}"
                    class="item-cost w-28 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-right text-slate-900 dark:text-white focus:ring-1 focus:ring-emerald-500">
            </td>
            <td class="p-3.5 text-right space-y-1">
                <input type="number" min="0" step="any" value="${item.retail_price}" data-idx="${index}"
                    class="item-retail w-32 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-1 text-right text-emerald-500 focus:ring-1 focus:ring-emerald-500">
                <div class="flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span>Margin %:</span>
                    <input type="number" value="${item.retail_margin_pct || ''}" placeholder="0" data-idx="${index}"
                        class="item-retail-pct w-12 text-[10px] font-mono text-center bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded px-1 py-0.5">
                </div>
            </td>
            <td class="p-3.5 text-right space-y-1">
                <input type="number" min="0" step="any" value="${item.wholesale_price}" data-idx="${index}"
                    class="item-wholesale w-32 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-1 text-right text-blue-400 focus:ring-1 focus:ring-blue-500">
                <div class="flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span>Margin %:</span>
                    <input type="number" value="${item.wholesale_margin_pct || ''}" placeholder="0" data-idx="${index}"
                        class="item-wholesale-pct w-12 text-[10px] font-mono text-center bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded px-1 py-0.5">
                </div>
            </td>
            <td class="p-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                ${Number(item.subtotal || 0).toLocaleString()}
            </td>
            <td class="p-3.5 text-center">
                <button type="button" data-idx="${index}" class="btn-remove-item text-slate-400 hover:text-rose-500 text-sm transition cursor-pointer" title="စာရင်းမှ ဖယ်ရှားမည်">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Row input event bindings
    tbody.querySelectorAll(".item-qty").forEach(input => {
        input.oninput = (e) => {
            const idx = Number(e.target.dataset.idx);
            selectedOrderItems[idx].quantity = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].subtotal = selectedOrderItems[idx].quantity * selectedOrderItems[idx].unit_cost;
            renderOrderItemsTable();
        };
    });

    tbody.querySelectorAll(".item-cost").forEach(input => {
        input.oninput = (e) => {
            const idx = Number(e.target.dataset.idx);
            const cost = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].unit_cost = cost;

            if (selectedOrderItems[idx].retail_margin_pct > 0) {
                selectedOrderItems[idx].retail_price = Math.round(cost * (1 + selectedOrderItems[idx].retail_margin_pct / 100));
            }
            if (selectedOrderItems[idx].wholesale_margin_pct > 0) {
                selectedOrderItems[idx].wholesale_price = Math.round(cost * (1 + selectedOrderItems[idx].wholesale_margin_pct / 100));
            }

            selectedOrderItems[idx].subtotal = selectedOrderItems[idx].quantity * cost;
            renderOrderItemsTable();
        };
    });

    tbody.querySelectorAll(".item-retail").forEach(input => {
        input.oninput = (e) => {
            const idx = Number(e.target.dataset.idx);
            const retail = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].retail_price = retail;
            const cost = selectedOrderItems[idx].unit_cost;
            if (cost > 0 && retail > cost) {
                selectedOrderItems[idx].retail_margin_pct = Math.round(((retail - cost) / cost) * 100);
            }
            renderOrderItemsTable();
        };
    });

    tbody.querySelectorAll(".item-retail-pct").forEach(input => {
        input.oninput = (e) => {
            const idx = Number(e.target.dataset.idx);
            const pct = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].retail_margin_pct = pct;
            selectedOrderItems[idx].retail_price = Math.round(selectedOrderItems[idx].unit_cost * (1 + pct / 100));
            renderOrderItemsTable();
        };
    });

    tbody.querySelectorAll(".item-wholesale").forEach(input => {
        input.oninput = (e) => {
            const idx = Number(e.target.dataset.idx);
            const wholesale = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].wholesale_price = wholesale;
            const cost = selectedOrderItems[idx].unit_cost;
            if (cost > 0 && wholesale > cost) {
                selectedOrderItems[idx].wholesale_margin_pct = Math.round(((wholesale - cost) / cost) * 100);
            }
            renderOrderItemsTable();
        };
    });

    tbody.querySelectorAll(".item-wholesale-pct").forEach(input => {
        input.oninput = (e) => {
            const idx = Number(e.target.dataset.idx);
            const pct = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].wholesale_margin_pct = pct;
            selectedOrderItems[idx].wholesale_price = Math.round(selectedOrderItems[idx].unit_cost * (1 + pct / 100));
            renderOrderItemsTable();
        };
    });

    tbody.querySelectorAll(".btn-remove-item").forEach(btn => {
        btn.onclick = (e) => {
            const idx = Number(btn.dataset.idx);
            selectedOrderItems.splice(idx, 1);
            renderOrderItemsTable();
        };
    });

    updateOrderSummary();
}

function updateOrderSummary() {
    const totalQty = selectedOrderItems.reduce((acc, it) => acc + Number(it.quantity || 0), 0);
    const grandTotal = selectedOrderItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

    const qtyEl = document.getElementById("pur-total-qty");
    const totalEl = document.getElementById("pur-grand-total");

    if (qtyEl) qtyEl.textContent = totalQty.toLocaleString();
    if (totalEl) totalEl.textContent = `${grandTotal.toLocaleString()} Ks`;
}

// --- Dedicated Create Product Sub-Modal Logic (Correct Pointer Event handling) ---
function openNewProductModal(prefillName = "", prefillCat = "") {
    const modal = document.getElementById("new-prod-modal");
    document.getElementById("new-prod-form")?.reset();

    const catInput = document.getElementById("sub-cat");
    const nameInput = document.getElementById("sub-name");
    const skuInput = document.getElementById("sub-sku");

    const catVal = typeof prefillCat === "string" ? prefillCat : "";
    const nameVal = typeof prefillName === "string" ? prefillName : "";

    if (catInput) catInput.value = catVal;
    if (nameInput) nameInput.value = nameVal;
    if (skuInput) skuInput.value = generateAutoSKU(catVal || "အထည်");

    modal?.classList.remove("hidden");
    setTimeout(() => nameInput?.focus(), 50);
}

function submitNewProductSubModal(e) {
    e.preventDefault();
    const cat = document.getElementById("sub-cat")?.value.trim();
    const name = document.getElementById("sub-name")?.value.trim();
    const sku = document.getElementById("sub-sku")?.value.trim() || generateAutoSKU(cat);
    const size = document.getElementById("sub-size")?.value || "ထည်";
    const pattern = document.getElementById("sub-pattern")?.value.trim() || "";
    const color = document.getElementById("sub-color")?.value.trim() || "";

    if (!cat || !name) return alert("အမျိုးအစားနှင့် အထည်အမည် ပြည့်စုံစွာ ဖြည့်သွင်းပါ");

    const newProdObj = {
        category: cat,
        item_name: name,
        sku: sku,
        pattern: pattern,
        color: color,
        size: size,
        cost_price: 0,
        retail_price: 0,
        wholesale_price: 0
    };

    addOrderItem(newProdObj, true);
    document.getElementById("new-prod-modal")?.classList.add("hidden");
}

// --- Submit Purchase Order to Backend API ---
async function submitPurchase() {
    const supplier = document.getElementById("pur-supplier")?.value.trim();
    const paymentMethod = document.getElementById("pur-payment-method")?.value || "cash";
    const bankName = document.getElementById("pur-bank-name")?.value.trim();

    if (!supplier) {
        alert("ပေးသွင်းသူ (ပွဲရုံ) အမည် ထည့်သွင်းပေးပါ။");
        document.getElementById("pur-supplier")?.focus();
        return;
    }

    if (paymentMethod === "bank" && !bankName) {
        alert("ဘဏ်လွှဲဖြစ်ပါက ဘဏ်အမည် သို့မဟုတ် အကောင့်အမည် ထည့်သွင်းပေးပါ။");
        document.getElementById("pur-bank-name")?.focus();
        return;
    }

    if (selectedOrderItems.length === 0) {
        alert("ကျေးဇူးပြု၍ ဝယ်ယူမည့် ပစ္စည်း အနည်းဆုံး (၁) မျိုး ရွေးချယ်ပေးပါ။");
        document.getElementById("pur-quick-search-input")?.focus();
        return;
    }

    const branchId = state.currentBranch?.id || 1;
    const totalAmount = selectedOrderItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

    const formattedItems = selectedOrderItems.map(it => {
        if (it.is_new) {
            return {
                is_new: true,
                new_product: {
                    category: it.category,
                    item_name: it.item_name,
                    sku: it.sku,
                    pattern: it.pattern || null,
                    color: it.color || null,
                    size: it.size || "ထည်",
                    cost_price: it.unit_cost,
                    retail_price: it.retail_price,
                    wholesale_price: it.wholesale_price
                },
                quantity: it.quantity,
                unit_cost: it.unit_cost,
                retail_price: it.retail_price,
                wholesale_price: it.wholesale_price,
                subtotal: it.subtotal
            };
        } else {
            return {
                is_new: false,
                product_id: it.product_id,
                quantity: it.quantity,
                unit_cost: it.unit_cost,
                retail_price: it.retail_price,
                wholesale_price: it.wholesale_price,
                subtotal: it.subtotal
            };
        }
    });

    const payload = {
        branch_id: branchId,
        supplier_name: supplier,
        payment_method: paymentMethod,
        bank_account_name: paymentMethod === "bank" ? bankName : null,
        total_amount: totalAmount,
        items: formattedItems
    };

    const btn = document.getElementById("btn-submit-purchase");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> သိမ်းဆည်းနေပါသည်...`;
    }

    try {
        const res = await api.post("/purchases", payload);
        alert(`အဝယ်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီး စတော့နှင့် ငွေစာရင်းများ ပေါင်းထည့်ပြီးပါပြီ။ (ဘောင်ချာနံပါတ်: ${res.data?.purchaseNo || 'OK'})`);
        closePurchaseModal();
        await loadMasterProducts();
        await loadPurchases();
    } catch (err) {
        alert("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check mr-1"></i> <span>အတည်ပြု၍ စာရင်းသွင်းမည်</span>`;
        }
    }
}

async function deletePurchase(id) {
    if (!confirm("ဤအဝယ်စာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?\n(စတော့ထဲမှ ပစ္စည်းအရေအတွက်များ ပြန်နုတ်ပြီး ငွေစာရင်းမှလည်း အလိုအလျောက် ပြန်နုတ်ပေးပါမည်)")) return;
    try {
        await api.delete(`/purchases/${id}`);
        alert("အဝယ်စာရင်း ဖျက်သိမ်းပြီး စတော့နှင့် ငွေစာရင်း ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await loadPurchases();
    } catch (err) {
        alert("ဖျက်၍မရပါ: " + err.message);
    }
}
