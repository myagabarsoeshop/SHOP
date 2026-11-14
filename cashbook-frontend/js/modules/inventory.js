// =============================================================================
// FILE: cashbook-frontend/js/modules/inventory.js 
// BRANCH INVENTORY, OPENING STOCK WORKFLOW & PHYSICAL STOCK COUNT/ADJUSTMENTS
// Version: 4.1.0 (Spec Sections 1.3, 3.2, 4, 5 & 6 Compliant)
// =============================================================================

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let products = [];
let currentFilteredProducts = [];
let branchesList = [];
let activeTab = "balances"; // 'balances' | 'opening' | 'adjustments'

// Opening Stock & Adjustments State
let openingCounts = [];
let activeOpeningDetail = null;
let openingDraftMap = new Map(); // product_id -> quantity

let adjustmentsList = [];
let activeAdjustmentDetail = null;
let adjustmentDraftMap = new Map(); // product_id -> { counted_qty, reason }

const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

function parseAnyNumber(val, isInteger = true) {
    if (!val && val !== 0) return 0;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let cleanStr = String(val).replace(/,/g, "").trim();
    myanmarDigits.forEach((d, idx) => {
        cleanStr = cleanStr.replaceAll(d, String(idx));
    });
    const num = parseFloat(cleanStr);
    if (isNaN(num)) return 0;
    return isInteger ? Math.round(num) : Math.round(num * 1000) / 1000;
}

function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            result.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

export async function initInventory() {
    activeTab = "balances";
    activeOpeningDetail = null;
    activeAdjustmentDetail = null;
    openingDraftMap.clear();
    adjustmentDraftMap.clear();

    injectStockControlWorkspace();
    bindEvents();
    await loadBranches();
    await loadInventory();
    await loadOpeningStatusBadge();
}

/**
 * Spec 5.6 & 6.2: Opening Stock နှင့် Stock Count/Adjustment Sub-tabs နှင့် Panel များကို
 * Inventory View အတွင်း အလိုအလျောက် ထည့်သွင်းပေးခြင်း
 */
function injectStockControlWorkspace() {
    const canStockControl = state.can("opening.create") || state.can("adjustment.create") || state.canApproveStock();
    if (!canStockControl) return;

    const viewContainer = document.getElementById("view-container");
    const mainCard = viewContainer?.firstElementChild;
    if (!mainCard || document.getElementById("inv-subtabs-bar")) return;

    const subTabsBar = document.createElement("div");
    subTabsBar.id = "inv-subtabs-bar";
    subTabsBar.className = "px-3 py-2 bg-slate-100/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0";
    subTabsBar.innerHTML = `
        <div class="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <button type="button" id="inv-tab-balances" class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer bg-emerald-600 text-white shadow-xs flex items-center gap-1.5">
                <i class="fa-solid fa-boxes-stacked"></i>
                <span>လက်ကျန်စာရင်း (Balances)</span>
            </button>
            <button type="button" id="inv-tab-opening" class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5">
                <i class="fa-solid fa-clipboard-check"></i>
                <span>ကနဦးစတော့ (Opening Stock)</span>
            </button>
            <button type="button" id="inv-tab-adjustments" class="px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5">
                <i class="fa-solid fa-scale-balanced"></i>
                <span>စတော့ရေတွက်/ပြင်ဆင်ချက် (Adjustment)</span>
            </button>
        </div>
        <div id="inv-opening-status-badge-container" class="flex items-center gap-2 text-xs"></div>
    `;

    mainCard.prepend(subTabsBar);

    const dynamicPanel = document.createElement("div");
    dynamicPanel.id = "inv-workflow-panel";
    dynamicPanel.className = "hidden flex-1 overflow-y-auto p-4 bg-slate-50/40 dark:bg-slate-950/40";
    mainCard.appendChild(dynamicPanel);

    document.getElementById("inv-tab-balances")?.addEventListener("click", () => switchInventoryTab("balances"));
    document.getElementById("inv-tab-opening")?.addEventListener("click", () => switchInventoryTab("opening"));
    document.getElementById("inv-tab-adjustments")?.addEventListener("click", () => switchInventoryTab("adjustments"));
}

async function switchInventoryTab(tabName) {
    activeTab = tabName;
    const tabBtns = {
        balances: document.getElementById("inv-tab-balances"),
        opening: document.getElementById("inv-tab-opening"),
        adjustments: document.getElementById("inv-tab-adjustments")
    };

    Object.entries(tabBtns).forEach(([key, btn]) => {
        if (!btn) return;
        if (key === tabName) {
            btn.className = "px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer bg-emerald-600 text-white shadow-xs flex items-center gap-1.5";
        } else {
            btn.className = "px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5";
        }
    });

    const workflowPanel = document.getElementById("inv-workflow-panel");
    const tableWrapper = document.getElementById("inv-table-body")?.closest("div.flex-1");
    const paginationEl = document.getElementById("inventory-pagination");
    const toolbarEl = document.getElementById("inv-search")?.closest("div.p-3");

    if (tabName === "balances") {
        workflowPanel?.classList.add("hidden");
        tableWrapper?.classList.remove("hidden");
        paginationEl?.classList.remove("hidden");
        toolbarEl?.classList.remove("hidden");
        await loadInventory();
    } else {
        tableWrapper?.classList.add("hidden");
        paginationEl?.classList.add("hidden");
        toolbarEl?.classList.add("hidden");
        workflowPanel?.classList.remove("hidden");

        if (tabName === "opening") {
            await renderOpeningStockWorkspace();
        } else if (tabName === "adjustments") {
            await renderAdjustmentsWorkspace();
        }
    }
}

async function loadOpeningStatusBadge() {
    const container = document.getElementById("inv-opening-status-badge-container");
    if (!container || !state.can("opening.create")) return;

    try {
        const branchId = state.getBranchId();
        const res = await api.get("/opening-stock", { branch_id: branchId });
        openingCounts = res.data || [];

        if (state.isAllBranches()) {
            const submittedCount = openingCounts.filter(o => o.status === "submitted").length;
            container.innerHTML = submittedCount > 0
                ? `<span class="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-extrabold text-[11px] flex items-center gap-1.5">
                    <i class="fa-solid fa-bell animate-bounce"></i> Opening Approve ရန် (${submittedCount}) စောင် ရှိပါသည်
                   </span>`
                : `<span class="text-slate-400 font-bold text-[11px]">Opening Stock: ဆိုင်အားလုံး</span>`;
            return;
        }

        const latest = openingCounts[0];
        if (!latest) {
            container.innerHTML = `<span class="text-slate-400 font-bold text-[11px]">Opening Status:</span> ${ui.statusBadge("draft")}`;
        } else {
            container.innerHTML = `<span class="text-slate-400 font-bold text-[11px]">Opening Status:</span> ${ui.statusBadge(latest.status)}`;
        }
    } catch {
        // Ignore badge error for cashiers
    }
}

