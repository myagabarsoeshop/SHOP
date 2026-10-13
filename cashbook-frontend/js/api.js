/** 
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CENTRAL API BRIDGE & OFFLINE INTERCEPTOR (D1 DATABASE EDITION)
 * File: js/api.js (Location: shop-frontend/js/api.js)
 * 💡 Features: 🛡️ Quota-Safe In-Memory & LocalStorage Cache (Zero QuotaExceededError),
 *              Offline-First Network Interceptor & Background Outbox Auto-Routing,
 *              Clean 401 Session Revocation & Complete Storage Purge,
 *              Pre-fetched 'staff' & Core Views for 0ms Instant Navigation,
 *              Universal CSV Formula Injection Sanitizer (window.safeCsvCell),
 *              Resilient DOM & Inline Event Escapers (escapeHtml & escapeJsAttr),
 *              🎯 Refactored: Added Global Formatters & Parsers to eliminate Duplication
 * ==============================================================================
 */

// 💡 Corrected Worker URL matching Cloudflare Service Name (cashbook-app-api)
const API_WORKER_URL = (typeof window !== 'undefined' && window.CONFIG?.API_URL) 
  ? window.CONFIG.API_URL 
  : "https://shop.myagabarsoeshop.workers.dev/";

// 💡 Global AppState
window.AppState = window.AppState || {
  currentUser: localStorage.getItem('golden_user_name') || null,
  currentUserRole: localStorage.getItem('golden_user_role') || null,
  authToken: localStorage.getItem('golden_auth_token') || null,
  currentModule: 'dashboard'
};

// 💡 Global In-Memory Cache Store for 0ms Instant Navigation (Always Fast & Unlimited)
window.gDataCache = window.gDataCache || {};

// ==============================================================================
// 💡 1. GLOBAL ESCAPERS & SANITIZATION UTILITIES
// ==============================================================================

/**
 * 💡 Central Safe Native DOM HTML Escaper
 */
