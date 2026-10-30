// cashbook-frontend/js/modules/cashbook.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";

let entries = [];
let categories = [];

export async function initCashbook() {
    const dateInput = document.getElementById("cb-date-filter");
    if (dateInput) dateInput.value = new Date().toISOString().split("T")[0];

    bindEvents();
    await loadCategories();
    await loadEntries();
}

function bindEvents() {
    document.getElementById("btn-add-expense")?.addEventListener("click", () => openModal("EXPENSE"));
    document.getElementById("btn-add-income")?.addEventListener("click", () => openModal("INCOME"));
    document.getElementById("btn-close-entry-modal")?.addEventListener("click", () => {
        document.getElementById("entry-modal")?.classList.add("hidden");
    });

    document.getElementById("entry-form")?.addEventListener("submit", submitEntry);
    document.getElementById("cb-date-filter")?.addEventListener("change", loadEntries);

    document.getElementById("cb-search")?.addEventListener("input", (e) => {
        const kw = e.target.value.toLowerCase();
        const filtered = entries.filter(r =>
            (r.category_name || "").toLowerCase().includes(kw) ||
            (r.description || "").toLowerCase().includes(kw)
        );
        renderTable(filtered);
    });

    document.getElementById("btn-export-csv")?.addEventListener("click", exportCSV);
}

async function loadCategories() {
    try {
        const res = await api.get("/cashbook/categories");
        categories = res.data || [];
    } catch (err) {
        console.error("Categories load error:", err);
    }
}

async function loadEntries() {
    const tbody = document.getElementById("cashbook-table-body");
    const date = document.getElementById("cb-date-filter")?.value || new Date().toISOString().split("T")[0];
    const branchId = state.currentBranch?.id || 1;

    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;

    try {
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: date, end_date: date });
        entries = res.data?.entries || [];
        const s = res.data?.summary || { cash: { in: 0, out: 0, net: 0 }, bank: { in: 0, out: 0, net: 0 }, totalNet: 0 };

        // Update Top 4 Global KPI Boxes seamlessly
        setKPI(1, "လက်ကျန် ငွေသား (Cash Net)", s.cash.net, "fa-money-bill-wave");
        setKPI(2, "လက်ကျန် ဘဏ်ငွေ (Bank Net)", s.bank.net, "fa-building-columns");
        setKPI(3, "စုစုပေါင်း စရိတ်ထွက်ငွေ (Expenses)", (s.cash.out || 0) + (s.bank.out || 0), "fa-arrow-trend-down");
        setKPI(4, "စုစုပေါင်း အသားတင် (Total Net)", s.totalNet, "fa-vault");

        renderTable(entries);
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍ မရပါ</td></tr>`;
    }
}

function renderTable(data) {
    const tbody = document.getElementById("cashbook-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-12 text-center text-slate-400 text-base font-bold">ရွေးချယ်ထားသော ရက်စွဲအတွက် မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    data.forEach(item => {
        const isIncome = item.entry_type === "INCOME";
        const colorClass = isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
        const sign = isIncome ? "+" : "-";

        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        row.innerHTML = `
            <td class="p-4 font-mono text-slate-500 dark:text-slate-400">${item.entry_date}</td>
            <td class="p-4">
                <span class="px-3 py-1 rounded-lg text-xs font-bold ${isIncome ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'}">
                    ${item.category_name}
                </span>
            </td>
            <td class="p-4 max-w-xs truncate">${item.description || '-'}</td>
            <td class="p-4 uppercase text-xs font-extrabold text-slate-500">${item.payment_method}</td>
            <td class="p-4 text-right font-black font-mono text-base ${colorClass}">${sign}${Number(item.amount).toLocaleString()}</td>
            <td class="p-4 text-center">
                <button data-id="${item.id}" class="btn-delete px-3 py-1.5 bg-slate-100 dark:bg-slate-900 hover:bg-rose-600 hover:text-white rounded-lg transition text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                    <i class="fa-solid fa-trash-can mr-1"></i> ဖျက်မည်
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    tbody.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => deleteEntry(btn.dataset.id));
    });
}

function openModal(type) {
    const modal = document.getElementById("entry-modal");
    const header = document.getElementById("entry-modal-header");
    const title = document.getElementById("entry-modal-title");
    const select = document.getElementById("entry-category");
    const btn = document.getElementById("btn-submit-entry");

    document.getElementById("entry-form")?.reset();
    document.getElementById("entry-type").value = type;

    if (type === "EXPENSE") {
        header.className = "p-5 bg-rose-600 text-white flex items-center justify-between";
        title.textContent = "အသုံးစရိတ် အသစ်ထည့်မည်";
        btn.className = "w-full py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-base rounded-xl shadow-lg transition cursor-pointer";
    } else {
        header.className = "p-5 bg-emerald-600 text-white flex items-center justify-between";
        title.textContent = "အခြားဝင်ငွေ အသစ်ထည့်မည်";
        btn.className = "w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-base rounded-xl shadow-lg transition cursor-pointer";
    }

    const filteredCats = categories.filter(c => c.type === type);
    select.innerHTML = '<option value="" disabled selected>ခေါင်းစဉ် ရွေးချယ်ပါ ▼</option>';
    filteredCats.forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });

    modal?.classList.remove("hidden");
}

async function submitEntry(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-entry");
    btn.disabled = true;

    const payload = {
        branchId: state.currentBranch?.id || 1,
        categoryId: parseInt(document.getElementById("entry-category").value),
        entryType: document.getElementById("entry-type").value,
        paymentMethod: document.getElementById("entry-payment-method").value,
        amount: parseFloat(document.getElementById("entry-amount").value),
        description: document.getElementById("entry-desc").value.trim(),
        entryDate: document.getElementById("cb-date-filter").value,
        createdBy: state.user?.id || 1
    };

    try {
        const res = await api.post("/cashbook/entries", payload);
        if (res.success) {
            document.getElementById("entry-modal")?.classList.add("hidden");
            await loadEntries();
        }
    } catch (err) {
        alert("စာရင်းသွင်း၍ မရပါ: " + err.message);
    } finally {
        btn.disabled = false;
    }
}

async function deleteEntry(id) {
    if (!confirm("ဤစာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?")) return;
    try {
        await api.delete(`/cashbook/entries/${id}`);
        await loadEntries();
    } catch (err) {
        alert(err.message || "ဖျက်၍မရပါ");
    }
}

function exportCSV() {
    if (entries.length === 0) return alert("ထုတ်ယူရန် စာရင်းမရှိသေးပါ");
    let csv = "Date,Category,Type,Method,Amount,Description\n";
    entries.forEach(r => {
        csv += `"${r.entry_date}","${r.category_name}","${r.entry_type}","${r.payment_method}","${r.amount}","${(r.description || '').replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashbook-${document.getElementById("cb-date-filter")?.value || 'export'}.csv`;
    a.click();
}
