// cashbook-frontend/js/modules/purchases.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { PaginationController } from "../core/pagination.js";

let purchasesList = [];
let masterProducts = [];

// အဝယ်စာရင်းအတွက် စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Controller
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
    document.getElementById("btn-close-purchase-modal")?.addEventListener("click", () => {
        document.getElementById("purchase-modal")?.classList.add("hidden");
    });

    document.getElementById("btn-submit-purchase")?.addEventListener("click", submitPurchase);
    document.getElementById("btn-add-pur-item")?.addEventListener("click", () => addPurchaseRow());

    const paymentSelect = document.getElementById("pur-payment-method");
    if (paymentSelect) {
        paymentSelect.addEventListener("change", (e) => {
            const bankContainer = document.getElementById("pur-bank-container");
            if (e.target.value === "bank") {
                bankContainer?.classList.remove("hidden");
            } else {
                bankContainer?.classList.add("hidden");
                const bankInput = document.getElementById("pur-bank-name");
                if (bankInput) bankInput.value = "";
            }
        });
    }

    // Modal ပြင်ပနှိပ်ပါက Autocomplete Suggestion များကို ပိတ်သိမ်းခြင်း
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".pur-search-wrapper")) {
            document.querySelectorAll(".pur-suggestions").forEach(el => el.classList.add("hidden"));
        }
    });
}

