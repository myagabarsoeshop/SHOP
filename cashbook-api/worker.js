// cashbook-api/worker.js
import { corsHeaders, errorResponse } from "./utils/response.js";
import { handleLogin, handleGetProfile } from "./controllers/auth.controller.js";

export default {
    async fetch(request, env, ctx) {
        // ၁။ Browser CORS Preflight Request ကို အရင်ဆုံး ဖြေကြားခြင်း
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            // ၂။ Authentication Routes
            if (path === "/api/auth/login" && method === "POST") {
                return await handleLogin(request, env);
            }

            if (path === "/api/auth/me" && method === "GET") {
                return await handleGetProfile(request, env);
            }

            // ၃။ System Health Check (စနစ် အလုပ်လုပ်မှု ရှိ/မရှိ စစ်ဆေးရန်)
            if (path === "/api/health" || path === "/") {
                return new Response(JSON.stringify({ status: "online", version: "2.1.0" }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            // သတ်မှတ်ထားသော API လမ်းကြောင်း မဟုတ်ပါက 404 ပြန်ပေးခြင်း
            return errorResponse(`Route မတွေ့ရှိပါ: ${method} ${path}`, 404);

        } catch (err) {
            return errorResponse(`Server Internal Error: ${err.message}`, 500);
        }
    }
};
