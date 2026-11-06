// cashbook-frontend/js/modules/customers.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Standardized UI components (Toast, Confirm, escapeHtml, escapeCsv)
import { setKPI, refreshGlobalKPIs } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let customers = [];
let currentFilteredCustomers = [];
let activeCustomerLedger = [];
let currentCustomer = null;

// ဖောက်သည်စာရင်းအတွက် စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Controller
const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

/**
 * မြန်မာဂဏန်း (၀၁၂၃၄၅၆၇၈၉) မှ အင်္ဂလိပ်ဂဏန်း (0123456789) သို့ အလိုအလျောက် ပြောင်းပေးသည့် Helper
 */
function parseAnyNumber(val) {
    if (!val) return 0;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let cleanStr = String(val).replace(/,/g, "").trim();
    myanmarDigits.forEach((d, idx) => {
        cleanStr = cleanStr.replaceAll(d, String(idx));
    });
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
}

/**
 * ဖုန်းနံပါတ်ကို မြန်မာဂဏန်းရိုက်ရိုက်/အင်္ဂလိပ်ဂဏန်းရိုက်ရိုက် သန့်ရှင်းသော 09xxxxxxxxx အဖြစ် အလိုအလျောက် ပြောင်းလဲခြင်း
 */
function normalizePhoneNumber(phoneStr) {
    if (!phoneStr) return null;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let clean = String(phoneStr).trim();
    
    // မြန်မာဂဏန်းများကို အင်္ဂလိပ်ဂဏန်းသို့ ပြောင်းခြင်း
    myanmarDigits.forEach((d, idx) => {
        clean = clean.replaceAll(d, String(idx));
    });
    
    // space နှင့် dash (-) များကို ဖယ်ရှားပြီး ဂဏန်းသီးသန့် ထုတ်ယူခြင်း
    clean = clean.replace(/[^0-9]/g, "");
    return clean || null;
}

export async function initCustomers() {
    bindEvents();
    await loadCustomers();
}

function bindEvents() {
    // ၁။ Toolbar Buttons
    document.getElementById("btn-export-customers-csv")?.addEventListener("click", exportAllCustomersToCSV);
    document.getElementById("btn-export-ledger-csv")?.addEventListener("click", exportCustomerLedgerToCSV);

    // Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-customers");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadCustomers();
            setTimeout(() => icon?.classList.remove("fa-spin"), 500);
            ui.toast.info("ဖောက်သည်စာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // ၂။ Add New Button (Customer Modal ဖွင့်/ပိတ်)
    document.getElementById("btn-add-customer")?.addEventListener("click", () => {
        document.getElementById("customer-form")?.reset();
        document.getElementById("cust-edit-id").value = "";
        document.getElementById("cust-modal-header-title").textContent = "ဖောက်သည်အသစ် မှတ်တမ်းတင်မည်";
        document.getElementById("btn-submit-cust-text").textContent = "ဖောက်သည် သိမ်းဆည်းမည်";
        document.getElementById("cust-debt-container")?.classList.remove("hidden");
        document.getElementById("customer-modal")?.classList.remove("hidden");
        document.getElementById("cust-name")?.focus();
    });

    document.getElementById("btn-close-cust-modal")?.addEventListener("click", () => {
        document.getElementById("customer-modal")?.classList.add("hidden");
    });

    // ၃။ Repay Modal ပိတ်ခြင်း
    document.getElementById("btn-close-repay-modal")?.addEventListener("click", () => {
        document.getElementById("repay-modal")?.classList.add("hidden");
    });

    // ၄။ Ledger Modal ပိတ်ခြင်း
    document.getElementById("btn-close-ledger-modal")?.addEventListener("click", () => {
        document.getElementById("customer-ledger-modal")?.classList.add("hidden");
    });

    // ၅။ Form Submits
    document.getElementById("customer-form")?.addEventListener("submit", submitCustomerForm);
    document.getElementById("repay-form")?.addEventListener("submit", submitRepayment);

    // ၆။ Search Filter (စစ်ထုတ်ရှာဖွေချိန်တွင် စာမျက်နှာ ၁ သို့ Reset လုပ်ခြင်း)
    document.getElementById("cust-search")?.addEventListener("input", (e) => {
        const kw = e.target.value.trim().toLowerCase();
        currentFilteredCustomers = customers.filter(c =>
            `${c.name || ""} ${c.phone || ""} ${c.shop_name || ""} ${c.address || ""}`.toLowerCase().includes(kw)
        );
        pagination.reset();
        renderTable();
    });

    // ၇။ Repay Method Select: ဘဏ်ရွေးပါက Dropdown ဖွင့်ပေးခြင်း
    const repayMethodSelect = document.getElementById("repay-method");
    if (repayMethodSelect) {
        repayMethodSelect.addEventListener("change", (e) => {
            const bankBox = document.getElementById("repay-bank-container");
            if (e.target.value === "bank") {
                bankBox?.classList.remove("hidden");
            } else {
                bankBox?.classList.add("hidden");
            }
        });
    }

    // ၈။ Statement ပရင့်ထုတ်ခြင်း
    document.getElementById("btn-print-ledger")?.addEventListener("click", printCustomerStatement);
    });
}

