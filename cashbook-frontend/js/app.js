// cashbook-frontend/js/app.js
import { state } from "./core/state.js";
import { initAuth } from "./modules/auth.js";
import { initPOS } from "./modules/pos.js";
import { api } from "./core/api.js";

document.addEventListener("DOMContentLoaded", async () => {
    startClock();

    if (!state.isLoggedIn()) {
        await showLoginView();
    } else {
        showAppLayout();
        await loadBranches();
        await navigateTo("pos");
    }

    // Logout Event
    document.getElementById("btn-logout")?.addEventListener("click", () => {
        if (confirm("စနစ်မှ အမှန်တကယ် ထွက်ခွာလိုပါသလား?")) {
            state.logout();
        }
    });

    // Navigation Menu Events
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".nav-item").forEach(b => {
                b.className = "nav-item flex items-center gap-3 w-full px-3.5 py-3 rounded-xl transition text-slate-400 hover:bg-slate-800 hover:text-white";
            });
            btn.className = "nav-item active flex items-center gap-3 w-full px-3.5 py-3 rounded-xl transition text-slate-300 hover:bg-slate-800 hover:text-white bg-slate-800 text-white font-bold";
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

        // Non-admin users cannot switch branches
        if (!state.isAdmin()) {
            select.disabled = true;
        }

        select.addEventListener("change", (e) => {
            const b = res.data.find(item => item.id === parseInt(e.target.value));
            state.setBranch(b);
            navigateTo("pos"); // Refresh view
        });
    } catch (err) {
        console.error("Failed to load branches:", err);
    }
}

async function navigateTo(viewName) {
    const container = document.getElementById("view-container");
    try {
        const html = await fetch(`views/${viewName}.html`).then(r => r.text());
        container.innerHTML = html;

        if (viewName === "pos") {
            initPOS();
        }
    } catch (err) {
        container.innerHTML = `<div class="p-8 text-center text-rose-500 font-bold">စာမျက်နှာ ဖွင့်၍ မရပါ: ${viewName}</div>`;
    }
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        const clock = document.getElementById("live-clock");
        if (clock) clock.textContent = now.toLocaleTimeString();
    }, 1000);
}

// Dark Mode Toggle Logic
const themeBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");

if (themeBtn) {
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

