// =============================================================================
// FILE: cashbook-frontend/js/core/state.js 
// GLOBAL APPLICATION STATE, RBAC PERMISSION HELPERS & STRICT BRANCH SCOPING
// Version: 4.1.0 (Fixes ALL->Branch 1 Bug, Enforces branch_manager & RBAC)
// =============================================================================

function safeParse(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        localStorage.removeItem(key);
        return null;
    }
}

export function normalizeRole(rawRole) {
    const r = String(rawRole || "cashier").trim().toLowerCase();
    if (r === "manager") return "branch_manager";
    if (["admin", "finance", "branch_manager", "cashier"].includes(r)) return r;
    return "cashier";
}

/**
 * Frontend UX Permission Matrix (Matches Backend utils.js Spec 3.2)
 */
const FRONTEND_PERMISSIONS = {
    "product.create": ["admin", "finance"],
    "product.update": ["admin", "finance"],
    "product.delete": ["admin", "finance"],
    "product.bulk_import": ["admin", "finance"],
    "product.view_cost": ["admin", "finance", "branch_manager"],

    "opening.create": ["admin", "finance", "branch_manager"],
    "opening.submit": ["admin", "finance", "branch_manager"],
    "opening.approve": ["admin", "finance"],
    "opening.reject": ["admin", "finance"],

    "adjustment.create": ["admin", "finance", "branch_manager"],
    "adjustment.submit": ["admin", "finance", "branch_manager"],
    "adjustment.approve": ["admin", "finance"],
    "adjustment.approve_high_value": ["admin"],
    "adjustment.reject": ["admin", "finance"],

    "transfer.create": ["admin", "finance", "branch_manager"],
    "transfer.dispatch": ["admin", "finance", "branch_manager"],
    "transfer.receive": ["admin", "finance", "branch_manager", "cashier"],
    "transfer.cancel": ["admin", "finance", "branch_manager"],

    "waste.create": ["admin", "finance", "branch_manager"],
    "waste.delete": ["admin", "finance", "branch_manager"],
    "yarn.issue": ["admin", "finance", "branch_manager"],

    "purchase.view": ["admin", "finance", "branch_manager"],
    "purchase.create": ["admin", "finance", "branch_manager"],
    "purchase.update": ["admin", "finance", "branch_manager"],
    "purchase.void": ["admin", "finance", "branch_manager"],
    "pos.sale": ["admin", "finance", "branch_manager", "cashier"],
    "pos.void": ["admin", "finance", "branch_manager"],
    "pos.override_price": ["admin", "finance"],

    "cashbook.write": ["admin", "finance", "branch_manager", "cashier"],
    "cashbook.delete": ["admin", "finance", "branch_manager"],
    "customer.write": ["admin", "finance", "branch_manager", "cashier"],
    "customer.edit_credit_limit": ["admin", "finance"],
    "customer.delete": ["admin", "finance"],

    "user.manage": ["admin"],
    "system.backup": ["admin"],
    "record.delete": ["admin", "finance"]
};

const initialUser = safeParse("pos_user");
if (initialUser) {
    initialUser.role = normalizeRole(initialUser.role);
}

const initialBranch = safeParse("pos_branch");

