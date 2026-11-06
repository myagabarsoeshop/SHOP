// cashbook-frontend/js/modules/purchases.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Standardized UI components (Toast, Confirm, escapeHtml, escapeCsv)
import { setKPI } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let purchasesList = [];
let currentFilteredPurchases = [];
let masterProducts = [];
let selectedOrderItems = [];

// စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Controller
const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderPurchasesTable()
});

/**
 * VR NO အား DDMMYY-01 ပုံစံသို့ စနစ်တကျ ပြောင်းလဲဖော်ပြသည့် Helper
 */
function formatVRNo(pur, index) {
    if (pur.vr_no && /^\d{6}-\d{2,}$/.test(pur.vr_no)) return pur.vr_no;
    
    const d = pur.created_at ? new Date(pur.created_at) : new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    
    // purchase_id သို့မဟုတ် row index ပေါ် မူတည်၍ 2-digit sequence ထုတ်ပေးခြင်း
    const seqNum = pur.purchase_id || pur.id || (index + 1);
    const seq = String(seqNum % 100 || index + 1).padStart(2, "0");
    
    return `${dd}${mm}${yy}-${seq}`;
}

export async function initPurchases() {
    bindEvents();
    await loadMasterProducts();
    await loadPurchases();
}

function bindEvents() {
    // Toolbar Buttons
    document.getElementById("btn-add-purchase")?.addEventListener("click", () => openPurchaseModal());
    document.getElementById("btn-close-purchase-modal")?.addEventListener("click", closePurchaseModal);
    document.getElementById("btn-cancel-purchase")?.addEventListener("click", closePurchaseModal);
    document.getElementById("btn-submit-purchase")?.addEventListener("click", submitPurchase);
    document.getElementById("pur-search")?.addEventListener("input", filterAndRenderPurchases);

    // Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-purchases");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadMasterProducts();
            await loadPurchases();
            setTimeout(() => icon?.classList.remove("fa-spin"), 500);
            ui.toast.info("အဝယ်စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // Export CSV Button
    document.getElementById("btn-export-purchases-csv")?.addEventListener("click", exportPurchasesToCSV);

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

    // Dedicated New Product Sub-Modal Events
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
            catSelect.innerHTML += `<option value="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</option>`;
        });
    }

    if (datalist) {
        datalist.innerHTML = "";
        categories.forEach(c => {
            datalist.innerHTML += `<option value="${ui.escapeHtml(c)}">`;
        });
    }
}

