/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - MAIN SPA ROUTER & CONTROLLER
 * File: js/app.js (Location: cashbook-frontend/js/app.js)
 * 💡 Features: 🛡️ Zero 404 Missing View Errors (Integrated Component Rendering),
 *              🎯 Multi-Branch Store, Yarn & Cashbook Router (Main, Shop 1..5),
 *              🎯 Dynamic Calendar FY Header Indicator (Jan 1 - Dec 31 Aligned),
 *              🛡️ Textile & Shop Category Badge Formatter (XSS-Safe),
 *              🔄 Event-Safe Animated Refresh Controller
 * ==============================================================================
 */

"use strict";

window.viewCache = window.viewCache || {};

/**
 * 💡 Universal Textile & Cash Book Category Badge Formatter (XSS-Safe)
 */
window.formatCategoryBadgeHtml = function (categoryStr) {
  const cat = String(categoryStr || '-').trim();
  if (!cat || cat === '-') return '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-400 border border-slate-700/60">-</span>';

  const safeCat = (typeof window.escapeHtml === 'function') ? window.escapeHtml(cat) : cat;
  const lower = cat.toLowerCase();

  // အရောင်း / အဝင် (Green)
  if (lower.includes('income') || lower.includes('sale') || lower.includes('ရောင်း') || lower.includes('ဝင်')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"><i class="fa-solid fa-circle-arrow-down text-[9px] text-emerald-400"></i> ${safeCat}</span>`;
  }

  // အဝယ် / အသုံးစရိတ် / အထွက် (Rose/Red)
  if (lower.includes('expense') || lower.includes('purchase') || lower.includes('ဝယ်') || lower.includes('စရိတ်') || lower.includes('ထွက်')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"><i class="fa-solid fa-circle-arrow-up text-[9px] text-rose-400"></i> ${safeCat}</span>`;
  }

  // ဆိုင်ခွဲ လွှဲပြောင်းမှု (Sky Blue)
  if (lower.includes('transfer') || lower.includes('move') || lower.includes('လွှဲ')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm"><i class="fa-solid fa-right-left text-[9px] text-sky-400"></i> ${safeCat}</span>`;
  }

  // စတို / အထည် / ပုဆိုး / ချည် (Amber/Indigo)
  if (lower.includes('ပုဆိုး') || lower.includes('လုံချည်') || lower.includes('အင်္ကျီ') || lower.includes('ဝမ်းဆက်') || lower.includes('ချည်') || lower.includes('stock')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"><i class="fa-solid fa-box text-[9px] text-amber-400"></i> ${safeCat}</span>`;
  }

  // စရံ / ကြိုတင်ငွေ (Purple)
  if (lower.includes('adv') || lower.includes('စရံ') || lower.includes('ကြိုတင်')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"><i class="fa-solid fa-handshake text-[9px] text-purple-400"></i> ${safeCat}</span>`;
  }

  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700/60">${safeCat}</span>`;
};

/**
 * 💡 Initialize ERP Application Shell
 */
function initApp() {
  const token = localStorage.getItem('golden_auth_token');
  const user = localStorage.getItem('golden_user_name') || 'Admin';

  if (!token) {
    document.documentElement.className = 'dark not-authed';
    return;
  }

  document.documentElement.className = 'dark is-authed';
  updateHeaderMetadata(user);

  // 💡 စတင်ဖွင့်ချိန်တွင် အဆင်သင့်ဖြစ်နေသော 'store' (ကုန်ချောစတို) သို့ တိုက်ရိုက် ဦးတည်ဖွင့်လှစ်မည်
  switchTab('store');
}

document.addEventListener('DOMContentLoaded', function () {
  initApp();
});

/**
 * 💡 Dynamic Header Calendar FY & Time Indicator
 */
function updateHeaderMetadata(username) {
  const metaEl = document.getElementById('live-metadata');
  if (!metaEl) return;

  const activeUser = username || localStorage.getItem('golden_user_name') || 'Admin';

  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[d.getDay()];

  // 🎯 Calendar Fiscal Year (Jan 1 - Dec 31) စံနှုန်းဖြင့် တိကျစွာ ရယူခြင်း
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
  window.headerClockInterval = setInterval(() => {
    updateHeaderMetadata();
  }, 10000);
}

/**
 * 💡 Central Tab & View Router Engine (Zero 404 Errors)
 */
