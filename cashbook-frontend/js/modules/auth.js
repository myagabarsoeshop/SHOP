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

    // Password Toggle (Show / Hide)
    if (togglePassBtn && passInput) {
        togglePassBtn.onclick = () => {
            const isPassword = passInput.type === "password";
            passInput.type = isPassword ? "text" : "password";
            if (passIcon) {
                passIcon.className = isPassword ? "fa-regular fa-eye-slash text-sm" : "fa-regular fa-eye text-sm";
            }
        };
    }

    // Login Form Submit Event
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
                return;
            }

            if (!password) {
                if (errorBox && errorText) {
                    errorBox.classList.remove("hidden");
                    errorText.textContent = "ကျေးဇူးပြု၍ စကားဝှက် ရိုက်ထည့်ပေးပါ";
                }
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>စစ်ဆေးနေပါသည်...</span>`;
            }

            try {
                const response = await api.post("/auth/login", { username, password });

                if (response?.success && response?.data) {
                    // ၁။ Backend မှ ပေးပို့သော Token အား LocalStorage တွင် သိမ်းဆည်းခြင်း (API Gateway စစ်ဆေးရန်)
                    if (response.data.token) {
                        localStorage.setItem("pos_token", response.data.token);
                    }

                    // ၂။ User အချက်အလက်နှင့် ဆိုင်ခွဲ ID ကို သိမ်းဆည်းခြင်း
                    if (response.data.user) {
                        state.setUser(response.data.user);
                        if (response.data.user.branchId) {
                            localStorage.setItem("pos_branch_id", String(response.data.user.branchId));
                        }
                    }

                    // ၃။ Login အောင်မြင်ပါက စနစ်မျက်နှာပြင်သို့ ဝင်ရောက်ခြင်း
                    window.location.reload();
                } else {
                    throw new Error(response?.error || "Login ဝင်ရောက်၍ မရပါ");
                }
            } catch (err) {
                if (errorBox && errorText) {
                    errorBox.classList.remove("hidden");
                    errorText.textContent = err.message || "စကားဝှက် မှားယွင်းနေပါသည်";
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = `<span>စနစ်ထဲသို့ ဝင်ရောက်မည်</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
                }
            }
        };
    }
}
