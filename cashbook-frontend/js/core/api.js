// =============================================================================
// FILE: cashbook-frontend/js/core/api.js
// CENTRAL API CLIENT, SNAKE_CASE <-> CAMELCASE MAPPER & D1 READ MICRO-CACHE
// Version: 4.1.0 (Spec 1.3 Payload Mapping Layer & D1 Quota Optimizer)
// =============================================================================

const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

export const API_BASE_URL =
    isLocalHost && window.location.port !== "8787"
        ? "http://localhost:8787/api"
        : "/api";

// D1 Read Quota Saver: In-flight GET deduplication & short-TTL cache (Spec 8.4)
const inflightGets = new Map();
const responseCache = new Map();

function getCacheTTL(endpoint) {
    if (endpoint.startsWith("/branches") || endpoint.startsWith("/cashbook/categories")) {
        return 60000; // 60 seconds for static config lists
    }
    return 1500; // 1.5 seconds micro-cache to prevent rapid tab-switch duplicate reads
}

/**
 * camelCase key မှ snake_case key သို့ ပြောင်းလဲခြင်း (Spec 1.3)
 */
function toSnakeCase(str) {
    return String(str).replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * snake_case key မှ camelCase key သို့ ပြောင်းလဲခြင်း
 */
function toCamelCase(str) {
    return String(str).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Frontend မှ Backend သို့ ပို့မည့် Request Payload အား snake_case စံနှုန်းသို့ ပြောင်းလဲခြင်း (Spec 1.3)
 * - targetBranchId -> branch_id
 * - camelCase keys -> snake_case keys
 */
export function normalizeRequestPayload(payload) {
    if (payload === null || payload === undefined || typeof payload !== "object") {
        return payload;
    }
    if (Array.isArray(payload)) {
        return payload.map(item => normalizeRequestPayload(item));
    }

    const normalized = {};
    for (const [key, value] of Object.entries(payload)) {
        const cleanVal = normalizeRequestPayload(value);
        const snakeKey = key === "targetBranchId" ? "branch_id" : toSnakeCase(key);

        normalized[key] = cleanVal;
        if (!(snakeKey in normalized)) {
            normalized[snakeKey] = cleanVal;
        }
    }
    return normalized;
}

/**
 * Backend မှ ပြန်လာသော Response Data အား snake_case ရော camelCase ပါ ဖတ်နိုင်အောင် ပြင်ဆင်ခြင်း
 * - Cashier အတွက် Backend မှ ဖယ်ရှားထားသော cost_price ကို လုံးဝ မထည့်ပါ (Spec 1.3 & 10)
 */
export function normalizeResponsePayload(data) {
    if (data === null || data === undefined || typeof data !== "object") {
        return data;
    }
    if (Array.isArray(data)) {
        return data.map(item => normalizeResponsePayload(item));
    }

    const enriched = {};
    for (const [key, value] of Object.entries(data)) {
        const normalizedVal = normalizeResponsePayload(value);
        enriched[key] = normalizedVal;

        if (key.includes("_")) {
            const camelKey = toCamelCase(key);
            if (!(camelKey in enriched)) {
                enriched[camelKey] = normalizedVal;
            }
        } else if (/[A-Z]/.test(key)) {
            const snakeKey = toSnakeCase(key);
            if (!(snakeKey in enriched)) {
                enriched[snakeKey] = normalizedVal;
            }
        }
    }
    return enriched;
}

/**
 * Topbar ရှိ D1 Online / Offline အခြေအနေပြ Badge ကို အလိုအလျောက် ပြောင်းလဲပေးခြင်း
 */
function setOnlineStatus(isOnline) {
    const badge = document.getElementById("d1-status-badge");
    const dot = document.getElementById("d1-status-dot");
    const text = document.getElementById("d1-status-text");
    if (!dot || !text) return;

    if (isOnline) {
        dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
        text.textContent = "D1 Online";
        if (badge) {
            badge.className = "flex items-center gap-2 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2 rounded-xl font-bold border border-emerald-200 dark:border-emerald-800/60 text-xs";
        }
    } else {
        dot.className = "w-2 h-2 rounded-full bg-rose-500";
        text.textContent = "D1 Offline";
        if (badge) {
            badge.className = "flex items-center gap-2 text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-3.5 py-2 rounded-xl font-bold border border-rose-200 dark:border-rose-800/60 text-xs";
        }
    }
}

export const api = {
    clearCache() {
        responseCache.clear();
    },

    async request(endpoint, options = {}) {
        const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
        const url = `${API_BASE_URL}${cleanEndpoint}`;
        const method = (options.method || "GET").toUpperCase();

        // Write/Mutation လုပ်ဆောင်ချက်တိုင်းတွင် Cache အဟောင်းအားလုံးကို ချက်ချင်း ရှင်းလင်းမည်
        if (method !== "GET") {
            this.clearCache();
        }

        const token = localStorage.getItem("pos_token");
        const branchId = localStorage.getItem("pos_branch_id") || "";

        const headers = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(branchId ? { "X-Branch-Id": branchId } : {}),
            ...(options.headers || {})
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        const config = {
            ...options,
            method,
            headers,
            signal: controller.signal
        };

        let response;
        try {
            response = await fetch(url, config);
            setOnlineStatus(response.status < 502);
        } catch (netErr) {
            clearTimeout(timeoutId);
            setOnlineStatus(false);
            const msg = netErr.name === "AbortError"
                ? "အင်တာနက်ချိတ်ဆက်မှု အချိန်ကြာမြင့်နေပါသည် (Request Timeout)"
                : "Server သို့ ချိတ်ဆက်၍ မရပါ။ အင်တာနက်လိုင်း စစ်ဆေးပေးပါ။";
            console.error(`Network Error [${cleanEndpoint}]:`, netErr.message);
            throw new Error(msg);
        } finally {
            clearTimeout(timeoutId);
        }

        const rawJson = await response.json().catch(() => ({}));

        // Token သက်တမ်းကုန်ဆုံးသွားပါက Login ပြန်ဝင်ခိုင်းခြင်း
        if (response.status === 401 && !cleanEndpoint.includes("/auth/login")) {
            localStorage.removeItem("pos_token");
            localStorage.removeItem("pos_user");
            window.location.reload();
            throw new Error("အကောင့်ဝင်ရောက်ခွင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ ပြန်လည်ဝင်ရောက်ပါ။");
        }

        if (!response.ok) {
            const errMsg = rawJson.error || rawJson.message || `HTTP error! status: ${response.status}`;
            console.warn(`API Validation/Error [${cleanEndpoint}]:`, errMsg);
            throw new Error(errMsg);
        }

        if (rawJson && typeof rawJson === "object" && "data" in rawJson) {
            return {
                ...rawJson,
                data: normalizeResponsePayload(rawJson.data)
            };
        }

        return normalizeResponsePayload(rawJson);
    },

    get(endpoint, params = {}) {
        const cleanParams = {};
        const normalizedParams = normalizeRequestPayload(params || {});

        Object.entries(normalizedParams).forEach(([key, value]) => {
            // Keep snake_case query params clean
            if (value !== undefined && value !== null && value !== "" && !/[A-Z]/.test(key)) {
                cleanParams[key] = value;
            }
        });

        const query = new URLSearchParams(cleanParams).toString();
        const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
        const url = query ? `${cleanEndpoint}?${query}` : cleanEndpoint;

        const now = Date.now();
        const cached = responseCache.get(url);
        if (cached && now < cached.expiresAt) {
            return Promise.resolve(cached.data);
        }

        if (inflightGets.has(url)) {
            return inflightGets.get(url);
        }

        const reqPromise = this.request(url, { method: "GET" })
            .then(data => {
                responseCache.set(url, {
                    data,
                    expiresAt: Date.now() + getCacheTTL(cleanEndpoint)
                });
                inflightGets.delete(url);
                return data;
            })
            .catch(err => {
                inflightGets.delete(url);
                throw err;
            });

        inflightGets.set(url, reqPromise);
        return reqPromise;
    },

    post(endpoint, body = {}) {
        const mappedBody = normalizeRequestPayload(body);
        return this.request(endpoint, {
            method: "POST",
            body: JSON.stringify(mappedBody)
        });
    },

    put(endpoint, body = {}) {
        const mappedBody = normalizeRequestPayload(body);
        return this.request(endpoint, {
            method: "PUT",
            body: JSON.stringify(mappedBody)
        });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: "DELETE" });
    }
};
