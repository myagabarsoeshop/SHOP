// cashbook-frontend/js/modules/pos.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { refreshGlobalKPIs, setKPI } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let allProducts = [];
let cart = []; // Each item: { product, quantity, unitPrice, costPrice, itemSaleType: 'retail' | 'wholesale' }
let defaultSaleType = "retail"; // Default for newly added items
let selectedPaymentMethod = "cash";
let allCustomers = [];

// Today Sales State
let todaySalesList = [];
let currentFilteredTodaySales = [];
const todaySalesPagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTodaySalesTable()
});

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeCsv(val) {
    let str = String(val ?? "").trim();
    if (/^[=+@-]/.test(str)) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
}

function getLocalBusinessDate() {
    const d = new Date(Date.now() + 6.5 * 60 * 60 * 1000);
    return d.toISOString().split("T")[0];
}

export async function initPOS() {
    // SPA Re-render Safety: Always bind events to fresh DOM elements
    bindEvents();
    await loadProducts();
    await loadCustomers();
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
        
        const customerSelects = [
            document.getElementById("pos-customer-select"),
            document.getElementById("modal-customer-select")
        ].filter(Boolean);

        customerSelects.forEach(select => {
            const currentVal = select.value;
            select.innerHTML = `
                <option value="">-- ဖောက်သည် ရွေးချယ်ပါ --</option>
                <option value="NEW" class="font-bold text-emerald-600 dark:text-emerald-400">+ ဖောက်သည်အသစ် ထည့်မည်...</option>
            `;
            allCustomers.forEach(c => {
                const debt = Number(c.current_debt || 0);
                const debtStr = debt > 0 ? ` [အကြွေးကျန်: ${debt.toLocaleString()} Ks]` : '';
                select.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)} ${c.phone ? `(${escapeHtml(c.phone)})` : ''}${debtStr}</option>`;
            });
            if (currentVal) select.value = currentVal;
        });
    } catch (err) {
        console.error("Failed to load customers:", err);
    }
}

function populateCategoryDropdown(products) {
    const select = document.getElementById("pos-category-select");
    if (!select) return;
    const currentVal = select.value;
    const categories = [...new Set(products.map(p => (p.category || "").trim()).filter(Boolean))];
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${products.length})</option>`;
    categories.forEach(cat => {
        select.innerHTML += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
    });
    select.value = currentVal;
}

function filterAndRenderProducts() {
    const category = document.getElementById("pos-category-select")?.value || "";
    const rawSearch = (document.getElementById("pos-search-input")?.value || "").trim().toLowerCase();
    const clearBtn = document.getElementById("btn-clear-search");

    if (rawSearch) clearBtn?.classList.remove("hidden");
    else clearBtn?.classList.add("hidden");

    const keywords = rawSearch.split(/\s+/).filter(Boolean);

    const filtered = allProducts.filter(p => {
        if (category && (p.category || "").trim() !== category) return false;
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
        const price = defaultSaleType === "retail" ? Number(p.retail_price || 0) : Number(p.wholesale_price || 0);
        const stock = Number(p.current_stock || 0);
        const isOutOfStock = stock <= 0;
        const itemCode = p.sku || p.barcode || 'N/A';
        const unit = p.size || 'ထည်';

        const card = document.createElement("div");
        card.className = `bg-white dark:bg-slate-900/90 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:shadow-md active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between ${isOutOfStock ? 'opacity-40 pointer-events-none' : ''}`;
        
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between gap-1.5 mb-1.5">
                    <span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 truncate">
                        ${escapeHtml(p.category)}
                    </span>
                    <span class="text-xs font-mono font-extrabold ${stock < 5 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}">
                        (${stock.toLocaleString()} ${escapeHtml(unit)})
                    </span>
                </div>
                <div class="text-sm font-extrabold text-slate-900 dark:text-white leading-snug line-clamp-2">${escapeHtml(p.item_name)}</div>
                <div class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1 truncate">
                    ${escapeHtml(p.pattern || '')} ${p.color ? `• ${escapeHtml(p.color)}` : ''}
                </div>
                <div class="text-[10px] text-slate-400 font-mono mt-0.5">Code: ${escapeHtml(itemCode)}</div>
            </div>
            <div class="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <span class="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">${price.toLocaleString()} Ks</span>
                <div class="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
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
    const availableStock = Number(product.current_stock || 0);

    if (existing) {
        if (existing.quantity >= availableStock) {
            alert(`လက်ကျန်စတော့ မလုံလောက်ပါ။ (${availableStock} ${product.size || 'ထည်'} သာ ကျန်ပါသည်)`);
            return;
        }
        existing.quantity += 1;
    } else {
        if (availableStock <= 0) {
            alert("ပစ္စည်းလက်ကျန် ပြတ်လပ်နေပါသဖြင့် ရောင်းချ၍မရပါ။");
            return;
        }
        const initialType = defaultSaleType;
        const initialPrice = initialType === "retail" ? Number(product.retail_price || 0) : Number(product.wholesale_price || 0);
        
        cart.push({
            product,
            quantity: 1,
            itemSaleType: initialType,
            unitPrice: initialPrice,
            costPrice: Number(product.cost_price || 0)
        });
    }
    renderCart();
    updatePOSKPIs();
}

/**
 * Toggle individual item in cart between Retail and Wholesale
 */
function toggleCartItemPriceType(index) {
    const item = cart[index];
    if (!item) return;

    if (item.itemSaleType === "retail") {
        item.itemSaleType = "wholesale";
        item.unitPrice = Number(item.product.wholesale_price || item.product.retail_price || 0);
    } else {
        item.itemSaleType = "retail";
        item.unitPrice = Number(item.product.retail_price || 0);
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
            <div class="flex flex-col items-center justify-center h-48 text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-cart-shopping text-3xl mb-2 opacity-40"></i>
                <span class="text-xs font-bold">ခြင်းတောင်းထဲတွင် ပစ္စည်းမရှိသေးပါ</span>
            </div>
        `;
        if (subtotalEl) subtotalEl.textContent = "0 Ks";
        if (finalTotalEl) finalTotalEl.textContent = "0 Ks";
        if (discountDisplay) discountDisplay.textContent = "-0 Ks";
        if (discountInput) discountInput.value = 0; // Fix: Reset discount to 0 on empty cart
        if (checkoutBtn) checkoutBtn.disabled = true;
        updatePOSKPIs();
        return;
    }

    let subtotal = 0;
    cart.forEach((item, index) => {
        const lineTotal = item.quantity * item.unitPrice;
        subtotal += lineTotal;
        const stockLimit = Number(item.product.current_stock || 0);
        const isWholesale = item.itemSaleType === "wholesale";

        const row = document.createElement("div");
        row.className = "py-3 flex items-center justify-between gap-2.5";
        row.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-0.5">
                    <span class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(item.product.item_name)}</span>
                    <!-- Row-level Retail/Wholesale Toggle Badge -->
                    <button type="button" data-idx="${index}" class="btn-toggle-price-type px-1.5 py-0.5 rounded text-[10px] font-black cursor-pointer transition ${isWholesale ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'}" title="လက်လီ/လက်ကား ဈေးနှုန်းပြောင်းရန် နှိပ်ပါ">
                        ${isWholesale ? 'လက်ကား' : 'လက်လီ'}
                    </button>
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    ${Number(item.unitPrice).toLocaleString()} Ks ${item.product.color ? `• ${escapeHtml(item.product.color)}` : ''}
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <button data-idx="${index}" class="btn-qty-minus w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs cursor-pointer">-</button>
                <span class="w-6 text-center text-xs font-black font-mono text-slate-900 dark:text-white">${item.quantity}</span>
                <button data-idx="${index}" data-max="${stockLimit}" class="btn-qty-plus w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs cursor-pointer">+</button>
            </div>
            <div class="text-right shrink-0 w-24">
                <div class="text-xs font-black text-slate-900 dark:text-white font-mono">${Number(lineTotal).toLocaleString()} Ks</div>
                <button data-idx="${index}" class="btn-remove-item text-[10px] text-rose-500 hover:text-rose-400 font-bold cursor-pointer">ဖယ်မည်</button>
            </div>
        `;
        container.appendChild(row);
    });

    // Discount Validation: Ensure discount never exceeds subtotal
    let rawDiscount = parseFloat(discountInput?.value) || 0;
    let discount = Math.min(Math.max(0, rawDiscount), subtotal);
    if (discountInput && discountInput.value !== String(discount) && rawDiscount > subtotal) {
        discountInput.value = discount;
    }

    const finalTotal = Math.max(0, subtotal - discount);

    if (subtotalEl) subtotalEl.textContent = `${subtotal.toLocaleString()} Ks`;
    if (discountDisplay) discountDisplay.textContent = `-${discount.toLocaleString()} Ks`;
    if (finalTotalEl) finalTotalEl.textContent = `${finalTotal.toLocaleString()} Ks`;
    if (checkoutBtn) checkoutBtn.disabled = false;

    // Attach Row Event Listeners
    container.querySelectorAll(".btn-toggle-price-type").forEach(btn => {
        btn.onclick = () => toggleCartItemPriceType(Number(btn.dataset.idx));
    });

    container.querySelectorAll(".btn-qty-plus").forEach(btn => {
        btn.onclick = () => { 
            const idx = Number(btn.dataset.idx);
            const max = parseInt(btn.dataset.max, 10);
            if (cart[idx].quantity >= max) {
                alert(`လက်ကျန်စတော့ (${max}) ထက် ပိုမိုရောင်းချ၍ မရပါ။`);
                return;
            }
            cart[idx].quantity += 1; 
            renderCart(); 
            updatePOSKPIs(); 
        };
    });

    container.querySelectorAll(".btn-qty-minus").forEach(btn => {
        btn.onclick = () => {
            const idx = Number(btn.dataset.idx);
            if (cart[idx].quantity > 1) cart[idx].quantity -= 1;
            else cart.splice(idx, 1);
            renderCart();
            updatePOSKPIs();
        };
    });

    container.querySelectorAll(".btn-remove-item").forEach(btn => {
        btn.onclick = () => { 
            cart.splice(Number(btn.dataset.idx), 1); 
            // If cart is now empty, zero out discount
            if (cart.length === 0 && discountInput) discountInput.value = 0;
            renderCart(); 
            updatePOSKPIs(); 
        };
    });

    updatePOSKPIs();
}

function bindEvents() {
    const searchInput = document.getElementById("pos-search-input");
    const clearSearchBtn = document.getElementById("btn-clear-search");
    const clearCartBtn = document.getElementById("btn-clear-cart");
    const categorySelect = document.getElementById("pos-category-select");
    const retailBtn = document.getElementById("btn-type-retail");
    const wholesaleBtn = document.getElementById("btn-type-wholesale");
    const discountInput = document.getElementById("pos-discount");
    const checkoutBtn = document.getElementById("btn-pos-checkout");
    const modal = document.getElementById("checkout-modal");
    const closeModalBtn = document.getElementById("btn-close-modal");
    const confirmSaleBtn = document.getElementById("btn-confirm-sale");

    if (categorySelect) categorySelect.onchange = filterAndRenderProducts;
    if (searchInput) searchInput.oninput = filterAndRenderProducts;

    if (clearSearchBtn) {
        clearSearchBtn.onclick = () => {
            if (searchInput) searchInput.value = "";
            filterAndRenderProducts();
            searchInput?.focus();
        };
    }

    if (clearCartBtn) {
        clearCartBtn.onclick = () => {
            if (cart.length === 0) return;
            if (confirm("ခြင်းတောင်းထဲရှိ ရွေးချယ်ထားသော ပစ္စည်းများ အားလုံးကို ရှင်းလင်းလိုပါသလား?")) {
                cart = [];
                if (discountInput) discountInput.value = 0;
                renderCart();
                updatePOSKPIs();
            }
        };
    }

    // Default Sale Type Toggles
    if (retailBtn) {
        retailBtn.onclick = () => {
            defaultSaleType = "retail";
            retailBtn.className = "px-3 py-1 rounded-lg bg-emerald-600 text-white shadow-sm transition cursor-pointer";
            if (wholesaleBtn) wholesaleBtn.className = "px-3 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer";
            filterAndRenderProducts();
        };
    }

    if (wholesaleBtn) {
        wholesaleBtn.onclick = () => {
            defaultSaleType = "wholesale";
            wholesaleBtn.className = "px-3 py-1 rounded-lg bg-emerald-600 text-white shadow-sm transition cursor-pointer";
            if (retailBtn) retailBtn.className = "px-3 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer";
            filterAndRenderProducts();
        };
    }

    if (discountInput) discountInput.oninput = renderCart;
    if (checkoutBtn) checkoutBtn.onclick = openCheckoutModal;
    if (closeModalBtn) closeModalBtn.onclick = () => modal?.classList.add("hidden");

    // Payment Method Selection Tabs
    document.querySelectorAll(".method-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".method-btn").forEach(b => {
                b.className = "method-btn p-2.5 rounded-xl border-2 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold flex flex-col items-center gap-1 cursor-pointer";
            });
            btn.className = "method-btn active p-2.5 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-xs font-bold flex flex-col items-center gap-1 cursor-pointer";
            selectedPaymentMethod = btn.dataset.method;
            
            const bankGroup = document.getElementById("bank-input-group");
            if (selectedPaymentMethod === "bank") bankGroup?.classList.remove("hidden");
            else bankGroup?.classList.add("hidden");

            const paidInput = document.getElementById("modal-paid-amount");
            const dueAmount = getFinalTotal();

            if (paidInput) {
                if (selectedPaymentMethod === "credit") {
                    paidInput.value = 0;
                    paidInput.placeholder = "စရန်ငွေ ထည့်ပါ (မပေးပါက 0)";
                } else {
                    paidInput.value = dueAmount;
                    paidInput.placeholder = "ကျသင့်ငွေ အပြည့် သို့မဟုတ် လက်ခံငွေ";
                }
            }

            calculateChange();
        };
    });

    // Customer Selection Sync
    const handleCustomerChange = (e) => {
        const val = e.target.value;
        const newBox = document.getElementById("modal-new-customer-box");
        if (val === "NEW") {
            newBox?.classList.remove("hidden");
            document.getElementById("modal-new-cust-name")?.focus();
        } else {
            newBox?.classList.add("hidden");
        }

        const sideSelect = document.getElementById("pos-customer-select");
        const modalSelect = document.getElementById("modal-customer-select");
        if (sideSelect && sideSelect !== e.target) sideSelect.value = val;
        if (modalSelect && modalSelect !== e.target) modalSelect.value = val;
    };

    const posCust = document.getElementById("pos-customer-select");
    const modalCust = document.getElementById("modal-customer-select");
    if (posCust) posCust.onchange = handleCustomerChange;
    if (modalCust) modalCust.onchange = handleCustomerChange;

    const modalPaid = document.getElementById("modal-paid-amount");
    if (modalPaid) modalPaid.oninput = calculateChange;

    if (confirmSaleBtn) confirmSaleBtn.onclick = submitSale;

    const printReceiptBtn = document.getElementById("btn-print-receipt");
    if (printReceiptBtn) printReceiptBtn.onclick = () => window.print();

    const closeReceiptBtn = document.getElementById("btn-close-receipt");
    if (closeReceiptBtn) closeReceiptBtn.onclick = () => document.getElementById("receipt-modal")?.classList.add("hidden");

    // Today Sales Modal Events
    const openTodayBtn = document.getElementById("btn-open-today-sales");
    if (openTodayBtn) openTodayBtn.onclick = openTodaySalesModal;

    const closeTodayBtn = document.getElementById("btn-close-today-sales-modal");
    if (closeTodayBtn) closeTodayBtn.onclick = () => document.getElementById("today-sales-modal")?.classList.add("hidden");

    const todaySearch = document.getElementById("today-sales-search");
    if (todaySearch) todaySearch.oninput = filterAndRenderTodaySales;

    const exportCsvBtn = document.getElementById("btn-export-today-sales-csv");
    if (exportCsvBtn) exportCsvBtn.onclick = exportTodaySalesToCSV;
}

