// cashbook-frontend/js/modules/pos.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

let productsList = [];
let cart = [];
let currentSaleType = "retail";
let selectedPaymentMethod = "cash";
let currentCategory = ""; // ရွေးချယ်ထားသော Category ကို မှတ်သားရန်

export async function initPOS() {
    bindEvents();
    await loadProducts();
    await loadCustomers();
    renderCart();
}

/**
 * ၁။ အထည်ပစ္စည်းများ API မှ ခေါ်ယူခြင်း
 */
async function loadProducts(search = "", category = "") {
    const grid = document.getElementById("pos-product-grid");
    const loading = document.getElementById("pos-loading");
    const empty = document.getElementById("pos-empty");

    loading?.classList.remove("hidden");
    empty?.classList.add("hidden");
    if (grid) grid.innerHTML = "";

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId, search, category });
        productsList = res.data || [];
        renderProductsGrid(productsList);
    } catch (err) {
        console.error("Failed to load products:", err);
    } finally {
        loading?.classList.add("hidden");
    }
}

/**
 * ၂။ ပစ္စည်းကတ်များ Grid ပုံစံဖြင့် Render လုပ်ခြင်း
 */
function renderProductsGrid(products) {
    const grid = document.getElementById("pos-product-grid");
    const empty = document.getElementById("pos-empty");
    if (!grid) return;

    grid.innerHTML = "";
    if (products.length === 0) {
        empty?.classList.remove("hidden");
        return;
    }

    products.forEach(p => {
        const price = currentSaleType === "retail" ? p.retail_price : p.wholesale_price;
        const stock = p.current_stock || 0;
        const isOutOfStock = stock <= 0;

        const card = document.createElement("div");
        card.className = `bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-emerald-500 transition cursor-pointer flex flex-col justify-between ${isOutOfStock ? 'opacity-50' : ''}`;
        
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">${p.category}</span>
                    <span class="text-xs font-mono font-bold ${stock < 5 ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}">လက်ကျန်: ${stock}</span>
                </div>
                <div class="text-sm font-bold text-slate-800 dark:text-white line-clamp-2">${p.item_name} ${p.pattern ? `(${p.pattern})` : ''}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">${p.color || ''} • ${p.size}</div>
            </div>
            <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span class="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">${Number(price).toLocaleString()} Ks</span>
                <button class="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600 hover:text-white flex items-center justify-center transition">
                    <i class="fa-solid fa-plus text-xs"></i>
                </button>
            </div>
        `;

        card.addEventListener("click", () => addToCart(p));
        grid.appendChild(card);
    });
}

/**
 * ၃။ ခြင်းတောင်းထဲသို့ ထည့်သွင်းခြင်း
 */
function addToCart(product) {
    const existing = cart.find(item => item.product.id === product.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        const price = currentSaleType === "retail" ? product.retail_price : product.wholesale_price;
        cart.push({
            product,
            quantity: 1,
            unitPrice: price,
            costPrice: product.cost_price
        });
    }
    renderCart();
}

/**
 * ၄။ ခြင်းတောင်း စာရင်းတွက်ချက်ခြင်းနှင့် ပြသခြင်း
 */
function renderCart() {
    const container = document.getElementById("pos-cart-items");
    const subtotalEl = document.getElementById("pos-subtotal");
    const finalTotalEl = document.getElementById("pos-final-total");
    const checkoutBtn = document.getElementById("btn-pos-checkout");
    const discountInput = document.getElementById("pos-discount");
    const discountDisplay = document.getElementById("pos-discount-display");

    if (!container) return;
    container.innerHTML = "";

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-56 text-slate-400">
                <i class="fa-solid fa-cart-shopping text-4xl mb-3 text-slate-300 dark:text-slate-700"></i>
                <span class="text-sm font-medium">ခြင်းတောင်းထဲတွင် ပစ္စည်းမရှိသေးပါ</span>
            </div>
        `;
        if (subtotalEl) subtotalEl.textContent = "0 Ks";
        if (finalTotalEl) finalTotalEl.textContent = "0 Ks";
        if (checkoutBtn) checkoutBtn.disabled = true;
        return;
    }

    let subtotal = 0;
    cart.forEach((item, index) => {
        const lineTotal = item.quantity * item.unitPrice;
        subtotal += lineTotal;

        const row = document.createElement("div");
        row.className = "py-3.5 flex items-center justify-between gap-3";
        row.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="text-sm font-bold text-slate-800 dark:text-white truncate">${item.product.item_name}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 font-mono">${Number(item.unitPrice).toLocaleString()} Ks</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button data-idx="${index}" class="btn-qty-minus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 text-sm font-bold">-</button>
                <span class="w-7 text-center text-sm font-bold font-mono dark:text-white">${item.quantity}</span>
                <button data-idx="${index}" class="btn-qty-plus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 text-sm font-bold">+</button>
            </div>
            <div class="text-right shrink-0 w-24">
                <div class="text-sm font-bold text-slate-800 dark:text-white font-mono">${Number(lineTotal).toLocaleString()} Ks</div>
                <button data-idx="${index}" class="btn-remove-item text-xs text-rose-500 hover:text-rose-700 font-medium">ဖယ်မည်</button>
            </div>
        `;
        container.appendChild(row);
    });

    const discount = parseFloat(discountInput?.value) || 0;
    const finalTotal = Math.max(0, subtotal - discount);

    if (subtotalEl) subtotalEl.textContent = `${subtotal.toLocaleString()} Ks`;
    if (discountDisplay) discountDisplay.textContent = `-${discount.toLocaleString()} Ks`;
    if (finalTotalEl) finalTotalEl.textContent = `${finalTotal.toLocaleString()} Ks`;
    if (checkoutBtn) checkoutBtn.disabled = false;

    container.querySelectorAll(".btn-qty-plus").forEach(btn => {
        btn.onclick = () => { cart[btn.dataset.idx].quantity += 1; renderCart(); };
    });
    container.querySelectorAll(".btn-qty-minus").forEach(btn => {
        btn.onclick = () => {
            const idx = btn.dataset.idx;
            if (cart[idx].quantity > 1) cart[idx].quantity -= 1;
            else cart.splice(idx, 1);
            renderCart();
        };
    });
    container.querySelectorAll(".btn-remove-item").forEach(btn => {
        btn.onclick = () => { cart.splice(btn.dataset.idx, 1); renderCart(); };
    });
}

/**
 * ၅။ Button Events များ ချိတ်ဆက်ခြင်း
 */
function bindEvents() {
    const searchInput = document.getElementById("pos-search-input");
    const retailBtn = document.getElementById("btn-type-retail");
    const wholesaleBtn = document.getElementById("btn-type-wholesale");
    const discountInput = document.getElementById("pos-discount");
    const checkoutBtn = document.getElementById("btn-pos-checkout");
    const modal = document.getElementById("checkout-modal");
    const closeModalBtn = document.getElementById("btn-close-modal");
    const confirmSaleBtn = document.getElementById("btn-confirm-sale");

    // ၅.၁ Category Tabs နှိပ်၍ စစ်ထုတ်ခြင်း
    document.querySelectorAll(".cat-pill").forEach(btn => {
        btn.addEventListener("click", () => {
            // ခလုတ်အားလုံးကို မူလအရောင်ပြောင်းမည်
            document.querySelectorAll(".cat-pill").forEach(b => {
                b.className = "cat-pill px-4 py-3 text-sm font-bold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 transition";
            });
            // နှိပ်လိုက်သော ခလုတ်ကို Active အရောင်ပြောင်းမည်
            btn.className = "cat-pill active px-4 py-3 text-sm font-bold rounded-xl bg-slate-900 dark:bg-emerald-600 text-white transition shadow-sm";
            
            currentCategory = btn.dataset.cat;
            loadProducts(searchInput?.value.trim() || "", currentCategory);
        });
    });

    // ၅.၂ Search Box ဖြင့် ရှာဖွေခြင်း
    let debounceTimer;
    searchInput?.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            loadProducts(e.target.value.trim(), currentCategory);
        }, 300);
    });

    // Scanner 'Enter' ဖြင့် အမြန်ထည့်ခြင်း
    searchInput?.addEventListener("keypress", async (e) => {
        if (e.key === "Enter") {
            const code = searchInput.value.trim();
            if (!code) return;
            try {
                const branchId = state.currentBranch?.id || 1;
                const res = await api.get("/products/scan", { code, branch_id: branchId });
                if (res.data) {
                    addToCart(res.data);
                    searchInput.value = "";
                }
            } catch (err) {}
        }
    });

    // ၅.၃ Retail / Wholesale ပြောင်းလဲခြင်း
    retailBtn?.addEventListener("click", () => {
        currentSaleType = "retail";
        retailBtn.className = "px-4 py-1.5 rounded-lg bg-white dark:bg-emerald-600 text-slate-900 dark:text-white shadow-sm transition";
        wholesaleBtn.className = "px-4 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 transition";
        updatePricesForSaleType();
    });
    wholesaleBtn?.addEventListener("click", () => {
        currentSaleType = "wholesale";
        wholesaleBtn.className = "px-4 py-1.5 rounded-lg bg-white dark:bg-emerald-600 text-slate-900 dark:text-white shadow-sm transition";
        retailBtn.className = "px-4 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 transition";
        updatePricesForSaleType();
    });

    discountInput?.addEventListener("input", renderCart);
    checkoutBtn?.addEventListener("click", openCheckoutModal);
    closeModalBtn?.addEventListener("click", () => modal?.classList.add("hidden"));

    // ၅.၄ Payment Methods ရွေးချယ်ခြင်း
    document.querySelectorAll(".method-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".method-btn").forEach(b => {
                b.className = "method-btn p-4 rounded-2xl border-2 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-bold flex flex-col items-center gap-2 hover:border-slate-400 transition cursor-pointer";
            });
            btn.className = "method-btn active p-4 rounded-2xl border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-300 text-sm font-bold flex flex-col items-center gap-2 transition cursor-pointer";
            
            selectedPaymentMethod = btn.dataset.method;
            const bankGroup = document.getElementById("bank-input-group");
            if (selectedPaymentMethod === "bank") bankGroup?.classList.remove("hidden");
            else bankGroup?.classList.add("hidden");

            const paidInput = document.getElementById("modal-paid-amount");
            const dueAmount = getFinalTotal();
            if (selectedPaymentMethod === "credit") paidInput.value = 0;
            else paidInput.value = dueAmount;
            calculateChange();
        });
    });

    document.getElementById("modal-paid-amount")?.addEventListener("input", calculateChange);
    confirmSaleBtn?.addEventListener("click", submitSale);
}

function updatePricesForSaleType() {
    cart.forEach(item => {
        item.unitPrice = currentSaleType === "retail" ? item.product.retail_price : item.product.wholesale_price;
    });
    renderCart();
    renderProductsGrid(productsList);
}

function getFinalTotal() {
    let subtotal = cart.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
    let discount = parseFloat(document.getElementById("pos-discount")?.value) || 0;
    return Math.max(0, subtotal - discount);
}

function openCheckoutModal() {
    const modal = document.getElementById("checkout-modal");
    const dueEl = document.getElementById("modal-due-amount");
    const paidInput = document.getElementById("modal-paid-amount");
    const finalTotal = getFinalTotal();

    if (dueEl) dueEl.textContent = `${finalTotal.toLocaleString()} Ks`;
    if (paidInput) paidInput.value = finalTotal;

    calculateChange();
    modal?.classList.remove("hidden");
}

function calculateChange() {
    const finalTotal = getFinalTotal();
    const paid = parseFloat(document.getElementById("modal-paid-amount")?.value) || 0;
    const changeBox = document.getElementById("modal-debt-change-box");
    const changeText = document.getElementById("modal-change-text");

    if (paid >= finalTotal) {
        changeBox.className = "p-4 rounded-xl text-sm flex justify-between font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
        changeText.textContent = `+${(paid - finalTotal).toLocaleString()} Ks`;
    } else {
        changeBox.className = "p-4 rounded-xl text-sm flex justify-between font-bold bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300";
        changeText.textContent = `အကြွေးကျန်: ${(finalTotal - paid).toLocaleString()} Ks`;
    }
}

/**
 * ၆။ အရောင်းဘောင်ချာ အတည်ပြု သိမ်းဆည်းခြင်း
 */
async function submitSale() {
    const btn = document.getElementById("btn-confirm-sale");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>သိမ်းဆည်းနေပါသည်...</span>`;

    try {
        const finalTotal = getFinalTotal();
        const paidAmount = parseFloat(document.getElementById("modal-paid-amount")?.value) || 0;
        const customerId = document.getElementById("pos-customer-select")?.value || null;
        const discountAmount = parseFloat(document.getElementById("pos-discount")?.value) || 0;
        const bankName = document.getElementById("modal-bank-name")?.value;

        const payload = {
            branchId: state.currentBranch?.id || 1,
            customerId: customerId ? parseInt(customerId) : null,
            saleType: currentSaleType,
            items: cart.map(i => ({
                productId: i.product.id,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                costPrice: i.costPrice
            })),
            discountAmount,
            paidAmount,
            paymentMethod: selectedPaymentMethod,
            cashAmount: selectedPaymentMethod === "cash" ? paidAmount : 0,
            bankAmount: selectedPaymentMethod === "bank" ? paidAmount : 0,
            bankAccountName: selectedPaymentMethod === "bank" ? bankName : null,
            createdBy: state.user?.id || 1
        };

        const res = await api.post("/pos/sales", payload);

        if (res.success) {
            alert(`အရောင်းဘောင်ချာ အောင်မြင်စွာ ဖွင့်ပြီးပါပြီ!\nဘောင်ချာအမှတ်: ${res.data.invoiceNo}`);
            cart = [];
            document.getElementById("pos-discount").value = 0;
            document.getElementById("checkout-modal")?.classList.add("hidden");
            renderCart();
            await loadProducts(); // Update latest inventory count
        }
    } catch (err) {
        alert(`ချို့ယွင်းချက်ဖြစ်ပေါ်ပါသည်: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check text-lg"></i> <span>အရောင်း အတည်ပြုမည်</span>`;
    }
}

async function loadCustomers() {
    // ဤနေရာတွင် Customer များ ခေါ်ယူမည့် API ကို ထည့်သွင်းနိုင်ပါသည်
}
