// cashbook-frontend/js/modules/yarn.js 
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";

let yarns = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initYarn() {
    bindEvents();
    await loadYarns();
}

function bindEvents() {
    document.getElementById("btn-add-yarn")?.addEventListener("click", () => {
        document.getElementById("yarn-form")?.reset();
        document.getElementById("yarn-modal")?.classList.remove("hidden");
    });
    document.getElementById("btn-close-yarn-modal")?.addEventListener("click", () => {
        document.getElementById("yarn-modal")?.classList.add("hidden");
    });

    document.getElementById("btn-issue-yarn")?.addEventListener("click", openIssueModal);
    document.getElementById("btn-close-issue-modal")?.addEventListener("click", () => {
        document.getElementById("yarn-issue-modal")?.classList.add("hidden");
    });

    document.getElementById("yarn-form")?.addEventListener("submit", submitNewYarn);
    document.getElementById("yarn-issue-form")?.addEventListener("submit", submitYarnIssue);

    document.getElementById("yarn-search")?.addEventListener("input", (e) => {
        const kw = e.target.value.trim().toLowerCase();
        const filtered = yarns.filter(y =>
            `${y.code || ""} ${y.name || ""} ${y.color || ""}`.toLowerCase().includes(kw)
        );
        renderTable(filtered);
    });
}

async function loadYarns() {
    const tbody = document.getElementById("yarn-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const res = await api.get("/yarns");
        yarns = res.data || [];

        const totalTypes = yarns.length;
        const totalStock = yarns.reduce((s, y) => s + Number(y.current_stock || 0), 0);
        const lowCount = yarns.filter(y => Number(y.current_stock || 0) <= Number(y.alert_stock || 5)).length;
        const healthyCount = Math.max(0, totalTypes - lowCount);

        setKPI(1, "ချည်အမျိုးအစားပေါင်း (Yarn Types)", totalTypes, "fa-scroll", "blue");
        setKPI(2, "စုစုပေါင်း ချည်လက်ကျန် (Total Stock)", totalStock, "fa-boxes-stacked", "emerald");
        setKPI(3, "လုံလောက်သော ချည်အမျိုးအစား", healthyCount, "fa-circle-check", "emerald");
        setKPI(4, "ထပ်ဖြည့်ရန်လိုသော ချည် (Low Stock)", lowCount, "fa-triangle-exclamation", "rose");

        renderTable(yarns);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-rose-500 font-bold">ချည်စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderTable(list) {
    const tbody = document.getElementById("yarn-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-12 text-center text-slate-400 font-bold">ချည်လက်ကျန်စာရင်း မရှိသေးပါ</td></tr>`;
        return;
    }

    list.forEach(item => {
        const stock = Number(item.current_stock || 0);
        const alertQty = Number(item.alert_stock || 0);
        const isLow = stock <= alertQty;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono font-bold text-slate-500 dark:text-slate-400">${escapeHtml(item.code)}</td>
            <td class="p-4 font-bold text-slate-900 dark:text-white">${escapeHtml(item.name)}</td>
            <td class="p-4">${escapeHtml(item.color || "-")}</td>
            <td class="p-4 text-xs font-bold text-slate-500">${escapeHtml(item.unit || "lb")}</td>
            <td class="p-4 text-center font-mono font-black text-base ${isLow ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"}">
                ${stock.toLocaleString()}
            </td>
            <td class="p-4 text-center font-mono text-slate-400">${alertQty.toLocaleString()}</td>
            <td class="p-4 text-center">
                <span class="px-3 py-1 rounded-lg text-xs font-bold ${isLow ? "bg-rose-500/15 text-rose-500" : "bg-emerald-500/15 text-emerald-500"}">
                    ${isLow ? "လက်ကျန်နည်းနေသည်" : "လုံလောက်သည်"}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openIssueModal() {
    const select = document.getElementById("issue-yarn-id");
    document.getElementById("yarn-issue-form")?.reset();

    if (select) {
        select.innerHTML = `<option value="" disabled selected>ချည်အမျိုးအစား ရွေးချယ်ပါ ▼</option>`;
        yarns.forEach(y => {
            const opt = document.createElement("option");
            opt.value = y.id;
            opt.textContent = `${y.name} (${y.color || "-"}) - လက်ကျန်: ${y.current_stock} ${y.unit}`;
            select.appendChild(opt);
        });
    }
    document.getElementById("yarn-issue-modal")?.classList.remove("hidden");
}

async function submitNewYarn(e) {
    e.preventDefault();
    const payload = {
        code: document.getElementById("yarn-code").value.trim(),
        name: document.getElementById("yarn-name").value.trim(),
        color: document.getElementById("yarn-color").value.trim(),
        unit: document.getElementById("yarn-unit").value,
        currentStock: parseFloat(document.getElementById("yarn-stock").value) || 0,
        alertStock: parseFloat(document.getElementById("yarn-alert").value) || 0
    };

    try {
        await api.post("/yarns", payload);
        document.getElementById("yarn-modal")?.classList.add("hidden");
        await loadYarns();
    } catch (err) {
        alert("သိမ်းဆည်း၍မရပါ: " + err.message);
    }
}

async function submitYarnIssue(e) {
    e.preventDefault();
    const payload = {
        yarnId: parseInt(document.getElementById("issue-yarn-id").value, 10),
        weaverName: document.getElementById("issue-weaver").value.trim(),
        quantity: parseFloat(document.getElementById("issue-qty").value) || 0,
        notes: document.getElementById("issue-notes").value.trim(),
        createdBy: state.user?.id || 1
    };

    try {
        await api.post("/yarns/issue", payload);
        document.getElementById("yarn-issue-modal")?.classList.add("hidden");
        await loadYarns();
    } catch (err) {
        alert("ချည်ထုတ်ပေးမှု မအောင်မြင်ပါ: " + err.message);
    }
}