function getFinalTotal() {
    let subtotal = cart.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
    let rawDiscount = parseFloat(document.getElementById("pos-discount")?.value) || 0;
    let discount = Math.min(Math.max(0, rawDiscount), subtotal);
    return Math.max(0, subtotal - discount);
}

function openCheckoutModal() {
    const modal = document.getElementById("checkout-modal");
    const dueEl = document.getElementById("modal-due-amount");
    const paidInput = document.getElementById("modal-paid-amount");
    const finalTotal = getFinalTotal();
    
    document.querySelector('.method-btn[data-method="cash"]')?.click();
    
    if (dueEl) dueEl.textContent = `${finalTotal.toLocaleString()} Ks`;
    if (paidInput) paidInput.value = finalTotal;
    
    const sideCust = document.getElementById("pos-customer-select")?.value || "";
    const modalCust = document.getElementById("modal-customer-select");
    if (modalCust) {
        modalCust.value = sideCust;
        const newBox = document.getElementById("modal-new-customer-box");
        if (sideCust === "NEW") newBox?.classList.remove("hidden");
        else newBox?.classList.add("hidden");
    }

    calculateChange();
    modal?.classList.remove("hidden");
}

function calculateChange() {
    const finalTotal = getFinalTotal();
    const paidInput = document.getElementById("modal-paid-amount");
    let paid = parseFloat(paidInput?.value) || 0;
    if (paid < 0) {
        paid = 0;
        paidInput.value = 0;
    }

    const changeBox = document.getElementById("modal-debt-change-box");
    const changeLabel = document.getElementById("modal-change-label");
    const changeText = document.getElementById("modal-change-text");

    if (!changeBox || !changeText || !changeLabel) return;

    if (paid >= finalTotal) {
        const change = paid - finalTotal;
        changeBox.className = "p-3 rounded-xl text-xs flex justify-between font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
        changeLabel.textContent = "ပြန်အမ်းငွေ (Change):";
        changeText.textContent = `${change.toLocaleString()} Ks`;
    } else {
        const remainingDebt = finalTotal - paid;
        changeBox.className = "p-3 rounded-xl text-xs flex justify-between font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400";
        changeLabel.textContent = "အကြွေးကျန်ငွေ (Remaining Debt):";
        changeText.textContent = `${remainingDebt.toLocaleString()} Ks`;
    }
}

