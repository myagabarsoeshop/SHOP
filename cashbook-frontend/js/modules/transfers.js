// cashbook-frontend/js/modules/transfers.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let transfersList = [];
let currentFilteredTransfers = [];
let branchesList = [];
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

/**
 * မြန်မာဂဏန်း (၀-၉) နှင့် ကော်မာများကို ဖယ်ရှားပြီး Number ပြောင်းပေးသည့် Helper
 */
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

export async function initTransfers() {
    bindEvents();
    await loadBranches();
    await Promise.all([
        loadProductsForTransfer(),
        loadTransfers()
    ]);
}

function bindEvents() {
    // Toolbar: Filter & Search
    document.getElementById("trf-search")?.addEventListener("input", filterAndRender);
    document.getElementById("trf-category-filter")?.addEventListener("change", filterAndRender);

    // Export CSV
    document.getElementById("btn-export-trf-csv")?.addEventListener("click", exportTransfersToCSV);

    // Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-transfers");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await Promise.all([
                loadProductsForTransfer(),
                loadTransfers()
            ]);
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
            ui.toast.info("လွှဲပြောင်းမှုမှတ်တမ်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // Create Modal Events
    document.getElementById("btn-open-create-transfer")?.addEventListener("click", () => openCreateTransferModal());
    document.getElementById("btn-close-create-trf")?.addEventListener("click", () => {
        document.getElementById("create-trf-modal")?.classList.add("hidden");
    });
    document.getElementById("create-trf-form")?.addEventListener("submit", submitCreateTransfer);

    document.getElementById("create-trf-prod-id")?.addEventListener("change", (e) => {
        const pid = Number(e.target.value);
        updateCreateTransferStockHint(pid);
        if (pid) {
            const qtyInput = document.getElementById("create-trf-qty");
            if (qtyInput && !qtyInput.value) qtyInput.value = 1;
            document.getElementById("create-trf-dest-branch")?.focus();
        }
    });

    // Edit Modal Events
    document.getElementById("btn-close-edit-trf")?.addEventListener("click", () => {
        document.getElementById("edit-trf-modal")?.classList.add("hidden");
    });
    document.getElementById("edit-trf-form")?.addEventListener("submit", submitEditTransfer);
}

/**
 * D1 Read Quota ချွေတာရန် Branches စာရင်းကို Memory မှ ပြန်သုံးခြင်း
 */
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

async function loadProductsForTransfer() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        availableProducts = (res.data || []).filter(p => Number(p.current_stock || 0) > 0);
    } catch (err) {
        console.error("Products ရယူ၍မရပါ:", err);
    }
}