window.escapeHtml = function(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * 💡 Safe escaper for values injected into inline onclick="...('VALUE')" handlers.
 * Prevents quote breaking, bracket collision and XSS vulnerabilities in DOM tables.
 */
window.escapeJsAttr = function(str) {
  if (str === null || str === undefined) return "";
  const jsEscaped = String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;');
  return window.escapeHtml(jsEscaped);
};

/**
 * 🛡️ UNIVERSAL SAFE CSV CELL GENERATOR (Prevents Excel/Sheets Formula Injection)
 */
window.safeCsvCell = function(val) {
  if (val === null || val === undefined) return '""';
  if (typeof val === 'number') return isNaN(val) ? '0' : String(val);

  let str = String(val).trim();
  if (str === '') return '""';

  // Pure numbers (including decimals, commas and accounting parentheses)
  let cleanNumStr = str.replace(/,/g, '');
  if (cleanNumStr.startsWith('(') && cleanNumStr.endsWith(')')) {
    cleanNumStr = '-' + cleanNumStr.slice(1, -1).trim();
  }
  if (!isNaN(Number(cleanNumStr)) && cleanNumStr !== '') {
    return `"${str.replace(/"/g, '""')}"`;
  }

  // Formula trigger character များ (=, +, -, @, \t, \r) ဖြင့် စတင်နေပါက Leading Single Quote ထည့်သွင်းခြင်း
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

  return `"${str.replace(/"/g, '""')}"`;
};

// ==============================================================================
// 💡 2. GLOBAL FORMATTERS, PARSERS & BUSINESS LOGIC (Added to eliminate duplication)
// ==============================================================================

window.parseCleanNum = function(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var str = String(val).replace(/,/g, '').trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

window.parseCleanIntId = function(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  var n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
};

window.getCurrentAcademicYear = function(dateInput) {
  var d = dateInput ? new Date(dateInput) : new Date(Date.now() + (6.5 * 3600 * 1000));
  var validDate = isNaN(d.getTime()) ? new Date() : d;
  var y = validDate.getFullYear();
  if (validDate.getMonth() < 2) y -= 1; 
  return `${y}-${y + 1}`;
};

window.getFyShortCode = function(fyStr) {
  if (fyStr) {
    var clean = String(fyStr).replace(/^FY\s*/i, '').trim();
    var parts = clean.split(/[-/]/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      return parts[0].trim().slice(-2) + parts[1].trim().slice(-2);
    }
    if (/^\d{4}$/.test(clean)) return clean;
  }
  var currentFy = window.getCurrentAcademicYear();
  var p = currentFy.split('-');
  return p[0].slice(-2) + p[1].slice(-2);
};

window.sanitizeFyidStr = function(fyidStr) {
  var s = String(fyidStr || '').trim();
  if (!s) return s;
  if (s.indexOf('.0') === -1) return s;
  var cleaned = s.replace(/\.0/g, '');
  var parts = cleaned.split('-STU-');
  if (parts.length === 2) {
    var numPart = parseInt(parts[1], 10) || 0;
    return parts[0] + '-STU-' + String(numPart).padStart(4, '0');
  }
  return cleaned;
};

window.autoDetectGender = function(nameStr) {
  if (!nameStr) return 'Male';
  const clean = String(nameStr).trim();
  if (
    clean.startsWith('ဆရာမ') || clean.startsWith('တီချာ') || clean.startsWith('ဒေါ်') ||
    clean.startsWith('မေ') || clean.startsWith('နန်း') || clean.startsWith('နော်') ||
    clean.startsWith('ခင်') || clean.startsWith('နှင်း') || clean.startsWith('နွယ်') ||
    /^(May|Daw|Nang|Naw|Khin|Hnin|Nwe|Miss|Mrs|Teacher|Sayama)\b/i.test(clean)
  ) return 'Female';

  if ((clean.startsWith('မ') && !clean.startsWith('မောင်') && !clean.startsWith('မင်း')) || /^(Ma)\b/i.test(clean)) {
    return 'Female';
  }
  return 'Male';
};

// ==============================================================================
// 💡 3. QUOTA-SAFE CACHE ENGINE (Zero QuotaExceededError Crash)
// ==============================================================================

window.getApiCache = function(cacheKey) {
  // 1. Check Fast In-Memory Cache first (0ms)
  if (window.gDataCache[cacheKey]) {
    return window.gDataCache[cacheKey];
  }
  
  // 2. Fallback to localStorage cache for small persistent data
  try {
    const persistedCache = localStorage.getItem('api_cache_' + cacheKey);
    if (persistedCache) {
      const parsed = JSON.parse(persistedCache);
      const cacheAge = Date.now() - (parsed.timestamp || 0);
      if (cacheAge < 24 * 60 * 60 * 1000) {
        window.gDataCache[cacheKey] = parsed.data;
        return parsed.data;
      } else {
        localStorage.removeItem('api_cache_' + cacheKey);
      }
    }
  } catch (e) {
    console.warn('[Cache] Failed to read localStorage cache:', e);
  }
  
  return null;
};

window.setApiCache = function(cacheKey, data) {
  if (data && data.success) {
    // In-memory cache တွင် အမြဲသိမ်းဆည်းသည် (Storage Quota မရှိပါ)
    window.gDataCache[cacheKey] = data;

    // ⚡ FIX: 80KB ထက်ကြီးသော Data (ကျောင်းသား ၅,၀၀၀၊ Cashier ၂,၀၀၀) များကို localStorage ထဲ မထည့်ဘဲ
    // Browser ၏ 5MB Quota ပြည့်ကာ App Crash ဖြစ်သွားခြင်းကို ၁၀၀% ကာကွယ်သည်
    try {
      const serialized = JSON.stringify({ timestamp: Date.now(), data: data });
      if (serialized.length < 80000) {
        localStorage.setItem('api_cache_' + cacheKey, serialized);
      }
    } catch (e) {
      console.warn('[Cache Quota Protection] Memory cache only for large dataset.');
    }
  }
};

window.clearAllApiCache = function() {
  window.gDataCache = {};
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('api_cache_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('[Cache] Failed to clear localStorage cache:', e);
  }
};

window.invalidateApiCache = function(actionPrefix = '') {
  if (!actionPrefix) {
    window.clearAllApiCache();
    return;
  }
  
  const prefixLower = actionPrefix.toLowerCase();
  Object.keys(window.gDataCache).forEach(key => {
    if (key.toLowerCase().includes(prefixLower)) {
      delete window.gDataCache[key];
    }
  });
  
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('api_cache_') && key.toLowerCase().includes(prefixLower)) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('[Cache] Failed to invalidate localStorage cache:', e);
  }
};

