// cashbook-frontend/js/core/state.js

function safeParse(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        localStorage.removeItem(key);
        return null;
    }
}

export const state = {
    user: safeParse("pos_user"),
    currentBranch: safeParse("pos_branch"),
    cart: [],

    setUser(userData) {
        if (userData) {
            const normalizedUser = {
                ...userData,
                id: Number(userData.id || 1),
                username: userData.username,
                fullName: userData.fullName || userData.full_name || userData.name || userData.username,
                role: String(userData.role || "cashier").toLowerCase(),
                branchId: Number(userData.branchId || userData.branch_id || 1),
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
            localStorage.removeItem("pos_user");
            localStorage.removeItem("pos_branch");
            localStorage.removeItem("pos_token");
        }
    },

    setBranch(branchData) {
        if (branchData) {
            this.currentBranch = {
                id: Number(branchData.id || 1),
                code: branchData.code || branchData.branch_code || "MAIN",
                name: branchData.name || branchData.branch_name || "Main Home Shop (အိမ်ဆိုင်/စက်ရုံ)"
            };
            localStorage.setItem("pos_branch", JSON.stringify(this.currentBranch));
        }
    },

    isLoggedIn() {
        return !!(this.user && this.user.username);
    },

    isAdmin() {
        return !!(this.user && (this.user.role === "admin" || this.user.role === "finance"));
    },

    logout() {
        this.setUser(null);
        window.location.reload();
    }
};
