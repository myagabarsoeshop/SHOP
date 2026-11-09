// cashbook-frontend/js/modules/cashbook.js

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let entries = [];
let categories = [];
let currentFilteredEntries = [];

// Fallback Categories ("ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ" နှင့် "ပွဲရုံအကြွေးဆပ်ငွေ" ပါဝင်သည်)
const FALLBACK_CATEGORIES = [
    { id: 1, name: "အထည်ရောင်းရငွေ (POS Sales)", type: "INCOME", is_system: 1 },
    { id: 2, name: "အကြွေးဟောင်းရငွေ (Debt Collection)", type: "INCOME", is_system: 1 },
    { id: 3, name: "အခြားရငွေ (Other Income)", type: "INCOME", is_system: 0 },
    { id: 4, name: "ရက်ကန်းလုပ်ခ (Weaving Wages)", type: "EXPENSE", is_system: 0 },
    { id: 5, name: "ကုန်ကြမ်း/ချည်ဝယ်ယူစရိတ် (Raw Material Purchase)", type: "EXPENSE", is_system: 0 },
    { id: 6, name: "ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ် (Trading Goods Purchase)", type: "EXPENSE", is_system: 1 },
    { id: 7, name: "ဆိုင်စရိတ်/စားစရိတ် (Daily Shop Expenses)", type: "EXPENSE", is_system: 0 },
    { id: 8, name: "ဆိုင်လခ/အိမ်လခ (Shop Rent)", type: "EXPENSE", is_system: 0 },
    { id: 9, name: "လျှပ်စစ်မီးဖိုးနှင့် အထွေထွေစရိတ် (Utilities)", type: "EXPENSE", is_system: 0 },
    { id: 10, name: "ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ", type: "EXPENSE", is_system: 1 },
    { id: 11, name: "ပွဲရုံအကြွေးဆပ်ငွေ (Supplier Debt Payment)", type: "EXPENSE", is_system: 1 }
];

// စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Instance
const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

/**
 * မြန်မာဂဏန်း (၀-၉) မှ အင်္ဂလိပ်ဂဏန်း (0-9) သို့ ပြောင်းပြီး ကိန်းပြည့်ယူသည့် Helper
 */
function parseAnyNumber(val) {
    if (!val && val !== 0) return 0;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let cleanStr = String(val).replace(/,/g, "").trim();
    myanmarDigits.forEach((d, idx) => {
        cleanStr = cleanStr.replaceAll(d, String(idx));
    });
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : Math.round(num);
}

/**
 * ငွေရိုက်သွင်းသည့် Input တွင် ရိုက်နေစဉ် အလိုအလျောက် ကော်မာ (150,000) ခံပေးခြင်း
 */
function formatMoneyInputLive(inputEl) {
    if (!inputEl) return;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let raw = String(inputEl.value || "");
    myanmarDigits.forEach((d, idx) => {
        raw = raw.replaceAll(d, String(idx));
    });
    const digitsOnly = raw.replace(/[^0-9]/g, "");
    if (!digitsOnly) {
        inputEl.value = "";
        return;
    }
    inputEl.value = Number(digitsOnly).toLocaleString("en-US");
}

export async function initCashbook() {
    const dateInput = document.getElementById("cb-date-filter");
    if (dateInput) dateInput.value = getLocalTodayDate();

    bindEvents();
    await loadCategories();
    await loadEntries();
}

