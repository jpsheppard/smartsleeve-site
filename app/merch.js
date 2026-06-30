(function () {
  "use strict";

  var checkoutEndpoint = meta("smartsleeve-merch-checkout-endpoint");
  var catalogEndpoint = meta("smartsleeve-merch-catalog-endpoint");
  var authEndpoint = meta("smartsleeve-auth-endpoint");
  var registerEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/register" : "";
  var merchImageVersion = "20260630-womens-tee-backs";
  var state = {
    products: [],
    cart: [],
    catalogLoaded: false,
    checkoutMode: "guest",
    customerEmail: "",
    account: {
      username: "",
      firstName: "",
      lastName: "",
      password: "",
      passwordConfirm: "",
      acceptedTerms: false
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function meta(name) {
    var element = document.querySelector("meta[name=\"" + name + "\"]");
    var value = element ? String(element.getAttribute("content") || "").trim() : "";
    return value && value.indexOf("__") !== 0 ? value : "";
  }

  function html(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function text(id, value) {
    var element = $(id);
    if (element) element.textContent = value;
  }

  function money(value) {
    return "$" + (Number(value) || 0).toFixed(2);
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function isShopRoute(value) {
    var target = String(value || window.location.hash || "#").replace("#", "").split("?")[0];
    return target === "shop" || target === "store" || target === "shop-success" || target === "shop-cancel";
  }

  function showShop() {
    document.body.classList.add("public-shop");
    all("[data-section]").forEach(function (panel) {
      panel.classList.toggle("active", panel.getAttribute("data-section") === "shop");
    });
    all("[data-nav]").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-nav") === "shop");
    });
    document.title = "Merch Shop | SmartSleeve";
    var gate = $("auth-gate");
    if (gate) gate.remove();
    loadCatalogOnce();
  }

  function merchBrand(product) {
    return /sqts/i.test(product.name || product.key || "") ? "sqts" : "ss";
  }

  function merchFrontLabel(product) {
    return merchBrand(product) === "sqts" ? "SQTS" : "SmartSleeve";
  }

  function merchGender(product) {
    return String(product.name || product.key || "").toLowerCase().indexOf("women") !== -1 ? "Women" : "Men";
  }

  function merchBackType(product) {
    var value = String(product.name || product.key || "").toLowerCase();
    if (value.indexOf("website+qr") !== -1 || value.indexOf("website-qr") !== -1) return "Website + QR";
    if (value.indexOf("website") !== -1) return "Website";
    return "Black";
  }

  function merchCut(product) {
    var value = String(product.name || product.key || "").toLowerCase();
    if (value.indexOf("muscle") !== -1) return "Muscle Tee";
    if (value.indexOf("tank") !== -1) return "Tank Top";
    return "T-Shirt";
  }

  function merchPreviewFor(product) {
    if (product && product.preview) return product.preview;
    var brand = merchBrand(product) === "sqts" ? "sqts-llc" : "smartsleeve-ss";
    var cut = merchCut(product) === "Tank Top" || merchCut(product) === "Muscle Tee" ? "tank" : "tee";
    var back = merchBackType(product) === "Website + QR" ? "promo" : merchBackType(product) === "Website" ? "website" : "brand";
    return "/merch/" + brand + "-" + cut + "-" + back + "-preview.png";
  }

  function merchFrontImage(product) {
    return product.front_mockup || product.preview || product.front_print_preview || merchPreviewFor(product);
  }

  function merchBackImage(product) {
    return product.back_mockup || product.back_print_preview || "";
  }

  function merchImageSrc(value) {
    var url = String(value || "");
    if (url.indexOf("/merch/mockups/") === -1) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + merchImageVersion;
  }

  function merchDefaultSize(product) {
    var sizes = product && product.sizes ? product.sizes : [];
    if (sizes.indexOf("L") !== -1) return "L";
    if (sizes.indexOf("M") !== -1) return "M";
    return sizes[0] || "M";
  }

  function merchPrice(product, size) {
    var prices = product && product.prices ? product.prices : {};
    var raw = prices[size] || prices[merchDefaultSize(product)] || String(product.price_label || "").replace(/[^0-9.]/g, "");
    var number = Number(raw);
    return Number.isFinite(number) ? number : 0;
  }

  function merchCartKey(productKey, size) {
    return productKey + "::" + size;
  }

  function merchCleanName(name) {
    var clean = String(name || "SmartSleeve merch").trim();
    clean = clean.replace(/\s*-\s*(Plain|Blank|Website|Website\+QR)\s+Back$/i, "");
    clean = clean.replace(/\s+(Plain|Blank|Website|Website\+QR)\s+Back$/i, "");
    clean = clean.replace(/^SmartSleeve\s+SS\s*[- ]\s*/i, "SmartSleeve ");
    clean = clean.replace(/^SS\s*[- ]\s*/i, "SmartSleeve ");
    clean = clean.replace(/\bSS\b/g, "SmartSleeve");
    clean = clean.replace(/^SmartSleeve\s+SQTS\b/i, "SQTS");
    clean = clean.replace(/\s{2,}/g, " ").trim();
    return clean;
  }

  function sortValue(value, order) {
    var index = order.indexOf(value);
    return index === -1 ? order.length : index;
  }

  function sortProduct(a, b) {
    return sortValue(merchGender(a), ["Men", "Women"]) - sortValue(merchGender(b), ["Men", "Women"])
      || sortValue(merchCut(a), ["T-Shirt", "Tank Top", "Muscle Tee"]) - sortValue(merchCut(b), ["T-Shirt", "Tank Top", "Muscle Tee"])
      || sortValue(merchFrontLabel(a), ["SmartSleeve", "SQTS"]) - sortValue(merchFrontLabel(b), ["SmartSleeve", "SQTS"])
      || sortValue(merchBackType(a), ["Black", "Website", "Website + QR"]) - sortValue(merchBackType(b), ["Black", "Website", "Website + QR"])
      || String(a.name || "").localeCompare(String(b.name || ""));
  }

  function groupKey(product) {
    if (merchCut(product) === "Muscle Tee") return "All::Muscle Tee";
    return merchGender(product) + "::" + merchCut(product);
  }

  function groupTitle(key) {
    var parts = String(key || "").split("::");
    var gender = parts[0] || "Merch";
    var cut = parts[1] || "Apparel";
    if (gender === "Women" && cut === "Tank Top") return "Women's Racerback Tanks";
    var plural = cut === "T-Shirt" ? "T-Shirts" : cut === "Tank Top" ? "Tank Tops" : cut === "Muscle Tee" ? "Muscle Tees" : cut;
    return gender === "All" ? plural : gender + "'s " + plural;
  }

  function groupSort(key) {
    var order = {
      "Men::T-Shirt": 0,
      "Men::Tank Top": 1,
      "All::Muscle Tee": 2,
      "Women::T-Shirt": 3,
      "Women::Tank Top": 4
    };
    return order[key] == null ? 99 : order[key];
  }

  function merchCard(product) {
    var size = merchDefaultSize(product);
    var backImage = merchBackImage(product);
    var options = (product.sizes || []).map(function (item) {
      return "<option value=\"" + html(item) + "\"" + (item === size ? " selected" : "") + ">" + html(item) + "</option>";
    }).join("");
    return "<article class=\"merch-product-card\" data-merch-product-card=\"" + html(product.key) + "\">"
      + "<div class=\"merch-product-images" + (backImage ? "" : " single-view") + "\">"
      + "<figure><img src=\"" + html(merchImageSrc(merchFrontImage(product))) + "\" alt=\"" + html(merchCleanName(product.name)) + " front\" loading=\"lazy\"><figcaption>Front</figcaption></figure>"
      + (backImage ? "<figure><img src=\"" + html(merchImageSrc(backImage)) + "\" alt=\"" + html(merchCleanName(product.name)) + " back\" loading=\"lazy\"><figcaption>Back</figcaption></figure>" : "")
      + "</div>"
      + "<div class=\"merch-product-copy\">"
      + "<h4>" + html(merchCleanName(product.name)) + "</h4>"
      + "<div class=\"merch-chip-row\"><span>Front: " + html(merchFrontLabel(product)) + "</span><span>Back: " + html(merchBackType(product)) + "</span></div>"
      + "<div class=\"merch-buy-row\">"
      + "<strong>" + html(product.price_label || money(merchPrice(product, size))) + "</strong>"
      + "<label>Size <select data-merch-size=\"" + html(product.key) + "\">" + options + "</select></label>"
      + "<button type=\"button\" class=\"primary\" data-merch-add=\"" + html(product.key) + "\">Add to cart</button>"
      + "</div></div></article>";
  }

  function productsFrom(payload) {
    return ((payload && payload.products) || []).filter(function (product) {
      return product && product.key && product.name && product.sizes && product.sizes.length;
    });
  }

  function mergeProducts(primary, fallback) {
    var fallbackByKey = {};
    productsFrom(fallback).forEach(function (product) {
      fallbackByKey[product.key] = product;
    });
    var seen = {};
    var merged = productsFrom(primary).map(function (product) {
      var fallbackProduct = fallbackByKey[product.key] || {};
      seen[product.key] = true;
      return Object.assign({}, fallbackProduct, product, {
        preview: product.preview || product.front_mockup || fallbackProduct.preview || fallbackProduct.front_mockup,
        front_mockup: product.front_mockup || fallbackProduct.front_mockup,
        back_mockup: product.back_mockup || fallbackProduct.back_mockup,
        back_print_preview: product.back_print_preview || fallbackProduct.back_print_preview || ""
      });
    });
    productsFrom(fallback).forEach(function (product) {
      if (!seen[product.key]) merged.push(product);
    });
    return merged;
  }

  function renderCatalog() {
    var grid = $("merch-product-grid");
    if (!grid) return;
    var products = state.products.slice().sort(sortProduct);
    text("merch-catalog-status", products.length ? products.length + " items" : "Loading");
    if (!products.length) {
      grid.innerHTML = "<article class=\"merch-cart-empty\">Loading shop</article>";
      return;
    }
    var groups = {};
    products.forEach(function (product) {
      var key = groupKey(product);
      if (!groups[key]) groups[key] = [];
      groups[key].push(product);
    });
    grid.innerHTML = Object.keys(groups).sort(function (a, b) {
      return groupSort(a) - groupSort(b) || a.localeCompare(b);
    }).map(function (key) {
      return "<section class=\"merch-product-group\"><h3>" + html(groupTitle(key)) + "</h3><div class=\"merch-product-row\">"
        + groups[key].map(merchCard).join("")
        + "</div></section>";
    }).join("");
  }

  function loadCatalogOnce() {
    if (state.catalogLoaded) return;
    state.catalogLoaded = true;
    var useLiveCatalog = catalogEndpoint && /^https:\/\/(www\.)?smartsleeve\.ai$/i.test(window.location.origin);
    var live = useLiveCatalog ? fetch(catalogEndpoint, {cache: "no-store"}).then(function (response) {
      if (!response.ok) throw new Error("Catalog HTTP " + response.status);
      return response.json();
    }) : Promise.reject(new Error("No live catalog configured."));
    var fallback = fetch("/merch/printful-storefront-catalog.json", {cache: "no-store"}).then(function (response) {
      if (!response.ok) throw new Error("Fallback catalog HTTP " + response.status);
      return response.json();
    });
    Promise.allSettled([live, fallback]).then(function (results) {
      var livePayload = results[0].status === "fulfilled" ? results[0].value : null;
      var fallbackPayload = results[1].status === "fulfilled" ? results[1].value : null;
      state.products = livePayload ? mergeProducts(livePayload, fallbackPayload) : productsFrom(fallbackPayload);
      renderCatalog();
      renderCart();
    }).catch(function () {
      text("merch-catalog-status", "Unavailable");
      var grid = $("merch-product-grid");
      if (grid) grid.innerHTML = "<article class=\"merch-cart-empty\">Shop unavailable</article>";
    });
  }

  function readCheckoutForm() {
    state.customerEmail = normalizeEmail(($("merch-customer-email") || {}).value || "");
    var checked = document.querySelector("input[name=\"merch-checkout-mode\"]:checked");
    state.checkoutMode = checked ? checked.value : "guest";
    state.account = {
      username: String(($("merch-account-username") || {}).value || "").trim(),
      firstName: String(($("merch-account-first-name") || {}).value || "").trim(),
      lastName: String(($("merch-account-last-name") || {}).value || "").trim(),
      password: String(($("merch-account-password") || {}).value || ""),
      passwordConfirm: String(($("merch-account-password-confirm") || {}).value || ""),
      acceptedTerms: Boolean(($("merch-account-terms") || {}).checked)
    };
  }

  function validation() {
    var count = state.cart.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    if (!count) return {ok: false, message: "Your cart is empty."};
    if (!checkoutEndpoint) return {ok: false, message: "Checkout is not configured yet."};
    if (!validEmail(state.customerEmail)) return {ok: false, message: "Enter a valid email to receive your receipt."};
    if (state.checkoutMode !== "create_account") return {ok: true, message: "Shipping is free. Taxes are calculated by Stripe if applicable."};
    if (!registerEndpoint) return {ok: false, message: "Account creation is not available; use guest checkout."};
    if (!state.account.username) return {ok: false, message: "Choose a username or use guest checkout."};
    if (!state.account.firstName || !state.account.lastName) return {ok: false, message: "Enter first and last name for the SmartSleeve user."};
    if (state.account.password.length < 12) return {ok: false, message: "Use a password of at least 12 characters."};
    if (state.account.password !== state.account.passwordConfirm) return {ok: false, message: "Password confirmation does not match."};
    if (!state.account.acceptedTerms) return {ok: false, message: "Confirm the SmartSleeve user account scope."};
    return {ok: true, message: "Account setup starts before Stripe checkout. Shipping is free."};
  }

  function updateCheckoutUi() {
    readCheckoutForm();
    var fields = $("merch-account-fields");
    if (fields) fields.hidden = state.checkoutMode !== "create_account";
    var next = validation();
    var button = $("merch-checkout-button");
    if (button) button.disabled = !next.ok;
    text("merch-cart-note", next.message);
    return next;
  }

  function renderCart() {
    var list = $("merch-cart-items");
    if (!list) return;
    var count = state.cart.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    var subtotal = state.cart.reduce(function (sum, item) { return sum + merchPrice(item.product, item.size) * item.quantity; }, 0);
    text("merch-cart-count", count ? count + " item" + (count === 1 ? "" : "s") : "Empty");
    text("merch-cart-subtotal", money(subtotal));
    if (!state.cart.length) {
      list.innerHTML = "<article class=\"merch-cart-empty\">Your cart is empty</article>";
      updateCheckoutUi();
      return;
    }
    list.innerHTML = state.cart.map(function (item) {
      return "<article class=\"merch-cart-item\" data-merch-cart-item=\"" + html(merchCartKey(item.product.key, item.size)) + "\">"
        + "<img src=\"" + html(merchImageSrc(merchFrontImage(item.product))) + "\" alt=\"\" loading=\"lazy\">"
        + "<div><b>" + html(merchCleanName(item.product.name)) + "</b><span>Size " + html(item.size) + " &middot; " + money(merchPrice(item.product, item.size)) + "</span></div>"
        + "<label>Qty <input type=\"number\" min=\"1\" max=\"9\" value=\"" + item.quantity + "\" data-merch-quantity=\"" + html(merchCartKey(item.product.key, item.size)) + "\"></label>"
        + "<button type=\"button\" class=\"text-button subtle\" data-merch-remove=\"" + html(merchCartKey(item.product.key, item.size)) + "\">Remove</button>"
        + "</article>";
    }).join("");
    updateCheckoutUi();
  }

  function addToCart(productKey) {
    var product = state.products.find(function (item) { return item.key === productKey; });
    if (!product) return;
    var select = document.querySelector("[data-merch-size=\"" + cssEscape(productKey) + "\"]");
    var size = select && select.value ? select.value : merchDefaultSize(product);
    var key = merchCartKey(product.key, size);
    var item = state.cart.find(function (cartItem) { return merchCartKey(cartItem.product.key, cartItem.size) === key; });
    if (item) {
      item.quantity = Math.min(9, item.quantity + 1);
    } else {
      state.cart.push({product: product, size: size, quantity: 1});
    }
    renderCart();
  }

  function removeFromCart(key) {
    state.cart = state.cart.filter(function (item) {
      return merchCartKey(item.product.key, item.size) !== key;
    });
    renderCart();
  }

  function updateQuantity(key, quantity) {
    var item = state.cart.find(function (cartItem) { return merchCartKey(cartItem.product.key, cartItem.size) === key; });
    if (!item) return;
    item.quantity = Math.max(1, Math.min(9, Number(quantity) || 1));
    renderCart();
  }

  function createAccountIfRequested() {
    if (state.checkoutMode !== "create_account") return Promise.resolve();
    return fetch(registerEndpoint, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({
        username: state.account.username,
        email: state.customerEmail,
        first_name: state.account.firstName,
        last_name: state.account.lastName,
        password: state.account.password,
        password_confirm: state.account.passwordConfirm,
        accepted_terms: state.account.acceptedTerms
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.ok) {
          var detail = payload.errors && payload.errors.length ? payload.errors.join(", ") : (payload.error || "registration_failed");
          if (detail === "account_already_verified") return;
          throw new Error(detail);
        }
      });
    });
  }

  function startCheckout() {
    readCheckoutForm();
    var next = validation();
    if (!next.ok) {
      text("merch-cart-note", next.message);
      return;
    }
    var button = $("merch-checkout-button");
    if (button) {
      button.disabled = true;
      button.textContent = state.checkoutMode === "create_account" ? "Creating account..." : "Opening checkout...";
    }
    text("merch-cart-note", state.checkoutMode === "create_account" ? "Creating SmartSleeve user, then opening checkout..." : "Opening checkout...");
    createAccountIfRequested().then(function () {
      if (button) button.textContent = "Opening checkout...";
      return fetch(checkoutEndpoint, {
        method: "POST",
        mode: "cors",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          customer_email: state.customerEmail,
          checkout_mode: state.checkoutMode,
          account_username: state.checkoutMode === "create_account" ? state.account.username : "",
          items: state.cart.map(function (item) {
            return {product_key: item.product.key, size: item.size, quantity: item.quantity};
          })
        })
      });
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.checkout_url) throw new Error(payload.error || "Checkout session was not created.");
        window.location.href = payload.checkout_url;
      });
    }).catch(function (error) {
      if (button) {
        button.disabled = false;
        button.textContent = "Checkout";
      }
      text("merch-cart-note", "Checkout unavailable: " + error.message);
    });
  }

  function wireShop() {
    document.addEventListener("click", function (event) {
      var nav = event.target.closest("[data-nav=\"shop\"], a[href=\"#shop\"], a[href=\"#store\"]");
      if (nav) {
        event.preventDefault();
        event.stopImmediatePropagation();
        history.replaceState(null, "", "#shop");
        showShop();
        return;
      }
      var add = event.target.closest("[data-merch-add]");
      if (add) {
        addToCart(add.getAttribute("data-merch-add"));
        return;
      }
      var remove = event.target.closest("[data-merch-remove]");
      if (remove) {
        removeFromCart(remove.getAttribute("data-merch-remove"));
      }
    }, true);
    document.addEventListener("change", function (event) {
      if (event.target && event.target.matches("[data-merch-quantity]")) {
        updateQuantity(event.target.getAttribute("data-merch-quantity"), event.target.value);
      }
    });
    var form = $("merch-checkout-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        startCheckout();
      });
      form.addEventListener("input", updateCheckoutUi);
      form.addEventListener("change", updateCheckoutUi);
    }
    var checkout = $("merch-checkout-button");
    if (checkout) checkout.addEventListener("click", startCheckout);
    window.addEventListener("hashchange", function () {
      if (isShopRoute()) showShop();
    });
    if (window.MutationObserver) {
      new MutationObserver(function () {
        if (isShopRoute()) {
          var gate = $("auth-gate");
          if (gate) gate.remove();
        }
      }).observe(document.body, {childList: true});
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireShop();
    renderCart();
    if (isShopRoute()) {
      window.setTimeout(showShop, 0);
    } else {
      loadCatalogOnce();
    }
  });
})();
