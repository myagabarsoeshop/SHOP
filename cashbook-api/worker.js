/**
 * MYA GABAR SOE SHOP - ALL-IN-ONE WORKER (ASSETS + D1 DATABASE API)
 */

function base64ToBytes(base64) {
  const binString = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function verifyPbkdf2Password(password, storedHash, storedSalt) {
  try {
    if (!storedHash) return false;

    // Database ထဲတွင် Base64 Salt ရှိသော ပုံစံ
    if (storedSalt) {
      const saltBytes = base64ToBytes(storedSalt);
      const keyMaterial = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
        keyMaterial, 256
      );
      const computedBase64 = bytesToBase64(new Uint8Array(derivedBits));
      return computedBase64 === storedHash;
    }

    // pbkdf2$100000$salt$hash ပုံစံ
    if (storedHash.startsWith("pbkdf2$")) {
      const parts = storedHash.split("$");
      const iterations = parseInt(parts[1], 10) || 100000;
      const salt = new Uint8Array(parts[2].match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const keyMaterial = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        keyMaterial, 256
      );
      const computedHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, "0")).join("");
      return computedHex === parts[3];
    }

    return password === storedHash;
  } catch (err) {
    return false;
  }
}

async function createJwtToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const exp = Math.floor(Date.now() / 1000) + (24 * 3600);
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp }));

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))}`;
}

export default {
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

    // 💡 ၁။ POST Request (Login စစ်ဆေးမှု) ဖြစ်ပါက Database ဖြင့် စစ်ဆေးမည်
    if (request.method === "POST") {
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

        const action = body.action || "";

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

    // 💡 GET Request ဖြစ်ပါက Website မျက်နှာပြင် (index.html) ကို တိုက်ရိုက် ဆွဲတင်ပြသပေးမည်
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Website loading...", { headers: { "Content-Type": "text/html" } });
  }
};
