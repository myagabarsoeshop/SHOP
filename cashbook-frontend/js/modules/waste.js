// =============================================================================
// FILE: cashbook-frontend/js/modules/waste.js 
// DAMAGE & WASTE LOGS MODULE (LEDGER-BACKED WASTE_OUT & REVERSAL)
// Version: 4.1.0 (Fixes Stock Field Mapping, ALL-View Guard & RBAC Void)
// =============================================================================

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let wasteLogs = [];
let currentFilteredWaste = [];
let availableProducts = [];

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

export async function initWaste() {
    const createBtn = document.getElementById("btn-open-create-waste");
    if (createBtn) {
        if (!state.can("waste.create")) {
            createBtn.classList.add("hidden");
        } else {
            createBtn.classList.remove("hidden");
            if (state.isAllBranches()) {
                createBtn.disabled = true;
                createBtn.classList.add("opacity-50", "cursor-not-allowed");
            } else {
                createBtn.disabled = false;
                createBtn.classList.remove("opacity-50", "cursor-not-allowed");
            }
        }
    }

    bindEvents();
    await Promise.all([
        loadProductsForWaste(),
        loadWasteLogs()
    ]);
}

function bindEvents() {
    document.getElementById("waste-search")?.addEventListener("input", filterAndRender);
    document.getElementById("waste-category-filter")?.addEventListener("change", filterAndRender);

    document.getElementById("btn-export-waste-csv")?.addEventListener("click", exportWasteToCSV);

    const refreshBtn = document.getElementById("btn-refresh-waste");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await Promise.all([
                loadProductsForWaste(),
                loadWasteLogs()
            ]);
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
            ui.toast.info("အလေအလွင့် မှတ်တမ်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    document.getElementById("btn-open-create-waste")?.addEventListener("click", () => openCreateWasteModal());
    document.getElementById("btn-close-create-waste")?.addEventListener("click", () => {
        document.getElementById("create-waste-modal")?.classList.add("hidden");
    });
    document.getElementById("create-waste-form")?.addEventListener("submit", submitCreateWaste);
    document.getElementById("create-waste-prod-id")?.addEventListener("change", (e) => {
        const pid = Number(e.target.value);
        updateCreateWasteStockHint(pid);
        if (pid) {
            const qtyInput = document.getElementById("create-waste-qty");
            if (qtyInput && !qtyInput.value) qtyInput.value = 1;
            qtyInput?.focus();
            qtyInput?.select();
        }
    });

    document.getElementById("btn-close-waste-edit-modal")?.addEventListener("click", () => {
        document.getElementById("waste-edit-modal")?.classList.add("hidden");
    });
}

async function loadProductsForWaste() {
    try {
        const branchId = state.getBranchId();
        const res = await api.get("/products", { branch_id: branchId });
        availableProducts = (res.data || [])
            .map(p => {
                const stockVal = Number(p.current_stock ?? p.quantity ?? p.stock ?? 0);
                return { ...p, current_stock: stockVal, quantity: stockVal };
            })
            .filter(p => p.current_stock > 0);
    } catch (err) {
        console.error("Products ရယူ၍မရပါ:", err);
    }
}

async function loadWasteLogs() {
    const tbody = document.getElementById("waste-table-body");
    const branchId = state.getBranchId();

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-16 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-amber-500 text-2xl mb-3"></i><div class="font-bold text-xs">မှတ်တမ်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const res = await api.get("/waste", { branch_id: branchId });
        wasteLogs = res.data || [];
        currentFilteredWaste = [...wasteLogs];

        populateCategoryFilter();
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryFilter() {
    const select = document.getElementById("waste-category-filter");
    if (!select) return;
    const current = select.value;
    const cats = [...new Set(wasteLogs.map(w => w.category).filter(Boolean))];

    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${wasteLogs.length})</option>`;
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (cats.includes(current)) select.value = current;
}

function updateWasteKPIs(list = wasteLogs) {
    const canViewCost = state.canViewCost();
    const totalWasteValue = canViewCost
        ? list.reduce((sum, w) => sum + Math.round(Number(w.quantity || 0) * Number(w.unit_cost || 0)), 0)
        : 0;
    const uniqueCategories = new Set(list.map(w => w.category).filter(Boolean)).size;
    const totalItems = list.reduce((sum, w) => sum + Number(w.quantity || 0), 0);
    const totalEntries = list.length;

    setKPI(1, "Total Waste Value", canViewCost ? totalWasteValue : "-", "fa-vault", "rose");
    setKPI(2, "Total Category", uniqueCategories, "fa-tags", "blue");
    setKPI(3, "Total Items", totalItems, "fa-shirt", "amber");
    setKPI(4, "Total Entries", totalEntries, "fa-clipboard-list", "emerald");
}

function filterAndRender() {
    const cat = document.getElementById("waste-category-filter")?.value || "";
    const kw = (document.getElementById("waste-search")?.value || "").trim().toLowerCase();

    currentFilteredWaste = wasteLogs.filter(w => {
        if (cat && w.category !== cat) return false;
        if (!kw) return true;
        const hay = `${w.reference_no || ""} ${w.sku || ""} ${w.barcode || ""} ${w.category || ""} ${w.item_name || ""} ${w.pattern || ""} ${w.color || ""} ${w.reason || ""} ${w.recorded_by_name || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    updateWasteKPIs(currentFilteredWaste);
    pagination.reset();
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById("waste-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredWaste.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-box-open text-3xl mb-3 opacity-30"></i>
                    <div>ပျက်စီး/အလေအလွင့် မှတ်တမ်း မရှိပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("waste-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredWaste);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;
    const canDeleteWaste = !state.isAllBranches() && state.can("waste.delete");
    const canViewCost = state.canViewCost();

    pageItems.forEach((w, idx) => {
        const dateStr = w.created_at ? new Date(w.created_at).toLocaleDateString("en-GB") : "-";
        const subtotal = Math.round(Number(w.quantity || 0) * Number(w.unit_cost || 0));
        const safeId = ui.escapeHtml(w.id);

        const actionButtons = canDeleteWaste ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${safeId}" title="ပယ်ဖျက်ပြီး စတော့ပြန်သွင်းမည် (Void & Reversal)" class="btn-delete-waste w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `<span class="text-[10px] text-slate-400 font-bold">Read-Only</span>`;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";
        tr.innerHTML = `
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 w-28">${ui.escapeHtml(dateStr)}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-400 w-28 truncate" title="${ui.escapeHtml(w.barcode || w.sku || "-")}">${ui.escapeHtml(w.barcode || w.sku || "-")}</td>
            <td class="py-2 px-4 text-left text-xs font-bold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${ui.escapeHtml(w.category || "-")}">${ui.escapeHtml(w.category || "-")}</td>
            <td class="py-2 px-4 text-left text-xs font-extrabold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${ui.escapeHtml(w.item_name || "-")}">${ui.escapeHtml(w.item_name || "-")}</td>
            <td class="py-2 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 w-24 truncate" title="${ui.escapeHtml(w.color || "-")}">${ui.escapeHtml(w.color || "-")}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${ui.escapeHtml(w.size || "ထည်")}</td>
            <td class="py-2 px-4 text-center font-mono font-black text-sm text-rose-600 dark:text-rose-400 w-32">
                -${Number(w.quantity || 0).toLocaleString()}
            </td>
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-slate-700 dark:text-slate-300 w-28">
                ${canViewCost ? Number(w.unit_cost || 0).toLocaleString() : "-"}
            </td>
            <td class="py-2 px-4 text-right font-mono font-black text-sm text-rose-600 dark:text-rose-400 w-32">
                ${canViewCost ? subtotal.toLocaleString() : "-"}
            </td>
            <td class="py-2 px-4 text-xs font-semibold text-slate-600 dark:text-slate-300 min-w-[160px] truncate" title="${ui.escapeHtml(w.reason || "")}">
                ${ui.escapeHtml(w.reason || "-")}
            </td>
            <td class="py-2 px-4 text-left font-mono text-[11px] font-bold text-slate-400 w-40 truncate" title="${ui.escapeHtml(w.reference_no || "-")}">
                ${ui.escapeHtml(w.reference_no || "-")}
            </td>
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-24">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (canDeleteWaste) {
        tbody.querySelectorAll(".btn-delete-waste").forEach(btn => {
            btn.onclick = () => deleteWasteLog(Number(btn.dataset.id));
        });
    }

    pagination.renderControls("waste-pagination");
}

function openCreateWasteModal() {
    if (state.isAllBranches()) {
        return ui.toast.warning("ဆိုင်ခွဲအားလုံး (ALL View) မှ အလေအလွင့်စာရင်း သွင်း၍ မရပါ။ ဆိုင်ခွဲတစ်ခုကို အရင်ရွေးချယ်ပါ။");
    }

    const modal = document.getElementById("create-waste-modal");
    const prodSelect = document.getElementById("create-waste-prod-id");
    document.getElementById("create-waste-form")?.reset();

    if (prodSelect) {
        prodSelect.innerHTML = `<option value="">-- ပစ္စည်း ရွေးချယ်ပါ --</option>`;
        availableProducts.forEach(p => {
            prodSelect.innerHTML += `<option value="${ui.escapeHtml(p.id)}" data-stock="${p.current_stock || 0}" data-cost="${p.cost_price || 0}">
                ${ui.escapeHtml(p.item_name)} (${ui.escapeHtml(p.sku || "-")}) - လက်ကျန်: ${Number(p.current_stock || 0).toLocaleString()} ${ui.escapeHtml(p.size || "ထည်")}
            </option>`;
        });
    }

    updateCreateWasteStockHint(Number(prodSelect?.value));
    modal?.classList.remove("hidden");
    prodSelect?.focus();
}

function updateCreateWasteStockHint(productId) {
    const hint = document.getElementById("create-waste-stock-hint");
    const qtyInput = document.getElementById("create-waste-qty");
    const prod = availableProducts.find(p => p.id === productId);

    if (prod && hint) {
        const stock = Number(prod.current_stock || 0);
        hint.textContent = `လက်ရှိဆိုင် လက်ကျန်စတော့: ${stock.toLocaleString()} ${prod.size || "ထည်"}`;
        if (qtyInput) qtyInput.max = stock;
    } else if (hint) {
        hint.textContent = "";
    }
}

async function submitCreateWaste(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-create-waste");

    let branchId;
    try {
        branchId = state.requireWriteBranchId();
    } catch (err) {
        return ui.toast.warning(err.message);
    }

    const prodId = Number(document.getElementById("create-waste-prod-id")?.value);
    const qty = parseAnyNumber(document.getElementById("create-waste-qty")?.value, false);
    const reason = document.getElementById("create-waste-reason")?.value.trim();

    if (!prodId || qty <= 0 || !reason) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const prod = availableProducts.find(p => p.id === prodId);
    if (prod && qty > Number(prod.current_stock || 0)) {
        return ui.toast.warning(`လက်ရှိဆိုင်တွင် လက်ကျန်ပစ္စည်း (${prod.current_stock}) ထက် ပိုမို၍ နှုတ်၍ မရပါ။`);
    }

    if (btn) btn.disabled = true;

    try {
        await api.post("/waste", {
            branch_id: branchId,
            product_id: prodId,
            quantity: qty,
            unit_cost: prod ? Number(prod.cost_price || 0) : 0,
            reason
        });
        document.getElementById("create-waste-modal")?.classList.add("hidden");
        ui.toast.success("အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
        await Promise.all([
            loadProductsForWaste(),
            loadWasteLogs()
        ]);
    } catch (err) {
        ui.toast.error("စာရင်းသွင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteWasteLog(id) {
    const confirmed = await ui.confirm("ဤပျက်စီးစာရင်းကို အမှန်တကယ် ပယ်ဖျက်လိုပါသလား?\n(စတော့နှင့် Movement Ledger ထဲသို့ အရေအတွက် အပြည့်အဝ ပြန်လည်ပေါင်းထည့်ပေးပါမည်)", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/waste/${id}`);
        ui.toast.success("မှတ်တမ်း ပယ်ဖျက်ပြီး စတော့နှင့် Movement Ledger ထဲ ပြန်ထည့်ပြီးပါပြီ။");
        await Promise.all([
            loadProductsForWaste(),
            loadWasteLogs()
        ]);
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

function exportWasteToCSV() {
    const dataToExport = currentFilteredWaste.length > 0 ? currentFilteredWaste : wasteLogs;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်းမှတ်တမ်း မရှိသေးပါ။");
    }

    let csvContent = "NO,DATE,BARCODE,CATEGORY,ITEM NAME,COLOR,UNIT,DAMAGE QTY,PURCHASE,WASTE VALUE,REASON,REF NO\n";

    dataToExport.forEach((w, idx) => {
        const no = idx + 1;
        const dateStr = w.created_at ? new Date(w.created_at).toLocaleDateString("en-GB") : "-";
        const subtotal = Math.round(Number(w.quantity || 0) * Number(w.unit_cost || 0));

        const row = [
            no,
            ui.escapeCsv(dateStr),
            ui.escapeCsv(w.barcode || w.sku),
            ui.escapeCsv(w.category),
            ui.escapeCsv(w.item_name),
            ui.escapeCsv(w.color),
            ui.escapeCsv(w.size || "ထည်"),
            w.quantity || 0,
            w.unit_cost || 0,
            subtotal,
            ui.escapeCsv(w.reason),
            ui.escapeCsv(w.reference_no)
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Damage_Waste_Logs_${getLocalTodayDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
