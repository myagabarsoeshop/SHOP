// =============================================================================
// FILE: cashbook-frontend/js/modules/yarn.js
// YARN INVENTORY & WEAVER ISSUE/RETURN MODULE
// Version: 4.1.0 (Spec 9.13 Single /yarns Endpoint, Spec 5.4/6.1 & RBAC)
// =============================================================================

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let yarnList = [];
let yarnIssuesList = [];
let currentFilteredYarns = [];

const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

function parseAnyNumber(val, isInteger = false) {
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

function getYarnUnit(item) {
    const sz = String(item.size || "").trim();
    if (!sz || sz.toLowerCase() === "free size" || sz.toLowerCase() === "free" || sz === "ထည်") {
        return "ပေါင်";
    }
    return sz;
}

export async function initYarn() {
    ensureYarnStockFieldsAndButtons();
    bindEvents();
    await loadYarnInventory();
}

/**
 * Spec 5.6 & 6.1: Yarn Master Modal တွင် Stock Input ကို View-Only အဖြစ်သာ ထားရှိခြင်း
 */
function ensureYarnStockFieldsAndButtons() {
    const editForm = document.getElementById("yarn-edit-form");
    if (editForm && !document.getElementById("edit-yarn-stock")) {
        const submitContainer = editForm.querySelector("button[type='submit']")?.parentElement;
        if (submitContainer) {
            const stockRow = document.createElement("div");
            stockRow.className = "space-y-3";
            stockRow.innerHTML = `
                <div class="grid grid-cols-2 gap-3 pt-1">
                    <div>
                        <label id="lbl-edit-yarn-stock" class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
                            လက်ရှိ ချည်လက်ကျန် (View-Only)
                        </label>
                        <input type="number" id="edit-yarn-stock" readonly disabled value="0"
                            class="w-full text-base font-mono font-black bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2 text-slate-500 cursor-not-allowed opacity-60">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                            စတော့နည်း သတိပေးချက် (Alert Qty)
                        </label>
                        <input type="number" id="edit-yarn-alert-qty" min="0" step="any" value="10" placeholder="10"
                            class="w-full text-base font-mono font-black bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                </div>
                <div class="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-xl">
                    <p id="edit-yarn-stock-hint" class="text-[11px] text-amber-800 dark:text-amber-300 font-bold leading-relaxed">
                        <i class="fa-solid fa-lock mr-1"></i> ချည်လက်ကျန်အရေအတွက်ကို ဤဖောင်မှ တိုက်ရိုက်ပြင်ဆင်၍ မရပါ။ ကနဦးစတော့ (Opening Stock)၊ အဝယ်စာရင်း သို့မဟုတ် Stock Adjustment စနစ်ကို အသုံးပြုပါ။
                    </p>
                </div>
            `;
            editForm.insertBefore(stockRow, submitContainer);
        }
    }

    const addNewBtn = document.getElementById("btn-open-issue-modal");
    if (addNewBtn && !document.getElementById("btn-toolbar-issue-yarn")) {
        const issueBtn = document.createElement("button");
        issueBtn.type = "button";
        issueBtn.id = "btn-toolbar-issue-yarn";
        issueBtn.title = "ရက်ကန်းသို့ ချည်ထုတ်ပေးမည်";
        issueBtn.className = "px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl shadow-md shadow-amber-500/20 transition flex items-center gap-1.5 cursor-pointer active:scale-95";
        issueBtn.innerHTML = `<i class="fa-solid fa-hand-holding-hand text-xs"></i><span>ချည်ထုတ်ပေးမည်</span>`;
        addNewBtn.parentElement?.insertBefore(issueBtn, addNewBtn);
    }
}

function bindEvents() {
    document.getElementById("yarn-search")?.addEventListener("input", filterAndRender);
    document.getElementById("yarn-category-filter")?.addEventListener("change", filterAndRender);

    document.getElementById("btn-export-yarn-csv")?.addEventListener("click", exportYarnToCSV);

    const importBtn = document.querySelector('#btn-import-csv[data-module="yarn"]') || document.getElementById("btn-import-csv");
    const addNewBtn = document.getElementById("btn-open-issue-modal");
    const toolbarIssueBtn = document.getElementById("btn-toolbar-issue-yarn");

    if (state.canManageCatalog()) {
        importBtn?.classList.remove("hidden");
        importBtn?.addEventListener("click", triggerImport);

        addNewBtn?.addEventListener("click", () => openEditYarnModal(null));
    } else {
        importBtn?.classList.add("hidden");
        addNewBtn?.addEventListener("click", () => openIssueModal());
        toolbarIssueBtn?.classList.add("hidden");
    }

    toolbarIssueBtn?.addEventListener("click", () => openIssueModal());

    if (state.isAllBranches()) {
        toolbarIssueBtn?.classList.add("opacity-50", "cursor-not-allowed");
        if (toolbarIssueBtn) toolbarIssueBtn.disabled = true;
    }

    const refreshBtn = document.getElementById("btn-refresh-yarn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadYarnInventory();
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
            ui.toast.info("ချည်လက်ကျန် စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    document.getElementById("btn-close-yarn-issue-modal")?.addEventListener("click", () => {
        document.getElementById("yarn-issue-modal")?.classList.add("hidden");
    });
    document.getElementById("yarn-issue-form")?.addEventListener("submit", submitYarnIssue);

    document.getElementById("issue-yarn-id")?.addEventListener("change", (e) => {
        updateIssueStockHint(Number(e.target.value));
        document.getElementById("issue-weaver-name")?.focus();
    });

    document.getElementById("btn-close-yarn-edit-modal")?.addEventListener("click", () => {
        document.getElementById("yarn-edit-modal")?.classList.add("hidden");
    });
    document.getElementById("yarn-edit-form")?.addEventListener("submit", submitEditYarn);
}

/**
 * Spec 9.13: Single endpoint `/api/yarns` only (no `/products` fallback)
 */
async function loadYarnInventory() {
    const tbody = document.getElementById("yarn-table-body");
    const branchId = state.getBranchId();

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-16 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl mb-3"></i><div class="font-bold text-xs">ချည်စာရင်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const res = await api.get("/yarns", { branch_id: branchId });
        const rawList = Array.isArray(res.data) ? res.data : (res.data?.yarns || []);
        yarnIssuesList = Array.isArray(res.data?.issues) ? res.data.issues : [];

        yarnList = rawList.map(p => {
            const stockVal = Number(p.current_stock ?? p.quantity ?? p.stock ?? 0);
            return {
                ...p,
                current_stock: stockVal,
                quantity: stockVal
            };
        });

        currentFilteredYarns = [...yarnList];
        populateCategoryFilter();
        updateYarnKPIs();
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryFilter() {
    const select = document.getElementById("yarn-category-filter");
    if (!select) return;
    const current = select.value;
    const cats = [...new Set(yarnList.map(p => p.category).filter(Boolean))];
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${yarnList.length})</option>`;
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (cats.includes(current)) select.value = current;
}

function updateYarnKPIs() {
    const canViewCost = state.canViewCost();
    const totalTypes = yarnList.length;
    const totalStock = yarnList.reduce((sum, y) => sum + Number(y.current_stock || 0), 0);
    const totalStockValue = canViewCost
        ? yarnList.reduce((sum, y) => sum + Math.round(Number(y.current_stock || 0) * Number(y.cost_price || 0)), 0)
        : 0;
    const lowStockCount = yarnList.filter(y => Number(y.current_stock || 0) <= Number(y.alert_quantity || 10)).length;

    setKPI(1, "Total Yarn Types", totalTypes, "fa-tags", "blue");
    setKPI(2, "Yarn Balances", totalStock, "fa-scroll", "emerald");
    setKPI(3, "Yarn Valuation", canViewCost ? totalStockValue : "-", "fa-vault", "amber");
    setKPI(4, "Low Stock Yarns", lowStockCount, "fa-triangle-exclamation", "rose");
}

function filterAndRender() {
    const cat = document.getElementById("yarn-category-filter")?.value || "";
    const kw = (document.getElementById("yarn-search")?.value || "").trim().toLowerCase();

    currentFilteredYarns = yarnList.filter(y => {
        if (cat && y.category !== cat) return false;
        if (!kw) return true;
        const hay = `${y.sku || ""} ${y.barcode || ""} ${y.item_name || ""} ${y.pattern || ""} ${y.color || ""} ${y.size || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById("yarn-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredYarns.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-scroll text-3xl mb-3 opacity-30"></i>
                    <div>ချည်လက်ကျန်စာရင်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("yarn-pagination");
        return;
    }

    const canManageMaster = state.canManageCatalog();
    const canViewCost = state.canViewCost();
    const canIssueYarn = !state.isAllBranches() && state.can("yarn.issue");
    const pageItems = pagination.getPageItems(currentFilteredYarns);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((item, idx) => {
        const stock = Number(item.current_stock || 0);
        const isLow = stock <= Number(item.alert_quantity || 10);
        const unit = getYarnUnit(item);
        const costDisplay = canViewCost ? Number(item.cost_price || 0).toLocaleString() : "-";
        const safeId = ui.escapeHtml(item.id);

        const btns = [];
        if (canIssueYarn) {
            btns.push(`
                <button type="button" data-id="${safeId}" title="ရက်ကန်းသို့ ချည်ထုတ်ပေးမည်" 
                    class="btn-issue-row w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 text-amber-600 hover:text-white dark:text-amber-400 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-hand-holding-hand text-xs"></i>
                </button>
            `);
        }
        if (canManageMaster) {
            btns.push(`
                <button type="button" data-id="${safeId}" title="ချည် Master အချက်အလက် ပြင်ဆင်မည် (စတော့မပါ)" 
                    class="btn-edit-yarn w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${safeId}" title="စာရင်းမှ ပိတ်သိမ်းမည် (Soft Delete)" 
                    class="btn-delete-yarn w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            `);
        }

        const actionButtons = btns.length > 0
            ? `<div class="flex items-center justify-center gap-1.5">${btns.join("")}</div>`
            : `<span class="text-[10px] text-slate-400 font-bold">Read-Only</span>`;

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
            <td class="py-2 px-4 text-right font-mono text-sm font-black ${isLow ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white"} w-32">
                ${stock.toLocaleString()}
            </td>
            <td class="py-2 px-3 text-center w-24">
                ${statusBadge}
            </td>
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-28">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-issue-row").forEach(btn => {
        btn.onclick = () => {
            const item = yarnList.find(y => y.id === Number(btn.dataset.id));
            if (item) openIssueModal(item.id);
        };
    });

    if (canManageMaster) {
        tbody.querySelectorAll(".btn-edit-yarn").forEach(btn => {
            btn.onclick = () => {
                const item = yarnList.find(y => y.id === Number(btn.dataset.id));
                if (item) openEditYarnModal(item);
            };
        });

        tbody.querySelectorAll(".btn-delete-yarn").forEach(btn => {
            btn.onclick = () => deleteYarn(Number(btn.dataset.id));
        });
    }

    pagination.renderControls("yarn-pagination");
}

function openIssueModal(selectedYarnId = null) {
    if (state.isAllBranches()) {
        return ui.toast.warning("ရက်ကန်းသို့ ချည်ထုတ်ပေးရန် အပေါ်ဆုံးဘားတွင် သက်ဆိုင်ရာ ဆိုင်ခွဲ/စတိုကို အရင်ရွေးချယ်ပေးပါ။");
    }

    const modal = document.getElementById("yarn-issue-modal");
    const select = document.getElementById("issue-yarn-id");
    document.getElementById("yarn-issue-form")?.reset();

    if (!select) return;
    select.innerHTML = `<option value="">-- ချည်အမျိုးအစား ရွေးချယ်ပါ --</option>`;

    yarnList.forEach(y => {
        const isSel = selectedYarnId && selectedYarnId === y.id ? "selected" : "";
        const unit = getYarnUnit(y);
        select.innerHTML += `<option value="${ui.escapeHtml(y.id)}" ${isSel} data-stock="${y.current_stock || 0}">
            ${ui.escapeHtml(y.item_name)} (${ui.escapeHtml(y.sku || "-")}) - လက်ကျန်: ${Number(y.current_stock || 0).toLocaleString()} ${ui.escapeHtml(unit)}
        </option>`;
    });

    const activeId = selectedYarnId || Number(select.value);
    updateIssueStockHint(activeId);

    modal?.classList.remove("hidden");
    if (selectedYarnId) {
        document.getElementById("issue-weaver-name")?.focus();
    } else {
        select?.focus();
    }
}

function updateIssueStockHint(yarnId) {
    const hint = document.getElementById("issue-stock-hint");
    const qtyInput = document.getElementById("issue-quantity");
    const item = yarnList.find(y => y.id === yarnId);

    if (item && hint) {
        const stock = Number(item.current_stock || 0);
        const unit = getYarnUnit(item);
        hint.textContent = `လက်ရှိစတိုလက်ကျန်: ${stock.toLocaleString()} ${unit}`;
        if (qtyInput) qtyInput.max = stock;
    } else if (hint) {
        hint.textContent = "";
    }
}

async function submitYarnIssue(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-yarn-issue");

    let branchId;
    try {
        branchId = state.requireWriteBranchId();
    } catch (err) {
        return ui.toast.warning(err.message);
    }

    const yarnId = parseInt(document.getElementById("issue-yarn-id")?.value, 10);
    const weaverName = document.getElementById("issue-weaver-name")?.value.trim();
    const qty = parseAnyNumber(document.getElementById("issue-quantity")?.value, false);
    const notes = document.getElementById("issue-notes")?.value.trim();

    if (!yarnId || !weaverName || qty <= 0) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const item = yarnList.find(y => y.id === yarnId);
    if (item && qty > Number(item.current_stock || 0)) {
        const unit = getYarnUnit(item);
        return ui.toast.warning(`လက်ကျန်ချည်ပမာဏ (${item.current_stock} ${unit}) ထက် ပိုမို၍ ထုတ်ပေး၍မရပါ။`);
    }

    if (btn) btn.disabled = true;

    try {
        await api.post("/yarns/issue", {
            branch_id: branchId,
            yarn_id: yarnId,
            weaver_name: weaverName,
            issue_type: "ISSUE",
            quantity: qty,
            notes
        });
        document.getElementById("yarn-issue-modal")?.classList.add("hidden");
        ui.toast.success("ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု အောင်မြင်စွာ စာရင်းသွင်းပြီးပါပြီ။");
        await loadYarnInventory();
    } catch (err) {
        ui.toast.error("လုပ်ဆောင်၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function openEditYarnModal(item = null) {
    if (!state.canManageCatalog()) {
        return ui.toast.error("ချည် Master အချက်အလက် ပြင်ဆင်ခွင့်ကို Admin နှင့် Finance သာ ခွင့်ပြုပါသည်။");
    }

    ensureYarnStockFieldsAndButtons();
    document.getElementById("yarn-edit-form")?.reset();

    const stockInput = document.getElementById("edit-yarn-stock");
    const alertInput = document.getElementById("edit-yarn-alert-qty");

    if (stockInput) {
        stockInput.disabled = true;
        stockInput.readOnly = true;
    }

    if (item) {
        const unit = getYarnUnit(item);
        document.getElementById("edit-yarn-id").value = item.id;
        document.getElementById("edit-yarn-sku").value = item.sku || "";
        const barcodeEl = document.getElementById("edit-yarn-barcode");
        if (barcodeEl) barcodeEl.value = item.barcode || "";
        document.getElementById("edit-yarn-name").value = item.item_name || "";
        const patternEl = document.getElementById("edit-yarn-pattern");
        if (patternEl) patternEl.value = item.pattern || "";
        document.getElementById("edit-yarn-color").value = item.color || "";
        document.getElementById("edit-yarn-unit").value = unit;
        document.getElementById("edit-yarn-cost").value = item.cost_price || 0;
        document.getElementById("edit-yarn-retail").value = item.retail_price || 0;
        document.getElementById("edit-yarn-wholesale").value = item.wholesale_price || 0;
        if (alertInput) alertInput.value = item.alert_quantity ?? 10;
        if (stockInput) stockInput.value = item.current_stock ?? 0;
    } else {
        document.getElementById("edit-yarn-id").value = "";
        document.getElementById("edit-yarn-unit").value = "ပေါင်";
        document.getElementById("edit-yarn-cost").value = 0;
        document.getElementById("edit-yarn-retail").value = 0;
        document.getElementById("edit-yarn-wholesale").value = 0;
        if (alertInput) alertInput.value = 10;
        if (stockInput) stockInput.value = 0;
    }

    document.getElementById("yarn-edit-modal")?.classList.remove("hidden");
    document.getElementById("edit-yarn-name")?.focus();
}

async function submitEditYarn(e) {
    e.preventDefault();
    if (!state.canManageCatalog()) {
        return ui.toast.error("ခွင့်ပြုချက် မရှိပါ။");
    }

    const btn = document.getElementById("btn-save-yarn-edit");
    const id = document.getElementById("edit-yarn-id")?.value;
    const alertQty = parseAnyNumber(document.getElementById("edit-yarn-alert-qty")?.value, false);

    // Spec 5.4 & 6.1: Never send initialStock or quantity from Yarn Master form
    const payload = {
        sku: document.getElementById("edit-yarn-sku")?.value.trim() || null,
        barcode: document.getElementById("edit-yarn-barcode")?.value.trim() || null,
        category: "ချည်",
        item_name: document.getElementById("edit-yarn-name")?.value.trim(),
        pattern: document.getElementById("edit-yarn-pattern")?.value.trim() || null,
        color: document.getElementById("edit-yarn-color")?.value.trim() || null,
        size: document.getElementById("edit-yarn-unit")?.value.trim() || "ပေါင်",
        cost_price: parseAnyNumber(document.getElementById("edit-yarn-cost")?.value, true),
        retail_price: parseAnyNumber(document.getElementById("edit-yarn-retail")?.value, true),
        wholesale_price: parseAnyNumber(document.getElementById("edit-yarn-wholesale")?.value, true),
        alert_quantity: alertQty
    };

    if (!payload.item_name) {
        return ui.toast.warning("ချည်အမည် ထည့်သွင်းပေးပါ။");
    }

    if (btn) btn.disabled = true;

    try {
        if (id) {
            await api.put(`/products/${id}`, payload);
            ui.toast.success("ချည် Master အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            await api.post("/products", payload);
            ui.toast.success("ချည် Master အသစ် သိမ်းဆည်းပြီးပါပြီ။");
        }
        document.getElementById("yarn-edit-modal")?.classList.add("hidden");
        await loadYarnInventory();
    } catch (err) {
        ui.toast.error("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteYarn(id) {
    if (!state.canManageCatalog()) {
        return ui.toast.error("ခွင့်ပြုချက် မရှိပါ။");
    }

    const confirmed = await ui.confirm("ဤချည်စာရင်းကို စာရင်းမှ ပိတ်သိမ်း (Soft Delete) ရန် သေချာပါသလား?", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/products/${id}`);
        ui.toast.success("ချည်စာရင်းမှ ပိတ်သိမ်းပြီးပါပြီ။");
        await loadYarnInventory();
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

function exportYarnToCSV() {
    const dataToExport = currentFilteredYarns.length > 0 ? currentFilteredYarns : yarnList;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် ချည်စာရင်း မရှိပါ။");
    }

    const canViewCost = state.canViewCost();
    let csvContent = "NO,BARCODE,CATEGORY,ITEM NAME,DESIGN,COLOR,UNIT,PURCHASE,WHOLESALE,RETAIL,TOTAL STOCK,STATUS\n";

    dataToExport.forEach((y, idx) => {
        const no = idx + 1;
        const unit = getYarnUnit(y);
        const stock = Number(y.current_stock || 0);
        const status = stock <= Number(y.alert_quantity || 10) ? "စတော့နည်း" : "ပုံမှန်";

        const row = [
            no,
            ui.escapeCsv(y.barcode || y.sku),
            ui.escapeCsv(y.category),
            ui.escapeCsv(y.item_name),
            ui.escapeCsv(y.pattern),
            ui.escapeCsv(y.color),
            ui.escapeCsv(unit),
            canViewCost ? (y.cost_price || 0) : 0,
            y.wholesale_price || 0,
            y.retail_price || 0,
            stock,
            ui.escapeCsv(status)
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Yarn_Balances_${getLocalTodayDate()}.csv`);
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

    const headerCols = parseCsvLine(lines[0]).map(h => h.toUpperCase());
    const isExportedYarnFormat = headerCols[0] === "NO" && headerCols[1] === "BARCODE";

    const bulkItems = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 4) continue;

        if (isExportedYarnFormat) {
            const itemName = row[3] || "";
            if (!itemName) continue;
            bulkItems.push({
                sku: row[1] || null,
                barcode: row[1] || null,
                category: row[2] || "ချည်",
                item_name: itemName,
                pattern: row[4] || null,
                color: row[5] || null,
                size: row[6] || "ပေါင်",
                cost_price: parseAnyNumber(row[7], true),
                wholesale_price: parseAnyNumber(row[8], true),
                retail_price: parseAnyNumber(row[9] || row[8], true)
            });
        } else {
            const itemName = row[3] || "";
            if (!itemName) continue;
            bulkItems.push({
                sku: row[0] || null,
                barcode: row[1] || null,
                category: row[2] || "ချည်",
                item_name: itemName,
                pattern: row[4] || null,
                color: row[5] || null,
                size: row[6] || "ပေါင်",
                cost_price: parseAnyNumber(row[7], true),
                retail_price: parseAnyNumber(row[8], true),
                wholesale_price: parseAnyNumber(row[9] || row[8], true)
            });
        }
    }

    if (bulkItems.length === 0) {
        return ui.toast.warning("သွင်းယူနိုင်သော ချည်အချက်အလက် မတွေ့ပါ။");
    }

    try {
        ui.toast.info(`ချည် Master (${bulkItems.length}) မျိုး သွင်းယူနေပါသည်...`);
        const res = await api.post("/products/bulk", {
            items: bulkItems
        });
        const payload = res?.data || res;
        const msg = payload?.message || `ချည် Master (${payload?.importedCount ?? bulkItems.length}) မျိုး အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ။`;
        ui.toast.success(msg);
        await loadYarnInventory();
    } catch (err) {
        ui.toast.error("CSV သွင်းယူမှု မအောင်မြင်ပါ: " + err.message);
    }
}