async function loadCustomers() {
    const tbody = document.getElementById("cust-table-body");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-16 text-center text-slate-400">
                    <i class="fa-solid fa-spinner fa-spin text-2xl mb-3 text-emerald-500"></i>
                    <div class="font-bold text-xs">ဖောက်သည်စာရင်းများ ဆွဲယူနေပါသည်...</div>
                </td>
            </tr>
        `;
    }

    try {
        const res = await api.get("/customers");
        customers = res.data || [];
        currentFilteredCustomers = [...customers];

        const totalCust = customers.length;
        const wholesaleCust = customers.filter(c => String(c.customer_type || "").toLowerCase() === "wholesale").length;
        const retailCust = customers.filter(c => String(c.customer_type || "").toLowerCase() === "retail" || !c.customer_type).length;
        const totalDebt = customers.reduce((sum, c) => sum + Number(c.current_debt || 0), 0);

        // Standard 4-KPI Boxes (Total Customers, Wholesale Customers, Retail Customers, Total Receivables)
        setKPI(1, "Total Customers", totalCust, "fa-users", "blue");
        setKPI(2, "Wholesale Customers", wholesaleCust, "fa-store", "emerald");
        setKPI(3, "Retail Customers", retailCust, "fa-user", "purple");
        setKPI(4, "Total Receivables", totalDebt, "fa-hand-holding-dollar", "amber");

        renderTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-12 text-center text-rose-500 font-bold text-xs">ဖောက်သည်စာရင်း ရယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderTable() {
    const tbody = document.getElementById("cust-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredCustomers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-users text-3xl mb-3 opacity-30"></i>
                    <div>ရှာဖွေထားသော ဖောက်သည်စာရင်း မရှိသေးပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("customers-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredCustomers);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((c, idx) => {
        const debt = Number(c.current_debt || 0);
        const isWholesale = String(c.customer_type || "").toLowerCase() === "wholesale";
        const typeStr = isWholesale ? "WHOLESALE" : "RETAIL";
        const cleanPhone = normalizePhoneNumber(c.phone) || c.phone || "-";

        // Action Buttons: Dark Mode တွင် ပီပြင်သော Cashbook Standard Square Buttons (w-7 h-7)
        const actionButtons = `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${c.id}" title="Statement ကြည့်မည်" 
                    class="btn-view-ledger w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-receipt text-xs"></i>
                </button>

                ${debt > 0 ? `
                <button type="button" data-id="${c.id}" title="အကြွေးဆပ်ငွေ လက်ခံမည်" 
                    class="btn-repay w-7 h-7 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 dark:hover:bg-emerald-600 text-emerald-600 hover:text-white dark:text-emerald-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-hand-holding-dollar text-xs"></i>
                </button>` : `
                <button type="button" disabled title="အကြွေးကင်းရှင်းပါသည်" 
                    class="w-7 h-7 flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 text-slate-300 dark:text-slate-700 rounded-lg border border-slate-200/50 dark:border-slate-800/50 cursor-not-allowed">
                    <i class="fa-solid fa-check text-xs"></i>
                </button>`}
            </div>
        `;

        // Row Line Spacing ကို ကျစ်လျစ်စေရန် h-12 နှင့် py-2 ကို အသုံးပြုထားပါသည်
        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-12";
        row.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400">${startIdx + idx + 1}</td>
            
            <!-- 2. CUSTOMER NAME: မြန်မာစာ text-base font-bold -->
            <td class="py-2 px-4 text-base font-bold text-slate-900 dark:text-slate-100 min-w-[180px] truncate leading-tight">
                ${ui.escapeHtml(c.name)}
            </td>

            <!-- 3. PHONE NO: Header နှင့် တစ်သားတည်း text-center ထားရှိခြင်း -->
            <td class="py-2 px-3 text-center font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">
                ${ui.escapeHtml(cleanPhone)}
            </td>

            <!-- 4. SHOP: One Line သီးသန့် text-base font-medium -->
            <td class="py-2 px-4 text-base font-medium text-slate-800 dark:text-slate-200 w-40 truncate leading-tight" title="${ui.escapeHtml(c.shop_name || "-")}">
                ${ui.escapeHtml(c.shop_name || "-")}
            </td>

            <!-- 5. ADDRESS: (TYPE အရှေ့သို့ ရွှေ့ထားသည်) One Line သီးသန့် text-base -->
            <td class="py-2 px-4 text-base text-slate-600 dark:text-slate-300 min-w-[180px] max-w-xs truncate leading-tight" title="${ui.escapeHtml(c.address || "-")}">
                ${ui.escapeHtml(c.address || "-")}
            </td>

            <!-- 6. TYPE: (ADDRESS ၏ နောက်သို့ ရွှေ့ထားသည်) text-left px-4 -->
            <td class="py-2 px-4 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400">
                ${typeStr}
            </td>

            <!-- 7. RECEIVABLES: Ks မပါဝင်ဘဲ ဂဏန်းသီးသန့် text-base font-black font-mono -->
            <td class="py-2 px-4 text-right font-black font-mono text-base whitespace-nowrap ${debt > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}">
                ${debt.toLocaleString()}
            </td>

            <!-- 8. STATUS: နောက်ခံ Badge Pill ဖြုတ်ထားသော Plain Text -->
            <td class="py-2 px-3 text-center whitespace-nowrap font-mono text-xs font-bold ${debt > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">
                ${debt > 0 ? 'အကြွေးကျန်ရှိ' : 'ရှင်းပြီး'}
            </td>

            <!-- 9. ACTION: Sticky Right Cell -->
            <td class="py-2 px-3 text-center sticky right-0 bg-white dark:bg-[#151e32] z-10 shadow-[-4px_0_8px_rgba(0,0,0,0.06)]">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(row);
    });

    // Event Listeners
    tbody.querySelectorAll(".btn-repay").forEach(btn => {
        btn.addEventListener("click", () => {
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

    pagination.renderControls("customers-pagination");
}

function openRepayModal(cust) {
    document.getElementById("repay-form")?.reset();
    document.getElementById("repay-cust-id").value = cust.id;
    document.getElementById("repay-modal-title").textContent = `${cust.name} - အကြွေးဆပ်ငွေ လက်ခံခြင်း`;
    document.getElementById("repay-current-debt").textContent = Number(cust.current_debt || 0).toLocaleString();
    
    const amountInput = document.getElementById("repay-amount");
    if (amountInput) {
        amountInput.value = cust.current_debt || 0;
    }

    const dateInput = document.getElementById("repay-date");
    if (dateInput) {
        dateInput.value = new Date().toISOString().split("T")[0];
    }

    document.getElementById("repay-bank-container")?.classList.add("hidden");
    document.getElementById("repay-modal")?.classList.remove("hidden");
    amountInput?.focus();
}

async function submitRepayment(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-repay");
    const customerId = parseInt(document.getElementById("repay-cust-id").value, 10);
    const amount = parseAnyNumber(document.getElementById("repay-amount").value);
    const paymentMethod = document.getElementById("repay-method").value;
    const bankName = document.getElementById("repay-bank-name")?.value.trim() || null;
    const note = document.getElementById("repay-note").value.trim();
    const repayDate = document.getElementById("repay-date")?.value || new Date().toISOString().split("T")[0];

    if (amount <= 0) {
        return ui.toast.warning("ကျေးဇူးပြု၍ မှန်ကန်သော ဆပ်ငွေပမာဏ ထည့်သွင်းပေးပါ။");
    }

    if (paymentMethod === "bank" && !bankName) {
        return ui.toast.warning("ဘဏ်လွှဲဖြစ်ပါက ကျေးဇူးပြု၍ ဘဏ်အမည် ရွေးချယ်/ထည့်သွင်းပေးပါ။");
    }

    if (btn) btn.disabled = true;

    try {
        await api.post("/customers/repay", {
            customerId,
            branchId: state.currentBranch?.id || 1,
            amount,
            paymentMethod,
            bankAccountName: paymentMethod === "bank" ? bankName : null,
            note: note || `အကြွေးဆပ်ငွေ (${paymentMethod === 'bank' ? bankName : 'ငွေသား'})`,
            entryDate: repayDate,
            createdBy: state.user?.id || 1
        });

        document.getElementById("repay-modal")?.classList.add("hidden");
        ui.toast.success("အကြွေးဆပ်ငွေ အောင်မြင်စွာ လက်ခံမှတ်တမ်းတင်ပြီးပါပြီ။");
        await loadCustomers();
        await refreshGlobalKPIs("customers");
    } catch (err) {
        ui.toast.error("အကြွေးဆပ်မှု မအောင်မြင်ပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function submitCustomerForm(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-new-cust");
    const editId = document.getElementById("cust-edit-id")?.value;
    const name = document.getElementById("cust-name").value.trim();

    if (!name) {
        ui.toast.warning("ဖောက်သည်အမည် မဖြစ်မနေ ထည့်သွင်းပေးပါ။");
        document.getElementById("cust-name")?.focus();
        return;
    }

    if (btn) btn.disabled = true;

    const payload = {
        name,
        // ဖုန်းနံပါတ်ကို normalizePhoneNumber ဖြင့် 09xxxxxxxxx အဖြစ် အလိုအလျောက် သန့်စင်သိမ်းဆည်းခြင်း
        phone: normalizePhoneNumber(document.getElementById("cust-phone").value),
        customerType: document.getElementById("cust-type").value,
        shopName: document.getElementById("cust-shop").value.trim() || null,
        address: document.getElementById("cust-address").value.trim() || null,
        initialDebt: parseAnyNumber(document.getElementById("cust-debt").value)
    };

    try {
        if (editId) {
            await api.put(`/customers/${editId}`, payload);
            ui.toast.success("ဖောက်သည် အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            await api.post("/customers", payload);
            ui.toast.success("ဖောက်သည်အသစ် အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။");
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
    const modal = document.getElementById("customer-ledger-modal");
    const nameEl = document.getElementById("ledger-cust-name");
    const phoneEl = document.getElementById("ledger-cust-phone");
    const debtEl = document.getElementById("ledger-cust-debt");
    const tbody = document.getElementById("cust-ledger-table-body");

    const cleanPhone = normalizePhoneNumber(cust.phone) || cust.phone;

    if (nameEl) nameEl.textContent = cust.name;
    if (phoneEl) phoneEl.textContent = cleanPhone ? `ဖုန်း: ${cleanPhone}` : "ဖုန်း: မရှိပါ";
    if (debtEl) debtEl.textContent = `${Number(cust.current_debt || 0).toLocaleString()} Ks`;

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
        activeCustomerLedger = res.data || [];
        renderCustomerLedger(activeCustomerLedger);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-500 font-bold text-xs">မှတ်တမ်း ဆွဲယူ၍မရပါ (${ui.escapeHtml(err.message)})</td></tr>`;
        }
    }
}

