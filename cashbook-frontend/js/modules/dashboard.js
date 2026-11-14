// =============================================================================
// FILE: cashbook-frontend/js/modules/dashboard.js 
// DUAL-MODE EXECUTIVE & STAFF DASHBOARD MODULE (WITH APPROVAL QUEUE & D1 META)
// Version: 4.1.0 (Spec 5.6 Approval Queue & Spec 8.4 D1 Rows-Read Monitor)
// =============================================================================

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { navigateTo } from "../app.js";

let dashboardData = null;
let branchesList = [];
let selectedYear = new Date(Date.now() + 390 * 60 * 1000).getUTCFullYear();

export async function initDashboard() {
    setupRoleUI();
    bindEvents();
    await loadBranches();
    await fetchDashboardData(false);
}

function setupRoleUI() {
    const isAdminOrFinance = state.isAdmin();
    const yearContainer = document.getElementById("dash-year-container");
    const exportBtn = document.getElementById("btn-export-dash-csv");
    const staffView = document.getElementById("dash-staff-view");
    const adminView = document.getElementById("dash-admin-view");

    if (isAdminOrFinance) {
        yearContainer?.classList.remove("hidden");
        exportBtn?.classList.remove("hidden");
        exportBtn?.classList.add("flex");
        staffView?.classList.add("hidden");
        adminView?.classList.remove("hidden");
        setupYearOptions();
    } else {
        yearContainer?.classList.add("hidden");
        exportBtn?.classList.add("hidden");
        exportBtn?.classList.remove("flex");
        staffView?.classList.remove("hidden");
        adminView?.classList.add("hidden");
    }
}

function setupYearOptions() {
    const yearSelect = document.getElementById("dash-year-select");
    if (!yearSelect) return;
    yearSelect.innerHTML = "";

    const currYear = new Date(Date.now() + 390 * 60 * 1000).getUTCFullYear();
    for (let y = currYear - 2; y <= currYear + 2; y++) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = `${y} ခုနှစ်`;
        if (y === currYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }
    selectedYear = currYear;
}

function bindEvents() {
    const refreshBtn = document.getElementById("btn-refresh-dashboard");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await fetchDashboardData(true);
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
        });
    }

    document.getElementById("dash-branch-select")?.addEventListener("change", () => {
        fetchDashboardData(false);
    });

    document.getElementById("dash-year-select")?.addEventListener("change", (e) => {
        selectedYear = parseInt(e.target.value, 10);
        fetchDashboardData(false);
    });

    document.getElementById("btn-export-dash-csv")?.addEventListener("click", exportDashboardToCSV);
}

async function loadBranches() {
    const select = document.getElementById("dash-branch-select");
    if (!select) return;

    try {
        if (branchesList.length === 0) {
            if (Array.isArray(state.branches) && state.branches.length > 0) {
                branchesList = state.branches;
            } else {
                const res = await api.get("/branches");
                branchesList = res.data || [];
            }
        }

        select.innerHTML = "";
        const globalBranchId = state.getBranchId();

        if (state.canSwitchBranch()) {
            select.innerHTML = `<option value="ALL">🏢 ဆိုင်အားလုံး စုစုပေါင်း (Consolidated)</option>`;
            branchesList.forEach(b => {
                const selected = String(globalBranchId) === String(b.id) ? "selected" : "";
                select.innerHTML += `<option value="${ui.escapeHtml(b.id)}" ${selected}>${ui.escapeHtml(b.name)} (${ui.escapeHtml(b.code)})</option>`;
            });
            select.disabled = false;
        } else {
            const lockedBranch = branchesList.find(b => Number(b.id) === Number(globalBranchId)) ||
                state.currentBranch ||
                branchesList[0] ||
                { id: 1, name: "Assigned Shop" };
            select.innerHTML = `<option value="${ui.escapeHtml(lockedBranch.id)}" selected>${ui.escapeHtml(lockedBranch.name)}</option>`;
            select.disabled = true;
        }
    } catch (err) {
        console.error("Failed to load branches for dashboard:", err);
    }
}

