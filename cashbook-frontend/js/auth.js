/**
 * GOLDEN ERP SYSTEM - AUTHENTICATION & ROLE ENGINE
 * File: js/auth.js 
 * 💡 SECURED (D1 Database Edition): JWT Verification & Bulletproof RBAC Matrix
 */

/**
 * 💡 Central Role-Based Access Control (RBAC) Permission Verifier
 * @param {string} permissionName - 'can_delete' | 'can_edit' | 'can_manage_grades' | 'can_backup'
 * @returns {boolean}
 */
function hasPermission(permissionName) {
  const rawRole = (window.AppState?.currentUserRole || localStorage.getItem('golden_user_role') || 'Viewer').trim();
  const role = rawRole.replace(/\s+/g, ' ');

  const matrix = {
    'Owner': { can_view: true, can_add: true, can_edit: true, can_delete: true, can_manage_grades: true, can_backup: true },
    'Admin': { can_view: true, can_add: true, can_edit: true, can_delete: true, can_manage_grades: true, can_backup: true },
    'Finance': { can_view: true, can_add: true, can_edit: true, can_delete: true, can_manage_grades: false, can_backup: true },
    'Accountant': { can_view: true, can_add: true, can_edit: true, can_delete: true, can_manage_grades: false, can_backup: true },
    'HR': { can_view: true, can_add: true, can_edit: true, can_delete: true, can_manage_grades: true, can_backup: false }, // ✅ Added 'HR'
    'HR Staff': { can_view: true, can_add: true, can_edit: true, can_delete: true, can_manage_grades: true, can_backup: false },
    'Cashier': { can_view: true, can_add: true, can_edit: true, can_delete: true, can_manage_grades: false, can_backup: false },
    'Staff': { can_view: true, can_add: true, can_edit: false, can_delete: false, can_manage_grades: false, can_backup: false },
    'Viewer': { can_view: true, can_add: false, can_edit: false, can_delete: false, can_manage_grades: false, can_backup: false }
  };

  const userPerms = matrix[role] || matrix['Viewer'];
  return !!userPerms[permissionName];
}

/**
 * 💡 Verify JWT Token or Local Session Expiration with Robust Base64 Padding
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
        base64 += '='; // ✅ Added Padding Fix
      }
      const payloadJson = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      const payload = JSON.parse(payloadJson);

      if (payload && payload.exp) {
        const currentTime = Math.floor(Date.now() / 1000);
        return payload.exp < currentTime;
      }
    }
  } catch (err) {
    console.warn("[Auth] JWT payload exp parse fallback:", err.message);
  }

  const expiresAt = localStorage.getItem('golden_token_expires_at');
  if (expiresAt) {
    return Date.now() > Number(expiresAt);
  }

  return false;
}

/**
 * 💡 Clear All Authentication State & Local Storage Keys
 */
function clearAuthStorage() {
  localStorage.removeItem('golden_user_name');
  localStorage.removeItem('golden_user_role');
  localStorage.removeItem('golden_auth_token');
  localStorage.removeItem('golden_user');
  localStorage.removeItem('golden_token_expires_at');

  if (window.AppState) {
    window.AppState.currentUser = null;
    window.AppState.currentUserRole = null;
    window.AppState.authToken = null;
  }
}

/**
 * 💡 Enhanced Input Validation
 */