export const state = {
    user: initialUser,
    currentBranch: initialBranch,
    branches: [],
    cart: [],

    getRole() {
        return normalizeRole(this.user?.role);
    },

    can(permission) {
        if (!this.user) return false;
        const role = this.getRole();
        const allowed = FRONTEND_PERMISSIONS[permission];
        if (!allowed) return role === "admin";
        return allowed.includes(role);
    },

    setUser(userData) {
        if (userData) {
            const role = normalizeRole(userData.role);
            const assignedBranchId = Number(userData.branchId || userData.branch_id || 1);

            const normalizedUser = {
                ...userData,
                id: Number(userData.id || 1),
                username: userData.username,
                fullName: userData.fullName || userData.full_name || userData.name || userData.username,
                role,
                branchId: assignedBranchId,
                branch_id: assignedBranchId,
                branchCode: userData.branchCode || userData.branch_code || "MAIN",
                branchName: userData.branchName || userData.branch_name || "Main Home Shop (အိမ်ဆိုင်/စက်ရုံ)"
            };

            this.user = normalizedUser;
            localStorage.setItem("pos_user", JSON.stringify(normalizedUser));

            this.setBranch({
                id: normalizedUser.branchId,
                code: normalizedUser.branchCode,
                name: normalizedUser.branchName
            });
        } else {
            this.user = null;
            this.currentBranch = null;
            this.branches = [];
            this.cart = [];
            localStorage.removeItem("pos_user");
            localStorage.removeItem("pos_branch");
            localStorage.removeItem("pos_branch_id");
            localStorage.removeItem("pos_token");
        }
    },

    /**
     * ဆိုင်ခွဲ သတ်မှတ်ခြင်း (Spec 4.1 & 4.2)
     * - Admin နှင့် Finance သာ "ALL" သို့မဟုတ် အခြားဆိုင်ခွဲကို ရွေးနိုင်သည်။
     * - Branch Manager နှင့် Cashier သည် မိမိဆိုင်ခွဲ (user.branchId) ကိုသာ အမြဲသုံးရမည်။
     * - "ALL" ကို Number("ALL") -> 1 သို့ မှားယွင်းပြောင်းလဲခြင်း လုံးဝ မပြုလုပ်တော့ပါ။
     */
    setBranch(branchData) {
        if (!branchData) return;

        const role = this.getRole();
        const canSelectAny = role === "admin" || role === "finance";
        const rawId = branchData.id ?? branchData.branch_id;
        const isAll = String(rawId || "").trim().toUpperCase() === "ALL";

        if (!canSelectAny && this.user?.branchId) {
            const lockedId = Number(this.user.branchId);
            this.currentBranch = {
                id: lockedId,
                code: this.user.branchCode || branchData.code || "MAIN",
                name: this.user.branchName || branchData.name || "Assigned Branch"
            };
        } else if (isAll && canSelectAny) {
            this.currentBranch = {
                id: "ALL",
                code: "ALL",
                name: "ဆိုင်ခွဲအားလုံး (ALL - Read Only)"
            };
        } else {
            const parsedId = Number(rawId);
            const validId = Number.isInteger(parsedId) && parsedId > 0
                ? parsedId
                : Number(this.user?.branchId || 1);
            this.currentBranch = {
                id: validId,
                code: branchData.code || branchData.branch_code || `B${validId}`,
                name: branchData.name || branchData.branch_name || `Branch #${validId}`
            };
        }

        localStorage.setItem("pos_branch", JSON.stringify(this.currentBranch));
        localStorage.setItem("pos_branch_id", String(this.currentBranch.id));
    },

    /**
     * လက်ရှိ ALL View (ဆိုင်ခွဲအားလုံး Read-Only) ရွေးထားခြင်း ဟုတ်/မဟုတ် စစ်ဆေးခြင်း
     */
    isAllBranches() {
        return String(this.currentBranch?.id || "").toUpperCase() === "ALL";
    },

    /**
     * Read API များအတွက် branch_id ယူခြင်း ("ALL" သို့မဟုတ် Numeric ID ပြန်ပေးသည်)
     */
    getBranchId() {
        const role = this.getRole();
        if (role === "branch_manager" || role === "cashier") {
            return Number(this.user?.branchId || 1);
        }
        if (this.isAllBranches()) {
            return "ALL";
        }
        return Number(this.currentBranch?.id || this.user?.branchId || 1);
    },

    /**
     * Write API များအတွက် branch_id ယူခြင်း (Spec 4.1 & 4.2)
     * - ALL View ဖြစ်နေပါက ဆိုင် (၁) သို့ အလိုအလျောက် မပြောင်းဘဲ Error ပြန်ပေးပါသည်။
     */
    requireWriteBranchId() {
        const role = this.getRole();
        if (role === "branch_manager" || role === "cashier") {
            return Number(this.user?.branchId || 1);
        }
        if (this.isAllBranches()) {
            throw new Error("ဆိုင်ခွဲအားလုံး (ALL View) မှ စာရင်းအသစ်သွင်းခြင်း သို့မဟုတ် ပြင်ဆင်ခြင်း ပြုလုပ်၍ မရပါ။ အပေါ်ညာဘက်တွင် ဆိုင်ခွဲတစ်ခုကို တိကျစွာ ရွေးချယ်ပေးပါ။");
        }
        const bId = Number(this.currentBranch?.id);
        if (!Number.isInteger(bId) || bId <= 0) {
            throw new Error("ဆိုင်ခွဲ (Branch) တစ်ခုကို အရင်ရွေးချယ်ပေးပါ။");
        }
        return bId;
    },

    isLoggedIn() {
        const token = localStorage.getItem("pos_token");
        return !!(this.user && this.user.username && token);
    },

    /**
     * System Owner Admin တစ်ဦးတည်းသာ (User စီမံခြင်း၊ Backup)
     */
    isOwnerAdmin() {
        return this.getRole() === "admin";
    },

    /**
     * Admin သို့မဟုတ် Finance (ဆိုင်ခွဲအားလုံး ကြည့်ခွင့်၊ Product Master စီမံခွင့်၊ Opening/Adjustment Approve လုပ်ခွင့်)
     */
    isAdmin() {
        const role = this.getRole();
        return role === "admin" || role === "finance";
    },

    canSwitchBranch() {
        return this.isAdmin();
    },

    canManageCatalog() {
        return this.can("product.create");
    },

    canViewCost() {
        return this.can("product.view_cost");
    },

    canApproveStock() {
        return this.can("opening.approve");
    },

    isBranchManager() {
        return this.getRole() === "branch_manager";
    },

    isCashier() {
        return this.getRole() === "cashier";
    },

    logout() {
        this.setUser(null);
        window.location.reload();
    }
};