async function fetchDashboardData(showToast = false) {
    const branchVal = document.getElementById("dash-branch-select")?.value || state.getBranchId();

    try {
        const params = { year: selectedYear, branch_id: branchVal };
        const res = await api.get("/dashboard/summary", params);
        dashboardData = res.data || {};

        // Spec 8.4: Log D1 rows_read for monitoring Free Tier quota
        if (dashboardData.d1_meta) {
            console.info(`[D1 Usage Monitor] Dashboard query rows_read: ${dashboardData.d1_meta.rowsRead ?? dashboardData.d1_meta.rows_read ?? 0}`);
        }

        if (state.isAdmin()) {
            renderAdminDashboard(dashboardData);
        } else {
            renderStaffDashboard(dashboardData);
        }

        if (showToast) {
            ui.toast.info("Dashboard အချက်အလက်များ အသစ်ဆွဲယူပြီးပါပြီ");
        }
    } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
        ui.toast.error("Dashboard အချက်အလက် ဆွဲယူ၍ မရပါ: " + err.message);
    }
}

// =============================================================================
// 1. Staff / Branch Manager / Cashier View Rendering
// =============================================================================
function renderStaffDashboard(data) {
    const s = data.staff || {};

    updateCard(1, "ယနေ့ လက်ငင်းရငွေ (Cash)", s.today_cash || 0, "ငွေသား အရောင်း", "fa-money-bill-wave", "emerald");
    updateCard(2, "ယနေ့ ဘဏ်/KPay ရငွေ", s.today_bank || 0, "ဘဏ်လွှဲ အရောင်း", "fa-building-columns", "blue");
    updateCard(3, "ယနေ့ ရောင်းရသည့် ဦးရေ", s.today_items_sold || 0, "ထည် / ခု", "fa-shirt", "purple");
    updateCard(4, "ဆိုင်လက်ကျန် (Drawer + Bank)", (s.cash_drawer || 0) + (s.bank_balance || 0), "လက်ကျန်ငွေ စုစုပေါင်း", "fa-vault", "amber");

    const catTbody = document.getElementById("dash-staff-cat-body");
    if (catTbody) {
        catTbody.innerHTML = "";
        const categories = s.category_sales || [];
        if (categories.length === 0) {
            catTbody.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-slate-400">ယနေ့အတွက် အရောင်းမှတ်တမ်း မရှိသေးပါ</td></tr>`;
        } else {
            categories.forEach(c => {
                catTbody.innerHTML += `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td class="py-2 font-bold text-slate-800 dark:text-slate-200">${ui.escapeHtml(c.category)}</td>
                        <td class="py-2 text-center font-mono font-bold">${Number(c.quantity).toLocaleString()}</td>
                        <td class="py-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">${Number(c.total_amount).toLocaleString()} Ks</td>
                    </tr>
                `;
            });
        }
    }

    const recentTbody = document.getElementById("dash-staff-recent-body");
    if (recentTbody) {
        recentTbody.innerHTML = "";
        const recent = s.recent_sales || [];
        if (recent.length === 0) {
            recentTbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400">အရောင်းဘောင်ချာ မရှိသေးပါ</td></tr>`;
        } else {
            recent.forEach(r => {
                recentTbody.innerHTML += `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td class="py-2 font-mono font-bold text-emerald-600 dark:text-emerald-400">${ui.escapeHtml(r.invoice_no)}</td>
                        <td class="py-2 font-semibold text-slate-700 dark:text-slate-300">${ui.escapeHtml(r.customer_name || "Walk-in")}</td>
                        <td class="py-2 uppercase font-mono text-[11px] font-bold text-slate-500">${ui.escapeHtml(r.payment_method)}</td>
                        <td class="py-2 text-right font-mono font-black text-slate-900 dark:text-white">${Number(r.final_amount).toLocaleString()} Ks</td>
                    </tr>
                `;
            });
        }
    }
}

