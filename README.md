# မြကမ္ဘာစိုး ပိုးထည်တိုက် — Multi-Store Garment POS, Inventory & Cashbook ERP (v4.1.0)

Cloudflare Workers (Serverless Backend) နှင့် Cloudflare D1 (SQLite Edge Database) ပေါ်တွင် အခြေခံတည်ဆောက်ထားသော ဆိုင်ခွဲပေါင်းစုံသုံး ပိုးထည်နှင့် အထည်ဆိုင် စီမံခန့်ခွဲရေးစနစ် (All-in-One Garment ERP) ဖြစ်ပါသည်။

---

## ✨ အဓိက လုပ်ဆောင်ချက်များ (Key Enterprise Features - v4.1.0)

1. **Sale Counter (POS) & 80mm Thermal Receipt:**
   - လက်လီ (Retail) နှင့် လက်ကား (Wholesale) ဈေးနှုန်း တစ်ပြိုင်နက် သတ်မှတ်ရောင်းချနိုင်ခြင်း။
   - ငွေပေးချေမှု စနစ် (၄) မျိုး — **ငွေသား (Cash)**၊ **KPay/ဘဏ် (Bank)**၊ **နှစ်မျိုးပေါင်း (Split: Cash + Bank)** နှင့် **အကြွေး (Credit)**။
   - Barcode Scanner (`Enter` Auto-Add)၊ 80mm ဘောင်ချာပရင့်ထုတ်ခြင်းနှင့် ယနေ့အရောင်းဘောင်ချာ ပြန်ဖျက်ခြင်း (`Void / Cancel` — စတော့၊ `stock_movements` Ledger (`SALE_VOID_IN`)၊ ငွေစာရင်းနှင့် အကြွေး အလိုအလျောက် ပြန်ညှိပေးသည့်စနစ်)။

2. **Purchases & Supplier Payables Sync (အဝယ်၊ ကိုယ်ပိုင်ထုတ် နှင့် စတော့အဝင်):**
   - `invoice_sequences` ဇယားကို သုံး၍ Concurrent 50+ ပြိုင်တူခေါ်လျှင်ပင် လုံးဝ မထပ်နိုင်သော `{PREFIX}-{BRANCH_CODE}-{YYMMDD}-{SEQ}` ပုံစံဖြင့် ဘောင်ချာနံပါတ် (`VR NO`) အလိုအလျောက် ထုတ်ပေးခြင်း။
   - ပစ္စည်းတန်ဖိုး (`Items Total`)၊ အမှန်ပေးငွေ (`Actual Paid`) နှင့် ပိုငွေ/လိုငွေ (`Surplus & Deficit`) အလိုအလျောက် တွက်ချက်ပြီး လိုငွေ/အကြွေးဖြစ်ပါက ပွဲရုံပေးရန်ကျန်ငွေစာရင်း (`supplier_ledger`) သို့ တိုက်ရိုက်ချိတ်ဆက်ပေးခြင်း။
   - ကိုယ်ပိုင်ရက်ကန်း/ထုတ်လုပ်မှု (`OWN_PRODUCTION`) စတော့အဝင်ကို ငွေစာရင်းနှင့် အကြွေးမထိဘဲ သီးသန့် မှတ်တမ်းတင်နိုင်ခြင်း။

3. **Append-Only Stock Movements Ledger (`stock_movements` - Source of Truth):**
   - စတော့ပြောင်းလဲမှုတိုင်း (`OPENING`, `PURCHASE_IN`, `PURCHASE_VOID_OUT`, `SALE_OUT`, `SALE_VOID_IN`, `TRANSFER_OUT`, `TRANSFER_IN`, `WASTE_OUT`, `YARN_ISSUE_OUT`, `YARN_RETURN_IN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`) ကို `stock_movements` ဇယားတွင် Append-only မှတ်တမ်းတင်ပြီး `branch_inventory.quantity` နှင့် `env.DB.batch()` ဖြင့် တစ်ပြိုင်နက် (Atomic) အပ်ဒိတ်လုပ်ပေးခြင်း။
   - ညစဉ် မြန်မာစံတော်ချိန် `00:00 MMT` Cron Job ဖြင့် `SUM(stock_movements.quantity)` နှင့် `branch_inventory.quantity` ကိုက်ညီမှု ရှိ/မရှိ အလိုအလျောက် စစ်ဆေးပေးခြင်း (Nightly Reconciliation)။