async function updatePOSKPIs() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const today = getLocalBusinessDate();
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: today, end_date: today });
        const s = res.data?.summary || { cash: { in: 0 }, bank: { in: 0 } };

        const cashSale = s.cash?.in || 0;
        const bankSale = s.bank?.in || 0;
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

/**
 * Checkout & Sale Submission with Money-Leak Prevention
 */
async function submitSale() {
    const finalTotal = getFinalTotal();
    const paidInput = document.getElementById("modal-paid-amount");
    let paidAmount = parseFloat(paidInput?.value) || 0;
    if (paidAmount < 0) paidAmount = 0;

    const remainingDebt = Math.max(0, finalTotal - paidAmount);

    let customerSelectVal = document.getElementById("modal-customer-select")?.value || 
                            document.getElementById("pos-customer-select")?.value || "";
    let customerId = null;
    let customerDisplayName = "Walk-in";

    if (customerSelectVal === "NEW") {
        const newName = document.getElementById("modal-new-cust-name")?.value.trim();
        const newPhone = document.getElementById("modal-new-cust-phone")?.value.trim() || null;
        const newShop = document.getElementById("modal-new-cust-shop")?.value.trim() || null;

        if (!newName) {
            alert("ဖောက်သည်အသစ်အတွက် အမည် ဖြည့်သွင်းပေးပါ။");
            document.getElementById("modal-new-cust-name")?.focus();
            return;
        }

        try {
            const custRes = await api.post("/customers", {
                name: newName,
                phone: newPhone,
                shopName: newShop,
                customerType: defaultSaleType,
                initialDebt: 0
            });
            customerId = custRes.data?.id;
            customerDisplayName = newName;
            await loadCustomers();
        } catch (e) {
            alert("ဖောက်သည်အသစ် သိမ်းဆည်း၍မရပါ: " + e.message);
            return;
        }
    } else if (customerSelectVal) {
        customerId = parseInt(customerSelectVal, 10);
        const found = allCustomers.find(c => c.id === customerId);
        if (found) customerDisplayName = found.name;
    }

    if (remainingDebt > 0 && !customerId) {
        alert("အကြွေးကျန်ငွေ ရှိနေပါသဖြင့် ကျေးဇူးပြု၍ ဖောက်သည် (Customer) ရွေးချယ်ပေးပါ (သို့မဟုတ် အသစ်ထည့်ပါ)။");
        document.getElementById("modal-customer-select")?.focus();
        return;
    }

    const bankName = document.getElementById("modal-bank-name")?.value.trim();
    if (selectedPaymentMethod === "bank" && paidAmount > 0 && !bankName) {
        alert("ဘဏ်လွှဲဖြစ်ပါက ကျေးဇူးပြု၍ ဘဏ်အမည် ထည့်သွင်းပေးပါ။");
        return;
    }

    const btn = document.getElementById("btn-confirm-sale");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> <span>သိမ်းဆည်းနေပါသည်...</span>`;
    }

    try {
        const subtotal = cart.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
        const discountAmount = parseFloat(document.getElementById("pos-discount")?.value) || 0;

        // Money-Leak Prevention: Route deposit during credit sales to Cash or Bank correctly
        const actualPaid = Math.min(paidAmount, finalTotal);
        let pCash = 0;
        let pBank = 0;

        if (selectedPaymentMethod === "cash") {
            pCash = actualPaid;
        } else if (selectedPaymentMethod === "bank") {
            pBank = actualPaid;
        } else if (selectedPaymentMethod === "credit") {
            if (bankName) pBank = actualPaid;
            else pCash = actualPaid;
        }

        const payload = {
            branchId: state.currentBranch?.id || 1,
            customerId: customerId,
            saleType: defaultSaleType,
            items: cart.map(i => ({
                productId: i.product.id, 
                quantity: i.quantity,
                unitPrice: i.unitPrice, 
                costPrice: i.costPrice
            })),
            discountAmount, 
            paidAmount: actualPaid,
            paymentMethod: selectedPaymentMethod,
            cashAmount: pCash,
            bankAmount: pBank,
            bankAccountName: pBank > 0 ? (bankName || "KPay") : null,
            createdBy: state.user?.id || 1
        };

        const res = await api.post("/pos/sales", payload);
        if (res.success) {
            document.getElementById("checkout-modal")?.classList.add("hidden");
            
            showReceiptModal({
                invoiceNo: res.data?.invoiceNo || `INV-${Date.now()}`,
                items: cart,
                subtotal: subtotal,
                discount: discountAmount,
                finalTotal: finalTotal,
                paid: actualPaid,
                customerName: customerDisplayName,
                paymentMethod: selectedPaymentMethod,
                bankName: bankName
            });

            // Reset Cart & Form
            cart = [];
            if (document.getElementById("pos-discount")) document.getElementById("pos-discount").value = 0;
            if (document.getElementById("pos-customer-select")) document.getElementById("pos-customer-select").value = "";
            if (document.getElementById("modal-customer-select")) document.getElementById("modal-customer-select").value = "";
            document.getElementById("modal-new-customer-box")?.classList.add("hidden");
            
            renderCart();
            await loadProducts();
            await loadCustomers();
            await updatePOSKPIs();
            await refreshGlobalKPIs();
        }
    } catch (err) {
        alert(`အရောင်းမှတ်တမ်း မအောင်မြင်ပါ: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check mr-1"></i> <span>အရောင်း အတည်ပြုပြီး ဘောင်ချာထုတ်မည်</span>`;
        }
    }
}

