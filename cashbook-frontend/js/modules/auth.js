// cashbook-frontend/js/modules/auth.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

export function initAuth() {
    const form = document.getElementById("login-form");
    const userSelect = document.getElementById("login-user-select") || document.getElementById("login-username");
    const passInput = document.getElementById("login-password");
    const togglePassBtn = document.getElementById("toggle-password");
    const passIcon = document.getElementById("toggle-password-icon");
    const errorBox = document.getElementById("login-error");
    const errorText = document.getElementById("login-error-text");
    const submitBtn = document.getElementById("btn-login-submit");

    // ၁။ နောက်ဆုံး ဝင်ရောက်ခဲ့သော အသုံးပြုသူအမည်ကို အသင့်ပြန်ရွေးပေးထားခြင်း
    const lastUser = localStorage.getItem("pos_last_username");
    if (userSelect && lastUser) {
        userSelect.value = lastUser;
        if (userSelect.value === lastUser) {
            setTimeout(() => passInput?.focus(), 50);
        }
    }

    if (userSelect) {
        userSelect.addEventListener("change", () => {
            errorBox?.classList.add("hidden");
            passInput?.focus();
        });
    }

    if (passInput) {
        passInput.addEventListener("input", () => {
            errorBox?.classList.add("hidden");
        });
    }

    // ၂။ Password Toggle (Show / Hide)
    if (togglePassBtn && passInput) {
        togglePassBtn.onclick = () => {
            const isPassword = passInput.type === "password";
            passInput.type = isPassword ? "text" : "password";
            if (passIcon) {
                passIcon.className = isPassword ? "fa-regular fa-eye-slash text-sm" : "fa-regular fa-eye text-sm";
            }
            passInput.focus();
        };
    }

    // ၃။ Login Form Submit Event
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            if (errorBox) errorBox.classList.add("hidden");

            const username = userSelect?.value?.trim();
            const password = passInput?.value;

            if (!username) {
                if (errorBox && errorText) {
                    errorBox.classList.remove("hidden");
                    errorText.textContent = "ကျေးဇူးပြု၍ အသုံးပြုသူအမည် ရွေးချယ်/ထည့်သွင်းပေးပါ";
                }
                userSelect?.focus();
                return;
            }

            if (!password) {
                if (errorBox && errorText) {
                    errorBox.classList.remove("hidden");
                    errorText.textContent = "ကျေးဇူးပြု၍ စကားဝှက် ရိုက်ထည့်ပေးပါ";
                }
                passInput?.focus();
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>စစ်ဆေးနေပါသည်...</span>`;
            }

            try {
                const response = await api.post("/auth/login", { username, password });
                const payload = response?.data || response;

                if (payload && payload.token) {
                    localStorage.setItem("pos_last_username", username);
                    localStorage.setItem("pos_token", payload.token);

                    if (payload.user) {
                        const u = payload.user;
                        state.setUser(u);
                        if (u.branchId) {
                            localStorage.setItem("pos_branch_id", String(u.branchId));
                            if (typeof state.setBranch === "function") {
                                state.setBranch({
                                    id: Number(u.branchId),
                                    code: u.branchCode || "MAIN",
                                    name: u.branchName || "Main Home Shop"
                                });
                            }
                        }
                    }

                    window.location.reload();
                } else {
                    throw new Error(response?.error || "Login ဝင်ရောက်၍ မရပါ");
                }
            } catch (err) {
                if (errorBox && errorText) {
                    errorBox.classList.remove("hidden");
                    errorText.textContent = err.message || "အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်";
                }
                passInput?.focus();
                passInput?.select();
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = `<span>စနစ်ထဲသို့ ဝင်ရောက်မည်</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
                }
            }
        };
    }
}
