// cashbook-frontend/js/app.js
import { state } from "./core/state.js";
import { initAuth } from "./modules/auth.js";
import { initPOS } from "./modules/pos.js";
import { initCashbook } from "./modules/cashbook.js";
import { api } from "./core/api.js";

const VIEW_TITLES = {
    pos: "အရောင်းကောင်တာ (POS)",
    cashbook: "နေ့စဉ်ငွေစာရင်း (Cashbook)",
    inventory: "အထည်လက်ကျန် စာရင်း (Stock)",
    yarn: "ချည်စတိုနှင့် ရက်ကန်းစီမံခန့်ခွဲမှု",
    customers: "ဖောက်သည်နှင့် အကြွေးစာရင်း"
};

document.addEventListener("DOMContentLoaded", async () => {
    startClock();
    initTheme();

    if (!state.isLoggedIn()) {
        await showLoginView();
    } else {
        showAppLayout();
        await loadBranches();
        await navigateTo("pos");
    }

    document.getElementById("btn-logout")?.addEventListener("click", () => {
        if (confirm("စနစ်မှ အမှန်တကယ် ထွက်ခွာလိုပါသလား?")) {
            state.logout();
        }
    });

    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".nav-item").forEach(b => {
                b.className = "nav-item flex items-center gap-3.5 w-full px-4 py-3 rounded-xl transition text-slate-400 hover:bg-slate-900 hover:text-white cursor-pointer";
            });
            btn.className = "nav-item active flex items-center gap-3.5 w-full px-4 py-3 rounded-xl transition bg-emerald-600 text-white shadow-md shadow-emerald-600/20 cursor-pointer";
            navigateTo(btn.dataset.view);
        });
    });
});

async function showLoginView() {
    document.getElementById("app-layout")?.classList.add("hidden");
    const container = document.getElementById("login-container");
    container.classList.remove("hidden");

    const html = await fetch("views/login.html").then(r => r.text());
    container.innerHTML = html;
    initAuth();
}

function showAppLayout() {
    document.getElementById("login-container")?.classList.add("hidden");
    document.getElementById("app-layout")?.classList.remove("hidden");

    document.getElementById("user-name").textContent = state.user.fullName || state.user.username;
    document.getElementById("user-role").textContent = state.user.role;
    document.getElementById("user-initial").textContent = (state.user.fullName || "U").charAt(0).toUpperCase();
}

async function loadBranches() {
    const select = document.getElementById("global-branch-select");
    if (!select) return;

    try {
        const res = await api.get("/branches");
        select.innerHTML = "";

        res.data.forEach(b => {
            const opt = document.createElement("option");
            opt.value = b.id;
            opt.textContent = `${b.name} (${b.code})`;
            if (state.currentBranch?.id === b.id) opt.selected = true;
            select.appendChild(opt);
        });

        if (!state.isAdmin()) {
            select.disabled = true;
        }

        select.addEventListener("change", (e) => {
            const b = res.data.find(item => item.id === parseInt(e.target.value));
            state.setBranch(b);
            const activeView = document.querySelector(".nav-item.active")?.dataset.view || "pos";
            navigateTo(activeView);
        });
    } catch (err) {
        console.error("Failed to load branches:", err);
    }
}

/**
 * Global 4-Box KPI ကို View အလိုက် အချက်အလက် ပြောင်းလဲပေးခြင်း
 */
export async function refreshGlobalKPIs() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const today = new Date().toISOString().split("T")[0];
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: today, end_date: today });
        const summary = res.data?.summary || { cash: { in: 0, out: 0, net: 0 }, bank: { in: 0, out: 0, net: 0 }, totalNet: 0 };

        const totalExpenses = (summary.cash.out || 0) + (summary.bank.out || 0);

        setKPI(1, "ယနေ့ ငွေသားဝင်ငွေ (Cash In)", summary.cash.in, "fa-money-bill-wave");
        setKPI(2, "ယနေ့ KPay / ဘဏ်ဝင်ငွေ (Bank In)", summary.bank.in, "fa-building-columns");
        setKPI(3, "ယနေ့ စရိတ်ထွက်ငွေ (Expenses)", totalExpenses, "fa-arrow-trend-down");
        setKPI(4, "ယနေ့ အသားတင်လက်ကျန် (Net)", summary.totalNet, "fa-vault");
    } catch (err) {
        console.error("KPI update error:", err);
    }
}

export function setKPI(index, label, value, iconClass) {
    const lblEl = document.getElementById(`kpi-${index}-label`);
    const valEl = document.getElementById(`kpi-${index}-value`);
    const icoEl = document.getElementById(`kpi-${index}-icon`);

    if (lblEl) lblEl.textContent = label;
    if (valEl) valEl.textContent = Number(value || 0).toLocaleString();
    if (icoEl && iconClass) icoEl.className = `fa-solid ${iconClass}`;
}

async function navigateTo(viewName) {
    const container = document.getElementById("view-container");
    const titleEl = document.getElementById("topbar-page-title");
    if (titleEl) titleEl.textContent = VIEW_TITLES[viewName] || "GARMENT ERP";

    try {
        const html = await fetch(`views/${viewName}.html`).then(r => {
            if (!r.ok) throw new Error("View not found");
            return r.text();
        });
        container.innerHTML = html;

        await refreshGlobalKPIs();

        if (viewName === "pos") {
            initPOS();
        } else if (viewName === "cashbook") {
            initCashbook();
        }
    } catch (err) {
        container.innerHTML = `
            <div class="h-full w-full bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-slate-400">
                <i class="fa-solid fa-layer-group text-4xl text-emerald-500 mb-3"></i>
                <div class="text-base font-bold text-slate-700 dark:text-slate-200">${VIEW_TITLES[viewName] || viewName}</div>
                <div class="text-xs mt-1">ဤမော်ဂျူးကို ဆက်လက်တည်ဆောက်နေပါသည်</div>
            </div>`;
    }
}

function startClock() {
    const update = () => {
        const clock = document.getElementById("live-clock");
        if (clock) clock.textContent = new Date().toLocaleTimeString();
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
