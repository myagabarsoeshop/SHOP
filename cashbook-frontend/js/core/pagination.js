// cashbook-frontend/js/core/pagination.js

/**
 * Reusable Pagination Controller
 * ဇယားများတွင် စာကြောင်း ၁၅ ကြောင်းစီ ခွဲထုတ်ပြသပေးမည့် ဘုံသုံး Helper
 */
export class PaginationController {
    /**
     * @param {Object} options
     * @param {number} [options.pageSize=15] - တစ်မျက်နှာလျှင် ပြသလိုသော စာကြောင်းအရေအတွက်
     * @param {Function} options.onPageChange - စာမျက်နှာပြောင်းလဲသည့်အခါ ဇယားပြန်ဆွဲပေးမည့် Callback function
     */
    constructor({ pageSize = 15, onPageChange }) {
        this.pageSize = pageSize;
        this.currentPage = 1;
        this.totalItems = 0;
        this.totalPages = 1;
        this.onPageChange = onPageChange;
    }

    /**
     * ဒေတာအသစ်ရောက်ရှိလာချိန်တွင် စုစုပေါင်းစာမျက်နှာကို တွက်ချက်ပေးခြင်း
     * @param {Array} allItems 
     */
    setItems(allItems = []) {
        this.totalItems = allItems.length;
        this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.pageSize));
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
    }

    /**
     * စာရင်း စစ်ထုတ်ရှာဖွေချိန်တွင် စာမျက်နှာ ၁ သို့ ပြန်လည် Reset ပြုလုပ်ခြင်း
     */
    reset() {
        this.currentPage = 1;
    }

    /**
     * လက်ရှိရောက်ရှိနေသော စာမျက်နှာအတွက် ဒေတာ (၁၅) ခုကို ဖြတ်ယူပေးခြင်း
     * @param {Array} allItems 
     * @returns {Array}
     */
    getPageItems(allItems = []) {
        this.setItems(allItems);
        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        return allItems.slice(startIndex, endIndex);
    }

    /**
     * သီးခြား စာမျက်နှာသို့ ကူးပြောင်းခြင်း
     * @param {number} pageNum 
     */
    goToPage(pageNum) {
        const targetPage = Math.max(1, Math.min(pageNum, this.totalPages));
        if (targetPage !== this.currentPage) {
            this.currentPage = targetPage;
            if (typeof this.onPageChange === "function") {
                this.onPageChange(this.currentPage);
            }
        }
    }

    /**
     * အောက်ခြေ Pagination UI Bar ကို DOM ထဲသို့ Render ပြုလုပ်ပေးခြင်း
     * @param {string|HTMLElement} containerIdOrElement - ထည့်သွင်းမည့် Container ID သို့မဟုတ် DOM Element
     */
    renderControls(containerIdOrElement) {
        const container = typeof containerIdOrElement === "string" 
            ? document.getElementById(containerIdOrElement) 
            : containerIdOrElement;

        if (!container) return;

        // စာရင်းလုံးဝ မရှိသေးပါက Pagination Bar ကို ဖျောက်ထားမည်
        if (this.totalItems === 0) {
            container.innerHTML = "";
            return;
        }

        const startRecord = (this.currentPage - 1) * this.pageSize + 1;
        const endRecord = Math.min(this.currentPage * this.pageSize, this.totalItems);

        // စာမျက်နှာခလုတ်များ တွက်ချက်ခြင်း (ဥပမာ - ၁၊ ၂၊ ၃ ...)
        const maxVisibleButtons = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisibleButtons / 2));
        let endPage = Math.min(this.totalPages, startPage + maxVisibleButtons - 1);

        if (endPage - startPage + 1 < maxVisibleButtons) {
            startPage = Math.max(1, endPage - maxVisibleButtons + 1);
        }

        let pageButtonsHtml = "";
        for (let p = startPage; p <= endPage; p++) {
            const isActive = p === this.currentPage;
            pageButtonsHtml += `
                <button type="button" data-page="${p}" class="pagination-btn min-w-[28px] h-7 px-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                    isActive 
                        ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 font-black" 
                        : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
                }">
                    ${p}
                </button>
            `;
        }

        // English စာသားနှင့် အောက်ခြေထိကပ် (Flush Bottom) ဒီဇိုင်း HTML
        container.innerHTML = `
            <div class="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 select-none">
                <!-- Info Status -->
                <div class="font-semibold text-slate-500 dark:text-slate-400">
                    Showing <span class="font-bold text-slate-900 dark:text-white font-mono">${startRecord}</span> to <span class="font-bold text-slate-900 dark:text-white font-mono">${endRecord}</span> of <span class="font-bold text-slate-900 dark:text-white font-mono">${this.totalItems.toLocaleString()}</span> entries
                </div>

                <!-- Navigation Controls -->
                <div class="flex items-center gap-1">
                    <!-- First Page -->
                    <button type="button" data-page="1" ${this.currentPage === 1 ? "disabled" : ""} title="First Page"
                        class="pagination-btn h-7 px-2 rounded-lg text-xs font-bold transition border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-slate-100 dark:hover:enabled:bg-slate-800">
                        <i class="fa-solid fa-angles-left"></i>
                    </button>

                    <!-- Previous Page -->
                    <button type="button" data-page="${this.currentPage - 1}" ${this.currentPage === 1 ? "disabled" : ""} title="Previous"
                        class="pagination-btn h-7 px-2.5 rounded-lg text-xs font-bold transition border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-slate-100 dark:hover:enabled:bg-slate-800 flex items-center gap-1">
                        <i class="fa-solid fa-angle-left"></i>
                        <span>Prev</span>
                    </button>

                    <!-- Numbered Pages -->
                    <div class="flex items-center gap-1">
                        ${pageButtonsHtml}
                    </div>

                    <!-- Next Page -->
                    <button type="button" data-page="${this.currentPage + 1}" ${this.currentPage === this.totalPages ? "disabled" : ""} title="Next"
                        class="pagination-btn h-7 px-2.5 rounded-lg text-xs font-bold transition border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-slate-100 dark:hover:enabled:bg-slate-800 flex items-center gap-1">
                        <span>Next</span>
                        <i class="fa-solid fa-angle-right"></i>
                    </button>

                    <!-- Last Page -->
                    <button type="button" data-page="${this.totalPages}" ${this.currentPage === this.totalPages ? "disabled" : ""} title="Last Page"
                        class="pagination-btn h-7 px-2 rounded-lg text-xs font-bold transition border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-slate-100 dark:hover:enabled:bg-slate-800">
                        <i class="fa-solid fa-angles-right"></i>
                    </button>
                </div>
            </div>
        `;

        // Click Event Bind ပြုလုပ်ခြင်း
        container.querySelectorAll(".pagination-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const targetBtn = e.currentTarget;
                if (targetBtn.disabled) return;
                const pageNum = parseInt(targetBtn.dataset.page, 10);
                if (!isNaN(pageNum)) {
                    this.goToPage(pageNum);
                }
            });
        });
    }
}