4. **Opening Stock & Physical Stock Count / Adjustments Workflow:**
   - **Product Master နှင့် Stock သီးသန့်ခွဲထုတ်ခြင်း:** Product Master ဖန်တီး/ပြင်ဆင်သည့် ဖောင်မှ လက်ကျန်စတော့ တိုက်ရိုက်ပြင်ဆင်ခွင့်ကို ပိတ်ထားပါသည်။
   - **Opening Stock Workflow:** ဆိုင်ခွဲတာဝန်ခံ (`branch_manager`) က မူကြမ်း (`draft`) ဖန်တီး ➔ `submit` တင် ➔ `admin` သို့မဟုတ် `finance` မှ `approve` / `reject` (အကြောင်းပြချက်ဖြင့်) ပြုလုပ်နိုင်ခြင်း (ဆိုင်ခွဲတစ်ခုလျှင် Approved Opening တစ်ကြိမ်သာ ခွင့်ပြုသည်)။
   - **Stock Count & Adjustment Workflow:** မြေပြင်ရေတွက်လက်ကျန် (`counted_qty`) နှင့် စနစ်လက်ကျန် (`system_qty`) ကွဲလွဲသော ပစ္စည်းတိုင်းအတွက် အကြောင်းရင်း (`reason`) မဖြစ်မနေ လိုအပ်ပြီး၊ ကွဲလွဲမှုတန်ဖိုး **ကျပ် 50,000 အထက်** ဖြစ်ပါက `admin` တစ်ဦးတည်းသာ Approve လုပ်နိုင်ခြင်း။

5. **Inter-Branch Stock Transfers (State Machine) & Waste / Yarn Logs:**
   - ဆိုင်ခွဲလွှဲပြောင်းမှု State Machine: `pending` ➔ `dispatched` (`TRANSFER_OUT` ဖြင့် ထွက်ဆိုင်မှ စတော့နုတ်) ➔ `received` (`TRANSFER_IN` ဖြင့် ဝင်ဆိုင်သို့ စတော့ပေါင်း) ➔ `completed` / `cancelled` (Dispatched ပြီးမှ Cancel လုပ်ပါက ထွက်ဆိုင်သို့ Reversal `TRANSFER_IN` အလိုအလျောက် ပြန်ပေါင်းထည့်ပေးခြင်း)။
   - `stock_movements` ပေါ်မှ SQL Query တစ်ခုတည်းဖြင့် တွက်ချက်ထားသော ၁၂ လချုပ် စတော့အဝင်/အထွက်၊ Adjustment တန်ဖိုး (`ADJ VALUE`) နှင့် လက်ကျန်တန်ဖိုး အစီရင်ခံစာ (`Stock Report`)။

6. **Multi-Store Cashbook & Dual Debt Ledgers:**
   - ဆိုင်ခွဲအလိုက် ငွေသားလက်ကျန် (`Cash Balance`)၊ ဘဏ်လက်ကျန် (`Bank Balance`)၊ ဆိုင်အသုံးစရိတ် (`Total Expense`) နှင့် ပိုင်ရှင်ထံအပ်ငွေ (`Owner Remittance`) တို့ကို သီးသန့်ခွဲခြား တွက်ချက်ပေးခြင်း။
   - ဖောက်သည်အကြွေး (`Receivables`) နှင့် ပွဲရုံကုန်ကြွေး (`Payables`) နှစ်မျိုးလုံးကို စီမံခန့်ခွဲနိုင်ပြီး A4 Account Statement ပရင့်ထုတ်နိုင်ခြင်း။

