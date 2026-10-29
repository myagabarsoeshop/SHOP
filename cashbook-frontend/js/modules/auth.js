// cashbook-frontend/js/modules/auth.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

export function initAuth() {
    const form = document.getElementById("login-form");
    const errorBox = document.getElementById("login-error");
    const errorText = document.getElementById("login-error-text");
    const togglePassBtn = document.getElementById("toggle-password");
    const passInput = document.getElementById("login-password");
    const passIcon = document.getElementById("toggle-password-icon");
    const submitBtn = document.getElementById("btn-login-submit");

    // Password ပြသ/ဖျောက် toggle
    if (togglePassBtn) {
        togglePassBtn.addEventListener("click", () => {
            const isPassword = passInput.type === "password";
            passInput.type = isPassword ? "text" : "password";
            passIcon.className = isPassword ? "fa-regular fa-eye-slash text-sm" : "fa-regular fa-eye text-sm";
        });
    }

    // Login Form Submit
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            errorBox.classList.add("hidden");

            const username = document.getElementById("login-username").value.trim();
            const password = passInput.value;

            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-sm"></i> <span>စစ်ဆေးနေပါသည်...</span>`;

            try {
                const response = await api.post("/auth/login", { username, password });

                if (response.success && response.data.user) {
                    state.setUser(response.data.user);
                    // Login အောင်မြင်ပါက မူရင်း App Layout ကို Reload ခေါ်ပြီး ဖွင့်လှစ်ခြင်း
                    window.location.reload();
                }
            } catch (err) {
                errorBox.classList.remove("hidden");
                errorText.textContent = err.message || "အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်";
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span>စနစ်ထဲသို့ ဝင်ရောက်မည်</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
            }
        });
    }
}