async function loadPurchases() {
    const tbody = document.getElementById("pur-table-body");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="15" class="p-16 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl mb-3 text-emerald-500"></i>
                    <div class="font-bold text-xs">အဝယ်စာရင်းများ ဆွဲယူနေပါသည်...</div>
                </td>
            </tr>
        `;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/purchases", { branch_id: branchId });
        purchasesList = res.data || [];
        currentFilteredPurchases = [...purchasesList];

        // ၄-KPI Boxes တန်ဖိုးများ တွက်ချက်ခြင်း
        const uniqueOrders = new Set(purchasesList.map(p => p.purchase_id || p.id)).size;
        const totalItemsQty = purchasesList.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
        
        let cashPurchasesTotal = 0;
        let creditPurchasesTotal = 0;

        purchasesList.forEach(p => {
            const lineAmt = Number(p.subtotal || (Number(p.quantity || 0) * Number(p.unit_cost || 0)));
            const method = String(p.payment_method || "cash").toLowerCase();
            if (method === "credit") {
                creditPurchasesTotal += lineAmt;
            } else {
                cashPurchasesTotal += lineAmt;
            }
        });

        // Standard 4-KPI Boxes (Total Purchases, Purchase Items, Cash Purchases, Credit Purchases)
        setKPI(1, "Total Purchases", uniqueOrders, "fa-file-invoice-dollar", "blue");
        setKPI(2, "Purchase Items", totalItemsQty, "fa-boxes-stacked", "emerald");
        setKPI(3, "Cash Purchases", cashPurchasesTotal, "fa-money-bill-wave", "purple");
        setKPI(4, "Credit Purchases", creditPurchasesTotal, "fa-hand-holding-dollar", "amber");

        pagination.reset();
        renderPurchasesTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="15" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function filterAndRenderPurchases() {
    const kw = (document.getElementById("pur-search")?.value || "").trim().toLowerCase();

    currentFilteredPurchases = purchasesList.filter(p => {
        if (!kw) return true;
        const hay = `${p.purchase_no || ""} ${p.sku || ""} ${p.barcode || ""} ${p.item_name || ""} ${p.category || ""} ${p.color || ""} ${p.supplier_name || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderPurchasesTable();
}

/**
 * Purchases History Table Rendering (Compact One-Line View: h-12 whitespace-nowrap)
 */
function renderPurchasesTable() {
    const tbody = document.getElementById("pur-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredPurchases.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="15" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-cart-flatbed text-3xl mb-3 opacity-30"></i>
                    <div>အဝယ်စာရင်း မှတ်တမ်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("purchases-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredPurchases);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((pur, idx) => {
        const dateStr = pur.created_at ? new Date(pur.created_at).toLocaleDateString("en-GB") : "-";
        const vrNo = formatVRNo(pur, startIdx + idx);
        const barcodeStr = pur.barcode || pur.sku || "-";

        // Method: CASH သို့မဟုတ် BANK
        const rawMethod = String(pur.payment_method || "cash").toLowerCase();
        let methodStr = "CASH";
        if (rawMethod === "bank") {
            methodStr = "BANK";
        } else if (rawMethod === "credit") {
            methodStr = "-";
        }

        // Type: လက်ငင်းဝယ်ယူမှု (CASH) သို့မဟုတ် အကြွေးဝယ်ယူမှု (CREDIT)
        const isCredit = rawMethod === "credit";
        const typeStr = isCredit ? "CREDIT" : "CASH";

        const unitCost = Number(pur.unit_cost || 0);
        const qty = Number(pur.quantity || 0);
        const amount = Number(pur.subtotal || (unitCost * qty));
        const wholesalePrice = Number(pur.wholesale_price || 0);
        const retailPrice = Number(pur.retail_price || 0);

        // Action Buttons: Dark Mode တွင် ပီပြင်သော Square Box Buttons (w-7 h-7)
        const actionButtons = `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${pur.purchase_id || pur.id}" title="ပြင်ဆင်မည်" 
                    class="btn-edit-pur w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${pur.purchase_id || pur.id}" title="ဖျက်သိမ်းပြီး စတော့ပြန်ညှိမည်" 
                    class="btn-delete-pur w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        `;

        // Row Height ကို Customers & Debt အတိုင်း h-12 ထားရှိပြီး စာလုံးအရွယ်အစားများ ညှိထားခြင်း
        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-12 whitespace-nowrap border-b border-slate-100 dark:border-slate-800/60";
        row.innerHTML = `
            <!-- 1. NO: text-xs -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. DATE: text-xs -->
            <td class="py-2 px-3 text-left font-mono text-xs font-medium text-slate-600 dark:text-slate-300 w-28">${dateStr}</td>
            
            <!-- 3. VR NO: text-xs font-bold -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-blue-600 dark:text-blue-400 w-28">${vrNo}</td>
            
            <!-- 4. BARCODE: text-xs -->
            <td class="py-2 px-3 text-left font-mono text-xs text-slate-600 dark:text-slate-400 w-28 truncate" title="${ui.escapeHtml(barcodeStr)}">${ui.escapeHtml(barcodeStr)}</td>
            
            <!-- 5. CATEGORY: မြန်မာစာ text-base font-semibold (Customers စံနှုန်း) -->
            <td class="py-2 px-4 text-left text-base font-semibold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${ui.escapeHtml(pur.category || "-")}">${ui.escapeHtml(pur.category || "-")}</td>
            
            <!-- 6. ITEM NAME: မြန်မာစာ text-base font-bold (Customers စံနှုန်း) -->
            <td class="py-2 px-4 text-left text-base font-bold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${ui.escapeHtml(pur.item_name || "-")}">${ui.escapeHtml(pur.item_name || "-")}</td>
            
            <!-- 7. COLOR: မြန်မာစာ text-base font-medium (Customers စံနှုန်း) -->
            <td class="py-2 px-3 text-left text-base font-medium text-slate-600 dark:text-slate-400 w-24 truncate" title="${ui.escapeHtml(pur.color || "-")}">${ui.escapeHtml(pur.color || "-")}</td>
            
            <!-- 8. UNIT PRICE: text-base font-mono (Customers စံနှုန်း) -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-slate-700 dark:text-slate-300 w-28">${unitCost.toLocaleString()}</td>
            
            <!-- 9. AMOUNT: text-base font-mono font-black (Customers စံနှုန်း) -->
            <td class="py-2 px-4 text-right font-mono text-base font-black text-rose-600 dark:text-rose-400 w-32">${amount.toLocaleString()}</td>
            
            <!-- 10. METHOD: text-xs font-mono -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-24">${methodStr}</td>
            
            <!-- 11. TYPE: text-xs font-mono -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold w-24 ${isCredit ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}">${typeStr}</td>
            
            <!-- 12. WHOLESALE: text-base font-mono font-bold -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-blue-600 dark:text-blue-400 w-28">${wholesalePrice.toLocaleString()}</td>
            
            <!-- 13. RETAIL: text-base font-mono font-bold -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 w-28">${retailPrice.toLocaleString()}</td>
            
            <!-- 14. SUPPLIER: မြန်မာစာ text-base font-semibold (Customers စံနှုန်း) -->
            <td class="py-2 px-4 text-left text-base font-semibold text-slate-800 dark:text-slate-200 min-w-[160px] truncate" title="${ui.escapeHtml(pur.supplier_name || "-")}">${ui.escapeHtml(pur.supplier_name || "-")}</td>
            
            <!-- 15. ACTION (Sticky Right) -->
            <td class="py-2 px-3 text-center sticky right-0 bg-white dark:bg-[#151e32] z-10 shadow-[-4px_0_8px_rgba(0,0,0,0.06)] w-24">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(row);
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

function openPurchaseModal(pur = null) {
    const modal = document.getElementById("purchase-modal");
    const editIdInput = document.getElementById("pur-edit-id");
    const title = document.getElementById("purchase-modal-title");

    if (pur) {
        title.innerHTML = `<span>အဝယ်စာရင်း ပြင်ဆင်ခြင်း</span> <span class="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-mono">Edit Order</span>`;
        editIdInput.value = pur.purchase_id || pur.id;
        document.getElementById("pur-supplier").value = pur.supplier_name || "";
        document.getElementById("pur-payment-method").value = pur.payment_method || "cash";
        document.getElementById("pur-bank-name").value = pur.bank_account_name || "";
        if (pur.payment_method === "bank") {
            document.getElementById("pur-bank-container")?.classList.remove("hidden");
        } else {
            document.getElementById("pur-bank-container")?.classList.add("hidden");
        }
        if (pur.created_at) {
            document.getElementById("pur-date").value = pur.created_at.split("T")[0];
        }

        selectedOrderItems = purchasesList
            .filter(p => (p.purchase_id || p.id) == (pur.purchase_id || pur.id))
            .map(p => ({
                is_new: false,
                product_id: p.product_id,
                item_name: p.item_name,
                sku: p.sku,
                category: p.category,
                pattern: p.pattern || "",
                color: p.color || "",
                size: p.size || "ထည်",
                quantity: Number(p.quantity || 1),
                unit_cost: Number(p.unit_cost || 0),
                retail_price: Number(p.retail_price || 0),
                wholesale_price: Number(p.wholesale_price || 0),
                retail_margin_pct: p.unit_cost > 0 && p.retail_price > p.unit_cost ? Math.round(((p.retail_price - p.unit_cost) / p.unit_cost) * 100) : 0,
                wholesale_margin_pct: p.unit_cost > 0 && p.wholesale_price > p.unit_cost ? Math.round(((p.wholesale_price - p.unit_cost) / p.unit_cost) * 100) : 0,
                subtotal: Number(p.subtotal || (p.quantity * p.unit_cost))
            }));

    } else {
        title.innerHTML = `<span>ကုန်ပစ္စည်းအဝယ်နှင့် စတော့အဝင် မှတ်တမ်းသွင်းခြင်း</span> <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">Purchase Order</span>`;
        editIdInput.value = "";
        document.getElementById("pur-supplier").value = "";
        document.getElementById("pur-payment-method").value = "cash";
        document.getElementById("pur-bank-name").value = "";
        document.getElementById("pur-bank-container")?.classList.add("hidden");

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        document.getElementById("pur-date").value = todayStr;

        selectedOrderItems = [];
    }

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
                <button type="button" id="btn-quick-create-from-search" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer active:scale-95">
                    + "${ui.escapeHtml(kw)}" ဖြင့် အသစ်မှတ်ပုံတင်မည်
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
                        ${ui.escapeHtml((p.category || "Item").slice(0, 2))}
                    </div>
                    <div>
                        <div class="font-extrabold text-slate-900 dark:text-white text-xs">${ui.escapeHtml(p.item_name)}</div>
                        <div class="text-[11px] text-slate-400 font-mono">
                            ${ui.escapeHtml(p.sku || "-")} • <span class="text-emerald-500 font-bold">${ui.escapeHtml(p.category || "-")}</span> ${p.color ? `• ${ui.escapeHtml(p.color)}` : ''}
                        </div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs">ဝယ်ရင်း: ${Number(p.cost_price || 0).toLocaleString()} Ks</div>
                    <div class="text-[10px] text-slate-400">လက်ရှိစတော့: ${Number(p.current_stock || 0).toLocaleString()} ${ui.escapeHtml(p.size || 'ထည်')}</div>
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
        tr.className = "pur-row-item hover:bg-slate-50 dark:hover:bg-slate-900/60 transition";
        tr.dataset.idx = index;

        tr.innerHTML = `
            <td class="p-3.5 text-center text-slate-400 font-mono">${index + 1}</td>
            <td class="p-3.5">
                <div class="font-extrabold text-slate-900 dark:text-white text-xs">${ui.escapeHtml(item.item_name)}</div>
                <div class="text-[11px] text-slate-400 font-mono">
                    ${ui.escapeHtml(item.sku || "-")} • <span class="text-emerald-500 font-bold">${ui.escapeHtml(item.category || "-")}</span>
                    ${item.color ? `• ${ui.escapeHtml(item.color)}` : ''} (${ui.escapeHtml(item.size || 'ထည်')})
                </div>
            </td>
            <td class="p-3.5 text-center">
                <input type="number" min="0.1" step="any" value="${item.quantity}" data-idx="${index}"
                    class="item-qty w-20 h-9 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 text-center text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
            </td>
            <td class="p-3.5 text-right">
                <input type="number" min="0" step="any" value="${item.unit_cost}" data-idx="${index}"
                    class="item-cost w-28 h-9 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 text-right text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
            </td>
            <td class="p-3.5 text-right space-y-1">
                <input type="number" min="0" step="any" value="${item.retail_price}" data-idx="${index}"
                    class="item-retail w-32 h-8 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 text-right text-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                <div class="flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span>Margin %:</span>
                    <input type="number" value="${item.retail_margin_pct || ''}" placeholder="0" data-idx="${index}"
                        class="item-retail-pct w-12 h-6 text-[10px] font-mono text-center bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded px-1">
                </div>
            </td>
            <td class="p-3.5 text-right space-y-1">
                <input type="number" min="0" step="any" value="${item.wholesale_price}" data-idx="${index}"
                    class="item-wholesale w-32 h-8 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 text-right text-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <div class="flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span>Margin %:</span>
                    <input type="number" value="${item.wholesale_margin_pct || ''}" placeholder="0" data-idx="${index}"
                        class="item-wholesale-pct w-12 h-6 text-[10px] font-mono text-center bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded px-1">
                </div>
            </td>
            <td class="p-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm line-subtotal">
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

    attachRowEvents();
    updateOrderSummary();
}

function attachRowEvents() {
    const tbody = document.getElementById("pur-items-container");
    if (!tbody) return;

    tbody.querySelectorAll(".item-qty").forEach(input => {
        input.oninput = (e) => {
            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const qty = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].quantity = qty;
            selectedOrderItems[idx].subtotal = qty * selectedOrderItems[idx].unit_cost;

            tr.querySelector(".line-subtotal").textContent = Number(selectedOrderItems[idx].subtotal).toLocaleString();
            updateOrderSummary();
        };
    });

    tbody.querySelectorAll(".item-cost").forEach(input => {
        input.oninput = (e) => {
            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const cost = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].unit_cost = cost;

            if (selectedOrderItems[idx].retail_margin_pct > 0) {
                const newRetail = Math.round(cost * (1 + selectedOrderItems[idx].retail_margin_pct / 100));
                selectedOrderItems[idx].retail_price = newRetail;
                tr.querySelector(".item-retail").value = newRetail;
            }
            if (selectedOrderItems[idx].wholesale_margin_pct > 0) {
                const newWholesale = Math.round(cost * (1 + selectedOrderItems[idx].wholesale_margin_pct / 100));
                selectedOrderItems[idx].wholesale_price = newWholesale;
                tr.querySelector(".item-wholesale").value = newWholesale;
            }

            selectedOrderItems[idx].subtotal = selectedOrderItems[idx].quantity * cost;
            tr.querySelector(".line-subtotal").textContent = Number(selectedOrderItems[idx].subtotal).toLocaleString();
            updateOrderSummary();
        };
    });

    tbody.querySelectorAll(".item-retail").forEach(input => {
        input.oninput = (e) => {
            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const retail = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].retail_price = retail;
            const cost = selectedOrderItems[idx].unit_cost;
            if (cost > 0 && retail > cost) {
                const pct = Math.round(((retail - cost) / cost) * 100);
                selectedOrderItems[idx].retail_margin_pct = pct;
                tr.querySelector(".item-retail-pct").value = pct;
            }
        };
    });

    tbody.querySelectorAll(".item-retail-pct").forEach(input => {
        input.oninput = (e) => {
            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const pct = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].retail_margin_pct = pct;
            const newRetail = Math.round(selectedOrderItems[idx].unit_cost * (1 + pct / 100));
            selectedOrderItems[idx].retail_price = newRetail;
            tr.querySelector(".item-retail").value = newRetail;
        };
    });

    tbody.querySelectorAll(".item-wholesale").forEach(input => {
        input.oninput = (e) => {
            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const wholesale = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].wholesale_price = wholesale;
            const cost = selectedOrderItems[idx].unit_cost;
            if (cost > 0 && wholesale > cost) {
                const pct = Math.round(((wholesale - cost) / cost) * 100);
                selectedOrderItems[idx].wholesale_margin_pct = pct;
                tr.querySelector(".item-wholesale-pct").value = pct;
            }
        };
    });

    tbody.querySelectorAll(".item-wholesale-pct").forEach(input => {
        input.oninput = (e) => {
            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const pct = parseFloat(e.target.value) || 0;
            selectedOrderItems[idx].wholesale_margin_pct = pct;
            const newWholesale = Math.round(selectedOrderItems[idx].unit_cost * (1 + pct / 100));
            selectedOrderItems[idx].wholesale_price = newWholesale;
            tr.querySelector(".item-wholesale").value = newWholesale;
        };
    });

    tbody.querySelectorAll(".btn-remove-item").forEach(btn => {
        btn.onclick = (e) => {
            const idx = Number(e.currentTarget.dataset.idx);
            selectedOrderItems.splice(idx, 1);
            renderOrderItemsTable();
        };
    });
}

function updateOrderSummary() {
    const totalQty = selectedOrderItems.reduce((acc, it) => acc + Number(it.quantity || 0), 0);
    const grandTotal = selectedOrderItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

    const qtyEl = document.getElementById("pur-total-qty");
    const totalEl = document.getElementById("pur-grand-total");

    if (qtyEl) qtyEl.textContent = totalQty.toLocaleString();
    if (totalEl) totalEl.textContent = `${grandTotal.toLocaleString()} Ks`;
}

// --- Dedicated Create Product Sub-Modal Logic ---
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

    if (!cat || !name) {
        return ui.toast.warning("အမျိုးအစားနှင့် အထည်အမည် ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

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
    const editId = document.getElementById("pur-edit-id")?.value;

    if (!supplier) {
        ui.toast.warning("ပေးသွင်းသူ (ပွဲရုံ) အမည် ထည့်သွင်းပေးပါ။");
        document.getElementById("pur-supplier")?.focus();
        return;
    }

    if (paymentMethod === "bank" && !bankName) {
        ui.toast.warning("ဘဏ်လွှဲဖြစ်ပါက ဘဏ်အမည် သို့မဟုတ် အကောင့်အမည် ထည့်သွင်းပေးပါ။");
        document.getElementById("pur-bank-name")?.focus();
        return;
    }

    if (selectedOrderItems.length === 0) {
        ui.toast.warning("ကျေးဇူးပြု၍ ဝယ်ယူမည့် ပစ္စည်း အနည်းဆုံး (၁) မျိုး ရွေးချယ်ပေးပါ။");
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
        if (editId) {
            await api.put(`/purchases/${editId}`, payload);
            ui.toast.success("အဝယ်စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            const res = await api.post("/purchases", payload);
            ui.toast.success(`အဝယ်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။ (VR: ${res.data?.purchaseNo || 'OK'})`);
        }
        closePurchaseModal();
        await loadMasterProducts();
        await loadPurchases();
    } catch (err) {
        ui.toast.error("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check mr-1"></i> <span>အတည်ပြု၍ စာရင်းသွင်းမည်</span>`;
        }
    }
}

