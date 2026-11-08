// cashbook-frontend/js/modules/inventory.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Import Global UI (Toast & Confirm)
import { setKPI } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let products = [];
let currentFilteredProducts = [];
let branchesList = [];

// စတော့စာရင်းအတွက် စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Controller
const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeCsv(val) {
    let str = String(val ?? "").trim();
    // Excel Formula Injection ကာကွယ်ရန်
    if (/^[=+@-]/.test(str)) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
}

export async function initInventory() {
    bindEvents();
    await loadBranches();
    await loadInventory();
}

function bindEvents() {
    // Export CSV ကို မည်သည့် User မဆို ဝင်ရောက်အသုံးပြုနိုင်ရန် အမြဲဖွင့်ပေးမည်
    document.getElementById("btn-export-csv")?.addEventListener("click", exportToCSV);

    if (state.isAdmin()) {
        document.getElementById("btn-add-product")?.addEventListener("click", () => openProductModal());
        document.getElementById("btn-import-csv")?.addEventListener("click", triggerImport);
    } else {
        document.getElementById("btn-add-product")?.classList.add("hidden");
        document.getElementById("btn-import-csv")?.classList.add("hidden");
    }

    document.getElementById("btn-close-product-modal")?.addEventListener("click", () => {
        document.getElementById("product-modal")?.classList.add("hidden");
    });
    document.getElementById("product-form")?.addEventListener("submit", submitProduct);
    
    // Waste Modal Events
    document.getElementById("btn-close-waste-modal")?.addEventListener("click", () => {
        document.getElementById("waste-modal")?.classList.add("hidden");
    });
    document.getElementById("waste-form")?.addEventListener("submit", submitWaste);

    // Stock Transfer Modal Events (ဆိုင်အချင်းချင်း ပို့သည့်စနစ်)
    document.getElementById("btn-close-transfer-modal")?.addEventListener("click", () => {
        document.getElementById("transfer-modal")?.classList.add("hidden");
    });
    document.getElementById("transfer-form")?.addEventListener("submit", submitStockTransfer);

    document.getElementById("inv-category-filter")?.addEventListener("change", filterAndRender);
    document.getElementById("inv-search")?.addEventListener("input", filterAndRender);
}

async function loadBranches() {
    try {
        const res = await api.get("/branches");
        branchesList = res.data || [];
    } catch (err) {
        console.error("Branches ရယူ၍မရပါ:", err);
    }
}

