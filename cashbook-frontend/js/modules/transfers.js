// cashbook-frontend/js/modules/transfers.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";

let transfersList = [];
let branchesList = [];
let availableProducts = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initTransfers() {
    bindEvents();
    await loadBranches();
    await loadProductsForTransfer();
    await loadTransfers();
}

function bindEvents() {
    // Search Box
    document.getElementById("trf-search")?.addEventListener("input", filterAndRender);

    // Export CSV
    document.getElementById("btn-export-trf-csv")?.addEventListener("click", exportTransfersToCSV);

    // Create Modal Events
    document.getElementById("btn-open-create-transfer")?.addEventListener("click", () => openCreateTransferModal());
    document.getElementById("btn-close-create-trf")?.addEventListener("click", () => {
        document.getElementById("create-trf-modal")?.classList.add("hidden");
    });
    document.getElementById("create-trf-form")?.addEventListener("submit", submitCreateTransfer);

    // Create Modal Product Change Event (Stock Hint & Max Limit Update)
    document.getElementById("create-trf-prod-id")?.addEventListener("change", (e) => {
        updateCreateTransferStockHint(Number(e.target.value));
    });

    // Edit Modal Events
    document.getElementById("btn-close-edit-trf")?.addEventListener("click", () => {
        document.getElementById("edit-trf-modal")?.classList.add("hidden");
    });
    document.getElementById("edit-trf-form")?.addEventListener("submit", submitEditTransfer);
}

