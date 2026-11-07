// cashbook-frontend/js/modules/cashbook.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Standardized UI tools (Toast, Confirm, escapeHtml, escapeCsv)
import { setKPI, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let entries = [];
let categories = [];
let currentFilteredEntries = [];

// Fallback Categories ("ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ" ထည့်သွင်းထားပါသည်)
const FALLBACK_CATEGORIES = [
    { id: 1, name: "အထည်ရောင်းရငွေ", type: "INCOME" },
    { id: 2, name: "အကြွေးပြန်ရငွေ", type: "INCOME" },
    { id: 3, name: "အခြားဝင်ငွေ", type: "INCOME" },
    { id: 4, name: "ချည်ဝယ်ယူစရိတ်", type: "EXPENSE" },
    { id: 5, name: "ရက်ကန်းလက်ခ / လုပ်အားခ", type: "EXPENSE" },
    { id: 6, name: "ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ်", type: "EXPENSE" },
    { id: 7, name: "သယ်ယူပို့ဆောင်ခ / ကားခ", type: "EXPENSE" },
    { id: 8, name: "ဝန်ထမ်းလစာ / ကြိုထုတ်ငွေ", type: "EXPENSE" },
    { id: 10, name: "ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ", type: "EXPENSE" }
];

// စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Instance
const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

/**
 * မြန်မာဂဏန်း (၀၁၂၃၄၅၆၇၈၉) မှ အင်္ဂလိပ်ဂဏန်း (0123456789) သို့ အလိုအလျောက် ပြောင်းလဲပေးသည့် Helper
 */
function parseAnyNumber(val) {
    if (!val && val !== 0) return 0;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let cleanStr = String(val).replace(/,/g, "").trim();
    myanmarDigits.forEach((d, idx) => {
        cleanStr = cleanStr.replaceAll(d, String(idx));
    });
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
}

export async function initCashbook() {
    const dateInput = document.getElementById("cb-date-filter");
    if (dateInput) dateInput.value = getLocalTodayDate();

    bindEvents();
    await loadCategories();
    await loadEntries();
}

function bindEvents() {
    // 1. Consolidated Add New Button
    document.getElementById("btn-open-add-modal")?.addEventListener("click", () => openModal("EXPENSE"));

    // Modal Close
    document.getElementById("btn-close-entry-modal")?.addEventListener("click", () => {
        document.getElementById("entry-modal")?.classList.add("hidden");
    });

    // 2. Modal Switcher Tabs
    document.getElementById("tab-btn-expense")?.addEventListener("click", () => switchModalTab("EXPENSE"));
    document.getElementById("tab-btn-income")?.addEventListener("click", () => switchModalTab("INCOME"));

    // 3. Category Change ဖြစ်သည့်အခါ Description တွင် သက်ဆိုင်ရာ Auto Template ဖြည့်ပေးခြင်း
    document.getElementById("entry-category")?.addEventListener("change", (e) => {
        const descInput = document.getElementById("entry-desc");
        const selectedOpt = e.target.selectedOptions?.[0];
        const catName = selectedOpt ? selectedOpt.textContent : "";
        
        // ပိုင်ရှင်ထံလွှဲ/အပ်ငွေ ရွေးပါက အကြောင်းအရာ ရေးသားရလွယ်စေရန် ရှေ့ပြေးစာသား ထည့်ပေးခြင်း
        if (catName.includes("ပိုင်ရှင်") || catName.includes("အပ်ငွေ") || catName.includes("လွှဲ") || e.target.value == 10) {
            if (!descInput.value.trim() || descInput.value.startsWith("ဆိုင်ပိုင်ရှင်ထံ")) {
                descInput.value = "ဆိုင်ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ (လက်ခံသူ - )";
            }
        }
    });

    // 4. Form Submit
    document.getElementById("entry-form")?.addEventListener("submit", submitEntry);

    // 5. Date Filter Change
    document.getElementById("cb-date-filter")?.addEventListener("change", () => {
        pagination.reset();
        loadEntries();
    });

    // 6. Search Filter (Ref No, Surplus/Deficit အပါအဝင် ရှာဖွေနိုင်ခြင်း)
    document.getElementById("cb-search")?.addEventListener("input", (e) => {
        const kw = e.target.value.trim().toLowerCase();
        currentFilteredEntries = entries.filter(r => {
            const cat = (r.category_name || r.category || "").toLowerCase();
            const desc = (r.description || "").toLowerCase();
            const method = (r.payment_method || "").toLowerCase();
            const ref = (r.ref_no || r.reference_no || r.invoice_no || r.purchase_no || "").toLowerCase();
            return cat.includes(kw) || desc.includes(kw) || method.includes(kw) || ref.includes(kw);
        });
        pagination.reset();
        renderTable();
    });

    // 7. Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-cashbook");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadEntries();
            setTimeout(() => icon?.classList.remove("fa-spin"), 500);
            ui.toast.info("စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // 8. Export CSV
    document.getElementById("btn-export-csv")?.addEventListener("click", exportCSV);
}

async function loadCategories() {
    try {
        const res = await api.get("/cashbook/categories");
        categories = (res.data && res.data.length > 0) ? res.data : FALLBACK_CATEGORIES;
        if (!categories.some(c => c.id === 10 || c.name.includes("ပိုင်ရှင်"))) {
            categories.push({ id: 10, name: "ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ", type: "EXPENSE" });
        }
    } catch (err) {
        console.warn("Using fallback categories:", err.message);
        categories = FALLBACK_CATEGORIES;
    }
}

async function loadEntries() {
    const tbody = document.getElementById("cashbook-table-body");
    const date = document.getElementById("cb-date-filter")?.value || getLocalTodayDate();
    const branchId = state.currentBranch?.id || 1;

    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="p-16 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl mb-3 text-emerald-500"></i>
                    <div class="font-bold text-xs">ငွေစာရင်းများ ဆွဲယူနေပါသည်...</div>
                </td>
            </tr>
        `;
    }

    try {
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: date, end_date: date });
        entries = res.data?.entries || [];
        currentFilteredEntries = [...entries];

        const s = res.data?.summary || {};

        // ၁။ ဆိုင်ရှိ တကယ့်လက်ကျန်ငွေသား
        const cashBal = s.cash_balance !== undefined ? Number(s.cash_balance) : Number(s.cash?.net || 0);

        // ၂။ KPay/ဘဏ်အကောင့်ထဲရှိ တကယ့်လက်ကျန်ငွေ
        const bankBal = s.bank_balance !== undefined ? Number(s.bank_balance) : Number(s.bank?.net || 0);

        // ၃။ ယနေ့ စစ်မှန်သော ဆိုင်အသုံးစရိတ် နှင့် ပိုင်ရှင်ထံအပ်ငွေ ခွဲထုတ်တွက်ချက်ခြင်း
        let todayExpense = 0;
        let todayRemittance = 0;

        if (s.today_expense !== undefined && s.today_remittance !== undefined) {
            todayExpense = Number(s.today_expense);
            todayRemittance = Number(s.today_remittance);
        } else {
            entries.forEach(r => {
                const isExp = (r.entry_type || r.type || "").toUpperCase() === "EXPENSE";
                const cat = (r.category_name || r.category || "").toLowerCase();
                const amt = Number(r.amount || 0);
                if (isExp) {
                    if (cat.includes("ပိုင်ရှင်") || cat.includes("အပ်ငွေ") || cat.includes("လွှဲ") || r.category_id === 10) {
                        todayRemittance += amt;
                    } else {
                        todayExpense += amt;
                    }
                }
            });
        }

        // Standard KPI Boxes
        setKPI(1, "Cash Balance", cashBal, "fa-money-bill-wave", "emerald");
        setKPI(2, "Bank Balance", bankBal, "fa-building-columns", "blue");
        setKPI(3, "Total Expense", todayExpense, "fa-arrow-trend-down", "rose");
        setKPI(4, "Owner Remittance", todayRemittance, "fa-hand-holding-dollar", "purple");

        renderTable();
    } catch (err) {
        console.error("Load entries error:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍ မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

/**
 * Cash Book Table Rendering (AMOUNT နောက်တွင် REF နှင့် SURPLUS & DEFICIT ပါဝင်သော ၁၁ ကော်လံစနစ်)
 */
function renderTable() {
    const tbody = document.getElementById("cashbook-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredEntries.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-book-open text-3xl mb-3 opacity-30"></i>
                    <div>ရွေးချယ်ထားသော ရက်စွဲအတွက် မှတ်တမ်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("cashbook-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredEntries);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((item, idx) => {
        const entryType = (item.entry_type || item.type || "EXPENSE").toUpperCase();
        const isIncome = entryType === "INCOME";
        const sign = isIncome ? "+" : "-";

        // ၁။ Category Format & Color
        const catName = item.category_name || item.category || "General";
        const isRemittance = catName.includes("ပိုင်ရှင်") || catName.includes("အပ်ငွေ") || catName.includes("လွှဲ") || item.category_id === 10;

        let catColor = "text-slate-700 dark:text-slate-300";
        let amountColorClass = "text-rose-600 dark:text-rose-400";

        if (isRemittance) {
            catColor = "text-purple-600 dark:text-purple-400 font-bold";
            amountColorClass = "text-purple-600 dark:text-purple-400 font-bold";
        } else if (isIncome || catName.includes("ရောင်း")) {
            catColor = "text-emerald-600 dark:text-emerald-400 font-bold";
            amountColorClass = "text-emerald-600 dark:text-emerald-400";
        } else if (catName.includes("ဝယ်")) {
            catColor = "text-rose-600 dark:text-rose-400 font-bold";
            amountColorClass = "text-rose-600 dark:text-rose-400";
        } else {
            catColor = "text-amber-600 dark:text-amber-400 font-bold";
            amountColorClass = "text-rose-600 dark:text-rose-400";
        }

        // ၂။ Description စာသား (ဆိုင်အမည် / ပွဲရုံအမည် သို့မဟုတ် အကြောင်းအရာ အတိုချုပ်)
        let desc = String(item.description || "-");

        // ၃။ Method (CASH / BANK)
        const method = String(item.payment_method || "cash").toUpperCase();

        // ၄။ Qty (အရေအတွက်)
        const qtyVal = item.total_quantity || item.quantity;
        const hasQty = qtyVal !== undefined && qtyVal !== null && Number(qtyVal) > 0;
        const qtyStr = hasQty ? Number(qtyVal).toLocaleString() : "-";

        // ၅။ Price (နှုန်း)
        let priceVal = item.unit_price;
        if ((priceVal === undefined || priceVal === null) && hasQty && Number(item.amount) > 0) {
            priceVal = Math.round(Number(item.amount) / Number(qtyVal));
        }
        const priceStr = (priceVal !== undefined && priceVal !== null && Number(priceVal) > 0)
            ? Number(priceVal).toLocaleString()
            : "-";

        // ၆။ REF (Voucher No / Invoice No / Ref No)
        const refNo = item.ref_no || item.reference_no || item.invoice_no || item.purchase_no || "-";

        // ၇။ SURPLUS & DEFICIT (ပိုငွေ / လိုငွေ ကွာခြားချက်)
        const diff = Number(item.diff_amount || 0);
        let diffBadge = `<span class="text-slate-400 font-mono text-xs">-</span>`;
        if (diff > 0) {
            diffBadge = `<span class="text-amber-500 font-mono font-bold text-xs" title="ပွဲရုံထံ ပိုပေးထားငွေ / ပြန်ရရန်">+${diff.toLocaleString()}</span>`;
        } else if (diff < 0) {
            diffBadge = `<span class="text-rose-500 font-mono font-bold text-xs" title="ပေးရန်ကျန် အကြွေး">${diff.toLocaleString()}</span>`;
        }

        // ၈။ Sticky Right Action Buttons
        const actionButtons = `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${item.id}" title="ပြင်ဆင်မည်" 
                    class="btn-edit-entry w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="ဖျက်မည်" 
                    class="btn-delete-entry w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        `;

        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-12 whitespace-nowrap";
        row.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2.5 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. DATE -->
            <td class="py-2.5 px-3 text-center font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 w-28">${ui.escapeHtml(item.entry_date || item.date)}</td>
            
            <!-- 3. CATEGORY -->
            <td class="py-2.5 px-4 text-base ${catColor} truncate max-w-[170px]" title="${ui.escapeHtml(catName)}">${ui.escapeHtml(catName)}</td>
            
            <!-- 4. DESCRIPTION (ဆိုင်အမည် / ပွဲရုံအမည် တိုတိုတုတ်တုတ်) -->
            <td class="py-2.5 px-4 text-base font-semibold text-slate-900 dark:text-slate-100 min-w-[200px] max-w-sm truncate" title="${ui.escapeHtml(desc)}">
                ${ui.escapeHtml(desc || "-")}
            </td>
            
            <!-- 5. METHOD -->
            <td class="py-2.5 px-3 text-center font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${method}</td>
            
            <!-- 6. QTY -->
            <td class="py-2.5 px-3 text-center font-mono text-xs font-bold text-slate-700 dark:text-slate-300 w-16">${qtyStr}</td>
            
            <!-- 7. PRICE -->
            <td class="py-2.5 px-4 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300 w-24">${priceStr}</td>
            
            <!-- 8. AMOUNT -->
            <td class="py-2.5 px-4 text-right font-black font-mono text-base ${amountColorClass} w-32">${sign}${Number(item.amount || 0).toLocaleString()}</td>
            
            <!-- 9. REF (AMOUNT နောက်ကပ်လျက် REF ကော်လံ) -->
            <td class="py-2.5 px-3 text-center font-mono text-xs font-bold text-blue-600 dark:text-blue-400 w-28 truncate" title="${ui.escapeHtml(refNo)}">
                ${ui.escapeHtml(refNo)}
            </td>

            <!-- 10. SURPLUS & DEFICIT (ပိုငွေ / လိုငွေ) -->
            <td class="py-2.5 px-3 text-center font-mono text-xs w-28">
                ${diffBadge}
            </td>

            <!-- 11. ACTION (Sticky Right) -->
            <td class="py-2.5 px-3 text-center sticky right-0 bg-white dark:bg-[#151e32] z-10 shadow-[-4px_0_8px_rgba(0,0,0,0.06)] w-24">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(row);
    });

    tbody.querySelectorAll(".btn-edit-entry").forEach(btn => {
        btn.addEventListener("click", () => {
            const item = entries.find(r => r.id == btn.dataset.id);
            if (item) openEditModal(item);
        });
    });

    tbody.querySelectorAll(".btn-delete-entry").forEach(btn => {
        btn.addEventListener("click", () => deleteEntry(btn.dataset.id));
    });

    pagination.renderControls("cashbook-pagination");
}

