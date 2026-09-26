const state = {
  products: [],
  categories: [],
  category: "All",
  search: "",
  cart: JSON.parse(localStorage.getItem("jaab-cart") || "[]"),
  token: localStorage.getItem("jaab-token"),
  user: JSON.parse(localStorage.getItem("jaab-user") || "null"),
  authMode: "login",
};
const $ = (selector) => document.querySelector(selector);
const money = (value) => `GH₵${new Intl.NumberFormat("en-GH").format(value)}`;
const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};
const persistCart = () => {
  localStorage.setItem("jaab-cart", JSON.stringify(state.cart));
  renderCart();
};
const toast = (message) => {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2800);
};
async function loadProducts() {
  const data = await api(
    `/api/products?search=${encodeURIComponent(state.search)}&category=${encodeURIComponent(state.category)}`,
  );
  state.products = data.products;
  state.categories = data.categories;
  renderCategories();
  renderProducts();
}
function renderCategories() {
  $("#categories").innerHTML = state.categories
    .map(
      (category) =>
        `<button class="category-button ${category === state.category ? "active" : ""}" data-category="${category}">${category}</button>`,
    )
    .join("");
  document.querySelectorAll("[data-category]").forEach(
    (button) =>
      (button.onclick = () => {
        state.category = button.dataset.category;
        loadProducts();
      }),
  );
}
function whatsappLink(product) {
  return `https://wa.me/233558688201?text=${encodeURIComponent(`Hello JAAB, I would like to buy ${product.name} for ${money(product.price)}.`)}`;
}
function renderProducts() {
  $("#product-grid").innerHTML = state.products.length
    ? state.products
        .map(
          (product) =>
            `<article class="product-card"><div class="product-visual ${product.tone}" data-zoom-product="${product.id}" role="button" tabindex="0" aria-label="Zoom ${product.name}">${product.image ? `<img class="product-image" src="${product.image}" alt="${product.name}">` : `<div class="product-shape">${product.emoji}</div>`}<span class="product-badge">${product.badge}</span></div><div class="product-meta"><div><p class="product-name">${product.name}</p><span class="product-category">${product.category} · ${product.stock} available</span></div><span class="product-price">${money(product.price)}</span></div><p class="product-description">${product.description}</p>${product.stock ? `<div class="product-actions"><button class="add-button" data-add="${product.id}">Add to cart +</button><a class="whatsapp-button" href="${whatsappLink(product)}" target="_blank" rel="noreferrer">Buy via WhatsApp</a></div>` : '<button class="add-button" disabled>Sold out</button>'}</article>`,
        )
        .join("")
    : '<p class="empty-state">Nothing matched that search. Try a different phrase.</p>';
  document
    .querySelectorAll("[data-add]")
    .forEach(
      (button) => (button.onclick = () => addToCart(button.dataset.add)),
    );
  document.querySelectorAll("[data-zoom-product]").forEach((visual) => {
    const open = () => openZoom(visual.dataset.zoomProduct);
    visual.onclick = open;
    visual.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    };
  });
}
let zoomScale = 1;
function applyZoomScale() {
  const content = $("#zoom-frame").firstElementChild;
  if (content) content.style.transform = `scale(${zoomScale})`;
  $("#zoom-level").textContent = `${Math.round(zoomScale * 100)}%`;
  $("#zoom-out").disabled = zoomScale <= 0.6;
  $("#zoom-in").disabled = zoomScale >= 2;
}
function openZoom(id) {
  const product =
    allProducts.find((item) => item.id === id) ||
    state.products.find((item) => item.id === id);
  if (!product) return;
  zoomScale = 1;
  $("#zoom-frame").innerHTML = product.image
    ? `<img src="${product.image}" alt="${product.name}">`
    : `<div class="zoom-fallback ${product.tone}"><div class="product-shape">${product.emoji}</div></div>`;
  $("#zoom-title").textContent = `${product.name} · ${money(product.price)}`;
  applyZoomScale();
  $("#zoom-dialog").showModal();
}
$("#zoom-out").onclick = () => {
  zoomScale = Math.max(0.6, zoomScale - 0.2);
  applyZoomScale();
};
$("#zoom-in").onclick = () => {
  zoomScale = Math.min(2, zoomScale + 0.2);
  applyZoomScale();
};
$("#close-zoom").onclick = () => $("#zoom-dialog").close();
$("#zoom-dialog").addEventListener("click", (event) => {
  if (event.target === $("#zoom-dialog")) $("#zoom-dialog").close();
});
function addToCart(id) {
  const product =
    state.products.find((item) => item.id === id) ||
    allProducts.find((item) => item.id === id);
  const existing = state.cart.find((item) => item.productId === id);
  if (existing) existing.quantity += 1;
  else state.cart.push({ productId: id, quantity: 1 });
  persistCart();
  toast(`${product.name} added to your bag`);
}
let allProducts = [];
function renderCart() {
  const lines = state.cart
    .map((item) => {
      const product = allProducts.find((entry) => entry.id === item.productId);
      return product ? { ...item, product } : null;
    })
    .filter(Boolean);
  const total = lines.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0,
  );
  $("#cart-count").textContent = state.cart.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  $("#cart-total").textContent = money(total);
  $("#cart-items").innerHTML = lines.length
    ? lines
        .map(
          (item) =>
            `<div class="cart-line"><div class="cart-thumb product-visual ${item.product.tone}">${item.product.image ? `<img class="product-image" src="${item.product.image}" alt="${item.product.name}">` : `<div class="product-shape">${item.product.emoji}</div>`}</div><div><p>${item.product.name}</p><small>${money(item.product.price)}</small><div class="cart-qty"><button data-minus="${item.productId}">−</button>${item.quantity}<button data-plus="${item.productId}">+</button></div></div><strong>${money(item.product.price * item.quantity)}</strong></div>`,
        )
        .join("")
    : '<p class="empty-state">Your bag is waiting for something special.</p>';
  document
    .querySelectorAll("[data-plus]")
    .forEach(
      (button) =>
        (button.onclick = () => changeQuantity(button.dataset.plus, 1)),
    );
  document
    .querySelectorAll("[data-minus]")
    .forEach(
      (button) =>
        (button.onclick = () => changeQuantity(button.dataset.minus, -1)),
    );
}
function changeQuantity(id, delta) {
  const line = state.cart.find((item) => item.productId === id);
  if (!line) return;
  line.quantity += delta;
  if (line.quantity <= 0)
    state.cart = state.cart.filter((item) => item.productId !== id);
  persistCart();
}
function openCart() {
  $("#cart-drawer").classList.add("open");
  $("#cart-drawer").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("show");
}
function closeCart() {
  $("#cart-drawer").classList.remove("open");
  $("#cart-drawer").setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("show");
}
function setAuth(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem("jaab-user", JSON.stringify(user));
  localStorage.setItem("jaab-token", token);
  updateAccount();
  renderOrders();
  if (user.role === "admin") renderAdmin();
}
function updateAccount() {
  $("#account-button").textContent = state.user
    ? state.user.name.split(" ")[0]
    : "Sign in";
  $("#register-button").style.display = state.user ? "none" : "inline-flex";
  $("#logout-button").hidden = !state.user;
  $("#admin").style.display = state.user?.role === "admin" ? "block" : "none";
}
function openAuth() {
  $("#auth-dialog").showModal();
}
function renderOrders() {
  const headerTarget = $("#header-orders-content");
  const signin = `<div class="auth-prompt"><p class="empty-state">Sign in to see your orders and delivery updates.</p><button class="primary-button" id="orders-signin">Sign in <span>→</span></button></div>`;
  if (!state.user) {
    headerTarget.innerHTML = signin;
    $("#header-orders-count").textContent = "0";
    $("#orders-signin").onclick = () => {
      $("#order-history-dialog").close();
      openAuth();
    };
    return;
  }
  api("/api/orders")
    .then((data) => {
      const orders = data.orders;
      const markup = orders.length
        ? orders
            .map(
              (order) =>
                `<div class="order-row"><div><p class="order-id">Order ID: ${order.reference || order.id}</p><p class="order-date">${new Date(order.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}</p></div><div class="order-items">${order.items.map((item) => `${item.quantity} × ${item.name}`).join("<br>")}</div><span class="status">${order.status}</span><strong class="order-total">${money(order.total)}</strong></div>`,
            )
            .join("")
        : '<p class="empty-state">Your order history is empty. Your first Jaab piece is close.</p>';
      headerTarget.innerHTML = markup;
      $("#header-orders-count").textContent = String(orders.length);
    })
    .catch((error) => {
      headerTarget.innerHTML = `<p class="empty-state">${error.message}</p>`;
    });
}
function renderAdmin() {
  if (state.user?.role !== "admin") return;
  Promise.all([api("/api/admin/orders"), api("/api/products")])
    .then(([orderData, productData]) => {
      $("#admin-content").innerHTML =
        `<div class="admin-toolbar"><span>${orderData.orders.length} incoming orders</span><span>Inventory · ${productData.products.reduce((sum, item) => sum + item.stock, 0)} units live</span></div>${orderData.orders.map((order) => `<div class="admin-order"><div><p class="admin-id">Order ID: ${order.reference || order.id}</p><p class="order-date">${order.customer} · ${new Date(order.createdAt).toLocaleDateString("en-NG")}</p></div><div class="order-items">${order.items.map((item) => `${item.quantity} × ${item.name}`).join("<br>")}</div><span>${money(order.total)}</span><select class="status-select" data-order-status="${order.id}">${["Order received", "Processing", "Out for delivery", "Delivered", "Cancelled"].map((status) => `<option ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select></div>`).join("")}<h3 class="eyebrow" style="margin-top:52px">Edit catalog</h3>${productData.products.map((product) => `<div class="inventory-row"><div class="inventory-info"><strong>${product.id}</strong><small>${product.category}</small></div><div class="product-edit-form"><input class="admin-product-input" data-field="name" data-product="${product.id}" value="${product.name}" aria-label="Product name"><select class="admin-product-input" data-field="category" data-product="${product.id}" aria-label="Product category"><option ${product.category === "Bags" ? "selected" : ""}>Bags</option><option ${product.category === "Perfumes" ? "selected" : ""}>Perfumes</option></select><input class="admin-product-input" data-field="price" data-product="${product.id}" type="number" min="0" step="1" value="${product.price}" aria-label="Product price"><input class="admin-product-input" data-field="stock" data-product="${product.id}" type="number" min="0" step="1" value="${product.stock}" aria-label="Product stock"><input class="admin-product-input" data-field="badge" data-product="${product.id}" value="${product.badge}" aria-label="Product badge"><textarea class="admin-product-input" data-field="description" data-product="${product.id}" aria-label="Product description">${product.description}</textarea><button class="add-button" data-save-product="${product.id}">Save changes</button></div></div>`).join("")}`;
      document.querySelectorAll("[data-order-status]").forEach(
        (select) =>
          (select.onchange = async () => {
            await api(`/api/admin/orders/${select.dataset.orderStatus}`, {
              method: "PATCH",
              body: JSON.stringify({ status: select.value }),
            });
            toast("Order status updated");
          }),
      );
      document.querySelectorAll("[data-save-product]").forEach(
        (button) =>
          (button.onclick = async () => {
            const productId = button.dataset.saveProduct;
            const fields = [
              ...document.querySelectorAll(`[data-product="${productId}"]`),
            ];
            const values = Object.fromEntries(
              fields.map((field) => [
                field.dataset.field,
                field.type === "number" ? Number(field.value) : field.value,
              ]),
            );
            try {
              await api(`/api/admin/products/${productId}`, {
                method: "PATCH",
                body: JSON.stringify(values),
              });
              allProducts = (await api("/api/products")).products;
              toast("Product updated");
              loadProducts();
            } catch (error) {
              toast(error.message);
            }
          }),
      );
    })
    .catch((error) => {
      $("#admin-content").innerHTML =
        `<p class="empty-state">${error.message}</p>`;
    });
}
$("#cart-button").onclick = openCart;
$("#close-cart").onclick = closeCart;
$("#scrim").onclick = closeCart;
$("#account-button").onclick = () =>
  state.user ? document.querySelector("#orders").scrollIntoView() : openAuth();
$("#register-button").onclick = () => {
  state.authMode = "register";
  $("#auth-title").textContent = "Create your Jaab account.";
  $("#auth-submit").innerHTML = "Create account <span>→</span>";
  $("#auth-name").style.display = "block";
  $("#switch-auth").textContent = "Already have an account? Sign in";
  openAuth();
};
$("#logout-button").onclick = () => {
  state.user = null;
  state.token = null;
  localStorage.removeItem("jaab-user");
  localStorage.removeItem("jaab-token");
  updateAccount();
  renderOrders();
  toast("You have been signed out");
  document.querySelector("#orders").scrollIntoView();
};
$("#search-input").oninput = (event) => {
  state.search = event.target.value;
  loadProducts();
};
$("#close-auth").onclick = () => $("#auth-dialog").close();
$("#close-checkout").onclick = () => $("#checkout-dialog").close();
$("#switch-auth").onclick = () => {
  state.authMode = state.authMode === "login" ? "register" : "login";
  $("#auth-title").textContent =
    state.authMode === "login"
      ? "Sign in to Jaab."
      : "Create your Jaab account.";
  $("#auth-submit").innerHTML =
    `${state.authMode === "login" ? "Sign in" : "Create account"} <span>→</span>`;
  $("#auth-name").style.display = state.authMode === "login" ? "none" : "block";
  $("#switch-auth").textContent =
    state.authMode === "login"
      ? "New here? Create an account"
      : "Already have an account? Sign in";
};
let registrationCooldownUntil = 0;
$("#account-button").onclick = () =>
  state.user ? $("#order-history-dialog").showModal() : openAuth();
$("#auth-form").onsubmit = async (event) => {
  event.preventDefault();
  $("#auth-error").textContent = "";
  if (state.authMode === "register" && Date.now() < registrationCooldownUntil) {
    $("#auth-error").textContent =
      "Please wait a moment before trying registration again.";
    return;
  }
  try {
    const data = await api(
      `/api/auth/${state.authMode === "login" ? "login" : "register"}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: $("#auth-name").value,
          email: $("#auth-email").value,
          password: $("#auth-password").value,
        }),
      },
    );
    setAuth(data.user, data.token);
    $("#auth-dialog").close();
    toast(`Welcome, ${data.user.name.split(" ")[0]}`);
  } catch (error) {
    if (state.authMode === "register")
      registrationCooldownUntil = Date.now() + 60000;
    $("#auth-error").textContent = error.message;
  }
};
$("#checkout-button").onclick = () => {
  if (!state.cart.length) return toast("Add something to your bag first");
  if (!state.user) {
    closeCart();
    openAuth();
    return;
  }
  closeCart();
  $("#checkout-dialog").showModal();
};
$("#header-orders-button").onclick = () => {
  $("#order-history-dialog").showModal();
  renderOrders();
};
$("#close-order-history").onclick = () => $("#order-history-dialog").close();
function updatePaymentInstructions() {
  const paymentStep = $("#payment-step");
  if (!paymentStep || paymentStep.classList.contains("payment-page")) return;
  paymentStep.hidden = true;
}
document
  .querySelectorAll('input[name="payment"]')
  .forEach((radio) =>
    radio.addEventListener("change", updatePaymentInstructions),
  );
