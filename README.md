# မြကမ္ဘာစိုး ပိုးထည်တိုက် — Multi-Store Garment POS, Inventory & Cashbook ERP (v3.1.0)

Cloudflare Workers (Serverless Backend) နှင့် Cloudflare D1 (SQLite Edge Database) ပေါ်တွင် အခြေခံတည်ဆောက်ထားသော ဆိုင်ခွဲပေါင်းစုံသုံး ပိုးထည်နှင့် အထည်ဆိုင် စီမံခန့်ခွဲရေးစနစ် (All-in-One Garment ERP) ဖြစ်ပါသည်။

---

## ✨ အဓိက လုပ်ဆောင်ချက်များ (Key Enterprise Features)

1. **Sale Counter (POS) & 80mm Thermal Receipt:**
   - လက်လီ (Retail) နှင့် လက်ကား (Wholesale) ဈေးနှုန်း တစ်ပြိုင်နက် သတ်မှတ်ရောင်းချနိုင်ခြင်း။
   - ငွေပေးချေမှု စနစ် (၄) မျိုး — **ငွေသား (Cash)**၊ **KPay/ဘဏ် (Bank)**၊ **နှစ်မျိုးပေါင်း (Split: Cash + Bank)** နှင့် **အကြွေး (Credit)**။
   - Barcode Scanner (`Enter` Auto-Add)၊ 80mm ဘောင်ချာပရင့်ထုတ်ခြင်းနှင့် ယနေ့အရောင်းဘောင်ချာ ပြန်ဖျက်ခြင်း (`Void / Cancel` — စတော့၊ ငွေစာရင်းနှင့် အကြွေး အလိုအလျောက် ပြန်ညှိပေးသည့်စနစ်)။

2. **Purchases & Supplier Payables Sync (အဝယ်နှင့် စတော့အဝင်):**
   - `DDMMYY-01` ပုံစံဖြင့် အဝယ်ဘောင်ချာနံပါတ် (`VR NO`) အလိုအလျောက် ထုတ်ပေးခြင်း။
   - ပစ္စည်းတန်ဖိုး (`Items Total`)၊ အမှန်ပေးငွေ (`Actual Paid`) နှင့် ပိုငွေ/လိုငွေ (`Surplus & Deficit`) အလိုအလျောက် တွက်ချက်ပြီး လိုငွေ/အကြွေးဖြစ်ပါက ပွဲရုံပေးရန်ကျန်ငွေစာရင်း (`supplier_ledger`) သို့ တိုက်ရိုက်ချိတ်ဆက်ပေးခြင်း။

3. **Multi-Store Cashbook (နေ့စဉ်ငွေစာရင်း):**
   - ဆိုင်ခွဲအလိုက် ငွေသားလက်ကျန် (`Cash Balance`)၊ ဘဏ်လက်ကျန် (`Bank Balance`)၊ ဆိုင်အသုံးစရိတ် (`Total Expense`) နှင့် ပိုင်ရှင်ထံအပ်ငွေ (`Owner Remittance`) တို့ကို သီးသန့်ခွဲခြား တွက်ချက်ပေးခြင်း။

4. **Customers & Suppliers Dual Ledger (ရရန်ရှိနှင့် ပေးရန်ရှိ အကြွေးစာရင်း):**
   - ဖောက်သည်အကြွေး (`Receivables`) နှင့် ပွဲရုံကုန်ကြွေး (`Payables`) နှစ်မျိုးလုံးကို စီမံခန့်ခွဲနိုင်ပြီး A4 Account Statement ပရင့်ထုတ်နိုင်ခြင်း။

5. **Inventory, Yarn Balances, Stock Transfers & Waste Logs:**
   - ဆိုင်ခွဲအလိုက် အထည်လက်ကျန်၊ ချည်စတိုနှင့် ရက်ကန်းထုတ်ပေးမှု၊ ဆိုင်ခွဲအချင်းချင်း ပစ္စည်းလွှဲပြောင်းမှုနှင့် အလေအလွင့်မှတ်တမ်းများ။
   - ၁၂ လချုပ် စတော့အဝင်/အထွက်နှင့် လက်ကျန်တန်ဖိုး မက်ထရစ် အစီရင်ခံစာ (`Stock Report`)။

