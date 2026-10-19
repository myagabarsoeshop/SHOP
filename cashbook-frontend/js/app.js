/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - MAIN SPA ROUTER & CONTROLLER
 * File: js/app.js (Location: cashbook-frontend/js/app.js)
 * 💡 Features: 🛡️ Zero Flicker, Unified Router, Stable Token & RBAC Support
 * ==============================================================================
 */

"use strict";

window.viewCache = window.viewCache || {};
const API_BASE_URL = "https://shop.myagabarsoeshop.workers.dev/api";

/**
 * 💡 Universal Textile & Cash Book Category Badge Formatter (XSS-Safe)
 */
window.formatCategoryBadgeHtml = function (categoryStr) {
  const cat = String(categoryStr || '-').trim();
  if (!cat || cat === '-') return '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-400 border border-slate-700/60">-</span>';

  const safeCat = (typeof window.escapeHtml === 'function') ? window.escapeHtml(cat) : cat;
  const lower = cat.toLowerCase();

  if (lower.includes('income') || lower.includes('sale') || lower.includes('ရောင်း') || lower.includes('ဝင်')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"><i class="fa-solid fa-circle-arrow-down text-[9px] text-emerald-400"></i> ${safeCat}</span>`;
  }
  if (lower.includes('expense') || lower.includes('purchase') || lower.includes('ဝယ်') || lower.includes('စရိတ်') || lower.includes('ထွက်')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"><i class="fa-solid fa-circle-arrow-up text-[9px] text-rose-400"></i> ${safeCat}</span>`;
  }
  if (lower.includes('transfer') || lower.includes('move') || lower.includes('လွှဲ')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm"><i class="fa-solid fa-right-left text-[9px] text-sky-400"></i> ${safeCat}</span>`;
  }
  if (lower.includes('ပုဆိုး') || lower.includes('လုံချည်') || lower.includes('အင်္ကျီ') || lower.includes('ဝမ်းဆက်') || lower.includes('ချည်') || lower.includes('stock')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"><i class="fa-solid fa-box text-[9px] text-amber-400"></i> ${safeCat}</span>`;
  }

  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700/60">${safeCat}</span>`;
};

/**
 * 💡 Initialize ERP Application Shell (Stable Class Management)
 */
function initApp() {
  // 🎯 Use unified 'token' key matching auth.js
  const token = localStorage.getItem('token') || localStorage.getItem('golden_auth_token');
  const userObj = localStorage.getItem('user');
  let username = 'Admin';

  if (userObj) {
    try {
      const parsed = JSON.parse(userObj);
      username = parsed.username || parsed.name || 'Admin';
    } catch (e) {}
  }

  if (!token) {
    document.documentElement.classList.remove('is-authed');
    document.documentElement.classList.add('dark', 'not-authed');
    return;
  }

  document.documentElement.classList.remove('not-authed');
  document.documentElement.classList.add('dark', 'is-authed');
  
  updateHeaderMetadata(username);

  // 🎯 Default to Dashboard smoothly without double loading
  switchTab('dashboard');
}

document.addEventListener('DOMContentLoaded', function () {
  initApp();
});

/**
 * 💡 Dynamic Header Calendar FY & Time Indicator (Optimized Interval)
 */
function updateHeaderMetadata(username) {
  const metaEl = document.getElementById('live-metadata');
  if (!metaEl) return;

  let activeUser = username;
  if (!activeUser) {
    const userObj = localStorage.getItem('user');
    if (userObj) {
      try { activeUser = JSON.parse(userObj).username || JSON.parse(userObj).name; } catch(e) {}
    }
    activeUser = activeUser || 'Admin';
  }

  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[d.getDay()];

  const currentFyStr = window.FY ? window.FY.getCurrentFY() : `FY ${d.getFullYear()}`;

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const formattedHours = String(hours).padStart(2, '0');
  const formattedTime = `${formattedHours}:${minutes} ${ampm}`;

  metaEl.textContent = `${currentFyStr} | ${dayName} | ${formattedTime} | User: ${activeUser}`;
}

if (!window.headerClockInterval) {
  // 🎯 Updated to 10 seconds to prevent unnecessary CPU/DOM repaints
  window.headerClockInterval = setInterval(() => {
    updateHeaderMetadata();
  }, 10000);
}

/**
 * 💡 Central Tab & View Router Engine (Single Source of Truth)
 */
