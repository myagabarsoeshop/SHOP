<!-- cashbook-frontend/views/pos.html -->
<div class="flex h-full w-full overflow-hidden bg-slate-100 dark:bg-slate-950">
    
    <!-- Left Section: အထည်ပစ္စည်းများ ရှာဖွေမှုနှင့် ပစ္စည်းကတ်များ (62%) -->
    <div class="flex-1 flex flex-col h-full border-r border-slate-200 dark:border-slate-800 overflow-hidden">
        
        <!-- Search & Category Filter Header -->
        <div class="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center gap-4 shrink-0 shadow-sm">
            <!-- Barcode & Search Input (စာလုံးကြီး) -->
            <div class="relative flex-1">
                <span class="absolute inset-y-0 left-0 flex items-center pl-4 text-emerald-600 dark:text-emerald-400">
                    <i class="fa-solid fa-barcode text-xl"></i>
                </span>
                <input type="text" id="pos-search-input" autofocus
                    placeholder="Barcode စကင်ဖတ်ပါ သို့မဟုတ် အထည်ကုတ် / အမည် ရိုက်ရှာပါ..."
                    class="w-full pl-12 pr-10 py-3.5 text-base font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white rounded-2xl focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition shadow-inner placeholder:text-slate-400" />
            </div>

            <!-- Category Pills -->
            <div class="flex items-center gap-2 overflow-x-auto" id="pos-category-filters">
                <button data-cat="" class="cat-pill active px-4 py-3 text-sm font-bold rounded-xl bg-slate-900 dark:bg-emerald-600 text-white transition shadow-sm">အားလုံး</button>
                <button data-cat="ပုဆိုး" class="cat-pill px-4 py-3 text-sm font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition">ပုဆိုး</button>
                <button data-cat="လုံချည်" class="cat-pill px-4 py-3 text-sm font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition">လုံချည်</button>
                <button data-cat="အင်္ကျီ" class="cat-pill px-4 py-3 text-sm font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition">အင်္ကျီ</button>
            </div>
        </div>

        <!-- Products Grid Container -->
        <div class="flex-1 overflow-y-auto p-5">
            <div id="pos-product-grid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <!-- Products will be loaded dynamically -->
            </div>

            <div id="pos-loading" class="hidden flex flex-col items-center justify-center h-64 text-slate-400">
                <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-emerald-600"></i>
                <span class="text-base font-semibold">ပစ္စည်းများ ရှာဖွေနေပါသည်...</span>
            </div>
            <div id="pos-empty" class="hidden flex flex-col items-center justify-center h-64 text-slate-400">
                <i class="fa-solid fa-box-open text-4xl mb-3 text-slate-300"></i>
                <span class="text-base font-semibold">ပစ္စည်းစာရင်း မတွေ့ရှိပါ</span>
            </div>
        </div>
    </div>

    <!-- Right Section: Cart / အရောင်းဘောင်ချာ ကောင်တာ Panel (38%) -->
    <div class="w-[450px] bg-white dark:bg-slate-900 flex flex-col h-full shadow-2xl shrink-0 z-10 border-l border-slate-200 dark:border-slate-800">
        
        <!-- Cart Top Header: Type Switch & Customer -->
        <div class="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 space-y-3.5 shrink-0">
            <div class="flex items-center justify-between">
                <span class="text-base font-bold text-slate-800 dark:text-white flex items-center gap-2.5">
                    <i class="fa-solid fa-bag-shopping text-emerald-600 dark:text-emerald-400 text-lg"></i>
                    <span>အရောင်းဘောင်ချာ</span>
                </span>
                <!-- Retail vs Wholesale Switch -->
                <div class="inline-flex bg-slate-200 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
                    <button id="btn-type-retail" class="px-4 py-1.5 rounded-lg bg-white dark:bg-emerald-600 text-slate-800 dark:text-white shadow-sm transition">လက်လီ</button>
                    <button id="btn-type-wholesale" class="px-4 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 transition">လက်ကား</button>
                </div>
            </div>

            <!-- Customer Selection -->
            <div class="flex items-center gap-2">
                <div class="relative flex-1">
                    <select id="pos-customer-select" class="w-full text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="">👤 အမည်မဖော်ပြထားသော ဖောက်သည် (Walk-in)</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- Cart Items List (Scrollable) -->
        <div id="pos-cart-items" class="flex-1 overflow-y-auto p-4 divide-y divide-slate-100 dark:divide-slate-800"></div>

        <!-- Cart Summary & Big Totals (စာလုံးအကြီးကြီးများ) -->
        <div class="p-5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
            <div class="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                <span class="font-medium">ကျသင့်ငွေ စုစုပေါင်း:</span>
                <span id="pos-subtotal" class="font-bold text-slate-800 dark:text-white font-mono text-base">0 Ks</span>
            </div>
            <div class="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                <span class="flex items-center gap-2">
                    <span>လျှော့ငွေ:</span>
                    <input type="number" id="pos-discount" value="0" min="0" class="w-24 text-right text-sm font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-600 font-mono">
                </span>
                <span id="pos-discount-display" class="font-mono text-rose-600 font-bold">-0 Ks</span>
            </div>
            
            <!-- Final Big Total Display -->
            <div class="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span class="text-sm font-black text-slate-900 dark:text-white uppercase">ပေးချေရမည့်ငွေ:</span>
                <span id="pos-final-total" class="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">0 Ks</span>
            </div>

            <!-- Big Pay Now Button -->
            <button id="btn-pos-checkout" disabled
                class="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:cursor-not-allowed active:scale-[0.99] text-white font-bold text-base rounded-2xl shadow-xl shadow-emerald-600/25 transition flex items-center justify-center gap-3 cursor-pointer">
                <i class="fa-solid fa-money-bill-wave text-xl"></i>
                <span>ငွေရှင်းမည် (Pay Now)</span>
            </button>
        </div>
    </div>