async function loadTransfers() {
    const tbody = document.getElementById("trf-table-body");
    const branchId = state.currentBranch?.id || 1;

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-16 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-purple-500 text-2xl mb-3"></i><div class="font-bold text-xs">လွှဲပြောင်းမှု မှတ်တမ်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const res = await api.get("/transfers", { branch_id: branchId });
        transfersList = res.data || [];
        currentFilteredTransfers = [...transfersList];

        populateCategoryFilter();
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryFilter() {
    const select = document.getElementById("trf-category-filter");
    if (!select) return;
    const current = select.value;
    const cats = [...new Set(transfersList.map(t => t.category).filter(Boolean))];
    
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${transfersList.length})</option>`;
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (cats.includes(current)) select.value = current;
}

function updateTransferKPIs(list = transfersList) {
    const currentBranchId = state.currentBranch?.id || 1;

    const totalCount = list.length;
    const totalQty = list.reduce((sum, t) => sum + Number(t.quantity || 0), 0);
    const outboundQty = list
        .filter(t => Number(t.from_branch_id) === currentBranchId)
        .reduce((sum, t) => sum + Number(t.quantity || 0), 0);
    const inboundQty = list
        .filter(t => Number(t.to_branch_id) === currentBranchId)
        .reduce((sum, t) => sum + Number(t.quantity || 0), 0);

    setKPI(1, "Total Transfers", totalCount, "fa-right-left", "blue");
    setKPI(2, "Total Items Qty", totalQty, "fa-boxes-stacked", "emerald");
    setKPI(3, "Outbound Stock", outboundQty, "fa-truck-arrow-right", "amber");
    setKPI(4, "Inbound Stock", inboundQty, "fa-parachute-box", "purple");
}

function filterAndRender() {
    const cat = document.getElementById("trf-category-filter")?.value || "";
    const kw = (document.getElementById("trf-search")?.value || "").trim().toLowerCase();

    currentFilteredTransfers = transfersList.filter(t => {
        if (cat && t.category !== cat) return false;
        if (!kw) return true;
        const hay = `${t.transfer_no || ""} ${t.sku || ""} ${t.barcode || ""} ${t.item_name || ""} ${t.from_branch_name || ""} ${t.to_branch_name || ""} ${t.notes || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    updateTransferKPIs(currentFilteredTransfers);
    pagination.reset();
    renderTable();
}

/**
 * Transfers Table (13 Columns - Pro Typography & Sticky Right Action)
 */
function renderTable() {
    const tbody = document.getElementById("trf-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredTransfers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-right-left text-3xl mb-3 opacity-30"></i>
                    <div>လွှဲပြောင်းမှု မှတ်တမ်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("transfers-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredTransfers);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((t, idx) => {
        const dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB") : "-";
        const unit = t.size || "ထည်";

        const actionButtons = state.isAdmin() ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${t.id}" title="ပြင်ဆင်မည်" class="btn-edit-trf w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${t.id}" title="ဖျက်မည်" class="btn-delete-trf w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `
            <span class="text-xs text-slate-400 font-mono">-</span>
        `;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";
        tr.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. DATE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 w-28">${dateStr}</td>
            
            <!-- 3. BARCODE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-400 w-28 truncate" title="${escapeHtml(t.barcode || t.sku || "-")}">${escapeHtml(t.barcode || t.sku || "-")}</td>
            
            <!-- 4. CATEGORY -->
            <td class="py-2 px-4 text-left text-xs font-bold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${escapeHtml(t.category || "-")}">${escapeHtml(t.category || "-")}</td>
            
            <!-- 5. ITEM NAME -->
            <td class="py-2 px-4 text-left text-xs font-extrabold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${escapeHtml(t.item_name || "-")}">${escapeHtml(t.item_name || "-")}</td>
            
            <!-- 6. COLOR -->
            <td class="py-2 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 w-24 truncate" title="${escapeHtml(t.color || "-")}">${escapeHtml(t.color || "-")}</td>
            
            <!-- 7. UNIT -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${escapeHtml(unit)}</td>
            
            <!-- 8. QTY -->
            <td class="py-2 px-4 text-right font-mono font-black text-sm text-purple-600 dark:text-purple-400 w-28">
                ${Number(t.quantity || 0).toLocaleString()}
            </td>

            <!-- 9. FROM SHOP -->
            <td class="py-2 px-4 text-left text-xs font-bold text-slate-700 dark:text-slate-300 w-32 truncate" title="${escapeHtml(t.from_branch_name || "Main")}">
                ${escapeHtml(t.from_branch_name || "Main")}
            </td>
            
            <!-- 10. TO SHOP -->
            <td class="py-2 px-4 text-left text-xs font-bold text-blue-600 dark:text-blue-400 w-32 truncate" title="${escapeHtml(t.to_branch_name || "-")}">
                ${escapeHtml(t.to_branch_name || "-")}
            </td>
            
            <!-- 11. REMARK -->
            <td class="py-2 px-4 text-xs font-semibold text-slate-600 dark:text-slate-300 min-w-[160px] truncate" title="${escapeHtml(t.notes || "")}">
                ${escapeHtml(t.notes || "-")}
            </td>

            <!-- 12. TRF NO -->
            <td class="py-2 px-4 text-left font-mono text-[11px] font-bold text-slate-400 w-40 truncate" title="${escapeHtml(t.transfer_no || "-")}">
                ${escapeHtml(t.transfer_no || "-")}
            </td>
            
            <!-- 13. ACTION (Sticky Right) -->
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-24">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (state.isAdmin()) {
        tbody.querySelectorAll(".btn-edit-trf").forEach(btn => {
            btn.onclick = () => {
                const trf = transfersList.find(t => t.id === Number(btn.dataset.id));
                if (trf) openEditTransferModal(trf);
            };
        });

        tbody.querySelectorAll(".btn-delete-trf").forEach(btn => {
            btn.onclick = () => deleteTransfer(Number(btn.dataset.id));
        });
    }

    pagination.renderControls("transfers-pagination");
}

function openCreateTransferModal() {
    const modal = document.getElementById("create-trf-modal");
    const prodSelect = document.getElementById("create-trf-prod-id");
    const destSelect = document.getElementById("create-trf-dest-branch");
    document.getElementById("create-trf-form")?.reset();

    const currentBranchId = state.currentBranch?.id || 1;

    if (prodSelect) {
        prodSelect.innerHTML = `<option value="">-- ပစ္စည်း ရွေးချယ်ပါ --</option>`;
        availableProducts.forEach(p => {
            prodSelect.innerHTML += `<option value="${p.id}" data-stock="${p.current_stock || 0}">
                ${escapeHtml(p.item_name)} (${escapeHtml(p.sku || "-")}) - လက်ကျန်: ${Number(p.current_stock || 0).toLocaleString()} ${escapeHtml(p.size || "ထည်")}
            </option>`;
        });
    }

    if (destSelect) {
        destSelect.innerHTML = `<option value="">-- လက်ခံမည့် ဆိုင်ခွဲ ရွေးပါ --</option>`;
        branchesList.forEach(b => {
            if (b.id !== currentBranchId) {
                destSelect.innerHTML += `<option value="${b.id}">${escapeHtml(b.name)} (${escapeHtml(b.code || "-")})</option>`;
            }
        });
    }

    updateCreateTransferStockHint(Number(prodSelect?.value));
    modal?.classList.remove("hidden");
    prodSelect?.focus();
}

function updateCreateTransferStockHint(productId) {
    const hint = document.getElementById("create-trf-stock-hint");
    const qtyInput = document.getElementById("create-trf-qty");
    const prod = availableProducts.find(p => p.id === productId);

    if (prod && hint) {
        const stock = Number(prod.current_stock || 0);
        hint.textContent = `လက်ရှိဆိုင် လက်ကျန်စတော့: ${stock.toLocaleString()} ${prod.size || "ထည်"}`;
        if (qtyInput) qtyInput.max = stock;
    } else if (hint) {
        hint.textContent = "";
    }
}

async function submitCreateTransfer(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-create-trf");
    const prodId = Number(document.getElementById("create-trf-prod-id")?.value);
    const toBranchId = Number(document.getElementById("create-trf-dest-branch")?.value);
    const qty = parseAnyNumber(document.getElementById("create-trf-qty")?.value, false);
    const notes = document.getElementById("create-trf-notes")?.value.trim();
    const fromBranchId = state.currentBranch?.id || 1;

    if (!prodId || !toBranchId || qty <= 0) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const prod = availableProducts.find(p => p.id === prodId);
    if (prod && qty > Number(prod.current_stock || 0)) {
        return ui.toast.warning(`လက်ရှိဆိုင်တွင် လက်ကျန်ပစ္စည်း (${prod.current_stock}) ထက် ပိုမို၍ လွှဲပြောင်း၍ မရပါ။`);
    }

    if (btn) btn.disabled = true;

    const payload = {
        fromBranchId: fromBranchId,
        toBranchId: toBranchId,
        productId: prodId,
        quantity: qty,
        notes: notes,
        createdBy: state.user?.id || 1
    };

    try {
        await api.post("/transfers", payload);
        document.getElementById("create-trf-modal")?.classList.add("hidden");
        ui.toast.success("ဆိုင်ခွဲသို့ ပစ္စည်းလွှဲပြောင်းမှု အောင်မြင်ပါသည်။ လက်ကျန်စာရင်းများ ညှိပြီးပါပြီ။");
        await Promise.all([
            loadProductsForTransfer(),
            loadTransfers()
        ]);
    } catch (err) {
        ui.toast.error("လွှဲပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function openEditTransferModal(trf) {
    const modal = document.getElementById("edit-trf-modal");
    document.getElementById("edit-trf-form")?.reset();

    const unit = trf.size || "ထည်";
    document.getElementById("edit-trf-id").value = trf.id;
    document.getElementById("edit-trf-prod-name").value = `${trf.item_name} (${trf.sku || "-"})`;
    document.getElementById("edit-trf-old-qty").value = `${Number(trf.quantity || 0).toLocaleString()} ${unit}`;
    document.getElementById("edit-trf-qty").value = trf.quantity;
    document.getElementById("edit-trf-notes").value = trf.notes || "";

    modal?.classList.remove("hidden");
    const qtyEl = document.getElementById("edit-trf-qty");
    qtyEl?.focus();
    qtyEl?.select();
}

async function submitEditTransfer(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-save-edit-trf");
    const id = document.getElementById("edit-trf-id")?.value;
    const newQty = parseAnyNumber(document.getElementById("edit-trf-qty")?.value, false);
    const notes = document.getElementById("edit-trf-notes")?.value.trim();

    if (!id || newQty <= 0) {
        return ui.toast.warning("မှန်ကန်သော အရေအတွက် ထည့်သွင်းပေးပါ။");
    }

    if (btn) btn.disabled = true;

    const payload = {
        quantity: newQty,
        notes: notes
    };

    try {
        await api.put(`/transfers/${id}`, payload);
        document.getElementById("edit-trf-modal")?.classList.add("hidden");
        ui.toast.success("လွှဲပြောင်းမှုမှတ်တမ်း ပြင်ဆင်ပြီး စတော့များ ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await Promise.all([
            loadProductsForTransfer(),
            loadTransfers()
        ]);
    } catch (err) {
        ui.toast.error("ပြင်ဆင်၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteTransfer(id) {
    const confirmed = await ui.confirm("ဤလွှဲပြောင်းမှုမှတ်တမ်းကို အမှန်တကယ် ပယ်ဖျက်လိုပါသလား?\n(ဆိုင်နှစ်ဖက်စလုံးရှိ စတော့များကို မူလအတိုင်း ပြန်လည်ညှိနှိုင်းပေးပါမည်)", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/transfers/${id}`);
        ui.toast.success("လွှဲပြောင်းမှုမှတ်တမ်း ပယ်ဖျက်ပြီး စတော့များ ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await Promise.all([
            loadProductsForTransfer(),
            loadTransfers()
        ]);
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

function exportTransfersToCSV() {
    const dataToExport = currentFilteredTransfers.length > 0 ? currentFilteredTransfers : transfersList;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် လွှဲပြောင်းမှုစာရင်း မရှိပါ။");
    }

    let csvContent = "NO,DATE,BARCODE,CATEGORY,ITEM NAME,COLOR,UNIT,QTY,FROM SHOP,TO SHOP,REMARK,TRF NO\n";

    dataToExport.forEach((t, idx) => {
        const no = idx + 1;
        const dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB") : "-";
        
        const row = [
            no,
            escapeCsv(dateStr),
            escapeCsv(t.barcode || t.sku),
            escapeCsv(t.category),
            escapeCsv(t.item_name),
            escapeCsv(t.color),
            escapeCsv(t.size || "ထည်"),
            t.quantity || 0,
            escapeCsv(t.from_branch_name),
            escapeCsv(t.to_branch_name),
            escapeCsv(t.notes),
            escapeCsv(t.transfer_no)
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Stock_Transfers_${getLocalTodayDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