// =============================================================================
// 2. Admin / Finance View Rendering (+ Approval Queue & D1 Rows Read Banner)
// =============================================================================
function renderAdminDashboard(data) {
    const a = data.admin || {};
    const opex = Number(a.total_expenses || 0);
    const totalPayable = Number(a.total_payable || 0);

    renderApprovalQueueBanner(a.approval_queue, data.d1_meta);

    updateCard(1, "Total Revenue", a.total_revenue || 0, `${selectedYear} Total Sales`, "fa-sack-dollar", "emerald");
    updateCard(2, "Net Profit", a.net_profit || 0, `After OPEX: ${opex.toLocaleString()} Ks`, "fa-chart-line", Number(a.net_profit || 0) >= 0 ? "blue" : "rose");
    updateCard(3, "Receivables", a.total_outstanding_debt || 0, `Supplier Payables: ${totalPayable.toLocaleString()} Ks`, "fa-hand-holding-dollar", "purple");
    updateCard(4, "Stock Value", a.total_stock_value || 0, "Inventory Investment Value", "fa-boxes-stacked", "amber");

    const branchTbody = document.getElementById("dash-branch-table-body");
    if (branchTbody) {
        branchTbody.innerHTML = "";
        const branches = a.branch_metrics || [];
        if (branches.length === 0) {
            branchTbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">ဆိုင်ခွဲစာရင်း မတွေ့ရှိပါ</td></tr>`;
        } else {
            let totalCashNet = 0;
            let totalBankNet = 0;
            let totalStockVal = 0;

            branches.forEach(b => {
                const cNet = Number(b.cash_net || 0);
                const bNet = Number(b.bank_net || 0);
                const sVal = Number(b.stock_value || 0);

                totalCashNet += cNet;
                totalBankNet += bNet;
                totalStockVal += sVal;

                branchTbody.innerHTML += `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 h-10">
                        <td class="px-3 py-2 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <i class="fa-solid fa-store text-emerald-500 text-xs"></i>
                            <span>${ui.escapeHtml(b.name)}</span>
                        </td>
                        <td class="px-3 py-2 text-right font-mono font-bold ${cNet < 0 ? "text-rose-500" : "text-emerald-500"}">${cNet.toLocaleString()} Ks</td>
                        <td class="px-3 py-2 text-right font-mono font-bold text-blue-400">${bNet.toLocaleString()} Ks</td>
                        <td class="px-3 py-2 text-right font-mono font-black text-amber-500">${sVal.toLocaleString()} Ks</td>
                        <td class="px-3 py-2 text-right font-mono font-black text-rose-400">${Number(b.outstanding_debt || 0).toLocaleString()} Ks</td>
                    </tr>
                `;
            });

            branchTbody.innerHTML += `
                <tr class="bg-slate-100/80 dark:bg-slate-950 font-black border-t-2 border-slate-300 dark:border-slate-700 h-10">
                    <td class="px-3 py-2 text-emerald-600 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-2">
                        <i class="fa-solid fa-calculator"></i>
                        <span>စုစုပေါင်း (All Branches Total)</span>
                    </td>
                    <td class="px-3 py-2 text-right font-mono ${totalCashNet < 0 ? "text-rose-500" : "text-emerald-500"}">${totalCashNet.toLocaleString()} Ks</td>
                    <td class="px-3 py-2 text-right font-mono text-blue-400">${totalBankNet.toLocaleString()} Ks</td>
                    <td class="px-3 py-2 text-right font-mono text-amber-500">${totalStockVal.toLocaleString()} Ks</td>
                    <td class="px-3 py-2 text-right font-mono text-rose-400">${Number(a.total_outstanding_debt || 0).toLocaleString()} Ks</td>
                </tr>
            `;
        }
    }

    const expenseList = document.getElementById("dash-expense-list");
    const totalExpLabel = document.getElementById("dash-total-expense-label");
    const expenses = a.expense_breakdown || [];
    const breakdownTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    if (totalExpLabel) {
        totalExpLabel.textContent = `${breakdownTotal.toLocaleString()} Ks`;
    }

    if (expenseList) {
        expenseList.innerHTML = "";
        if (expenses.length === 0) {
            expenseList.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs">အသုံးစရိတ်စာရင်း မရှိသေးပါ</div>`;
        } else {
            expenses.forEach(e => {
                const amt = Number(e.amount || 0);
                const percent = breakdownTotal > 0 ? Math.min(100, Math.round((amt / breakdownTotal) * 100)) : 0;
                expenseList.innerHTML += `
                    <div class="space-y-1">
                        <div class="flex justify-between text-xs font-bold gap-2">
                            <span class="text-slate-700 dark:text-slate-300 truncate">${ui.escapeHtml(e.category_name)}</span>
                            <span class="font-mono text-slate-900 dark:text-white shrink-0">${amt.toLocaleString()} Ks (${percent}%)</span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div class="bg-rose-500 h-1.5 rounded-full transition-all duration-300" style="width: ${percent}%"></div>
                        </div>
                    </div>
                `;
            });
        }
    }

    const topTbody = document.getElementById("dash-admin-top-items");
    if (topTbody) {
        topTbody.innerHTML = "";
        const topItems = a.top_selling_items || [];
        if (topItems.length === 0) {
            topTbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400">အရောင်းရဆုံး ပစ္စည်းစာရင်း မရှိသေးပါ</td></tr>`;
        } else {
            topItems.forEach(i => {
                topTbody.innerHTML += `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 h-9">
                        <td class="py-2 font-bold text-slate-900 dark:text-white">${ui.escapeHtml(i.item_name)}</td>
                        <td class="py-2"><span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400">${ui.escapeHtml(i.category)}</span></td>
                        <td class="py-2 text-center font-mono font-bold">${Number(i.quantity).toLocaleString()}</td>
                        <td class="py-2 text-right font-mono font-black text-emerald-500 dark:text-emerald-400">${Number(i.total_sales).toLocaleString()} Ks</td>
                    </tr>
                `;
            });
        }
    }
}

