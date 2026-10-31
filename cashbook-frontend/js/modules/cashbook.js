// cashbook-frontend/js/modules/cashbook.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI, getLocalTodayDate } from "../app.js";

let entries = [];
let categories = [];

// Fallback Categories (အင်္ဂလိပ်စာသားများ ဖယ်ရှားပြီး မြန်မာလိုသီးသန့် ပြုလုပ်ထားပါသည်)
const FALLBACK_CATEGORIES = [
    { id: 1, name: "အထည်ရောင်းရငွေ", type: "INCOME" },
    { id: 2, name: "အကြွေးပြန်ရငွေ", type: "INCOME" },
    { id: 3, name: "အခြားဝင်ငွေ", type: "INCOME" },
    { id: 4, name: "ချည်ဝယ်ယူစရိတ်", type: "EXPENSE" },
    { id: 5, name: "ရက်ကန်းလက်ခ / လုပ်အားခ", type: "EXPENSE" },
    { id: 6, name: "ဆိုင်အသုံးစရိတ် / မီးဖိုချောင်", type: "EXPENSE" },
    { id: 7, name: "သယ်ယူပို့ဆောင်ခ / ကားခ", type: "EXPENSE" },
    { id: 8, name: "ဝန်ထမ်းလစာ / ကြိုထုတ်ငွေ", type: "EXPENSE" }
];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initCashbook() {
    const dateInput = document.getElementById("cb-date-filter");
    if (dateInput) dateInput.value = getLocalTodayDate();

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
        const kw = e.target.value.trim().toLowerCase();
        const filtered = entries.filter(r =>
            (r.category_name || "").toLowerCase().includes(kw) ||
            (r.description || "").toLowerCase().includes(kw) ||
            (r.payment_method || "").toLowerCase().includes(kw)
        );
        renderTable(filtered);
    });

    document.getElementById("btn-export-csv")?.addEventListener("click", exportCSV);
}

async function loadCategories() {
    try {
        const res = await api.get("/cashbook/categories");
        categories = (res.data && res.data.length > 0) ? res.data : FALLBACK_CATEGORIES;
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
        tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: date, end_date: date });
        entries = res.data?.entries || [];
        const s = res.data?.summary || {
            cash: { in: 0, out: 0, net: 0 },
            bank: { in: 0, out: 0, net: 0 },
            totalNet: 0
        };

        const totalOut = Number(s.cash?.out || 0) + Number(s.bank?.out || 0);

        setKPI(1, "လက်ကျန် ငွေသား (Cash Net)", s.cash?.net || 0, "fa-money-bill-wave", "emerald");
        setKPI(2, "လက်ကျန် ဘဏ်ငွေ (Bank Net)", s.bank?.net || 0, "fa-building-columns", "blue");
        setKPI(3, "စုစုပေါင်း စရိတ်ထွက်ငွေ (Expenses)", totalOut, "fa-arrow-trend-down", "rose");
        setKPI(4, "စုစုပေါင်း အသားတင် (Total Net)", s.totalNet || 0, "fa-vault", "amber");

        renderTable(entries);
    } catch (err) {
        console.error("Load entries error:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍ မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
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
        const entryType = (item.entry_type || item.type || "EXPENSE").toUpperCase();
        const isIncome = entryType === "INCOME";
        const colorClass = isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
        const sign = isIncome ? "+" : "-";

        // Role ခွဲခြားမှုမရှိဘဲ မည်သည့် User မဆို Edit နှင့် အနီရောင် Delete Icon ကို အမြဲတမ်း အသုံးပြုနိုင်မည်
        const actionButtons = `
            <div class="flex items-center justify-center gap-2">
                <button type="button" data-id="${item.id}" title="ပြင်ဆင်မည်" class="btn-edit-entry w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white rounded-xl text-slate-600 dark:text-slate-300 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${item.id}" title="ဖျက်မည်" class="btn-delete w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 hover:text-white rounded-xl text-rose-500 hover:text-white transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        `;

        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition text-sm";
        row.innerHTML = `
            <td class="p-4 font-mono text-slate-500 dark:text-slate-400">${escapeHtml(item.entry_date || item.date)}</td>
            <td class="p-4">
                <span class="px-3 py-1.5 rounded-lg text-sm font-bold ${isIncome ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'}">
                    ${escapeHtml(item.category_name || item.category || "General")}
                </span>
            </td>
            <td class="p-4 max-w-xs truncate" title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || '-')}</td>
            <td class="p-4 uppercase text-xs font-extrabold text-slate-500">${escapeHtml(item.payment_method || "cash")}</td>
            <td class="p-4 text-right font-black font-mono text-base ${colorClass}">${sign}${Number(item.amount || 0).toLocaleString()}</td>
            <td class="p-4 text-center">${actionButtons}</td>
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
    const typeInput = document.getElementById("entry-type");

    document.getElementById("entry-form")?.reset();
    if (typeInput) typeInput.value = type;

    if (type === "EXPENSE") {
        if (header) header.className = "p-5 bg-rose-600 text-white flex items-center justify-between";
        if (title) title.textContent = "အသုံးစရိတ် အသစ်ထည့်မည်";
        if (btn) btn.className = "w-full py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-base rounded-xl shadow-lg transition cursor-pointer";
    } else {
        if (header) header.className = "p-5 bg-emerald-600 text-white flex items-center justify-between";
        if (title) title.textContent = "အခြားဝင်ငွေ အသစ်ထည့်မည်";
        if (btn) btn.className = "w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-base rounded-xl shadow-lg transition cursor-pointer";
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

    modal?.classList.remove("hidden");
    document.getElementById("entry-amount")?.focus();
}

async function submitEntry(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-entry");

    const categoryId = parseInt(document.getElementById("entry-category")?.value, 10);
    const amount = parseFloat(document.getElementById("entry-amount")?.value);
    const description = document.getElementById("entry-desc")?.value.trim();

    // အသေးစိတ် ဖော်ပြချက် (Description) မပါခဲ့လျှင် လက်မခံဘဲ သတိပေးခြင်း
    if (!description) {
        alert("ကျေးဇူးပြု၍ အသေးစိတ် ဖော်ပြချက် (မှတ်ချက်) ထည့်သွင်းပေးပါ");
        document.getElementById("entry-desc")?.focus();
        return;
    }

    if (!categoryId || isNaN(amount) || amount <= 0) {
        alert("ကျေးဇူးပြု၍ ခေါင်းစဉ်နှင့် ငွေပမာဏ မှန်ကန်စွာ ဖြည့်သွင်းပါ");
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
        const res = await api.post("/cashbook/entries", payload);
        if (res.success !== false) {
            document.getElementById("entry-modal")?.classList.add("hidden");
            await loadEntries();
        } else {
            throw new Error(res.error || "သိမ်းဆည်း၍ မရပါ");
        }
    } catch (err) {
        alert("စာရင်းသွင်း၍ မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
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
        const date = r.entry_date || r.date || "";
        const cat = (r.category_name || r.category || "").replace(/"/g, '""');
        const type = r.entry_type || r.type || "";
        const method = r.payment_method || "";
        const amt = r.amount || 0;
        const desc = (r.description || "").replace(/"/g, '""');
        csv += `"${date}","${cat}","${type}","${method}","${amt}","${desc}"\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashbook-${document.getElementById("cb-date-filter")?.value || getLocalTodayDate()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
