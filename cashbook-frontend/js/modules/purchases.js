// cashbook-frontend/js/modules/purchases.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let purchasesList = [];
let currentFilteredPurchases = [];
let masterProducts = [];
let supplierList = [];
let selectedOrderItems = [];
let outsideClickBound = false;

// စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Controller
const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderPurchasesTable()
});

/**
 * မြန်မာဂဏန်း (၀-၉) မှ အင်္ဂလိပ်ဂဏန်း (0-9) သို့ အလိုအလျောက် ပြောင်းပေးသည့် Helper
 */
function normalizeDigits(val) {
    if (!val && val !== 0) return "";
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let cleanStr = String(val).replace(/,/g, "").trim();
    myanmarDigits.forEach((d, idx) => {
        cleanStr = cleanStr.replaceAll(d, String(idx));
    });
    return cleanStr;
}

function parseAnyNumber(val, isInteger = true) {
    const clean = normalizeDigits(val);
    const num = parseFloat(clean);
    if (isNaN(num)) return 0;
    return isInteger ? Math.round(num) : Math.round(num * 1000) / 1000;
}

/**
 * VR NO အား DDMMYY-01 ပုံစံသို့ စနစ်တကျ ပြောင်းလဲဖော်ပြသည့် Helper
 */
function formatVRNo(pur, index) {
    if (pur.vr_no && /^\d{6}-\d{2,}$/.test(pur.vr_no)) return pur.vr_no;
    if (pur.purchase_no && /^\d{6}-\d{2,}$/.test(pur.purchase_no)) return pur.purchase_no;
    
    const d = pur.created_at ? new Date(pur.created_at) : new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    
    const seqNum = pur.purchase_id || pur.id || (index + 1);
    const seq = String(seqNum % 100 || index + 1).padStart(2, "0");
    
    return `${dd}${mm}${yy}-${seq}`;
}

export async function initPurchases() {
    bindEvents();
    await Promise.all([
        loadMasterProducts(),
        loadSuppliers(),
        loadPurchases()
    ]);
}

