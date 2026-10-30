// cashbook-frontend/js/core/config.js

const isLocalHost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const resolvedApiUrl =
    isLocalHost && window.location.port !== "8787"
        ? "http://localhost:8787/api"
        : "https://shop.myagabarsoeshop.workers.dev/api";

export const CONFIG = {
    APP_NAME: "မြကမ္ဘာစိုး ပိုးထည်တိုက်",
    API_BASE_URL: resolvedApiUrl,
    API_URL: resolvedApiUrl,
    VERSION: "2.3.0"
};

if (typeof window !== "undefined") {
    window.CONFIG = CONFIG;
    window.API_BASE_URL = CONFIG.API_BASE_URL;
    window.API_URL = CONFIG.API_URL;
}
