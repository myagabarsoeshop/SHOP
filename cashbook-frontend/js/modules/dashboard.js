// cashbook-frontend/js/modules/dashboard.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

let dashboardData = null;
let branchesList = [];
let selectedYear = new Date().getFullYear();

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initDashboard() {
    setupRoleUI();
    bindEvents();
    await loadBranches();
    await fetchDashboardData();
}

function setupRoleUI() {
    const isAdmin = state.isAdmin();
    const roleBadge = document.getElementById("dash-role-badge");
    const yearContainer = document.getElementById("dash-year-container");
    const exportBtn = document.getElementById("btn-export-dash-csv");
    const staffView = document.getElementById("dash-staff-view");
    const adminView = document.getElementById("dash-admin-view");

    if (roleBadge) {
        roleBadge.textContent = isAdmin ? "Administrator" : "Cashier / Staff";
        roleBadge.className = `text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-md ${
            isAdmin ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
        }`;
    }

    // Role အလိုက် UI ခွဲခြားဖွင့်လှစ်ခြင်း
    if (isAdmin) {
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
    document.getElementById("btn-refresh-dashboard")?.addEventListener("click", fetchDashboardData);

    document.getElementById("dash-branch-select")?.addEventListener("change", () => {
        fetchDashboardData();
    });

    document.getElementById("dash-year-select")?.addEventListener("change", (e) => {
        selectedYear = parseInt(e.target.value, 10);
        fetchDashboardData();
    });

    document.getElementById("btn-export-dash-csv")?.addEventListener("click", exportDashboardToCSV);
}

async function loadBranches() {
    const select = document.getElementById("dash-branch-select");
    if (!select) return;

    try {
        const res = await api.get("/branches");
        branchesList = res.data || [];
        select.innerHTML = "";

        if (state.isAdmin()) {
            select.innerHTML = `<option value="ALL">🏢 ဆိုင်အားလုံး စုစုပေါင်း (Consolidated)</option>`;
            branchesList.forEach(b => {
                select.innerHTML += `<option value="${b.id}">${escapeHtml(b.name)} (${escapeHtml(b.code)})</option>`;
            });
            select.disabled = false;
        } else {
            const currentBranch = state.currentBranch || branchesList[0];
            select.innerHTML = `<option value="${currentBranch.id}">${escapeHtml(currentBranch.name)}</option>`;
            select.disabled = true; // Cashier ဆိုပါက မိမိဆိုင်တစ်ခုတည်းသာ လော့ချထားမည်
        }
    } catch (err) {
        console.error("Failed to load branches for dashboard:", err);
    }
}

async function fetchDashboardData() {
    const branchVal = document.getElementById("dash-branch-select")?.value || "ALL";

    try {
        const params = { year: selectedYear };
        if (branchVal !== "ALL") params.branch_id = branchVal;

        const res = await api.get("/dashboard/summary", params);
        dashboardData = res.data || {};

        if (state.isAdmin()) {
            renderAdminDashboard(dashboardData);
        } else {
            renderStaffDashboard(dashboardData);
        }
    } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
    }
}

// -------------------------------------------------------------
// 1. Staff / Cashier View Rendering (ရိုးရှင်းသော နေ့စဉ်လုပ်ငန်းဆောင်ရွက်မှု)
// -------------------------------------------------------------
function renderStaffDashboard(data) {
    const s = data.staff || {};

    // 4 Top Cards (Staff Mode)
    updateCard(1, "ယနေ့ လက်ငင်းရငွေ (Cash)", s.today_cash || 0, "ငွေသား အရောင်း", "fa-money-bill-wave", "emerald");
    updateCard(2, "ယနေ့ ဘဏ်/KPay ရငွေ", s.today_bank || 0, "ဘဏ်လွှဲ အရောင်း", "fa-building-columns", "blue");
    updateCard(3, "ယနေ့ ရောင်းရသည့် ဦးရေ", s.today_items_sold || 0, "ထည် / ခု", "fa-shirt", "purple");
    updateCard(4, "ဆိုင်လက်ကျန် (Drawer + Bank)", (s.cash_drawer || 0) + (s.bank_balance || 0), "လက်ကျန်ငွေ စုစုပေါင်း", "fa-vault", "amber");

    // Staff: Today Categories Breakdown
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
                        <td class="py-2.5 font-bold text-slate-800 dark:text-slate-200">${escapeHtml(c.category)}</td>
                        <td class="py-2.5 text-center font-mono font-bold">${Number(c.quantity).toLocaleString()}</td>
                        <td class="py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">${Number(c.total_amount).toLocaleString()} Ks</td>
                    </tr>
                `;
            });
        }
    }

    // Staff: Recent 5 Sales
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
                        <td class="py-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">${escapeHtml(r.invoice_no)}</td>
                        <td class="py-2.5 font-semibold text-slate-700 dark:text-slate-300">${escapeHtml(r.customer_name || "Walk-in")}</td>
                        <td class="py-2.5 capitalize text-slate-500">${escapeHtml(r.payment_method)}</td>
                        <td class="py-2.5 text-right font-mono font-black text-slate-900 dark:text-white">${Number(r.final_amount).toLocaleString()} Ks</td>
                    </tr>
                `;
            });
        }
    }
}

