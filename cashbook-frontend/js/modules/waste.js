// cashbook-frontend/js/modules/waste.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";

let wasteLogs = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initWaste() {
    bindEvents();
    await loadWasteLogs();
}

function bindEvents() {
    document.getElementById("waste-search")?.addEventListener("input", filterAndRender);
    document.getElementById("btn-export-waste-csv")?.addEventListener("click", exportWasteToCSV);
    
    document.getElementById("btn-close-waste-edit-modal")?.addEventListener("click", () => {
        document.getElementById("waste-edit-modal")?.classList.add("hidden");
    });

    document.getElementById("waste-edit-form")?.addEventListener("submit", submitEditWaste);
}

async function loadWasteLogs() {
    const tbody = document.getElementById("waste-table-body");
    const branchId = state.currentBranch?.id || 1;

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const res = await api.get("/waste", { branch_id: branchId });
        wasteLogs = res.data || [];

        updateWasteKPIs();
        renderTable(wasteLogs);
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function updateWasteKPIs() {
    const totalWasteValue = wasteLogs.reduce((sum, w) => sum + (Number(w.quantity || 0) * Number(w.unit_cost || 0)), 0);
    const uniqueCategories = new Set(wasteLogs.map(w => w.category).filter(Boolean)).size;
    const totalItems = wasteLogs.reduce((sum, w) => sum + Number(w.quantity || 0), 0);
    const totalEntries = wasteLogs.length;

    setKPI(1, "Total Waste Value", totalWasteValue, "fa-vault", "rose");
    setKPI(2, "Total Category", uniqueCategories, "fa-tags", "blue");
    setKPI(3, "Total Items", totalItems, "fa-shirt", "amber");
    setKPI(4, "Total Entries", totalEntries, "fa-clipboard-list", "emerald");
}

function filterAndRender() {
    const kw = (document.getElementById("waste-search")?.value || "").trim().toLowerCase();

    const filtered = wasteLogs.filter(w => {
        if (!kw) return true;
        const hay = `${w.reference_no || ""} ${w.sku || ""} ${w.barcode || ""} ${w.category || ""} ${w.item_name || ""} ${w.pattern || ""} ${w.color || ""} ${w.reason || ""} ${w.recorded_by_name || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderTable(filtered);
}

function renderTable(list) {
    const tbody = document.getElementById("waste-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-12 text-center text-slate-400 font-bold text-base">ပျက်စီး/အလေအလွင့် မှတ်တမ်း မရှိပါ</td></tr>`;
        return;
    }

    list.forEach(w => {
        const dateStr = w.created_at ? new Date(w.created_at).toLocaleDateString("en-GB") : "-";
        const subtotal = Number(w.quantity || 0) * Number(w.unit_cost || 0);

        // Admin ဖြစ်မှသာ ပြင်ဆင်ခွင့် / ဖျက်ခွင့် ခလုတ်များ ပေါ်မည်
        const actionButtons = state.isAdmin() ? `
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" data-id="${w.id}" title="ပြင်ဆင်မည်" class="btn-edit-waste w-8 h-8 flex items-center justify-center bg-blue-500/10 hover:bg-blue-600 hover:text-white rounded-lg text-blue-600 dark:text-blue-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
                </button>
                <button type="button" data-id="${w.id}" title="ဖျက်မည် (စတော့ထဲ ပြန်ပေါင်းမည်)" class="btn-delete-waste w-8 h-8 flex items-center justify-center bg-rose-500/10 hover:bg-rose-600 hover:text-white rounded-lg text-rose-500 dark:text-rose-400 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        ` : `<span class="text-xs text-slate-400">-</span>`;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-amber-600 dark:text-amber-400 text-sm">${escapeHtml(w.reference_no || "-")}</div>
                <div class="text-xs text-slate-400">${dateStr}</div>
            </td>
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-slate-800 dark:text-slate-200 text-base">${escapeHtml(w.sku || "-")}</div>
                <div class="text-xs">${escapeHtml(w.barcode || "")}</div>
            </td>
            <td class="p-4">
                <span class="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm font-bold">
                    ${escapeHtml(w.category || "-")}
                </span>
            </td>
            <td class="p-4">
                <div class="font-bold text-slate-900 dark:text-white text-base">${escapeHtml(w.item_name || "-")}</div>
                <div class="text-sm text-slate-400">${escapeHtml(w.pattern || "-")}</div>
            </td>
            <td class="p-4 text-sm">
                <div>${escapeHtml(w.color || "-")}</div>
                <div class="text-slate-400">${escapeHtml(w.size || "Free Size")}</div>
            </td>
            <td class="p-4 text-center">
                <span class="px-3.5 py-1.5 rounded-xl font-mono font-black text-base bg-rose-500/15 text-rose-600 dark:text-rose-400">
                    -${Number(w.quantity || 0).toLocaleString()}
                </span>
            </td>
            <td class="p-4 text-right font-mono text-base text-slate-500">
                ${Number(w.unit_cost || 0).toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-bold text-base text-rose-600 dark:text-rose-400">
                ${subtotal.toLocaleString()}
            </td>
            <td class="p-4 text-sm max-w-xs truncate" title="${escapeHtml(w.reason || '')}">
                ${escapeHtml(w.reason || "-")}
            </td>
            <td class="p-4 text-center font-bold text-slate-600 dark:text-slate-300 text-sm">
                ${escapeHtml(w.recorded_by_name || "Admin")}
            </td>
            <td class="p-4 text-center">
                ${actionButtons}
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (state.isAdmin()) {
        tbody.querySelectorAll(".btn-edit-waste").forEach(btn => {
            btn.onclick = () => {
                const log = wasteLogs.find(w => w.id === Number(btn.dataset.id));
                if (log) openEditWasteModal(log);
            };
        });

        tbody.querySelectorAll(".btn-delete-waste").forEach(btn => {
            btn.onclick = () => deleteWasteLog(Number(btn.dataset.id));
        });
    }
}

function openEditWasteModal(log) {
    document.getElementById("edit-waste-id").value = log.id;
    document.getElementById("edit-waste-name").value = `${log.item_name} (${log.sku || "-"})`;
    document.getElementById("edit-waste-qty").value = log.quantity;
    document.getElementById("edit-waste-reason").value = log.reason || "";

    document.getElementById("waste-edit-modal")?.classList.remove("hidden");
    document.getElementById("edit-waste-qty")?.focus();
}

async function submitEditWaste(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-save-waste-edit");
    const id = document.getElementById("edit-waste-id")?.value;
    const qty = parseInt(document.getElementById("edit-waste-qty")?.value, 10);
    const reason = document.getElementById("edit-waste-reason")?.value.trim();

    if (!qty || qty <= 0) return alert("ကျေးဇူးပြု၍ မှန်ကန်သော အရေအတွက် ရိုက်ထည့်ပါ");

    if (btn) btn.disabled = true;

    try {
        await api.put(`/waste/${id}`, { quantity: qty, reason });
        document.getElementById("waste-edit-modal")?.classList.add("hidden");
        alert("ပျက်စီးစာရင်း ပြင်ဆင်ပြီး စတော့လက်ကျန် ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။");
        await loadWasteLogs();
    } catch (err) {
        alert("ပြင်ဆင်၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteWasteLog(id) {
    if (!confirm("ဤပျက်စီးစာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?\n(စတော့ထဲသို့ အရေအတွက် အပြည့်အဝ ပြန်လည်ပေါင်းထည့်ပေးပါမည်)")) return;

    try {
        await api.delete(`/waste/${id}`);
        alert("မှတ်တမ်း ဖျက်သိမ်းပြီး စတော့ထဲ ပြန်ထည့်ပြီးပါပြီ။");
        await loadWasteLogs();
    } catch (err) {
        alert("ဖျက်၍မရပါ: " + err.message);
    }
}

function exportWasteToCSV() {
    if (wasteLogs.length === 0) {
        alert("ထုတ်ယူရန် စာရင်းမှတ်တမ်း မရှိသေးပါ။");
        return;
    }
    const currentYear = new Date().getFullYear();
    let csvContent = "Reference No,Date,SKU,Barcode,Category,Item Name,Color,Size,Quantity,Unit Cost,Total Loss,Reason,Recorded By\n";

    wasteLogs.forEach(w => {
        const dateStr = w.created_at ? new Date(w.created_at).toLocaleDateString("en-GB") : "-";
        const subtotal = Number(w.quantity || 0) * Number(w.unit_cost || 0);

        const row = [
            `"${escapeHtml(w.reference_no || '')}"`,
            `"${dateStr}"`,
            `"${escapeHtml(w.sku || '')}"`,
            `"${escapeHtml(w.barcode || '')}"`,
            `"${escapeHtml(w.category || '')}"`,
            `"${escapeHtml(w.item_name || '')}"`,
            `"${escapeHtml(w.color || '')}"`,
            `"${escapeHtml(w.size || 'Free Size')}"`,
            w.quantity || 0,
            w.unit_cost || 0,
            subtotal,
            `"${escapeHtml(w.reason || '')}"`,
            `"${escapeHtml(w.recorded_by_name || 'Admin')}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Damage_Waste_Logs_FY${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
