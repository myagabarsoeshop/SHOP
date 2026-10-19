/**
 * ==============================================================================
 * မြကမ္ဘာစိုး ပိုးထည်တိုက် - AUTHENTICATION & ROLE ENGINE
 * File: js/auth.js (Location: cashbook-frontend/js/auth.js)
 * 💡 Features: 🛡️ Resilient Dual-Token Architecture (Standard 'token' + 'user'),
 *              Cloudflare D1 Verified JWT Engine & Seamless RBAC Matrix,
 *              Textile Shop Branch Role Enforcement (Main & Shop 1 to 5)
 * ==============================================================================
 */

/**
 * 💡 Central Role-Based Access Control (RBAC) Permission Verifier
 * @param {string} permissionName - 'can_view' | 'can_add' | 'can_edit' | 'can_delete' | 'can_manage_settings' | 'can_backup'
 * @returns {boolean}
 */
function hasPermission(permissionName) {
  let role = 'Viewer';

  if (window.AppState && window.AppState.currentUserRole) {
    role = window.AppState.currentUserRole;
  } else {
    const userStr = localStorage.getItem('user') || localStorage.getItem('golden_user');
    if (userStr) {
      try {
        const parsed = JSON.parse(userStr);
        role = parsed.role || 'Viewer';
      } catch (e) {}
    } else {
      role = localStorage.getItem('user_role') || localStorage.getItem('golden_user_role') || 'Viewer';
    }
  }

  role = String(role).trim();

  // 💡 မြကမ္ဘာစိုး ပိုးထည်တိုက်၏ ရာထူးနှင့် ဆိုင်ခွဲအလိုက် လုပ်ပိုင်ခွင့် ဇယား (RBAC Matrix)
  const matrix = {
    'Owner':    { can_view: true, can_add: true, can_edit: true,  can_delete: true,  can_manage_settings: true,  can_backup: true },
    'Admin':    { can_view: true, can_add: true, can_edit: true,  can_delete: true,  can_manage_settings: true,  can_backup: true },
    'Finance':  { can_view: true, can_add: true, can_edit: true,  can_delete: true,  can_manage_settings: false, can_backup: true },
    'Shop1':    { can_view: true, can_add: true, can_edit: true,  can_delete: false, can_manage_settings: false, can_backup: false },
    'Shop2':    { can_view: true, can_add: true, can_edit: true,  can_delete: false, can_manage_settings: false, can_backup: false },
    'Shop3':    { can_view: true, can_add: true, can_edit: true,  can_delete: false, can_manage_settings: false, can_backup: false },
    'Shop4':    { can_view: true, can_add: true, can_edit: true,  can_delete: false, can_manage_settings: false, can_backup: false },
    'Shop5':    { can_view: true, can_add: true, can_edit: true,  can_delete: false, can_manage_settings: false, can_backup: false },
    'Staff':    { can_view: true, can_add: true, can_edit: false, can_delete: false, can_manage_settings: false, can_backup: false },
    'Viewer':   { can_view: true, can_add: false, can_edit: false, can_delete: false, can_manage_settings: false, can_backup: false }
  };

  const userPerms = matrix[role] || matrix['Viewer'];
  return !!userPerms[permissionName];
}

/**
 * 💡 Verify JWT Token or Local Session Expiration
 * @param {string} token 
 * @returns {boolean} True if expired, false if valid
 */
function isTokenExpired(token) {
  if (!token) return true;

  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      const payloadJson = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(payloadJson);

      if (payload && payload.exp) {
        const currentTime = Math.floor(Date.now() / 1000);
        return payload.exp < currentTime;
      }
    }
  } catch (err) {
    console.warn("[Auth] JWT payload parse fallback:", err.message);
  }

  const expiresAt = localStorage.getItem('token_expires_at') || localStorage.getItem('golden_token_expires_at');
  if (expiresAt) {
    return Date.now() > Number(expiresAt);
  }

  return false;
}

/**
 * 💡 Clear All Authentication State & Storage Keys (Standard + Legacy Purge)
 */