</div>

<!-- Payment Modal Popup -->
<div id="checkout-modal" class="hidden fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-800">
        <div class="p-6 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between">
            <div class="text-base font-bold flex items-center gap-2.5">
                <i class="fa-solid fa-receipt text-emerald-400 text-lg"></i>
                <span>ငွေပေးချေမှု နည်းလမ်း ရွေးချယ်ခြင်း</span>
            </div>
            <button id="btn-close-modal" class="text-slate-400 hover:text-white text-lg"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="p-6 space-y-5">
            <!-- Big Total Due -->
            <div class="text-center p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-100 dark:border-emerald-800">
                <div class="text-xs text-emerald-700 dark:text-emerald-300 font-semibold mb-1">ကျသင့်ငွေ စုစုပေါင်း</div>
                <div id="modal-due-amount" class="text-3xl font-black text-emerald-700 dark:text-emerald-400 font-mono">0 Ks</div>
            </div>

            <!-- Payment Method Radio Buttons -->
            <div>
                <label class="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">ငွေပေးချေသည့် နည်းလမ်း ရွေးပါ</label>
                <div class="grid grid-cols-3 gap-3" id="payment-method-selector">
                    <button type="button" data-method="cash" class="method-btn active p-4 rounded-2xl border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 text-sm font-bold flex flex-col items-center gap-2 transition cursor-pointer">
                        <i class="fa-solid fa-money-bill-1-wave text-xl"></i>
                        <span>ငွေသား (Cash)</span>
                    </button>
                    <button type="button" data-method="bank" class="method-btn p-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold flex flex-col items-center gap-2 hover:border-slate-300 transition cursor-pointer">
                        <i class="fa-solid fa-building-columns text-xl"></i>
                        <span>Bank / KPay</span>
                    </button>
                    <button type="button" data-method="credit" class="method-btn p-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold flex flex-col items-center gap-2 hover:border-slate-300 transition cursor-pointer">
                        <i class="fa-solid fa-hand-holding-dollar text-xl"></i>
                        <span>အကြွေး (Credit)</span>
                    </button>
                </div>
            </div>

            <!-- Bank Selection -->
            <div id="bank-input-group" class="hidden">
                <label class="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">ဘဏ် / Mobile Pay ရွေးပါ</label>
                <select id="modal-bank-name" class="w-full text-sm font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:text-white rounded-xl px-4 py-3">
                    <option value="KBZPay">KBZPay (KPay)</option>
                    <option value="WavePay">WavePay</option>
                    <option value="KBZ Bank">KBZ Bank</option>
                    <option value="CB Bank">CB Bank</option>
                    <option value="AYA Bank">AYA Bank</option>
                </select>
            </div>

            <!-- Paid Amount Input -->
            <div>
                <label class="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">လက်ခံရရှိငွေ (Paid Amount)</label>
                <input type="number" id="modal-paid-amount" class="w-full text-lg font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-600">
            </div>

            <!-- Debt / Change Box -->
            <div id="modal-debt-change-box" class="p-4 rounded-xl text-sm flex justify-between font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                <span>ပြန်အမ်းငွေ / အကြွေးကျန်:</span>
                <span id="modal-change-text" class="font-mono text-base">0 Ks</span>
            </div>

            <!-- Confirm Button -->
            <button id="btn-confirm-sale" class="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base rounded-2xl shadow-xl shadow-emerald-600/30 transition flex items-center justify-center gap-2 cursor-pointer">
                <i class="fa-solid fa-check text-lg"></i>
                <span>အရောင်း အတည်ပြုမည်</span>
            </button>
        </div>
    </div>
</div>
