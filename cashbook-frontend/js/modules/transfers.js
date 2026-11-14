// =============================================================================
// FILE: cashbook-frontend/js/modules/transfers.js 
// INTER-BRANCH STOCK TRANSFERS MODULE (STATE MACHINE WORKFLOW)
// Version: 4.1.0 (Spec Section 4.3 State Machine: pending -> dispatched -> received)
// =============================================================================

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
    // Spec 3.2: Cashier can receive transfers, but cannot create new transfers
    const createBtn = document.getElementById("btn-open-create-transfer");
    if (createBtn) {
        if (!state.can("transfer.create")) {
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
    await loadBranches();
    await Promise.all([
        loadProductsForTransfer(),
        loadTransfers()
    ]);
}

function bindEvents() {
    document.getElementById("trf-search")?.addEventListener("input", filterAndRender);
    document.getElementById("trf-category-filter")?.addEventListener("change", filterAndRender);

    document.getElementById("btn-export-trf-csv")?.addEventListener("click", exportTransfersToCSV);

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

    document.getElementById("btn-close-edit-trf")?.addEventListener("click", () => {
        document.getElementById("edit-trf-modal")?.classList.add("hidden");
    });
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

async function loadProductsForTransfer() {
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

async function loadTransfers() {
    const tbody = document.getElementById("trf-table-body");
    const branchId = state.getBranchId();

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
            tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
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
    const activeList = list.filter(t => t.status !== "cancelled");
    const currentBranchId = state.isAllBranches() ? null : Number(state.getBranchId());

    const totalCount = activeList.length;
    const totalQty = activeList.reduce((sum, t) => sum + Number(t.quantity || 0), 0);
    const outboundQty = currentBranchId
        ? activeList.filter(t => Number(t.from_branch_id) === currentBranchId).reduce((sum, t) => sum + Number(t.quantity || 0), 0)
        : activeList.filter(t => t.status === "dispatched").reduce((sum, t) => sum + Number(t.quantity || 0), 0);
    const inboundQty = currentBranchId
        ? activeList.filter(t => Number(t.to_branch_id) === currentBranchId).reduce((sum, t) => sum + Number(t.quantity || 0), 0)
        : activeList.filter(t => t.status === "received" || t.status === "completed").reduce((sum, t) => sum + Number(t.quantity || 0), 0);

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
        const hay = `${t.transfer_no || ""} ${t.sku || ""} ${t.barcode || ""} ${t.item_name || ""} ${t.from_branch_name || ""} ${t.to_branch_name || ""} ${t.status || ""} ${t.notes || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    updateTransferKPIs(currentFilteredTransfers);
    pagination.reset();
    renderTable();
}

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
    const isAdminOrFinance = state.isAdmin();
    const myBranchId = state.isAllBranches() ? null : Number(state.getBranchId());

    pageItems.forEach((t, idx) => {
        const dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB") : "-";
        const unit = t.size || "ထည်";
        const status = String(t.status || "pending").toLowerCase();
        const safeId = ui.escapeHtml(t.id);

        const isSender = isAdminOrFinance || (myBranchId && Number(t.from_branch_id) === myBranchId);
        const isReceiver = isAdminOrFinance || (myBranchId && Number(t.to_branch_id) === myBranchId);

        const actionBtns = [];

        // Spec 4.3 State Machine Transitions:
        // 1. pending -> dispatched (Sender / Admin / Finance)
        if (status === "pending" && isSender && state.can("transfer.dispatch")) {
            actionBtns.push(`
                <button type="button" data-id="${safeId}" title="ပစ္စည်းပို့ဆောင်မည် (Dispatch - ထွက်ဆိုင်မှ စတော့နုတ်မည်)" 
                    class="btn-dispatch-trf px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-extrabold transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1">
                    <i class="fa-solid fa-truck-fast text-[10px]"></i>
                    <span>ပို့မည်</span>
                </button>
            `);
        }

        // 2. dispatched -> received (Receiver / Admin / Finance - includes Cashier of receiving branch)
        if (status === "dispatched" && isReceiver && state.can("transfer.receive")) {
            actionBtns.push(`
                <button type="button" data-id="${safeId}" title="ပစ္စည်းလက်ခံမည် (Receive - ဝင်ဆိုင်သို့ စတော့ပေါင်းမည်)" 
                    class="btn-receive-trf px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-extrabold transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1">
                    <i class="fa-solid fa-box-open text-[10px]"></i>
                    <span>လက်ခံမည်</span>
                </button>
            `);
        }

        // 3. pending / dispatched -> cancelled (Sender / Admin / Finance)
        if ((status === "pending" || status === "dispatched") && isSender && state.can("transfer.cancel")) {
            actionBtns.push(`
                <button type="button" data-id="${safeId}" data-status="${ui.escapeHtml(status)}" title="လွှဲပြောင်းမှု ပယ်ဖျက်မည် (Cancel)" 
                    class="btn-cancel-trf w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-rose-500 hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-xs active:scale-95">
                    <i class="fa-solid fa-ban text-xs"></i>
                </button>
            `);
        }

        const actionHtml = actionBtns.length > 0
            ? `<div class="flex items-center justify-center gap-1.5">${actionBtns.join("")}</div>`
            : `<span class="text-[10px] text-slate-400 font-bold">${status === "received" || status === "completed" ? "လက်ခံပြီး" : "ပယ်ဖျက်ပြီး"}</span>`;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";
        tr.innerHTML = `
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 w-28">${ui.escapeHtml(dateStr)}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-400 w-28 truncate" title="${ui.escapeHtml(t.barcode || t.sku || "-")}">${ui.escapeHtml(t.barcode || t.sku || "-")}</td>
            <td class="py-2 px-4 text-left text-xs font-bold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${ui.escapeHtml(t.category || "-")}">${ui.escapeHtml(t.category || "-")}</td>
            <td class="py-2 px-4 text-left text-xs font-extrabold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${ui.escapeHtml(t.item_name || "-")}">${ui.escapeHtml(t.item_name || "-")}</td>
            <td class="py-2 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 w-24 truncate" title="${ui.escapeHtml(t.color || "-")}">${ui.escapeHtml(t.color || "-")}</td>
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${ui.escapeHtml(unit)}</td>
            <td class="py-2 px-4 text-right font-mono font-black text-sm text-purple-600 dark:text-purple-400 w-28">
                ${Number(t.quantity || 0).toLocaleString()}
            </td>
            <td class="py-2 px-4 text-left text-xs font-bold text-slate-700 dark:text-slate-300 w-32 truncate" title="${ui.escapeHtml(t.from_branch_name || "Main")}">
                ${ui.escapeHtml(t.from_branch_name || "Main")}
            </td>
            <td class="py-2 px-4 text-left text-xs font-bold text-blue-600 dark:text-blue-400 w-32 truncate" title="${ui.escapeHtml(t.to_branch_name || "-")}">
                ${ui.escapeHtml(t.to_branch_name || "-")}
            </td>
            <td class="py-2 px-4 text-xs font-semibold text-slate-600 dark:text-slate-300 min-w-[160px] truncate" title="${ui.escapeHtml(t.notes || "")}">
                ${ui.statusBadge(status)} <span class="ml-1">${ui.escapeHtml(t.notes || "")}</span>
            </td>
            <td class="py-2 px-4 text-left font-mono text-[11px] font-bold text-slate-400 w-40 truncate" title="${ui.escapeHtml(t.transfer_no || "-")}">
                ${ui.escapeHtml(t.transfer_no || "-")}
            </td>
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-32">
                ${actionHtml}
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-dispatch-trf").forEach(btn => {
        btn.onclick = () => dispatchTransfer(Number(btn.dataset.id));
    });

    tbody.querySelectorAll(".btn-receive-trf").forEach(btn => {
        btn.onclick = () => receiveTransfer(Number(btn.dataset.id));
    });

    tbody.querySelectorAll(".btn-cancel-trf").forEach(btn => {
        btn.onclick = () => cancelTransfer(Number(btn.dataset.id), btn.dataset.status);
    });

    pagination.renderControls("transfers-pagination");
}

function openCreateTransferModal() {
    if (state.isAllBranches()) {
        return ui.toast.warning("ဆိုင်ခွဲအားလုံး (ALL View) မှ လွှဲပြောင်းမှု အသစ်ဖန်တီး၍ မရပါ။ ပေးပို့မည့် ဆိုင်ခွဲတစ်ခုကို အရင်ရွေးချယ်ပါ။");
    }

    const modal = document.getElementById("create-trf-modal");
    const prodSelect = document.getElementById("create-trf-prod-id");
    const destSelect = document.getElementById("create-trf-dest-branch");
    document.getElementById("create-trf-form")?.reset();

    const currentBranchId = Number(state.getBranchId());

    if (prodSelect) {
        prodSelect.innerHTML = `<option value="">-- ပစ္စည်း ရွေးချယ်ပါ --</option>`;
        availableProducts.forEach(p => {
            prodSelect.innerHTML += `<option value="${ui.escapeHtml(p.id)}" data-stock="${p.current_stock || 0}">
                ${ui.escapeHtml(p.item_name)} (${ui.escapeHtml(p.sku || "-")}) - လက်ကျန်: ${Number(p.current_stock || 0).toLocaleString()} ${ui.escapeHtml(p.size || "ထည်")}
            </option>`;
        });
    }

    if (destSelect) {
        destSelect.innerHTML = `<option value="">-- လက်ခံမည့် ဆိုင်ခွဲ ရွေးပါ --</option>`;
        branchesList.forEach(b => {
            if (Number(b.id) !== currentBranchId) {
                destSelect.innerHTML += `<option value="${ui.escapeHtml(b.id)}">${ui.escapeHtml(b.name)} (${ui.escapeHtml(b.code || "-")})</option>`;
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

    let fromBranchId;
    try {
        fromBranchId = state.requireWriteBranchId();
    } catch (err) {
        return ui.toast.warning(err.message);
    }

    const prodId = Number(document.getElementById("create-trf-prod-id")?.value);
    const toBranchId = Number(document.getElementById("create-trf-dest-branch")?.value);
    const qty = parseAnyNumber(document.getElementById("create-trf-qty")?.value, false);
    const notes = document.getElementById("create-trf-notes")?.value.trim();

    if (!prodId || !toBranchId || qty <= 0) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const prod = availableProducts.find(p => p.id === prodId);
    if (prod && qty > Number(prod.current_stock || 0)) {
        return ui.toast.warning(`လက်ရှိဆိုင်တွင် လက်ကျန်ပစ္စည်း (${prod.current_stock}) ထက် ပိုမို၍ လွှဲပြောင်း၍ မရပါ။`);
    }

    if (btn) btn.disabled = true;

    try {
        await api.post("/transfers", {
            from_branch_id: fromBranchId,
            to_branch_id: toBranchId,
            product_id: prodId,
            quantity: qty,
            notes
        });
        document.getElementById("create-trf-modal")?.classList.add("hidden");
        ui.toast.success("ဆိုင်ခွဲလွှဲပြောင်းစာရင်း (Pending) ဖန်တီးပြီးပါပြီ။ ပစ္စည်းပို့ဆောင်ချိန်တွင် 'ပို့မည် (Dispatch)' နှိပ်ပါ။");
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

async function dispatchTransfer(id) {
    const confirmed = await ui.confirm(
        "ဤပစ္စည်းအား ဆိုင်ခွဲသို့ စတင်ပို့ဆောင် (Dispatch) မည်မှာ သေချာပါသလား?\n(အတည်ပြုပါက ထွက်ဆိုင်လက်ကျန်မှ TRANSFER_OUT အဖြစ် ချက်ချင်း နုတ်ယူပါမည်)",
        "warning"
    );
    if (!confirmed) return;

    try {
        await api.post(`/transfers/${id}/dispatch`, {});
        ui.toast.success("ပစ္စည်းပို့ဆောင်မှု (Dispatched) မှတ်တမ်းတင်ပြီး ထွက်ဆိုင်စတော့မှ နုတ်ယူပြီးပါပြီ။");
        await Promise.all([
            loadProductsForTransfer(),
            loadTransfers()
        ]);
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function receiveTransfer(id) {
    const confirmed = await ui.confirm(
        "လွှဲပြောင်းပေးပို့လာသော ပစ္စည်းအား လက်ခံရရှိ (Receive) ပြီမှာ သေချာပါသလား?\n(အတည်ပြုပါက ဝင်ဆိုင်လက်ကျန်သို့ TRANSFER_IN အဖြစ် ချက်ချင်း ပေါင်းထည့်ပေးပါမည်)",
        "warning"
    );
    if (!confirmed) return;

    try {
        await api.post(`/transfers/${id}/receive`, {});
        ui.toast.success("ပစ္စည်းလက်ခံရရှိမှု (Received) အတည်ပြုပြီး ဝင်ဆိုင်စတော့သို့ ပေါင်းထည့်ပြီးပါပြီ။");
        await Promise.all([
            loadProductsForTransfer(),
            loadTransfers()
        ]);
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function cancelTransfer(id, currentStatus) {
    const msg = currentStatus === "dispatched"
        ? "ဤလွှဲပြောင်းမှုသည် ပို့ဆောင်ထားပြီး (Dispatched) ဖြစ်ပါသည်။ ပယ်ဖျက်ပါက ထွက်ဆိုင်သို့ စတော့ ပြန်လည်ပေါင်းထည့် (Reversal) ပေးပါမည်။ ပယ်ဖျက်ရန် သေချာပါသလား?"
        : "ဤ Pending လွှဲပြောင်းမှုစာရင်းကို ပယ်ဖျက်လိုပါသလား?";

    const confirmed = await ui.confirm(msg, "error");
    if (!confirmed) return;

    try {
        await api.post(`/transfers/${id}/cancel`, { reason: "Cancelled by user" });
        ui.toast.success("လွှဲပြောင်းမှုမှတ်တမ်း ပယ်ဖျက်ပြီးပါပြီ။");
        await Promise.all([
            loadProductsForTransfer(),
            loadTransfers()
        ]);
    } catch (err) {
        ui.toast.error("ပယ်ဖျက်၍မရပါ: " + err.message);
    }
}

function exportTransfersToCSV() {
    const dataToExport = currentFilteredTransfers.length > 0 ? currentFilteredTransfers : transfersList;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် လွှဲပြောင်းမှုစာရင်း မရှိပါ။");
    }

    let csvContent = "NO,DATE,BARCODE,CATEGORY,ITEM NAME,COLOR,UNIT,QTY,FROM SHOP,TO SHOP,STATUS,REMARK,TRF NO\n";

    dataToExport.forEach((t, idx) => {
        const no = idx + 1;
        const dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB") : "-";

        const row = [
            no,
            ui.escapeCsv(dateStr),
            ui.escapeCsv(t.barcode || t.sku),
            ui.escapeCsv(t.category),
            ui.escapeCsv(t.item_name),
            ui.escapeCsv(t.color),
            ui.escapeCsv(t.size || "ထည်"),
            t.quantity || 0,
            ui.escapeCsv(t.from_branch_name),
            ui.escapeCsv(t.to_branch_name),
            ui.escapeCsv(t.status || "pending"),
            ui.escapeCsv(t.notes),
            ui.escapeCsv(t.transfer_no)
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