/**
 * Spec 5.6 & 8.4: Admin/Finance Approval Queue & D1 Rows Read Bar
 */
function renderApprovalQueueBanner(queue = {}, d1Meta = {}) {
    const adminView = document.getElementById("dash-admin-view");
    if (!adminView) return;

    let bar = document.getElementById("dash-approval-queue-bar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "dash-approval-queue-bar";
        bar.className = "mb-3.5 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3";
        adminView.prepend(bar);
    }

    const pendingOpenings = Number(queue?.pending_openings ?? queue?.pendingOpenings ?? 0);
    const pendingAdjustments = Number(queue?.pending_adjustments ?? queue?.pendingAdjustments ?? 0);
    const activeTransfers = Number(queue?.active_transfers ?? queue?.activeTransfers ?? 0);
    const rowsRead = Number(d1Meta?.rowsRead ?? d1Meta?.rows_read ?? 0);

    bar.innerHTML = `
        <div class="flex flex-wrap items-center gap-2.5 text-xs">
            <span class="font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5 mr-1">
                <i class="fa-solid fa-bell text-amber-500"></i>
                <span>Approval Queue:</span>
            </span>

            <button type="button" id="btn-dash-goto-opening" class="px-3 py-1.5 rounded-xl font-extrabold cursor-pointer transition flex items-center gap-1.5 border ${pendingOpenings > 0 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"}">
                <i class="fa-solid fa-clipboard-check"></i>
                <span>Opening Stock Approve ရန်: <b>${pendingOpenings}</b></span>
            </button>

            <button type="button" id="btn-dash-goto-adj" class="px-3 py-1.5 rounded-xl font-extrabold cursor-pointer transition flex items-center gap-1.5 border ${pendingAdjustments > 0 ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"}">
                <i class="fa-solid fa-scale-balanced"></i>
                <span>Adjustment Approve ရန်: <b>${pendingAdjustments}</b></span>
            </button>

            <button type="button" id="btn-dash-goto-trf" class="px-3 py-1.5 rounded-xl font-extrabold cursor-pointer transition flex items-center gap-1.5 border ${activeTransfers > 0 ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30" : "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700"}">
                <i class="fa-solid fa-truck-fast"></i>
                <span>လမ်းခရီး/Pending လွှဲပြောင်းမှု: <b>${activeTransfers}</b></span>
            </button>
        </div>

        <div class="text-[11px] font-mono font-bold text-slate-400 flex items-center gap-1.5" title="Cloudflare D1 Query Rows Read (Spec 8.4)">
            <i class="fa-solid fa-database text-emerald-500"></i>
            <span>D1 Rows Read: ${rowsRead.toLocaleString()}</span>
        </div>
    `;

    document.getElementById("btn-dash-goto-opening")?.addEventListener("click", async () => {
        await navigateTo("inventory");
        document.getElementById("inv-tab-opening")?.click();
    });

    document.getElementById("btn-dash-goto-adj")?.addEventListener("click", async () => {
        await navigateTo("inventory");
        document.getElementById("inv-tab-adjustments")?.click();
    });

    document.getElementById("btn-dash-goto-trf")?.addEventListener("click", async () => {
        await navigateTo("transfers");
    });
}