function showReceiptModal(data) {
    document.getElementById("rcp-branch").textContent = state.currentBranch?.name || "Main Home Shop";
    document.getElementById("rcp-inv").textContent = data.invoiceNo;
    document.getElementById("rcp-date").textContent = new Date().toLocaleString("en-GB", { hour12: true });
    document.getElementById("rcp-customer").textContent = data.customerName || "Walk-in";

    const method = String(data.paymentMethod || "cash").toLowerCase();
    let methodText = "လက်ငင်း (CASH)";
    if (method === "bank") methodText = `ဘဏ်လွှဲ (${data.bankName || "BANK"})`;
    else if (method === "credit") {
        methodText = data.paid > 0 ? `အကြွေး + စရန် (${data.paid.toLocaleString()})` : "အကြွေး (CREDIT)";
    }
    document.getElementById("rcp-method").textContent = methodText;

    const tbody = document.getElementById("rcp-items");
    if (tbody) {
        tbody.innerHTML = "";
        data.items.forEach(item => {
            const name = item.product?.item_name || item.item_name || "Item";
            const qty = Number(item.quantity || 1);
            const price = Number(item.unitPrice || item.unit_price || item.price || 0);
            const lineSub = Number(item.subtotal || (qty * price));
            tbody.innerHTML += `
                <tr class="border-b border-dashed border-gray-300">
                    <td class="py-1 text-[11px] font-semibold">${escapeHtml(name)}</td>
                    <td class="py-1 text-[11px] text-center font-mono">${qty}</td>
                    <td class="py-1 text-[11px] text-right font-mono">${lineSub.toLocaleString()}</td>
                </tr>
            `;
        });
    }

    document.getElementById("rcp-subtotal").textContent = Number(data.subtotal || 0).toLocaleString();
    document.getElementById("rcp-discount").textContent = `-${Number(data.discount || 0).toLocaleString()}`;
    document.getElementById("rcp-final").textContent = Number(data.finalTotal || 0).toLocaleString();
    document.getElementById("rcp-paid").textContent = Number(data.paid || 0).toLocaleString();
    
    const change = Number(data.paid || 0) - Number(data.finalTotal || 0);
    const changeLabel = document.getElementById("rcp-change-label");
    const changeEl = document.getElementById("rcp-change");

    if (change >= 0) {
        if (changeLabel) changeLabel.textContent = "ပြန်အမ်းငွေ:";
        if (changeEl) changeEl.textContent = `${change.toLocaleString()} Ks`;
    } else {
        if (changeLabel) changeLabel.textContent = "အကြွေးကျန်ငွေ:";
        if (changeEl) changeEl.textContent = `${Math.abs(change).toLocaleString()} Ks`;
    }

    document.getElementById("receipt-modal")?.classList.remove("hidden");
}

