/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - PERMISSION & RBAC MIDDLEWARE
 * File: cashbook-api/permission.js
 * ==============================================================================
 */

export function checkPermission(user, action, entryData = {}) {
  if (!user) {
    return { allowed: false, message: "Authentication (Token) မရှိပါ။ ကျေးဇူးပြု၍ Login ပြန်ဝင်ပါ။" };
  }

  const role = String(user.role || "viewer").toLowerCase();
  const userBranch = String(user.branch_code || "").trim().toLowerCase();

  // 1. ADMIN ROLE: Full Access Everywhere (Anytime)
  if (role === "admin") {
    return { allowed: true };
  }

  // 2. FINANCE ROLE: Can view all shops. Edit/Delete restricted to TODAY only.
  if (role === "finance") {
    if (action === "edit" || action === "delete") {
      const txDate = String(entryData.tx_date || "").trim();
      const today = new Date().toISOString().slice(0, 10);
      if (txDate !== today) {
        return { 
          allowed: false, 
          message: "Finance အနေဖြင့် ယနေ့ရက်စွဲ (Today) စာရင်းများကိုသာ ပြင်ဆင်/ဖျက်ဆီးခွင့်ရှိပါသည်။ ရက်လွန်စာရင်းများအတွက် Admin သို့ ချဉ်းကပ်ပါ။" 
        };
      }
    }
    return { allowed: true };
  }

  // 3. STAFF / VIEWER ROLE: No Edit/Delete rights at all
  if (action === "edit" || action === "delete") {
    return { allowed: false, message: "Staff နှင့် Viewer များတွင် စာရင်းပြင်ဆင်/ဖျက်ဆီးခွင့် မရှိပါ။" };
  }

  // 4. BRANCH SCOPING CHECK FOR STAFF/VIEWER
  if (entryData.shop_id && userBranch && userBranch !== "main") {
    if (String(entryData.shop_id).toLowerCase() !== userBranch) {
      return { allowed: false, message: "သင့်အကောင့်ရှိ ဆိုင်ခွဲနှင့် မကိုက်ညီသော ဆိုင်စာရင်းကို လုပ်ဆောင်ခွင့်မရှိပါ။" };
    }
  }

  return { allowed: true };
}

export function filterShopQuery(user, requestedShopId) {
  const role = String(user.role || "viewer").toLowerCase();
  const userBranch = String(user.branch_code || "").trim().toLowerCase();

  // Admin and Finance can access any shop globally
  if (role === "admin" || role === "finance" || userBranch === "main") {
    return requestedShopId || "main";
  }

  // Staff/Viewer are strictly restricted to their assigned branch
  return userBranch || "shop1";
}
