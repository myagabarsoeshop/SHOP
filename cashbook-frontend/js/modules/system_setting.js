<!-- cashbook-frontend/views/system_setting.html -->
<div class="h-full w-full flex flex-col gap-6 p-6 overflow-y-auto">
    <!-- Header Card -->
    <div class="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
            <h2 class="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <i class="fa-solid fa-sliders text-emerald-600"></i>
                စနစ် ဆက်တင်နှင့် အရင်းအမြစ် စောင့်ကြည့်မှု (SYSTEM SETTING)
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Cloudflare D1 Quota သုံးစွဲမှုနှင့် အလိုအလျောက် အီးမေးလ်ပို့ခြင်း စနစ်
            </p>
        </div>
        <button type="button" id="btn-refresh-quota" class="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-sm">
            <i class="fa-solid fa-arrows-rotate"></i>
            <span>ဒေတာ Refresh မည်</span>
        </button>
    </div>

    <!-- D1 Quota Resource Monitor Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-3">
                <span class="text-xs font-bold text-slate-500">D1 Read Operations</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">Safe</span>
            </div>
            <div id="quota-reads-val" class="text-2xl font-black font-mono text-slate-800 dark:text-slate-100 mb-2">0 / 100k</div>
            <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div id="quota-reads-bar" class="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style="width: 0%"></div>
            </div>
        </div>

        <div class="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-3">
                <span class="text-xs font-bold text-slate-500">D1 Write Operations</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">Normal</span>
            </div>
            <div id="quota-writes-val" class="text-2xl font-black font-mono text-slate-800 dark:text-slate-100 mb-2">0 / 100k</div>
            <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div id="quota-writes-bar" class="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style="width: 0%"></div>
            </div>
        </div>

        <div class="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-3">
                <span class="text-xs font-bold text-slate-500">Database Storage</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">Free Tier</span>
            </div>
            <div id="quota-storage-val" class="text-2xl font-black font-mono text-slate-800 dark:text-slate-100 mb-2">0 MB / 5 GB</div>
            <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div id="quota-storage-bar" class="bg-purple-500 h-1.5 rounded-full transition-all duration-500" style="width: 0%"></div>
            </div>
        </div>

        <div class="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <div class="flex items-center justify-between mb-3">
                <span class="text-xs font-bold text-slate-500">Cloudflare D1 Plan</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Active</span>
            </div>
            <div class="text-xl font-black text-emerald-600 mb-1">Free Tier</div>
            <div class="text-[11px] text-slate-400">လုံလောက်မှု အခြေအနေ: ကောင်းမွန်</div>
        </div>
    </div>

    <!-- Automated Email Report Dispatcher Section -->
    <div class="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
            <i class="fa-solid fa-envelope text-emerald-600"></i>
            နှစ်အလိုက် အစီရင်ခံစာများ အလိုအလျောက် အီးမေးလ်ပို့ခြင်း (Excel Auto-Email)
        </h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-6">
            သတ်မှတ်ထားသော နှစ်အလိုက် Financial & Stock Reports များကို Excel ဖိုင်ဖြင့် တိုက်ရိုက် အီးမေးလ်ပို့မည်
        </p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">အစီရင်ခံမည့် နှစ် (Year) *</label>
                <select id="setting-report-year" class="w-full px-3 py-2.5 text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 dark:text-slate-100">
                    <!-- Loaded dynamically -->
                </select>
            </div>

            <div>
                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">လက်ခံမည့် အီးမေးလ် (Recipient Email) *</label>
                <input type="email" id="setting-recipient-email" value="myagabarsoeshop@gmail.com" 
                    class="w-full px-3 py-2.5 text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 dark:text-slate-100">
            </div>

            <div>
                <button type="button" id="btn-send-auto-email" class="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow-md shadow-blue-600/20 transition flex items-center justify-center gap-2 cursor-pointer">
                    <i class="fa-solid fa-paper-plane"></i>
                    <span>Excel ဖြင့် အီးမေးလ်ပို့မည်</span>
                </button>
            </div>
        </div>
    </div>
</div>