function bindEvents() {
    // Toolbar Buttons & Filters
    document.getElementById("btn-add-purchase")?.addEventListener("click", () => openPurchaseModal());
    document.getElementById("btn-close-purchase-modal")?.addEventListener("click", closePurchaseModal);
    document.getElementById("btn-cancel-purchase")?.addEventListener("click", closePurchaseModal);
    document.getElementById("btn-submit-purchase")?.addEventListener("click", submitPurchase);
    document.getElementById("pur-search")?.addEventListener("input", filterAndRenderPurchases);
    document.getElementById("pur-category-filter")?.addEventListener("change", filterAndRenderPurchases);

    // Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-purchases");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await Promise.all([
                loadMasterProducts(),
                loadSuppliers(),
                loadPurchases()
            ]);
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
            ui.toast.info("အဝယ်စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // Export CSV Button
    document.getElementById("btn-export-purchases-csv")?.addEventListener("click", exportPurchasesToCSV);

    // Payment Method Change (Dynamic 4-Col vs 5-Col Grid)
    document.getElementById("pur-payment-method")?.addEventListener("change", (e) => {
        const bankContainer = document.getElementById("pur-bank-container");
        const infoGrid = document.getElementById("pur-info-grid");
        const paidInput = document.getElementById("pur-actual-paid");

        if (e.target.value === "bank") {
            bankContainer?.classList.remove("hidden");
            infoGrid?.classList.remove("md:grid-cols-4");
            infoGrid?.classList.add("md:grid-cols-5");
            document.getElementById("pur-bank-name")?.focus();
        } else {
            bankContainer?.classList.add("hidden");
            infoGrid?.classList.remove("md:grid-cols-5");
            infoGrid?.classList.add("md:grid-cols-4");
            const bankInput = document.getElementById("pur-bank-name");
            if (bankInput) bankInput.value = "";
        }

        if (e.target.value === "credit" && paidInput) {
            paidInput.value = "0";
            updateDifference();
        }
    });

    // Actual Paid Input Event
    const paidInput = document.getElementById("pur-actual-paid");
    if (paidInput) {
        paidInput.addEventListener("input", (e) => {
            const normalized = normalizeDigits(e.target.value);
            if (e.target.value !== normalized) {
                e.target.value = normalized;
            }
            updateDifference();
        });
    }

    // Quick Search Input Events (With Barcode Scanner Enter Key Auto-Add)
    const searchInput = document.getElementById("pur-quick-search-input");
    const catFilter = document.getElementById("pur-quick-cat-filter");
    const clearBtn = document.getElementById("btn-clear-quick-search");

    searchInput?.addEventListener("input", (e) => {
        if (e.target.value) clearBtn?.classList.remove("hidden");
        else clearBtn?.classList.add("hidden");
        renderQuickSuggestions();
    });
    searchInput?.addEventListener("focus", renderQuickSuggestions);
    searchInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const kw = searchInput.value.trim().toLowerCase();
            if (!kw) return;
            const exact = masterProducts.find(p =>
                (p.barcode && String(p.barcode).toLowerCase() === kw) ||
                (p.sku && String(p.sku).toLowerCase() === kw)
            );
            if (exact) {
                addOrderItem(exact);
                searchInput.value = "";
                clearBtn?.classList.add("hidden");
                document.getElementById("pur-quick-suggestions")?.classList.add("hidden");
            }
        }
    });
    catFilter?.addEventListener("change", renderQuickSuggestions);

    clearBtn?.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        clearBtn.classList.add("hidden");
        renderQuickSuggestions();
        searchInput?.focus();
    });

    // Close Dropdown on outside click (Bound only once globally)
    if (!outsideClickBound) {
        document.addEventListener("click", (e) => {
            if (!e.target.closest("#pur-quick-suggestions") && !e.target.closest("#pur-quick-search-input") && !e.target.closest("#pur-quick-cat-filter")) {
                document.getElementById("pur-quick-suggestions")?.classList.add("hidden");
            }
        });
        outsideClickBound = true;
    }

    // Dedicated New Product Sub-Modal Events
    document.getElementById("btn-open-create-prod-modal")?.addEventListener("click", () => openNewProductModal());
    document.getElementById("btn-close-new-prod-modal")?.addEventListener("click", () => {
        document.getElementById("new-prod-modal")?.classList.add("hidden");
    });
    document.getElementById("new-prod-form")?.addEventListener("submit", submitNewProductSubModal);
    document.getElementById("sub-cat")?.addEventListener("input", (e) => {
        const skuEl = document.getElementById("sub-sku");
        if (skuEl) skuEl.value = generateAutoSKU(e.target.value.trim());
    });

    // Dedicated Quick New Supplier Sub-Modal Events
    document.getElementById("btn-open-new-supplier-modal")?.addEventListener("click", () => {
        document.getElementById("quick-supplier-form")?.reset();
        const typedVal = document.getElementById("pur-supplier")?.value.trim() || "";
        const nameInput = document.getElementById("quick-supp-name");
        if (nameInput && typedVal) nameInput.value = typedVal;

        document.getElementById("quick-supplier-modal")?.classList.remove("hidden");
        setTimeout(() => nameInput?.focus(), 50);
    });

    document.getElementById("btn-close-quick-supp-modal")?.addEventListener("click", () => {
        document.getElementById("quick-supplier-modal")?.classList.add("hidden");
    });

    document.getElementById("quick-supplier-form")?.addEventListener("submit", submitQuickSupplierForm);
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

async function loadSuppliers() {
    try {
        const res = await api.get("/customers");
        const list = res.data || [];
        supplierList = [...new Set(list.map(c => (c.name || c.shop_name || "").trim()).filter(Boolean))];
        
        const datalist = document.getElementById("pur-supplier-datalist");
        if (datalist) {
            datalist.innerHTML = "";
            supplierList.forEach(name => {
                datalist.innerHTML += `<option value="${ui.escapeHtml(name)}">`;
            });
        }
    } catch (err) {
        console.error("Suppliers စာရင်း ရယူ၍ မရပါ:", err);
    }
}

