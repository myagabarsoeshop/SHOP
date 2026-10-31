// cashbook-frontend/js/modules/stock_report.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let rawReportData = [];
let currentFilteredReport = [];
let branchesList = [];
let selectedYear = new Date().getFullYear();

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// စတော့အစီရင်ခံစာအတွက် စာကြောင်း ၁၅ ကြောင်း ကန့်သတ်ပြသမည့် Pagination Controller
const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTable()
});

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
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
            select.disabled = true;
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
        <th class="p-4 w-14 text-center">NO</th>
        <th class="p-4 w-32">Category</th>
        <th class="p-4 w-56">Item Name</th>
    `;

    MONTH_NAMES.forEach(m => {
        html += `<th class="p-3 text-center bg-slate-100/70 dark:bg-slate-900/80 font-mono">${m} ${shortYear}</th>`;
    });

    html += `
        <th class="p-4 text-right bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400">စုစုပေါင်းအဝင်</th>
        <th class="p-4 text-right bg-rose-50/50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400">စုစုပေါင်းအထွက်</th>
        <th class="p-4 text-right bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400">လက်ရှိလက်ကျန်</th>
        <th class="p-4 text-right bg-amber-50/50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400">စတော့တန်ဖိုး</th>
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
        currentFilteredReport = [...rawReportData];

        populateCategoryDropdown(rawReportData);
        updateStockReportKPIs(rawReportData);
        pagination.reset();
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

function updateFooterTotals(list) {
    const totalIn = list.reduce((sum, item) => sum + Number(item.total_in || 0), 0);
    const totalOut = list.reduce((sum, item) => sum + Number(item.total_out || 0), 0);
    const totalStock = list.reduce((sum, item) => sum + Number(item.current_balance || 0), 0);
    const totalValue = list.reduce((sum, item) => sum + (Number(item.current_balance || 0) * Number(item.cost_price || 0)), 0);

    const inEl = document.getElementById("sr-grand-in");
    const outEl = document.getElementById("sr-grand-out");
    const stockEl = document.getElementById("sr-grand-stock");
    const valEl = document.getElementById("sr-grand-value");

    if (inEl) inEl.textContent = `+${totalIn.toLocaleString()}`;
    if (outEl) outEl.textContent = `-${totalOut.toLocaleString()}`;
    if (stockEl) stockEl.textContent = totalStock.toLocaleString();
    if (valEl) valEl.textContent = `${totalValue.toLocaleString()} Ks`;
}

function filterAndRender() {
    const kw = (document.getElementById("sr-search")?.value || "").trim().toLowerCase();
    const cat = document.getElementById("sr-category-select")?.value || "";

    currentFilteredReport = rawReportData.filter(item => {
        if (cat && item.category !== cat) return false;
        if (!kw) return true;
        const hay = `${item.sku || ""} ${item.item_name || ""} ${item.category || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById("sr-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    updateFooterTotals(currentFilteredReport);

    if (currentFilteredReport.length === 0) {
        tbody.innerHTML = `<tr><td colspan="19" class="p-12 text-center text-slate-400 font-bold text-base">စတော့မှတ်တမ်း မတွေ့ရှိပါ</td></tr>`;
        pagination.renderControls("stock-report-pagination");
        return;
    }

    // လက်ရှိ စာမျက်နှာအတွက် စာကြောင်း (၁၅) ခု ဖြတ်ယူပြသခြင်း
    const pageItems = pagination.getPageItems(currentFilteredReport);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";

        const currentBal = Number(item.current_balance || 0);
        const costPrice = Number(item.cost_price || 0);
        const valuation = currentBal * costPrice;

        let rowHtml = `
            <td class="p-4 text-center text-slate-400 font-mono text-sm">${startIdx + index + 1}</td>
            <td class="p-4">
                <span class="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300">
                    ${escapeHtml(item.category || "-")}
                </span>
            </td>
            <td class="p-4">
                <div class="font-bold text-slate-900 dark:text-white text-base">${escapeHtml(item.item_name)}</div>
                <div class="text-xs text-slate-400 font-mono">${escapeHtml(item.sku || "-")}</div>
            </td>
        `;

        // 12 Months Closing Balances (m1 to m12)
        for (let m = 1; m <= 12; m++) {
            const mQty = Number(item.monthly_balances?.[m] ?? item[`m${m}`] ?? 0);
            rowHtml += `
                <td class="p-3 text-center font-mono ${mQty === 0 ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200 font-bold'} text-sm">
                    ${mQty.toLocaleString()}
                </td>
            `;
        }

        rowHtml += `
            <td class="p-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10 text-base">
                +${Number(item.total_in || 0).toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-50/30 dark:bg-rose-950/10 text-base">
                -${Number(item.total_out || 0).toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-black text-blue-600 dark:text-blue-400 bg-blue-50/30 dark:bg-blue-950/10 text-base">
                ${currentBal.toLocaleString()}
            </td>
            <td class="p-4 text-right font-mono font-black text-amber-600 dark:text-amber-400 bg-amber-50/30 dark:bg-amber-950/10 text-base">
                ${valuation.toLocaleString()} Ks
            </td>
        `;

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });

    // အောက်ခြေ Pagination Controls ဘား ဆွဲတင်ခြင်း
    pagination.renderControls("stock-report-pagination");
}

function exportStockReportToCSV() {
    const dataToExport = currentFilteredReport.length > 0 ? currentFilteredReport : rawReportData;
    if (!dataToExport || dataToExport.length === 0) {
        return alert("ထုတ်ယူရန် အချက်အလက် မရှိသေးပါ");
    }

    const shortYear = String(selectedYear).slice(-2);
    let csv = `NO,Category,Item Name,SKU,`;
    MONTH_NAMES.forEach(m => { csv += `${m} ${shortYear},`; });
    csv += `Total In,Total Out,Current Balance,Cost Price,Stock Value (MMK)\n`;

    dataToExport.forEach((item, idx) => {
        const bal = Number(item.current_balance || 0);
        const cost = Number(item.cost_price || 0);
        const val = bal * cost;

        let row = [
            idx + 1,
            `"${(item.category || '').replace(/"/g, '""')}"`,
            `"${(item.item_name || '').replace(/"/g, '""')}"`,
            `"${(item.sku || '').replace(/"/g, '""')}"`
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