// =========================================================================
// --- Today Sales Modal Logic with Accurate Sums -------------------------
// =========================================================================

async function openTodaySalesModal() {
    const modal = document.getElementById("today-sales-modal");
    const tbody = document.getElementById("today-sales-table-body");
    modal?.classList.remove("hidden");

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-10 text-center text-slate-400 font-bold"><i class="fa-solid fa-spinner fa-spin text-blue-500 text-2xl mb-2"></i><div>ယနေ့အရောင်းစာရင်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        const today = getLocalBusinessDate();
        
        const res = await api.get("/pos/sales", { branch_id: branchId, date: today })
            .catch(() => api.get("/cashbook/entries", { branch_id: branchId, start_date: today, end_date: today }));
        
        todaySalesList = res.data?.items || res.data || [];
        currentFilteredTodaySales = [...todaySalesList];

        todaySalesPagination.reset();
        renderTodaySalesTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="p-10 text-center text-rose-500 font-bold">အရောင်းစာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function filterAndRenderTodaySales() {
    const kw = (document.getElementById("today-sales-search")?.value || "").trim().toLowerCase();

    currentFilteredTodaySales = todaySalesList.filter(s => {
        if (!kw) return true;
        const hay = `${s.invoice_no || ""} ${s.customer_name || ""} ${s.item_name || ""} ${s.category || ""} ${s.payment_method || ""} ${s.notes || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    todaySalesPagination.reset();
    renderTodaySalesTable();
}

function renderTodaySalesTable() {
    const tbody = document.getElementById("today-sales-table-body");
    const countEl = document.getElementById("today-sales-invoice-count");
    const totalQtyEl = document.getElementById("today-sales-total-qty");
    const totalAmountEl = document.getElementById("today-sales-total-amount");

    if (!tbody) return;
    tbody.innerHTML = "";

    const invoiceMap = new Map();
    let totalQty = 0;

    currentFilteredTodaySales.forEach(s => {
        const invNo = s.invoice_no || `INV-${s.sale_id || s.id}`;
        totalQty += Number(s.quantity || 1);
        if (!invoiceMap.has(invNo)) {
            invoiceMap.set(invNo, Number(s.final_amount ?? (s.total_amount || 0)));
        }
    });

    const uniqueInvoiceCount = invoiceMap.size;
    let grandRevenue = 0;
    invoiceMap.forEach(amount => { grandRevenue += amount; });

    if (countEl) countEl.textContent = uniqueInvoiceCount.toLocaleString();
    if (totalQtyEl) totalQtyEl.textContent = totalQty.toLocaleString();
    if (totalAmountEl) totalAmountEl.textContent = `${grandRevenue.toLocaleString()} Ks`;

    if (currentFilteredTodaySales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-10 text-center text-slate-400 font-bold text-xs">ယနေ့ အရောင်းစာရင်း မရှိသေးပါ</td></tr>`;
        todaySalesPagination.renderControls("today-sales-pagination");
        return;
    }

    const pageItems = todaySalesPagination.getPageItems(currentFilteredTodaySales);
    const startIdx = (todaySalesPagination.currentPage - 1) * todaySalesPagination.pageSize;

    pageItems.forEach((s, idx) => {
        const timeStr = s.created_at ? new Date(s.created_at).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit', hour12: true }) : "-";
        const qty = Number(s.quantity || 1);
        const price = Number(s.unit_price || s.price || 0);
        const amount = Number(s.subtotal || (qty * price));
        const method = String(s.payment_method || "cash").toLowerCase();
        const unit = s.size || "ထည်";

        let methodBadge = "";
        if (method === "bank") {
            methodBadge = `<span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold border border-blue-500/20">ဘဏ် (${escapeHtml(s.bank_account_name || "KPay")})</span>`;
        } else if (method === "credit") {
            methodBadge = `<span class="px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-bold border border-rose-500/20">အကြွေး</span>`;
        } else {
            methodBadge = `<span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-500/20">ငွေသား</span>`;
        }

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-3 text-center text-slate-400 font-mono">${startIdx + idx + 1}</td>
            <td class="p-3 font-mono text-slate-600 dark:text-slate-300">
                <div class="font-bold text-blue-600 dark:text-blue-400">${escapeHtml(s.invoice_no || `INV-${s.sale_id || s.id}`)}</div>
                <div class="text-[10px] text-slate-400">${timeStr}</div>
            </td>
            <td class="p-3">
                <div class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(s.customer_name || "Walk-in")}</div>
                <span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold uppercase">${escapeHtml(s.sale_type || "Retail")}</span>
            </td>
            <td class="p-3">
                <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    ${escapeHtml(s.category || "-")}
                </span>
            </td>
            <td class="p-3">
                <div class="font-bold text-slate-900 dark:text-white">${escapeHtml(s.item_name || "-")}</div>
                <div class="text-[10px] text-slate-400">${escapeHtml(s.color || "")} ${s.pattern ? `• ${escapeHtml(s.pattern)}` : ''}</div>
            </td>
            <td class="p-3 text-center font-mono font-bold text-blue-600 dark:text-blue-400">
                ${qty.toLocaleString()} <span class="text-[10px] font-sans font-normal text-slate-400">${escapeHtml(unit)}</span>
            </td>
            <td class="p-3 text-right font-mono font-bold text-slate-700 dark:text-slate-300">${price.toLocaleString()}</td>
            <td class="p-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">${amount.toLocaleString()}</td>
            <td class="p-3 text-center">${methodBadge}</td>
            <td class="p-3 text-[11px] text-slate-500 dark:text-slate-400 max-w-[140px] truncate" title="${escapeHtml(s.notes || s.remark || '')}">
                ${escapeHtml(s.notes || s.remark || "-")}
            </td>
            <td class="p-3 text-center">
                <button type="button" data-inv="${escapeHtml(s.invoice_no || `INV-${s.sale_id || s.id}`)}" class="btn-reprint-sale px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 transition cursor-pointer inline-flex items-center gap-1 shadow-sm" title="ဘောင်ချာ မူရင်းအတိုင်း ပြန်ထုတ်မည်">
                    <i class="fa-solid fa-print text-xs"></i>
                    <span>Print</span>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-reprint-sale").forEach(btn => {
        btn.onclick = () => {
            const invNo = btn.dataset.inv;
            const items = todaySalesList.filter(s => (s.invoice_no || `INV-${s.sale_id || s.id}`) === invNo);
            if (items.length > 0) {
                const sub = items.reduce((acc, it) => acc + Number(it.subtotal || (Number(it.quantity || 1) * Number(it.unit_price || it.price || 0))), 0);
                const disc = Number(items[0].discount_amount || 0);
                const fin = Number(items[0].final_amount ?? Math.max(0, sub - disc));
                const paid = Number(items[0].paid_amount ?? fin);

                showReceiptModal({
                    invoiceNo: invNo,
                    items: items,
                    subtotal: sub,
                    discount: disc,
                    finalTotal: fin,
                    paid: paid,
                    customerName: items[0].customer_name || "Walk-in",
                    paymentMethod: items[0].payment_method || "cash",
                    bankName: items[0].bank_account_name || null
                });
            }
        };
    });

    todaySalesPagination.renderControls("today-sales-pagination");
}

function exportTodaySalesToCSV() {
    const dataToExport = currentFilteredTodaySales.length > 0 ? currentFilteredTodaySales : todaySalesList;
    if (dataToExport.length === 0) {
        return alert("ထုတ်ယူရန် အရောင်းစာရင်း မရှိသေးပါ။");
    }

    const todayStr = getLocalBusinessDate();
    let csv = "Invoice No,Time,Customer Name,Sale Type,Category,Item Name,Quantity,Unit Price,Amount,Payment Method,Remark\n";

    dataToExport.forEach(s => {
        const timeStr = s.created_at ? new Date(s.created_at).toLocaleTimeString("en-GB") : "-";
        const qty = Number(s.quantity || 1);
        const price = Number(s.unit_price || s.price || 0);
        const amount = Number(s.subtotal || (qty * price));

        const row = [
            escapeCsv(s.invoice_no || `INV-${s.sale_id || s.id}`),
            escapeCsv(timeStr),
            escapeCsv(s.customer_name || 'Walk-in'),
            escapeCsv(s.sale_type || 'Retail'),
            escapeCsv(s.category || '-'),
            escapeCsv(s.item_name || '-'),
            qty,
            price,
            amount,
            escapeCsv(s.payment_method || 'Cash'),
            escapeCsv(s.notes || s.remark || '-')
        ];
        csv += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Today_Sales_${todayStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
