// cashbook-frontend/js/modules/customers.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI, refreshGlobalKPIs } from "../app.js";

let customers = [];

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
    document.getElementById("btn-add-customer")?.addEventListener("click", () => {
        document.getElementById("customer-form")?.reset();
        document.getElementById("customer-modal")?.classList.remove("hidden");
    });
    document.getElementById("btn-close-cust-modal")?.addEventListener("click", () => {
        document.getElementById("customer-modal")?.classList.add("hidden");
    });
    document.getElementById("btn-close-repay-modal")?.addEventListener("click", () => {
        document.getElementById("repay-modal")?.classList.add("hidden");
    });

    document.getElementById("customer-form")?.addEventListener("submit", submitNewCustomer);
    document.getElementById("repay-form")?.addEventListener("submit", submitRepayment);

    document.getElementById("cust-search")?.addEventListener("input", (e) => {
        const kw = e.target.value.trim().toLowerCase();
        const filtered = customers.filter(c =>
            `${c.name || ""} ${c.phone || ""} ${c.shop_name || ""} ${c.address || ""}`.toLowerCase().includes(kw)
        );
        renderTable(filtered);
    });
}

async function loadCustomers() {
    const tbody = document.getElementById("cust-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
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
            tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-rose-500 font-bold">ဖောက်သည်စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderTable(list) {
    const tbody = document.getElementById("cust-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-12 text-center text-slate-400 font-bold">ဖောက်သည်စာရင်း မရှိသေးပါ</td></tr>`;
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
                <div class="font-bold">${escapeHtml(c.shop_name || "-")}</div>
                <span class="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase">${escapeHtml(c.customer_type || "retail")}</span>
            </td>
            <td class="p-4 text-slate-500">${escapeHtml(c.address || "-")}</td>
            <td class="p-4 text-right font-mono font-black text-base ${debt > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}">
                ${debt.toLocaleString()}
            </td>
            <td class="p-4 text-center">
                ${debt > 0 ? `
                <button type="button" data-id="${c.id}" class="btn-repay px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer">
                    <i class="fa-solid fa-money-bill-transfer mr-1"></i> အကြွေးဆပ်မည်
                </button>` : `<span class="text-xs text-emerald-500 font-bold">အကြွေးကင်းရှင်း</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-repay").forEach(btn => {
        btn.onclick = () => {
            const cust = customers.find(item => item.id === Number(btn.dataset.id));
            if (cust) openRepayModal(cust);
        };
    });
}

function openRepayModal(cust) {
    document.getElementById("repay-form")?.reset();
    document.getElementById("repay-cust-id").value = cust.id;
    document.getElementById("repay-modal-title").textContent = `${cust.name} - အကြွေးဆပ်ငွေ လက်ခံခြင်း`;
    document.getElementById("repay-current-debt").textContent = Number(cust.current_debt || 0).toLocaleString();
    document.getElementById("repay-amount").value = cust.current_debt || 0;
    document.getElementById("repay-modal")?.classList.remove("hidden");
}

async function submitNewCustomer(e) {
    e.preventDefault();
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
    } catch (err) {
        alert("ဖောက်သည်သစ် သိမ်းဆည်း၍မရပါ: " + err.message);
    }
}

async function submitRepayment(e) {
    e.preventDefault();
    const customerId = parseInt(document.getElementById("repay-cust-id").value, 10);
    const amount = parseFloat(document.getElementById("repay-amount").value) || 0;
    const paymentMethod = document.getElementById("repay-method").value;
    const note = document.getElementById("repay-note").value.trim();

    try {
        await api.post("/customers/repay", {
            customerId,
            branchId: state.currentBranch?.id || 1,
            amount,
            paymentMethod,
            note,
            createdBy: state.user?.id || 1
        });
        document.getElementById("repay-modal")?.classList.add("hidden");
        await loadCustomers();
        await refreshGlobalKPIs("customers");
    } catch (err) {
        alert("အကြွေးဆပ်မှု မအောင်မြင်ပါ: " + err.message);
    }
}
