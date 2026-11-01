// cashbook-frontend/js/modules/stock_report.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Import Professional UI (Toast)
import { setKPI } from "../app.js";

let rawReportData = [];
let branchesList = [];
let selectedYear = new Date().getFullYear();

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeCsv(val) {
    let str = String(val ?? "").trim();
    // Excel Formula Injection ကာကွယ်ရန်
    if (/^[=+@-]/.test(str)) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
}

export async function initStockReport() {
    setupYearOptions();
    bindEvents();
    await loadBranches();
    await fetchReportData();
}

function setupYearOptions() {
    const yearSelect = document.getElementById("sr-year-select");
    if (!yearSelect) return;
    yearSelect.innerHTML = "";
    
    const currYear = new Date().getFullYear();
    for (let y = currYear - 1; y <= currYear + 2; y++) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = `${y} ခုနှစ်`;
        if (y === currYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }
    selectedYear = currYear;
}

function bindEvents() {
    document.getElementById("sr-search")?.addEventListener("input", filterAndRender);
    document.getElementById("sr-category-select")?.addEventListener("change", filterAndRender);

    document.getElementById("sr-branch-select")?.addEventListener("change", () => {
        fetchReportData();
    });

    document.getElementById("sr-year-select")?.addEventListener("change", (e) => {
        selectedYear = parseInt(e.target.value, 10);
        updateTableHeaderYears();
        fetchReportData();
    });

    document.getElementById("btn-export-sr-csv")?.addEventListener("click", exportStockReportToCSV);
}

async function loadBranches() {
    const select = document.getElementById("sr-branch-select");
    if (!select) return;

    try {
        const res = await api.get("/branches");
        branchesList = res.data || [];
        select.innerHTML = "";

        if (state.isAdmin()) {
            select.innerHTML = `<option value="ALL">🏢 ဆိုင်အားလုံး စုစုပေါင်း</option>`;
            branchesList.forEach(b => {
                select.innerHTML += `<option value="${b.id}">${escapeHtml(b.name)} (${escapeHtml(b.code)})</option>`;
            });
            select.disabled = false;
        } else {
            const currentBranch = state.currentBranch || branchesList[0];
            select.innerHTML = `<option value="${currentBranch.id}">${escapeHtml(currentBranch.name)}</option>`;
            select.disabled = true; // Cashier ဆိုပါက မိမိဆိုင်တစ်ခုတည်းသာ ကြည့်ခွင့်ရှိမည်
        }
    } catch (err) {
        console.error("Failed to load branches for report:", err);
    }
}

function updateTableHeaderYears() {
    const theadRow = document.getElementById("sr-table-header");
    if (!theadRow) return;

    const shortYear = String(selectedYear).slice(-2);
    let html = `
        <th class="p-3 w-12 text-center">NO</th>
        <th class="p-3 w-28">Category</th>
        <th class="p-3 w-48">Item Name</th>
    `;

    MONTH_NAMES.forEach(m => {
        html += `<th class="p-3 text-center bg-slate-100 dark:bg-slate-800/80 font-mono">${m} ${shortYear}</th>`;
    });

    html += `
        <th class="p-3 text-right bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400">စုစုပေါင်းအဝင်</th>
        <th class="p-3 text-right bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400">စုစုပေါင်းအထွက်</th>
        <th class="p-3 text-right bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400">လက်ရှိလက်ကျန်</th>
        <th class="p-3 text-right bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400">စတော့တန်ဖိုး</th>
    `;
    theadRow.innerHTML = html;
}

