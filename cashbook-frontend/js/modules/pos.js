// cashbook-frontend/js/modules/pos.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { refreshGlobalKPIs } from "../app.js";

let allProducts = [];
let cart = [];
let currentSaleType = "retail";
let selectedPaymentMethod = "cash";

export async function initPOS() {
    bindEvents();
    await loadProducts();
    renderCart();
}

async function loadProducts() {
    const grid = document.getElementById("pos-product-grid");
    const loading = document.getElementById("pos-loading");
    const empty = document.getElementById("pos-empty");

    loading?.classList.remove("hidden");
    empty?.classList.add("hidden");
    if (grid) grid.innerHTML = "";

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        allProducts = res.data || [];
        populateCategoryDropdown(allProducts);
        filterAndRenderProducts();
    } catch (err) {
        console.error("Failed to load products:", err);
    } finally {
        loading?.classList.add("hidden");
    }
}

function populateCategoryDropdown(products) {
    const select = document.getElementById("pos-category-select");
    if (!select) return;
    const currentVal = select.value;
    const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${products.length})</option>`;
    categories.forEach(cat => {
        select.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
    select.value = currentVal;
}

/**
 * Category + Multi-Keyword Search (ဥပမာ - "ပုဆိုး" + "ကချင် အနက်" ရိုက်ရှာနိုင်သည်)
 */
function filterAndRenderProducts() {
    const category = document.getElementById("pos-category-select")?.value || "";
    const rawSearch = (document.getElementById("pos-search-input")?.value || "").trim().toLowerCase();
    const keywords = rawSearch.split(/\s+/).filter(Boolean);

    const filtered = allProducts.filter(p => {
        if (category && p.category !== category) return false;
        if (keywords.length === 0) return true;
        const haystack = `${p.sku || ""} ${p.barcode || ""} ${p.category || ""} ${p.item_name || ""} ${p.pattern || ""} ${p.color || ""} ${p.size || ""}`.toLowerCase();
        return keywords.every(kw => haystack.includes(kw));
    });

    renderProductsGrid(filtered);
}

function renderProductsGrid(products) {
    const grid = document.getElementById("pos-product-grid");
    const empty = document.getElementById("pos-empty");
    if (!grid) return;

    grid.innerHTML = "";
    if (products.length === 0) {
        empty?.classList.remove("hidden");
        return;
    }
    empty?.classList.add("hidden");

    products.forEach(p => {
        const price = currentSaleType === "retail" ? p.retail_price : p.wholesale_price;
        const stock = p.current_stock || 0;
        const isOutOfStock = stock <= 0;

        const card = document.createElement("div");
        card.className = `bg-slate-50 dark:bg-slate-900/90 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500 active:scale-95 transition-all cursor-pointer flex flex-col justify-between ${isOutOfStock ? 'opacity-45 pointer-events-none' : ''}`;
        
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between gap-2 mb-2.5">
                    <span class="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">${p.category}</span>
                    <span class="text-xs font-mono font-bold ${stock < 5 ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}">လက်ကျန်: ${stock}</span>
                </div>
                <div class="text-base font-extrabold text-slate-900 dark:text-white leading-snug">${p.item_name}</div>
                <div class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1">${p.pattern || ''}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">${p.color || ''} • ${p.size || 'Free'}</div>
            </div>
            <div class="mt-4 pt-3 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between">
                <span class="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">${Number(price).toLocaleString()}</span>
                <div class="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                    <i class="fa-solid fa-plus text-xs"></i>
                </div>
            </div>
        `;

        card.addEventListener("click", () => addToCart(p));
        grid.appendChild(card);
    });
}

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
            <div class="flex flex-col items-center justify-center h-56 text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-cart-shopping text-4xl mb-3 opacity-40"></i>
                <span class="text-sm font-bold">ခြင်းတောင်းထဲတွင် ပစ္စည်းမရှိသေးပါ</span>
            </div>
        `;
        if (subtotalEl) subtotalEl.textContent = "0";
        if (finalTotalEl) finalTotalEl.textContent = "0";
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
                <div class="text-sm font-bold text-slate-900 dark:text-white truncate">${item.product.item_name} ${item.product.pattern ? `(${item.product.pattern})` : ''}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">${Number(item.unitPrice).toLocaleString()}</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button data-idx="${index}" class="btn-qty-minus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-200 font-bold cursor-pointer">-</button>
                <span class="w-7 text-center text-sm font-black font-mono text-slate-900 dark:text-white">${item.quantity}</span>
                <button data-idx="${index}" class="btn-qty-plus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-200 font-bold cursor-pointer">+</button>
            </div>
            <div class="text-right shrink-0 w-24">
                <div class="text-sm font-black text-slate-900 dark:text-white font-mono">${Number(lineTotal).toLocaleString()}</div>
                <button data-idx="${index}" class="btn-remove-item text-xs text-rose-500 hover:text-rose-400 font-bold mt-0.5 cursor-pointer">ဖယ်မည်</button>
            </div>
        `;
        container.appendChild(row);
    });

    const discount = parseFloat(discountInput?.value) || 0;
    const finalTotal = Math.max(0, subtotal - discount);

    if (subtotalEl) subtotalEl.textContent = subtotal.toLocaleString();
    if (discountDisplay) discountDisplay.textContent = `-${discount.toLocaleString()}`;
    if (finalTotalEl) finalTotalEl.textContent = finalTotal.toLocaleString();
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