async function submitQuickSupplierForm(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-quick-supp");
    const name = document.getElementById("quick-supp-name")?.value.trim();
    const phone = document.getElementById("quick-supp-phone")?.value.trim() || null;
    const shop = document.getElementById("quick-supp-shop")?.value.trim() || null;
    const address = document.getElementById("quick-supp-address")?.value.trim() || null;

    if (!name) return ui.toast.warning("ပွဲရုံအမည် ထည့်သွင်းပေးပါ။");

    if (btn) btn.disabled = true;

    try {
        await api.post("/customers", {
            name,
            phone,
            shopName: shop,
            address,
            entityType: "SUPPLIER",
            customerType: "wholesale",
            initialDebt: 0,
            initialPayable: 0
        });

        ui.toast.success(`ပွဲရုံ "${name}" အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။`);
        
        document.getElementById("quick-supplier-modal")?.classList.add("hidden");
        const suppInput = document.getElementById("pur-supplier");
        if (suppInput) suppInput.value = name;

        await loadSuppliers();
    } catch (err) {
        ui.toast.error("ပွဲရုံမှတ်ပုံတင်၍ မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function populateCategoryFilters() {
    const categories = [...new Set(masterProducts.map(p => (p.category || "").trim()).filter(Boolean))];
    const mainCatSelect = document.getElementById("pur-category-filter");
    const quickCatSelect = document.getElementById("pur-quick-cat-filter");
    const datalist = document.getElementById("sub-cat-datalist");

    if (mainCatSelect) {
        const prev = mainCatSelect.value;
        mainCatSelect.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${categories.length})</option>`;
        categories.forEach(c => {
            mainCatSelect.innerHTML += `<option value="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</option>`;
        });
        if (categories.includes(prev)) mainCatSelect.value = prev;
    }

    if (quickCatSelect) {
        quickCatSelect.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${categories.length})</option>`;
        categories.forEach(c => {
            quickCatSelect.innerHTML += `<option value="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</option>`;
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
                <td colspan="18" class="p-16 text-center text-slate-400">
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

        const uniqueOrders = new Set(purchasesList.map(p => p.purchase_id || p.id)).size;
        const totalItemsQty = purchasesList.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
        
        let cashPurchasesTotal = 0;
        let creditPurchasesTotal = 0;

        purchasesList.forEach(p => {
            const lineAmt = Number(p.subtotal || Math.round(Number(p.quantity || 0) * Number(p.unit_cost || 0)));
            const method = String(p.payment_method || "cash").toLowerCase();
            const paidAmt = Number(p.paid_amount !== undefined ? p.paid_amount : p.total_amount);

            if (method === "credit" || paidAmt === 0) {
                creditPurchasesTotal += lineAmt;
            } else {
                cashPurchasesTotal += lineAmt;
            }
        });

        setKPI(1, "Total Purchases", uniqueOrders, "fa-file-invoice-dollar", "blue");
        setKPI(2, "Purchase Items", totalItemsQty, "fa-boxes-stacked", "emerald");
        setKPI(3, "Cash Purchases", cashPurchasesTotal, "fa-money-bill-wave", "purple");
        setKPI(4, "Credit Purchases", creditPurchasesTotal, "fa-hand-holding-dollar", "amber");

        filterAndRenderPurchases();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="18" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function filterAndRenderPurchases() {
    const cat = document.getElementById("pur-category-filter")?.value || "";
    const kw = (document.getElementById("pur-search")?.value || "").trim().toLowerCase();

    currentFilteredPurchases = purchasesList.filter(p => {
        if (cat && p.category !== cat) return false;
        if (!kw) return true;
        const hay = `${p.purchase_no || ""} ${p.ref_no || ""} ${p.sku || ""} ${p.barcode || ""} ${p.item_name || ""} ${p.category || ""} ${p.color || ""} ${p.supplier_name || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderPurchasesTable();
}

/**
 * Purchases History Table Rendering (QTY အပါအဝင် ၁၈ ကော်လံစနစ်)
 */
function renderPurchasesTable() {
    const tbody = document.getElementById("pur-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredPurchases.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="18" class="p-16 text-center text-slate-400 text-xs font-bold">
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
        const rawDate = pur.purchase_date || (pur.created_at ? pur.created_at.split("T")[0] : "");
        const dateStr = rawDate ? new Date(rawDate).toLocaleDateString("en-GB") : "-";
        const vrNo = formatVRNo(pur, startIdx + idx);
        const barcodeStr = pur.barcode || pur.sku || "-";
        const refNo = pur.ref_no || "-";

        const rawMethod = String(pur.payment_method || "cash").toLowerCase();
        const paidAmount = Number(pur.paid_amount !== undefined ? pur.paid_amount : pur.total_amount);
        const totalAmount = Number(pur.items_total || pur.total_amount || 0);

        let methodStr = "-";
        if (paidAmount > 0) {
            methodStr = rawMethod === "bank" ? "BANK" : "CASH";
        }

        let typeStr = "PAID";
        let typeColorClass = "text-emerald-600 dark:text-emerald-400";
        if (paidAmount === 0 || rawMethod === "credit") {
            typeStr = "CREDIT";
            typeColorClass = "text-rose-500";
        } else if (paidAmount > 0 && paidAmount < totalAmount) {
            typeStr = "PARTIAL";
            typeColorClass = "text-amber-500";
        }

        const unitCost = Number(pur.unit_cost || 0);
        const qty = Number(pur.quantity || 0);
        const amount = Number(pur.subtotal || Math.round(unitCost * qty));
        const wholesalePrice = Number(pur.wholesale_price || 0);
        const retailPrice = Number(pur.retail_price || 0);

        const diff = Number(pur.diff_amount || 0);
        let diffBadge = `<span class="text-slate-400 font-mono text-xs">-</span>`;
        if (diff > 0) {
            diffBadge = `<span class="text-amber-500 font-mono font-bold text-xs" title="ပွဲရုံထံ ပိုပေးငွေ / ပြန်ရရန်">+${diff.toLocaleString()}</span>`;
        } else if (diff < 0) {
            diffBadge = `<span class="text-rose-500 font-mono font-bold text-xs" title="ပေးရန်ကျန် အကြွေး">${diff.toLocaleString()}</span>`;
        }

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

        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";
        row.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. DATE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 w-28">${dateStr}</td>
            
            <!-- 3. VR NO -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-blue-600 dark:text-blue-400 w-28">${vrNo}</td>
            
            <!-- 4. BARCODE -->
            <td class="py-2 px-3 text-left font-mono text-xs text-slate-600 dark:text-slate-400 w-28 truncate" title="${ui.escapeHtml(barcodeStr)}">${ui.escapeHtml(barcodeStr)}</td>
            
            <!-- 5. CATEGORY -->
            <td class="py-2 px-4 text-left text-xs font-bold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${ui.escapeHtml(pur.category || "-")}">${ui.escapeHtml(pur.category || "-")}</td>
            
            <!-- 6. ITEM NAME -->
            <td class="py-2 px-4 text-left text-xs font-extrabold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${ui.escapeHtml(pur.item_name || "-")}">${ui.escapeHtml(pur.item_name || "-")}</td>
            
            <!-- 7. COLOR -->
            <td class="py-2 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 w-24 truncate" title="${ui.escapeHtml(pur.color || "-")}">${ui.escapeHtml(pur.color || "-")}</td>
            
            <!-- 8. QTY (အသစ်ထည့်သွင်းထားသော အရေအတွက်ကော်လံ) -->
            <td class="py-2 px-3 text-center font-mono text-sm font-black text-blue-600 dark:text-blue-400 w-20">${qty.toLocaleString()}</td>

            <!-- 9. UNIT PRICE -->
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-slate-700 dark:text-slate-300 w-28">${unitCost.toLocaleString()}</td>
            
            <!-- 10. AMOUNT -->
            <td class="py-2 px-4 text-right font-mono text-sm font-black text-rose-600 dark:text-rose-400 w-32">${amount.toLocaleString()}</td>
            
            <!-- 11. METHOD -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${methodStr}</td>
            
            <!-- 12. TYPE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold w-20 ${typeColorClass}">${typeStr}</td>
            
            <!-- 13. WHOLESALE -->
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-blue-600 dark:text-blue-400 w-28">${wholesalePrice.toLocaleString()}</td>
            
            <!-- 14. RETAIL -->
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 w-28">${retailPrice.toLocaleString()}</td>
            
            <!-- 15. SUPPLIER -->
            <td class="py-2 px-4 text-left text-xs font-bold text-slate-800 dark:text-slate-200 min-w-[160px] truncate" title="${ui.escapeHtml(pur.supplier_name || "-")}">${ui.escapeHtml(pur.supplier_name || "-")}</td>
            
            <!-- 16. REF -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-500 dark:text-slate-400 w-28 truncate" title="${ui.escapeHtml(refNo)}">${ui.escapeHtml(refNo)}</td>

            <!-- 17. SURPLUS & DEFICIT -->
            <td class="py-2 px-3 text-center font-mono text-xs w-28">
                ${diffBadge}
            </td>

            <!-- 18. ACTION (Sticky Right) -->
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-24">
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
    else if (cat.includes("ပိုး")) prefix = "SILK";

    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${rand}`;
}

// =========================================================================
// --- MODAL WORKSPACE LOGIC -----------------------------------------------
// =========================================================================

function openPurchaseModal(pur = null) {
    const modal = document.getElementById("purchase-modal");
    const editIdInput = document.getElementById("pur-edit-id");
    const title = document.getElementById("purchase-modal-title");
    const infoGrid = document.getElementById("pur-info-grid");

    if (pur) {
        title.innerHTML = `<span>အဝယ်စာရင်း ပြင်ဆင်ခြင်း</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-mono">Edit Order</span>`;
        editIdInput.value = pur.purchase_id || pur.id;
        document.getElementById("pur-supplier").value = pur.supplier_name || "";
        document.getElementById("pur-ref-no").value = pur.ref_no || "";
        document.getElementById("pur-payment-method").value = pur.payment_method || "cash";
        document.getElementById("pur-bank-name").value = pur.bank_account_name || "";
        
        if (pur.payment_method === "bank") {
            document.getElementById("pur-bank-container")?.classList.remove("hidden");
            infoGrid?.classList.remove("md:grid-cols-4");
            infoGrid?.classList.add("md:grid-cols-5");
        } else {
            document.getElementById("pur-bank-container")?.classList.add("hidden");
            infoGrid?.classList.remove("md:grid-cols-5");
            infoGrid?.classList.add("md:grid-cols-4");
        }

        const dateVal = pur.purchase_date || (pur.created_at ? pur.created_at.split("T")[0] : getLocalTodayDate());
        document.getElementById("pur-date").value = dateVal;

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
                subtotal: Number(p.subtotal || Math.round(p.quantity * p.unit_cost))
            }));

        const paidAmt = pur.paid_amount !== undefined ? pur.paid_amount : pur.total_amount;
        document.getElementById("pur-actual-paid").value = paidAmt;

    } else {
        title.innerHTML = `<span>ကုန်ပစ္စည်းအဝယ်နှင့် စတော့အဝင် မှတ်တမ်းသွင်းခြင်း</span> <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">Purchase Order</span>`;
        editIdInput.value = "";
        document.getElementById("pur-supplier").value = "";
        document.getElementById("pur-ref-no").value = "";
        document.getElementById("pur-payment-method").value = "cash";
        document.getElementById("pur-bank-name").value = "";
        document.getElementById("pur-bank-container")?.classList.add("hidden");
        infoGrid?.classList.remove("md:grid-cols-5");
        infoGrid?.classList.add("md:grid-cols-4");

        document.getElementById("pur-date").value = getLocalTodayDate();

        selectedOrderItems = [];
        document.getElementById("pur-actual-paid").value = "";
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
            card.className = "p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer flex items-center justify-between transition";
            card.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold text-xs shrink-0">
                        ${ui.escapeHtml((p.category || "Item").slice(0, 2))}
                    </div>
                    <div>
                        <div class="font-extrabold text-slate-900 dark:text-white text-xs">${ui.escapeHtml(p.item_name)}</div>
                        <div class="text-[11px] text-slate-400 font-mono">
                            ${ui.escapeHtml(p.sku || "-")} • <span class="text-emerald-500 font-bold">${ui.escapeHtml(p.category || "-")}</span> ${p.color ? `• ${ui.escapeHtml(p.color)}` : ""}
                        </div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs">ဝယ်ရင်း: ${Number(p.cost_price || 0).toLocaleString()} Ks</div>
                    <div class="text-[10px] text-slate-400">လက်ရှိစတော့: ${Number(p.current_stock || 0).toLocaleString()} ${ui.escapeHtml(p.size || "ထည်")}</div>
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
        existing.subtotal = Math.round(existing.quantity * existing.unit_cost);
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

/**
 * Compact One-Line Order Items Table Rendering
 */
function renderOrderItemsTable() {
    const tbody = document.getElementById("pur-items-container");
    const rowCountEl = document.getElementById("pur-row-count");
    if (!tbody) return;

    if (rowCountEl) rowCountEl.textContent = selectedOrderItems.length;

    if (selectedOrderItems.length === 0) {
        tbody.innerHTML = `
            <tr id="pur-empty-row">
                <td colspan="8" class="p-10 text-center text-slate-400 font-bold text-xs">
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
        tr.className = "pur-row-item hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap border-b border-slate-100 dark:border-slate-800/80";
        tr.dataset.idx = index;

        tr.innerHTML = `
            <!-- 1. စဉ် -->
            <td class="py-1 px-2.5 text-center text-slate-400 font-mono text-xs">${index + 1}</td>
            
            <!-- 2. ပစ္စည်းအချက်အလက် -->
            <td class="py-1 px-3">
                <div class="font-extrabold text-slate-900 dark:text-white text-xs truncate max-w-[220px]" title="${ui.escapeHtml(item.item_name)}">${ui.escapeHtml(item.item_name)}</div>
                <div class="text-[10px] text-slate-400 font-mono truncate max-w-[220px]">
                    ${ui.escapeHtml(item.sku || "-")} • <span class="text-emerald-500 font-bold">${ui.escapeHtml(item.category || "-")}</span> ${item.color ? `• ${ui.escapeHtml(item.color)}` : ""} (${ui.escapeHtml(item.size || "ထည်")})
                </div>
            </td>

            <!-- 3. အရေအတွက် -->
            <td class="py-1 px-2 text-center">
                <input type="text" inputmode="numeric" value="${item.quantity}" data-idx="${index}"
                    class="item-qty w-20 h-7 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 text-center text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
            </td>

            <!-- 4. ဝယ်ရင်းဈေး -->
            <td class="py-1 px-2.5 text-right">
                <input type="text" inputmode="numeric" value="${item.unit_cost}" data-idx="${index}"
                    class="item-cost w-24 h-7 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 text-right text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500">
            </td>

            <!-- 5. လက်လီရောင်းဈေး / % -->
            <td class="py-1 px-2.5 text-right">
                <div class="flex items-center justify-end gap-1.5">
                    <input type="text" inputmode="numeric" value="${item.retail_price}" data-idx="${index}" placeholder="ရောင်းဈေး"
                        class="item-retail w-24 h-7 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 text-right text-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                    <div class="flex items-center bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-1.5 h-7">
                        <input type="text" inputmode="numeric" value="${item.retail_margin_pct || ""}" placeholder="0" data-idx="${index}"
                            class="item-retail-pct w-8 text-[11px] font-mono text-right bg-transparent text-slate-700 dark:text-slate-300 focus:outline-none">
                        <span class="text-[10px] text-slate-400 ml-0.5">%</span>
                    </div>
                </div>
            </td>

            <!-- 6. လက်ကားရောင်းဈေး / % -->
            <td class="py-1 px-2.5 text-right">
                <div class="flex items-center justify-end gap-1.5">
                    <input type="text" inputmode="numeric" value="${item.wholesale_price}" data-idx="${index}" placeholder="လက်ကား"
                        class="item-wholesale w-24 h-7 text-xs font-mono font-bold bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2 text-right text-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <div class="flex items-center bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-1.5 h-7">
                        <input type="text" inputmode="numeric" value="${item.wholesale_margin_pct || ""}" placeholder="0" data-idx="${index}"
                            class="item-wholesale-pct w-8 text-[11px] font-mono text-right bg-transparent text-slate-700 dark:text-slate-300 focus:outline-none">
                        <span class="text-[10px] text-slate-400 ml-0.5">%</span>
                    </div>
                </div>
            </td>

            <!-- 7. သင့်ငွေ -->
            <td class="py-1 px-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 text-xs line-subtotal">
                ${Number(item.subtotal || 0).toLocaleString()}
            </td>

            <!-- 8. ဖျက်မည် -->
            <td class="py-1 px-2 text-center">
                <button type="button" data-idx="${index}" class="btn-remove-item text-slate-400 hover:text-rose-500 text-xs transition cursor-pointer p-1" title="စာရင်းမှ ဖယ်ရှားမည်">
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
            const normalized = normalizeDigits(e.target.value);
            if (e.target.value !== normalized) e.target.value = normalized;

            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const qty = parseAnyNumber(e.target.value, false);
            selectedOrderItems[idx].quantity = qty;
            selectedOrderItems[idx].subtotal = Math.round(qty * selectedOrderItems[idx].unit_cost);

            tr.querySelector(".line-subtotal").textContent = Number(selectedOrderItems[idx].subtotal).toLocaleString();
            updateOrderSummary();
        };
    });

    tbody.querySelectorAll(".item-cost").forEach(input => {
        input.oninput = (e) => {
            const normalized = normalizeDigits(e.target.value);
            if (e.target.value !== normalized) e.target.value = normalized;

            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const cost = parseAnyNumber(e.target.value, true);
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

            selectedOrderItems[idx].subtotal = Math.round(selectedOrderItems[idx].quantity * cost);
            tr.querySelector(".line-subtotal").textContent = Number(selectedOrderItems[idx].subtotal).toLocaleString();
            updateOrderSummary();
        };
    });

    tbody.querySelectorAll(".item-retail").forEach(input => {
        input.oninput = (e) => {
            const normalized = normalizeDigits(e.target.value);
            if (e.target.value !== normalized) e.target.value = normalized;

            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const retail = parseAnyNumber(e.target.value, true);
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
            const normalized = normalizeDigits(e.target.value);
            if (e.target.value !== normalized) e.target.value = normalized;

            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const pct = parseAnyNumber(e.target.value, false);
            selectedOrderItems[idx].retail_margin_pct = pct;
            const newRetail = Math.round(selectedOrderItems[idx].unit_cost * (1 + pct / 100));
            selectedOrderItems[idx].retail_price = newRetail;
            tr.querySelector(".item-retail").value = newRetail;
        };
    });

    tbody.querySelectorAll(".item-wholesale").forEach(input => {
        input.oninput = (e) => {
            const normalized = normalizeDigits(e.target.value);
            if (e.target.value !== normalized) e.target.value = normalized;

            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const wholesale = parseAnyNumber(e.target.value, true);
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
            const normalized = normalizeDigits(e.target.value);
            if (e.target.value !== normalized) e.target.value = normalized;

            const tr = e.target.closest("tr");
            const idx = Number(e.target.dataset.idx);
            const pct = parseAnyNumber(e.target.value, false);
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

    updateDifference();
}

function updateDifference() {
    const grandTotal = selectedOrderItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
    const paidInput = document.getElementById("pur-actual-paid");
    const diffLabel = document.getElementById("pur-diff-label");
    const diffAmount = document.getElementById("pur-diff-amount");

    if (!paidInput || !diffAmount || !diffLabel) return;

    const actualPaid = parseAnyNumber(paidInput.value, true);
    
    if (paidInput.value === "") {
        diffLabel.textContent = "Surplus / Deficit";
        diffAmount.textContent = "0 Ks";
        diffAmount.className = "text-sm font-black font-mono text-slate-400";
        return;
    }

    const diff = actualPaid - grandTotal;

    if (diff === 0) {
        diffLabel.textContent = "Balanced (အပြေအကျေ)";
        diffAmount.textContent = "0 Ks";
        diffAmount.className = "text-sm font-black font-mono text-emerald-500";
    } else if (diff > 0) {
        diffLabel.textContent = "Surplus (ပိုပေးငွေ)";
        diffAmount.textContent = `+${diff.toLocaleString()} Ks`;
        diffAmount.className = "text-sm font-black font-mono text-amber-500";
    } else {
        diffLabel.textContent = "Deficit (အကြွေးကျန်)";
        diffAmount.textContent = `${diff.toLocaleString()} Ks`;
        diffAmount.className = "text-sm font-black font-mono text-rose-500";
    }
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
    const purchaseDate = document.getElementById("pur-date")?.value || getLocalTodayDate();
    const refNo = document.getElementById("pur-ref-no")?.value.trim() || null;
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
    const itemsTotal = selectedOrderItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
    
    const paidInputVal = document.getElementById("pur-actual-paid")?.value;
    let paidAmount = 0;
    if (paymentMethod === "credit") {
        paidAmount = 0;
    } else if (paidInputVal !== undefined && paidInputVal !== null && paidInputVal !== "") {
        paidAmount = parseAnyNumber(paidInputVal, true);
    } else {
        paidAmount = itemsTotal;
    }

    const diffAmount = paidAmount - itemsTotal;

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
        purchase_date: purchaseDate,
        ref_no: refNo,
        items_total: itemsTotal,
        total_amount: itemsTotal,
        paid_amount: paidAmount,
        diff_amount: diffAmount,
        payment_method: paymentMethod,
        bank_account_name: paymentMethod === "bank" ? bankName : null,
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
            ui.toast.success(`အဝယ်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။ (VR: ${res.data?.purchaseNo || "OK"})`);
        }
        closePurchaseModal();
        await Promise.all([
            loadMasterProducts(),
            loadSuppliers(),
            loadPurchases()
        ]);
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
    const confirmed = await ui.confirm("ဤအဝယ်စာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?\n(စတော့ထဲမှ ပစ္စည်းအရေအတွက်များ ပြန်နုတ်ပြီး ငွေစာရင်းနှင့် ပွဲရုံအကြွေးစာရင်းမှလည်း ပြန်နုတ်ပေးပါမည်)", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/purchases/${id}`);
        ui.toast.success("အဝယ်စာရင်း ပယ်ဖျက်ပြီး စတော့၊ ငွေစာရင်းနှင့် ပွဲရုံအကြွေး ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await loadPurchases();
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

/**
 * Purchases စာရင်းအား CSV Export ထုတ်ယူခြင်း (QTY အပါအဝင် ၁၇ ကော်လံ)
 */
function exportPurchasesToCSV() {
    const listToExport = currentFilteredPurchases.length > 0 ? currentFilteredPurchases : purchasesList;

    if (listToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် အဝယ်စာရင်း မရှိသေးပါ။");
    }

    let csvContent = "NO,DATE,VR NO,BARCODE,CATEGORY,ITEM NAME,COLOR,QTY,UNIT PRICE,AMOUNT,METHOD,TYPE,WHOLESALE,RETAIL,SUPPLIER,REF,SURPLUS_DEFICIT\n";

    listToExport.forEach((pur, idx) => {
        const no = idx + 1;
        const rawDate = pur.purchase_date || (pur.created_at ? pur.created_at.split("T")[0] : "");
        const dateStr = rawDate ? new Date(rawDate).toLocaleDateString("en-GB") : "-";
        const vrNo = formatVRNo(pur, idx);
        const barcodeStr = pur.barcode || pur.sku || "-";
        const categoryStr = pur.category || "-";
        const itemName = pur.item_name || "-";
        const color = pur.color || "-";
        const qty = Number(pur.quantity || 0);
        const unitCost = Number(pur.unit_cost || 0);
        const amount = Number(pur.subtotal || Math.round(unitCost * qty));

        const rawMethod = String(pur.payment_method || "cash").toLowerCase();
        const paidAmount = Number(pur.paid_amount !== undefined ? pur.paid_amount : pur.total_amount);
        const totalAmount = Number(pur.items_total || pur.total_amount || 0);

        let methodStr = "-";
        if (paidAmount > 0) methodStr = rawMethod === "bank" ? "BANK" : "CASH";

        let typeStr = "PAID";
        if (paidAmount === 0 || rawMethod === "credit") typeStr = "CREDIT";
        else if (paidAmount > 0 && paidAmount < totalAmount) typeStr = "PARTIAL";

        const wholesalePrice = Number(pur.wholesale_price || 0);
        const retailPrice = Number(pur.retail_price || 0);
        const supplierName = pur.supplier_name || "-";
        const refNo = pur.ref_no || "-";
        const diffAmount = Number(pur.diff_amount || 0);

        const row = [
            no,
            ui.escapeCsv(dateStr),
            ui.escapeCsv(vrNo),
            ui.escapeCsv(barcodeStr),
            ui.escapeCsv(categoryStr),
            ui.escapeCsv(itemName),
            ui.escapeCsv(color),
            qty,
            unitCost,
            amount,
            ui.escapeCsv(methodStr),
            ui.escapeCsv(typeStr),
            wholesalePrice,
            retailPrice,
            ui.escapeCsv(supplierName),
            ui.escapeCsv(refNo),
            diffAmount
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Purchases_Summary_${getLocalTodayDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}