async function loadMasterProducts() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        masterProducts = res.data || [];
    } catch (err) {
        console.error("Master Products ရယူ၍ မရပါ:", err);
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
        pagination.reset();
        renderPurchasesTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderPurchasesTable() {
    const tbody = document.getElementById("pur-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (purchasesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-slate-400 font-bold text-base">အဝယ်စာရင်း မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        pagination.renderControls("purchases-pagination");
        return;
    }

    // လက်ရှိ စာမျက်နှာအတွက် စာကြောင်း (၁၅) ခု ဖြတ်ယူပြသခြင်း
    const pageItems = pagination.getPageItems(purchasesList);

    pageItems.forEach(pur => {
        const dateStr = pur.created_at ? new Date(pur.created_at).toLocaleDateString("en-GB") : "-";
        
        let paymentBadge = "";
        if (pur.payment_method === "cash") {
            paymentBadge = `<span class="px-3 py-1.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold">လက်ငင်း</span>`;
        } else if (pur.payment_method === "bank") {
            paymentBadge = `<span class="px-3 py-1.5 bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold">ဘဏ် (${escapeHtml(pur.bank_account_name || "Bank")})</span>`;
        } else {
            paymentBadge = `<span class="px-3 py-1.5 bg-rose-500/15 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold">အကြွေး</span>`;
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
                <span class="px-3.5 py-1.5 rounded-xl font-mono font-black text-base bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    ${Number(pur.quantity || 0).toLocaleString()} <span class="text-xs font-normal font-sans">${escapeHtml(unitDisplay)}</span>
                </span>
            </td>
            <td class="p-4 text-center">${paymentBadge}</td>
            <td class="p-4 text-right font-mono text-base text-slate-500">
                ${Number(pur.unit_cost || 0).toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                ${Number(pur.retail_price || 0).toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-bold text-base text-blue-600 dark:text-blue-400">
                ${Number(pur.wholesale_price || 0).toLocaleString()}
            </td>
            <td class="p-4 font-bold text-slate-800 dark:text-slate-200 text-base">
                ${escapeHtml(pur.supplier_name || "-")}
            </td>
            <td class="p-4 text-center">
                <span class="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold uppercase">
                    ${escapeHtml(pur.status || "COMPLETED")}
                </span>
            </td>
            <td class="p-4 text-center">
                <div class="flex items-center justify-center gap-1.5">
                    <button type="button" data-id="${pur.purchase_id || pur.id}" title="ပြင်ဆင်မည်" class="btn-edit-pur w-8 h-8 flex items-center justify-center bg-blue-500/10 hover:bg-blue-600 hover:text-white rounded-lg text-blue-600 dark:text-blue-400 transition cursor-pointer shadow-sm">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button type="button" data-id="${pur.purchase_id || pur.id}" title="ဖျက်မည် (စတော့နှင့် ငွေစာရင်း ပြန်ညှိမည်)" class="btn-delete-pur w-8 h-8 flex items-center justify-center bg-rose-500/10 hover:bg-rose-600 hover:text-white rounded-lg text-rose-500 dark:text-rose-400 transition cursor-pointer shadow-sm">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-edit-pur").forEach(btn => {
        btn.onclick = () => {
            const pur = purchasesList.find(p => (p.purchase_id || p.id) == btn.dataset.id);
            if (pur) openPurchaseModal(pur);
        };
    });

    tbody.querySelectorAll(".btn-delete-pur").forEach(btn => {
        btn.onclick = () => deletePurchase(btn.dataset.id);
    });

    // အောက်ခြေ Pagination Controls ဘား ဆွဲတင်ခြင်း
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

function openPurchaseModal(pur = null) {
    const modal = document.getElementById("purchase-modal");
    const editIdInput = document.getElementById("pur-edit-id");
    const title = document.getElementById("purchase-modal-title");
    
    if (pur) {
        title.textContent = "အဝယ်စာရင်း ပြင်ဆင်မည်";
        editIdInput.value = pur.purchase_id || pur.id;
        document.getElementById("pur-supplier").value = pur.supplier_name || "";
        document.getElementById("pur-payment-method").value = pur.payment_method || "cash";
        document.getElementById("pur-bank-name").value = pur.bank_account_name || "";
        if (pur.payment_method === "bank") {
            document.getElementById("pur-bank-container")?.classList.remove("hidden");
        } else {
            document.getElementById("pur-bank-container")?.classList.add("hidden");
        }
    } else {
        title.textContent = "အဝယ်စာရင်း (စတော့အဝင်) သွင်းမည်";
        editIdInput.value = "";
        document.getElementById("pur-supplier").value = "";
        document.getElementById("pur-payment-method").value = "cash";
        document.getElementById("pur-bank-name").value = "";
        document.getElementById("pur-bank-container")?.classList.add("hidden");
    }

    const tbody = document.getElementById("pur-items-container");
    if (tbody) tbody.innerHTML = "";
    
    addPurchaseRow(pur);
    updateTotalAmount();
    modal?.classList.remove("hidden");
}

function addPurchaseRow(existingData = null) {
    const tbody = document.getElementById("pur-items-container");
    if (!tbody) return;

    const categories = [...new Set(masterProducts.map(p => p.category).filter(Boolean))];
    let catOptions = `<option value="">အမျိုးအစား အားလုံး</option>`;
    categories.forEach(c => {
        catOptions += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });

    const tr = document.createElement("tr");
    tr.className = "pur-item-row group border-b border-slate-200 dark:border-slate-800";
    tr.innerHTML = `
        <td class="p-3 align-top min-w-[320px]">
            <div class="pur-search-wrapper relative">
                <!-- Search & Quick Actions Toolbar -->
                <div class="flex items-center gap-1.5">
                    <select class="pur-cat-filter text-[11px] font-bold bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-2 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500 max-w-[100px] cursor-pointer" title="Category အလိုက် စစ်ထုတ်ရန်">
                        ${catOptions}
                    </select>

                    <div class="relative flex-1">
                        <i class="fa-solid fa-barcode text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 text-xs"></i>
                        <input type="text" autocomplete="off" placeholder="ကုတ် / Barcode / အမည် ရိုက်ပါ..." 
                            class="pur-search-input w-full text-xs font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-7 pr-2 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <input type="hidden" class="pur-selected-prod-id" value="${existingData?.product_id || ''}">
                    </div>

                    <button type="button" title="ပစ္စည်းအသစ် ဖန်တီးမည်" class="btn-toggle-new shrink-0 px-2.5 py-2 bg-emerald-500/10 hover:bg-emerald-600 hover:text-white text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-lg border border-emerald-500/30 transition cursor-pointer">
                        <i class="fa-solid fa-plus"></i> အသစ်
                    </button>
                </div>

                <!-- Autocomplete Dropdown List -->
                <div class="pur-suggestions hidden absolute left-0 right-0 top-full mt-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl z-30 max-h-56 overflow-y-auto text-xs divide-y divide-slate-100 dark:divide-slate-800">
                </div>

                <!-- Selected Product Preview Badge -->
                <div class="pur-selected-preview hidden mt-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-bold flex items-center justify-between">
                    <span class="preview-text truncate"></span>
                    <button type="button" class="btn-clear-prod text-slate-400 hover:text-rose-500 ml-1.5 cursor-pointer">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- ပစ္စည်းအသစ်အတွက် Inline Form -->
            <div class="new-product-fields hidden mt-2 space-y-2 p-3 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-emerald-500/30">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400"><i class="fa-solid fa-sparkles mr-1"></i>ပစ္စည်းအသစ် အချက်အလက်</span>
                    <button type="button" class="btn-cancel-new text-xs text-slate-400 hover:text-rose-500"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <input type="text" placeholder="အမျိုးအစား (Category) ဥပမာ - ချည် သို့မဟုတ် အင်္ကျီ" class="new-cat w-full text-xs font-bold px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg">
                <input type="text" placeholder="ပစ္စည်းအမည် (Item Name) *" class="new-name w-full text-xs font-bold px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg">
                <div class="grid grid-cols-3 gap-1.5">
                    <input type="text" placeholder="SKU ကုတ် *" class="new-sku text-xs font-mono font-bold px-2 py-1 bg-white dark:bg-slate-900 border border-emerald-500/50 text-emerald-500 rounded-lg" title="Auto SKU သတ်မှတ်ပေးပါသည်">
                    <input type="text" placeholder="အရောင်" class="new-color text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg">
                    
                    <select class="new-size text-xs font-bold px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer">
                        <optgroup label="ချည်ယူနစ်များ">
                            <option value="ပေါင်">ပေါင် (lb)</option>
                            <option value="လိပ်">လိပ်</option>
                            <option value="ထုပ်">ထုပ်</option>
                            <option value="ခင်">ခင်</option>
                            <option value="လုံး">လုံး</option>
                        </optgroup>
                        <optgroup label="အထည်ယူနစ် / ဆိုဒ်များ">
                            <option value="ထည်" selected>ထည်</option>
                            <option value="အုပ်">အုပ်</option>
                            <option value="စုံ">စုံ</option>
                            <option value="Free Size">Free Size</option>
                            <option value="S">S</option>
                            <option value="M">M</option>
                            <option value="L">L</option>
                            <option value="XL">XL</option>
                            <option value="2XL">2XL</option>
                        </optgroup>
                    </select>
                </div>
            </div>
        </td>
        <td class="p-3 align-top">
            <input type="number" min="0.1" step="any" value="${existingData?.quantity || 1}" class="pur-item-qty w-full text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-2 text-center text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
        </td>
        <td class="p-3 align-top">
            <input type="number" min="0" value="${existingData?.unit_cost || 0}" step="any" class="pur-item-cost w-full text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-2 text-right text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="ဝယ်ဈေး">
        </td>
        <td class="p-3 align-top space-y-1.5">
            <div class="flex items-center gap-1">
                <input type="number" min="0" value="${existingData?.retail_price || 0}" step="any" class="pur-item-retail w-full text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-2 text-right text-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="လက်လီဈေး *">
            </div>
            <div class="flex items-center gap-1.5">
                <span class="text-[11px] text-slate-400 font-bold shrink-0">+ % :</span>
                <input type="number" placeholder="30" class="pur-retail-pct w-full text-[11px] px-2 py-1 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded text-center font-mono font-bold" title="ဝယ်ဈေးပေါ် ရာခိုင်နှုန်းထည့်ပါ">
            </div>
        </td>
        <td class="p-3 align-top space-y-1.5">
            <div class="flex items-center gap-1">
                <input type="number" min="0" value="${existingData?.wholesale_price || 0}" step="any" class="pur-item-wholesale w-full text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 py-2 text-right text-blue-400 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="လက်ကားဈေး *">
            </div>
            <div class="flex items-center gap-1.5">
                <span class="text-[11px] text-slate-400 font-bold shrink-0">+ % :</span>
                <input type="number" placeholder="15" class="pur-wholesale-pct w-full text-[11px] px-2 py-1 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded text-center font-mono font-bold" title="ဝယ်ဈေးပေါ် ရာခိုင်နှုန်းထည့်ပါ">
            </div>
        </td>
        <td class="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm pur-item-subtotal align-top pt-4">
            0
        </td>
        <td class="p-3 text-center align-top pt-3">
            <button type="button" class="btn-remove-row text-slate-400 hover:text-rose-500 transition cursor-pointer">
                <i class="fa-solid fa-circle-minus text-lg"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);

    const searchInput = tr.querySelector(".pur-search-input");
    const catFilter = tr.querySelector(".pur-cat-filter");
    const suggestionsBox = tr.querySelector(".pur-suggestions");
    const hiddenProdId = tr.querySelector(".pur-selected-prod-id");
    const previewBox = tr.querySelector(".pur-selected-preview");
    const previewText = tr.querySelector(".preview-text");
    const btnClearProd = tr.querySelector(".btn-clear-prod");
    const btnToggleNew = tr.querySelector(".btn-toggle-new");
    const btnCancelNew = tr.querySelector(".btn-cancel-new");

    const newFields = tr.querySelector(".new-product-fields");
    const newCatInput = tr.querySelector(".new-cat");
    const newNameInput = tr.querySelector(".new-name");
    const newSkuInput = tr.querySelector(".new-sku");
    const newSizeSelect = tr.querySelector(".new-size");

    const qtyInput = tr.querySelector(".pur-item-qty");
    const costInput = tr.querySelector(".pur-item-cost");
    const retailInput = tr.querySelector(".pur-item-retail");
    const wholesaleInput = tr.querySelector(".pur-item-wholesale");
    const retailPct = tr.querySelector(".pur-retail-pct");
    const wholesalePct = tr.querySelector(".pur-wholesale-pct");
    const removeBtn = tr.querySelector(".btn-remove-row");

    if (existingData && existingData.product_id) {
        hiddenProdId.value = existingData.product_id;
        previewText.textContent = `${existingData.item_name || 'Item'} (${existingData.sku || '-'})`;
        previewBox.classList.remove("hidden");
        searchInput.classList.add("hidden");
    }

    const renderSuggestions = () => {
        const kw = searchInput.value.trim().toLowerCase();
        const selectedCat = catFilter.value.trim().toLowerCase();

        let matches = masterProducts.filter(p => {
            if (selectedCat && (p.category || "").toLowerCase() !== selectedCat) return false;
            if (!kw) return true;
            const hay = `${p.barcode || ""} ${p.sku || ""} ${p.item_name || ""} ${p.color || ""}`.toLowerCase();
            return hay.includes(kw);
        }).slice(0, 15);

        suggestionsBox.innerHTML = "";

        if (matches.length === 0) {
            suggestionsBox.innerHTML = `
                <div class="p-3 text-center text-slate-400">
                    <div>ပစ္စည်း ရှာမတွေ့ပါ</div>
                    <button type="button" class="btn-create-from-search mt-1.5 px-3 py-1 bg-emerald-600 text-white rounded-lg font-bold text-xs">
                        + "${escapeHtml(kw)}" ကို အသစ်အဖြစ် ထည့်မည်
                    </button>
                </div>
            `;
            suggestionsBox.querySelector(".btn-create-from-search")?.addEventListener("click", () => {
                openNewProductBox(kw);
                suggestionsBox.classList.add("hidden");
            });
        } else {
            matches.forEach(p => {
                const itemEl = document.createElement("div");
                itemEl.className = "p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center justify-between";
                itemEl.innerHTML = `
                    <div>
                        <div class="font-bold text-slate-900 dark:text-white">${escapeHtml(p.item_name)}</div>
                        <div class="text-[11px] text-slate-400">${escapeHtml(p.sku || "-")} | ${escapeHtml(p.category || "-")} ${p.color ? '| ' + escapeHtml(p.color) : ''}</div>
                    </div>
                    <div class="text-right">
                        <span class="text-emerald-600 dark:text-emerald-400 font-mono font-bold">${Number(p.cost_price || 0).toLocaleString()} Ks</span>
                        <div class="text-[10px] text-slate-400">စတော့: ${p.current_stock || 0}</div>
                    </div>
                `;
                itemEl.onclick = () => selectProduct(p);
                suggestionsBox.appendChild(itemEl);
            });
        }
        suggestionsBox.classList.remove("hidden");
    };

    const selectProduct = (p) => {
        hiddenProdId.value = p.id;
        newFields.classList.add("hidden");
        previewText.textContent = `${p.item_name} (${p.sku || "-"}) [${p.category || ""}]`;
        previewBox.classList.remove("hidden");
        searchInput.classList.add("hidden");
        suggestionsBox.classList.add("hidden");

        costInput.value = p.cost_price || 0;
        retailInput.value = p.retail_price || 0;
        wholesaleInput.value = p.wholesale_price || 0;

        calculateRow(tr);
        qtyInput.focus();
    };

    const openNewProductBox = (initialName = "") => {
        hiddenProdId.value = "NEW";
        previewBox.classList.add("hidden");
        newFields.classList.remove("hidden");
        if (initialName) newNameInput.value = initialName;
        newCatInput.value = catFilter.value || "";
        newSkuInput.value = generateAutoSKU(newCatInput.value);
        newNameInput.focus();
    };

    searchInput.addEventListener("focus", renderSuggestions);
    searchInput.addEventListener("input", renderSuggestions);
    catFilter.addEventListener("change", renderSuggestions);

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const val = searchInput.value.trim().toLowerCase();
            const exactMatch = masterProducts.find(p => 
                (p.barcode && p.barcode.toLowerCase() === val) || 
                (p.sku && p.sku.toLowerCase() === val)
            );
            if (exactMatch) {
                selectProduct(exactMatch);
            } else {
                renderSuggestions();
            }
        }
    });

    btnClearProd.addEventListener("click", () => {
        hiddenProdId.value = "";
        previewBox.classList.add("hidden");
        searchInput.classList.remove("hidden");
        searchInput.value = "";
        costInput.value = 0;
        retailInput.value = 0;
        wholesaleInput.value = 0;
        calculateRow(tr);
        searchInput.focus();
    });

    btnToggleNew.addEventListener("click", () => openNewProductBox());
    btnCancelNew.addEventListener("click", () => {
        hiddenProdId.value = "";
        newFields.classList.add("hidden");
        searchInput.classList.remove("hidden");
        searchInput.focus();
    });

    newCatInput.addEventListener("input", () => {
        const catVal = newCatInput.value.trim().toLowerCase();
        newSkuInput.value = generateAutoSKU(catVal);

        if (catVal.includes("ချည်") || catVal.includes("yarn")) {
            newSizeSelect.value = "ပေါင်";
        } else if (catVal.includes("ပုဆိုး") || catVal.includes("လုံချည်") || catVal.includes("အင်္ကျီ")) {
            newSizeSelect.value = "ထည်";
        }
    });

    const updatePricesLive = () => {
        const cost = parseFloat(costInput.value) || 0;
        const rPct = parseFloat(retailPct.value);
        const wPct = parseFloat(wholesalePct.value);

        if (!isNaN(rPct) && cost > 0) {
            retailInput.value = Math.round(cost + (cost * rPct / 100));
        }
        if (!isNaN(wPct) && cost > 0) {
            wholesaleInput.value = Math.round(cost + (cost * wPct / 100));
        }
    };

    costInput.addEventListener("input", () => {
        updatePricesLive();
        calculateRow(tr);
    });
    retailPct.addEventListener("input", updatePricesLive);
    wholesalePct.addEventListener("input", updatePricesLive);

    qtyInput.addEventListener("input", () => calculateRow(tr));

    removeBtn.addEventListener("click", () => {
        if (tbody.querySelectorAll(".pur-item-row").length > 1) {
            tr.remove();
            updateTotalAmount();
        } else {
            alert("အနည်းဆုံး ပစ္စည်းတစ်မျိုး ပါဝင်ရပါမည်။");
        }
    });

    calculateRow(tr);
}

function calculateRow(tr) {
    const qty = parseFloat(tr.querySelector(".pur-item-qty")?.value) || 0;
    const cost = parseFloat(tr.querySelector(".pur-item-cost")?.value) || 0;
    const subtotal = qty * cost;
    tr.querySelector(".pur-item-subtotal").textContent = subtotal.toLocaleString();
    updateTotalAmount();
}

function updateTotalAmount() {
    let total = 0;
    document.querySelectorAll(".pur-item-row").forEach(tr => {
        const qty = parseFloat(tr.querySelector(".pur-item-qty")?.value) || 0;
        const cost = parseFloat(tr.querySelector(".pur-item-cost")?.value) || 0;
        total += (qty * cost);
    });
    const el = document.getElementById("pur-total-amount");
    if (el) el.textContent = total.toLocaleString();
}

async function submitPurchase() {
    const supplier = document.getElementById("pur-supplier").value.trim();
    if (!supplier) return alert("ပေးသွင်းသူ (ပွဲရုံ) အမည် ထည့်ပါ။");

    const paymentMethod = document.getElementById("pur-payment-method").value;
    const bankName = document.getElementById("pur-bank-name").value.trim();
    if (paymentMethod === "bank" && !bankName) {
        return alert("ဘဏ်လွှဲဖြစ်ပါက ဘဏ်အကောင့်အမည် ထည့်ပါ။");
    }

    const editId = document.getElementById("pur-edit-id").value;
    const items = [];
    let hasError = false;
    let errMsg = "";

    document.querySelectorAll(".pur-item-row").forEach(tr => {
        const hiddenProdId = tr.querySelector(".pur-selected-prod-id").value;
        const qty = parseFloat(tr.querySelector(".pur-item-qty").value) || 0;
        const cost = parseFloat(tr.querySelector(".pur-item-cost").value) || 0;
        const retail = parseFloat(tr.querySelector(".pur-item-retail").value) || 0;
        const wholesale = parseFloat(tr.querySelector(".pur-item-wholesale").value) || 0;

        if (!hiddenProdId) {
            hasError = true;
            errMsg = "ပစ္စည်းရွေးချယ်မှု ပြည့်စုံစွာ လုပ်ဆောင်ပေးပါ။";
            tr.querySelector(".pur-search-input").classList.add("border-rose-500");
            return;
        }

        if (retail <= 0 || wholesale <= 0) {
            hasError = true;
            errMsg = "ပစ္စည်းတိုင်းအတွက် လက်လီဈေးနှင့် လက်ကားဈေးများကို မဖြစ်မနေ ထည့်သွင်းပေးရပါမည်။";
            tr.querySelector(".pur-item-retail").classList.add("border-rose-500");
            tr.querySelector(".pur-item-wholesale").classList.add("border-rose-500");
            return;
        }

        const itemObj = {
            quantity: qty,
            unit_cost: cost,
            retail_price: retail,
            wholesale_price: wholesale,
            subtotal: qty * cost
        };

        if (hiddenProdId === "NEW") {
            const cat = tr.querySelector(".new-cat").value.trim() || "အထည်";
            const name = tr.querySelector(".new-name").value.trim();
            const sku = tr.querySelector(".new-sku").value.trim();
            const color = tr.querySelector(".new-color").value.trim() || null;
            const size = tr.querySelector(".new-size").value.trim() || "ထည်";

            if (!name) {
                hasError = true;
                errMsg = "ပစ္စည်းအသစ်အတွက် အမည် ဖြည့်သွင်းပေးပါ။";
                tr.querySelector(".new-name").classList.add("border-rose-500");
                return;
            }

            itemObj.is_new = true;
            itemObj.new_product = {
                category: cat,
                item_name: name,
                sku: sku || generateAutoSKU(cat),
                color: color,
                size: size,
                cost_price: cost,
                retail_price: retail,
                wholesale_price: wholesale
            };
        } else {
            itemObj.is_new = false;
            itemObj.product_id = parseInt(hiddenProdId, 10);
        }

        items.push(itemObj);
    });

    if (hasError || items.length === 0) {
        return alert(errMsg || "ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const totalAmount = items.reduce((sum, it) => sum + it.subtotal, 0);
    const branchId = state.currentBranch?.id || 1;

    const payload = {
        branch_id: branchId,
        supplier_name: supplier,
        payment_method: paymentMethod,
        bank_account_name: paymentMethod === "bank" ? bankName : null,
        total_amount: totalAmount,
        items: items
    };

    const btn = document.getElementById("btn-submit-purchase");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> သိမ်းဆည်းနေသည်...`;
    }

    try {
        if (editId) {
            await api.put(`/purchases/${editId}`, payload);
            alert("အဝယ်စာရင်း ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            await api.post("/purchases", payload);
            alert("အဝယ်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
        }
        document.getElementById("purchase-modal")?.classList.add("hidden");
        await loadMasterProducts();
        await loadPurchases();
    } catch (err) {
        alert("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `အတည်ပြု၍ စာရင်းသွင်းမည်`;
        }
    }
}

async function deletePurchase(id) {
    if (!confirm("ဤအဝယ်စာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?\n(စတော့နှင့် ငွေစာရင်းမှလည်း အလိုအလျောက် ပြန်လည် နုတ်ယူရှင်းလင်းပါမည်)")) return;
    try {
        await api.delete(`/purchases/${id}`);
        await loadPurchases();
        alert("အဝယ်စာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
    } catch (err) {
        alert("ဖျက်၍မရပါ: " + err.message);
    }
}
