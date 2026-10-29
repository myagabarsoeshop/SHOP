// cashbook-frontend/js/modules/auth.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

export function initAuth() {
    const form = document.getElementById("login-form");
    const userSelect = document.getElementById("login-user-select");
    const passInput = document.getElementById("login-password");
    const togglePassBtn = document.getElementById("toggle-password");
    const passIcon = document.getElementById("toggle-password-icon");
    const errorBox = document.getElementById("login-error");
    const errorText = document.getElementById("login-error-text");
    const submitBtn = document.getElementById("btn-login-submit");

    // Password Toggle (Show / Hide)
    if (togglePassBtn) {
        togglePassBtn.onclick = () => {
            const isPassword = passInput.type === "password";
            passInput.type = isPassword ? "text" : "password";
            passIcon.className = isPassword ? "fa-regular fa-eye-slash text-sm" : "fa-regular fa-eye text-sm";
        };
    }

    // Login Form Submit Event
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            errorBox.classList.add("hidden");

            const username = userSelect.value;
            const password = passInput.value;

            if (!username) {
                errorBox.classList.remove("hidden");
                errorText.textContent = "ကျေးဇူးပြု၍ အသုံးပြုသူအမည် ရွေးချယ်ပေးပါ";
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>စစ်ဆေးနေပါသည်...</span>`;

            try {
                const response = await api.post("/auth/login", { username, password });

                if (response.success && response.data.user) {
                    state.setUser(response.data.user);
                    // Login အောင်မြင်ပါက မျက်နှာပြင်ကို Reload ပြုလုပ်ပြီး ဝင်ရောက်ခြင်း
                    window.location.reload();
                }
            } catch (err) {
                errorBox.classList.remove("hidden");
                errorText.textContent = err.message || "စကားဝှက် မှားယွင်းနေပါသည်";
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span>စနစ်ထဲသို့ ဝင်ရောက်မည်</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
            }
        };
    }
}
