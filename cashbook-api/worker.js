/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - ALL-IN-ONE WORKER
 * File: cashbook-api/worker.js
 * Features:
 *   1. D1 Database Authentication (PBKDF2 + Base64 Salt / Hash)
 *   2. WebCrypto JWT Token Issuance
 *   3. Dynamic API Router (/api & POST)
 *   4. Cloudflare Static Assets Serving (env.ASSETS)
 * ==============================================================================
 */

// ==============================================================================
// 💡 1. CRYPTOGRAPHIC UTILITIES (Web Crypto API)
// ==============================================================================
function base64ToBytes(base64) {
  const binString = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function verifyPbkdf2Password(password, storedHash, storedSalt) {
  try {
    if (!storedHash) return false;

    // Database ထဲတွင် Base64 Salt သီးသန့်ရှိနေသော ပုံစံ (users table standard)
    if (storedSalt) {
      const saltBytes = base64ToBytes(storedSalt);
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        256
      );
      const computedBase64 = bytesToBase64(new Uint8Array(derivedBits));
      return computedBase64 === storedHash;
    }

    // pbkdf2$iterations$salt$hash ပုံစံ
    if (storedHash.startsWith("pbkdf2$")) {
      const parts = storedHash.split("$");
      const iterations = parseInt(parts[1], 10) || 100000;
      const salt = new Uint8Array(parts[2].match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        keyMaterial,
        256
      );
      const computedHex = Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return computedHex === parts[3];
    }

    // Plain text စစ်ဆေးခြင်း (စမ်းသပ်ရန်)
    return password === storedHash;
  } catch (err) {
    console.error("Password verification error:", err);
    return false;
  }
}

async function createJwtToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600; // 24 Hours Expiry
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp }));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))}`;
}

// ==============================================================================
// 💡 2. MAIN FETCH HANDLER
// ==============================================================================
export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Content-Type": "application/json"
    };

    // CORS Preflight Options Request
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // --------------------------------------------------------------------------
    // 💡 အပိုင်း (က) - API / Login Request များကို စစ်ဆေးခြင်း
    // --------------------------------------------------------------------------
    if (url.pathname.startsWith("/api") || request.method === "POST" || url.searchParams.has("action")) {
      try {
        const db = env.DB;
        if (!db) {
          return new Response(
            JSON.stringify({ success: false, message: "Database Binding (env.DB) မတွေ့ရှိပါ။" }),
            { status: 500, headers: corsHeaders }
          );
        }

        const authSecret = env.AUTH_SECRET || "MYA_GABAR_SOE_SHOP_SECURE_KEY_2026";
        let body = {};

        if (request.method === "POST") {
          try {
            body = await request.json();
          } catch (e) {
            body = {};
          }
        } else {
          for (const [key, value] of url.searchParams.entries()) {
            body[key] = value;
          }
        }

        const action = body.action || url.searchParams.get("action") || "";

        // 🎯 LOGIN ACTION
        if (action === "checkLogin") {
          const username = String(body.username || "").trim();
          const password = String(body.password || "").trim();

          if (!username || !password) {
            return new Response(
              JSON.stringify({ success: false, message: "Username နှင့် Password ဖြည့်သွင်းပေးပါ။" }),
              { status: 400, headers: corsHeaders }
            );
          }

          // D1 Database ထဲမှ User စစ်ဆေးခြင်း
          const user = await db.prepare(
            "SELECT id, username, password_salt, password_hash, role, branch_code FROM users WHERE LOWER(username) = LOWER(?)"
          ).bind(username).first();

          if (!user) {
            return new Response(
              JSON.stringify({ success: false, message: "အသုံးပြုသူ အမည် (Username) မှားယွင်းနေပါသည်။" }),
              { headers: corsHeaders }
            );
          }

          // Password တိုက်စစ်ခြင်း
          const isPasswordOk = await verifyPbkdf2Password(password, user.password_hash, user.password_salt);
          if (!isPasswordOk) {
            return new Response(
              JSON.stringify({ success: false, message: "Password မှားယွင်းနေပါသည်။" }),
              { headers: corsHeaders }
            );
          }

          // JWT Token ထုတ်ပေးခြင်း
          const token = await createJwtToken(
            { id: user.id, username: user.username, role: user.role, branch_code: user.branch_code },
            authSecret
          );

          return new Response(
            JSON.stringify({
              success: true,
              message: "Login အောင်မြင်ပါသည်!",
              token: token,
              user: {
                username: user.username,
                role: user.role,
                branch_code: user.branch_code
              }
            }),
            { headers: corsHeaders }
          );
        }

        // အခြား API စမ်းသပ်မှုများအတွက် Default Health Response
        return new Response(
          JSON.stringify({ success: true, message: "API is ready!", receivedAction: action }),
          { headers: corsHeaders }
        );
      } catch (err) {
        console.error("API Execution Error:", err);
        return new Response(
          JSON.stringify({ success: false, message: `Server Error: ${err.message}` }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // --------------------------------------------------------------------------
    // 💡 အပိုင်း (ခ) - Website မျက်နှာပြင်များ (index.html, CSS, JS, Fonts) ပြသခြင်း
    // --------------------------------------------------------------------------
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Website loading...", {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};