function bindEvents() {
    document.getElementById("btn-export-csv")?.addEventListener("click", exportToCSV);

    const refreshBtn = document.getElementById("btn-refresh-inventory");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadInventory();
            await loadOpeningStatusBadge();
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
            ui.toast.info("စတော့လက်ကျန် စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // Spec 3.2: Only Admin & Finance can create/edit Product Master or bulk import CSV
    if (state.canManageCatalog()) {
        document.getElementById("btn-add-product")?.classList.remove("hidden");
        document.getElementById("btn-import-csv")?.classList.remove("hidden");
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

    document.getElementById("btn-close-waste-modal")?.addEventListener("click", () => {
        document.getElementById("waste-modal")?.classList.add("hidden");
    });
    document.getElementById("waste-form")?.addEventListener("submit", submitWaste);

    document.getElementById("btn-close-transfer-modal")?.addEventListener("click", () => {
        document.getElementById("transfer-modal")?.classList.add("hidden");
    });
    document.getElementById("transfer-form")?.addEventListener("submit", submitStockTransfer);

    document.getElementById("inv-category-filter")?.addEventListener("change", filterAndRender);
    document.getElementById("inv-search")?.addEventListener("input", filterAndRender);
}

async function loadBranches() {
    if (branchesList.length > 0) return;
    if (Array.isArray(state.branches) && state.branches.length > 0) {
        branchesList = state.branches;
        return;
    }
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
        const branchId = state.getBranchId();
        const res = await api.get("/products", { branch_id: branchId });
        products = (res.data || []).map(p => {
            const stockVal = Number(p.current_stock ?? p.quantity ?? p.stock ?? 0);
            return {
                ...p,
                current_stock: stockVal,
                quantity: stockVal
            };
        });

        populateCategoryFilter();
        updateInventoryKPIs();
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
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
    const canViewCost = state.canViewCost();
    const totalTypes = products.length;
    const totalPieces = products.reduce((sum, p) => sum + Number(p.current_stock || 0), 0);
    const totalCostValue = canViewCost
        ? products.reduce((sum, p) => sum + Math.round(Number(p.current_stock || 0) * Number(p.cost_price || 0)), 0)
        : 0;
    const lowStockCount = products.filter(p => Number(p.current_stock || 0) <= Number(p.alert_quantity || 5)).length;

    setKPI(1, "Total Category", totalTypes, "fa-tags", "blue");
    setKPI(2, "Stock Balances", totalPieces, "fa-shirt", "emerald");
    setKPI(3, "Stock Value", canViewCost ? totalCostValue : "-", "fa-vault", "amber");
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

    const canManageMaster = state.canManageCatalog();
    const canViewCost = state.canViewCost();
    const isAllView = state.isAllBranches();
    const canTransfer = !isAllView && state.can("transfer.create");
    const canWaste = !isAllView && state.can("waste.create");

    const pageItems = pagination.getPageItems(currentFilteredProducts);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((item, idx) => {
        const stock = Number(item.current_stock || 0);
        const isLow = stock <= Number(item.alert_quantity || 5);
        const unit = item.size || "ထည်";
        const costDisplay = canViewCost && item.cost_price !== undefined
            ? Number(item.cost_price || 0).toLocaleString()
            : "-";

        const safeId = ui.escapeHtml(item.id);
        const btnList = [];

        if (canManageMaster) {
            btnList.push(`
                <button type="button" data-id="${safeId}" title="ပစ္စည်း Master အချက်အလက် ပြင်ဆင်မည် (စတော့မပါ)" 
                    class="btn-edit-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
            `);
        }

        if (canTransfer) {
            btnList.push(`
                <button type="button" data-id="${safeId}" title="ဆိုင်ခွဲသို့ ပစ္စည်းလွှဲပြောင်းမည် (Pending)" 
                    class="btn-transfer-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-purple-600 text-purple-600 hover:text-white dark:text-purple-400 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-parachute-box text-xs"></i>
                </button>
            `);
        }

        if (canWaste) {
            btnList.push(`
                <button type="button" data-id="${safeId}" title="ပျက်စီး/အလေအလွင့် စာရင်းသွင်းမည်" 
                    class="btn-waste-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 text-amber-600 hover:text-white dark:text-amber-400 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-box-open text-xs"></i>
                </button>
            `);
        }

        if (canManageMaster) {
            btnList.push(`
                <button type="button" data-id="${safeId}" title="စာရင်းမှ ပိတ်သိမ်းမည် (Soft Delete)" 
                    class="btn-delete-prod w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            `);
        }

        const actionButtons = btnList.length > 0
            ? `<div class="flex items-center justify-center gap-1.5">${btnList.join("")}</div>`
            : `<span class="text-[10px] text-slate-400 font-bold">View Only</span>`;

        const statusBadge = isLow
            ? `<span class="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono text-[11px] font-bold">စတော့နည်း</span>`
            : `<span class="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-bold">ပုံမှန်</span>`;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";
        tr.innerHTML = `
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-400 w-28 truncate" title="${ui.escapeHtml(item.barcode || item.sku || "-")}">${ui.escapeHtml(item.barcode || item.sku || "-")}</td>
            <td class="py-2 px-4 text-left text-xs font-bold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${ui.escapeHtml(item.category || "-")}">${ui.escapeHtml(item.category || "-")}</td>
            <td class="py-2 px-4 text-left text-xs font-extrabold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${ui.escapeHtml(item.item_name || "-")}">${ui.escapeHtml(item.item_name || "-")}</td>
            <td class="py-2 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 w-28 truncate" title="${ui.escapeHtml(item.pattern || "-")}">${ui.escapeHtml(item.pattern || "-")}</td>
            <td class="py-2 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 w-24 truncate" title="${ui.escapeHtml(item.color || "-")}">${ui.escapeHtml(item.color || "-")}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${ui.escapeHtml(unit)}</td>
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-slate-700 dark:text-slate-300 w-28">${costDisplay}</td>
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-blue-600 dark:text-blue-400 w-28">${Number(item.wholesale_price || 0).toLocaleString()}</td>
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 w-28">${Number(item.retail_price || 0).toLocaleString()}</td>
            <td class="py-2 px-4 text-right font-mono text-sm font-black ${isLow ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'} w-32">
                ${stock.toLocaleString()}
            </td>
            <td class="py-2 px-3 text-center w-24">${statusBadge}</td>
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-28">${actionButtons}</td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-transfer-prod").forEach(btn => {
        btn.onclick = () => {
            const prod = products.find(p => p.id === Number(btn.dataset.id));
            if (prod) openTransferModal(prod);
        };
    });

    tbody.querySelectorAll(".btn-waste-prod").forEach(btn => {
        btn.onclick = () => {
            const prod = products.find(p => p.id === Number(btn.dataset.id));
            if (prod) openWasteModal(prod);
        };
    });

    if (canManageMaster) {
        tbody.querySelectorAll(".btn-edit-prod").forEach(btn => {
            btn.onclick = () => {
                const prod = products.find(p => p.id === Number(btn.dataset.id));
                if (prod) openProductModal(prod);
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

// =============================================================================
// OPENING STOCK WORKFLOW UI (Spec Section 5)
// =============================================================================
async function renderOpeningStockWorkspace() {
    const panel = document.getElementById("inv-workflow-panel");
    if (!panel) return;

    panel.innerHTML = `<div class="p-12 text-center text-slate-400 text-xs font-bold"><i class="fa-solid fa-spinner fa-spin text-xl text-emerald-500 mb-2"></i><div>Opening Stock စာရင်းများ ဆွဲယူနေပါသည်...</div></div>`;

    try {
        const branchId = state.getBranchId();
        const [openRes, prodRes] = await Promise.all([
            api.get("/opening-stock", { branch_id: branchId }),
            products.length > 0 ? Promise.resolve({ data: products }) : api.get("/products", { branch_id: branchId })
        ]);

        openingCounts = openRes.data || [];
        if (products.length === 0 && Array.isArray(prodRes.data)) {
            products = prodRes.data;
        }

        const isAllView = state.isAllBranches();
        const canApprove = state.canApproveStock();
        const branchOpening = !isAllView ? openingCounts[0] : null;
        const isApprovedLocked = branchOpening?.status === "approved";

        let html = `
            <div class="max-w-6xl mx-auto space-y-4">
                <div class="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 class="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <i class="fa-solid fa-clipboard-check text-emerald-500"></i>
                            <span>ဆိုင်ခွဲ ကနဦးစတော့ စာရင်းဖွင့်စနစ် (Opening Stock Workflow)</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">ဆိုင်ခွဲတစ်ခုလျှင် တစ်ကြိမ်သာ Opening Stock အတည်ပြုနိုင်ပါသည်။ အတည်ပြုပြီးနောက် ပြင်ဆင်လိုပါက Stock Adjustment ကို သုံးပါ။</p>
                    </div>
                    ${!isAllView && !isApprovedLocked && state.can("opening.create") ? `
                        <button type="button" id="btn-start-opening-draft" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-sm transition cursor-pointer flex items-center gap-1.5">
                            <i class="fa-solid fa-file-pen"></i>
                            <span>${branchOpening ? "Opening Draft ပြင်ဆင်မည်" : "Opening Stock မူကြမ်း စတင်ဖန်တီးမည်"}</span>
                        </button>
                    ` : ""}
                </div>
        `;

        // Show Reject Reason Banner if rejected (Spec 5.6)
        if (branchOpening && branchOpening.status === "rejected" && branchOpening.reject_reason) {
            html += `
                <div class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-start gap-3">
                    <i class="fa-solid fa-circle-xmark text-base mt-0.5"></i>
                    <div>
                        <div class="font-black">Opening Stock ပယ်ချခံထားရပါသည် (Rejected)</div>
                        <div class="mt-1">အကြောင်းပြချက်: <b>${ui.escapeHtml(branchOpening.reject_reason)}</b></div>
                        <div class="mt-1 text-[11px] opacity-80">ပစ္စည်းအရေအတွက်များကို ပြန်လည်စစ်ဆေးပြင်ဆင်ပြီး ပြန်လည် Submit တင်ပေးပါ။</div>
                    </div>
                </div>
            `;
        }

        // List of Opening Stock Counts (Admin/Finance Approval Queue + Branch History)
        html += `
            <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-extrabold text-xs text-slate-700 dark:text-slate-200 flex items-center justify-between">
                    <span>Opening Stock စာရွက်များ စာရင်း</span>
                    <span class="text-[11px] text-slate-400">${openingCounts.length} စောင်</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead class="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase">
                            <tr class="h-10">
                                <th class="px-4">ID</th>
                                <th class="px-4">ဆိုင်ခွဲ</th>
                                <th class="px-4">As Of Date</th>
                                <th class="px-4 text-center">ပစ္စည်းအမျိုးအစား</th>
                                <th class="px-4 text-right">စုစုပေါင်းအရေအတွက်</th>
                                <th class="px-4 text-center">Status</th>
                                <th class="px-4">ဖန်တီးသူ / အတည်ပြုသူ</th>
                                <th class="px-4 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                            ${openingCounts.length === 0 ? `
                                <tr><td colspan="8" class="p-8 text-center text-slate-400 font-bold">Opening Stock စာရွက် မရှိသေးပါ</td></tr>
                            ` : openingCounts.map(oc => `
                                <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 h-11">
                                    <td class="px-4 font-mono font-bold">#${oc.id}</td>
                                    <td class="px-4 font-bold">${ui.escapeHtml(oc.branch_name || "")}</td>
                                    <td class="px-4 font-mono">${ui.escapeHtml(oc.as_of_date)}</td>
                                    <td class="px-4 text-center font-mono font-bold">${Number(oc.item_count || 0)}</td>
                                    <td class="px-4 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">${Number(oc.total_quantity || 0).toLocaleString()}</td>
                                    <td class="px-4 text-center">${ui.statusBadge(oc.status)}</td>
                                    <td class="px-4 text-[11px] text-slate-500">
                                        ${ui.escapeHtml(oc.created_by_name || "-")}${oc.decided_by_name ? ` / <b>${ui.escapeHtml(oc.decided_by_name)}</b>` : ""}
                                    </td>
                                    <td class="px-4 text-center">
                                        <div class="flex items-center justify-center gap-1.5">
                                            <button type="button" data-id="${oc.id}" class="btn-view-opening px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-blue-600 dark:text-blue-400 font-bold text-[11px] cursor-pointer transition">
                                                အသေးစိတ် / စီမံရန်
                                            </button>
                                            ${canApprove && oc.status === "submitted" ? `
                                                <button type="button" data-id="${oc.id}" class="btn-approve-opening px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer transition">
                                                    Approve
                                                </button>
                                                <button type="button" data-id="${oc.id}" class="btn-reject-opening px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] cursor-pointer transition">
                                                    Reject
                                                </button>
                                            ` : ""}
                                        </div>
                                    </td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
            <div id="opening-editor-box"></div>
        </div>`;

        panel.innerHTML = html;

        document.getElementById("btn-start-opening-draft")?.addEventListener("click", async () => {
            if (branchOpening) {
                await openOpeningEditor(branchOpening.id);
            } else {
                await createNewOpeningDraft();
            }
        });

        panel.querySelectorAll(".btn-view-opening").forEach(btn => {
            btn.addEventListener("click", () => openOpeningEditor(Number(btn.dataset.id)));
        });

        panel.querySelectorAll(".btn-approve-opening").forEach(btn => {
            btn.addEventListener("click", () => approveOpeningCount(Number(btn.dataset.id)));
        });

        panel.querySelectorAll(".btn-reject-opening").forEach(btn => {
            btn.addEventListener("click", () => rejectOpeningCount(Number(btn.dataset.id)));
        });
    } catch (err) {
        panel.innerHTML = `<div class="p-8 text-center text-rose-500 font-bold text-xs">${ui.escapeHtml(err.message)}</div>`;
    }
}

async function createNewOpeningDraft() {
    try {
        const branchId = state.requireWriteBranchId();
        const res = await api.post("/opening-stock", {
            branch_id: branchId,
            as_of_date: getLocalTodayDate()
        });
        ui.toast.success("Opening Stock မူကြမ်း ဖန်တီးပြီးပါပြီ");
        await renderOpeningStockWorkspace();
        if (res.data?.id) {
            await openOpeningEditor(res.data.id);
        }
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function openOpeningEditor(countId) {
    const box = document.getElementById("opening-editor-box");
    if (!box) return;

    box.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs font-bold"><i class="fa-solid fa-spinner fa-spin mr-2"></i>ဖွင့်လှစ်နေပါသည်...</div>`;

    try {
        const res = await api.get(`/opening-stock/${countId}`);
        activeOpeningDetail = res.data;
        openingDraftMap.clear();

        (activeOpeningDetail.items || []).forEach(it => {
            openingDraftMap.set(Number(it.product_id), Number(it.quantity || 0));
        });

        const isEditable = (activeOpeningDetail.status === "draft" || activeOpeningDetail.status === "rejected") && state.can("opening.create");

        box.innerHTML = `
            <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div class="p-4 bg-slate-950 text-white flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div class="text-xs font-extrabold flex items-center gap-2">
                            <span>Opening Stock #${activeOpeningDetail.id} — ${ui.escapeHtml(activeOpeningDetail.branch_name)}</span>
                            ${ui.statusBadge(activeOpeningDetail.status)}
                        </div>
                        <div class="text-[11px] text-slate-400 mt-0.5">As of Date: ${ui.escapeHtml(activeOpeningDetail.as_of_date)}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        ${isEditable ? `
                            <button type="button" id="btn-save-opening-items" class="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs cursor-pointer transition">
                                <i class="fa-solid fa-floppy-disk mr-1"></i>မူကြမ်း သိမ်းမည် (Save Draft)
                            </button>
                            <button type="button" id="btn-submit-opening-count" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs cursor-pointer transition">
                                <i class="fa-solid fa-paper-plane mr-1"></i>အတည်ပြုရန် ပေးပို့မည် (Submit)
                            </button>
                        ` : ""}
                    </div>
                </div>
                <div class="max-h-[420px] overflow-y-auto">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead class="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black sticky top-0">
                            <tr class="h-10">
                                <th class="px-4">SKU</th>
                                <th class="px-4">အမျိုးအစား</th>
                                <th class="px-4">ပစ္စည်းအမည်</th>
                                <th class="px-4">ယူနစ်</th>
                                <th class="px-4 text-right w-44">ကနဦးလက်ကျန် (Opening Qty)</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                            ${products.map(p => {
                                const val = openingDraftMap.get(Number(p.id)) ?? 0;
                                return `
                                    <tr class="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                                        <td class="px-4 font-mono text-slate-500">${ui.escapeHtml(p.sku || "-")}</td>
                                        <td class="px-4 font-bold text-emerald-600 dark:text-emerald-400">${ui.escapeHtml(p.category)}</td>
                                        <td class="px-4 font-extrabold text-slate-900 dark:text-white">${ui.escapeHtml(p.item_name)}</td>
                                        <td class="px-4 font-mono">${ui.escapeHtml(p.size || "ထည်")}</td>
                                        <td class="px-4 text-right">
                                            ${isEditable ? `
                                                <input type="number" step="any" min="0" data-pid="${p.id}" value="${val}"
                                                    class="opening-qty-input w-28 px-2.5 py-1 text-right font-mono font-bold bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
                                            ` : `<span class="font-mono font-black">${Number(val).toLocaleString()}</span>`}
                                        </td>
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.getElementById("btn-save-opening-items")?.addEventListener("click", () => saveOpeningItems(countId, false));
        document.getElementById("btn-submit-opening-count")?.addEventListener("click", () => saveOpeningItems(countId, true));
    } catch (err) {
        box.innerHTML = `<div class="p-4 text-rose-500 font-bold text-xs">${ui.escapeHtml(err.message)}</div>`;
    }
}

async function saveOpeningItems(countId, andSubmit = false) {
    const inputs = Array.from(document.querySelectorAll(".opening-qty-input"));
    const items = inputs
        .map(inp => ({
            product_id: Number(inp.dataset.pid),
            quantity: parseAnyNumber(inp.value, false)
        }))
        .filter(it => it.quantity > 0);

    if (items.length === 0) {
        return ui.toast.warning("အနည်းဆုံး ပစ္စည်း (၁) မျိုးတွင် ကနဦးလက်ကျန် (> 0) ထည့်သွင်းပေးပါ");
    }

    try {
        await api.put(`/opening-stock/${countId}/items`, { items });
        if (andSubmit) {
            await api.post(`/opening-stock/${countId}/submit`, {});
            ui.toast.success("Opening Stock အတည်ပြုချက်တောင်းခံရန် (Submitted) ပေးပို့ပြီးပါပြီ");
        } else {
            ui.toast.success("Opening Stock မူကြမ်း သိမ်းဆည်းပြီးပါပြီ");
        }
        await loadOpeningStatusBadge();
        await renderOpeningStockWorkspace();
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function approveOpeningCount(countId) {
    const confirmed = await ui.confirm("ဤ Opening Stock စာရွက်အား အတည်ပြုပြီး ဆိုင်ခွဲလက်ကျန်နှင့် Movement Ledger ထဲသို့ ထည့်သွင်းမည်မှာ သေချာပါသလား?", "warning");
    if (!confirmed) return;

    try {
        await api.post(`/opening-stock/${countId}/approve`, {});
        ui.toast.success("Opening Stock အတည်ပြုပြီးပါပြီ");
        await loadOpeningStatusBadge();
        await renderOpeningStockWorkspace();
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function rejectOpeningCount(countId) {
    const reason = window.prompt("ငြင်းပယ်ရသည့် အကြောင်းပြချက် (Reject Reason) ရေးသားပေးပါ:");
    if (reason === null) return;
    if (!reason.trim()) {
        return ui.toast.warning("ငြင်းပယ်ရသည့် အကြောင်းပြချက် မဖြစ်မနေ လိုအပ်ပါသည်");
    }

    try {
        await api.post(`/opening-stock/${countId}/reject`, { reason: reason.trim() });
        ui.toast.info("Opening Stock အား ပြန်လည်ပြင်ဆင်ရန် Reject ပြုလုပ်ပြီးပါပြီ");
        await loadOpeningStatusBadge();
        await renderOpeningStockWorkspace();
    } catch (err) {
        ui.toast.error(err.message);
    }
}

// =============================================================================
// PHYSICAL STOCK COUNT & ADJUSTMENTS WORKFLOW UI (Spec Section 6)
// =============================================================================
async function renderAdjustmentsWorkspace() {
    const panel = document.getElementById("inv-workflow-panel");
    if (!panel) return;

    panel.innerHTML = `<div class="p-12 text-center text-slate-400 text-xs font-bold"><i class="fa-solid fa-spinner fa-spin text-xl text-emerald-500 mb-2"></i><div>Stock Adjustment စာရင်းများ ဆွဲယူနေပါသည်...</div></div>`;

    try {
        const branchId = state.getBranchId();
        const [adjRes, prodRes] = await Promise.all([
            api.get("/adjustments", { branch_id: branchId }),
            products.length > 0 ? Promise.resolve({ data: products }) : api.get("/products", { branch_id: branchId })
        ]);

        adjustmentsList = adjRes.data || [];
        if (products.length === 0 && Array.isArray(prodRes.data)) {
            products = prodRes.data;
        }

        const isAllView = state.isAllBranches();
        const canApprove = state.can("adjustment.approve");

        let html = `
            <div class="max-w-6xl mx-auto space-y-4">
                <div class="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 class="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <i class="fa-solid fa-scale-balanced text-emerald-500"></i>
                            <span>မြေပြင်စတော့ ရေတွက်ခြင်းနှင့် ကွဲလွဲမှု ပြင်ဆင်ချက် (Stock Count & Adjustment)</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">ကွဲလွဲမှုရှိသော ပစ္စည်းတိုင်းအတွက် အကြောင်းရင်း (Reason) မဖြစ်မနေ လိုအပ်ပြီး ကျပ် 50,000 အထက် ကွဲလွဲမှုကို Admin သာ Approve လုပ်နိုင်ပါသည်။</p>
                    </div>
                    ${!isAllView && state.can("adjustment.create") ? `
                        <button type="button" id="btn-open-new-adj-sheet" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-sm transition cursor-pointer flex items-center gap-1.5">
                            <i class="fa-solid fa-plus"></i>
                            <span>Stock Count စာရွက်အသစ် ဖွင့်မည်</span>
                        </button>
                    ` : ""}
                </div>

                <div id="adj-creator-box"></div>

                <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
                    <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-extrabold text-xs text-slate-700 dark:text-slate-200 flex items-center justify-between">
                        <span>Stock Adjustment မှတ်တမ်းများ</span>
                        <span class="text-[11px] text-slate-400">${adjustmentsList.length} စောင်</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse text-xs">
                            <thead class="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase">
                                <tr class="h-10">
                                    <th class="px-4">Ref No</th>
                                    <th class="px-4">ဆိုင်ခွဲ</th>
                                    <th class="px-4">ရက်စွဲ</th>
                                    <th class="px-4 text-right">ကွဲလွဲမှုတန်ဖိုး (Variance Value)</th>
                                    <th class="px-4 text-center">Status</th>
                                    <th class="px-4">တင်ပြသူ / အတည်ပြုသူ</th>
                                    <th class="px-4 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                                ${adjustmentsList.length === 0 ? `
                                    <tr><td colspan="7" class="p-8 text-center text-slate-400 font-bold">Stock Adjustment မှတ်တမ်း မရှိသေးပါ</td></tr>
                                ` : adjustmentsList.map(adj => `
                                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 h-11">
                                        <td class="px-4 font-mono font-bold text-blue-600 dark:text-blue-400">${ui.escapeHtml(adj.reference_no)}</td>
                                        <td class="px-4 font-bold">${ui.escapeHtml(adj.branch_name || "")}</td>
                                        <td class="px-4 font-mono">${ui.escapeHtml(adj.effective_date)}</td>
                                        <td class="px-4 text-right font-mono font-black ${Number(adj.total_variance_value) > 50000 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600'}">
                                            ${Number(adj.total_variance_value || 0).toLocaleString()} Ks
                                            ${Number(adj.total_variance_value) > 50000 ? `<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500">Admin Only</span>` : ""}
                                        </td>
                                        <td class="px-4 text-center">${ui.statusBadge(adj.status)}</td>
                                        <td class="px-4 text-[11px] text-slate-500">
                                            ${ui.escapeHtml(adj.created_by_name || "-")}${adj.decided_by_name ? ` / <b>${ui.escapeHtml(adj.decided_by_name)}</b>` : ""}
                                            ${adj.reject_reason ? `<div class="text-rose-500 font-bold">Reject: ${ui.escapeHtml(adj.reject_reason)}</div>` : ""}
                                        </td>
                                        <td class="px-4 text-center">
                                            <div class="flex items-center justify-center gap-1.5">
                                                ${canApprove && adj.status === "submitted" ? `
                                                    <button type="button" data-id="${adj.id}" class="btn-approve-adj px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer transition">
                                                        Approve
                                                    </button>
                                                    <button type="button" data-id="${adj.id}" class="btn-reject-adj px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] cursor-pointer transition">
                                                        Reject
                                                    </button>
                                                ` : `<span class="text-[11px] text-slate-400">-</span>`}
                                            </div>
                                        </td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        panel.innerHTML = html;

        document.getElementById("btn-open-new-adj-sheet")?.addEventListener("click", renderNewAdjustmentForm);

        panel.querySelectorAll(".btn-approve-adj").forEach(btn => {
            btn.addEventListener("click", () => approveAdjustment(Number(btn.dataset.id)));
        });

        panel.querySelectorAll(".btn-reject-adj").forEach(btn => {
            btn.addEventListener("click", () => rejectAdjustment(Number(btn.dataset.id)));
        });
    } catch (err) {
        panel.innerHTML = `<div class="p-8 text-center text-rose-500 font-bold text-xs">${ui.escapeHtml(err.message)}</div>`;
    }
}

function renderNewAdjustmentForm() {
    const box = document.getElementById("adj-creator-box");
    if (!box) return;

    box.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div class="p-4 bg-slate-950 text-white flex flex-wrap items-center justify-between gap-3">
                <div class="text-xs font-extrabold">မြေပြင်စတော့ ရေတွက်မှု စာရွက်အသစ် (Physical Stock Count)</div>
                <button type="button" id="btn-submit-new-adj" class="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs cursor-pointer transition">
                    <i class="fa-solid fa-paper-plane mr-1"></i>ကွဲလွဲမှုစာရင်း အတည်ပြုရန် ပေးပို့မည် (Submit)
                </button>
            </div>
            <div class="max-h-[420px] overflow-y-auto">
                <table class="w-full text-left border-collapse text-xs">
                    <thead class="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black sticky top-0">
                        <tr class="h-10">
                            <th class="px-4">ပစ္စည်းအမည်</th>
                            <th class="px-4 text-right">စနစ်လက်ကျန် (System)</th>
                            <th class="px-4 text-right w-36">ရေတွက်လက်ကျန် (Counted)</th>
                            <th class="px-4 text-right w-28">ကွဲလွဲမှု (Diff)</th>
                            <th class="px-4 min-w-[220px]">ကွဲလွဲရသည့် အကြောင်းရင်း (Reason *)</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                        ${products.map(p => {
                            const sysQty = Number(p.current_stock ?? p.quantity ?? 0);
                            return `
                                <tr class="h-11 hover:bg-slate-50 dark:hover:bg-slate-800/40" data-pid="${p.id}" data-sys="${sysQty}">
                                    <td class="px-4 font-extrabold text-slate-900 dark:text-white">${ui.escapeHtml(p.item_name)} <span class="text-slate-400 font-mono font-normal">(${ui.escapeHtml(p.sku || "-")})</span></td>
                                    <td class="px-4 text-right font-mono font-bold">${sysQty}</td>
                                    <td class="px-4 text-right">
                                        <input type="number" step="any" min="0" value="${sysQty}"
                                            class="adj-counted-input w-28 px-2.5 py-1 text-right font-mono font-bold bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
                                    </td>
                                    <td class="px-4 text-right font-mono font-black adj-diff-cell text-slate-400">0</td>
                                    <td class="px-4">
                                        <input type="text" placeholder="ကွဲလွဲပါက အကြောင်းရင်း ရေးပါ..."
                                            class="adj-reason-input w-full px-2.5 py-1 text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
                                    </td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    box.querySelectorAll(".adj-counted-input").forEach(inp => {
        inp.addEventListener("input", () => {
            const tr = inp.closest("tr");
            const sys = Number(tr.dataset.sys || 0);
            const counted = parseAnyNumber(inp.value, false);
            const diff = Math.round((counted - sys) * 1000) / 1000;
            const diffCell = tr.querySelector(".adj-diff-cell");
            if (diffCell) {
                diffCell.textContent = diff > 0 ? `+${diff}` : String(diff);
                diffCell.className = `px-4 text-right font-mono font-black adj-diff-cell ${diff === 0 ? "text-slate-400" : (diff > 0 ? "text-emerald-600" : "text-rose-600")}`;
            }
        });
    });

    document.getElementById("btn-submit-new-adj")?.addEventListener("click", submitNewAdjustmentSheet);
}

async function submitNewAdjustmentSheet() {
    let branchId;
    try {
        branchId = state.requireWriteBranchId();
    } catch (err) {
        return ui.toast.warning(err.message);
    }

    const rows = Array.from(document.querySelectorAll("#adj-creator-box tbody tr"));
    const items = [];

    for (const tr of rows) {
        const pid = Number(tr.dataset.pid);
        const sys = Number(tr.dataset.sys || 0);
        const counted = parseAnyNumber(tr.querySelector(".adj-counted-input")?.value, false);
        const diff = Math.round((counted - sys) * 1000) / 1000;
        const reason = tr.querySelector(".adj-reason-input")?.value.trim() || "";

        if (diff !== 0) {
            if (!reason) {
                tr.querySelector(".adj-reason-input")?.focus();
                return ui.toast.warning("ကွဲလွဲမှုရှိသော ပစ္စည်းတိုင်းအတွက် အကြောင်းရင်း (Reason) မဖြစ်မနေ ရေးသားပေးပါ");
            }
            items.push({
                product_id: pid,
                counted_qty: counted,
                reason
            });
        }
    }

    if (items.length === 0) {
        return ui.toast.warning("စနစ်လက်ကျန်နှင့် ကွဲလွဲသော ပစ္စည်း မရှိသေးပါ");
    }

    try {
        await api.post("/adjustments", {
            branch_id: branchId,
            effective_date: getLocalTodayDate(),
            submit: true,
            items
        });
        ui.toast.success("Stock Adjustment တင်ပြပြီးပါပြီ (Approve စောင့်ဆိုင်းနေပါသည်)");
        await renderAdjustmentsWorkspace();
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function approveAdjustment(adjId) {
    const confirmed = await ui.confirm("ဤ Stock Adjustment အား အတည်ပြုပြီး လက်ကျန်စတော့ ပြင်ဆင်မည်မှာ သေချာပါသလား?", "warning");
    if (!confirmed) return;

    try {
        await api.post(`/adjustments/${adjId}/approve`, {});
        ui.toast.success("Stock Adjustment အတည်ပြုပြီးပါပြီ");
        await renderAdjustmentsWorkspace();
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function rejectAdjustment(adjId) {
    const reason = window.prompt("ငြင်းပယ်ရသည့် အကြောင်းပြချက် (Reject Reason) ရေးသားပေးပါ:");
    if (reason === null) return;
    if (!reason.trim()) {
        return ui.toast.warning("ငြင်းပယ်ရသည့် အကြောင်းပြချက် မဖြစ်မနေ လိုအပ်ပါသည်");
    }

    try {
        await api.post(`/adjustments/${adjId}/reject`, { reason: reason.trim() });
        ui.toast.info("Stock Adjustment အား Reject ပြုလုပ်ပြီးပါပြီ");
        await renderAdjustmentsWorkspace();
    } catch (err) {
        ui.toast.error(err.message);
    }
}

// =============================================================================
// STOCK TRANSFER MODAL (CREATES PENDING TRANSFER - Spec Section 4.3)
// =============================================================================
function openTransferModal(prod) {
    if (state.isAllBranches()) {
        return ui.toast.warning("ပစ္စည်းလွှဲပြောင်းရန် အပေါ်ဆုံးဘားတွင် မူလပေးပို့မည့် ဆိုင်ခွဲတစ်ခုကို အရင်ရွေးချယ်ပေးပါ။");
    }

    const currentBranchId = state.getBranchId();
    const modal = document.getElementById("transfer-modal");
    document.getElementById("transfer-form")?.reset();

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
            if (Number(b.id) !== Number(currentBranchId)) {
                destSelect.innerHTML += `<option value="${ui.escapeHtml(b.id)}">${ui.escapeHtml(b.name)} (${ui.escapeHtml(b.code || "-")})</option>`;
            }
        });
    }

    modal?.classList.remove("hidden");
    qtyInput?.focus();
    qtyInput?.select();
}

async function submitStockTransfer(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-transfer");

    let fromBranchId;
    try {
        fromBranchId = state.requireWriteBranchId();
    } catch (err) {
        return ui.toast.warning(err.message);
    }

    const prodId = document.getElementById("transfer-prod-id")?.value;
    const toBranchId = document.getElementById("transfer-dest-branch")?.value;
    const qty = parseAnyNumber(document.getElementById("transfer-qty")?.value, false);
    const notes = document.getElementById("transfer-notes")?.value.trim();

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

    try {
        await api.post("/transfers", {
            from_branch_id: fromBranchId,
            to_branch_id: Number(toBranchId),
            product_id: Number(prodId),
            quantity: qty,
            notes
        });
        document.getElementById("transfer-modal")?.classList.add("hidden");
        ui.toast.success("ဆိုင်ခွဲလွှဲပြောင်းစာရင်း (Pending) ဖန်တီးပြီးပါပြီ။ Stock Transfers စာမျက်နှာတွင် Dispatch (ပစ္စည်းပို့ဆောင်မှု) အတည်ပြုပေးပါ။");
        await loadInventory();
    } catch (err) {
        ui.toast.error("လွှဲပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteProduct(id) {
    if (!state.canManageCatalog()) {
        return ui.toast.error("ပစ္စည်းဖျက်သိမ်းခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်။");
    }

    const confirmed = await ui.confirm("ဤအထည်ကို စာရင်းမှ ပိတ်သိမ်း (Soft Delete) ရန် သေချာပါသလား?", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/products/${id}`);
        ui.toast.success("ပစ္စည်းစာရင်းမှ ပိတ်သိမ်းပြီးပါပြီ။");
        await loadInventory();
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

// =============================================================================
// WASTE MODAL LOGIC (Spec Section 1.3 & 4.1)
// =============================================================================
function openWasteModal(prod) {
    if (state.isAllBranches()) {
        return ui.toast.warning("အလေအလွင့်စာရင်း သွင်းရန် အပေါ်ဆုံးဘားတွင် သက်ဆိုင်ရာ ဆိုင်ခွဲတစ်ခုကို အရင်ရွေးချယ်ပေးပါ။");
    }

    const modal = document.getElementById("waste-modal");
    document.getElementById("waste-form")?.reset();

    safeSetValue("waste-prod-id", prod.id);
    safeSetValue("waste-unit-cost", prod.cost_price || 0);
    safeSetValue("waste-prod-name", `${prod.item_name} (${prod.sku || "-"})`);
    safeSetValue("waste-current-stock", `${Number(prod.current_stock || 0).toLocaleString()} ${prod.size || "ထည်"}`);

    const qtyInput = document.getElementById("waste-qty");
    if (qtyInput) {
        qtyInput.max = prod.current_stock || 0;
    }

    modal?.classList.remove("hidden");
    qtyInput?.focus();
}

async function submitWaste(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-waste");

    let branchId;
    try {
        branchId = state.requireWriteBranchId();
    } catch (err) {
        return ui.toast.warning(err.message);
    }

    const prodId = document.getElementById("waste-prod-id")?.value;
    const qty = parseAnyNumber(document.getElementById("waste-qty")?.value, false);
    const unitCost = parseAnyNumber(document.getElementById("waste-unit-cost")?.value, true);
    const reason = document.getElementById("waste-reason")?.value.trim();

    if (qty <= 0 || !reason) {
        return ui.toast.warning("အလေအလွင့် အရေအတွက်နှင့် အကြောင်းရင်း ထည့်သွင်းပေးပါ။");
    }

    if (btn) btn.disabled = true;

    try {
        await api.post("/waste", {
            branch_id: branchId,
            product_id: parseInt(prodId, 10),
            quantity: qty,
            unit_cost: unitCost,
            reason
        });
        document.getElementById("waste-modal")?.classList.add("hidden");
        ui.toast.success("အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
        await loadInventory();
    } catch (err) {
        ui.toast.error("စာရင်းသွင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// =============================================================================
// PRODUCT MASTER MODAL (NO DIRECT STOCK EDITING - Spec Section 5.4 & 6.1)
// =============================================================================
function openProductModal(prod = null) {
    if (!state.canManageCatalog()) {
        return ui.toast.error("ပစ္စည်း Master အချက်အလက် ပြင်ဆင်ခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်။");
    }

    const modal = document.getElementById("product-modal");
    const title = document.getElementById("product-modal-title");
    const stockInput = document.getElementById("prod-stock");
    const stockLabel = document.getElementById("lbl-prod-stock");
    const stockHint = document.getElementById("prod-stock-hint");
    document.getElementById("product-form")?.reset();

    // Spec 5.4, 5.6 & 6.1: Stock input in Product Modal is strictly View-Only
    if (stockInput) {
        stockInput.disabled = true;
        stockInput.readOnly = true;
        stockInput.classList.add("opacity-50", "cursor-not-allowed");
    }
    if (stockLabel) {
        stockLabel.textContent = "လက်ရှိလက်ကျန် (View-Only)";
    }
    if (stockHint) {
        stockHint.innerHTML = `<i class="fa-solid fa-lock mr-1 text-amber-500"></i> စတော့လက်ကျန်ကို ဤဖောင်မှ တိုက်ရိုက်ပြင်ဆင်ခွင့် မရှိပါ။ <b>ကနဦးစတော့ (Opening Stock)</b> သို့မဟုတ် <b>စတော့ရေတွက်/ပြင်ဆင်ချက် (Adjustment)</b> စနစ်ကို အသုံးပြုပါ။`;
    }

    if (prod) {
        if (title) title.textContent = "ပစ္စည်း Master အချက်အလက် ပြင်ဆင်မည် (စတော့မပါ)";
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
        safeSetValue("prod-alert-qty", prod.alert_quantity ?? 5);
        safeSetValue("prod-stock", prod.current_stock ?? 0);
    } else {
        if (title) title.textContent = "ပစ္စည်း Master အသစ် ဖန်တီးမည်";
        safeSetValue("prod-id", "");
        safeSetValue("prod-size", "ထည်");
        safeSetValue("prod-cost", 0);
        safeSetValue("prod-retail", 0);
        safeSetValue("prod-wholesale", 0);
        safeSetValue("prod-alert-qty", 5);
        safeSetValue("prod-stock", 0);
    }

    modal?.classList.remove("hidden");
    document.getElementById("prod-name")?.focus();
}

async function submitProduct(e) {
    e.preventDefault();
    if (!state.canManageCatalog()) {
        return ui.toast.error("ခွင့်ပြုချက် မရှိပါ။");
    }

    const btn = document.getElementById("btn-submit-product");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("prod-id")?.value;
    const alertQty = parseAnyNumber(document.getElementById("prod-alert-qty")?.value, false);

    // Spec 1.3, 5.4 & 6.1: Never send quantity or initialStock in Product POST/PUT
    const payload = {
        sku: document.getElementById("prod-sku")?.value.trim() || null,
        barcode: document.getElementById("prod-barcode")?.value.trim() || null,
        category: document.getElementById("prod-category")?.value.trim(),
        item_name: document.getElementById("prod-name")?.value.trim(),
        pattern: document.getElementById("prod-pattern")?.value.trim() || null,
        color: document.getElementById("prod-color")?.value.trim() || null,
        size: document.getElementById("prod-size")?.value.trim() || "ထည်",
        cost_price: parseAnyNumber(document.getElementById("prod-cost")?.value, true),
        retail_price: parseAnyNumber(document.getElementById("prod-retail")?.value, true),
        wholesale_price: parseAnyNumber(document.getElementById("prod-wholesale")?.value, true),
        alert_quantity: alertQty
    };

    try {
        if (prodId) {
            await api.put(`/products/${prodId}`, payload);
            ui.toast.success("ပစ္စည်း Master အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            await api.post("/products", payload);
            ui.toast.success("ပစ္စည်း Master အသစ် မှတ်ပုံတင်ပြီးပါပြီ။");
        }
        document.getElementById("product-modal")?.classList.add("hidden");
        await loadInventory();
    } catch (err) {
        ui.toast.error("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function exportToCSV() {
    const dataToExport = currentFilteredProducts.length > 0 ? currentFilteredProducts : products;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်းမရှိပါ။");
    }

    const canViewCost = state.canViewCost();
    let csvContent = "SKU,Barcode,Category,Item Name,Pattern,Color,Unit/Size,Cost Price,Retail Price,Wholesale Price,Current Stock\n";

    dataToExport.forEach(p => {
        const row = [
            ui.escapeCsv(p.sku),
            ui.escapeCsv(p.barcode),
            ui.escapeCsv(p.category),
            ui.escapeCsv(p.item_name),
            ui.escapeCsv(p.pattern),
            ui.escapeCsv(p.color),
            ui.escapeCsv(p.size || "ထည်"),
            canViewCost ? (p.cost_price || 0) : 0,
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
    link.setAttribute("download", `Stock_Balances_${getLocalTodayDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function triggerImport() {
    if (!state.canManageCatalog()) {
        return ui.toast.error("CSV သွင်းယူခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်။");
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
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
    const lines = String(csvText || "").split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length <= 1) {
        return ui.toast.warning("CSV ဖိုင်ထဲတွင် အချက်အလက် မရှိပါ။");
    }

    const bulkItems = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 4) continue;

        const itemName = row[3] || "";
        if (!itemName) continue;

        bulkItems.push({
            sku: row[0] || null,
            barcode: row[1] || null,
            category: row[2] || "အထွေထွေ",
            item_name: itemName,
            pattern: row[4] || null,
            color: row[5] || null,
            size: row[6] || "ထည်",
            cost_price: parseAnyNumber(row[7], true),
            retail_price: parseAnyNumber(row[8], true),
            wholesale_price: parseAnyNumber(row[9] || row[8], true)
        });
    }

    if (bulkItems.length === 0) {
        return ui.toast.warning("သွင်းယူနိုင်သော ပစ္စည်းအချက်အလက် မတွေ့ပါ။");
    }

    try {
        ui.toast.info(`ပစ္စည်း Master (${bulkItems.length}) မျိုး သွင်းယူနေပါသည်...`);
        const res = await api.post("/products/bulk", { items: bulkItems });
        const payload = res?.data || res;
        ui.toast.success(payload?.message || `ပစ္စည်း Master (${bulkItems.length}) မျိုး သွင်းယူပြီးပါပြီ။`);
        await loadInventory();
    } catch (err) {
        ui.toast.error("CSV သွင်းယူမှု မအောင်မြင်ပါ: " + err.message);
    }
}
