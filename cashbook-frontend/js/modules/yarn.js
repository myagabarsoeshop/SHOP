// cashbook-frontend/js/modules/yarn.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";

let yarnList = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initYarn() {
    bindEvents();
    await loadYarnInventory();
}

function bindEvents() {
    // Search Box
    document.getElementById("yarn-search")?.addEventListener("input", filterAndRender);

    // Export CSV
    document.getElementById("btn-export-yarn-csv")?.addEventListener("click", exportYarnToCSV);

    // Issue Modal Events
    document.getElementById("btn-open-issue-modal")?.addEventListener("click", () => openIssueModal());
    document.getElementById("btn-close-yarn-issue-modal")?.addEventListener("click", () => {
        document.getElementById("yarn-issue-modal")?.classList.add("hidden");
    });
    document.getElementById("yarn-issue-form")?.addEventListener("submit", submitYarnIssue);

    // Issue Select Change (Stock Hint Update)
    document.getElementById("issue-yarn-id")?.addEventListener("change", (e) => {
        updateIssueStockHint(Number(e.target.value));
    });

    // Edit Modal Events
    document.getElementById("btn-close-yarn-edit-modal")?.addEventListener("click", () => {
        document.getElementById("yarn-edit-modal")?.classList.add("hidden");
    });
    document.getElementById("yarn-edit-form")?.addEventListener("submit", submitEditYarn);
}