// -------------------------------------------------------------
// 2. Admin View Rendering (အသားတင်အမြတ်၊ ကုန်ကျစရိတ်၊ စတော့တန်ဖိုး အပြည့်အစုံ)
// -------------------------------------------------------------
function renderAdminDashboard(data) {
    const a = data.admin || {};

    // 4 Top Cards (Admin Mode)
    updateCard(1, "တစ်နှစ်တာ စုစုပေါင်း ဝင်ငွေ (Revenue)", a.total_revenue || 0, `${selectedYear} ခုနှစ် အရောင်းစုစုပေါင်း`, "fa-sack-dollar", "emerald");
    updateCard(2, "တစ်နှစ်တာ အသားတင် အမြတ် (Net Profit)", a.net_profit || 0, "အဝယ်နှင့် စရိတ်နုတ်ပြီး အမြတ်", "fa-chart-line", a.net_profit >= 0 ? "blue" : "rose");
    updateCard(3, "ရရန်ကျန် စုစုပေါင်း အကြွေး", a.total_outstanding_debt || 0, "Customer Liabilities", "fa-hand-holding-dollar", "purple");
    updateCard(4, "စတော့စုစုပေါင်း တန်ဖိုး (Valuation)", a.total_stock_value || 0, "ပစ္စည်းရင်းနှီးမြှုပ်နှံမှု တန်ဖိုး", "fa-boxes-stacked", "amber");

    // Admin: Expense Breakdown by Category
    const expenseList = document.getElementById("dash-expense-list");
    const totalExpLabel = document.getElementById("dash-total-expense-label");
    if (totalExpLabel) totalExpLabel.textContent = `${Number(a.total_expenses || 0).toLocaleString()} Ks`;

    if (expenseList) {
        expenseList.innerHTML = "";
        const expenses = a.expense_breakdown || [];
        if (expenses.length === 0) {
            expenseList.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs">အသုံးစရိတ်စာရင်း မရှိသေးပါ</div>`;
        } else {
            expenses.forEach(e => {
                const percent = a.total_expenses > 0 ? Math.round((e.amount / a.total_expenses) * 100) : 0;
                expenseList.innerHTML += `
                    <div class="space-y-1">
                        <div class="flex justify-between text-xs font-bold">
                            <span class="text-slate-700 dark:text-slate-300">${escapeHtml(e.category_name)}</span>
                            <span class="font-mono text-slate-900 dark:text-white">${Number(e.amount).toLocaleString()} Ks (${percent}%)</span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                            <div class="bg-rose-500 h-1.5 rounded-full" style="width: ${percent}%"></div>
                        </div>
                    </div>
                `;
            });
        }
    }

    // Admin: Top Selling Items
    const topTbody = document.getElementById("dash-admin-top-items");
    if (topTbody) {
        topTbody.innerHTML = "";
        const topItems = a.top_selling_items || [];
        if (topItems.length === 0) {
            topTbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400">အရောင်းရဆုံး ပစ္စည်းစာရင်း မရှိသေးပါ</td></tr>`;
        } else {
            topItems.forEach(i => {
                topTbody.innerHTML += `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td class="py-2.5 font-bold text-slate-900 dark:text-white">${escapeHtml(i.item_name)}</td>
                        <td class="py-2.5"><span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300">${escapeHtml(i.category)}</span></td>
                        <td class="py-2.5 text-center font-mono font-bold">${Number(i.quantity).toLocaleString()}</td>
                        <td class="py-2.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">${Number(i.total_sales).toLocaleString()} Ks</td>
                    </tr>
                `;
            });
        }
    }

    // Admin: Branch Breakdown Table
    const branchTbody = document.getElementById("dash-branch-table-body");
    if (branchTbody) {
        branchTbody.innerHTML = "";
        const branches = a.branch_metrics || [];
        if (branches.length === 0) {
            branchTbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">ဆိုင်ခွဲစာရင်း မတွေ့ရှိပါ</td></tr>`;
        } else {
            branches.forEach(b => {
                branchTbody.innerHTML += `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                        <td class="p-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <i class="fa-solid fa-store text-emerald-500 text-xs"></i>
                            <span>${escapeHtml(b.name)}</span>
                        </td>
                        <td class="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">${Number(b.cash_net || 0).toLocaleString()} Ks</td>
                        <td class="p-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400">${Number(b.bank_net || 0).toLocaleString()} Ks</td>
                        <td class="p-3 text-right font-mono font-black text-amber-600 dark:text-amber-400">${Number(b.stock_value || 0).toLocaleString()} Ks</td>
                        <td class="p-3 text-right font-mono font-black text-rose-600 dark:text-rose-400">${Number(b.outstanding_debt || 0).toLocaleString()} Ks</td>
                    </tr>
                `;
            });
        }
    }
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
        emerald: { val: "text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight", box: "w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-xl shrink-0" },
        blue: { val: "text-2xl font-black text-blue-600 dark:text-blue-400 font-mono tracking-tight", box: "w-12 h-12 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center text-xl shrink-0" },
        purple: { val: "text-2xl font-black text-purple-600 dark:text-purple-400 font-mono tracking-tight", box: "w-12 h-12 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center text-xl shrink-0" },
        amber: { val: "text-2xl font-black text-amber-600 dark:text-amber-400 font-mono tracking-tight", box: "w-12 h-12 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-xl shrink-0" },
        rose: { val: "text-2xl font-black text-rose-600 dark:text-rose-400 font-mono tracking-tight", box: "w-12 h-12 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center text-xl shrink-0" }
    };

    const chosen = colorClasses[theme] || colorClasses.emerald;
    if (valEl) valEl.className = chosen.val;
    if (iconBox) iconBox.className = chosen.box;
}

