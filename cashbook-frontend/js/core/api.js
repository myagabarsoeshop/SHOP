// cashbook-frontend/js/core/api.js

const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

// Wrangler dev (port 8787) သို့မဟုတ် Production Worker တွင် Same-Origin "/api" ကို သုံးပြီး၊
// VS Code Live Server (ဥပမာ port 5500) ဖြင့် ဖွင့်စမ်းပါက localhost:8787 သို့ အလိုအလျောက် ချိတ်ပေးမည်
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
        const headers = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        };

        const config = {
            ...options,
            headers
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json().catch(() => ({}));

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
        // null, undefined နှင့် အလွတ် ("") များကို Query String ထဲ မပါသွားအောင် စစ်ထုတ်ခြင်း
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
