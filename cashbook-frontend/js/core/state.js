// cashbook-frontend/js/core/state.js

export const state = {
    user: JSON.parse(localStorage.getItem("pos_user") || "null"),
    currentBranch: JSON.parse(localStorage.getItem("pos_branch") || "null"),
    cart: [],

    setUser(userData) {
        this.user = userData;
        if (userData) {
            localStorage.setItem("pos_user", JSON.stringify(userData));
            this.setBranch({
                id: userData.branchId,
                code: userData.branchCode,
                name: userData.branchName
            });
        } else {
            localStorage.removeItem("pos_user");
            localStorage.removeItem("pos_branch");
        }
    },

    setBranch(branchData) {
        this.currentBranch = branchData;
        if (branchData) {
            localStorage.setItem("pos_branch", JSON.stringify(branchData));
        }
    },

    isLoggedIn() {
        return !!this.user;
    },

    isAdmin() {
        return this.user && (this.user.role === "admin" || this.user.role === "finance");
    },

    logout() {
        this.setUser(null);
        window.location.reload();
    }
};