function switchModalTab(type) {
    const typeInput = document.getElementById("entry-type");
    const tabExpense = document.getElementById("tab-btn-expense");
    const tabIncome = document.getElementById("tab-btn-income");
    const select = document.getElementById("entry-category");
    const submitBtn = document.getElementById("btn-submit-entry");
    const submitText = document.getElementById("btn-submit-text");

    if (typeInput) typeInput.value = type;

    if (type === "EXPENSE") {
        if (tabExpense) tabExpense.className = "py-2 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 bg-rose-600 text-white shadow-sm";
        if (tabIncome) tabIncome.className = "py-2 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
        if (submitBtn) submitBtn.className = "w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-black text-sm rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2 active:scale-95";
        if (submitText) submitText.textContent = "အသုံးစရိတ် သိမ်းဆည်းမည်";
    } else {
        if (tabExpense) tabExpense.className = "py-2 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
        if (tabIncome) tabIncome.className = "py-2 text-xs font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow-sm";
        if (submitBtn) submitBtn.className = "w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2 active:scale-95";
        if (submitText) submitText.textContent = "အခြားဝင်ငွေ သိမ်းဆည်းမည်";
    }

    const filteredCats = categories.filter(c => (c.type || c.entry_type || "").toUpperCase() === type);
    if (select) {
        select.innerHTML = '<option value="" disabled selected>ခေါင်းစဉ် ရွေးချယ်ပါ</option>';
        filteredCats.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = c.name;
            select.appendChild(opt);
        });
    }
}

