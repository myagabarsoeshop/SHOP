// cashbook-frontend/js/modules/pos.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

let productsList = [];
let cart = [];
let currentSaleType = "retail"; // 'retail' သို့မဟုတ် 'wholesale'
let selectedPaymentMethod = "cash";

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
        card.className = `bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-emerald-500/50 transition cursor-pointer flex flex-col justify-between ${isOutOfStock ? 'opacity-50' : ''}`;
        
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between mb-1.5">
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">${p.category}</span>
                    <span class="text-[10px] font-mono font-medium ${stock < 5 ? 'text-rose-500 font-bold' : 'text-slate-400'}">လက်ကျန်: ${stock}</span>
                </div>
                <div class="text-xs font-bold text-slate-800 line-clamp-2">${p.item_name} ${p.pattern ? `(${p.pattern})` : ''}</div>
                <div class="text-[11px] text-slate-400 mt-0.5">${p.color || ''} • ${p.size}</div>
            </div>
            <div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                <span class="text-xs font-black text-emerald-600 font-mono">${Number(price).toLocaleString()} Ks</span>
                <button class="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white flex items-center justify-center transition">
                    <i class="fa-solid fa-plus text-[10px]"></i>
                </button>
            </div>
        `;

        card.addEventListener("click", () => addToCart(p));
        grid.appendChild(card);
    });
}

/**
 * ၃။ ခြင်းတောင်းထဲသို့ အထည်ထည့်သွင်းခြင်း
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
 * ၄။ ခြင်းတောင်းစာရင်း တွက်ချက်ခြင်းနှင့် Render လုပ်ခြင်း
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
            <div class="flex flex-col items-center justify-center h-48 text-slate-300">
                <i class="fa-solid fa-cart-shopping text-3xl mb-2"></i>
                <span class="text-xs">ခြင်းတောင်းထဲတွင် ပစ္စည်းမရှိသေးပါ</span>
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
        row.className = "py-3 flex items-center justify-between gap-2";
        row.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="text-xs font-bold text-slate-800 truncate">${item.product.item_name} ${item.product.category}</div>
                <div class="text-[11px] text-slate-400 font-mono">${Number(item.unitPrice).toLocaleString()} Ks</div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <button data-idx="${index}" class="btn-qty-minus w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-bold">-</button>
                <span class="w-6 text-center text-xs font-bold font-mono">${item.quantity}</span>
                <button data-idx="${index}" class="btn-qty-plus w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-bold">+</button>
            </div>
            <div class="text-right shrink-0 w-20">
                <div class="text-xs font-bold text-slate-800 font-mono">${Number(lineTotal).toLocaleString()} Ks</div>
                <button data-idx="${index}" class="btn-remove-item text-[10px] text-rose-500 hover:text-rose-700">ဖယ်မည်</button>
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

    // Cart Quantity Buttons Event Listeners
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
 * ၅။ Barcode Scanner Input နှင့် Button Events များ ချိတ်ဆက်ခြင်း
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

    // Scanner / Manual Search Event
    let debounceTimer;
    searchInput?.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            loadProducts(e.target.value.trim());
        }, 300);
    });

    // Barcode Scanner 'Enter' ခေါက်သည့်အခါ ပစ္စည်းတိုက်ရိုက်ပေါင်းထည့်ခြင်း
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
            } catch (err) {
                // Not found via direct barcode, standard search results will show
            }
        }
    });

    // Retail vs Wholesale ပြောင်းလဲခြင်း
    retailBtn?.addEventListener("click", () => {
        currentSaleType = "retail";
        retailBtn.className = "px-2.5 py-1 rounded-md bg-white text-slate-800 shadow-sm transition";
        wholesaleBtn.className = "px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-800 transition";
        updatePricesForSaleType();
    });
    wholesaleBtn?.addEventListener("click", () => {
        currentSaleType = "wholesale";
        wholesaleBtn.className = "px-2.5 py-1 rounded-md bg-white text-slate-800 shadow-sm transition";
        retailBtn.className = "px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-800 transition";
        updatePricesForSaleType();
    });

    discountInput?.addEventListener("input", renderCart);

    // Modal Events
    checkoutBtn?.addEventListener("click", openCheckoutModal);
    closeModalBtn?.addEventListener("click", () => modal?.classList.add("hidden"));

    // Payment Method Buttons
    document.querySelectorAll(".method-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".method-btn").forEach(b => {
                b.className = "method-btn p-3 rounded-xl border-2 border-slate-200 text-slate-600 text-xs font-bold flex flex-col items-center gap-1.5 hover:border-slate-300 transition";
            });
            btn.className = "method-btn active p-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 text-emerald-800 text-xs font-bold flex flex-col items-center gap-1.5 transition";
            
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

    // အရောင်း အတည်ပြုခြင်း (Checkout Submit)
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
        changeBox.className = "p-3 rounded-xl text-xs flex justify-between font-bold bg-emerald-50 text-emerald-800";
        changeText.textContent = `+${(paid - finalTotal).toLocaleString()} Ks`;
    } else {
        changeBox.className = "p-3 rounded-xl text-xs flex justify-between font-bold bg-rose-50 text-rose-700";
        changeText.textContent = `အကြွေးကျန်: ${(finalTotal - paid).toLocaleString()} Ks`;
    }
}

/**
 * ၆။ အရောင်းဘောင်ချာ အတည်ပြုပြီး API သို့ ပေးပို့ခြင်း
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
            
            // Reset Cart & Close Modal
            cart = [];
            document.getElementById("pos-discount").value = 0;
            document.getElementById("checkout-modal")?.classList.add("hidden");
            renderCart();
            await loadProducts(); // Update stock count
        }
    } catch (err) {
        alert(`ချို့ယွင်းချက်ဖြစ်ပေါ်ပါသည်: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>အရောင်း အတည်ပြုမည်</span>`;
    }
}

async function loadCustomers() {
    // Optional: Load regular customers list
}
