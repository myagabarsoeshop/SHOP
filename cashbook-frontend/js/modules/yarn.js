// cashbook-frontend/js/modules/waste.js

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Import Professional UI (Toast & Confirm)
import { setKPI } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let wasteLogs = [];
let currentFilteredWaste = [];
let availableProducts = [];

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
    if (/^[=+@-]/.test(str)) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
}

export async function initWaste() {
    bindEvents();
    await loadProductsForWaste();
    await loadWasteLogs();
}

function bindEvents() {
    // Search & Filter
    document.getElementById("waste-search")?.addEventListener("input", filterAndRender);
    document.getElementById("waste-category-filter")?.addEventListener("change", filterAndRender);
    
    // Export CSV
    document.getElementById("btn-export-waste-csv")?.addEventListener("click", exportWasteToCSV);
    
    // Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-waste");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadProductsForWaste();
            await loadWasteLogs();
            setTimeout(() => icon?.classList.remove("fa-spin"), 500);
            ui.toast.info("အလေအလွင့် မှတ်တမ်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // Create Modal Events
    document.getElementById("btn-open-create-waste")?.addEventListener("click", () => openCreateWasteModal());
    document.getElementById("btn-close-create-waste")?.addEventListener("click", () => {
        document.getElementById("create-waste-modal")?.classList.add("hidden");
    });
    document.getElementById("create-waste-form")?.addEventListener("submit", submitCreateWaste);
    document.getElementById("create-waste-prod-id")?.addEventListener("change", (e) => {
        updateCreateWasteStockHint(Number(e.target.value));
    });

    // Edit Modal Events
    document.getElementById("btn-close-waste-edit-modal")?.addEventListener("click", () => {
        document.getElementById("waste-edit-modal")?.classList.add("hidden");
    });
    document.getElementById("waste-edit-form")?.addEventListener("submit", submitEditWaste);
}

async function loadProductsForWaste() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        availableProducts = (res.data || []).filter(p => Number(p.current_stock || 0) > 0);
    } catch (err) {
        console.error("Products ရယူ၍မရပါ:", err);
    }
}

