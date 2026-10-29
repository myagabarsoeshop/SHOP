// cashbook-frontend/js/modules/cashbook.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

let entries = [];
let categories = [];
let currentType = "EXPENSE"; // "EXPENSE" or "INCOME"

export async function initCashbook() {
    bindEvents();
    
    // Set today's date in filter by default
    document.getElementById("cb-date-filter").value = new Date().toISOString().split("T")[0];
    
    await loadCategories();
    await loadEntries();
}

function bindEvents() {
    const btnExpense = document.getElementById("btn-add-expense");
    const btnIncome = document.getElementById("btn-add-income");
    const modal = document.getElementById("entry-modal");
    const btnClose = document.getElementById("btn-close-entry-modal");
    const form = document.getElementById("entry-form");
    const searchInput = document.getElementById("cb-search");
    const dateInput = document.getElementById("cb-date-filter");
    
    btnExpense?.addEventListener("click", () => openModal("EXPENSE"));
    btnIncome?.addEventListener("click", () => openModal("INCOME"));
    btnClose?.addEventListener("click", () => modal.classList.add("hidden"));
    
    form?.addEventListener("submit", submitEntry);
    
    // Auto-reload on date change
    dateInput?.addEventListener("change", loadEntries);
    
    // Local Search filtering
    searchInput?.addEventListener("input", (e) => {
        const keyword = e.target.value.toLowerCase();
        const filtered = entries.filter(r => 
            (r.category_name || "").toLowerCase().includes(keyword) || 
            (r.description || "").toLowerCase().includes(keyword)
        );
        renderTable(filtered);
    });
}

async function loadCategories() {
    try {
        const res = await api.get("/cashbook/categories");
        categories = res.data || [];
    } catch (err) {
        console.error("Failed to load categories", err);
    }
}

async function loadEntries() {
    const tbody = document.getElementById("cashbook-table-body");
    const date = document.getElementById("cb-date-filter").value;
    const branchId = state.currentBranch?.id || 1;

    tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-600 text-2xl"></i></td></tr>`;

    try {
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: date, end_date: date });
        entries = res.data.entries || [];
        
        // Update Summary Cards
        document.getElementById("cb-cash-net").textContent = Number(res.data.summary.cash.net).toLocaleString();
        document.getElementById("cb-bank-net").textContent = Number(res.data.summary.bank.net).toLocaleString();
        document.getElementById("cb-total-net").textContent = Number(res.data.summary.totalNet).toLocaleString();

        renderTable(entries);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍ မရပါ</td></tr>`;
    }
}

function renderTable(data) {
    const tbody = document.getElementById("cashbook-table-body");
    tbody.innerHTML = "";

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-slate-400 text-base">ယနေ့အတွက် မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    data.forEach(item => {
        const isIncome = item.entry_type === "INCOME";
        const colorClass = isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
        const sign = isIncome ? "+" : "-";
        
        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-800/50 transition";
        row.innerHTML = `
            <td class="p-4 text-slate-500 dark:text-slate-400">${item.entry_date}</td>
            <td class="p-4 font-bold">
                <span class="px-2 py-1 rounded-md text-xs ${isIncome ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'} dark:bg-slate-800">
                    ${item.category_name}
                </span>
            </td>
            <td class="p-4 truncate max-w-[200px]">${item.description || '-'}</td>
            <td class="p-4 uppercase text-xs font-bold text-slate-500">${item.payment_method}</td>
            <td class="p-4 text-right font-black font-mono ${colorClass}">${sign} ${Number(item.amount).toLocaleString()}</td>
            <td class="p-4 text-center">
                <button data-id="${item.id}" class="btn-delete px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-rose-500 hover:text-white rounded-lg transition text-xs font-bold text-slate-600 dark:text-slate-300">
                    <i class="fa-solid fa-trash"></i> ဖျက်မည်
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Bind Delete buttons
    document.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => deleteEntry(btn.dataset.id));
    });
}

function openModal(type) {
    currentType = type;
    const modal = document.getElementById("entry-modal");
    const header = document.getElementById("entry-modal-header");
    const title = document.getElementById("entry-modal-title");
    const select = document.getElementById("entry-category");
    const btn = document.getElementById("btn-submit-entry");

    document.getElementById("entry-form").reset();
    document.getElementById("entry-type").value = type;

    if (type === "EXPENSE") {
        header.className = "p-5 bg-rose-600 text-white flex items-center justify-between";
        title.textContent = "အသုံးစရိတ် ထွက်မည်";
        btn.className = "w-full py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-base rounded-xl shadow-lg transition mt-2";
    } else {
        header.className = "p-5 bg-emerald-600 text-white flex items-center justify-between";
        title.textContent = "အခြားငွေဝင် ထည့်မည်";
        btn.className = "w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base rounded-xl shadow-lg transition mt-2";
    }

    // Filter categories by type
    select.innerHTML = '<option value="" disabled selected>ခေါင်းစဉ် ရွေးချယ်ပါ ▼</option>';
    categories.filter(c => c.type === type).forEach(c => {
        select.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });

    modal.classList.remove("hidden");
}

async function submitEntry(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-entry");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> သိမ်းဆည်းနေပါသည်...`;

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
            document.getElementById("entry-modal").classList.add("hidden");
            await loadEntries();
        }
    } catch (err) {
        alert("စာရင်းသွင်းရာတွင် အမှားအယွင်းဖြစ်နေပါသည်: " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "အတည်ပြု ထည့်သွင်းမည်";
    }
}

async function deleteEntry(id) {
    if (!confirm("ဤစာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?")) return;
    
    try {
        await api.delete(`/cashbook/entries/${id}`);
        await loadEntries();
    } catch (err) {
        alert(err.message || "ဖျက်၍ မရပါ။ အရောင်းဘောင်ချာမှ ဝင်လာသော စာရင်းဖြစ်နိုင်ပါသည်။");
    }
}