function clearAuthStorage() {
  // 💡 Standard Keys
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('user_role');
  localStorage.removeItem('user_name');
  localStorage.removeItem('token_expires_at');

  // 💡 Legacy Keys (အဟောင်းအကြွင်းအကျန်များပါ ရှင်းထုတ်ခြင်း)
  localStorage.removeItem('golden_auth_token');
  localStorage.removeItem('golden_user');
  localStorage.removeItem('golden_user_name');
  localStorage.removeItem('golden_user_role');
  localStorage.removeItem('golden_token_expires_at');

  if (window.AppState) {
    window.AppState.currentUser = null;
    window.AppState.currentUserRole = null;
    window.AppState.authToken = null;
  }
}

/**
 * 💡 Input Validation
 */
function validateLoginInput(username, password) {
  const errors = [];

  if (!username || username.trim().length === 0) {
    errors.push("အသုံးပြုသူအမည် ရွေးချယ်ပါ");
  }

  if (!password || password.trim().length === 0) {
    errors.push("လျှို့ဝှက်နံပါတ် ရိုက်ထည့်ပါ");
  } else if (password.length < 3) {
    errors.push("လျှို့ဝှက်နံပါတ် အနည်းဆုံး ၃ လုံး ရှိရပါမည်");
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * 💡 Handle Login Form Submission (Cloudflare Worker D1 Database)
 */
async function handleLoginSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const usernameSelect = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorBox = document.getElementById('login-error');

  if (!usernameSelect || !passwordInput) return;

  const username = (usernameSelect.value || '').trim();
  const password = (passwordInput.value || '').trim();

  const validation = validateLoginInput(username, password);
  if (!validation.isValid) {
    if (errorBox) {
      errorBox.innerText = validation.errors.join(' | ');
      errorBox.classList.remove('hidden');
    }
    return;
  }

  if (errorBox) errorBox.classList.add('hidden');
  if (typeof window.toggleLoading === 'function') window.toggleLoading(true);

  try {
    const response = await callApi('checkLogin', { username, password });
    if (typeof window.toggleLoading === 'function') window.toggleLoading(false);

    if (response && response.success) {
      const resUser = response.user ? (response.user.username || response.user.name) : (response.username || username);
      const resRole = response.user ? response.user.role : (response.role || username);
      const resBranch = response.user ? (response.user.branch_code || response.user.shop_id || 'main') : 'main';
      const resToken = response.token || response.authToken || 'session_token_' + Date.now();

      // AppState ထဲသို့ သတ်မှတ်ပေးခြင်း
      window.AppState = window.AppState || {};
      window.AppState.currentUser = resUser;
      window.AppState.currentUserRole = resRole;
      window.AppState.authToken = resToken;

      const defaultTtlMs = 12 * 60 * 60 * 1000; // 12 Hours Session
      const expiresAt = Date.now() + (response.expiresInMs || defaultTtlMs);

      const userObject = {
        username: resUser,
        name: resUser,
        role: resRole,
        branch_code: resBranch,
        token: resToken
      };

      const userObjStr = JSON.stringify(userObject);

      // 💡 Standard Keys (အခြားဖိုင်များ အဆင်ပြေစေရန် အဓိက သတ်မှတ်ပေးသည်)
      localStorage.setItem('token', resToken);
      localStorage.setItem('user', userObjStr);
      localStorage.setItem('user_name', resUser);
      localStorage.setItem('user_role', resRole);
      localStorage.setItem('token_expires_at', String(expiresAt));

      // 💡 Fallback Keys (လိုအပ်ပါက ရှာတွေ့နိုင်ရန် ပူးတွဲသိမ်းဆည်းပေးသည်)
      localStorage.setItem('golden_auth_token', resToken);
      localStorage.setItem('golden_user', userObjStr);
      localStorage.setItem('golden_user_name', resUser);
      localStorage.setItem('golden_user_role', resRole);
      localStorage.setItem('golden_token_expires_at', String(expiresAt));

      showWorkspace();
      applyRoleRestrictions();

      // Dashboard သို့ တိုက်ရိုက် ဦးတည်ဖွင့်လှစ်ပေးခြင်း
      if (typeof switchTab === 'function') {
        const lowerRole = resRole.toLowerCase();
        if (['shop1', 'shop2', 'shop3', 'shop4', 'shop5'].includes(lowerRole)) {
          switchTab(lowerRole);
        } else {
          switchTab('dashboard');
        }
      }

      if (typeof showToast === 'function') {
        showToast("SUCCESS", `မင်္ဂလာပါ ${resUser}၊ စနစ်အတွင်းသို့ အောင်မြင်စွာ ဝင်ရောက်ပြီးပါပြီ။`);
      }
    } else {
      if (errorBox) {
        errorBox.innerText = (response ? response.message : "") || "အသုံးပြုသူအမည် သို့မဟုတ် လျှို့ဝှက်နံပါတ် မှားယွင်းနေပါသည်။";
        errorBox.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (typeof window.toggleLoading === 'function') window.toggleLoading(false);
    if (errorBox) {
      errorBox.innerText = "ဆာဗာ ချိတ်ဆက်မှု အမှား ဖြစ်ပေါ်ခဲ့သည်: " + err.message;
      errorBox.classList.remove('hidden');
    }
  }
}

/**
 * 💡 Apply Navigation & Button Level Permissions by User Role
 */
function applyRoleRestrictions() {
  const canDelete = hasPermission('can_delete');
  if (!canDelete) {
    document.body.classList.add('hide-delete-btn');
  } else {
    document.body.classList.remove('hide-delete-btn');
  }
}

/**
 * 💡 BULLETPROOF WORKSPACE TOGGLER
 */
function showWorkspace() {
  document.documentElement.className = 'dark is-authed';

  const overlay = document.getElementById('login-overlay');
  const ws = document.getElementById('erp-workspace');

  if (overlay) {
    overlay.classList.remove('flex');
    overlay.classList.add('hidden');
    overlay.style.setProperty('display', 'none', 'important');
  }

  if (ws) {
    ws.classList.remove('hidden');
    ws.classList.add('flex');
    ws.style.setProperty('display', 'flex', 'important');
  }
}

function showLogin() {
  document.documentElement.className = 'dark not-authed';

  const overlay = document.getElementById('login-overlay');
  const ws = document.getElementById('erp-workspace');

  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    overlay.style.setProperty('display', 'flex', 'important');
  }

  if (ws) {
    ws.classList.remove('flex');
    ws.classList.add('hidden');
    ws.style.setProperty('display', 'none', 'important');
  }

  const passwordInput = document.getElementById('login-password');
  if (passwordInput) passwordInput.value = '';
}

/**
 * 💡 Handle System Logout Action
 */
function handleLogout(skipConfirm = false) {
  if (skipConfirm || confirm("မြကမ္ဘာစိုး စနစ်မှ ထွက်ခွာလိုပါသလား။")) {
    clearAuthStorage();

    if (window.clearAllApiCache) {
      window.clearAllApiCache();
    }

    showLogin();
    if (typeof showToast === 'function') {
      showToast("SUCCESS", "စနစ်မှ အောင်မြင်စွာ ထွက်ခွာပြီးပါပြီ။");
    }

    setTimeout(function() {
      window.location.reload();
    }, 250);
  }
}

/**
 * 💡 Verify Existing Session State on Page Startup
 */
function checkExistingSession() {
  const token = localStorage.getItem('token') || localStorage.getItem('golden_auth_token');
  const userStr = localStorage.getItem('user') || localStorage.getItem('golden_user');

  if (token && userStr) {
    if (isTokenExpired(token)) {
      console.warn("[Auth] Session expired. Automatically logging out.");
      clearAuthStorage();
      showLogin();
      if (typeof showToast === 'function') {
        showToast("WARNING", "လော့ဂ်အင် သက်တမ်း ကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ ပြန်လည် လော့ဂ်အင် ဝင်ပါ။");
      }
      return;
    }

    let parsedUser = { username: 'Admin', role: 'Admin' };
    try {
      parsedUser = JSON.parse(userStr);
    } catch (e) {}

    window.AppState = window.AppState || {};
    window.AppState.currentUser = parsedUser.username || parsedUser.name || 'Admin';
    window.AppState.currentUserRole = parsedUser.role || 'Admin';
    window.AppState.authToken = token;

    showWorkspace();
    applyRoleRestrictions();
  } else {
    showLogin();
  }
}

// 💡 Global Event Initialization
document.addEventListener('DOMContentLoaded', () => {
  checkExistingSession();
});

// 💡 EXPOSE GLOBALLY
window.hasPermission = hasPermission;
window.isTokenExpired = isTokenExpired;
window.clearAuthStorage = clearAuthStorage;
window.handleLoginSubmit = handleLoginSubmit;
window.handleLogout = handleLogout;
window.showWorkspace = showWorkspace;
window.showLogin = showLogin;
window.checkExistingSession = checkExistingSession;
window.applyRoleRestrictions = applyRoleRestrictions;