async function loadYarnInventory() {
    const tbody = document.getElementById("yarn-table-body");
    const branchId = state.currentBranch?.id || 1;

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        // Products ထဲမှ Category တွင် "ချည်" သို့မဟုတ် "yarn" ပါဝင်သော စာရင်းများကို ရယူခြင်း
        const res = await api.get("/products", { branch_id: branchId });
        const allProducts = res.data || [];
        
        yarnList = allProducts.filter(p => {
            const cat = (p.category || "").toLowerCase();
            const name = (p.item_name || "").toLowerCase();
            return cat.includes("ချည်") || cat.includes("yarn") || name.includes("ချည်");
        });

        updateYarnKPIs();
        renderTable(yarnList);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function updateYarnKPIs() {
    const totalTypes = yarnList.length;
    const totalStock = yarnList.reduce((sum, y) => sum + Number(y.current_stock || 0), 0);
    const totalStockValue = yarnList.reduce((sum, y) => sum + (Number(y.current_stock || 0) * Number(y.cost_price || 0)), 0);
    const lowStockCount = yarnList.filter(y => Number(y.current_stock || 0) <= Number(y.alert_quantity || 10)).length;

    setKPI(1, "ချည်အမျိုးအစားပေါင်း", totalTypes, "fa-tags", "blue");
    setKPI(2, "စုစုပေါင်း ချည်လက်ကျန်", totalStock, "fa-scroll", "emerald");
    setKPI(3, "ချည်တန်ဖိုး စုစုပေါင်း", totalStockValue, "fa-vault", "amber");
    setKPI(4, "လက်ကျန်နည်း ချည်အမျိုးအစား", lowStockCount, "fa-triangle-exclamation", "rose");
}

function filterAndRender() {
    const kw = (document.getElementById("yarn-search")?.value || "").trim().toLowerCase();

    const filtered = yarnList.filter(y => {
        if (!kw) return true;
        const hay = `${y.sku || ""} ${y.barcode || ""} ${y.item_name || ""} ${y.color || ""} ${y.size || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderTable(filtered);
}

function renderTable(list) {
    const tbody = document.getElementById("yarn-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-12 text-center text-slate-400 font-bold text-base">ချည်လက်ကျန်စာရင်း မရှိသေးပါ</td></tr>`;
        return;
    }

    list.forEach(item => {
        const stock = Number(item.current_stock || 0);
        const isLow = stock <= Number(item.alert_quantity || 10);
        const unit = item.size || "lb";

        // Action Buttons (ရက်ကန်းထုတ် = Amber ၊ Edit = Blue ၊ Delete = Rose)
        const actionButtons = state.isAdmin() ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${item.id}" title="ရက်ကန်းသို့ ချည်ထုတ်ပေးမည်" class="btn-issue-row w-8 h-8 flex items-center justify-center bg-amber-500/10 hover:bg-amber-500 hover:text-white rounded-lg text-amber-600 dark:text-amber-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-hand-holding-hand text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="အချက်အလက် ပြင်ဆင်မည်" class="btn-edit-yarn w-8 h-8 flex items-center justify-center bg-blue-500/10 hover:bg-blue-600 hover:text-white rounded-lg text-blue-600 dark:text-blue-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="စာရင်းမှ ဖျက်မည်" class="btn-delete-yarn w-8 h-8 flex items-center justify-center bg-rose-500/10 hover:bg-rose-600 hover:text-white rounded-lg text-rose-500 dark:text-rose-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${item.id}" title="ရက်ကန်းသို့ ချည်ထုတ်ပေးမည်" class="btn-issue-row px-3 py-1 bg-amber-500/10 hover:bg-amber-500 hover:text-white rounded-lg text-amber-600 dark:text-amber-400 font-bold text-xs transition cursor-pointer">
                    <i class="fa-solid fa-hand-holding-hand mr-1"></i> ရက်ကန်းထုတ်
                </button>
            </div>
        `;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-slate-800 dark:text-slate-200 text-base">${escapeHtml(item.sku || "-")}</div>
                <div class="text-xs">${escapeHtml(item.barcode || "")}</div>
            </td>
            <td class="p-4">
                <div class="font-bold text-slate-900 dark:text-white text-base">${escapeHtml(item.item_name)}</div>
                <div class="text-xs text-slate-400">${escapeHtml(item.pattern || "-")}</div>
            </td>
            <td class="p-4 text-sm font-bold text-slate-700 dark:text-slate-300">
                ${escapeHtml(item.color || "-")}
            </td>
            <td class="p-4 text-center font-bold text-xs">
                <span class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400">
                    ${escapeHtml(unit)}
                </span>
            </td>
            <td class="p-4 text-right font-mono text-base text-slate-500">
                ${Number(item.cost_price || 0).toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                ${Number(item.retail_price || 0).toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-bold text-base text-blue-600 dark:text-blue-400">
                ${Number(item.wholesale_price || 0).toLocaleString()}
            </td>
            <td class="p-4 text-center">
                <span class="px-3.5 py-1.5 rounded-xl font-mono font-black text-base ${isLow ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}">
                    ${stock.toLocaleString()}
                </span>
            </td>
            <td class="p-4 text-center">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Row Actions Events
    tbody.querySelectorAll(".btn-issue-row").forEach(btn => {
        btn.onclick = () => {
            const item = yarnList.find(y => y.id === Number(btn.dataset.id));
            if (item) openIssueModal(item.id);
        };
    });

    if (state.isAdmin()) {
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
}

// --- ရက်ကန်းသို့ ချည်ထုတ်ပေးခြင်း Modal Logic ---
function openIssueModal(selectedYarnId = null) {
    const modal = document.getElementById("yarn-issue-modal");
    const select = document.getElementById("issue-yarn-id");
    document.getElementById("yarn-issue-form")?.reset();

    if (!select) return;
    select.innerHTML = `<option value="">-- ချည်အမျိုးအစား ရွေးချယ်ပါ --</option>`;

    yarnList.forEach(y => {
        const isSel = selectedYarnId && selectedYarnId === y.id ? "selected" : "";
        select.innerHTML += `<option value="${y.id}" ${isSel} data-stock="${y.current_stock || 0}">
            ${escapeHtml(y.item_name)} (${escapeHtml(y.sku || "-")}) - လက်ကျန်: ${y.current_stock || 0} ${escapeHtml(y.size || "lb")}
        </option>`;
    });

    const activeId = selectedYarnId || Number(select.value);
    updateIssueStockHint(activeId);

    modal?.classList.remove("hidden");
    document.getElementById("issue-weaver-name")?.focus();
}

function updateIssueStockHint(yarnId) {
    const hint = document.getElementById("issue-stock-hint");
    const qtyInput = document.getElementById("issue-quantity");
    const item = yarnList.find(y => y.id === yarnId);

    if (item && hint) {
        const stock = Number(item.current_stock || 0);
        hint.textContent = `လက်ရှိစတိုလက်ကျန်: ${stock.toLocaleString()} ${item.size || "lb"}`;
        if (qtyInput) qtyInput.max = stock;
    } else if (hint) {
        hint.textContent = "";
    }
}

async function submitYarnIssue(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-yarn-issue");
    const yarnId = parseInt(document.getElementById("issue-yarn-id")?.value, 10);
    const weaverName = document.getElementById("issue-weaver-name")?.value.trim();
    const qty = parseFloat(document.getElementById("issue-quantity")?.value) || 0;
    const notes = document.getElementById("issue-notes")?.value.trim();
    const branchId = state.currentBranch?.id || 1;

    if (!yarnId || !weaverName || qty <= 0) {
        return alert("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const item = yarnList.find(y => y.id === yarnId);
    if (item && qty > Number(item.current_stock || 0)) {
        return alert(`လက်ကျန်ချည်ပမာဏ (${item.current_stock}) ထက် ပိုမို၍ ထုတ်ပေး၍မရပါ။`);
    }

    if (btn) btn.disabled = true;

    const payload = {
        branchId: branchId,
        yarnId: yarnId,
        weaverName: weaverName,
        quantity: qty,
        notes: notes,
        createdBy: state.user?.id || 1
    };

    try {
        await api.post("/yarns/issue", payload);
        document.getElementById("yarn-issue-modal")?.classList.add("hidden");
        alert("ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု အောင်မြင်ပါသည်။ ချည်စတော့မှ နုတ်ပြီးပါပြီ။");
        await loadYarnInventory();
    } catch (err) {
        alert("ထုတ်ပေး၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- ချည်အချက်အလက် ပြင်ဆင်ခြင်း Modal Logic (Admin) ---
function openEditYarnModal(item) {
    document.getElementById("edit-yarn-id").value = item.id;
    document.getElementById("edit-yarn-sku").value = item.sku || "";
    document.getElementById("edit-yarn-name").value = item.item_name || "";
    document.getElementById("edit-yarn-color").value = item.color || "";
    document.getElementById("edit-yarn-unit").value = item.size || "lb";
    document.getElementById("edit-yarn-cost").value = item.cost_price || 0;
    document.getElementById("edit-yarn-retail").value = item.retail_price || 0;
    document.getElementById("edit-yarn-wholesale").value = item.wholesale_price || 0;

    document.getElementById("yarn-edit-modal")?.classList.remove("hidden");
    document.getElementById("edit-yarn-name")?.focus();
}

async function submitEditYarn(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-save-yarn-edit");
    const id = document.getElementById("edit-yarn-id")?.value;

    const payload = {
        sku: document.getElementById("edit-yarn-sku")?.value.trim() || null,
        itemName: document.getElementById("edit-yarn-name")?.value.trim(),
        color: document.getElementById("edit-yarn-color")?.value.trim() || null,
        size: document.getElementById("edit-yarn-unit")?.value.trim() || "lb",
        costPrice: parseFloat(document.getElementById("edit-yarn-cost")?.value) || 0,
        retailPrice: parseFloat(document.getElementById("edit-yarn-retail")?.value) || 0,
        wholesalePrice: parseFloat(document.getElementById("edit-yarn-wholesale")?.value) || 0
    };

    if (!payload.itemName) return alert("ချည်အမည် ထည့်သွင်းပေးပါ");

    if (btn) btn.disabled = true;

    try {
        await api.put(`/products/${id}`, payload);
        document.getElementById("yarn-edit-modal")?.classList.add("hidden");
        alert("ချည်အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
        await loadYarnInventory();
    } catch (err) {
        alert("ပြင်ဆင်၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteYarn(id) {
    if (!confirm("ဤချည်စာရင်းကို အမှန်တကယ် ဖျက်ပစ်ရန် သေချာပါသလား?")) return;
    try {
        await api.delete(`/products/${id}`);
        await loadYarnInventory();
    } catch (err) {
        alert("ဖျက်၍မရပါ: " + err.message);
    }
}

function exportYarnToCSV() {
    if (yarnList.length === 0) {
        alert("ထုတ်ယူရန် ချည်စာရင်း မရှိပါ။");
        return;
    }
    const currentYear = new Date().getFullYear();
    let csvContent = "Yarn SKU,Barcode,Item Name,Color,Unit,Cost Price,Retail Price,Wholesale Price,Current Stock\n";

    yarnList.forEach(y => {
        const row = [
            `"${escapeHtml(y.sku || '')}"`,
            `"${escapeHtml(y.barcode || '')}"`,
            `"${escapeHtml(y.item_name || '')}"`,
            `"${escapeHtml(y.color || '')}"`,
            `"${escapeHtml(y.size || 'lb')}"`,
            y.cost_price || 0,
            y.retail_price || 0,
            y.wholesale_price || 0,
            y.current_stock || 0
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Yarn_Balances_FY${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
