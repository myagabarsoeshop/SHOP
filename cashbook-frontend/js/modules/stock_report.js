// cashbook-frontend/js/modules/stock_report.js

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Import Professional UI (Toast)
import { setKPI } from "../app.js";

let rawReportData = [];
let branchesList = [];
let selectedYear = new Date().getFullYear();

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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
        opt.textContent = `${y} Year`;
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
            select.innerHTML = `<option value="ALL">All Branches</option>`;
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

// 1. Column headers format (Barcode added, Flat Design, No Backgrounds)
function updateTableHeaderYears() {
    const theadRow = document.getElementById("sr-table-header");
    if (!theadRow) return;

    const shortYear = String(selectedYear).slice(-2);
    let html = `
        <th class="py-2.5 px-3 w-14 text-center">NO</th>
        <th class="py-2.5 px-3 w-28 text-left">BARCODE</th>
        <th class="py-2.5 px-4 w-32 text-left">CATEGORY</th>
        <th class="py-2.5 px-4 w-56 text-left">ITEM NAME</th>
    `;

    MONTH_NAMES.forEach(m => {
        html += `<th class="py-2.5 px-3 text-center">${m} '${shortYear}</th>`;
    });

    html += `
        <th class="py-2.5 px-4 text-right">TOTAL IN</th>
        <th class="py-2.5 px-4 text-right">TOTAL OUT</th>
        <th class="py-2.5 px-4 text-right">BALANCE</th>
        <th class="py-2.5 px-4 text-right">STOCK VALUE</th>
    `;
    theadRow.innerHTML = html;
}