// -------------------------------------------------------------
// 3. Admin CSV Export Logic
// -------------------------------------------------------------
function exportDashboardToCSV() {
    if (!dashboardData || !dashboardData.admin) {
        return alert("ထုတ်ယူရန် Dashboard အချက်အလက် မရှိသေးပါ");
    }

    const a = dashboardData.admin;
    let csv = `Executive Financial Summary (${selectedYear})\n`;
    csv += `Metric,Value (MMK)\n`;
    csv += `Total Revenue,${a.total_revenue || 0}\n`;
    csv += `Net Profit,${a.net_profit || 0}\n`;
    csv += `Total Expenses,${a.total_expenses || 0}\n`;
    csv += `Total Stock Valuation,${a.total_stock_value || 0}\n`;
    csv += `Outstanding Debt,${a.total_outstanding_debt || 0}\n\n`;

    csv += `Expense Breakdown by Category\n`;
    csv += `Category Name,Amount (MMK)\n`;
    (a.expense_breakdown || []).forEach(e => {
        csv += `"${(e.category_name || '').replace(/"/g, '""')}",${e.amount || 0}\n`;
    });
    csv += `\n`;

    csv += `Branch Valuation & Balances\n`;
    csv += `Branch Name,Cash Net,Bank Net,Stock Valuation,Outstanding Debt\n`;
    (a.branch_metrics || []).forEach(b => {
        csv += `"${(b.name || '').replace(/"/g, '""')}",${b.cash_net || 0},${b.bank_net || 0},${b.stock_value || 0},${b.outstanding_debt || 0}\n`;
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Executive_Dashboard_Summary_${selectedYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