async function loadBranches() {
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
        tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-purple-500 text-2xl"></i></td></tr>`;
    }

    try {
        const res = await api.get("/transfers", { branch_id: branchId });
        transfersList = res.data || [];

        updateTransferKPIs();
        renderTable(transfersList);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function updateTransferKPIs() {
    const currentBranchId = state.currentBranch?.id || 1;

    // ၁။ စုစုပေါင်း လွှဲပြောင်းမှု အကြိမ်
    const totalCount = transfersList.length;

    // ၂။ စုစုပေါင်း ပစ္စည်းပမာဏ
    const totalQty = transfersList.reduce((sum, t) => sum + Number(t.quantity || 0), 0);

    // ၃။ လက်ရှိဆိုင်မှ ပေးပို့မှု (Outbound Stock)
    const outboundQty = transfersList
        .filter(t => Number(t.from_branch_id) === currentBranchId)
        .reduce((sum, t) => sum + Number(t.quantity || 0), 0);

    // ၄။ လက်ရှိဆိုင်သို့ လက်ခံရရှိမှု (Inbound Stock)
    const inboundQty = transfersList
        .filter(t => Number(t.to_branch_id) === currentBranchId)
        .reduce((sum, t) => sum + Number(t.quantity || 0), 0);

    setKPI(1, "စုစုပေါင်း လွှဲပြောင်းမှုအကြိမ်", totalCount, "fa-right-left", "blue");
    setKPI(2, "စုစုပေါင်း ပစ္စည်းပမာဏ", totalQty, "fa-boxes-stacked", "emerald");
    setKPI(3, "ဆိုင်မှ ထုတ်ပေးမှု (Outbound)", outboundQty, "fa-truck-arrow-right", "amber");
    setKPI(4, "ဆိုင်သို့ လက်ခံမှု (Inbound)", inboundQty, "fa-parachute-box", "purple");
}

function filterAndRender() {
    const kw = (document.getElementById("trf-search")?.value || "").trim().toLowerCase();

    const filtered = transfersList.filter(t => {
        if (!kw) return true;
        const hay = `${t.transfer_no || ""} ${t.sku || ""} ${t.barcode || ""} ${t.item_name || ""} ${t.from_branch_name || ""} ${t.to_branch_name || ""} ${t.notes || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderTable(filtered);
}

function renderTable(list) {
    const tbody = document.getElementById("trf-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="p-12 text-center text-slate-400 font-bold text-base">လွှဲပြောင်းမှု မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    const currentBranchId = state.currentBranch?.id || 1;

    list.forEach(t => {
        const isOutbound = Number(t.from_branch_id) === currentBranchId;
        const dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB") : "-";
        const unit = t.size || "ထည်";

        const actionButtons = state.isAdmin() ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${t.id}" title="ပြင်ဆင်မည်" class="btn-edit-trf w-8 h-8 flex items-center justify-center bg-blue-500/10 hover:bg-blue-600 hover:text-white rounded-lg text-blue-600 dark:text-blue-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${t.id}" title="ဖျက်သိမ်းပြီး စတော့ပြန်ညှိမည်" class="btn-delete-trf w-8 h-8 flex items-center justify-center bg-rose-500/10 hover:bg-rose-600 hover:text-white rounded-lg text-rose-500 dark:text-rose-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `
            <span class="text-xs text-slate-400 font-mono">-</span>
        `;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-purple-600 dark:text-purple-400 text-sm">${escapeHtml(t.transfer_no || "-")}</div>
                <div class="text-xs text-slate-400">${dateStr}</div>
            </td>
            <td class="p-4">
                <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${isOutbound ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">
                    ${escapeHtml(t.from_branch_name || "Main")} (${escapeHtml(t.from_branch_code || "-")})
                </span>
            </td>
            <td class="p-4">
                <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${!isOutbound ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">
                    ${escapeHtml(t.to_branch_name || "-")} (${escapeHtml(t.to_branch_code || "-")})
                </span>
            </td>
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-slate-800 dark:text-slate-200 text-base">${escapeHtml(t.sku || "-")}</div>
                <div class="text-xs">${escapeHtml(t.barcode || "")}</div>
            </td>
            <td class="p-4">
                <div class="font-bold text-slate-900 dark:text-white text-base">${escapeHtml(t.item_name || "-")}</div>
                <div class="text-xs text-slate-400">${escapeHtml(t.pattern || "-")} | <span class="text-emerald-500 font-bold">${escapeHtml(t.category || "-")}</span></div>
            </td>
            <td class="p-4 text-sm font-bold text-slate-700 dark:text-slate-300">
                <div>${escapeHtml(t.color || "-")}</div>
                <div class="text-xs text-purple-600 dark:text-purple-400 font-bold">${escapeHtml(unit)}</div>
            </td>
            <td class="p-4 text-center">
                <span class="px-3.5 py-1.5 rounded-xl font-mono font-black text-base bg-purple-500/15 text-purple-600 dark:text-purple-400">
                    ${Number(t.quantity || 0).toLocaleString()} <span class="text-xs font-normal font-sans">${escapeHtml(unit)}</span>
                </span>
            </td>
            <td class="p-4 text-xs text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title="${escapeHtml(t.notes || '')}">
                ${escapeHtml(t.notes || "-")}
            </td>
            <td class="p-4 text-xs font-bold text-slate-700 dark:text-slate-300">
                ${escapeHtml(t.created_by_name || "Admin")}
            </td>
            <td class="p-4 text-center">
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
}

// --- Create Transfer Modal Logic ---
function openCreateTransferModal() {
    const modal = document.getElementById("create-trf-modal");
    const prodSelect = document.getElementById("create-trf-prod-id");
    const destSelect = document.getElementById("create-trf-dest-branch");
    document.getElementById("create-trf-form")?.reset();

    const currentBranchId = state.currentBranch?.id || 1;

    // ပစ္စည်းစာရင်း ဖြည့်သွင်းခြင်း
    if (prodSelect) {
        prodSelect.innerHTML = `<option value="">-- ပစ္စည်း ရွေးချယ်ပါ --</option>`;
        availableProducts.forEach(p => {
            prodSelect.innerHTML += `<option value="${p.id}" data-stock="${p.current_stock || 0}">
                ${escapeHtml(p.item_name)} (${escapeHtml(p.sku || "-")}) - လက်ကျန်: ${Number(p.current_stock || 0).toLocaleString()} ${escapeHtml(p.size || "ထည်")}
            </option>`;
        });
    }

    // ဆိုင်ခွဲစာရင်း ဖြည့်သွင်းခြင်း (လက်ရှိဆိုင်မှအပ ကျန်ဆိုင်များ)
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
    const qty = parseFloat(document.getElementById("create-trf-qty")?.value) || 0;
    const notes = document.getElementById("create-trf-notes")?.value.trim();
    const fromBranchId = state.currentBranch?.id || 1;

    if (!prodId || !toBranchId || qty <= 0) {
        return alert("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ");
    }

    const prod = availableProducts.find(p => p.id === prodId);
    if (prod && qty > Number(prod.current_stock || 0)) {
        return alert(`လက်ရှိဆိုင်တွင် လက်ကျန်ပစ္စည်း (${prod.current_stock}) ထက် ပိုမို၍ လွှဲပြောင်း၍ မရပါ`);
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
        alert("ဆိုင်ခွဲသို့ ပစ္စည်းလွှဲပြောင်းမှု အောင်မြင်ပါသည်။ လက်ကျန်စာရင်းများ ညှိပြီးပါပြီ။");
        await loadProductsForTransfer();
        await loadTransfers();
    } catch (err) {
        alert("လွှဲပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- Edit Transfer Modal Logic (Admin) ---
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
    document.getElementById("edit-trf-qty")?.focus();
}

async function submitEditTransfer(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-save-edit-trf");
    const id = document.getElementById("edit-trf-id")?.value;
    const newQty = parseFloat(document.getElementById("edit-trf-qty")?.value) || 0;
    const notes = document.getElementById("edit-trf-notes")?.value.trim();

    if (!id || newQty <= 0) {
        return alert("မှန်ကန်သော အရေအတွက် ထည့်သွင်းပေးပါ");
    }

    if (btn) btn.disabled = true;

    const payload = {
        quantity: newQty,
        notes: notes
    };

    try {
        await api.put(`/transfers/${id}`, payload);
        document.getElementById("edit-trf-modal")?.classList.add("hidden");
        alert("လွှဲပြောင်းမှုမှတ်တမ်း ပြင်ဆင်ပြီး စတော့များ ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await loadProductsForTransfer();
        await loadTransfers();
    } catch (err) {
        alert("ပြင်ဆင်၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteTransfer(id) {
    if (!confirm("ဤလွှဲပြောင်းမှုမှတ်တမ်းကို အမှန်တကယ် ပယ်ဖျက်လိုပါသလား?\n(ဆိုင်နှစ်ဖက်စလုံးရှိ စတော့များကို မူလအတိုင်း အလိုအလျောက် ပြန်ပေါင်း/နုတ် ပေးပါမည်)")) return;

    try {
        await api.delete(`/transfers/${id}`);
        alert("လွှဲပြောင်းမှုမှတ်တမ်း ပယ်ဖျက်ပြီး စတော့များ ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await loadProductsForTransfer();
        await loadTransfers();
    } catch (err) {
        alert("ဖျက်၍မရပါ: " + err.message);
    }
}

// --- CSV Export Logic ---
function exportTransfersToCSV() {
    if (transfersList.length === 0) {
        return alert("ထုတ်ယူရန် လွှဲပြောင်းမှုစာရင်း မရှိပါ။");
    }

    const currentYear = new Date().getFullYear();
    let csvContent = "Transfer No,Date,From Branch,To Branch,SKU,Barcode,Category,Item Name,Color,Unit,Quantity,Notes,Recorded By\n";

    transfersList.forEach(t => {
        const dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB") : "-";
        const row = [
            `"${escapeHtml(t.transfer_no || '')}"`,
            `"${dateStr}"`,
            `"${escapeHtml(t.from_branch_name || '')}"`,
            `"${escapeHtml(t.to_branch_name || '')}"`,
            `"${escapeHtml(t.sku || '')}"`,
            `"${escapeHtml(t.barcode || '')}"`,
            `"${escapeHtml(t.category || '')}"`,
            `"${escapeHtml(t.item_name || '')}"`,
            `"${escapeHtml(t.color || '')}"`,
            `"${escapeHtml(t.size || 'ထည်')}"`,
            t.quantity || 0,
            `"${escapeHtml(t.notes || '')}"`,
            `"${escapeHtml(t.created_by_name || 'Admin')}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Stock_Transfers_FY${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