async function fetchReportData() {
    const tbody = document.getElementById("sr-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="20" class="p-16 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl mb-3"></i><div class="font-bold text-xs">အစီရင်ခံစာ အချက်အလက်များ ဆွဲယူနေပါသည်...</div></td></tr>`;
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
            tbody.innerHTML = `<tr><td colspan="20" class="p-12 text-center text-rose-500 font-bold">စာရင်းဆွဲယူ၍ မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryDropdown(data) {
    const select = document.getElementById("sr-category-select");
    if (!select) return;
    const currentVal = select.value;
    const cats = [...new Set(data.map(i => i.category).filter(Boolean))];
    select.innerHTML = `<option value="">All Categories (${data.length})</option>`;
    cats.forEach(c => {
        select.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    if (currentVal) select.value = currentVal;
}

// 2. English KPIs
function updateStockReportKPIs(data) {
    const totalCurrentStock = data.reduce((sum, item) => sum + Number(item.current_balance || 0), 0);
    const totalStockValue = data.reduce((sum, item) => sum + (Number(item.current_balance || 0) * Number(item.cost_price || 0)), 0);
    const totalInbound = data.reduce((sum, item) => sum + Number(item.total_in || 0), 0);
    const totalOutbound = data.reduce((sum, item) => sum + Number(item.total_out || 0), 0);

    setKPI(1, "Total Stock", totalCurrentStock, "fa-boxes-stacked", "emerald");
    setKPI(2, "Stock Value", totalStockValue, "fa-sack-dollar", "blue");
    setKPI(3, "Total In", totalInbound, "fa-dolly", "purple");
    setKPI(4, "Total Out", totalOutbound, "fa-truck-ramp-box", "amber");
}

function filterAndRender() {
    const kw = (document.getElementById("sr-search")?.value || "").trim().toLowerCase();
    const cat = document.getElementById("sr-category-select")?.value || "";

    const filtered = rawReportData.filter(item => {
        if (cat && item.category !== cat) return false;
        if (!kw) return true;
        const hay = `${item.sku || ""} ${item.barcode || ""} ${item.item_name || ""} ${item.category || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderTable(filtered);
}

// 3, 4, 5. Flat Design, No BG colors, Barcode separated, No Underlines
function renderTable(list) {
    const tbody = document.getElementById("sr-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const tfoot = document.getElementById("sr-table-foot");

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="20" class="p-16 text-center text-slate-400 font-bold text-sm"><i class="fa-solid fa-chart-column text-3xl mb-3 opacity-30"></i><br>စတော့မှတ်တမ်း မတွေ့ရှိပါ</td></tr>`;
        if (tfoot) {
            const inEl = document.getElementById("sr-grand-in");
            const outEl = document.getElementById("sr-grand-out");
            const stockEl = document.getElementById("sr-grand-stock");
            const valEl = document.getElementById("sr-grand-value");
            if (inEl) inEl.textContent = "0";
            if (outEl) outEl.textContent = "0";
            if (stockEl) stockEl.textContent = "0";
            if (valEl) valEl.textContent = "0";
        }
        return;
    }

    const monthlyTotals = Array(13).fill(0);
    let sumIn = 0;
    let sumOut = 0;
    let sumBal = 0;
    let sumVal = 0;

    list.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-12 whitespace-nowrap"; // Flat row design

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
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-14">${index + 1}</td>
            <td class="py-2 px-3 text-left font-mono text-xs text-slate-600 dark:text-slate-400 w-28 truncate" title="${escapeHtml(item.barcode || item.sku || "-")}">${escapeHtml(item.barcode || item.sku || "-")}</td>
            <td class="py-2 px-4 text-left text-base font-semibold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${escapeHtml(item.category || "-")}">${escapeHtml(item.category || "-")}</td>
            <td class="py-2 px-4 text-left text-base font-bold text-slate-900 dark:text-slate-100 min-w-[180px] w-56 truncate" title="${escapeHtml(item.item_name || "-")}">${escapeHtml(item.item_name || "-")}</td>
        `;

        for (let m = 1; m <= 12; m++) {
            const mQty = Number(item.monthly_balances?.[m] ?? item[`m${m}`] ?? 0);
            monthlyTotals[m] += mQty;
            rowHtml += `
                <td class="py-2 px-3 text-center font-mono text-sm ${mQty === 0 ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200 font-bold'}">
                    ${mQty === 0 ? '-' : mQty.toLocaleString()}
                </td>
            `;
        }

        rowHtml += `
            <td class="py-2 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm w-28">
                ${totalIn === 0 ? '-' : '+' + totalIn.toLocaleString()}
            </td>
            <td class="py-2 px-4 text-right font-mono font-bold text-rose-600 dark:text-rose-400 text-sm w-28">
                ${totalOut === 0 ? '-' : '-' + totalOut.toLocaleString()}
            </td>
            <td class="py-2 px-4 text-right font-mono font-black text-blue-600 dark:text-blue-400 text-base w-28">
                ${currentBal.toLocaleString()}
            </td>
            <td class="py-2 px-4 text-right font-mono font-black text-amber-600 dark:text-amber-400 text-base w-32">
                ${valuation.toLocaleString()}
            </td>
        `;

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });

    if (tfoot) {
        let footHtml = `
            <tr class="h-11">
                <td colspan="4" class="py-2.5 px-4 text-center tracking-wide font-black uppercase text-xs text-slate-500 dark:text-slate-400">
                    Total Summary
                </td>
        `;

        for (let m = 1; m <= 12; m++) {
            footHtml += `
                <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200 text-sm">
                    ${monthlyTotals[m] === 0 ? '-' : monthlyTotals[m].toLocaleString()}
                </td>
            `;
        }

        footHtml += `
                <td id="sr-grand-in" class="py-2.5 px-4 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 text-base">
                    +${sumIn.toLocaleString()}
                </td>
                <td id="sr-grand-out" class="py-2.5 px-4 text-right font-mono font-black text-rose-600 dark:text-rose-400 text-base">
                    -${sumOut.toLocaleString()}
                </td>
                <td id="sr-grand-stock" class="py-2.5 px-4 text-right font-mono font-black text-blue-600 dark:text-blue-400 text-base">
                    ${sumBal.toLocaleString()}
                </td>
                <td id="sr-grand-value" class="py-2.5 px-4 text-right font-mono font-black text-amber-600 dark:text-amber-400 text-base">
                    ${sumVal.toLocaleString()}
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
    let csv = `NO,BARCODE,CATEGORY,ITEM NAME,`;
    MONTH_NAMES.forEach(m => { csv += `${m} '${shortYear},`; });
    csv += `TOTAL IN,TOTAL OUT,BALANCE,COST PRICE,STOCK VALUE\n`;

    rawReportData.forEach((item, idx) => {
        const bal = Number(item.current_balance || 0);
        const cost = Number(item.cost_price || 0);
        const val = bal * cost;

        let row = [
            idx + 1,
            escapeCsv(item.barcode || item.sku),
            escapeCsv(item.category),
            escapeCsv(item.item_name)
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
    link.download = `Stock_Report_${selectedYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
