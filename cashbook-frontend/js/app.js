// =============================================================================
// FILE: cashbook-frontend/js/app.js 
// MAIN FRONTEND ROUTER, ROLE NAVIGATION GUARD, BRANCH SCOPING & GLOBAL KPI
// Version: 4.1.0 (RBAC Permission Matrix, ALL-Branch Read-Only Lock & MMT Clock)
// =============================================================================

import { state } from "./core/state.js";
import { api } from "./core/api.js";
import { ui } from "./core/ui.js";

import { initAuth } from "./modules/auth.js";
import { initDashboard } from "./modules/dashboard.js";
import { initPOS } from "./modules/pos.js";
import { initCashbook } from "./modules/cashbook.js";
import { initInventory } from "./modules/inventory.js";
import { initYarn } from "./modules/yarn.js";
import { initCustomers } from "./modules/customers.js";
import { initPurchases } from "./modules/purchases.js";
import { initMasterProducts } from "./modules/master_products.js";
import { initWaste } from "./modules/waste.js";
import { initTransfers } from "./modules/transfers.js";
import { initStockReport } from "./modules/stock_report.js";
import { initSystemSetting } from "./modules/system_setting.js";

const VIEW_TITLES = {
    dashboard: "Dashboard",
    pos: "Sale Counter (POS)",
    cashbook: "Cash Book",
    inventory: "Stock Balances & Control",
    purchases: "Purchases",
    waste: "Damage & Waste",
    transfers: "Stock Transfers",
    stock_report: "Stock Report",
    master_products: "Product Master",
    yarn: "Yarn Balances",
    customers: "Customers & Suppliers",
    system_setting: "System Setting"
};

/**
 * Role အလိုက် ဝင်ရောက်ခွင့်ရှိသော View များ (Spec Section 3.1 & 3.2)
 */
const ALLOWED_VIEWS_BY_ROLE = {
    admin: new Set([
        "dashboard", "pos", "cashbook", "inventory", "purchases",
        "waste", "transfers", "stock_report", "master_products",
        "yarn", "customers", "system_setting"
    ]),
    finance: new Set([
        "dashboard", "pos", "cashbook", "inventory", "purchases",
        "waste", "transfers", "stock_report", "master_products",
        "yarn", "customers"
    ]),
    branch_manager: new Set([
        "dashboard", "pos", "cashbook", "inventory", "purchases",
        "waste", "transfers", "stock_report", "yarn", "customers"
    ]),
    cashier: new Set([
        "dashboard", "pos", "cashbook", "inventory", "transfers", "customers"
    ])
};

/**
 * ALL Branches ရွေးထားချိန်တွင် Write ပိတ်ရမည့် ဆိုင်ခွဲအလိုက် View များ (Spec Section 4.1 & 4.2)
 */
const BRANCH_SCOPED_WRITE_VIEWS = new Set([
    "pos", "cashbook", "inventory", "purchases", "waste", "transfers", "yarn"
]);

let currentActiveView = "dashboard";
const viewTemplateCache = new Map();

function normalizeUserRole(rawRole) {
    const r = String(rawRole || "cashier").trim().toLowerCase();
    if (r === "manager") return "branch_manager";
    if (["admin", "finance", "branch_manager", "cashier"].includes(r)) return r;
    return "cashier";
}

function canAccessView(viewName) {
    const role = normalizeUserRole(state.user?.role);
    const allowedSet = ALLOWED_VIEWS_BY_ROLE[role] || ALLOWED_VIEWS_BY_ROLE.cashier;
    return allowedSet.has(viewName);
}

function escapeText(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", async () => {
    startClock();
    initTheme();
    setupNavigation();
    setupTopKpiClickEvents();
    setupGlobalKeyboardShortcuts();

    if (!state.isLoggedIn()) {
        await showLoginView();
    } else {
        showAppLayout();
        await loadBranches();
        await navigateTo("dashboard");
    }
});

function setupNavigation() {
    document.getElementById("btn-logout")?.addEventListener("click", async () => {
        const confirmed = await ui.confirm("စနစ်မှ အမှန်တကယ် ထွက်ခွာလိုပါသလား?", "warning");
        if (confirmed) {
            state.logout();
        }
    });

    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetView = btn.dataset.view;
            if (!canAccessView(targetView)) {
                ui.toast?.("ဤစာမျက်နှာသို့ ဝင်ရောက်ခွင့် မရှိပါ", "error");
                return;
            }
            setActiveNavButton(targetView);
            navigateTo(targetView);
        });
    });
}

/**
 * Global Esc Key Shortcut: ပွင့်နေသော Modal များကို Esc နှိပ်ရုံဖြင့် ပိတ်ပေးခြင်း
 */
function setupGlobalKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const confirmDialog = document.getElementById("global-confirm-dialog");
            if (confirmDialog && !confirmDialog.classList.contains("hidden")) {
                document.getElementById("btn-confirm-cancel")?.click();
                return;
            }

            const openModals = Array.from(
                document.querySelectorAll("#view-container .fixed.inset-0:not(.hidden)")
            );
            if (openModals.length > 0) {
                const topModal = openModals[openModals.length - 1];
                topModal.classList.add("hidden");
            }
        }
    });
}

function setupTopKpiClickEvents() {
    const kpi3Card = document.getElementById("kpi-3-value")?.closest("div.bg-white") || document.getElementById("kpi-3-value")?.parentElement;
    if (kpi3Card) {
        kpi3Card.classList.add("cursor-pointer", "hover:opacity-90", "transition");
        kpi3Card.title = "ယနေ့အရောင်းစာရင်း အသေးစိတ် ကြည့်ရှုရန် နှိပ်ပါ";
        kpi3Card.addEventListener("click", () => {
            if (currentActiveView === "pos") {
                document.getElementById("btn-open-today-sales")?.click();
            }
        });
    }
}

function setActiveNavButton(viewName) {
    document.querySelectorAll(".nav-item").forEach(b => {
        const btnView = b.dataset.view;
        const allowed = canAccessView(btnView);
        const hideClass = allowed ? "" : "hidden ";

        if (btnView === viewName && allowed) {
            b.className = `${hideClass}nav-item active flex items-center gap-3 w-full px-3.5 py-2 rounded-xl transition bg-emerald-600 text-white shadow-md shadow-emerald-600/20 cursor-pointer`;
        } else {
            b.className = `${hideClass}nav-item flex items-center gap-3 w-full px-3.5 py-2 rounded-xl transition text-slate-400 hover:bg-slate-900 hover:text-white cursor-pointer`;
        }
    });
}

async function fetchViewHtml(viewName) {
    if (viewTemplateCache.has(viewName)) {
        return viewTemplateCache.get(viewName);
    }
    const res = await fetch(`views/${viewName}.html`);
    if (!res.ok) throw new Error("View not found");
    const html = await res.text();
    viewTemplateCache.set(viewName, html);
    return html;
}

async function showLoginView() {
    document.getElementById("app-layout")?.classList.add("hidden");
    const container = document.getElementById("login-container");
    if (!container) return;
    container.classList.remove("hidden");

    const html = await fetchViewHtml("login");
    container.innerHTML = html;
    initAuth();
}

function showAppLayout() {
    document.getElementById("login-container")?.classList.add("hidden");
    document.getElementById("app-layout")?.classList.remove("hidden");

    const user = state.user || {};
    const role = normalizeUserRole(user.role);

    const roleLabelMap = {
        admin: "Admin",
        finance: "Finance",
        branch_manager: "Branch Manager",
        cashier: "Cashier"
    };

    const displayName = role === "admin" ? "Admin" : (user.fullName || user.username || "User");
    const displayRole = roleLabelMap[role] || role;

    const nameEl = document.getElementById("user-name");
    const roleEl = document.getElementById("user-role");
    const initEl = document.getElementById("user-initial");

    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = displayRole;
    if (initEl) initEl.textContent = displayName.charAt(0).toUpperCase();

    setActiveNavButton(currentActiveView);
}

async function loadBranches() {
    const select = document.getElementById("global-branch-select");
    if (!select) return;

    try {
        const res = await api.get("/branches");
        const branches = res.data || [];
        state.branches = branches;
        select.innerHTML = "";

        const role = normalizeUserRole(state.user?.role);
        const canSelectAllBranches = role === "admin" || role === "finance";

        // Admin & Finance can choose "ALL" (Read-Only) or a specific branch
        if (canSelectAllBranches && branches.length > 1) {
            const allOpt = document.createElement("option");
            allOpt.value = "ALL";
            allOpt.textContent = "🏢 ဆိုင်ခွဲအားလုံး (ALL - Read Only)";
            select.appendChild(allOpt);
        }

        if (branches.length > 0 && !state.currentBranch) {
            const assignedBranch = branches.find(b => Number(b.id) === Number(state.user?.branchId)) || branches[0];
            state.setBranch(assignedBranch);
        }

        // Force branch_manager & cashier onto their own assigned branch (Spec 4.1)
        if (!canSelectAllBranches && branches.length > 0) {
            const lockedBranch = branches.find(b => Number(b.id) === Number(state.user?.branchId)) || branches[0];
            state.setBranch(lockedBranch);
        }

        branches.forEach(b => {
            const opt = document.createElement("option");
            opt.value = String(b.id);
            opt.textContent = `${b.name} (${b.code})`;
            if (String(state.currentBranch?.id) === String(b.id)) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });

        if (canSelectAllBranches && String(state.currentBranch?.id) === "ALL") {
            select.value = "ALL";
        }

        // Only Admin & Finance can switch branches (Spec 4.1)
        select.disabled = !canSelectAllBranches;

        select.onchange = (e) => {
            const val = e.target.value;
            if (val === "ALL" && canSelectAllBranches) {
                state.setBranch({ id: "ALL", code: "ALL", name: "ဆိုင်ခွဲအားလုံး (ALL)" });
                navigateTo(currentActiveView);
                return;
            }
            const b = branches.find(item => Number(item.id) === parseInt(val, 10));
            if (b) {
                state.setBranch(b);
                navigateTo(currentActiveView);
            }
        };
    } catch (err) {
        console.error("Failed to load branches:", err);
    }
}