async function loadWasteLogs() {
    const tbody = document.getElementById("waste-table-body");
    const branchId = state.currentBranch?.id || 1;

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-16 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-amber-500 text-2xl mb-3"></i><div class="font-bold text-xs">မှတ်တမ်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const res = await api.get("/waste", { branch_id: branchId });
        wasteLogs = res.data || [];
        currentFilteredWaste = [...wasteLogs];

        populateCategoryFilter();
        updateWasteKPIs();
        pagination.reset();
        renderTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryFilter() {
    const select = document.getElementById("waste-category-filter");
    if (!select) return;
    const current = select.value;
    const cats = [...new Set(wasteLogs.map(w => w.category).filter(Boolean))];
    
    select.innerHTML = `<option value="">All Categories</option>`;
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (cats.includes(current)) select.value = current;
}

function updateWasteKPIs() {
    const totalWasteValue = wasteLogs.reduce((sum, w) => sum + (Number(w.quantity || 0) * Number(w.unit_cost || 0)), 0);
    const uniqueCategories = new Set(wasteLogs.map(w => w.category).filter(Boolean)).size;
    const totalItems = wasteLogs.reduce((sum, w) => sum + Number(w.quantity || 0), 0);
    const totalEntries = wasteLogs.length;

    setKPI(1, "Total Waste Value", totalWasteValue, "fa-vault", "rose");
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

    pagination.reset();
    renderTable();
}

/**
 * Waste Table Rendering (13 Columns - Ref No moved to end, REASON only)
 */
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

    pageItems.forEach((w, idx) => {
        const dateStr = w.created_at ? new Date(w.created_at).toLocaleDateString("en-GB") : "-";
        const subtotal = Number(w.quantity || 0) * Number(w.unit_cost || 0);

        const actionButtons = state.isAdmin() ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${w.id}" title="Edit" class="btn-edit-waste w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${w.id}" title="Delete (Return to Stock)" class="btn-delete-waste w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `<span class="text-xs text-slate-400 font-mono">-</span>`;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-12 whitespace-nowrap";
        tr.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. DATE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-medium text-slate-600 dark:text-slate-300 w-28">${dateStr}</td>
            
            <!-- 3. BARCODE -->
            <td class="py-2 px-3 text-left font-mono text-xs text-slate-600 dark:text-slate-400 w-28 truncate" title="${escapeHtml(w.barcode || w.sku || "-")}">${escapeHtml(w.barcode || w.sku || "-")}</td>
            
            <!-- 4. CATEGORY -->
            <td class="py-2 px-4 text-left text-base font-semibold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${escapeHtml(w.category || "-")}">${escapeHtml(w.category || "-")}</td>
            
            <!-- 5. ITEM NAME -->
            <td class="py-2 px-4 text-left text-base font-bold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${escapeHtml(w.item_name || "-")}">${escapeHtml(w.item_name || "-")}</td>
            
            <!-- 6. COLOR -->
            <td class="py-2 px-3 text-left text-base font-medium text-slate-600 dark:text-slate-400 w-24 truncate" title="${escapeHtml(w.color || "-")}">${escapeHtml(w.color || "-")}</td>
            
            <!-- 7. SIZE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${escapeHtml(w.size || "ထည်")}</td>
            
            <!-- 8. DEMIT QTY -->
            <td class="py-2 px-4 text-center font-mono font-black text-base text-rose-600 dark:text-rose-400 w-32">
                -${Number(w.quantity || 0).toLocaleString()}
            </td>

            <!-- 9. PURCHASE -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-slate-700 dark:text-slate-300 w-28">
                ${Number(w.unit_cost || 0).toLocaleString()}
            </td>
            
            <!-- 10. WASTE VALUE -->
            <td class="py-2 px-4 text-right font-mono font-black text-base text-rose-600 dark:text-rose-400 w-32">
                ${subtotal.toLocaleString()}
            </td>
            
            <!-- 11. REASON -->
            <td class="py-2 px-4 text-xs font-medium text-slate-600 dark:text-slate-300 min-w-[160px] truncate" title="${escapeHtml(w.reason || '')}">
                ${escapeHtml(w.reason || "-")}
            </td>

            <!-- 12. REF NO (Moved to right end) -->
            <td class="py-2 px-4 text-left font-mono text-[11px] font-bold text-slate-400 w-40 truncate">
                ${escapeHtml(w.reference_no || "-")}
            </td>
            
            <!-- 13. ACTION -->
            <td class="py-2 px-3 text-center sticky right-0 bg-white dark:bg-[#151e32] z-10 shadow-[-4px_0_8px_rgba(0,0,0,0.06)] w-24">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (state.isAdmin()) {
        tbody.querySelectorAll(".btn-edit-waste").forEach(btn => {
            btn.onclick = () => {
                const log = wasteLogs.find(w => w.id === Number(btn.dataset.id));
                if (log) openEditWasteModal(log);
            };
        });

        tbody.querySelectorAll(".btn-delete-waste").forEach(btn => {
            btn.onclick = () => deleteWasteLog(Number(btn.dataset.id));
        });
    }

    pagination.renderControls("waste-pagination");
}

function openCreateWasteModal() {
    const modal = document.getElementById("create-waste-modal");
    const prodSelect = document.getElementById("create-waste-prod-id");
    document.getElementById("create-waste-form")?.reset();

    if (prodSelect) {
        prodSelect.innerHTML = `<option value="">-- ပစ္စည်း ရွေးချယ်ပါ --</option>`;
        availableProducts.forEach(p => {
            prodSelect.innerHTML += `<option value="${p.id}" data-stock="${p.current_stock || 0}" data-cost="${p.cost_price || 0}">
                ${escapeHtml(p.item_name)} (${escapeHtml(p.sku || "-")}) - လက်ကျန်: ${Number(p.current_stock || 0).toLocaleString()} ${escapeHtml(p.size || "ထည်")}
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
    const prodId = Number(document.getElementById("create-waste-prod-id")?.value);
    const qty = parseFloat(document.getElementById("create-waste-qty")?.value) || 0;
    const reason = document.getElementById("create-waste-reason")?.value.trim();
    const branchId = state.currentBranch?.id || 1;

    if (!prodId || qty <= 0 || !reason) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const prod = availableProducts.find(p => p.id === prodId);
    if (prod && qty > Number(prod.current_stock || 0)) {
        return ui.toast.warning(`လက်ရှိဆိုင်တွင် လက်ကျန်ပစ္စည်း (${prod.current_stock}) ထက် ပိုမို၍ နှုတ်၍ မရပါ။`);
    }

    if (btn) btn.disabled = true;

    const payload = {
        branch_id: branchId,
        product_id: prodId,
        quantity: qty,
        unit_cost: prod ? Number(prod.cost_price || 0) : 0,
        reason: reason
    };

    try {
        await api.post("/waste", payload);
        document.getElementById("create-waste-modal")?.classList.add("hidden");
        ui.toast.success("အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
        await loadProductsForWaste();
        await loadWasteLogs();
    } catch (err) {
        ui.toast.error("စာရင်းသွင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function openEditWasteModal(log) {
    document.getElementById("edit-waste-id").value = log.id;
    document.getElementById("edit-waste-name").value = `${log.item_name} (${log.sku || "-"})`;
    document.getElementById("edit-waste-qty").value = log.quantity;
    document.getElementById("edit-waste-reason").value = log.reason || "";

    document.getElementById("waste-edit-modal")?.classList.remove("hidden");
    document.getElementById("edit-waste-qty")?.focus();
}

async function submitEditWaste(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-save-waste-edit");
    const id = document.getElementById("edit-waste-id")?.value;
    const qty = parseInt(document.getElementById("edit-waste-qty")?.value, 10);
    const reason = document.getElementById("edit-waste-reason")?.value.trim();

    if (!qty || qty <= 0) {
        return ui.toast.warning("ကျေးဇူးပြု၍ မှန်ကန်သော အရေအတွက် ရိုက်ထည့်ပေးပါ။");
    }

    if (btn) btn.disabled = true;

    try {
        await api.put(`/waste/${id}`, { quantity: qty, reason });
        document.getElementById("waste-edit-modal")?.classList.add("hidden");
        ui.toast.success("ပျက်စီးစာရင်း ပြင်ဆင်ပြီး စတော့လက်ကျန် ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await loadProductsForWaste();
        await loadWasteLogs();
    } catch (err) {
        ui.toast.error("ပြင်ဆင်၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteWasteLog(id) {
    const confirmed = await ui.confirm("ဤပျက်စီးစာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?\n(စတော့ထဲသို့ အရေအတွက် အပြည့်အဝ ပြန်လည်ပေါင်းထည့်ပေးပါမည်)", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/waste/${id}`);
        ui.toast.success("မှတ်တမ်း ဖျက်သိမ်းပြီး စတော့ထဲ ပြန်ထည့်ပြီးပါပြီ။");
        await loadProductsForWaste();
        await loadWasteLogs();
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

function exportWasteToCSV() {
    const dataToExport = currentFilteredWaste.length > 0 ? currentFilteredWaste : wasteLogs;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်းမှတ်တမ်း မရှိသေးပါ။");
    }
    const currentYear = new Date().getFullYear();
    let csvContent = "NO,DATE,BARCODE,CATEGORY,ITEM NAME,COLOR,SIZE,DEMIT QTY,PURCHASE,WASTE VALUE,REASON,REF NO\n";

    dataToExport.forEach((w, idx) => {
        const no = idx + 1;
        const dateStr = w.created_at ? new Date(w.created_at).toLocaleDateString("en-GB") : "-";
        const subtotal = Number(w.quantity || 0) * Number(w.unit_cost || 0);

        const row = [
            no,
            escapeCsv(dateStr),
            escapeCsv(w.barcode || w.sku),
            escapeCsv(w.category),
            escapeCsv(w.item_name),
            escapeCsv(w.color),
            escapeCsv(w.size || 'ထည်'),
            w.quantity || 0,
            w.unit_cost || 0,
            subtotal,
            escapeCsv(w.reason),
            escapeCsv(w.reference_no)
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Damage_Waste_Logs_FY${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