6. **Cloudflare D1 Free Tier Optimization:**
   - Composite Indexes၊ `env.DB.batch()` Atomic Transactions၊ Bulk CSV Import (`/api/products/bulk`) နှင့် Frontend Smart Request Deduplication တို့ဖြင့် D1 Read/Write Quota ကို ၈၀% အထိ ချွေတာထားပါသည်။

7. **Security Hardening (v3.1.0):**
   - PBKDF2-HMAC-SHA256 (100,000 iterations) Password Hashing & HMAC-SHA256 JWT Authentication။
   - Login Brute-Force Rate Limiting (IP တစ်ခုလျှင် ၁ မိနစ်အတွင်း ၅ ကြိမ်ထက်ပိုမှားပါက အလိုအလျောက် ပိတ်ထားခြင်း)။
   - Server-side POS Price Validation (Client မှ ဈေးနှုန်းအတု ပေးပို့၍မရခြင်း)။
   - XSS (`escapeHtml`) နှင့် CSV Formula Injection (`escapeCsv`) ကာကွယ်မှု။

---

## 📁 ဖိုလ်ဒါ ဖွဲ့စည်းပုံ (Project Structure)

```text
├── wrangler.toml                        # Cloudflare Worker, Assets, D1 & Cron Configuration
├── README.md                            # System Documentation
├── cashbook-api/                        # Modular Cloudflare Worker Backend (5 Files)
│   ├── worker.js                        # Main Entrypoint, Auth, Dashboard, Reports & Cron
│   ├── utils.js                         # CORS, Kyat/Qty Math, Schema Guard, Rate Limiter & JWT
│   ├── routes-inventory.js              # Branches, Products, Bulk CSV, Yarn, Waste & Transfers
│   ├── routes-transactions.js           # Purchases (Stock-In) & POS Sales (Checkout & Void)
│   ├── routes-finance.js                # Cashbook & Customers/Suppliers Ledgers
│   └── schema/
│       ├── 01_schema.sql                # Full D1 SQLite Schema & Performance Indexes (v2.3.0)
│       └── 02_seed.sql                  # Initial Branches, Categories & Safe Indexes
└── cashbook-frontend/                   # Single-Page Application (SPA) Frontend
    ├── index.html                       # Main App Frame, Theme CSS, Tabular Nums & Print Engine
    ├── views/                           # 13 Modular HTML View Templates
    │   ├── login.html
    │   ├── dashboard.html
    │   ├── pos.html
    │   ├── cashbook.html
    │   ├── customers.html
    │   ├── purchases.html
    │   ├── inventory.html
    │   ├── yarn.html
    │   ├── transfers.html
    │   ├── waste.html
    │   ├── stock_report.html
    │   ├── master_products.html
    │   └── system_setting.html
    └── js/                              # Frontend ES Modules
        ├── app.js                       # SPA Router, View Cache, Global KPI & Shortcuts
        ├── core/                        # Core Services
        │   ├── api.js                   # Fetch Gateway, D1 Micro-Cache & Online Status
        │   ├── state.js                 # Auth & Multi-Branch State Manager
        │   ├── ui.js                    # Toast, Confirm Dialog, escapeHtml & escapeCsv
        │   └── pagination.js            # Reusable 15/30/50/100 Rows Pagination Controller
        └── modules/                     # 11 Business Logic Controllers
            ├── auth.js
            ├── dashboard.js
            ├── pos.js
            ├── cashbook.js
            ├── customers.js
            ├── purchases.js
            ├── inventory.js
            ├── yarn.js
            ├── transfers.js
            ├── waste.js
            ├── stock_report.js
            ├── master_products.js
            └── system_setting.js

