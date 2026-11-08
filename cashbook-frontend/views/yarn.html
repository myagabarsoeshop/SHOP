// cashbook-frontend/js/modules/yarn.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Import Professional UI (Toast & Confirm)
import { setKPI } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let yarnList = [];
let currentFilteredYarns = [];

// ချည်စာရင်းအတွက် စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Controller
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
 * ချည်ယူနစ် Free Size ဖြစ်နေပါက ပေါင် ဟု အလိုအလျောက် ပြောင်းလဲသတ်မှတ်ခြင်း
 */
function getYarnUnit(item) {
    const sz = String(item.size || "").trim();
    if (!sz || sz.toLowerCase() === "free size" || sz.toLowerCase() === "free") {
        return "ပေါင်";
    }
    return sz;
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

    // Refresh Button (Stock Balances ကဲ့သို့ ထည့်သွင်းခြင်း)
    const refreshBtn = document.getElementById("btn-refresh-yarn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadYarnInventory();
            setTimeout(() => icon?.classList.remove("fa-spin"), 500);
            ui.toast.info("ချည်လက်ကျန် စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

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
        tbody.innerHTML = `<tr><td colspan="12" class="p-16 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl mb-3"></i><div class="font-bold text-xs">ချည်စာရင်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const res = await api.get("/products", { branch_id: branchId });
        const allProducts = res.data || [];
        
        // Category ကို အဓိကထား စစ်ဆေးပြီး အထည်အမည်များကို ဖယ်ထုတ်ခြင်း
        yarnList = allProducts.filter(p => {
            const cat = (p.category || "").trim().toLowerCase();
            const name = (p.item_name || "").toLowerCase();

            // ပုဆိုး၊ လုံချည်၊ အင်္ကျီ ဖြစ်ပါက လုံးဝ ဖယ်ထုတ်မည်
            if (cat.includes("ပုဆိုး") || cat.includes("လုံချည်") || cat.includes("အင်္ကျီ") || 
                name.includes("ပုဆိုး") || name.includes("လုံချည်") || name.includes("အင်္ကျီ")) {
                return false;
            }

            return cat === "ချည်" || cat === "yarn" || cat.startsWith("ချည်");
        });

        currentFilteredYarns = [...yarnList];
        updateYarnKPIs();
        pagination.reset();
        renderTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="12" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
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

    currentFilteredYarns = yarnList.filter(y => {
        if (!kw) return true;
        const hay = `${y.sku || ""} ${y.barcode || ""} ${y.item_name || ""} ${y.color || ""} ${y.size || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderTable();
}

/**
 * Yarn Table Rendering (Stock Balances နှင့် တစ်ထပ်တည်း မျဉ်းတားမဲ့ Flat Row, ၁၂ ကော်လံ)
 */
function renderTable() {
    const tbody = document.getElementById("yarn-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredYarns.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-scroll text-3xl mb-3 opacity-30"></i>
                    <div>ချည်လက်ကျန်စာရင်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("yarn-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredYarns);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((item, idx) => {
        const stock = Number(item.current_stock || 0);
        const isLow = stock <= Number(item.alert_quantity || 10);
        const unit = getYarnUnit(item);

        const actionButtons = state.isAdmin() ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${item.id}" title="ရက်ကန်းသို့ ချည်ထုတ်ပေးမည်" 
                    class="btn-issue-row w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 dark:hover:bg-amber-500 text-amber-600 hover:text-white dark:text-amber-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-hand-holding-hand text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="အချက်အလက် ပြင်ဆင်မည်" 
                    class="btn-edit-yarn w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="စာရင်းမှ ဖျက်မည်" 
                    class="btn-delete-yarn w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${item.id}" title="ရက်ကန်းသို့ ချည်ထုတ်ပေးမည်" 
                    class="btn-issue-row w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 dark:hover:bg-amber-500 text-amber-600 hover:text-white dark:text-amber-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-hand-holding-hand text-xs"></i>
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
            
            <!-- 8. PURCHASE -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-slate-700 dark:text-slate-300 w-28">${Number(item.cost_price || 0).toLocaleString()}</td>
            
            <!-- 9. WHOLESALE -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-blue-600 dark:text-blue-400 w-28">${Number(item.wholesale_price || 0).toLocaleString()}</td>
            
            <!-- 10. RETAIL -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 w-28">${Number(item.retail_price || 0).toLocaleString()}</td>
            
            <!-- 11. TOTAL STOCK (ယူနစ်စာသားမပါဘဲ ဂဏန်းသီးသန့်) -->
            <td class="py-2 px-4 text-right font-mono text-base font-black ${isLow ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'} w-32">
                ${stock.toLocaleString()}
            </td>

            <!-- 12. STATUS -->
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

    pagination.renderControls("yarn-pagination");
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
        const unit = getYarnUnit(y);
        select.innerHTML += `<option value="${y.id}" ${isSel} data-stock="${y.current_stock || 0}">
            ${escapeHtml(y.item_name)} (${escapeHtml(y.sku || "-")}) - လက်ကျန်: ${Number(y.current_stock || 0).toLocaleString()} ${escapeHtml(unit)}
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
    const yarnId = parseInt(document.getElementById("issue-yarn-id")?.value, 10);
    const weaverName = document.getElementById("issue-weaver-name")?.value.trim();
    const qty = parseFloat(document.getElementById("issue-quantity")?.value) || 0;
    const notes = document.getElementById("issue-notes")?.value.trim();
    const branchId = state.currentBranch?.id || 1;

    if (!yarnId || !weaverName || qty <= 0) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const item = yarnList.find(y => y.id === yarnId);
    if (item && qty > Number(item.current_stock || 0)) {
        const unit = getYarnUnit(item);
        return ui.toast.warning(`လက်ကျန်ချည်ပမာဏ (${item.current_stock} ${unit}) ထက် ပိုမို၍ ထုတ်ပေး၍မရပါ။`);
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
        ui.toast.success("ရက်ကန်းသို့ ချည်ထုတ်ပေးမှု အောင်မြင်ပါသည်။ ချည်စတော့မှ နုတ်ပြီးပါပြီ။");
        await loadYarnInventory();
    } catch (err) {
        ui.toast.error("ထုတ်ပေး၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- ချည်အချက်အလက် ပြင်ဆင်ခြင်း Modal Logic (Admin) ---
function openEditYarnModal(item) {
    const unit = getYarnUnit(item);
    document.getElementById("edit-yarn-id").value = item.id;
    document.getElementById("edit-yarn-sku").value = item.sku || "";
    document.getElementById("edit-yarn-name").value = item.item_name || "";
    document.getElementById("edit-yarn-color").value = item.color || "";
    document.getElementById("edit-yarn-unit").value = unit;
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
        size: document.getElementById("edit-yarn-unit")?.value.trim() || "ပေါင်",
        costPrice: parseFloat(document.getElementById("edit-yarn-cost")?.value) || 0,
        retailPrice: parseFloat(document.getElementById("edit-yarn-retail")?.value) || 0,
        wholesalePrice: parseFloat(document.getElementById("edit-yarn-wholesale")?.value) || 0
    };

    if (!payload.itemName) {
        return ui.toast.warning("ချည်အမည် ထည့်သွင်းပေးပါ။");
    }

    if (btn) btn.disabled = true;

    try {
        await api.put(`/products/${id}`, payload);
        document.getElementById("yarn-edit-modal")?.classList.add("hidden");
        ui.toast.success("ချည်အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
        await loadYarnInventory();
    } catch (err) {
        ui.toast.error("ပြင်ဆင်၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteYarn(id) {
    const confirmed = await ui.confirm("ဤချည်စာရင်းကို အမှန်တကယ် ဖျက်ပစ်ရန် သေချာပါသလား?", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/products/${id}`);
        ui.toast.success("ချည်စာရင်းမှ ဖျက်သိမ်းပြီးပါပြီ။");
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
    const currentYear = new Date().getFullYear();
    let csvContent = "Yarn SKU,Barcode,Category,Item Name,Design,Color,Unit,Cost Price,Wholesale Price,Retail Price,Current Stock\n";

    dataToExport.forEach(y => {
        const unit = getYarnUnit(y);
        const row = [
            escapeCsv(y.sku),
            escapeCsv(y.barcode),
            escapeCsv(y.category),
            escapeCsv(y.item_name),
            escapeCsv(y.pattern),
            escapeCsv(y.color),
            escapeCsv(unit),
            y.cost_price || 0,
            y.wholesale_price || 0,
            y.retail_price || 0,
            y.current_stock || 0
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Yarn_Balances_FY${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