function showMomoStep() {
  const paymentStep = $("#payment-step");
  const checkoutForm = $("#checkout-form");
  const lines = state.cart
    .map((item) => {
      const product = allProducts.find((entry) => entry.id === item.productId);
      return product ? { ...item, product } : null;
    })
    .filter(Boolean);
  const total = lines.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
    0,
  );
  const reference = `JAAB-${Date.now().toString(36).slice(-6).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  $("#payment-reference").textContent = reference;
  $("#payment-reference-inline").textContent = reference;
  $("#payment-total").textContent = money(total);
  $("#payment-amount").textContent = money(total);
  $("#payment-summary-total").textContent = money(total);
  $("#payment-items").innerHTML = lines
    .map(
      (line) =>
        `<div class="payment-item-row"><span>${line.product.name} ×${line.quantity}</span><strong>${money(line.product.price * line.quantity)}</strong></div>`,
    )
    .join("");
  $("#momo-payment-confirmed").checked = false;
  $("#confirm-order-button").disabled = true;
  checkoutForm.hidden = true;
  paymentStep.classList.remove("payment-page");
  paymentStep.hidden = false;
}
function hideMomoStep() {
  const paymentStep = $("#payment-step");
  paymentStep.classList.remove("payment-page");
  paymentStep.hidden = true;
  document.body.classList.remove("payment-page-open");
  $("#checkout-form").hidden = false;
}
document.addEventListener("click", async (event) => {
  const backButton = event.target.closest("[data-back-to-checkout]");
  if (backButton) {
    hideMomoStep();
    return;
  }
  const confirmButton = event.target.closest("#confirm-order-button");
  if (confirmButton) {
    if (!$("#momo-payment-confirmed").checked) {
      $("#checkout-error").textContent =
        "Please confirm that you have completed the MTN MOMO payment.";
      return;
    }
    $("#checkout-error").textContent = "";
    const checkoutData = {
      items: state.cart,
      address: $("#checkout-address").value.trim(),
      city: $("#checkout-city").value.trim(),
      state: $("#checkout-state").value.trim(),
      zipCode: $("#checkout-zip").value.trim(),
      phone: $("#checkout-phone").value.trim(),
      payment: document.querySelector('input[name="payment"]:checked').value,
    };
    try {
      const data = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify(checkoutData),
      });
      state.cart = [];
      persistCart();
      $("#checkout-dialog").close();
      toast(`Order ${data.order.id} received`);
      renderOrders();
      document.querySelector("#orders").scrollIntoView();
    } catch (error) {
      $("#checkout-error").textContent = error.message;
    }
  }
});
$("#checkout-form").onsubmit = async (event) => {
  event.preventDefault();
  $("#checkout-error").textContent = "";
  const selectedPayment = document.querySelector(
    'input[name="payment"]:checked',
  ).value;
  const checkoutData = {
    items: state.cart,
    address: $("#checkout-address").value.trim(),
    city: $("#checkout-city").value.trim(),
    state: $("#checkout-state").value.trim(),
    zipCode: $("#checkout-zip").value.trim(),
    phone: $("#checkout-phone").value.trim(),
    payment: selectedPayment,
  };
  if (selectedPayment === "Mobile Money") {
    showMomoStep();
    return;
  }
  try {
    const data = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(checkoutData),
    });
    state.cart = [];
    persistCart();
    $("#checkout-dialog").close();
    toast(`Order ${data.order.id} received`);
    renderOrders();
    document.querySelector("#orders").scrollIntoView();
  } catch (error) {
    $("#checkout-error").textContent = error.message;
  }
};
$("#momo-payment-confirmed").addEventListener("change", (event) => {
  $("#confirm-order-button").disabled = !event.target.checked;
});
updatePaymentInstructions();
function renderAdminUsers() {
  if (state.user?.role !== "admin" || $("#admin-users")) return;
  api("/api/admin/users")
    .then((data) => {
      const section = document.createElement("section");
      section.id = "admin-users";
      section.className = "admin-users";
      section.innerHTML = `<h3 class="eyebrow">Registered customers</h3><div class="admin-users-list">${data.users.map((user) => `<div class="admin-user-row"><div><strong>${user.name}</strong><small>${user.email}</small></div><span class="admin-user-role">${user.role}</span><time>${new Date(user.createdAt).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" })}</time></div>`).join("")}</div>`;
      $("#admin-content").appendChild(section);
    })
    .catch((error) => toast(error.message));
}
function renderAdminCreateProduct() {
  if (state.user?.role !== "admin" || $("#admin-create-product")) return;
  const section = document.createElement("section");
  section.id = "admin-create-product";
  section.className = "admin-create-product";
  section.innerHTML = `<h3 class="eyebrow">Add a product</h3><p id="supabase-product-status" role="status"></p><form id="new-product-form" class="new-product-form"><input class="admin-product-input" name="name" required placeholder="Product name"><select class="admin-product-input" name="category"><option>Bags</option><option>Perfumes</option></select><input class="admin-product-input" name="price" type="number" min="0" required placeholder="Price"><input class="admin-product-input" name="stock" type="number" min="0" step="1" required placeholder="Stock"><input class="admin-product-input" name="badge" required placeholder="Badge"><textarea class="admin-product-input" name="description" required placeholder="Description"></textarea><input class="admin-product-input product-image-input" name="image" type="file" accept="image/jpeg,image/png,image/webp"><button class="add-button" type="submit">Add product +</button><p class="form-error" id="new-product-error" role="alert"></p></form>`;
  $("#admin-content").prepend(section);
  api("/api/health/supabase").then((health) => {
    $("#supabase-product-status").textContent = health.productUploadsConfigured
      ? `Product records and images save to Supabase Storage (${health.storageBucket}).`
      : "Supabase uploads are not enabled yet. Add SUPABASE_SERVICE_ROLE_KEY to the server .env and restart the app.";
  }).catch(() => {
    $("#supabase-product-status").textContent = "Could not check Supabase upload configuration.";
  });
  $("#new-product-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (key) => form.elements.namedItem(key);
    const file = field("image").files[0];
    let image = "";
    const submitButton = form.querySelector('[type="submit"]');
    const errorElement = $("#new-product-error");
    errorElement.textContent = "";
    if (file && file.size > 3 * 1024 * 1024) {
      errorElement.textContent = "Image must be smaller than 3MB.";
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Uploading...";
    try {
      if (file) {
        image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Could not read the selected image."));
          reader.readAsDataURL(file);
        });
      }
      await api("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name: field("name").value,
          category: field("category").value,
          price: Number(field("price").value),
          stock: Number(field("stock").value),
          badge: field("badge").value,
          description: field("description").value,
          image,
        }),
      });
      toast("Product uploaded to Supabase");
      allProducts = (await api("/api/products")).products;
      form.reset();
      loadProducts();
      renderAdmin();
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Add product +";
    }
  };
}
function addProductImageInputs() {
  document.querySelectorAll("[data-save-product]").forEach((button) => {
    if (button.parentElement.querySelector(".product-image-input")) return;
    const input = document.createElement("input");
    input.className = "admin-product-input product-image-input";
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.setAttribute("aria-label", "Upload product image");
    input.dataset.image = button.dataset.saveProduct;
    button.parentElement.insertBefore(input, button);
  });
  renderAdminUsers();
  renderAdminCreateProduct();
}
const adminEditorObserver = new MutationObserver(addProductImageInputs);
adminEditorObserver.observe($("#admin-content"), {
  childList: true,
  subtree: true,
});
document.addEventListener(
  "click",
  async (event) => {
    const button = event.target.closest("[data-save-product]");
    if (!button || !state.user || state.user.role !== "admin") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const productId = button.dataset.saveProduct;
    const fields = [
      ...document.querySelectorAll(`[data-product="${productId}"]`),
    ];
    const values = Object.fromEntries(
      fields.map((field) => [
        field.dataset.field,
        field.type === "number" ? Number(field.value) : field.value,
      ]),
    );
    const imageInput = document.querySelector(`[data-image="${productId}"]`);
    if (imageInput?.files?.[0]) {
      if (imageInput.files[0].size > 3 * 1024 * 1024)
        return toast("Image must be smaller than 3MB");
      values.image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(imageInput.files[0]);
      });
    }
    try {
      await api(`/api/admin/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      allProducts = (await api("/api/products")).products;
      toast("Product updated");
      loadProducts();
      renderAdmin();
    } catch (error) {
      toast(error.message);
    }
  },
  true,
);
async function init() {
  const data = await api("/api/products");
  allProducts = data.products;
  state.products = data.products;
  state.categories = data.categories;
  renderCategories();
  renderProducts();
  renderCart();
  updateAccount();
  renderOrders();
  if (state.user?.role === "admin") renderAdmin();
}
init();