function updateCard(num, title, val, sub, icon, theme) {
    const titleEl = document.getElementById(`dash-card-${num}-title`);
    const valEl = document.getElementById(`dash-card-${num}-value`);
    const subEl = document.getElementById(`dash-card-${num}-sub`);
    const iconEl = document.getElementById(`dash-card-${num}-icon`);
    const iconBox = document.getElementById(`dash-card-${num}-icon-box`);

    if (titleEl) titleEl.textContent = title;
    if (valEl) valEl.textContent = Number(val || 0).toLocaleString();
    if (subEl) subEl.textContent = sub;
    if (iconEl && icon) iconEl.className = `fa-solid ${icon}`;

    const colorClasses = {
        emerald: { val: "text-2xl font-black text-emerald-500 font-mono tracking-tight", box: "w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center text-lg shrink-0" },
        blue: { val: "text-2xl font-black text-blue-500 font-mono tracking-tight", box: "w-11 h-11 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center text-lg shrink-0" },
        purple: { val: "text-2xl font-black text-purple-400 font-mono tracking-tight", box: "w-11 h-11 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center text-lg shrink-0" },
        amber: { val: "text-2xl font-black text-amber-500 font-mono tracking-tight", box: "w-11 h-11 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-lg shrink-0" },
        rose: { val: "text-2xl font-black text-rose-500 font-mono tracking-tight", box: "w-11 h-11 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center text-lg shrink-0" }
    };

    const chosen = colorClasses[theme] || colorClasses.emerald;
    if (valEl) valEl.className = chosen.val;
    if (iconBox) iconBox.className = chosen.box;
}

function exportDashboardToCSV() {
    if (!dashboardData || !dashboardData.admin) {
        return ui.toast.warning("ထုတ်ယူရန် Dashboard အချက်အလက် မရှိသေးပါ။");
    }

    const a = dashboardData.admin;
    let csv = `Executive Financial Summary (${selectedYear})\n`;
    csv += `Metric,Value (MMK)\n`;
    csv += `Total Revenue,${a.total_revenue || 0}\n`;
    csv += `Gross Profit,${a.gross_profit || 0}\n`;
    csv += `Operating Expenses (OPEX),${a.total_expenses || 0}\n`;
    csv += `Net Profit,${a.net_profit || 0}\n`;
    csv += `Total Stock Valuation,${a.total_stock_value || 0}\n`;
    csv += `Customer Receivables (Debt),${a.total_outstanding_debt || 0}\n`;
    csv += `Supplier Payables,${a.total_payable || 0}\n\n`;

    csv += `Branch Valuation & Balances\n`;
    csv += `Branch Name,Cash Net,Bank Net,Stock Valuation,Outstanding Debt\n`;
    (a.branch_metrics || []).forEach(b => {
        csv += `${ui.escapeCsv(b.name)},${b.cash_net || 0},${b.bank_net || 0},${b.stock_value || 0},${b.outstanding_debt || 0}\n`;
    });
    csv += `\n`;

    csv += `Cashbook Outflows Breakdown by Category\n`;
    csv += `Category Name,Amount (MMK)\n`;
    (a.expense_breakdown || []).forEach(e => {
        csv += `${ui.escapeCsv(e.category_name)},${e.amount || 0}\n`;
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Executive_Dashboard_Summary_${selectedYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
