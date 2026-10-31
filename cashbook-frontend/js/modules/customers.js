// cashbook-frontend/js/modules/customers.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI, refreshGlobalKPIs } from "../app.js";

let customers = [];
let activeCustomerLedger = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initCustomers() {
    bindEvents();
    await loadCustomers();
}

function bindEvents() {
    // ဖောက်သည်အသစ် Modal ဖွင့်/ပိတ်
    document.getElementById("btn-add-customer")?.addEventListener("click", () => {
        document.getElementById("customer-form")?.reset();
        document.getElementById("customer-modal")?.classList.remove("hidden");
    });
    document.getElementById("btn-close-cust-modal")?.addEventListener("click", () => {
        document.getElementById("customer-modal")?.classList.add("hidden");
    });

    // အကြွေးဆပ် Modal ပိတ်ခြင်း
    document.getElementById("btn-close-repay-modal")?.addEventListener("click", () => {
        document.getElementById("repay-modal")?.classList.add("hidden");
    });

    // အကြွေးမှတ်တမ်း (Ledger / Statement) Modal ပိတ်ခြင်း
    document.getElementById("btn-close-ledger-modal")?.addEventListener("click", () => {
        document.getElementById("customer-ledger-modal")?.classList.add("hidden");
    });

    // Forms Submit
    document.getElementById("customer-form")?.addEventListener("submit", submitNewCustomer);
    document.getElementById("repay-form")?.addEventListener("submit", submitRepayment);

    // Search Input
    document.getElementById("cust-search")?.addEventListener("input", (e) => {
        const kw = e.target.value.trim().toLowerCase();
        const filtered = customers.filter(c =>
            `${c.name || ""} ${c.phone || ""} ${c.shop_name || ""} ${c.address || ""}`.toLowerCase().includes(kw)
        );
        renderTable(filtered);
    });

    // Repay Modal: ဘဏ်လွှဲရွေးချယ်ပါက ဘဏ်အမည်အကွက် ဖွင့်ပေးခြင်း
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

    // Ledger Print (Statement ထုတ်ပေးရန်)
    document.getElementById("btn-print-ledger")?.addEventListener("click", () => {
        window.print();
    });
}