// ==============================================================================
// 💡 4. SAFE ERROR LOGGING SYSTEM (Memory & Quota Protected)
// ==============================================================================

window.ErrorLogger = {
  maxLogs: 20, // ⚡ Cap at 20 logs to prevent localStorage bloat
  
  logError: function(context, error, additionalInfo = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      context: context,
      errorMessage: String(error?.message || error || '').slice(0, 300),
      errorStack: error?.stack ? String(error.stack).slice(0, 500) : null,
      additionalInfo: additionalInfo,
      url: window.location.href
    };
    
    let logs = [];
    try {
      const storedLogs = localStorage.getItem('error_logs');
      if (storedLogs) logs = JSON.parse(storedLogs);
    } catch (e) {
      logs = [];
    }
    
    logs.unshift(errorEntry);
    if (logs.length > this.maxLogs) {
      logs = logs.slice(0, this.maxLogs);
    }
    
    try {
      localStorage.setItem('error_logs', JSON.stringify(logs));
    } catch (e) {
      // If quota exceeded, purge old logs
      localStorage.removeItem('error_logs');
    }
    
    console.error(`[ErrorLogger] ${context}:`, error, additionalInfo);
  },
  
  getLogs: function() {
    try {
      const storedLogs = localStorage.getItem('error_logs');
      return storedLogs ? JSON.parse(storedLogs) : [];
    } catch (e) {
      return [];
    }
  },
  
  clearLogs: function() {
    localStorage.removeItem('error_logs');
  }
};

function getFreshAuthToken() {
  const token = localStorage.getItem('golden_auth_token') || (window.AppState ? window.AppState.authToken : null) || '';
  if (window.AppState) window.AppState.authToken = token;
  return token;
}

window.toggleLoading = function(show) {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    if (show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
  }
};

// ==============================================================================
// 💡 5. CENTRAL D1 API FETCH ENGINE WITH OFFLINE INTERCEPTOR
// ==============================================================================