/**
 * ALL View ရွေးချယ်ထားပါက Write ခလုတ်များကို ပိတ်ပြီး Read-Only သတိပေးချက် ပြသခြင်း (Spec 4.1, 4.2 & 10)
 */
export function applyBranchWriteGuard(viewName = currentActiveView) {
    const container = document.getElementById("view-container");
    if (!container) return;

    const existingBanner = document.getElementById("all-branch-readonly-banner");
    if (existingBanner) existingBanner.remove();

    const isAllView = String(state.currentBranch?.id || "").toUpperCase() === "ALL";
    if (!isAllView || !BRANCH_SCOPED_WRITE_VIEWS.has(viewName)) {
        return;
    }

    // 1. Insert clear Read-Only Banner at the top of the view
    const banner = document.createElement("div");
    banner.id = "all-branch-readonly-banner";
    banner.className = "mb-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold flex items-center justify-between gap-2";
    banner.innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fa-solid fa-eye text-sm"></i>
            <span>ဆိုင်ခွဲအားလုံး (ALL View - Read Only) ကြည့်ရှုနေပါသည်။ အသစ်သွင်းရန် သို့မဟုတ် စာရင်းပြင်ဆင်ရန် အပေါ်ညာဘက်မှ ဆိုင်ခွဲတစ်ခုကို တိကျစွာ ရွေးချယ်ပါ။</span>
        </div>
    `;
    container.prepend(banner);

    // 2. Disable primary write/create/checkout buttons in ALL view
    const writeSelectors = [
        "[data-branch-write]",
        "#btn-add-product",
        "#btn-open-product-modal",
        "#btn-bulk-import",
        "#btn-new-purchase",
        "#btn-add-purchase",
        "#btn-save-purchase",
        "#btn-checkout",
        "#btn-pos-pay",
        "#btn-add-cashbook",
        "#btn-new-entry",
        "#btn-add-transfer",
        "#btn-new-transfer",
        "#btn-add-waste",
        "#btn-new-waste",
        "#btn-issue-yarn",
        "#btn-new-opening-stock",
        "#btn-new-adjustment"
    ];

    container.querySelectorAll(writeSelectors.join(",")).forEach(btn => {
        btn.disabled = true;
        btn.classList.add("opacity-50", "cursor-not-allowed", "pointer-events-none");
        btn.title = "ALL View တွင် စာရင်းသွင်း၍ မရပါ။ ဆိုင်ခွဲတစ်ခုကို ရွေးချယ်ပါ။";
    });
}

/**
 * မြန်မာစံတော်ချိန် (UTC+6:30) နှင့် ကိုက်ညီသော YYYY-MM-DD ရက်စွဲ ထုတ်ပေးခြင်း (Spec 9.9)
 */
export function getLocalTodayDate() {
    const mmtMs = Date.now() + (390 * 60 * 1000);
    return new Date(mmtMs).toISOString().split("T")[0];
}

/**
 * Global KPI Bar အဖွင့်/အပိတ် ထိန်းချုပ်ခြင်း
 */
export async function refreshGlobalKPIs(viewOverride) {
    const view = viewOverride || currentActiveView;
    const globalKpiBar = document.getElementById("global-kpi-bar");

    if (view === "dashboard" || view === "system_setting") {
        globalKpiBar?.classList.add("hidden");
    } else {
        globalKpiBar?.classList.remove("hidden");
    }
}

export function setKPI(index, label, value, iconClass, colorTheme = "emerald") {
    const lblEl = document.getElementById(`kpi-${index}-label`);
    const valEl = document.getElementById(`kpi-${index}-value`);
    const icoEl = document.getElementById(`kpi-${index}-icon`);

    if (lblEl) lblEl.textContent = label;
    if (valEl) {
        valEl.textContent = Number(value || 0).toLocaleString();
        const colorMap = {
            emerald: "text-lg sm:text-xl md:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight truncate",
            blue: "text-lg sm:text-xl md:text-2xl font-black text-blue-600 dark:text-blue-400 font-mono tracking-tight truncate",
            rose: "text-lg sm:text-xl md:text-2xl font-black text-rose-600 dark:text-rose-400 font-mono tracking-tight truncate",
            amber: "text-lg sm:text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400 font-mono tracking-tight truncate",
            purple: "text-lg sm:text-xl md:text-2xl font-black text-purple-600 dark:text-purple-400 font-mono tracking-tight truncate",
            slate: "text-lg sm:text-xl md:text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight truncate"
        };
        valEl.className = colorMap[colorTheme] || colorMap.emerald;
    }
    if (icoEl) {
        if (iconClass) icoEl.className = `fa-solid ${iconClass}`;
        const iconWrapper = icoEl.parentElement;
        if (iconWrapper) {
            const bgMap = {
                emerald: "w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center text-lg shrink-0",
                blue: "w-11 h-11 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center text-lg shrink-0",
                rose: "w-11 h-11 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center text-lg shrink-0",
                amber: "w-11 h-11 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center text-lg shrink-0",
                purple: "w-11 h-11 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center text-lg shrink-0",
                slate: "w-11 h-11 rounded-xl bg-slate-500/10 text-slate-500 flex items-center justify-center text-lg shrink-0"
            };
            iconWrapper.className = bgMap[colorTheme] || bgMap.emerald;
        }
    }
}

export async function navigateTo(viewName) {
    if (!canAccessView(viewName)) {
        viewName = "dashboard";
    }

    currentActiveView = viewName;
    setActiveNavButton(viewName);

    const container = document.getElementById("view-container");
    const titleEl = document.getElementById("topbar-page-title");
    if (titleEl) titleEl.textContent = VIEW_TITLES[viewName] || "GARMENT ERP";

    try {
        const html = await fetchViewHtml(viewName);
        container.innerHTML = html;

        await refreshGlobalKPIs(viewName);

        if (viewName === "dashboard") {
            await initDashboard();
        } else if (viewName === "pos") {
            await initPOS();
        } else if (viewName === "cashbook") {
            await initCashbook();
        } else if (viewName === "inventory") {
            await initInventory();
        } else if (viewName === "yarn") {
            await initYarn();
        } else if (viewName === "customers") {
            await initCustomers();
        } else if (viewName === "purchases") {
            await initPurchases();
        } else if (viewName === "master_products") {
            await initMasterProducts();
        } else if (viewName === "waste") {
            await initWaste();
        } else if (viewName === "transfers") {
            await initTransfers();
        } else if (viewName === "stock_report") {
            await initStockReport();
        } else if (viewName === "system_setting") {
            await initSystemSetting();
        }

        // Enforce ALL-Branch Read-Only Lock after module initialization
        applyBranchWriteGuard(viewName);
    } catch (err) {
        const safeTitle = escapeText(VIEW_TITLES[viewName] || viewName);
        const safeMsg = escapeText(err?.message || "Unknown Error");
        container.innerHTML = `
            <div class="h-full w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-400">
                <i class="fa-solid fa-layer-group text-4xl text-emerald-500 mb-3"></i>
                <div class="text-base font-bold text-slate-700 dark:text-slate-200">${safeTitle}</div>
                <div class="text-xs mt-1">ဤမော်ဂျူးကို ဖွင့်လှစ်ရာတွင် အခက်အခဲရှိနေပါသည် (${safeMsg})</div>
            </div>`;
    }
}

function startClock() {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const update = () => {
        const clock = document.getElementById("live-clock");
        if (!clock) return;

        // Display Myanmar Standard Time (UTC+6:30)
        const now = new Date(Date.now() + (390 * 60 * 1000));
        const day = String(now.getUTCDate()).padStart(2, "0");
        const mon = months[now.getUTCMonth()];
        const yr = String(now.getUTCFullYear()).slice(-2);

        let hr = now.getUTCHours();
        const min = String(now.getUTCMinutes()).padStart(2, "0");
        const ampm = hr >= 12 ? "PM" : "AM";
        hr = hr % 12 || 12;

        clock.textContent = `${day} ${mon} ${yr} | ${hr}:${min} ${ampm}`;
    };
    update();
    setInterval(update, 1000);
}

function initTheme() {
    const themeBtn = document.getElementById("theme-toggle");
    const themeIcon = document.getElementById("theme-icon");

    const saved = localStorage.getItem("pos_theme") || "dark";
    if (saved === "dark") {
        document.documentElement.classList.add("dark");
        if (themeIcon) themeIcon.className = "fa-solid fa-sun text-base";
    } else {
        document.documentElement.classList.remove("dark");
        if (themeIcon) themeIcon.className = "fa-solid fa-moon text-base";
    }

    themeBtn?.addEventListener("click", () => {
        const isDark = document.documentElement.classList.toggle("dark");
        if (themeIcon) {
            themeIcon.className = isDark ? "fa-solid fa-sun text-base" : "fa-solid fa-moon text-base";
        }
        localStorage.setItem("pos_theme", isDark ? "dark" : "light");
    });
}