async function loadCustomers() {
    const tbody = document.getElementById("cust-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const res = await api.get("/customers");
        customers = res.data || [];

        const totalCust = customers.length;
        const wholesaleCust = customers.filter(c => c.customer_type === "wholesale").length;
        const debtors = customers.filter(c => Number(c.current_debt || 0) > 0);
        const totalDebt = customers.reduce((sum, c) => sum + Number(c.current_debt || 0), 0);

        setKPI(1, "စုစုပေါင်း ဖောက်သည်ဦးရေ", totalCust, "fa-users", "blue");
        setKPI(2, "လက်ကား ဖောက်သည်ဦးရေ", wholesaleCust, "fa-store", "emerald");
        setKPI(3, "အကြွေးကျန်ရှိသူ ဦးရေ", debtors.length, "fa-user-clock", "amber");
        setKPI(4, "ရရန်ကျန် အကြွေးစုစုပေါင်း", totalDebt, "fa-hand-holding-dollar", "rose");

        renderTable(customers);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-rose-500 font-bold">ဖောက်သည်စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderTable(list) {
    const tbody = document.getElementById("cust-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-12 text-center text-slate-400 font-bold text-base">ဖောက်သည်စာရင်း မရှိသေးပါ</td></tr>`;
        return;
    }

    list.forEach(c => {
        const debt = Number(c.current_debt || 0);
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-bold text-slate-900 dark:text-white">${escapeHtml(c.name)}</td>
            <td class="p-4 font-mono text-slate-500 dark:text-slate-400">${escapeHtml(c.phone || "-")}</td>
            <td class="p-4">
                <div class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(c.shop_name || "-")}</div>
                <span class="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold uppercase">${escapeHtml(c.customer_type || "retail")}</span>
            </td>
            <td class="p-4 text-slate-500 dark:text-slate-400 text-xs">${escapeHtml(c.address || "-")}</td>
            <td class="p-4 text-right font-mono font-black text-base ${debt > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}">
                ${debt.toLocaleString()} Ks
            </td>
            <td class="p-4 text-center">
                <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${debt > 0 ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'}">
                    ${debt > 0 ? 'အကြွေးကျန်ရှိ' : 'ရှင်းပြီး'}
                </span>
            </td>
            <td class="p-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    <!-- မှတ်တမ်းကြည့်ရန် Button (ဘယ်နေ့ ဘယ်လောက်ဆပ်သွားသည်ကို အပြည့်အစုံ ကြည့်နိုင်သည်) -->
                    <button type="button" data-id="${c.id}" title="အကြွေးနှင့် ပြန်ဆပ်မှတ်တမ်း ကြည့်မည်" class="btn-view-ledger px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-600 transition cursor-pointer flex items-center gap-1 shadow-sm">
                        <i class="fa-solid fa-receipt text-blue-500"></i>
                        <span>မှတ်တမ်း</span>
                    </button>

                    <!-- အကြွေးဆပ်ရန် Button -->
                    ${debt > 0 ? `
                    <button type="button" data-id="${c.id}" class="btn-repay px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer flex items-center gap-1">
                        <i class="fa-solid fa-hand-holding-dollar"></i>
                        <span>အကြွေးဆပ်မည်</span>
                    </button>` : `
                    <button type="button" disabled class="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-lg text-xs font-bold cursor-not-allowed">
                        ကင်းရှင်း
                    </button>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Event Bindings
    tbody.querySelectorAll(".btn-repay").forEach(btn => {
        btn.onclick = () => {
            const cust = customers.find(item => item.id === Number(btn.dataset.id));
            if (cust) openRepayModal(cust);
        };
    });

    tbody.querySelectorAll(".btn-view-ledger").forEach(btn => {
        btn.onclick = () => {
            const cust = customers.find(item => item.id === Number(btn.dataset.id));
            if (cust) openCustomerLedgerModal(cust);
        };
    });
}

// --- Customer Ledger / Statement Modal Logic (နေ့စွဲအလိုက် ကြွေးမြီမှတ်တမ်း) ---
async function openCustomerLedgerModal(cust) {
    const modal = document.getElementById("customer-ledger-modal");
    const nameEl = document.getElementById("ledger-cust-name");
    const phoneEl = document.getElementById("ledger-cust-phone");
    const debtEl = document.getElementById("ledger-cust-debt");
    const tbody = document.getElementById("cust-ledger-table-body");

    if (nameEl) nameEl.textContent = cust.name;
    if (phoneEl) phoneEl.textContent = cust.phone ? `ဖုန်း: ${cust.phone}` : "ဖုန်းနံပါတ် မရှိပါ";
    if (debtEl) debtEl.textContent = `${Number(cust.current_debt || 0).toLocaleString()} Ks`;

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center"><i class="fa-solid fa-spinner fa-spin text-blue-500 text-xl"></i> စာရင်းဆွဲယူနေပါသည်...</td></tr>`;
    }

    modal?.classList.remove("hidden");

    try {
        const res = await api.get(`/customers/${cust.id}/ledger`);
        activeCustomerLedger = res.data || [];
        renderCustomerLedger(activeCustomerLedger);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-500 font-bold">မှတ်တမ်း ဆွဲယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderCustomerLedger(ledgerList) {
    const tbody = document.getElementById("cust-ledger-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (ledgerList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-slate-400 font-bold text-sm">ဤဖောက်သည်အတွက် အကြွေးနှင့် ပြန်ဆပ်မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    ledgerList.forEach(entry => {
        const isDebit = entry.type === "DEBIT"; // DEBIT = အကြွေးယူခြင်း / ဝယ်ယူခြင်း
        const dateStr = entry.created_at ? new Date(entry.created_at).toLocaleString("en-GB", { hour12: true }) : "-";
        const amt = Number(entry.amount || 0);
        const balanceAfter = Number(entry.balance_after || 0);

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition border-b border-slate-100 dark:border-slate-800 text-xs";
        tr.innerHTML = `
            <td class="p-3 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">${dateStr}</td>
            <td class="p-3">
                <span class="px-2.5 py-1 rounded-md font-bold text-[11px] ${isDebit ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'}">
                    ${isDebit ? 'အကြွေးယူခြင်း (Debit)' : 'အကြွေးဆပ်ခြင်း (Credit)'}
                </span>
            </td>
            <td class="p-3 font-bold text-slate-800 dark:text-slate-200">
                ${escapeHtml(entry.reference_note || (isDebit ? 'အရောင်းဘောင်ချာ အကြွေးကျန်' : 'အကြွေးဆပ်ငွေ'))}
            </td>
            <td class="p-3 text-slate-600 dark:text-slate-400 font-bold capitalize">
                ${escapeHtml(entry.payment_method || (isDebit ? 'အကြွေး' : 'ငွေသား'))}
            </td>
            <td class="p-3 text-right font-mono font-bold text-sm ${isDebit ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">
                ${isDebit ? '+' : '-'}${amt.toLocaleString()}
            </td>
            <td class="p-3 text-right font-mono font-black text-sm text-slate-900 dark:text-white">
                ${balanceAfter.toLocaleString()} Ks
            </td>
            <td class="p-3 text-center text-slate-500 text-[11px]">
                ${escapeHtml(entry.created_by_name || "Admin")}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Repayment Modal Logic ---
function openRepayModal(cust) {
    document.getElementById("repay-form")?.reset();
    document.getElementById("repay-cust-id").value = cust.id;
    document.getElementById("repay-modal-title").textContent = `${cust.name} - အကြွေးဆပ်ငွေ လက်ခံခြင်း`;
    document.getElementById("repay-current-debt").textContent = Number(cust.current_debt || 0).toLocaleString();
    
    // Default ပမာဏကို လက်ကျန်အကြွေးအတိုင်း ဖြည့်ပေးမည် (ပြင်ဆင်နိုင်သည်)
    const amountInput = document.getElementById("repay-amount");
    if (amountInput) {
        amountInput.value = cust.current_debt || 0;
        amountInput.max = cust.current_debt || 0;
    }

    // ရက်စွဲကို ယနေ့ရက်စွဲ (YYYY-MM-DD) Default ထည့်ပေးခြင်း
    const dateInput = document.getElementById("repay-date");
    if (dateInput) {
        dateInput.value = new Date().toISOString().split("T")[0];
    }

    document.getElementById("repay-modal")?.classList.remove("hidden");
    amountInput?.focus();
}

async function submitNewCustomer(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-new-cust");
    if (btn) btn.disabled = true;

    const payload = {
        name: document.getElementById("cust-name").value.trim(),
        phone: document.getElementById("cust-phone").value.trim() || null,
        customerType: document.getElementById("cust-type").value,
        shopName: document.getElementById("cust-shop").value.trim() || null,
        address: document.getElementById("cust-address").value.trim() || null,
        initialDebt: parseFloat(document.getElementById("cust-debt").value) || 0
    };

    try {
        await api.post("/customers", payload);
        document.getElementById("customer-modal")?.classList.add("hidden");
        await loadCustomers();
        alert("ဖောက်သည်အသစ် အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။");
    } catch (err) {
        alert("ဖောက်သည်သစ် သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function submitRepayment(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-repay");
    const customerId = parseInt(document.getElementById("repay-cust-id").value, 10);
    const amount = parseFloat(document.getElementById("repay-amount").value) || 0;
    const paymentMethod = document.getElementById("repay-method").value;
    const bankName = document.getElementById("repay-bank-name")?.value.trim() || null;
    const note = document.getElementById("repay-note").value.trim();
    const repayDate = document.getElementById("repay-date")?.value || new Date().toISOString().split("T")[0];

    if (amount <= 0) {
        return alert("ကျေးဇူးပြု၍ မှန်ကန်သော ဆပ်ငွေပမာဏ ထည့်သွင်းပေးပါ");
    }

    if (paymentMethod === "bank" && !bankName) {
        return alert("ဘဏ်လွှဲဖြစ်ပါက ကျေးဇူးပြု၍ ဘဏ်အမည် ရွေးချယ်/ထည့်သွင်းပေးပါ");
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
        alert("အကြွေးဆပ်ငွေ အောင်မြင်စွာ လက်ခံမှတ်တမ်းတင်ပြီးပါပြီ။ ငွေစာရင်း (Cashbook) ထဲသို့လည်း အလိုအလျောက် ဝင်ရောက်သွားပါပြီ။");
        await loadCustomers();
        await refreshGlobalKPIs("customers");
    } catch (err) {
        alert("အကြွေးဆပ်မှု မအောင်မြင်ပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}