function bindEvents() {
    // 1. Add New Button
    document.getElementById("btn-open-add-modal")?.addEventListener("click", () => openModal("EXPENSE"));

    // Modal Close
    document.getElementById("btn-close-entry-modal")?.addEventListener("click", closeModal);

    // 2. Modal Switcher Tabs
    document.getElementById("tab-btn-expense")?.addEventListener("click", () => switchModalTab("EXPENSE"));
    document.getElementById("tab-btn-income")?.addEventListener("click", () => switchModalTab("INCOME"));

    // 3. Category Change Auto-Template
    document.getElementById("entry-category")?.addEventListener("change", (e) => {
        const descInput = document.getElementById("entry-desc");
        const selectedOpt = e.target.selectedOptions?.[0];
        const catName = selectedOpt ? selectedOpt.textContent : "";

        if (catName.includes("ပိုင်ရှင်") || catName.includes("အပ်ငွေ") || catName.includes("လွှဲ") || Number(e.target.value) === 10) {
            if (descInput && (!descInput.value.trim() || descInput.value.startsWith("ဆိုင်ပိုင်ရှင်ထံ"))) {
                descInput.value = "ဆိုင်ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ (လက်ခံသူ - )";
            }
        }
        document.getElementById("entry-amount")?.focus();
    });

    // 4. Live Comma Formatting & Keyboard Enter Navigation inside Modal
    const amountInput = document.getElementById("entry-amount");
    if (amountInput) {
        amountInput.addEventListener("input", () => formatMoneyInputLive(amountInput));
        amountInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("entry-desc")?.focus();
            }
        });
    }

    const refInput = document.getElementById("entry-ref-no");
    if (refInput) {
        refInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("entry-amount")?.focus();
            }
        });
    }

    // 5. Form Submit
    document.getElementById("entry-form")?.addEventListener("submit", submitEntry);

    // 6. Date Filter Change
    document.getElementById("cb-date-filter")?.addEventListener("change", () => {
        pagination.reset();
        loadEntries();
    });

    // 7. Search Filter
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

    // 8. Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-cashbook");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadEntries();
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
            ui.toast.info("စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // 9. Export CSV
    document.getElementById("btn-export-csv")?.addEventListener("click", exportCSV);
}

function closeModal() {
    document.getElementById("entry-modal")?.classList.add("hidden");
}

/**
 * D1 Read Quota ချွေတာရန် Categories အား Memory တွင် Cache ထားခြင်း
 */