async function fetchReportData() {
    const tbody = document.getElementById("sr-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="19" class="p-12 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    const branchVal = document.getElementById("sr-branch-select")?.value || "ALL";

    try {
        updateTableHeaderYears();

        const params = { year: selectedYear };
        if (branchVal !== "ALL") params.branch_id = branchVal;

        const res = await api.get("/reports/monthly-stock", params);
        rawReportData = res.data || [];

        populateCategoryDropdown(rawReportData);
        updateStockReportKPIs(rawReportData);
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="19" class="p-12 text-center text-rose-500 font-bold">စာရင်းဆွဲယူ၍ မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryDropdown(data) {
    const select = document.getElementById("sr-category-select");
    if (!select) return;
    const currentVal = select.value;
    const cats = [...new Set(data.map(i => i.category).filter(Boolean))];
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${data.length})</option>`;
    cats.forEach(c => {
        select.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    if (currentVal) select.value = currentVal;
}

function updateStockReportKPIs(data) {
    const totalCurrentStock = data.reduce((sum, item) => sum + Number(item.current_balance || 0), 0);
    const totalStockValue = data.reduce((sum, item) => sum + (Number(item.current_balance || 0) * Number(item.cost_price || 0)), 0);
    const totalInbound = data.reduce((sum, item) => sum + Number(item.total_in || 0), 0);
    const totalOutbound = data.reduce((sum, item) => sum + Number(item.total_out || 0), 0);

    setKPI(1, "လက်ရှိ စုစုပေါင်း လက်ကျန်", totalCurrentStock, "fa-boxes-stacked", "emerald");
    setKPI(2, "စုစုပေါင်း စတော့တန်ဖိုး", totalStockValue, "fa-sack-dollar", "blue");
    setKPI(3, "ယခုနှစ် စုစုပေါင်း အဝင်", totalInbound, "fa-dolly", "purple");
    setKPI(4, "ယခုနှစ် စုစုပေါင်း အထွက်", totalOutbound, "fa-truck-ramp-box", "amber");
}

function filterAndRender() {
    const kw = (document.getElementById("sr-search")?.value || "").trim().toLowerCase();
    const cat = document.getElementById("sr-category-select")?.value || "";

    const filtered = rawReportData.filter(item => {
        if (cat && item.category !== cat) return false;
        if (!kw) return true;
        const hay = `${item.sku || ""} ${item.item_name || ""} ${item.category || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderTable(filtered);
}

function renderTable(list) {
    const tbody = document.getElementById("sr-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const tfoot = document.getElementById("sr-table-foot");

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="19" class="p-12 text-center text-slate-400 font-bold text-sm">စတော့မှတ်တမ်း မတွေ့ရှိပါ</td></tr>`;
        if (tfoot) tfoot.innerHTML = "";
        return;
    }

    // Totals Initialization
    const monthlyTotals = Array(13).fill(0); // 1-12
    let sumIn = 0;
    let sumOut = 0;
    let sumBal = 0;
    let sumVal = 0;

    list.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition border-b border-slate-100 dark:border-slate-800/60";

        const currentBal = Number(item.current_balance || 0);
        const costPrice = Number(item.cost_price || 0);
        const valuation = currentBal * costPrice;
        const totalIn = Number(item.total_in || 0);
        const totalOut = Number(item.total_out || 0);

        sumIn += totalIn;
        sumOut += totalOut;
        sumBal += currentBal;
        sumVal += valuation;

        let rowHtml = `
            <td class="p-3 text-center text-slate-400 font-mono">${index + 1}</td>
            <td class="p-3">
                <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    ${escapeHtml(item.category || "-")}
                </span>
            </td>
            <td class="p-3">
                <div class="font-bold text-slate-900 dark:text-white">${escapeHtml(item.item_name)}</div>
                <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(item.sku || "-")}</div>
            </td>
        `;

        // 12 Months Closing Balances (m1 to m12)
        for (let m = 1; m <= 12; m++) {
            const mQty = Number(item.monthly_balances?.[m] ?? item[`m${m}`] ?? 0);
            monthlyTotals[m] += mQty;
            rowHtml += `
                <td class="p-3 text-center font-mono ${mQty === 0 ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200 font-bold'}">
                    ${mQty.toLocaleString()}
                </td>
            `;
        }

        rowHtml += `
            <td class="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10">
                +${totalIn.toLocaleString()}
            </td>
            <td class="p-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-50/30 dark:bg-rose-950/10">
                -${totalOut.toLocaleString()}
            </td>
            <td class="p-3 text-right font-mono font-black text-blue-600 dark:text-blue-400 bg-blue-50/30 dark:bg-blue-950/10 text-sm">
                ${currentBal.toLocaleString()}
            </td>
            <td class="p-3 text-right font-mono font-black text-amber-600 dark:text-amber-400 bg-amber-50/30 dark:bg-amber-950/10">
                ${valuation.toLocaleString()} Ks
            </td>
        `;

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });

    // Render Table Footer Summary (Total Row)
    if (tfoot) {
        let footHtml = `
            <tr class="bg-slate-100/90 dark:bg-slate-950/80 font-black border-t-2 border-slate-300 dark:border-slate-700">
                <td colspan="3" class="p-3 text-right uppercase text-xs tracking-wider text-slate-600 dark:text-slate-300">
                    စုစုပေါင်း (Total)
                </td>
        `;

        for (let m = 1; m <= 12; m++) {
            footHtml += `
                <td class="p-3 text-center font-mono text-slate-800 dark:text-slate-200">
                    ${monthlyTotals[m].toLocaleString()}
                </td>
            `;
        }

        footHtml += `
                <td class="p-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    +${sumIn.toLocaleString()}
                </td>
                <td class="p-3 text-right font-mono text-rose-600 dark:text-rose-400">
                    -${sumOut.toLocaleString()}
                </td>
                <td class="p-3 text-right font-mono text-blue-600 dark:text-blue-400 text-sm">
                    ${sumBal.toLocaleString()}
                </td>
                <td class="p-3 text-right font-mono text-amber-600 dark:text-amber-400">
                    ${sumVal.toLocaleString()} Ks
                </td>
            </tr>
        `;
        tfoot.innerHTML = footHtml;
    }
}

function exportStockReportToCSV() {
    if (!rawReportData || rawReportData.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် အချက်အလက် မရှိသေးပါ။");
    }

    const shortYear = String(selectedYear).slice(-2);
    let csv = `NO,Category,Item Name,SKU,`;
    MONTH_NAMES.forEach(m => { csv += `${m} ${shortYear},`; });
    csv += `Total In,Total Out,Current Balance,Cost Price,Stock Value (MMK)\n`;

    rawReportData.forEach((item, idx) => {
        const bal = Number(item.current_balance || 0);
        const cost = Number(item.cost_price || 0);
        const val = bal * cost;

        let row = [
            idx + 1,
            escapeCsv(item.category),
            escapeCsv(item.item_name),
            escapeCsv(item.sku)
        ];

        for (let m = 1; m <= 12; m++) {
            const mQty = Number(item.monthly_balances?.[m] ?? item[`m${m}`] ?? 0);
            row.push(mQty);
        }

        row.push(Number(item.total_in || 0));
        row.push(Number(item.total_out || 0));
        row.push(bal);
        row.push(cost);
        row.push(val);

        csv += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Stock_Movement_Report_${selectedYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