/**
 * Customer Statement Modal: One-Line Compact Standard (စာကြောင်းမကျိုး၊ အတန်းမကျဲစေသော စံနှုန်း)
 */
function renderCustomerLedger(ledgerList) {
    const tbody = document.getElementById("cust-ledger-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (ledgerList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-slate-400 font-bold text-xs">ဤဖောက်သည်အတွက် အကြွေးနှင့် ပြန်ဆပ်မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    ledgerList.forEach(entry => {
        const isDebit = entry.type === "DEBIT";
        
        // ရက်စွဲနှင့် အချိန်ကို တစ်လိုင်းတည်း သပ်ရပ်စွာ ပြသခြင်း (DD/MM/YYYY hh:mm AM/PM)
        let dateStr = "-";
        if (entry.created_at) {
            const d = new Date(entry.created_at);
            const datePart = d.toLocaleDateString("en-GB");
            const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
            dateStr = `${datePart} ${timePart}`;
        }

        const amt = Number(entry.amount || 0);
        const balanceAfter = Number(entry.balance_after || 0);

        // Description စာသားကို တစ်လိုင်းတည်း သန့်စင်ခြင်း
        let desc = entry.reference_note || (isDebit ? "အရောင်းဘောင်ချာ အကြွေးကျန်" : "အကြွေးဆပ်ငွေ");
        desc = desc.replace(/\r?\n|\r/g, " ").trim();

        const tr = document.createElement("tr");
        // h-11 နှင့် whitespace-nowrap ဖြင့် တစ်လိုင်းတည်း ကျစ်လျစ်စေခြင်း
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition h-11 whitespace-nowrap text-xs border-b border-slate-100 dark:border-slate-800/60";
        tr.innerHTML = `
            <!-- 1. DATE & TIME (တစ်လိုင်းတည်း) -->
            <td class="py-2.5 px-3 text-center font-mono text-slate-400">${dateStr}</td>
            
            <!-- 2. TYPE (ကျစ်လျစ်သော Badge) -->
            <td class="py-2.5 px-3 text-center">
                <span class="px-2 py-0.5 rounded font-mono font-bold text-[11px] ${isDebit ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">
                    ${isDebit ? 'DEBIT (+)' : 'CREDIT (-)'}
                </span>
            </td>

            <!-- 3. DESCRIPTION / REF (တစ်လိုင်းတည်း truncate) -->
            <td class="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200 max-w-[260px] truncate" title="${ui.escapeHtml(desc)}">
                ${ui.escapeHtml(desc)}
            </td>

            <!-- 4. METHOD -->
            <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-400 uppercase">
                ${ui.escapeHtml(entry.payment_method || (isDebit ? 'DEBT' : 'CASH'))}
            </td>

            <!-- 5. AMOUNT -->
            <td class="py-2.5 px-4 text-right font-mono font-black ${isDebit ? 'text-rose-500' : 'text-emerald-500'}">
                ${isDebit ? '+' : '-'}${amt.toLocaleString()}
            </td>

            <!-- 6. BALANCE DEBT (Ks ဖြုတ်ထားသော ဂဏန်းသီးသန့် ညာဘက်ကပ်) -->
            <td class="py-2.5 px-4 text-right font-mono font-black text-slate-900 dark:text-slate-100">
                ${balanceAfter.toLocaleString()}
            </td>

            <!-- 7. USER (တစ်လိုင်းတည်း) -->
            <td class="py-2.5 px-3 text-center text-slate-400 font-medium max-w-[130px] truncate" title="${ui.escapeHtml(entry.created_by_name || 'Admin')}">
                ${ui.escapeHtml(entry.created_by_name || "Admin")}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * UI Table Header အစီအစဉ်သစ်အတိုင်း ထုတ်ယူပေးသော CSV Export စနစ်
 * Columns: NO, CUSTOMER NAME, PHONE NO, SHOP, ADDRESS, TYPE, RECEIVABLES, STATUS
 */
function exportAllCustomersToCSV() {
    const listToExport = currentFilteredCustomers.length > 0 ? currentFilteredCustomers : customers;

    if (listToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် ဖောက်သည်စာရင်း မရှိသေးပါ။");
    }

    let csvContent = "NO,CUSTOMER NAME,PHONE NO,SHOP,ADDRESS,TYPE,RECEIVABLES,STATUS\n";

    listToExport.forEach((c, idx) => {
        const no = idx + 1;
        const debt = Number(c.current_debt || 0);
        const status = debt > 0 ? "အကြွေးကျန်ရှိ" : "ရှင်းပြီး";
        const typeStr = String(c.customer_type || "retail").toUpperCase();
        const cleanPhone = normalizePhoneNumber(c.phone) || c.phone || "-";

        const row = [
            no,
            ui.escapeCsv(c.name),
            ui.escapeCsv(cleanPhone),
            ui.escapeCsv(c.shop_name || "-"),
            ui.escapeCsv(c.address || "-"),
            ui.escapeCsv(typeStr),
            debt,
            ui.escapeCsv(status)
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Customers_Receivables_Summary_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function exportCustomerLedgerToCSV() {
    if (!activeCustomerLedger || activeCustomerLedger.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် အကြွေးနှင့် ပြန်ဆပ်မှတ်တမ်း မရှိပါ။");
    }

    const custName = currentCustomer ? currentCustomer.name : "Customer";
    let csvContent = "DATE & TIME,TYPE,DESCRIPTION / REF,METHOD,AMOUNT,BALANCE DEBT,USER\n";

    activeCustomerLedger.forEach(item => {
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleString("en-GB") : "-";
        const typeStr = item.type === "DEBIT" ? "အကြွေးယူခြင်း (Debit)" : "အကြွေးဆပ်ခြင်း (Credit)";
        const sign = item.type === "DEBIT" ? "+" : "-";

        const row = [
            ui.escapeCsv(dateStr),
            ui.escapeCsv(typeStr),
            ui.escapeCsv(item.reference_note || ""),
            ui.escapeCsv(String(item.payment_method || (item.type === "DEBIT" ? "DEBT" : "CASH")).toUpperCase()),
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
    link.download = `Statement_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * Customer Statement ကို A4/A5 စာရွက်ပေါ်တွင် သန့်ရှင်းစွာ ပရင့်ထုတ်ပေးသည့် Function
 */
function printCustomerStatement() {
    if (!currentCustomer) {
        return ui.toast.warning("ပရင့်ထုတ်ရန် ဖောက်သည် မရှိပါ။");
    }

    const custName = currentCustomer.name || "-";
    const custPhone = normalizePhoneNumber(currentCustomer.phone) || currentCustomer.phone || "-";
    const custShop = currentCustomer.shop_name || "-";
    const custAddress = currentCustomer.address || "-";
    const currentDebt = Number(currentCustomer.current_debt || 0).toLocaleString();
    const todayDate = new Date().toLocaleDateString("en-GB");

    // ဇယား အတန်းများ တည်ဆောက်ခြင်း
    let tableRows = "";
    if (activeCustomerLedger.length === 0) {
        tableRows = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #888;">စာရင်းမှတ်တမ်း မရှိသေးပါ</td></tr>`;
    } else {
        activeCustomerLedger.forEach((entry, idx) => {
            const isDebit = entry.type === "DEBIT";
            let dateStr = "-";
            if (entry.created_at) {
                const d = new Date(entry.created_at);
                dateStr = `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
            }

            const desc = (entry.reference_note || (isDebit ? "အရောင်းဘောင်ချာ အကြွေးကျန်" : "အကြွေးဆပ်ငွေ")).replace(/\r?\n|\r/g, " ");
            const method = String(entry.payment_method || (isDebit ? "DEBT" : "CASH")).toUpperCase();
            const sign = isDebit ? "+" : "-";
            const amt = Number(entry.amount || 0).toLocaleString();
            const bal = Number(entry.balance_after || 0).toLocaleString();

            tableRows += `
                <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
                    <td style="padding: 6px 4px; text-align: center; color: #64748b;">${idx + 1}</td>
                    <td style="padding: 6px 8px; text-align: center; font-family: monospace;">${dateStr}</td>
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

    // သီးသန့် Print Window ဖွင့်လှစ်ခြင်း
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
                <!-- Header -->
                <table class="header-table">
                    <tr>
                        <td>
                            <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">မြကမ္ဘာစိုး ပိုးထည်တိုက်</h2>
                            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">CUSTOMER ACCOUNT STATEMENT</div>
                        </td>
                        <td style="text-align: right;">
                            <div style="font-size: 11px; color: #64748b;">ရက်စွဲ: <strong>${todayDate}</strong></div>
                            <div style="font-size: 13px; font-weight: bold; color: #dc2626; margin-top: 4px;">
                                လက်ကျန်အကြွေး: ${currentDebt} Ks
                            </div>
                        </td>
                    </tr>
                </table>

                <!-- Customer Info -->
                <div class="info-box">
                    <table style="width: 100%; font-size: 12px;">
                        <tr>
                            <td style="width: 50%;"><strong>ဖောက်သည်အမည်:</strong> ${custName}</td>
                            <td style="width: 50%;"><strong>ဖုန်းနံပါတ်:</strong> ${custPhone}</td>
                        </tr>
                        <tr>
                            <td style="padding-top: 4px;"><strong>ဆိုင်အမည်:</strong> ${custShop}</td>
                            <td style="padding-top: 4px;"><strong>လိပ်စာ:</strong> ${custAddress}</td>
                        </tr>
                    </table>
                </div>

                <!-- Ledger Table -->
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

                <!-- Signatures -->
                <div class="footer" style="margin-top: 40px; padding-top: 20px;">
                    <div>စာရင်းကိုင်လက်မှတ်: __________________</div>
                    <div>ဖောက်သည်လက်မှတ်: __________________</div>
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

