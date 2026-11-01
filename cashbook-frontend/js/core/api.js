// cashbook-frontend/js/core/api.js

const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

export const API_BASE_URL =
    isLocalHost && window.location.port !== "8787"
        ? "http://localhost:8787/api"
        : "/api";

/**
 * Topbar ရှိ D1 Online / Offline အခြေအနေပြ Badge ကို အလိုအလျောက် ပြောင်းလဲပေးခြင်း
 */
function setOnlineStatus(isOnline) {
    const dot = document.getElementById("d1-status-dot");
    const text = document.getElementById("d1-status-text");
    if (!dot || !text) return;

    if (isOnline) {
        dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
        text.textContent = "D1 Online";
    } else {
        dot.className = "w-2 h-2 rounded-full bg-rose-500";
        text.textContent = "D1 Offline";
    }
}

export const api = {
    async request(endpoint, options = {}) {
        const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
        const url = `${API_BASE_URL}${cleanEndpoint}`;

        const token = localStorage.getItem("pos_token");
        const branchId = localStorage.getItem("pos_branch_id") || "";

        const headers = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(branchId ? { "X-Branch-Id": branchId } : {}),
            ...(options.headers || {})
        };

        const config = {
            ...options,
            headers
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json().catch(() => ({}));

            // Token သက်တမ်းကုန်ဆုံးသွားပါက Login ပြန်ဝင်ခိုင်းခြင်း
            if (response.status === 401 && !cleanEndpoint.includes("/auth/login")) {
                localStorage.removeItem("pos_token");
                localStorage.removeItem("pos_user");
                window.location.reload();
                throw new Error("အကောင့်ဝင်ရောက်ခွင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ ပြန်လည်ဝင်ရောက်ပါ။");
            }

            if (!response.ok) {
                throw new Error(data.error || data.message || `HTTP error! status: ${response.status}`);
            }

            setOnlineStatus(true);
            return data;
        } catch (error) {
            setOnlineStatus(false);
            console.error(`API Error [${cleanEndpoint}]:`, error.message);
            throw error;
        }
    },

    get(endpoint, params = {}) {
        const cleanParams = {};
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                cleanParams[key] = value;
            }
        });

        const query = new URLSearchParams(cleanParams).toString();
        const url = query ? `${endpoint}?${query}` : endpoint;
        return this.request(url, { method: "GET" });
    },

    post(endpoint, body = {}) {
        return this.request(endpoint, {
            method: "POST",
            body: JSON.stringify(body)
        });
    },

    put(endpoint, body = {}) {
        return this.request(endpoint, {
            method: "PUT",
            body: JSON.stringify(body)
        });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: "DELETE" });
    }
};