function bindEvents() {
    const searchInput = document.getElementById("pos-search-input");
    const categorySelect = document.getElementById("pos-category-select");
    const clearBtn = document.getElementById("btn-clear-search");
    const retailBtn = document.getElementById("btn-type-retail");
    const wholesaleBtn = document.getElementById("btn-type-wholesale");
    const discountInput = document.getElementById("pos-discount");
    const checkoutBtn = document.getElementById("btn-pos-checkout");
    const modal = document.getElementById("checkout-modal");
    const closeModalBtn = document.getElementById("btn-close-modal");
    const confirmSaleBtn = document.getElementById("btn-confirm-sale");

    categorySelect?.addEventListener("change", filterAndRenderProducts);

    searchInput?.addEventListener("input", (e) => {
        if (clearBtn) clearBtn.classList.toggle("hidden", !e.target.value);
        filterAndRenderProducts();
    });

    clearBtn?.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        clearBtn.classList.add("hidden");
        filterAndRenderProducts();
    });

    searchInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            const code = searchInput.value.trim();
            if (!code) return;
            const exact = allProducts.find(p => p.barcode === code || p.sku === code);
            if (exact && exact.current_stock > 0) {
                addToCart(exact);
                searchInput.value = "";
                clearBtn?.classList.add("hidden");
                filterAndRenderProducts();
            }
        }
    });

    retailBtn?.addEventListener("click", () => {
        currentSaleType = "retail";
        retailBtn.className = "px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white shadow-sm transition cursor-pointer";
        wholesaleBtn.className = "px-3.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-white transition cursor-pointer";
        updatePricesForSaleType();
    });

    wholesaleBtn?.addEventListener("click", () => {
        currentSaleType = "wholesale";
        wholesaleBtn.className = "px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white shadow-sm transition cursor-pointer";
        retailBtn.className = "px-3.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-white transition cursor-pointer";
        updatePricesForSaleType();
    });

    discountInput?.addEventListener("input", renderCart);
    checkoutBtn?.addEventListener("click", openCheckoutModal);
    closeModalBtn?.addEventListener("click", () => modal?.classList.add("hidden"));

    document.querySelectorAll(".method-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".method-btn").forEach(b => {
                b.className = "method-btn p-3.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold flex flex-col items-center gap-1.5 cursor-pointer";
            });
            btn.className = "method-btn active p-3.5 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-sm font-bold flex flex-col items-center gap-1.5 cursor-pointer";
            
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

    // Receipt Modal Buttons
    document.getElementById("btn-print-receipt")?.addEventListener("click", () => window.print());
    document.getElementById("btn-close-receipt")?.addEventListener("click", () => {
        document.getElementById("receipt-modal")?.classList.add("hidden");
    });
}

function updatePricesForSaleType() {
    cart.forEach(item => {
        item.unitPrice = currentSaleType === "retail" ? item.product.retail_price : item.product.wholesale_price;
    });
    renderCart();
    filterAndRenderProducts();
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

    if (dueEl) dueEl.textContent = finalTotal.toLocaleString();
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
        changeBox.className = "p-3.5 rounded-xl text-sm flex justify-between font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
        changeText.textContent = `+${(paid - finalTotal).toLocaleString()}`;
    } else {
        changeBox.className = "p-3.5 rounded-xl text-sm flex justify-between font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400";
        changeText.textContent = `အကြွေးကျန်: ${(finalTotal - paid).toLocaleString()}`;
    }
}

async function submitSale() {
    const btn = document.getElementById("btn-confirm-sale");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>သိမ်းဆည်းနေပါသည်...</span>`;

    try {
        const subtotal = cart.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
        const discountAmount = parseFloat(document.getElementById("pos-discount")?.value) || 0;
        const finalTotal = Math.max(0, subtotal - discountAmount);
        const paidAmount = parseFloat(document.getElementById("modal-paid-amount")?.value) || 0;
        const customerId = document.getElementById("pos-customer-select")?.value || null;
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
            document.getElementById("checkout-modal")?.classList.add("hidden");
            showReceiptModal(res.data.invoiceNo, cart, subtotal, discountAmount, finalTotal, paidAmount);

            cart = [];
            document.getElementById("pos-discount").value = 0;
            renderCart();
            await loadProducts();
            await refreshGlobalKPIs();
        }
    } catch (err) {
        alert(`ချို့ယွင်းချက်ဖြစ်ပေါ်ပါသည်: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check"></i> <span>အရောင်း အတည်ပြုပြီး ဘောင်ချာထုတ်မည်</span>`;
    }
}

function showReceiptModal(invoiceNo, items, subtotal, discount, finalTotal, paid) {
    document.getElementById("rcp-branch").textContent = state.currentBranch?.name || "Main Home Shop";
    document.getElementById("rcp-inv").textContent = invoiceNo;
    document.getElementById("rcp-date").textContent = new Date().toLocaleString();
    document.getElementById("rcp-method").textContent = selectedPaymentMethod;

    const tbody = document.getElementById("rcp-items");
    tbody.innerHTML = "";
    items.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td class="py-1.5 font-semibold">${item.product.item_name}</td>
                <td class="py-1.5 text-center font-mono">${item.quantity}</td>
                <td class="py-1.5 text-right font-mono">${(item.quantity * item.unitPrice).toLocaleString()}</td>
            </tr>
        `;
    });

    document.getElementById("rcp-subtotal").textContent = subtotal.toLocaleString();
    document.getElementById("rcp-discount").textContent = `-${discount.toLocaleString()}`;
    document.getElementById("rcp-final").textContent = finalTotal.toLocaleString();
    document.getElementById("rcp-paid").textContent = paid.toLocaleString();

    document.getElementById("receipt-modal")?.classList.remove("hidden");
}