function openModal(defaultType = "EXPENSE") {
    const modal = document.getElementById("entry-modal");
    const headerTitle = document.getElementById("entry-modal-header-title");
    
    document.getElementById("entry-form")?.reset();
    
    const editIdInput = document.getElementById("entry-edit-id");
    if (editIdInput) editIdInput.value = "";

    if (headerTitle) headerTitle.textContent = "ငွေစာရင်း အသစ်ထည့်သွင်းခြင်း";
    
    switchModalTab(defaultType);

    modal?.classList.remove("hidden");
    document.getElementById("entry-amount")?.focus();
}

function openEditModal(item) {
    const modal = document.getElementById("entry-modal");
    const headerTitle = document.getElementById("entry-modal-header-title");
    const amountInput = document.getElementById("entry-amount");
    const methodSelect = document.getElementById("entry-payment-method");
    const descInput = document.getElementById("entry-desc");
    const select = document.getElementById("entry-category");
    const submitText = document.getElementById("btn-submit-text");

    document.getElementById("entry-form")?.reset();

    let editIdInput = document.getElementById("entry-edit-id");
    if (!editIdInput) {
        editIdInput = document.createElement("input");
        editIdInput.type = "hidden";
        editIdInput.id = "entry-edit-id";
        document.getElementById("entry-form")?.appendChild(editIdInput);
    }
    editIdInput.value = item.id;

    const entryType = (item.entry_type || item.type || "EXPENSE").toUpperCase();
    if (headerTitle) headerTitle.textContent = "ငွေစာရင်း ပြင်ဆင်ခြင်း";
    if (submitText) submitText.textContent = "ပြင်ဆင်ချက်များ သိမ်းဆည်းမည်";

    switchModalTab(entryType);

    if (select) {
        select.value = item.category_id || "";
    }
    if (amountInput) amountInput.value = item.amount || "";
    if (methodSelect) methodSelect.value = item.payment_method || "cash";
    if (descInput) descInput.value = item.description || "";

    modal?.classList.remove("hidden");
    amountInput?.focus();
}