async function switchTab(tabId) {
  if (!tabId) tabId = 'store';

  const token = localStorage.getItem('golden_auth_token');
  if (!token) {
    document.documentElement.className = 'dark not-authed';
    return;
  }

  updateSidebarHighlight(tabId);

  const titleEl = document.getElementById('page-title');
  const container = document.getElementById('view-container');

  if (window.AppState) {
    window.AppState.currentModule = tabId;
  }

  // ==========================================================================
  // 🎯 1. STORE & INVENTORY (ကုန်ချောစတို စီမံခန့်ခွဲမှု)
  // ==========================================================================
  if (tabId === 'store') {
    if (titleEl) titleEl.textContent = "ကုန်ချောစတို စီမံခန့်ခွဲမှု (Store & Inventory)";
    if (window.StoreEngine) {
      await window.StoreEngine.init("main");
    }
    return;
  }

  // ==========================================================================
  // 🧶 2. YARN STORE & INVENTORY (ချည်စတို စီမံခန့်ခွဲမှု)
  // ==========================================================================
  if (tabId === 'yarn') {
    if (titleEl) titleEl.textContent = "ချည်စတို စီမံခန့်ခွဲမှု (Yarn Store & Inventory)";
    if (window.YarnEngine) {
      await window.YarnEngine.init("main");
    }
    return;
  }

  // ==========================================================================
  // 🎯 3. HOME DASHBOARD
  // ==========================================================================
  if (tabId === 'dashboard') {
    if (titleEl) titleEl.textContent = "Home Dashboard";
    if (container) {
      container.innerHTML = `
        <div style="padding-top: 10px;" class="space-y-4 animate-in fade-in duration-200">
          <div class="p-12 text-center text-slate-500 bg-[#0e172a] border border-slate-800 rounded-3xl flex flex-col items-center justify-center shadow-xl">
            <div class="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 text-2xl mb-4">
              <i class="fa-solid fa-gauge-high"></i>
            </div>
            <h3 class="text-base font-bold text-slate-200">မြကမ္ဘာစိုး ပိုးထည်တိုက် စနစ်သို့ ကြိုဆိုပါသည်</h3>
            <p class="text-xs text-slate-400 mt-1 max-w-md">စတိုစာရင်းများနှင့် ပစ္စည်းလက်ကျန်များကို ကြည့်ရှုရန် အောက်ပါခလုတ်များကို နှိပ်ပါခင်ဗျာ။</p>
            <div class="flex items-center gap-3 mt-4">
              <button onclick="switchTab('store')" class="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition cursor-pointer">
                <i class="fa-solid fa-boxes-stacked"></i> ကုန်ချောစတို
              </button>
              <button onclick="switchTab('yarn')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition cursor-pointer">
                <i class="fa-solid fa-scroll text-sky-300"></i> ချည်စတို (Yarn)
              </button>
            </div>
          </div>
        </div>
      `;
    }
    return;
  }

  // ==========================================================================
  // 🎯 4. MAIN BOOKS (Bank & Shop 1..5) & OTHERS (Safe Non-Crash View)
  // ==========================================================================
  const shopTitles = {
    'bank': 'Main Home Shop (ပင်မဆိုင် ငွေစာရင်း)',
    'shop1': 'ဆိုင်ခွဲ (၁) - အရောင်းနှင့် ငွေစာရင်း',
    'shop2': 'ဆိုင်ခွဲ (၂) - အရောင်းနှင့် ငွေစာရင်း',
    'shop3': 'ဆိုင်ခွဲ (၃) - အရောင်းနှင့် ငွေစာရင်း',
    'shop4': 'ဆိုင်ခွဲ (၄) - အရောင်းနှင့် ငွေစာရင်း',
    'shop5': 'ဆိုင်ခွဲ (၅) - အရောင်းနှင့် ငွေစာရင်း',
    'report-financial': 'Financial Reports (ဘဏ္ဍာရေး အစီရင်ခံစာများ)',
    'settings': 'System Settings (စနစ် ဆက်တင်များ)'
  };

  const currentTitle = shopTitles[tabId] || tabId.toUpperCase();
  if (titleEl) titleEl.textContent = currentTitle;

  if (container) {
    container.innerHTML = `
      <div style="padding-top: 10px;" class="space-y-4 animate-in fade-in duration-200">
        <div class="p-12 text-center text-slate-500 bg-[#0e172a] border border-slate-800 rounded-3xl flex flex-col items-center justify-center shadow-xl">
          <div class="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400 text-2xl mb-4">
            <i class="fa-solid fa-cash-register"></i>
          </div>
          <h3 class="text-base font-bold text-slate-200">${currentTitle}</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-md">ဤ စာရင်းဇယားအပိုင်းကို cashbook.js တည်ဆောက်ပြီးပါက ချိတ်ဆက်အသုံးပြုနိုင်မည် ဖြစ်ပါသည်။</p>
          <div class="flex items-center gap-2.5 mt-4">
            <button onclick="switchTab('store')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded-xl text-xs flex items-center gap-2 border border-slate-700 transition cursor-pointer">
              <i class="fa-solid fa-boxes-stacked"></i> ကုန်ချောစတို
            </button>
            <button onclick="switchTab('yarn')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold rounded-xl text-xs flex items-center gap-2 border border-slate-700 transition cursor-pointer">
              <i class="fa-solid fa-scroll"></i> ချည်စတို
            </button>
          </div>
        </div>
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
    btn.classList.remove('bg-indigo-600/30', 'text-white', 'font-bold', 'active');
  });

  const activeBtn = document.getElementById(`btn-${activeTabId}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-indigo-600/30', 'text-white', 'font-bold', 'active');
  }
}

/**
 * 💡 Universal Animated Refresh Button Controller
 */
document.addEventListener('click', function (e) {
  const refreshBtn = e.target.closest('button');
  if (!refreshBtn) return;

  const btnText = refreshBtn.innerText || '';
  const hasRotateIcon = refreshBtn.querySelector('.fa-rotate, .fa-arrows-rotate, .fa-sync');

  if (btnText.includes('Refresh') || hasRotateIcon) {
    const icon = refreshBtn.querySelector('i');
    if (icon) icon.classList.add('fa-spin');

    if (typeof window.clearAllApiCache === 'function') {
      window.clearAllApiCache();
    }

    setTimeout(() => {
      if (icon) icon.classList.remove('fa-spin');
    }, 800);
  }
});

// 💡 EXPOSE GLOBALLY TO WINDOW
window.initApp = initApp;
window.switchTab = switchTab;
window.updateSidebarHighlight = updateSidebarHighlight;
window.updateHeaderMetadata = updateHeaderMetadata;