async function loadInventory() {
    const tbody = document.getElementById("inv-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-16 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl mb-3"></i><div class="font-bold text-xs">အထည်လက်ကျန် စာရင်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        products = res.data || [];

        populateCategoryFilter();
        updateInventoryKPIs();
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
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
    if (cats.includes(current)) select.value = current;
}

function updateInventoryKPIs() {
    const totalTypes = products.length;
    const totalPieces = products.reduce((sum, p) => sum + Number(p.current_stock || 0), 0);
    const totalCostValue = products.reduce((sum, p) => sum + (Number(p.current_stock || 0) * Number(p.cost_price || 0)), 0);
    const lowStockCount = products.filter(p => Number(p.current_stock || 0) <= Number(p.alert_quantity || 5)).length;

    setKPI(1, "Total Category", totalTypes, "fa-tags", "blue");
    setKPI(2, "Stock Balances", totalPieces, "fa-shirt", "emerald");
    setKPI(3, "Stock Value", totalCostValue, "fa-vault", "amber");
    setKPI(4, "Low Stock", lowStockCount, "fa-triangle-exclamation", "rose");
}

function filterAndRender() {
    const cat = document.getElementById("inv-category-filter")?.value || "";
    const kw = (document.getElementById("inv-search")?.value || "").trim().toLowerCase();

    currentFilteredProducts = products.filter(p => {
        if (cat && p.category !== cat) return false;
        if (!kw) return true;
        const hay = `${p.sku || ""} ${p.barcode || ""} ${p.category || ""} ${p.item_name || ""} ${p.pattern || ""} ${p.color || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderTable();
}

/**
 * Stock Balances Table Rendering (Purchases စံနှုန်းအတိုင်း မျဉ်းတားမဲ့ Flat Row, One-Line View, ၁၃ ကော်လံ)
 */
function renderTable() {
    const tbody = document.getElementById("inv-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredProducts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-shirt text-3xl mb-3 opacity-30"></i>
                    <div>အထည်လက်ကျန် စာရင်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("inventory-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredProducts);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((item, idx) => {
        const stock = Number(item.current_stock || 0);
        const isLow = stock <= Number(item.alert_quantity || 5);
        const unit = item.size || "ထည်";

        const actionButtons = state.isAdmin() ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${item.id}" title="အချက်အလက် ပြင်ဆင်မည်" 
                    class="btn-edit-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="ဆိုင်ခွဲသို့ ပစ္စည်းလွှဲပြောင်းမည်" 
                    class="btn-transfer-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-purple-600 dark:hover:bg-purple-600 text-purple-600 hover:text-white dark:text-purple-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-parachute-box text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="ပျက်စီး/အလေအလွင့် စာရင်းသွင်းမည်" 
                    class="btn-waste-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 dark:hover:bg-amber-500 text-amber-600 hover:text-white dark:text-amber-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-box-open text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="စာရင်းမှ ဖျက်မည်" 
                    class="btn-delete-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${item.id}" title="ဆိုင်ခွဲသို့ ပစ္စည်းလွှဲပြောင်းမည်" 
                    class="btn-transfer-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-purple-600 dark:hover:bg-purple-600 text-purple-600 hover:text-white dark:text-purple-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-parachute-box text-xs"></i>
                </button>
            </div>
        `;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-12 whitespace-nowrap";
        tr.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. BARCODE -->
            <td class="py-2 px-3 text-left font-mono text-xs text-slate-600 dark:text-slate-400 w-28 truncate" title="${escapeHtml(item.barcode || item.sku || "-")}">${escapeHtml(item.barcode || item.sku || "-")}</td>
            
            <!-- 3. CATEGORY -->
            <td class="py-2 px-4 text-left text-base font-semibold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${escapeHtml(item.category || "-")}">${escapeHtml(item.category || "-")}</td>
            
            <!-- 4. ITEM NAME -->
            <td class="py-2 px-4 text-left text-base font-bold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${escapeHtml(item.item_name || "-")}">${escapeHtml(item.item_name || "-")}</td>
            
            <!-- 5. DESIGN -->
            <td class="py-2 px-3 text-left text-base font-medium text-slate-600 dark:text-slate-400 w-28 truncate" title="${escapeHtml(item.pattern || "-")}">${escapeHtml(item.pattern || "-")}</td>
            
            <!-- 6. COLOR -->
            <td class="py-2 px-3 text-left text-base font-medium text-slate-600 dark:text-slate-400 w-24 truncate" title="${escapeHtml(item.color || "-")}">${escapeHtml(item.color || "-")}</td>
            
            <!-- 7. UNIT -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${escapeHtml(unit)}</td>
            
            <!-- 8. PURCHASE (အရင်းဈေး) -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-slate-700 dark:text-slate-300 w-28">${Number(item.cost_price || 0).toLocaleString()}</td>
            
            <!-- 9. WHOLESALE -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-blue-600 dark:text-blue-400 w-28">${Number(item.wholesale_price || 0).toLocaleString()}</td>
            
            <!-- 10. RETAIL -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 w-28">${Number(item.retail_price || 0).toLocaleString()}</td>
            
            <!-- 11. TOTAL STOCK -->
            <td class="py-2 px-4 text-right font-mono text-base font-black ${isLow ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'} w-32">
                ${stock.toLocaleString()} <span class="text-xs font-sans font-bold text-slate-400">${escapeHtml(unit)}</span>
            </td>

            <!-- 12. STATUS (Low / Normal) -->
            <td class="py-2 px-3 text-center font-mono text-xs font-bold w-24 ${isLow ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}">
                ${isLow ? 'စတော့နည်း' : 'ပုံမှန်'}
            </td>

            <!-- 13. ACTION (Sticky Right) -->
            <td class="py-2 px-3 text-center sticky right-0 bg-white dark:bg-[#151e32] z-10 shadow-[-4px_0_8px_rgba(0,0,0,0.06)] w-28">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-transfer-prod").forEach(btn => {
        btn.onclick = () => {
            const prod = products.find(p => p.id === Number(btn.dataset.id));
            if (prod) openTransferModal(prod);
        };
    });

    if (state.isAdmin()) {
        tbody.querySelectorAll(".btn-edit-prod").forEach(btn => {
            btn.onclick = () => {
                const prod = products.find(p => p.id === Number(btn.dataset.id));
                if (prod) openProductModal(prod);
            };
        });

        tbody.querySelectorAll(".btn-waste-prod").forEach(btn => {
            btn.onclick = () => {
                const prod = products.find(p => p.id === Number(btn.dataset.id));
                if (prod) openWasteModal(prod);
            };
        });

        tbody.querySelectorAll(".btn-delete-prod").forEach(btn => {
            btn.onclick = () => {
                deleteProduct(Number(btn.dataset.id));
            };
        });
    }

    pagination.renderControls("inventory-pagination");
}

function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

// --- Stock Transfer Logic ---
function openTransferModal(prod) {
    const modal = document.getElementById("transfer-modal");
    document.getElementById("transfer-form")?.reset();

    const currentBranchId = state.currentBranch?.id || 1;
    const destSelect = document.getElementById("transfer-dest-branch");

    safeSetValue("transfer-prod-id", prod.id);
    safeSetValue("transfer-prod-name", `${prod.item_name} (${prod.sku || "-"})`);
    safeSetValue("transfer-current-stock", `${Number(prod.current_stock || 0).toLocaleString()} ${prod.size || "ထည်"}`);

    const qtyInput = document.getElementById("transfer-qty");
    if (qtyInput) {
        qtyInput.max = prod.current_stock || 0;
        qtyInput.value = 1;
    }

    if (destSelect) {
        destSelect.innerHTML = `<option value="" disabled selected>-- လက်ခံမည့် ဆိုင်ခွဲ ရွေးပါ --</option>`;
        branchesList.forEach(b => {
            if (b.id !== currentBranchId) {
                destSelect.innerHTML += `<option value="${b.id}">${escapeHtml(b.name)} (${escapeHtml(b.code || "-")})</option>`;
            }
        });
    }

    modal?.classList.remove("hidden");
    qtyInput?.focus();
}

async function submitStockTransfer(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-transfer");
    const prodId = document.getElementById("transfer-prod-id")?.value;
    const toBranchId = document.getElementById("transfer-dest-branch")?.value;
    const qty = parseFloat(document.getElementById("transfer-qty")?.value) || 0;
    const notes = document.getElementById("transfer-notes")?.value.trim();
    const fromBranchId = state.currentBranch?.id || 1;

    if (!toBranchId) {
        return ui.toast.warning("ကျေးဇူးပြု၍ ပစ္စည်းပို့ဆောင်မည့် ဆိုင်ခွဲကို ရွေးချယ်ပေးပါ။");
    }

    if (qty <= 0) {
        return ui.toast.warning("မှန်ကန်သော အရေအတွက် ရိုက်ထည့်ပေးပါ။");
    }

    const prod = products.find(p => p.id === Number(prodId));
    if (prod && qty > Number(prod.current_stock || 0)) {
        return ui.toast.error(`လက်ရှိဆိုင်တွင် လက်ကျန် (${prod.current_stock}) ထက် ပိုမိုလွှဲပြောင်း၍ မရပါ။`);
    }

    if (btn) btn.disabled = true;

    const payload = {
        fromBranchId: fromBranchId,
        toBranchId: Number(toBranchId),
        productId: Number(prodId),
        quantity: qty,
        notes: notes,
        createdBy: state.user?.id || 1
    };

    try {
        await api.post("/transfers", payload);
        document.getElementById("transfer-modal")?.classList.add("hidden");
        ui.toast.success("ဆိုင်ခွဲသို့ ပစ္စည်းလွှဲပြောင်းမှု အောင်မြင်ပါသည်။ လက်ကျန်စာရင်း ညှိနှိုင်းပြီးပါပြီ။");
        await loadInventory();
    } catch (err) {
        ui.toast.error("လွှဲပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteProduct(id) {
    const confirmed = await ui.confirm("ဤအထည်ကို စာရင်းမှ အမှန်တကယ် ဖျက်ပစ်ရန် သေချာပါသလား?", "error");
    if (!confirmed) return;
    
    try {
        await api.delete(`/products/${id}`);
        ui.toast.success("ပစ္စည်းစာရင်းမှ ဖျက်သိမ်းပြီးပါပြီ။");
        await loadInventory();
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

// --- Waste Modal Logic ---
function openWasteModal(prod) {
    const modal = document.getElementById("waste-modal");
    document.getElementById("waste-form")?.reset();

    safeSetValue("waste-prod-id", prod.id);
    safeSetValue("waste-unit-cost", prod.cost_price || 0);
    safeSetValue("waste-prod-name", `${prod.item_name} (${prod.sku || "-"})`);
    safeSetValue("waste-current-stock", prod.current_stock || 0);
    
    const qtyInput = document.getElementById("waste-qty");
    if (qtyInput) {
        qtyInput.max = prod.current_stock || 0;
    }

    modal?.classList.remove("hidden");
}

async function submitWaste(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-waste");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("waste-prod-id")?.value;
    const branchId = state.currentBranch?.id || 1;
    const qty = parseFloat(document.getElementById("waste-qty")?.value) || 0;
    const unitCost = parseFloat(document.getElementById("waste-unit-cost")?.value) || 0;
    const reason = document.getElementById("waste-reason")?.value.trim();

    if (qty <= 0) {
        if (btn) btn.disabled = false;
        return ui.toast.warning("အလေအလွင့် အရေအတွက် ထည့်သွင်းပေးပါ။");
    }

    const payload = {
        branch_id: branchId,
        product_id: parseInt(prodId, 10),
        quantity: qty,
        unit_cost: unitCost,
        reason: reason
    };

    try {
        await api.post("/waste", payload); 
        document.getElementById("waste-modal")?.classList.add("hidden");
        ui.toast.success("အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
        await loadInventory(); 
    } catch (err) {
        ui.toast.error("စာရင်းသွင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- Edit Product Logic (Admin) ---
function openProductModal(prod = null) {
    const modal = document.getElementById("product-modal");
    const title = document.getElementById("product-modal-title");
    document.getElementById("product-form")?.reset();

    if (prod) {
        if (title) title.textContent = "အထည်အချက်အလက် ပြင်ဆင်မည်";
        safeSetValue("prod-id", prod.id);
        safeSetValue("prod-sku", prod.sku || "");
        safeSetValue("prod-barcode", prod.barcode || "");
        safeSetValue("prod-category", prod.category || "");
        safeSetValue("prod-name", prod.item_name || "");
        safeSetValue("prod-pattern", prod.pattern || "");
        safeSetValue("prod-color", prod.color || "");
        safeSetValue("prod-size", prod.size || "ထည်");
        safeSetValue("prod-cost", prod.cost_price || 0);
        safeSetValue("prod-retail", prod.retail_price || 0);
        safeSetValue("prod-wholesale", prod.wholesale_price || 0);
    } else {
        if (title) title.textContent = "အထည်အချက်အလက်သစ် မှတ်ပုံတင်မည်";
        safeSetValue("prod-id", "");
        safeSetValue("prod-size", "ထည်");
    }

    modal?.classList.remove("hidden");
}

async function submitProduct(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-product");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("prod-id")?.value;
    const branchId = state.currentBranch?.id || 1;

    const payload = {
        sku: document.getElementById("prod-sku")?.value.trim() || null,
        barcode: document.getElementById("prod-barcode")?.value.trim() || null,
        category: document.getElementById("prod-category")?.value.trim(),
        itemName: document.getElementById("prod-name")?.value.trim(),
        pattern: document.getElementById("prod-pattern")?.value.trim() || null,
        color: document.getElementById("prod-color")?.value.trim() || null,
        size: document.getElementById("prod-size")?.value.trim() || "ထည်",
        costPrice: parseFloat(document.getElementById("prod-cost")?.value) || 0,
        retailPrice: parseFloat(document.getElementById("prod-retail")?.value) || 0,
        wholesalePrice: parseFloat(document.getElementById("prod-wholesale")?.value) || 0,
        targetBranchId: branchId,
        branchId
    };

    try {
        if (prodId) {
            await api.put(`/products/${prodId}`, payload);
            ui.toast.success("အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            payload.initialStock = 0; 
            payload.quantity = 0;
            await api.post("/products", payload);
            ui.toast.success("အထည်အသစ် မှတ်ပုံတင်ပြီးပါပြီ။");
        }
        document.getElementById("product-modal")?.classList.add("hidden");
        await loadInventory();
    } catch (err) {
        ui.toast.error("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- CSV Export Logic ---
function exportToCSV() {
    const dataToExport = currentFilteredProducts.length > 0 ? currentFilteredProducts : products;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်းမရှိပါ။");
    }
    const currentYear = new Date().getFullYear();
    let csvContent = "SKU,Barcode,Category,Item Name,Pattern,Color,Unit/Size,Cost Price,Retail Price,Wholesale Price,Current Stock\n";
    
    dataToExport.forEach(p => {
        const row = [
            escapeCsv(p.sku),
            escapeCsv(p.barcode),
            escapeCsv(p.category),
            escapeCsv(p.item_name),
            escapeCsv(p.pattern),
            escapeCsv(p.color),
            escapeCsv(p.size || 'ထည်'),
            p.cost_price || 0,
            p.retail_price || 0,
            p.wholesale_price || 0,
            p.current_stock || 0
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" }); 
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Stock_Balances_FY${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- CSV Import Logic ---
function triggerImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            await processImport(text);
        };
        reader.readAsText(file);
    };
    input.click();
}

async function processImport(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length <= 1) {
        return ui.toast.warning("CSV ဖိုင်ထဲတွင် အချက်အလက် မရှိပါ။");
    }
    
    let successCount = 0;
    const branchId = state.currentBranch?.id || 1;
    
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(s => s.replace(/(^"|"$)/g, '')) || lines[i].split(',');
        if (row.length < 4) continue; 
        
        const payload = {
            sku: row[0] || null,
            barcode: row[1] || null,
            category: row[2] || "Uncategorized",
            itemName: row[3] || "Imported Item",
            pattern: row[4] || null,
            color: row[5] || null,
            size: row[6] || "ထည်",
            costPrice: parseFloat(row[7]) || 0,
            retailPrice: parseFloat(row[8]) || 0,
            wholesalePrice: parseFloat(row[9]) || 0,
            initialStock: parseInt(row[10], 10) || 0,
            quantity: parseInt(row[10], 10) || 0,
            targetBranchId: branchId,
            branchId: branchId
        };
        
        try {
            await api.post("/products", payload);
            successCount++;
        } catch (e) {
            console.error("Import error line " + i, e);
        }
    }
    ui.toast.success(`အထည်အချက်အလက် အသစ် ${successCount} ခု အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ။`);
    await loadInventory();
}
