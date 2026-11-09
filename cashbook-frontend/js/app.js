// cashbook-frontend/js/app.js
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
    dashboard: "Dashboard (လုပ်ငန်းအနှစ်ချုပ်)",
    pos: "Sale Counter (POS)",
    cashbook: "Cash Book (နေ့စဉ်ငွေစာရင်း)",
    inventory: "Stock Balances (အထည်လက်ကျန်)",
    purchases: "Purchases (အဝယ်နှင့် စတော့အဝင်)",
    waste: "Damage & Waste (ပျက်စီး/အလေအလွင့်)",
    transfers: "Stock Transfers (ဆိုင်ခွဲစတော့လွှဲပြောင်းမှု)",
    stock_report: "Stock Report (လစဉ်စတော့လှုပ်ရှားမှုနှင့် လက်ကျန်မက်ထရစ်)",
    master_products: "Product Master (ဗဟို ကုန်ပစ္စည်းစာရင်း)",
    yarn: "Yarn Balances (ချည်စတိုနှင့် ရက်ကန်း)",
    customers: "Customers & Suppliers (ဖောက်သည်နှင့် ပွဲရုံကြွေးမြီစာရင်း)",
    system_setting: "System Setting (စနစ် ဆက်တင်နှင့် အရင်းအမြစ်)"
};

let currentActiveView = "dashboard";
const viewTemplateCache = new Map();

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
            setActiveNavButton(btn.dataset.view);
            navigateTo(btn.dataset.view);
        });
    });
}

/**
 * Global Esc Key Shortcut: ပွင့်နေသော Modal များကို Esc နှိပ်ရုံဖြင့် ပိတ်ပေးခြင်း
 */
function setupGlobalKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            // Confirm dialog ပွင့်နေပါက Confirm dialog က သူ့ဘာသာ ကိုင်တွယ်မည်
            const confirmDialog = document.getElementById("global-confirm-dialog");
            if (confirmDialog && !confirmDialog.classList.contains("hidden")) {
                document.getElementById("btn-confirm-cancel")?.click();
                return;
            }

            // View container အတွင်း ပွင့်နေသော Modal များကို အပေါ်ဆုံးမှ စပိတ်မည်
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
        if (b.dataset.view === viewName) {
            b.className = "nav-item active flex items-center gap-3 w-full px-3.5 py-2 rounded-xl transition bg-emerald-600 text-white shadow-md shadow-emerald-600/20 cursor-pointer";
        } else {
            b.className = "nav-item flex items-center gap-3 w-full px-3.5 py-2 rounded-xl transition text-slate-400 hover:bg-slate-900 hover:text-white cursor-pointer";
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
    const displayName = user.fullName || user.username || "User";

    const nameEl = document.getElementById("user-name");
    const roleEl = document.getElementById("user-role");
    const initEl = document.getElementById("user-initial");

    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = user.role || "cashier";
    if (initEl) initEl.textContent = displayName.charAt(0).toUpperCase();

    const masterMenu = document.getElementById("nav-master-products");
    if (masterMenu) {
        if (state.isAdmin()) {
            masterMenu.classList.remove("hidden");
        } else {
            masterMenu.classList.add("hidden");
        }
    }
}

async function loadBranches() {
    const select = document.getElementById("global-branch-select");
    if (!select) return;

    try {
        const res = await api.get("/branches");
        const branches = res.data || [];
        state.branches = branches; // Cache branches in state to save D1 Reads across modules
        select.innerHTML = "";

        if (branches.length > 0 && !state.currentBranch) {
            const defaultBranch = branches.find(b => b.id === state.user?.branchId) || branches[0];
            state.setBranch(defaultBranch);
        }

        branches.forEach(b => {
            const opt = document.createElement("option");
            opt.value = b.id;
            opt.textContent = `${b.name} (${b.code})`;
            if (state.currentBranch?.id === b.id) opt.selected = true;
            select.appendChild(opt);
        });

        select.disabled = !state.isAdmin();

        select.onchange = (e) => {
            const b = branches.find(item => item.id === parseInt(e.target.value, 10));
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
 * မြန်မာစံတော်ချိန်နှင့် ကိုက်ညီသော YYYY-MM-DD ရက်စွဲ ထုတ်ပေးခြင်း
 */
export function getLocalTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Global KPI Bar အဖွင့်/အပိတ် ထိန်းချုပ်ခြင်း (D1 Read မကုန်စေရန် သက်ဆိုင်ရာ Module ကသာ KPI ကို တွက်ချက်မည်)
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
            emerald: "text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight",
            blue: "text-2xl font-black text-blue-600 dark:text-blue-400 font-mono tracking-tight",
            rose: "text-2xl font-black text-rose-600 dark:text-rose-400 font-mono tracking-tight",
            amber: "text-2xl font-black text-amber-600 dark:text-amber-400 font-mono tracking-tight",
            purple: "text-2xl font-black text-purple-600 dark:text-purple-400 font-mono tracking-tight",
            slate: "text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight"
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
    } catch (err) {
        container.innerHTML = `
            <div class="h-full w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-400">
                <i class="fa-solid fa-layer-group text-4xl text-emerald-500 mb-3"></i>
                <div class="text-base font-bold text-slate-700 dark:text-slate-200">${VIEW_TITLES[viewName] || viewName}</div>
                <div class="text-xs mt-1">ဤမော်ဂျူးကို ဖွင့်လှစ်ရာတွင် အခက်အခဲရှိနေပါသည် (${err.message})</div>
            </div>`;
    }
}

function startClock() {
    const update = () => {
        const clock = document.getElementById("live-clock");
        if (clock) clock.textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
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
