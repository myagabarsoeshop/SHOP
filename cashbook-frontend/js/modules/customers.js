// =============================================================================
// FILE: cashbook-frontend/js/modules/customers.js 
// CUSTOMERS & SUPPLIERS RECEIVABLES / PAYABLES LEDGER MODULE
// Version: 4.1.0 (Fixes Paginated Statement Bug, ALL-View Guard & RBAC Delete)
// =============================================================================

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI, refreshGlobalKPIs, getLocalTodayDate } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let customers = [];
let currentFilteredCustomers = [];
let activeCustomerLedger = [];
let currentCustomer = null;

const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

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

function normalizePhoneNumber(phoneStr) {
    if (!phoneStr) return null;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let clean = String(phoneStr).trim();
    myanmarDigits.forEach((d, idx) => {
        clean = clean.replaceAll(d, String(idx));
    });
    clean = clean.replace(/[^0-9]/g, "");
    return clean || null;
}

export async function initCustomers() {
    bindEvents();
    await loadCustomers();
}

function bindEvents() {
    document.getElementById("btn-export-customers-csv")?.addEventListener("click", exportAllCustomersToCSV);
    document.getElementById("btn-export-ledger-csv")?.addEventListener("click", exportCustomerLedgerToCSV);

    const refreshBtn = document.getElementById("btn-refresh-customers");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadCustomers();
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
            ui.toast.info("စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    document.getElementById("btn-add-customer")?.addEventListener("click", () => {
        document.getElementById("customer-form")?.reset();
        const editIdEl = document.getElementById("cust-edit-id");
        if (editIdEl) editIdEl.value = "";

        const custRadio = document.getElementById("entity-cust");
        if (custRadio) custRadio.checked = true;
        updateEntityModalUI("CUSTOMER");

        const headerTitle = document.getElementById("cust-modal-header-title");
        if (headerTitle) headerTitle.textContent = "ဖောက်သည် / ပွဲရုံ စာရင်းသွင်းမည်";

        document.getElementById("cust-debt-container")?.classList.remove("hidden");
        document.getElementById("customer-modal")?.classList.remove("hidden");
        document.getElementById("cust-name")?.focus();
    });

    document.getElementById("btn-close-cust-modal")?.addEventListener("click", () => {
        document.getElementById("customer-modal")?.classList.add("hidden");
    });

    document.querySelectorAll('input[name="entity_type"]').forEach(radio => {
        radio.addEventListener("change", (e) => {
            updateEntityModalUI(e.target.value);
        });
    });

    const debtInput = document.getElementById("cust-debt");
    if (debtInput) {
        debtInput.addEventListener("input", () => formatMoneyInputLive(debtInput));
    }

    const repayAmtInput = document.getElementById("repay-amount");
    if (repayAmtInput) {
        repayAmtInput.addEventListener("input", () => formatMoneyInputLive(repayAmtInput));
    }

    document.getElementById("btn-close-repay-modal")?.addEventListener("click", () => {
        document.getElementById("repay-modal")?.classList.add("hidden");
    });

    document.getElementById("btn-close-ledger-modal")?.addEventListener("click", () => {
        document.getElementById("customer-ledger-modal")?.classList.add("hidden");
    });

    document.getElementById("customer-form")?.addEventListener("submit", submitCustomerForm);
    document.getElementById("repay-form")?.addEventListener("submit", submitRepayment);

    document.getElementById("cust-search")?.addEventListener("input", filterAndRenderCustomers);
    document.getElementById("cust-filter-entity")?.addEventListener("change", filterAndRenderCustomers);

    const repayMethodSelect = document.getElementById("repay-method");
    if (repayMethodSelect) {
        repayMethodSelect.addEventListener("change", (e) => {
            const bankBox = document.getElementById("repay-bank-container");
            if (e.target.value === "bank") {
                bankBox?.classList.remove("hidden");
                document.getElementById("repay-bank-name")?.focus();
            } else {
                bankBox?.classList.add("hidden");
            }
        });
    }

    document.getElementById("btn-print-ledger")?.addEventListener("click", printCustomerStatement);
}

