// cashbook-frontend/js/app.js
import { state } from "./core/state.js";
import { initAuth } from "./modules/auth.js";
import { initPOS } from "./modules/pos.js";
import { initCashbook } from "./modules/cashbook.js"; // <--- ဖြည့်စွက်ထားသည်
import { api } from "./core/api.js";

document.addEventListener("DOMContentLoaded", async () => {
    startClock();
    initTheme(); // Dark Mode လိုဂျစ်ကို သီးသန့်ခွဲထုတ်ထားသည်

    if (!state.isLoggedIn()) {
        await showLoginView();
    } else {
        showAppLayout();
        await loadBranches();
        await navigateTo("pos"); // မူလအားဖြင့် POS ကို အရင်ဖွင့်မည်
    }

    // Logout Event
    document.getElementById("btn-logout")?.addEventListener("click", () => {
        if (confirm("စနစ်မှ အမှန်တကယ် ထွက်ခွာလိုပါသလား?")) {
            state.logout();
        }
    });

    // Sidebar Navigation Menu Events (Active State နှင့် View ပြောင်းခြင်း)
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            // Remove active style from all
            document.querySelectorAll(".nav-item").forEach(b => {
                b.className = "nav-item flex items-center gap-3.5 w-full px-4 py-3 rounded-xl transition text-slate-400 hover:bg-slate-800/70 hover:text-white font-semibold";
            });
            // Add active style to clicked button
            btn.className = "nav-item active flex items-center gap-3.5 w-full px-4 py-3 rounded-xl transition bg-slate-800 text-white shadow-sm font-semibold";
            
            // Navigate to view
            navigateTo(btn.dataset.view);
        });
    });
});

async function showLoginView() {
    document.getElementById("app-layout")?.classList.add("hidden");
    const container = document.getElementById("login-container");
    container.classList.remove("hidden");

    try {
        const html = await fetch("views/login.html").then(r => r.text());
        container.innerHTML = html;
        initAuth();
    } catch (err) {
        container.innerHTML = `<div class="p-8 text-center text-rose-500">Login မျက်နှာပြင် ဖွင့်၍မရပါ</div>`;
    }
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

        // Non-admin users cannot switch branches
        if (!state.isAdmin()) {
            select.disabled = true;
        }

        select.addEventListener("change", (e) => {
            const b = res.data.find(item => item.id === parseInt(e.target.value));
            state.setBranch(b);
            
            // Active ဖြစ်နေသော View ကို ပြန်လည် Refresh လုပ်မည်
            const activeView = document.querySelector(".nav-item.active")?.dataset.view || "pos";
            navigateTo(activeView); 
        });
    } catch (err) {
        console.error("Failed to load branches:", err);
    }
}

/**
 * မျက်နှာပြင် (View) များကို ဖလှယ်ပေးသည့် Router
 */
async function navigateTo(viewName) {
    const container = document.getElementById("view-container");
    try {
        container.innerHTML = `<div class="flex items-center justify-center h-full text-slate-400"><i class="fa-solid fa-spinner fa-spin text-3xl"></i></div>`;
        
        const html = await fetch(`views/${viewName}.html`).then(r => r.text());
        container.innerHTML = html;

        // View အလိုက် သက်ဆိုင်ရာ JS ကို လှမ်းခေါ်မည်
        if (viewName === "pos") {
            initPOS();
        } else if (viewName === "cashbook") {
            initCashbook(); // <--- Cashbook ချိတ်ဆက်ထားသည်
        }
        
    } catch (err) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-slate-500">
                <i class="fa-solid fa-triangle-exclamation text-4xl text-rose-500 mb-3"></i>
                <div class="font-bold text-lg">စာမျက်နှာ ဖွင့်၍ မရပါ</div>
                <div class="text-xs mt-1">ဖိုင်အမည်: views/${viewName}.html</div>
            </div>`;
    }
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        const clock = document.getElementById("live-clock");
        if (clock) clock.textContent = now.toLocaleTimeString();
    }, 1000);
}

function initTheme() {
    const themeBtn = document.getElementById("theme-toggle");
    const themeIcon = document.getElementById("theme-icon");

    if (themeBtn && themeIcon) {
        themeBtn.addEventListener("click", () => {
            const isDark = document.documentElement.classList.toggle("dark");
            themeIcon.className = isDark ? "fa-solid fa-sun text-base" : "fa-solid fa-moon text-base";
            localStorage.setItem("pos_theme", isDark ? "dark" : "light");
        });

        if (localStorage.getItem("pos_theme") === "dark") {
            document.documentElement.classList.add("dark");
            themeIcon.className = "fa-solid fa-sun text-base";
        }
    }
}