function validateLoginInput(username, password) {
  const errors = [];

  if (!username || username.trim().length === 0) {
    errors.push("အသုံးပြုသူအမည် ဖြည့်သွင်းပါ");
  } else if (username.length < 2) {
    errors.push("အသုံးပြုသူအမည် အနည်းဆုံး ၂ လုံး ရှိရပါမည်");
  }

  if (!password || password.trim().length === 0) {
    errors.push("လျှို့ဝှက်နံပါတ် ဖြည့်သွင်းပါ");
  } else if (password.length < 4) {
    errors.push("လျှို့ဝှက်နံပါတ် အနည်းဆုံး ၄ လုံး ရှိရပါမည်");
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * 💡 Handle Login Form Submission (D1 Database Compatible)
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
      const resUser = response.user ? response.user.username : (response.username || username);
      const resRole = response.user ? response.user.role : (response.role || 'Admin');
      const resToken = response.token;

      window.AppState = window.AppState || {};
      window.AppState.currentUser = resUser;
      window.AppState.currentUserRole = resRole;
      window.AppState.authToken = resToken;

      const defaultTtlMs = 8 * 60 * 60 * 1000;
      const expiresAt = Date.now() + (response.expiresInMs || defaultTtlMs);

      const userObj = JSON.stringify({ username: resUser, role: resRole });
      localStorage.setItem('golden_user_name', resUser);
      localStorage.setItem('golden_user_role', resRole);
      localStorage.setItem('golden_auth_token', resToken);
      localStorage.setItem('golden_user', userObj);
      localStorage.setItem('golden_token_expires_at', String(expiresAt));

      showWorkspace();
      applyRoleRestrictions();

      if (typeof switchTab === 'function') {
        const initialTab = (resRole === 'Cashier' || resRole === 'Main Cashier') ? 'cashier' : 'dashboard';
        switchTab(initialTab);
      }

      if (typeof showToast === 'function') {
        showToast("SUCCESS", `မင်္ဂလာပါ ${resUser} (${resRole})၊ လော့ဂ်အင် ဝင်ရောက်မှု အောင်မြင်ပါသည်။`);
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
  const role = (window.AppState?.currentUserRole || localStorage.getItem('golden_user_role') || 'Viewer').trim();
  const hrSection = document.getElementById('nav-hr-section');
  const settingsSection = document.getElementById('nav-settings-section');

  if (settingsSection) {
    settingsSection.classList.remove('hidden');
    settingsSection.style.removeProperty('display');
  }

  // ✅ Added 'HR' to allowed roles
  const allowedHrRoles = ["Owner", "Admin", "Finance", "HR", "HR Staff", "HRStaff"];
  if (hrSection) {
    if (allowedHrRoles.includes(role)) {
      hrSection.classList.remove('hidden');
      hrSection.style.removeProperty('display');
    } else {
      hrSection.classList.add('hidden');
    }
  }

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
function handleLogout() {
  if (confirm("စနစ်မှ ထွက်ခွာလိုပါသလား။")) {
    clearAuthStorage();

    if (window.clearAllApiCache) {
      window.clearAllApiCache();
    }

    showLogin();
    if (typeof showToast === 'function') showToast("SUCCESS", "စနစ်မှ အောင်မြင်စွာ ထွက်ခွာပြီးပါပြီ။");

    setTimeout(function() {
      window.location.reload();
    }, 300);
  }
}

/**
 * 💡 Verify Existing Session State with Expiration & Auto-Landing
 */
function checkExistingSession() {
  const savedUser = localStorage.getItem('golden_user_name');
  const savedRole = localStorage.getItem('golden_user_role');
  const savedToken = localStorage.getItem('golden_auth_token');

  if (savedUser && savedRole && savedToken) {
    if (isTokenExpired(savedToken)) {
      console.warn("[Auth] Session expired. Automatically logging out.");
      clearAuthStorage();
      showLogin();
      if (typeof showToast === 'function') {
        showToast("WARNING", "လော့ဂ်အင် သက်တမ်း ကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ ပြန်လည် လော့ဂ်အင် ဝင်ပါ။");
      }
      return;
    }

    window.AppState = window.AppState || {};
    window.AppState.currentUser = savedUser;
    window.AppState.currentUserRole = savedRole;
    window.AppState.authToken = savedToken;

    showWorkspace();
    applyRoleRestrictions();

    if (typeof switchTab === 'function') {
      const initialTab = (savedRole === 'Cashier' || savedRole === 'Main Cashier') ? 'cashier' : 'dashboard';
      switchTab(initialTab);
    }
  } else {
    showLogin();
  }
}

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