7. **Security Hardening, Strict RBAC & D1 Free Tier Optimization (v4.1.0):**
   - **Roles (`admin`, `finance`, `branch_manager`, `cashier`):** Route တိုင်းတွင် Permission Matrix (`can()` / `requirePermission()`) နှင့် Branch Scoping (`resolveBranchId()`) ဖြင့် တိကျစွာ စစ်ဆေးခြင်း။
   - **`ALL` View Read-Only Guard:** ဆိုင်ခွဲအားလုံး (`ALL`) ကြည့်ရှုချိန်တွင် Write လုပ်ဆောင်ချက်အားလုံးကို ပိတ်ထားပြီး ဆိုင် (၁) သို့ မှားယွင်းစာရင်းဝင်ခြင်းမှ ကာကွယ်ထားခြင်း။
   - **Cashier Cost Privacy:** Cashier အကောင့်များအတွက် API Response တွင် `cost_price` ကို အပြီးတိုင် ဖယ်ရှားပေးထားခြင်း။
   - **Zero Plaintext Password:** `users` ဇယားမှ `plain_password` ကို အပြီးတိုင် ဖယ်ရှားပြီး PBKDF2-HMAC-SHA256 (100,000 iterations) နှင့် Token Version Revocation စနစ် သုံးထားခြင်း။
   - **D1 Quota Optimization:** Composite Indexes၊ `env.DB.batch()` Atomic Transactions၊ Date-bounded Queries၊ Frontend Request Deduplication နှင့် `meta.rows_read` monitoring တို့ဖြင့် D1 Free Tier (500 MB per DB / 5M reads per day) အတွင်း အမြင့်ဆုံး စွမ်းဆောင်ရည် ရရှိစေခြင်း။

---

## 📁 ဖိုလ်ဒါ ဖွဲ့စည်းပုံ (Project Structure)

```text
├── wrangler.toml                        # Cloudflare Worker, Assets, D1, Cron & Staging Configuration (v4.1.0)
├── README.md                            # System Documentation (v4.1.0)
├── cashbook-api/                        # Modular Cloudflare Worker Backend (5 Files)
│   ├── worker.js                        # Main Entrypoint, Auth, Ledger Stock Report, Dashboard & Cron
│   ├── utils.js                         # RBAC Matrix (can), Branch Scoping, Invoice Seq, Math & JWT
│   ├── routes-inventory.js              # Branches, Products, Transfers State Machine, Waste, Yarn, Opening & Adjustments
│   ├── routes-transactions.js           # Purchases (Stock-In + Own Prod) & POS Sales (+ stock_movements)
│   ├── routes-finance.js                # Cashbook & Customers/Suppliers Ledgers
│   └── schema/
│       ├── 01_schema.sql                # Full D1 SQLite Schema & Composite Indexes (v4.1.0)
│       ├── 02_seed.sql                  # Initial 5 Branches & 11 Cash Categories Seed
│       └── 03_migration_v4.sql          # Production Migration Script (Upgrades v3/v4 DB to v4.1.0)
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
        ├── app.js                       # SPA Router, Role Guard, ALL-Branch Read-Only Lock & MMT Clock
        ├── core/                        # Core Services
        │   ├── api.js                   # Fetch Gateway, snake_case <-> camelCase Mapper & Micro-Cache
        │   ├── state.js                 # Auth, RBAC Matrix & Strict Multi-Branch State Manager
        │   ├── ui.js                    # Toast, Confirm Dialog, statusBadge, escapeHtml & escapeCsv
        │   └── pagination.js            # Reusable 15/30/50/100 Rows Pagination Controller
        └── modules/                     # 12 Business Logic Controllers
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