function updateEntityModalUI(entityType) {
    const isSupplier = entityType === "SUPPLIER";
    const tierContainer = document.getElementById("cust-tier-container");
    const lblName = document.getElementById("lbl-cust-name");
    const lblShop = document.getElementById("lbl-cust-shop");
    const lblDebt = document.getElementById("lbl-cust-debt");
    const submitText = document.getElementById("btn-submit-cust-text");
    const isEditing = Boolean(document.getElementById("cust-edit-id")?.value);

    if (isSupplier) {
        if (tierContainer) tierContainer.classList.add("hidden");
        if (lblName) lblName.textContent = "ပွဲရုံ / ပေးသွင်းသူအမည် (Supplier Name) *";
        if (lblShop) lblShop.textContent = "ဆိုင်ခွဲ / ပွဲရုံအမည် (Shop Name)";
        if (lblDebt) lblDebt.textContent = "စတင်စာရင်းဖွင့် ပေးရန်ကျန်ငွေ (Opening Payable)";
        if (submitText) submitText.textContent = isEditing ? "ပြင်ဆင်ချက် သိမ်းဆည်းမည်" : "ပွဲရုံ စာရင်းသိမ်းဆည်းမည်";
    } else {
        if (tierContainer) tierContainer.classList.remove("hidden");
        if (lblName) lblName.textContent = "ဖောက်သည်အမည် (Customer Name) *";
        if (lblShop) lblShop.textContent = "ဆိုင်အမည် (လက်ကားဖောက်သည်ဖြစ်ပါက)";
        if (lblDebt) lblDebt.textContent = "စတင်စာရင်းဖွင့် အကြွေးလက်ကျန် (Opening Debt)";
        if (submitText) submitText.textContent = isEditing ? "ပြင်ဆင်ချက် သိမ်းဆည်းမည်" : "ဖောက်သည် သိမ်းဆည်းမည်";
    }
}