async function switchTab(tabId) {
  if (!tabId) tabId = 'dashboard';

  const token = localStorage.getItem('token') || localStorage.getItem('golden_auth_token');
  if (!token) {
    document.documentElement.classList.remove('is-authed');
    document.documentElement.classList.add('dark', 'not-authed');
    return;
  }

  updateSidebarHighlight(tabId);

  const titleEl = document.getElementById('page-title');
  const container = document.getElementById('view-container');

  if (window.AppState) {
    window.AppState.currentModule = tabId;
  }

  // 1. STORE & INVENTORY
  if (tabId === 'store') {
    if (titleEl) titleEl.textContent = "ကုန်ချောစတို စီမံခန့်ခွဲမှု (Store & Inventory)";
    if (window.StoreEngine) {
      await window.StoreEngine.init("main");
    }
    return;
  }

  // 2. YARN STORE & INVENTORY
  if (tabId === 'yarn') {
    if (titleEl) titleEl.textContent = "ချည်စတို စီမံခန့်ခွဲမှု (Yarn Store & Inventory)";
    if (window.YarnEngine) {
      await window.YarnEngine.init("main");
    }
    return;
  }

  // 3. CASHBOOK BRANCHES (Main & Shop 1 to 5)
  const cashbookShops = ['main', 'shop1', 'shop2', 'shop3', 'shop4', 'shop5'];
  if (cashbookShops.includes(tabId)) {
    const shopTitles = {
      'main': 'Main Home Shop (ပင်မဆိုင် ငွေစာရင်း)',
      'shop1': 'ဆိုင်ခွဲ (၁) - အရောင်းနှင့် ငွေစာရင်း',
      'shop2': 'ဆိုင်ခွဲ (၂) - အရောင်းနှင့် ငွေစာရင်း',
      'shop3': 'ဆိုင်ခွဲ (၃) - အရောင်းနှင့် ငွေစာရင်း',
      'shop4': 'ဆိုင်ခွဲ (၄) - အရောင်းနှင့် ငွေစာရင်း',
      'shop5': 'ဆိုင်ခွဲ (၅) - အရောင်းနှင့် ငွေစာရင်း'
    };

    const currentTitle = shopTitles[tabId] || "ငွေစာရင်း (Cash Book)";
    if (titleEl) titleEl.textContent = currentTitle;

    if (window.CashbookEngine) {
      await window.CashbookEngine.init(tabId);
    } else if (container) {
      container.innerHTML = `
        <div class="p-12 text-center text-slate-400 bg-slate-900 border border-slate-800 rounded-3xl flex flex-col items-center justify-center shadow-xl">
          <div class="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400 text-2xl mb-4">
            <i class="fa-solid fa-cash-register"></i>
          </div>
          <h3 class="text-base font-bold text-slate-200">${currentTitle}</h3>
          <p class="text-xs text-slate-400 mt-1">ငွေစာရင်းအချက်အလက်များကို ချိတ်ဆက်နေပါသည်...</p>
        </div>
      `;
    }
    return;
  }

  // 4. HOME DASHBOARD
  if (tabId === 'dashboard') {
    if (titleEl) titleEl.textContent = "Home Dashboard";
    if (window.DashboardEngine) {
      await window.DashboardEngine.init();
    }
    return;
  }

  // 5. REPORTS & SYSTEM SETTINGS
  const otherTitles = {
    'report-financial': 'Financial Reports (ဘဏ္ဍာရေး အစီရင်ခံစာများ)',
    'settings': 'System Settings (စနစ် ဆက်တင်များ)'
  };

  const otherTitle = otherTitles[tabId] || tabId.toUpperCase();
  if (titleEl) titleEl.textContent = otherTitle;

  if (container) {
    container.innerHTML = `
      <div class="p-12 text-center text-slate-400 bg-slate-900 border border-slate-800 rounded-3xl flex flex-col items-center justify-center shadow-xl">
        <h3 class="text-base font-bold text-slate-200">${otherTitle}</h3>
        <p class="text-xs text-slate-400 mt-1">ဤကဏ္ဍကို မကြာမီ ဆက်လက်ထည့်သွင်းပေးမည် ဖြစ်ပါသည်။</p>
      </div>
    `;
  }
}

/**
 * 💡 Sidebar Active State Synchronization
 */
function updateSidebarHighlight(activeTabId) {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.classList.remove('bg-amber-500/20', 'text-amber-400', 'font-bold', 'active');
  });

  const activeBtn = document.getElementById(`btn-${activeTabId}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-amber-500/20', 'text-amber-400', 'font-bold', 'active');
  }
}

// Global Exports
window.initApp = initApp;
window.switchTab = switchTab;
window.updateSidebarHighlight = updateSidebarHighlight;
window.updateHeaderMetadata = updateHeaderMetadata;