async function loadCategories(forceRefresh = false) {
    if (!forceRefresh && categories.length > 0) return;
    try {
        const res = await api.get("/cashbook/categories");
        categories = (res.data && res.data.length > 0) ? res.data : [...FALLBACK_CATEGORIES];
        if (!categories.some(c => c.id === 10 || c.name.includes("ပိုင်ရှင်"))) {
            categories.push({ id: 10, name: "ပိုင်ရှင်ထံ ငွေလွှဲ/အပ်ငွေ", type: "EXPENSE" });
        }
    } catch (err) {
        console.warn("Using fallback categories:", err.message);
        categories = [...FALLBACK_CATEGORIES];
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

        const searchKw = document.getElementById("cb-search")?.value?.trim().toLowerCase() || "";
        if (searchKw) {
            currentFilteredEntries = entries.filter(r => {
                const cat = (r.category_name || r.category || "").toLowerCase();
                const desc = (r.description || "").toLowerCase();
                const method = (r.payment_method || "").toLowerCase();
                const ref = (r.ref_no || r.reference_no || r.invoice_no || r.purchase_no || "").toLowerCase();
                return cat.includes(searchKw) || desc.includes(searchKw) || method.includes(searchKw) || ref.includes(searchKw);
            });
        } else {
            currentFilteredEntries = [...entries];
        }

        const s = res.data?.summary || {};
        const cashBal = s.cash_balance !== undefined ? Number(s.cash_balance) : Number(s.cash?.net || 0);
        const bankBal = s.bank_balance !== undefined ? Number(s.bank_balance) : Number(s.bank?.net || 0);

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
 * Cash Book Table Rendering (၁၁ ကော်လံစနစ် - Pro Typography & Sticky Action)
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

        // 1. Category Format & Color
        const catName = item.category_name || item.category || "General";
        const isRemittance = catName.includes("ပိုင်ရှင်") || catName.includes("အပ်ငွေ") || catName.includes("လွှဲ") || item.category_id === 10;

        let catColor = "text-slate-700 dark:text-slate-300 font-bold";
        let amountColorClass = "text-rose-600 dark:text-rose-400";

        if (isRemittance) {
            catColor = "text-purple-600 dark:text-purple-400 font-bold";
            amountColorClass = "text-purple-600 dark:text-purple-400";
        } else if (isIncome || catName.includes("ရောင်း")) {
            catColor = "text-emerald-600 dark:text-emerald-400 font-bold";
            amountColorClass = "text-emerald-600 dark:text-emerald-400";
        } else if (catName.includes("ဝယ်") || catName.includes("ပွဲရုံ")) {
            catColor = "text-rose-600 dark:text-rose-400 font-bold";
            amountColorClass = "text-rose-600 dark:text-rose-400";
        } else {
            catColor = "text-amber-600 dark:text-amber-400 font-bold";
            amountColorClass = "text-rose-600 dark:text-rose-400";
        }

        // 2. Description
        const desc = String(item.description || "-");

        // 3. Method Badge
        const method = String(item.payment_method || "cash").toUpperCase();
        const methodBadge = method === "BANK"
            ? `<span class="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-[11px] font-bold">BANK</span>`
            : `<span class="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-bold">CASH</span>`;

        // 4. Qty
        const qtyVal = item.total_quantity || item.quantity;
        const hasQty = qtyVal !== undefined && qtyVal !== null && Number(qtyVal) > 0;
        const qtyStr = hasQty ? Number(qtyVal).toLocaleString() : "-";

        // 5. Price
        let priceVal = item.unit_price;
        if ((priceVal === undefined || priceVal === null) && hasQty && Number(item.amount) > 0) {
            priceVal = Math.round(Number(item.amount) / Number(qtyVal));
        }
        const priceStr = (priceVal !== undefined && priceVal !== null && Number(priceVal) > 0)
            ? Number(priceVal).toLocaleString()
            : "-";

        // 6. REF
        const refNo = item.ref_no || item.reference_no || item.invoice_no || item.purchase_no || "-";

        // 7. SURPLUS & DEFICIT
        const diff = Number(item.diff_amount || 0);
        let diffBadge = `<span class="text-slate-400 font-mono text-xs">-</span>`;
        if (diff > 0) {
            diffBadge = `<span class="text-amber-500 font-mono font-bold text-xs" title="ပွဲရုံထံ ပိုပေးထားငွေ / ပြန်ရရန်">+${diff.toLocaleString()}</span>`;
        } else if (diff < 0) {
            diffBadge = `<span class="text-rose-500 font-mono font-bold text-xs" title="ပေးရန်ကျန် အကြွေး">${diff.toLocaleString()}</span>`;
        }

        // 8. Sticky Right Action Buttons
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
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";
        row.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. DATE -->
            <td class="py-2 px-3 text-center font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 w-28">${ui.escapeHtml(item.entry_date || item.date)}</td>
            
            <!-- 3. CATEGORY -->
            <td class="py-2 px-4 text-xs ${catColor} truncate max-w-[190px]" title="${ui.escapeHtml(catName)}">${ui.escapeHtml(catName)}</td>
            
            <!-- 4. DESCRIPTION -->
            <td class="py-2 px-4 text-xs font-bold text-slate-900 dark:text-slate-100 min-w-[200px] max-w-sm truncate" title="${ui.escapeHtml(desc)}">
                ${ui.escapeHtml(desc)}
            </td>
            
            <!-- 5. METHOD -->
            <td class="py-2 px-3 text-center w-24">${methodBadge}</td>
            
            <!-- 6. QTY -->
            <td class="py-2 px-3 text-center font-mono text-xs font-bold text-slate-700 dark:text-slate-300 w-16">${qtyStr}</td>
            
            <!-- 7. PRICE -->
            <td class="py-2 px-4 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300 w-28">${priceStr}</td>
            
            <!-- 8. AMOUNT -->
            <td class="py-2 px-4 text-right font-black font-mono text-sm ${amountColorClass} w-32">${sign}${Number(item.amount || 0).toLocaleString()}</td>
            
            <!-- 9. REF -->
            <td class="py-2 px-3 text-center font-mono text-xs font-bold text-blue-600 dark:text-blue-400 w-32 truncate" title="${ui.escapeHtml(refNo)}">
                ${ui.escapeHtml(refNo)}
            </td>

            <!-- 10. SURPLUS & DEFICIT -->
            <td class="py-2 px-3 text-center font-mono text-xs w-32">
                ${diffBadge}
            </td>

            <!-- 11. ACTION (Sticky Right) -->
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-24">
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
        btn.addEventListener("click", () => {
            const item = entries.find(r => r.id == btn.dataset.id);
            deleteEntry(btn.dataset.id, item);
        });
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
    const editId = document.getElementById("entry-edit-id")?.value;

    if (typeInput) typeInput.value = type;

    if (type === "EXPENSE") {
        if (tabExpense) tabExpense.className = "py-2 text-xs font-extrabold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 bg-rose-600 text-white shadow-sm";
        if (tabIncome) tabIncome.className = "py-2 text-xs font-extrabold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
        if (submitBtn) submitBtn.className = "w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2 active:scale-95";
        if (submitText && !editId) submitText.textContent = "အသုံးစရိတ် သိမ်းဆည်းမည်";
    } else {
        if (tabExpense) tabExpense.className = "py-2 text-xs font-extrabold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
        if (tabIncome) tabIncome.className = "py-2 text-xs font-extrabold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow-sm";
        if (submitBtn) submitBtn.className = "w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2 active:scale-95";
        if (submitText && !editId) submitText.textContent = "အခြားဝင်ငွေ သိမ်းဆည်းမည်";
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

    const refInput = document.getElementById("entry-ref-no");
    if (refInput) refInput.value = "";

    if (headerTitle) headerTitle.textContent = "ငွေစာရင်း အသစ်ထည့်သွင်းခြင်း";
    
    switchModalTab(defaultType);

    modal?.classList.remove("hidden");
    document.getElementById("entry-category")?.focus();
}

function openEditModal(item) {
    const modal = document.getElementById("entry-modal");
    const headerTitle = document.getElementById("entry-modal-header-title");
    const amountInput = document.getElementById("entry-amount");
    const methodSelect = document.getElementById("entry-payment-method");
    const refInput = document.getElementById("entry-ref-no");
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

    switchModalTab(entryType);
    if (submitText) submitText.textContent = "ပြင်ဆင်ချက်များ သိမ်းဆည်းမည်";

    if (select) {
        select.value = item.category_id || "";
    }
    if (amountInput) {
        amountInput.value = item.amount ? Number(item.amount).toLocaleString("en-US") : "";
    }
    if (methodSelect) {
        methodSelect.value = item.payment_method || "cash";
    }
    if (refInput) {
        const rawRef = item.ref_no || "";
        refInput.value = rawRef.startsWith("VR-CB-") ? "" : rawRef;
    }
    if (descInput) {
        descInput.value = item.description || "";
    }

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
    const refNo = document.getElementById("entry-ref-no")?.value.trim() || null;
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
        refNo,
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

            closeModal();
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

async function deleteEntry(id, item = null) {
    let msg = "ဤငွေစာရင်း မှတ်တမ်းအား အမှန်တကယ် ဖျက်လိုပါသလား?";
    if (item && (item.sale_id || item.purchase_id)) {
        const ref = item.ref_no || item.reference_no || "";
        msg = `ဤမှတ်တမ်းသည် ဘောင်ချာ (${ref}) နှင့် ချိတ်ဆက်နေပါသည်။ ငွေစာရင်းမှ အမှန်တကယ် ဖျက်လိုပါသလား?`;
    }

    const confirmed = await ui.confirm(msg, "error");
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
 * CSV Export (10 Columns)
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
        const desc = String(item.description || "-");
        const refNo = item.ref_no || item.reference_no || item.invoice_no || item.purchase_no || "-";
        const diffAmount = Number(item.diff_amount || 0);
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