window.callApi = async function(action, payload = {}, method = 'POST') {
  let serverPayload = {};
  let url = API_WORKER_URL;

  const isReadAction = action.startsWith('get') || action.startsWith('check') || action.startsWith('lookup');
  
  // ⚡ FIX: 'export' နှင့် 'send' သည် Database မပြောင်းလဲသဖြင့် Cache အားလုံးကို မဖျက်စေဘဲ အမှန်တကယ် Mutation များသာ စာရင်းဖျက်စေသည်
  const isActualMutation = action.startsWith('save') || 
                           action.startsWith('update') || 
                           action.startsWith('delete') || 
                           action.startsWith('recalculate');

  const forceRefresh = payload.forceRefresh === true;
  const { forceRefresh: _, ...extractedPayload } = payload;
  serverPayload = extractedPayload;

  const cacheKey = `${action}_${JSON.stringify(serverPayload)}`;

  // 1. FAST OFFLINE CHECK FOR WRITES: If strictly offline, enqueue immediately
  if (isActualMutation && !navigator.onLine && window.OfflineSync) {
    console.warn(`[OfflineSync] Offline detected. Enqueueing ${action} immediately...`);
    await window.OfflineSync.enqueue(action, serverPayload, method);
    window.clearAllApiCache();
    window.showToast("SUCCESS", "📶 အင်တာနက်လိုင်း မရှိသေးသဖြင့် စက်ထဲတွင် ယာယီသိမ်းထားပါသည် (Offline Queue)။ လိုင်းရသည်နှင့် အလိုအလျောက် ပို့ပေးပါမည်။");
    return {
      success: true,
      isOfflineQueued: true,
      message: "စာရင်းအား စက်ထဲတွင် ယာယီသိမ်းဆည်းထားပါသည် (Offline Queue)"
    };
  }

  try {
    const currentToken = getFreshAuthToken();
    const currentRole = localStorage.getItem('golden_user_role') || (window.AppState ? window.AppState.currentUserRole : '') || '';

    if (isReadAction && !forceRefresh) {
      const cachedRes = window.getApiCache(cacheKey);
      if (cachedRes) {
        return cachedRes;
      }
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const options = { method: method, headers: headers };

    if (method === 'GET') {
      const params = new URLSearchParams({
        action: action,
        token: currentToken,
        role: currentRole,
        ...serverPayload
      });
      url += `?${params.toString()}`;
    } else {
      options.body = JSON.stringify({
        action: action,
        token: currentToken,
        authToken: currentToken,
        role: currentRole,
        ...serverPayload
      });
    }

    const response = await fetch(url, options);

    // ⚡ FIX: 401 Session Expiry Cleanup (Auth Keys ၅ ခုစလုံးကို အပြီးတိုင် ရှင်းလင်းသည်)
    if (response.status === 401) {
      console.warn(`[API 401] Unauthorized access for action: ${action}`);

      if (typeof window.clearAuthStorage === 'function') {
        window.clearAuthStorage();
      } else {
        localStorage.removeItem('golden_auth_token');
        localStorage.removeItem('golden_user_name');
        localStorage.removeItem('golden_user_role');
        localStorage.removeItem('golden_user');
        localStorage.removeItem('golden_token_expires_at');
      }

      if (window.AppState) {
        window.AppState.authToken = null;
        window.AppState.currentUser = null;
        window.AppState.currentUserRole = null;
      }

      window.clearAllApiCache();
      document.documentElement.className = 'dark not-authed';

      const loginErrBox = document.getElementById('login-error');
      if (loginErrBox) {
        loginErrBox.textContent = "Session သက်တမ်း ကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ ပြန်လည် Login ဝင်ရောက်ပါ။";
        loginErrBox.classList.remove('hidden');
      }

      throw new Error("HTTP Error: 401 (Session Expired)");
    }

    if (!response.ok) {
      let serverMessage = '';
      try {
        const errData = await response.clone().json();
        serverMessage = errData && (errData.detail || errData.message) ? (errData.detail || errData.message) : '';
      } catch (parseErr) {}
      throw new Error(`HTTP Error: ${response.status}${serverMessage ? ` - ${serverMessage}` : ''}`);
    }

    const result = await response.json();

    if (isReadAction && result && result.success) {
      window.setApiCache(cacheKey, result);
    }

    // စာရင်းအမှန်တကယ် ပြောင်းလဲသွားမှသာ Cache များကို ဖျက်ဆီးသည်
    if (isActualMutation && result && result.success) {
      window.clearAllApiCache();
    }

    return result;

  } catch (err) {
    const isNetworkErr = !navigator.onLine || 
                         err.name === 'TypeError' ||
                         (err.message && (
                           err.message.includes('Failed to fetch') ||
                           err.message.includes('NetworkError') ||
                           err.message.includes('Load failed') ||
                           err.message.includes('network')
                         ));

    // Offline Write Interceptor
    if (isActualMutation && isNetworkErr && window.OfflineSync) {
      console.warn(`[OfflineSync Interceptor] Network error during ${action}. Diverting to IndexedDB Outbox...`);
      await window.OfflineSync.enqueue(action, serverPayload, method);
      window.clearAllApiCache();
      
      window.showToast("SUCCESS", "📶 အင်တာနက်လိုင်း နှေးကွေး/ပြတ်တောက်နေသဖြင့် စက်ထဲတွင် ယာယီသိမ်းထားပါသည် (Offline Mode)။ လိုင်းရသည်နှင့် အလိုအလျောက် ပို့ပေးပါမည်။");

      return {
        success: true,
        isOfflineQueued: true,
        message: "စာရင်းအား စက်ထဲတွင် ယာယီသိမ်းဆည်းထားပါသည် (Offline Queue)"
      };
    }

    // Offline Read Fallback to Cache
    if (isReadAction && isNetworkErr) {
      const staleCache = window.getApiCache(cacheKey);
      if (staleCache) {
        return staleCache;
      }
    }

    if (window.ErrorLogger) {
      window.ErrorLogger.logError(`API_CALL_${action}`, err, {
        action: action,
        payload: serverPayload,
        method: method
      });
    }

    console.error(`API Error [${action}]:`, err);

    if (!err.message || !err.message.includes("401")) {
      window.showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု မအောင်မြင်ပါ: " + err.message);
    }

    throw err;
  }
};

// ==============================================================================
// 💡 6. BACKGROUND PREFETCHING ENGINE (Phase 1.2 Syntax Fix Applied)
// ==============================================================================

/**
 * 💡 Light-Weight Background Prefetching Engine
 * ⚡ FIX: Syntax error ဖြစ်စေသော trailing code ပိုများကို ဖယ်ရှားပြီး သန့်ရှင်းစွာ ပိတ်ထားသည်
 */
window.prefetchCoreModules = function() {
  window.viewCache = window.viewCache || {};
  
  // HTML Template များကိုသာ ကြိုတင်ဆွဲထားမည် (Network Data များကို အတင်းမဆွဲတော့ပါ)
  const views = [
    'dashboard', 'bank-cash', 'income', 'office-kit', 'hr', 'staff',
    'cashier', 'student', 'student-money', 'uniform', 'promotion', 'reports',
    'settings'
  ];

  views.forEach(v => {
    if (!window.viewCache[v]) {
      fetch(`views/${v}.html`)
        .then(r => r.ok ? r.text() : '')
        .then(html => { if (html) window.viewCache[v] = html; })
        .catch(() => {});
    }
  });
};

window.showToast = function(type, message) {
  if (document.documentElement.classList.contains('not-authed') && type === 'ERROR') {
    return;
  }

  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;

  let msg = String(message || "").trim();
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    msg = "⚠️ အင်တာနက်လိုင်း နှေးကွေး/ပြတ်တောက်နေသဖြင့် ဆာဗာသို့ ချိတ်ဆက်၍ မရပါ။";
  }

  const toast = document.createElement('div');
  toast.className = `p-4 rounded-xl shadow-2xl flex items-center gap-3 text-xs font-bold transition-all transform translate-y-5 opacity-0 duration-300 pointer-events-auto bg-slate-900 border ${
    type === 'SUCCESS' ? 'border-emerald-500 text-emerald-400' : 'border-rose-500 text-rose-400'
  }`;

  const icon = type === 'SUCCESS' ? '<i class="fa-solid fa-circle-check text-base"></i>' : '<i class="fa-solid fa-circle-exclamation text-base"></i>';
  toast.innerHTML = `${icon} <span>${window.escapeHtml(msg)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => { toast.classList.remove('translate-y-5', 'opacity-0'); }, 10);
  setTimeout(() => {
    toast.classList.add('translate-y-5', 'opacity-0');
    setTimeout(() => { toast.remove(); }, 300);
  }, 4000);
};

window.cleanNumber = function(val) {
  if (val === undefined || val === null || val === "") return 0;
  var strVal = String(val).trim();
  var isNegative = (strVal.includes("(") && strVal.includes(")")) || strVal.indexOf("-") === 0;
  var cleaned = strVal.replace(/[^0-9.]/g, "");
  var num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNegative ? -num : num;
};

/**
 * 💡 Resilient Calendar Date Parser (ISO DateTime & Standard String Support)
 */
window.parseIsoDate = function(dStr) {
  if (!dStr) return null;
  var str = String(dStr).split('T')[0].trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
    var parts = str.split(/[-/]/);
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(str)) {
    var parts2 = str.split(/[-/]/);
    return new Date(parseInt(parts2[2], 10), parseInt(parts2[1], 10) - 1, parseInt(parts2[0], 10));
  }
  var d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

window.isDateInRange = function(rowDateStr, fromDateStr, toDateStr) {
  if (!fromDateStr && !toDateStr) return true;
  if (!rowDateStr) return false;

  var rowDate = window.parseIsoDate(rowDateStr);
  if (!rowDate) return true;

  if (fromDateStr) {
    var fromDate = new Date(fromDateStr + 'T00:00:00');
    if (rowDate < fromDate) return false;
  }
  if (toDateStr) {
    var toDate = new Date(toDateStr + 'T23:59:59');
    if (rowDate > toDate) return false;
  }
  return true;
};