async function deletePurchase(id) {
    const confirmed = await ui.confirm("ဤအဝယ်စာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?\n(စတော့ထဲမှ ပစ္စည်းအရေအတွက်များ ပြန်နုတ်ပြီး ငွေစာရင်းမှလည်း ပြန်နုတ်ပေးပါမည်)", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/purchases/${id}`);
        ui.toast.success("အဝယ်စာရင်း ပယ်ဖျက်ပြီး စတော့နှင့် ငွေစာရင်း ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await loadPurchases();
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

/**
 * Purchases စာရင်းအား UI Table Columns အတိုင်း CSV Export ထုတ်ယူပေးသည့် Function
 */
function exportPurchasesToCSV() {
    const listToExport = currentFilteredPurchases.length > 0 ? currentFilteredPurchases : purchasesList;

    if (listToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် အဝယ်စာရင်း မရှိသေးပါ။");
    }

    let csvContent = "NO,DATE,VR NO,BARCODE,CATEGORY,ITEM NAME,COLOR,UNIT PRICE,AMOUNT,METHOD,TYPE,WHOLESALE,RETAIL,SUPPLIER\n";

    listToExport.forEach((pur, idx) => {
        const no = idx + 1;
        const dateStr = pur.created_at ? new Date(pur.created_at).toLocaleDateString("en-GB") : "-";
        const vrNo = formatVRNo(pur, idx);
        const barcodeStr = pur.barcode || pur.sku || "-";
        const categoryStr = pur.category || "-";
        const itemName = pur.item_name || "-";
        const color = pur.color || "-";
        const unitCost = Number(pur.unit_cost || 0);
        const amount = Number(pur.subtotal || (unitCost * Number(pur.quantity || 0)));

        const rawMethod = String(pur.payment_method || "cash").toLowerCase();
        let methodStr = "CASH";
        if (rawMethod === "bank") methodStr = "BANK";
        else if (rawMethod === "credit") methodStr = "-";

        const typeStr = rawMethod === "credit" ? "CREDIT" : "CASH";
        const wholesalePrice = Number(pur.wholesale_price || 0);
        const retailPrice = Number(pur.retail_price || 0);
        const supplierName = pur.supplier_name || "-";

        const row = [
            no,
            ui.escapeCsv(dateStr),
            ui.escapeCsv(vrNo),
            ui.escapeCsv(barcodeStr),
            ui.escapeCsv(categoryStr),
            ui.escapeCsv(itemName),
            ui.escapeCsv(color),
            unitCost,
            amount,
            ui.escapeCsv(methodStr),
            ui.escapeCsv(typeStr),
            wholesalePrice,
            retailPrice,
            ui.escapeCsv(supplierName)
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Purchases_Summary_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
