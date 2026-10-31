// cashbook-frontend/js/modules/waste.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initWaste() {
    await loadWasteLogs();
}

async function loadWasteLogs() {
    const tbody = document.getElementById("waste-table-body");
    const totalEl = document.getElementById("waste-total-loss");
    const branchId = state.currentBranch?.id || 1;

    try {
        const res = await api.get("/waste", { branch_id: branchId });
        const list = res.data || [];

        if (!tbody) return;
        tbody.innerHTML = "";

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-12 text-center text-slate-400 font-bold text-base">ပျက်စီး/အလေအလွင့် မှတ်တမ်း မရှိသေးပါ</td></tr>`;
            if (totalEl) totalEl.textContent = "စုစုပေါင်း ဆုံးရှုံးမှု: 0 MMK";
            return;
        }

        let totalLoss = 0;

        list.forEach(w => {
            const dateStr = w.created_at ? new Date(w.created_at).toLocaleDateString("en-GB") : "-";
            const subtotal = Number(w.quantity || 0) * Number(w.unit_cost || 0);
            totalLoss += subtotal;

            const tr = document.createElement("tr");
            tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
            tr.innerHTML = `
                <td class="p-3.5 font-mono text-slate-500">
                    <div class="font-bold text-amber-600 dark:text-amber-400">${escapeHtml(w.reference_no || "-")}</div>
                    <div class="text-[11px] text-slate-400">${dateStr}</div>
                </td>
                <td class="p-3.5 font-mono font-bold text-slate-800 dark:text-slate-200">${escapeHtml(w.sku || w.barcode || "-")}</td>
                <td class="p-3.5">
                    <span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                        ${escapeHtml(w.category || "-")}
                    </span>
                </td>
                <td class="p-3.5 font-bold text-slate-900 dark:text-white">${escapeHtml(w.item_name || "-")}</td>
                <td class="p-3.5 text-slate-500">${escapeHtml(w.color || "-")} / ${escapeHtml(w.size || "Free")}</td>
                <td class="p-3.5 text-center font-mono font-black text-rose-600 dark:text-rose-400 text-sm">
                    -${Number(w.quantity || 0).toLocaleString()}
                </td>
                <td class="p-3.5 text-right font-mono text-slate-500">${Number(w.unit_cost || 0).toLocaleString()}</td>
                <td class="p-3.5 text-right font-mono font-black text-rose-600 dark:text-rose-400">${subtotal.toLocaleString()}</td>
                <td class="p-3.5 max-w-xs truncate" title="${escapeHtml(w.reason || '')}">${escapeHtml(w.reason || '-')}</td>
                <td class="p-3.5 text-center text-slate-500 font-bold">${escapeHtml(w.recorded_by_name || "Admin")}</td>
            `;
            tbody.appendChild(tr);
        });

        if (totalEl) totalEl.textContent = `စုစုပေါင်း ဆုံးရှုံးမှု: ${totalLoss.toLocaleString()} MMK`;
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
    }
}
