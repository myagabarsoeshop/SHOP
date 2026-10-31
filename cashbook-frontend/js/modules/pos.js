// cashbook-frontend/js/modules/pos.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { refreshGlobalKPIs, setKPI } from "../app.js";

let allProducts = [];
let cart = [];
let currentSaleType = "retail";
let selectedPaymentMethod = "cash";
let allCustomers = [];

export async function initPOS() {
    bindEvents();
    await loadProducts();
    await loadCustomers(); // Checkout တွင် ရွေးချယ်ရန်
    renderCart();
    await updatePOSKPIs();
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

async function loadCustomers() {
    try {
        const res = await api.get("/customers");
        allCustomers = res.data || [];
        
        const select = document.getElementById("pos-customer-select");
        if (select) {
            select.innerHTML = `<option value="">-- ဖောက်သည် ရွေးချယ်ပါ (Optional) --</option>`;
            allCustomers.forEach(c => {
                select.innerHTML += `<option value="${c.id}">${c.name} ${c.phone ? `(${c.phone})` : ''}</option>`;
            });
        }
    } catch (err) {
        console.error("Failed to load customers:", err);
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
        const itemCode = p.sku || p.barcode || 'N/A';

        const card = document.createElement("div");
        card.className = `bg-slate-50 dark:bg-slate-900/90 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500 active:scale-95 transition-all cursor-pointer flex flex-col justify-between ${isOutOfStock ? 'opacity-45 pointer-events-none' : ''}`;
        
        card.innerHTML = `
            <div>
                <!-- Category ဘေးတွင် လက်ကျန်အရေအတွက်ကို ထင်ရှားစွာပြသခြင်း -->
                <div class="flex items-center justify-between gap-2 mb-2">
                    <span class="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        ${p.category} <strong class="${stock < 5 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}">(${stock})</strong>
                    </span>
                    <span class="text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400">Code: ${itemCode}</span>
                </div>
                <div class="text-base font-extrabold text-slate-900 dark:text-white leading-snug">${p.item_name}</div>
                <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">${p.pattern || ''} • ${p.color || ''}</div>
                <div class="text-xs text-slate-400 mt-0.5">ဆိုက်: ${p.size || 'Free'}</div>
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
    const availableStock = product.current_stock || 0;

    if (existing) {
        if (existing.quantity >= availableStock) {
            alert(`လက်ကျန်မလောက်ပါ။ (${availableStock} ထည်သာ ကျန်ပါသည်)`);
            return;
        }
        existing.quantity += 1;
    } else {
        if (availableStock <= 0) return;
        const price = currentSaleType === "retail" ? product.retail_price : product.wholesale_price;
        cart.push({ product, quantity: 1, unitPrice: price, costPrice: product.cost_price });
    }
    renderCart();
    updatePOSKPIs();
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
        updatePOSKPIs();
        return;
    }

    let subtotal = 0;
    cart.forEach((item, index) => {
        const lineTotal = item.quantity * item.unitPrice;
        subtotal += lineTotal;
        const stockLimit = item.product.current_stock || 0;

        const row = document.createElement("div");
        row.className = "py-3.5 flex items-center justify-between gap-3";
        row.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="text-sm font-bold text-slate-900 dark:text-white truncate">${item.product.item_name}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 font-mono">${Number(item.unitPrice).toLocaleString()}</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button data-idx="${index}" class="btn-qty-minus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold cursor-pointer">-</button>
                <span class="w-7 text-center text-sm font-black font-mono text-slate-900 dark:text-white">${item.quantity}</span>
                <button data-idx="${index}" data-max="${stockLimit}" class="btn-qty-plus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold cursor-pointer">+</button>
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
        btn.onclick = () => { 
            const idx = btn.dataset.idx;
            const max = parseInt(btn.dataset.max, 10);
            if (cart[idx].quantity >= max) {
                alert(`လက်ကျန်မလောက်ပါ။ (${max} ထည်သာ ကျန်ပါသည်)`);
                return;
            }
            cart[idx].quantity += 1; 
            renderCart(); 
            updatePOSKPIs(); 
        };
    });
    container.querySelectorAll(".btn-qty-minus").forEach(btn => {
        btn.onclick = () => {
            const idx = btn.dataset.idx;
            if (cart[idx].quantity > 1) cart[idx].quantity -= 1;
            else cart.splice(idx, 1);
            renderCart();
            updatePOSKPIs();
        };
    });
    container.querySelectorAll(".btn-remove-item").forEach(btn => {
        btn.onclick = () => { cart.splice(btn.dataset.idx, 1); renderCart(); updatePOSKPIs(); };
    });

    updatePOSKPIs();
}

function bindEvents() {
    const searchInput = document.getElementById("pos-search-input");
    const categorySelect = document.getElementById("pos-category-select");
    const retailBtn = document.getElementById("btn-type-retail");
    const wholesaleBtn = document.getElementById("btn-type-wholesale");
    const discountInput = document.getElementById("pos-discount");
    const checkoutBtn = document.getElementById("btn-pos-checkout");
    const modal = document.getElementById("checkout-modal");
    const closeModalBtn = document.getElementById("btn-close-modal");
    const confirmSaleBtn = document.getElementById("btn-confirm-sale");

    categorySelect?.addEventListener("change", filterAndRenderProducts);
    searchInput?.addEventListener("input", () => filterAndRenderProducts());

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
            if (selectedPaymentMethod === "credit") {
                paidInput.value = 0;
                paidInput.disabled = true; // အကြွေးဆိုလျှင် Paid Amount ပြင်ခွင့်ပိတ်မည်
            } else {
                paidInput.value = dueAmount;
                paidInput.disabled = false;
            }
            calculateChange();
        });
    });

    document.getElementById("modal-paid-amount")?.addEventListener("input", calculateChange);
    confirmSaleBtn?.addEventListener("click", submitSale);

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
    
    // Default to Cash payment when opening modal
    document.querySelector('.method-btn[data-method="cash"]')?.click();
    
    if (dueEl) dueEl.textContent = finalTotal.toLocaleString();
    if (paidInput) paidInput.value = finalTotal;
    
    calculateChange();
    modal?.classList.remove("hidden");
}

function calculateChange() {
    const finalTotal = getFinalTotal();
    const paidInput = document.getElementById("modal-paid-amount");
    const paid = parseFloat(paidInput?.value) || 0;
    const changeBox = document.getElementById("modal-debt-change-box");
    const changeText = document.getElementById("modal-change-text");

    if (selectedPaymentMethod === "credit") {
        changeBox.className = "p-3.5 rounded-xl text-sm flex justify-between font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400";
        changeText.textContent = `အကြွေးကျန်: ${finalTotal.toLocaleString()}`;
    } else if (paid >= finalTotal) {
        changeBox.className = "p-3.5 rounded-xl text-sm flex justify-between font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
        changeText.textContent = `ပြန်အမ်းငွေ (Change): ${(paid - finalTotal).toLocaleString()}`;
    } else {
        changeBox.className = "p-3.5 rounded-xl text-sm flex justify-between font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400";
        changeText.textContent = `လိုငွေ (အကြွေး): ${(finalTotal - paid).toLocaleString()}`;
    }
}

async function updatePOSKPIs() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const today = new Date().toISOString().split("T")[0];
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: today, end_date: today });
        const s = res.data?.summary || { cash: { in: 0 }, bank: { in: 0 } };

        const cashSale = s.cash.in || 0;
        const bankSale = s.bank.in || 0;
        const totalSale = cashSale + bankSale;
        const totalItemsQty = cart.reduce((acc, i) => acc + i.quantity, 0);

        setKPI(1, "Today Sale (Cash)", cashSale, "fa-money-bill-wave");
        setKPI(2, "Today Sale (Bank)", bankSale, "fa-building-columns");
        setKPI(3, "Total Today Sale", totalSale, "fa-cash-register");
        setKPI(4, "Total Sale Items", totalItemsQty, "fa-shirt");
    } catch (err) {
        console.error("POS KPI update error:", err);
    }
}

async function submitSale() {
    const customerId = document.getElementById("pos-customer-select")?.value || null;
    const finalTotal = getFinalTotal();
    const paidAmount = parseFloat(document.getElementById("modal-paid-amount")?.value) || 0;
    
    // အကြွေး (Credit) သို့မဟုတ် ငွေအပြည့်မချေလျှင် ဖောက်သည် ရွေးချယ်ရန် မဖြစ်မနေတောင်းဆိုမည်
    if (paidAmount < finalTotal && !customerId) {
        alert("အကြွေး (သို့) ငွေအပြည့်မချေပါက ကျေးဇူးပြု၍ ဖောက်သည် (Customer) ရွေးချယ်ပေးပါ။");
        return;
    }

    const bankName = document.getElementById("modal-bank-name")?.value;
    if (selectedPaymentMethod === "bank" && !bankName) {
        alert("ဘဏ်လွှဲဖြစ်ပါက ကျေးဇူးပြု၍ ဘဏ်အမည် ထည့်သွင်းပေးပါ။");
        return;
    }

    const btn = document.getElementById("btn-confirm-sale");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>သိမ်းဆည်းနေပါသည်...</span>`;

    try {
        const subtotal = cart.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
        const discountAmount = parseFloat(document.getElementById("pos-discount")?.value) || 0;

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
            paidAmount: selectedPaymentMethod === "credit" ? 0 : paidAmount,
            paymentMethod: selectedPaymentMethod,
            cashAmount: selectedPaymentMethod === "cash" ? paidAmount : 0,
            bankAmount: selectedPaymentMethod === "bank" ? paidAmount : 0,
            bankAccountName: selectedPaymentMethod === "bank" ? bankName : null,
            createdBy: state.user?.id || 1
        };

        const res = await api.post("/pos/sales", payload);
        if (res.success) {
            document.getElementById("checkout-modal")?.classList.add("hidden");
            
            // ဘောင်ချာပြသမည်
            showReceiptModal(res.data.invoiceNo, cart, subtotal, discountAmount, finalTotal, payload.paidAmount);

            // စာရင်းများ ရှင်းလင်းမည်
            cart = [];
            document.getElementById("pos-discount").value = 0;
            document.getElementById("pos-customer-select").value = "";
            renderCart();
            await loadProducts();
            await updatePOSKPIs();
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
    document.getElementById("rcp-date").textContent = new Date().toLocaleString("en-GB", { hour12: true });
    
    // Receipt ပေါ်တွင် Payment Method ကို မြန်မာလို ပြသရန်
    let methodText = "လက်ငင်း (Cash)";
    if (selectedPaymentMethod === "bank") methodText = "ဘဏ်လွှဲ (Bank)";
    if (selectedPaymentMethod === "credit") methodText = "အကြွေး (Credit)";
    document.getElementById("rcp-method").textContent = methodText;

    const tbody = document.getElementById("rcp-items");
    if (tbody) {
        tbody.innerHTML = "";
        items.forEach(item => {
            tbody.innerHTML += `
                <tr class="border-b border-dashed border-gray-300">
                    <td class="py-2 text-[13px] font-semibold">${item.product.item_name}</td>
                    <td class="py-2 text-[13px] text-center font-mono">${item.quantity}</td>
                    <td class="py-2 text-[13px] text-right font-mono">${(item.quantity * item.unitPrice).toLocaleString()}</td>
                </tr>
            `;
        });
    }

    document.getElementById("rcp-subtotal").textContent = subtotal.toLocaleString();
    document.getElementById("rcp-discount").textContent = `-${discount.toLocaleString()}`;
    document.getElementById("rcp-final").textContent = finalTotal.toLocaleString();
    document.getElementById("rcp-paid").textContent = paid.toLocaleString();
    
    const change = paid - finalTotal;
    const changeEl = document.getElementById("rcp-change");
    if (changeEl) {
        changeEl.textContent = change >= 0 ? change.toLocaleString() : `(အကြွေး) ${Math.abs(change).toLocaleString()}`;
    }

    document.getElementById("receipt-modal")?.classList.remove("hidden");
}