async function submitEntry(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-entry");

    const editId = document.getElementById("entry-edit-id")?.value;
    const categorySelect = document.getElementById("entry-category");
    const categoryId = parseInt(categorySelect?.value, 10);
    const amount = parseAnyNumber(document.getElementById("entry-amount")?.value);
    const description = document.getElementById("entry-desc")?.value.trim();

    if (!description) {
        ui.toast.warning("အသေးစိတ် အကြောင်းအရာ (Description) မဖြစ်မနေ ထည့်သွင်းပေးပါ။");
        document.getElementById("entry-desc")?.focus();
        return;
    }

    if (!categoryId || isNaN(amount) || amount <= 0) {
        ui.toast.warning("ခေါင်းစဉ်နှင့် ငွေပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ။");
        document.getElementById("entry-amount")?.focus();
        return;
    }

    if (btn) btn.disabled = true;

    const payload = {
        branchId: state.currentBranch?.id || 1,
        categoryId,
        entryType: document.getElementById("entry-type")?.value || "EXPENSE",
        paymentMethod: document.getElementById("entry-payment-method")?.value || "cash",
        amount,
        description,
        entryDate: document.getElementById("cb-date-filter")?.value || getLocalTodayDate(),
        createdBy: state.user?.id || 1
    };

    try {
        let res;
        if (editId) {
            res = await api.put(`/cashbook/entries/${editId}`, payload);
        } else {
            res = await api.post("/cashbook/entries", payload);
        }

        if (res.success !== false) {
            const editIdInput = document.getElementById("entry-edit-id");
            if (editIdInput) editIdInput.value = "";

            document.getElementById("entry-modal")?.classList.add("hidden");
            ui.toast.success(editId ? "ငွေစာရင်း ပြင်ဆင်ပြီးပါပြီ။" : "ငွေစာရင်း အသစ်ထည့်သွင်းပြီးပါပြီ။");
            await loadEntries();
        } else {
            throw new Error(res.error || "သိမ်းဆည်း၍ မရပါ");
        }
    } catch (err) {
        ui.toast.error("စာရင်းသွင်း၍ မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteEntry(id) {
    const confirmed = await ui.confirm("ဤငွေစာရင်း မှတ်တမ်းအား အမှန်တကယ် ဖျက်လိုပါသလား?", "error");
    if (!confirmed) return;
    
    try {
        await api.delete(`/cashbook/entries/${id}`);
        ui.toast.success("မှတ်တမ်းကို ပယ်ဖျက်ပြီးပါပြီ။");
        await loadEntries();
    } catch (err) {
        ui.toast.error(err.message || "ဖျက်၍မရပါ");
    }
}

/**
 * UI Table Header အသစ်အတိုင်း ထုတ်ယူပေးသော CSV Export စနစ်
 * Columns: NO, DATE, CATEGORY, DESCRIPTION, METHOD, QTY, PRICE, AMOUNT, REF, SURPLUS_DEFICIT
 */
function exportCSV() {
    const listToExport = currentFilteredEntries.length > 0 ? currentFilteredEntries : entries;

    if (listToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်းမရှိသေးပါ။");
    }
    
    let csv = "NO,DATE,CATEGORY,DESCRIPTION,METHOD,QTY,PRICE,AMOUNT,REF,SURPLUS_DEFICIT\n";

    listToExport.forEach((item, idx) => {
        const no = idx + 1;
        const date = item.entry_date || item.date || "";
        const entryType = (item.entry_type || item.type || "EXPENSE").toUpperCase();
        const isIncome = entryType === "INCOME";
        const sign = isIncome ? "+" : "-";

        const catName = item.category_name || item.category || "General";
        let desc = String(item.description || "-");
        let refNo = item.ref_no || item.reference_no || item.invoice_no || item.purchase_no || "-";
        let diffAmount = Number(item.diff_amount || 0);

        const method = String(item.payment_method || "cash").toUpperCase();

        const qtyVal = item.total_quantity || item.quantity;
        const hasQty = qtyVal !== undefined && qtyVal !== null && Number(qtyVal) > 0;
        const qtyStr = hasQty ? Number(qtyVal) : "-";

        let priceVal = item.unit_price;
        if ((priceVal === undefined || priceVal === null) && hasQty && Number(item.amount) > 0) {
            priceVal = Math.round(Number(item.amount) / Number(qtyVal));
        }
        const priceStr = (priceVal !== undefined && priceVal !== null && Number(priceVal) > 0) ? Number(priceVal) : "-";

        const amountStr = `${sign}${Number(item.amount || 0)}`;

        csv += `${no},${ui.escapeCsv(date)},${ui.escapeCsv(catName)},${ui.escapeCsv(desc)},${ui.escapeCsv(method)},${ui.escapeCsv(qtyStr)},${ui.escapeCsv(priceStr)},${ui.escapeCsv(amountStr)},${ui.escapeCsv(refNo)},${diffAmount}\n`;
    });
    
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Cashbook_${document.getElementById("cb-date-filter")?.value || getLocalTodayDate()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
