async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 💡 ၁။ /api လမ်းကြောင်း သို့မဟုတ် POST Request လာပါက Database ဖြင့် စစ်ဆေးမည်
    if (url.pathname.startsWith("/api") || request.method === "POST") {
      try {
        const db = env.DB;
        if (!db) {
          return new Response(JSON.stringify({ success: false, message: "D1 Database Binding (env.DB) မရှိသေးပါ။" }), { status: 500, headers: corsHeaders });
        }

        const authSecret = "MYA_GABAR_SOE_SHOP_SECURE_KEY_2026";
        let body = {};
        try {
          body = await request.json();
        } catch (e) {
          body = {};
        }

        const action = body.action || url.searchParams.get("action") || "";

        if (action === "checkLogin") {
          const username = String(body.username || "").trim();
          const password = String(body.password || "").trim();

          const user = await db.prepare(
            "SELECT id, username, password_salt, password_hash, role, branch_code FROM users WHERE LOWER(username) = LOWER(?)"
          ).bind(username).first();

          if (!user) {
            return new Response(JSON.stringify({ success: false, message: "အသုံးပြုသူ အမည် (Username) မှားယွင်းနေပါသည်။" }), { headers: corsHeaders });
          }

          const isOk = await verifyPbkdf2Password(password, user.password_hash, user.password_salt);
          if (!isOk) {
            return new Response(JSON.stringify({ success: false, message: "Password မှားယွင်းနေပါသည်။" }), { headers: corsHeaders });
          }

          const token = await createJwtToken({ id: user.id, username: user.username, role: user.role, branch_code: user.branch_code }, authSecret);

          return new Response(JSON.stringify({
            success: true,
            token: token,
            user: { username: user.username, role: user.role, branch_code: user.branch_code }
          }), { headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: false, message: "Unknown action" }), { status: 400, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 💡 ၂။ GET Request (Website မျက်နှာပြင်များ) ဖြစ်ပါက Static Assets ကို ပြသပေးမည်
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Website loading...", { headers: { "Content-Type": "text/html" } });
  }
};
