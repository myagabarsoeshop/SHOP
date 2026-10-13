/**
 * Application Global Configuration
 */
const CONFIG = {
  APP_NAME: "မြကမ္ဘာစိုး ပိုးထည်တိုက်",
  API_BASE_URL: "https://shop-api.myagabarsoeshop.workers.dev",
  API_URL: "https://shop-api.myagabarsoeshop.workers.dev",
  VERSION: "20261008"
};

// Global အနေဖြင့် ခေါ်သုံးနိုင်အောင် Window တွင် သတ်မှတ်ပေးခြင်း
window.CONFIG = CONFIG;
window.API_BASE_URL = CONFIG.API_BASE_URL;
window.API_URL = CONFIG.API_URL;