async function loadCustomers() {
    const tbody = document.getElementById("cust-table-body");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="p-16 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl mb-3 text-emerald-500"></i>
                    <div class="font-bold text-xs">ဖောက်သည်နှင့် ပွဲရုံစာရင်းများ ဆွဲယူနေပါသည်...</div>
                </td>
            </tr>
        `;
    }

    try {
        const res = await api.get("/customers");
        customers = res.data || [];
        currentFilteredCustomers = [...customers];

        const totalCust = customers.filter(c => (c.entity_type || "CUSTOMER").toUpperCase() !== "SUPPLIER").length;
        const totalSupp = customers.filter(c => (c.entity_type || "CUSTOMER").toUpperCase() === "SUPPLIER").length;
        const totalReceivables = customers.reduce((sum, c) => sum + Number(c.current_debt || 0), 0);
        const totalPayables = customers.reduce((sum, c) => sum + Number(c.current_payable || c.payables || 0), 0);

        setKPI(1, "Total Customers", totalCust, "fa-users", "blue");
        setKPI(2, "Total Suppliers", totalSupp, "fa-warehouse", "purple");
        setKPI(3, "Total Receivables", totalReceivables, "fa-hand-holding-dollar", "emerald");
        setKPI(4, "Total Payables", totalPayables, "fa-file-invoice-dollar", "amber");

        filterAndRenderCustomers();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-12 text-center text-rose-500 font-bold text-xs">စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function filterAndRenderCustomers() {
    const kw = (document.getElementById("cust-search")?.value || "").trim().toLowerCase();
    const entityFilter = document.getElementById("cust-filter-entity")?.value || "all";

    currentFilteredCustomers = customers.filter(c => {
        const entity = (c.entity_type || "CUSTOMER").toUpperCase();
        if (entityFilter === "customer" && entity === "SUPPLIER") return false;
        if (entityFilter === "supplier" && entity !== "SUPPLIER") return false;

        if (!kw) return true;
        const hay = `${c.name || ""} ${c.phone || ""} ${c.shop_name || ""} ${c.address || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById("cust-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredCustomers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-users text-3xl mb-3 opacity-30"></i>
                    <div>စာရင်း မှတ်တမ်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("customers-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredCustomers);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;
    const isAllView = state.isAllBranches();
    const canDeleteCustomer = state.can("customer.delete");

    pageItems.forEach((c, idx) => {
        const isSupplier = (c.entity_type || "CUSTOMER").toUpperCase() === "SUPPLIER";
        const debt = Number(c.current_debt || 0);
        const payable = Number(c.current_payable || c.payables || 0);

        let typeBadge = `<span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono text-[11px] font-bold">RETAIL</span>`;
        if (isSupplier) {
            typeBadge = `<span class="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-[11px] font-bold">SUPPLIER</span>`;
        } else if (String(c.customer_type || "").toLowerCase() === "wholesale") {
            typeBadge = `<span class="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono text-[11px] font-bold">WHOLESALE</span>`;
        }

        const cleanPhone = normalizePhoneNumber(c.phone) || c.phone || "-";

        let statusBadge = "";
        let hasBalance = false;

        if (isSupplier) {
            hasBalance = payable > 0;
            statusBadge = hasBalance
                ? `<span class="text-amber-500 font-mono font-bold text-xs">ပေးရန်ရှိ</span>`
                : `<span class="text-emerald-500 font-mono font-bold text-xs">ရှင်းပြီး</span>`;
        } else {
            hasBalance = debt > 0;
            statusBadge = hasBalance
                ? `<span class="text-rose-600 dark:text-rose-400 font-mono font-bold text-xs">အကြွေးကျန်ရှိ</span>`
                : `<span class="text-emerald-500 font-mono font-bold text-xs">ရှင်းပြီး</span>`;
        }

        const safeId = ui.escapeHtml(c.id);
        const repayBtnTitle = isAllView
            ? "ALL View တွင် အကြွေးဆပ်၍ မရပါ (ဆိုင်ခွဲတစ်ခုကို အရင်ရွေးချယ်ပါ)"
            : (isSupplier ? "ပွဲရုံသို့ အကြွေးဆပ်မည်" : "အကြွေးဆပ်ငွေ လက်ခံမည်");

        const deleteBtnHtml = (canDeleteCustomer && !hasBalance)
            ? `<button type="button" data-id="${safeId}" title="စာရင်းမှ ဖျက်သိမ်းမည်" 
                class="btn-delete-cust w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 text-rose-500 hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                <i class="fa-solid fa-trash-can text-xs"></i>
            </button>`
            : "";

        const actionButtons = `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${safeId}" title="Statement ကြည့်မည်" 
                    class="btn-view-ledger w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-receipt text-xs"></i>
                </button>

                ${hasBalance ? `
                <button type="button" data-id="${safeId}" ${isAllView ? "disabled" : ""} title="${repayBtnTitle}" 
                    class="btn-repay w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 ${isAllView ? 'opacity-40 cursor-not-allowed' : (isSupplier ? 'hover:bg-amber-500 text-amber-500 cursor-pointer' : 'hover:bg-emerald-600 text-emerald-600 cursor-pointer')} hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition shadow-sm active:scale-95">
                    <i class="fa-solid fa-hand-holding-dollar text-xs"></i>
                </button>` : `
                <button type="button" disabled title="စာရင်းရှင်းပြီးပါပြီ" 
                    class="w-7 h-7 flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 text-slate-300 dark:text-slate-700 rounded-lg border border-slate-200/50 dark:border-slate-800/50 cursor-not-allowed">
                    <i class="fa-solid fa-check text-xs"></i>
                </button>`}

                <button type="button" data-id="${safeId}" title="အချက်အလက် ပြင်ဆင်မည်" 
                    class="btn-edit-cust w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 hover:text-white dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                ${deleteBtnHtml}
            </div>
        `;

        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";
        row.innerHTML = `
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            <td class="py-2 px-4 text-xs font-extrabold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${ui.escapeHtml(c.name)}">
                ${ui.escapeHtml(c.name)}
            </td>
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 w-32">
                ${ui.escapeHtml(cleanPhone)}
            </td>
            <td class="py-2 px-4 text-xs font-bold text-slate-700 dark:text-slate-200 w-44 truncate" title="${ui.escapeHtml(c.shop_name || "-")}">
                ${ui.escapeHtml(c.shop_name || "-")}
            </td>
            <td class="py-2 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 min-w-[170px] max-w-xs truncate" title="${ui.escapeHtml(c.address || "-")}">
                ${ui.escapeHtml(c.address || "-")}
            </td>
            <td class="py-2 px-3 text-left w-28">${typeBadge}</td>
            <td class="py-2 px-4 text-right font-black font-mono text-sm ${debt > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'} w-36">
                ${debt > 0 ? debt.toLocaleString() : "-"}
            </td>
            <td class="py-2 px-4 text-right font-black font-mono text-sm ${payable > 0 ? 'text-amber-500' : 'text-slate-400'} w-36">
                ${payable > 0 ? payable.toLocaleString() : "-"}
            </td>
            <td class="py-2 px-3 text-center whitespace-nowrap w-28">${statusBadge}</td>
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-28">${actionButtons}</td>
        `;
        tbody.appendChild(row);
    });

    tbody.querySelectorAll(".btn-repay").forEach(btn => {
        btn.addEventListener("click", () => {
            if (state.isAllBranches()) {
                ui.toast.warning("ဆိုင်ခွဲအားလုံး (ALL View) မှ အကြွေးဆပ်၍ မရပါ။ ဆိုင်ခွဲတစ်ခုကို အရင်ရွေးချယ်ပါ။");
                return;
            }
            const cust = customers.find(item => item.id === Number(btn.dataset.id));
            if (cust) openRepayModal(cust);
        });
    });

    tbody.querySelectorAll(".btn-view-ledger").forEach(btn => {
        btn.addEventListener("click", () => {
            const cust = customers.find(item => item.id === Number(btn.dataset.id));
            if (cust) openCustomerLedgerModal(cust);
        });
    });

    tbody.querySelectorAll(".btn-edit-cust").forEach(btn => {
        btn.addEventListener("click", () => {
            const cust = customers.find(item => item.id === Number(btn.dataset.id));
            if (cust) openEditCustomerModal(cust);
        });
    });

    tbody.querySelectorAll(".btn-delete-cust").forEach(btn => {
        btn.addEventListener("click", async () => {
            const cust = customers.find(item => item.id === Number(btn.dataset.id));
            if (!cust) return;
            const confirmed = await ui.confirm(`"${cust.name}" အား စာရင်းမှ ပယ်ဖျက်လိုပါသလား?`, "error");
            if (!confirmed) return;
            try {
                await api.delete(`/customers/${cust.id}`);
                ui.toast.success("စာရင်းမှ ပယ်ဖျက်ပြီးပါပြီ");
                await loadCustomers();
            } catch (err) {
                ui.toast.error(err.message);
            }
        });
    });

    pagination.renderControls("customers-pagination");
}

function openEditCustomerModal(cust) {
    document.getElementById("customer-form")?.reset();
    document.getElementById("cust-edit-id").value = cust.id;

    const entityType = (cust.entity_type || "CUSTOMER").toUpperCase() === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
    const custRadio = document.getElementById("entity-cust");
    const suppRadio = document.getElementById("entity-supp");
    if (entityType === "SUPPLIER" && suppRadio) suppRadio.checked = true;
    else if (custRadio) custRadio.checked = true;

    updateEntityModalUI(entityType);

    const headerTitle = document.getElementById("cust-modal-header-title");
    if (headerTitle) headerTitle.textContent = "အချက်အလက် ပြင်ဆင်မည်";

    document.getElementById("cust-name").value = cust.name || "";
    document.getElementById("cust-phone").value = normalizePhoneNumber(cust.phone) || cust.phone || "";
    document.getElementById("cust-type").value = cust.customer_type || "retail";
    document.getElementById("cust-shop").value = cust.shop_name || "";
    document.getElementById("cust-address").value = cust.address || "";

    document.getElementById("cust-debt-container")?.classList.add("hidden");
    document.getElementById("customer-modal")?.classList.remove("hidden");
    document.getElementById("cust-name")?.focus();
}

function openRepayModal(cust) {
    if (state.isAllBranches()) {
        ui.toast.warning("ဆိုင်ခွဲအားလုံး (ALL View) မှ အကြွေးဆပ်ငွေ လက်ခံ/ပေးချေ၍ မရပါ။ ဆိုင်ခွဲတစ်ခုကို ရွေးချယ်ပါ။");
        return;
    }

    document.getElementById("repay-form")?.reset();
    document.getElementById("repay-cust-id").value = cust.id;

    const isSupplier = (cust.entity_type || "CUSTOMER").toUpperCase() === "SUPPLIER";
    document.getElementById("repay-entity-type").value = isSupplier ? "SUPPLIER" : "CUSTOMER";

    const modalTitle = document.getElementById("repay-modal-title");
    const balLabel = document.getElementById("repay-balance-label");
    const balEl = document.getElementById("repay-current-debt");
    const amountInput = document.getElementById("repay-amount");
    const hintEl = document.getElementById("repay-cashbook-hint");

    if (isSupplier) {
        const payable = Number(cust.current_payable || cust.payables || 0);
        if (modalTitle) modalTitle.textContent = `${cust.name} - ပွဲရုံသို့ အကြွေးဆပ်ငွေ ပေးချေခြင်း`;
        if (balLabel) balLabel.textContent = "လက်ရှိ ပေးရန်ရှိ ကုန်ကြွေး (Payable)";
        if (balEl) balEl.textContent = payable.toLocaleString();
        if (amountInput) amountInput.value = payable.toLocaleString("en-US");
        if (hintEl) {
            hintEl.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> အတည်ပြုပြီးပါက နေ့စဉ်ငွေစာရင်း (Cash Book) တွင် အသုံးစရိတ် (EXPENSE) အဖြစ် ချက်ချင်း မှတ်တမ်းတင်ပေးပါမည်။`;
        }
    } else {
        const debt = Number(cust.current_debt || 0);
        if (modalTitle) modalTitle.textContent = `${cust.name} - အကြွေးဆပ်ငွေ လက်ခံခြင်း`;
        if (balLabel) balLabel.textContent = "လက်ရှိ ရရန်ရှိ အကြွေးကျန်ငွေ (Receivable)";
        if (balEl) balEl.textContent = debt.toLocaleString();
        if (amountInput) amountInput.value = debt.toLocaleString("en-US");
        if (hintEl) {
            hintEl.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> အတည်ပြုပြီးပါက နေ့စဉ်ငွေစာရင်း (Cash Book) တွင် ဝင်ငွေ (INCOME) အဖြစ် ချက်ချင်း ပေါင်းထည့်ပေးပါမည်။`;
        }
    }

    const dateInput = document.getElementById("repay-date");
    if (dateInput) dateInput.value = getLocalTodayDate();

    document.getElementById("repay-bank-container")?.classList.add("hidden");
    document.getElementById("repay-modal")?.classList.remove("hidden");
    amountInput?.focus();
    amountInput?.select();
}

async function submitRepayment(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-repay");

    let targetBranchId;
    try {
        targetBranchId = state.requireWriteBranchId();
    } catch (err) {
        ui.toast.warning(err.message);
        return;
    }

    const customerId = parseInt(document.getElementById("repay-cust-id").value, 10);
    const entityType = document.getElementById("repay-entity-type")?.value || "CUSTOMER";
    const amount = parseAnyNumber(document.getElementById("repay-amount").value);
    const paymentMethod = document.getElementById("repay-method").value;
    const bankName = document.getElementById("repay-bank-name")?.value.trim() || null;
    const note = document.getElementById("repay-note").value.trim();
    const repayDate = document.getElementById("repay-date")?.value || getLocalTodayDate();

    if (amount <= 0) {
        return ui.toast.warning("ကျေးဇူးပြု၍ မှန်ကန်သော ပမာဏ ထည့်သွင်းပေးပါ။");
    }

    if (paymentMethod === "bank" && !bankName) {
        document.getElementById("repay-bank-name")?.focus();
        return ui.toast.warning("ဘဏ်လွှဲဖြစ်ပါက ကျေးဇူးပြု၍ ဘဏ်အမည် ရွေးချယ်/ထည့်သွင်းပေးပါ။");
    }

    if (btn) btn.disabled = true;

    try {
        await api.post("/customers/repay", {
            customer_id: customerId,
            entity_type: entityType,
            branch_id: targetBranchId,
            amount,
            payment_method: paymentMethod,
            bank_account_name: paymentMethod === "bank" ? bankName : null,
            note: note || (entityType === "SUPPLIER" ? `ပွဲရုံသို့ အကြွေးဆပ်ငွေ (${paymentMethod.toUpperCase()})` : `အကြွေးဆပ်ငွေ (${paymentMethod.toUpperCase()})`),
            entry_date: repayDate
        });

        document.getElementById("repay-modal")?.classList.add("hidden");
        ui.toast.success(entityType === "SUPPLIER" ? "ပွဲရုံသို့ အကြွေးဆပ်ငွေ အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။" : "အကြွေးဆပ်ငွေ အောင်မြင်စွာ လက်ခံပြီးပါပြီ။");
        await loadCustomers();
        await refreshGlobalKPIs("customers");
    } catch (err) {
        ui.toast.error("ငွေစာရင်းရှင်းလင်းမှု မအောင်မြင်ပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function submitCustomerForm(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-new-cust");
    const editId = document.getElementById("cust-edit-id")?.value;
    const name = document.getElementById("cust-name").value.trim();
    const entityType = document.querySelector('input[name="entity_type"]:checked')?.value || "CUSTOMER";

    if (!name) {
        ui.toast.warning("အမည် မဖြစ်မနေ ထည့်သွင်းပေးပါ။");
        document.getElementById("cust-name")?.focus();
        return;
    }

    const openingBalance = parseAnyNumber(document.getElementById("cust-debt").value);
    if (!editId && openingBalance > 0 && state.isAllBranches()) {
        ui.toast.warning("ကနဦးအကြွေးလက်ကျန် ထည့်သွင်းလိုပါက အပေါ်ညာဘက်တွင် သက်ဆိုင်ရာ ဆိုင်ခွဲတစ်ခုကို အရင်ရွေးချယ်ပေးပါ။");
        return;
    }

    if (btn) btn.disabled = true;

    const payload = {
        name,
        phone: normalizePhoneNumber(document.getElementById("cust-phone").value),
        entity_type: entityType,
        customer_type: entityType === "SUPPLIER" ? "wholesale" : document.getElementById("cust-type").value,
        shop_name: document.getElementById("cust-shop").value.trim() || null,
        address: document.getElementById("cust-address").value.trim() || null,
        branch_id: state.isAllBranches() ? 1 : Number(state.currentBranch?.id || 1),
        initial_debt: entityType === "CUSTOMER" ? openingBalance : 0,
        initial_payable: entityType === "SUPPLIER" ? openingBalance : 0
    };

    try {
        if (editId) {
            await api.put(`/customers/${editId}`, payload);
            ui.toast.success("အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            await api.post("/customers", payload);
            ui.toast.success(entityType === "SUPPLIER" ? "ပွဲရုံအသစ် အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။" : "ဖောက်သည်အသစ် အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။");
        }

        document.getElementById("customer-modal")?.classList.add("hidden");
        await loadCustomers();
    } catch (err) {
        ui.toast.error("သိမ်းဆည်း၍ မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function openCustomerLedgerModal(cust) {
    currentCustomer = cust;
    const isSupplier = (cust.entity_type || "CUSTOMER").toUpperCase() === "SUPPLIER";
    const modal = document.getElementById("customer-ledger-modal");
    const nameEl = document.getElementById("ledger-cust-name");
    const phoneEl = document.getElementById("ledger-cust-phone");
    const balTitleEl = document.getElementById("ledger-balance-title");
    const balEl = document.getElementById("ledger-cust-debt");
    const tbody = document.getElementById("cust-ledger-table-body");

    const cleanPhone = normalizePhoneNumber(cust.phone) || cust.phone;

    if (nameEl) nameEl.textContent = cust.name;
    if (phoneEl) phoneEl.textContent = cleanPhone ? `ဖုန်း: ${cleanPhone}` : "ဖုန်း: မရှိပါ";

    if (balTitleEl) {
        balTitleEl.textContent = isSupplier ? "လက်ရှိ ပေးရန်ကျန်ငွေ" : "လက်ရှိ အကြွေးကျန်ငွေ";
    }
    if (balEl) {
        const bal = isSupplier ? Number(cust.current_payable || cust.payables || 0) : Number(cust.current_debt || 0);
        balEl.textContent = `${bal.toLocaleString()} Ks`;
        balEl.className = isSupplier ? "text-lg font-black font-mono text-amber-500" : "text-lg font-black font-mono text-rose-500";
    }

    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-12 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-xl mb-2 text-blue-500"></i>
                    <div class="text-xs font-bold">စာရင်းဆွဲယူနေပါသည်...</div>
                </td>
            </tr>
        `;
    }

    modal?.classList.remove("hidden");

    try {
        const res = await api.get(`/customers/${cust.id}/ledger`);
        // Support both paginated { items: [...] } and flat array
        activeCustomerLedger = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        renderCustomerLedger(activeCustomerLedger, isSupplier);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-500 font-bold text-xs">မှတ်တမ်း ဆွဲယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderCustomerLedger(ledgerList, isSupplier = false) {
    const tbody = document.getElementById("cust-ledger-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!Array.isArray(ledgerList) || ledgerList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-slate-400 font-bold text-xs">မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    ledgerList.forEach(entry => {
        const isDebit = entry.type === "DEBIT" || entry.type === "PURCHASE_DEBT";

        let dateStr = "-";
        if (entry.created_at) {
            const d = new Date(entry.created_at);
            const datePart = d.toLocaleDateString("en-GB");
            const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
            dateStr = `${datePart} ${timePart}`;
        }

        const amt = Number(entry.amount || 0);
        const balanceAfter = Number(entry.balance_after || 0);

        let desc = entry.reference_note || (isDebit ? (isSupplier ? "အဝယ်ဘောင်ချာ ကုန်ကြွေး" : "အရောင်းဘောင်ချာ အကြွေးကျန်") : "အကြွေးဆပ်ငွေ");
        desc = desc.replace(/\r?\n|\r/g, " ").trim();

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition h-11 whitespace-nowrap text-xs border-b border-slate-100 dark:border-slate-800/60";
        tr.innerHTML = `
            <td class="py-2.5 px-3 text-center font-mono text-slate-400">${ui.escapeHtml(dateStr)}</td>
            <td class="py-2.5 px-3 text-center">
                <span class="px-2 py-0.5 rounded font-mono font-bold text-[11px] ${isDebit ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">
                    ${isDebit ? 'DEBIT (+)' : 'CREDIT (-)'}
                </span>
            </td>
            <td class="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200 max-w-[260px] truncate" title="${ui.escapeHtml(desc)}">
                ${ui.escapeHtml(desc)}
            </td>
            <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-400 uppercase">
                ${ui.escapeHtml(entry.payment_method || (isDebit ? 'DEBT' : 'CASH'))}
            </td>
            <td class="py-2.5 px-4 text-right font-mono font-black ${isDebit ? 'text-rose-500' : 'text-emerald-500'}">
                ${isDebit ? '+' : '-'}${amt.toLocaleString()}
            </td>
            <td class="py-2.5 px-4 text-right font-mono font-black text-slate-900 dark:text-slate-100">
                ${balanceAfter.toLocaleString()}
            </td>
            <td class="py-2.5 px-3 text-center text-slate-400 font-medium max-w-[130px] truncate" title="${ui.escapeHtml(entry.created_by_name || 'Admin')}">
                ${ui.escapeHtml(entry.created_by_name || "Admin")}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function exportAllCustomersToCSV() {
    const listToExport = currentFilteredCustomers.length > 0 ? currentFilteredCustomers : customers;

    if (listToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်းမရှိသေးပါ။");
    }

    let csvContent = "NO,NAME,PHONE NO,SHOP,ADDRESS,TYPE,RECEIVABLES,PAYABLES,STATUS\n";

    listToExport.forEach((c, idx) => {
        const no = idx + 1;
        const isSupplier = (c.entity_type || "CUSTOMER").toUpperCase() === "SUPPLIER";
        const debt = Number(c.current_debt || 0);
        const payable = Number(c.current_payable || c.payables || 0);

        let status = "ရှင်းပြီး";
        if (isSupplier && payable > 0) status = "ပေးရန်ရှိ";
        else if (!isSupplier && debt > 0) status = "အကြွေးကျန်ရှိ";

        let typeStr = "RETAIL";
        if (isSupplier) typeStr = "SUPPLIER";
        else if (String(c.customer_type || "").toLowerCase() === "wholesale") typeStr = "WHOLESALE";

        const cleanPhone = normalizePhoneNumber(c.phone) || c.phone || "-";

        const row = [
            no,
            ui.escapeCsv(c.name),
            ui.escapeCsv(cleanPhone),
            ui.escapeCsv(c.shop_name || "-"),
            ui.escapeCsv(c.address || "-"),
            ui.escapeCsv(typeStr),
            debt,
            payable,
            ui.escapeCsv(status)
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Contacts_Receivables_Payables_${getLocalTodayDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function exportCustomerLedgerToCSV() {
    if (!activeCustomerLedger || activeCustomerLedger.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် မှတ်တမ်းမရှိပါ။");
    }

    const custName = currentCustomer ? currentCustomer.name : "Contact";
    let csvContent = "DATE & TIME,TYPE,DESCRIPTION / REF,METHOD,AMOUNT,BALANCE,USER\n";

    activeCustomerLedger.forEach(item => {
        const isDebit = item.type === "DEBIT" || item.type === "PURCHASE_DEBT";
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleString("en-GB") : "-";
        const typeStr = isDebit ? "အကြွေးယူခြင်း (Debit +)" : "အကြွေးဆပ်ခြင်း (Credit -)";
        const sign = isDebit ? "+" : "-";

        const row = [
            ui.escapeCsv(dateStr),
            ui.escapeCsv(typeStr),
            ui.escapeCsv(item.reference_note || ""),
            ui.escapeCsv(String(item.payment_method || (isDebit ? "DEBT" : "CASH")).toUpperCase()),
            `"${sign}${Number(item.amount || 0)}"`,
            Number(item.balance_after || 0),
            ui.escapeCsv(item.created_by_name || "Admin")
        ];
        csvContent += row.join(",") + "\n";
    });

    const safeName = custName.replace(/[\/\\:*?"<>|]/g, "_");
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Statement_${safeName}_${getLocalTodayDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function printCustomerStatement() {
    if (!currentCustomer) {
        return ui.toast.warning("ပရင့်ထုတ်ရန် စာရင်းမရှိပါ။");
    }

    const isSupplier = (currentCustomer.entity_type || "CUSTOMER").toUpperCase() === "SUPPLIER";
    const custName = ui.escapeHtml(currentCustomer.name || "-");
    const custPhone = ui.escapeHtml(normalizePhoneNumber(currentCustomer.phone) || currentCustomer.phone || "-");
    const custShop = ui.escapeHtml(currentCustomer.shop_name || "-");
    const custAddress = ui.escapeHtml(currentCustomer.address || "-");
    const balance = isSupplier
        ? Number(currentCustomer.current_payable || currentCustomer.payables || 0).toLocaleString()
        : Number(currentCustomer.current_debt || 0).toLocaleString();
    const balanceTitle = isSupplier ? "လက်ကျန်ပေးရန်ငွေ" : "လက်ကျန်အကြွေး";
    const todayDate = new Date().toLocaleDateString("en-GB");

    let tableRows = "";
    if (!Array.isArray(activeCustomerLedger) || activeCustomerLedger.length === 0) {
        tableRows = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: #888;">စာရင်းမှတ်တမ်း မရှိသေးပါ</td></tr>`;
    } else {
        activeCustomerLedger.forEach((entry, idx) => {
            const isDebit = entry.type === "DEBIT" || entry.type === "PURCHASE_DEBT";
            let dateStr = "-";
            if (entry.created_at) {
                const d = new Date(entry.created_at);
                dateStr = `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
            }

            const rawDesc = (entry.reference_note || (isDebit ? (isSupplier ? "အဝယ်ဘောင်ချာ ကုန်ကြွေး" : "အရောင်းဘောင်ချာ အကြွေးကျန်") : "အကြွေးဆပ်ငွေ")).replace(/\r?\n|\r/g, " ");
            const desc = ui.escapeHtml(rawDesc);
            const method = ui.escapeHtml(String(entry.payment_method || (isDebit ? "DEBT" : "CASH")).toUpperCase());
            const sign = isDebit ? "+" : "-";
            const amt = Number(entry.amount || 0).toLocaleString();
            const bal = Number(entry.balance_after || 0).toLocaleString();

            tableRows += `
                <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
                    <td style="padding: 6px 4px; text-align: center; color: #64748b;">${idx + 1}</td>
                    <td style="padding: 6px 8px; text-align: center; font-family: monospace;">${ui.escapeHtml(dateStr)}</td>
                    <td style="padding: 6px 8px; text-align: center; font-weight: bold; color: ${isDebit ? '#dc2626' : '#16a34a'};">
                        ${isDebit ? 'DEBIT (+)' : 'CREDIT (-)'}
                    </td>
                    <td style="padding: 6px 8px; text-align: left;">${desc}</td>
                    <td style="padding: 6px 8px; text-align: center; font-family: monospace; color: #475569;">${method}</td>
                    <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: bold; color: ${isDebit ? '#dc2626' : '#16a34a'};">
                        ${sign}${amt}
                    </td>
                    <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: 800;">
                        ${bal}
                    </td>
                </tr>
            `;
        });
    }

    const printWindow = window.open("", "_blank", "width=900,height=650");
    if (!printWindow) {
        return ui.toast.error("Browser pop-up ကို ခွင့်ပြုပေးပါရန်");
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Statement - ${custName}</title>
            <style>
                @page { size: auto; margin: 10mm; }
                body {
                    font-family: 'Padauk', 'Myanmar Text', sans-serif;
                    background: #fff;
                    color: #0f172a;
                    margin: 0;
                    padding: 10px;
                }
                .voucher-box {
                    max-width: 800px;
                    margin: auto;
                    border: 1px solid #cbd5e1;
                    padding: 24px;
                    border-radius: 8px;
                }
                .header-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
                .info-box {
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    padding: 12px;
                    margin-bottom: 16px;
                    font-size: 12px;
                }
                .data-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 16px;
                }
                .data-table th {
                    background: #f1f5f9;
                    color: #334155;
                    font-size: 11px;
                    font-weight: 800;
                    padding: 8px;
                    border-bottom: 2px solid #cbd5e1;
                }
                .footer {
                    margin-top: 24px;
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    color: #64748b;
                }
            </style>
        </head>
        <body>
            <div class="voucher-box">
                <table class="header-table">
                    <tr>
                        <td>
                            <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">မြကမ္ဘာစိုး ပိုးထည်တိုက်</h2>
                            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${isSupplier ? 'SUPPLIER ACCOUNT STATEMENT' : 'CUSTOMER ACCOUNT STATEMENT'}</div>
                        </td>
                        <td style="text-align: right;">
                            <div style="font-size: 11px; color: #64748b;">ရက်စွဲ: <strong>${todayDate}</strong></div>
                            <div style="font-size: 13px; font-weight: bold; color: ${isSupplier ? '#d97706' : '#dc2626'}; margin-top: 4px;">
                                ${balanceTitle}: ${balance} Ks
                            </div>
                        </td>
                    </tr>
                </table>

                <div class="info-box">
                    <table style="width: 100%; font-size: 12px;">
                        <tr>
                            <td style="width: 50%;"><strong>အမည်:</strong> ${custName}</td>
                            <td style="width: 50%;"><strong>ဖုန်းနံပါတ်:</strong> ${custPhone}</td>
                        </tr>
                        <tr>
                            <td style="padding-top: 4px;"><strong>ဆိုင် / ပွဲရုံ:</strong> ${custShop}</td>
                            <td style="padding-top: 4px;"><strong>လိပ်စာ:</strong> ${custAddress}</td>
                        </tr>
                    </table>
                </div>

                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width: 30px; text-align: center;">NO</th>
                            <th style="width: 130px; text-align: center;">DATE & TIME</th>
                            <th style="width: 90px; text-align: center;">TYPE</th>
                            <th style="text-align: left;">DESCRIPTION / REF</th>
                            <th style="width: 60px; text-align: center;">METHOD</th>
                            <th style="width: 100px; text-align: right;">AMOUNT</th>
                            <th style="width: 100px; text-align: right;">BALANCE (Ks)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>

                <div class="footer" style="margin-top: 40px; padding-top: 20px;">
                    <div>စာရင်းကိုင်လက်မှတ်: __________________</div>
                    <div>လက်ခံသူလက်မှတ်: __________________</div>
                </div>
            </div>
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}
