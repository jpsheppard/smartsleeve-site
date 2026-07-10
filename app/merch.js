(function () {
  "use strict";

  var checkoutEndpoint = meta("smartsleeve-merch-checkout-endpoint");
  var catalogEndpoint = meta("smartsleeve-merch-catalog-endpoint");
  var authEndpoint = meta("smartsleeve-auth-endpoint");
  var registerEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/register" : "";
  var merchImageVersion = "20260710-approved-ss-reference-v2";
  var staticCatalogEndpoint = "/merch/printful-storefront-catalog.json";
  var state = {
    products: [],
    cart: [],
    catalogLoaded: false,
    checkoutMode: "guest",
    customerEmail: "",
    authProfile: null,
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

  function displayName(profile) {
    profile = profile || {};
    return profile.display_name
      || [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim()
      || profile.username
      || profile.email
      || "";
  }

  function shippingAddress(profile) {
    var address = profile && profile.shipping_address ? profile.shipping_address : null;
    return address && address.line1 && address.city && address.state && address.postal_code ? address : null;
  }

  function currentAuthProfile() {
    return state.authProfile || (window.SmartSleeveAuth && window.SmartSleeveAuth.state && window.SmartSleeveAuth.state.profile) || null;
  }

  function syncAuthProfile(profile) {
    state.authProfile = profile || currentAuthProfile();
    var signedInRadio = document.querySelector("input[name=\"merch-checkout-mode\"][value=\"signed_in\"]");
    var guestRadio = document.querySelector("input[name=\"merch-checkout-mode\"][value=\"guest\"]");
    if (state.authProfile && signedInRadio && guestRadio && guestRadio.checked && !state.customerEmail) {
      signedInRadio.checked = true;
    }
    updateCheckoutUi();
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
    return merchBrand(product) === "sqts" ? "SQTS" : "SS";
  }

  function isMousepadProduct(product) {
    return /mouse\s*pad|mousepad/i.test(product.name || product.key || "");
  }

  function isSockProduct(product) {
    return /sock/i.test(product.name || product.key || "");
  }

  function isOuterwearProduct(product) {
    return /windbreaker|fleece|jacket/i.test(product.name || product.key || "");
  }

  function isBandanaProduct(product) {
    return /bandana/i.test(product.name || product.key || "");
  }

  function isNeckGaiterProduct(product) {
    return /neck\s*gaiter/i.test(product.name || product.key || "");
  }

  function isTowelProduct(product) {
    return /(beach|gym|rally)\s*towel/i.test(product.name || product.key || "");
  }

  function isSingleSurfaceProduct(product) {
    return isMousepadProduct(product) || isSockProduct(product) || isBandanaProduct(product) || isNeckGaiterProduct(product) || isTowelProduct(product);
  }

  function merchGender(product) {
    if (isMousepadProduct(product) || isOuterwearProduct(product) || isSingleSurfaceProduct(product)) return "All";
    return String(product.name || product.key || "").toLowerCase().indexOf("women") !== -1 ? "Women" : "Men";
  }

  function merchBackType(product) {
    if (isMousepadProduct(product)) return "Full-surface print";
    if (isBandanaProduct(product) || isNeckGaiterProduct(product)) return "All-over print";
    if (isTowelProduct(product)) return "Full-surface print";
    if (isSockProduct(product)) return "Outside logo";
    if (isOuterwearProduct(product)) return "Right chest logo";
    if (/polo/i.test(product.name || product.key || "")) return "Left chest logo";
    var value = String(product.name || product.key || "").toLowerCase();
    if (value.indexOf("website+qr") !== -1 || value.indexOf("website-qr") !== -1) return "Website + QR";
    if (value.indexOf("website") !== -1) return "Website";
    return "Black";
  }

  function merchCut(product) {
    var value = String(product.name || product.key || "").toLowerCase();
    if (isMousepadProduct(product)) return "Mouse Pad";
    if (isBandanaProduct(product)) return "Bandana";
    if (isNeckGaiterProduct(product)) return "Neck Gaiter";
    if (value.indexOf("beach towel") !== -1) return "Beach Towel";
    if (value.indexOf("gym towel") !== -1) return "Gym Towel";
    if (value.indexOf("rally towel") !== -1) return "Rally Towel";
    if (isSockProduct(product)) return "Socks";
    if (value.indexOf("windbreaker") !== -1) return "Windbreaker";
    if (value.indexOf("fleece") !== -1 || value.indexOf("jacket") !== -1) return "Fleece Jacket";
    if (value.indexOf("polo") !== -1) return "Polo";
    if (value.indexOf("muscle") !== -1) return "Muscle Tee";
    if (value.indexOf("tank") !== -1) return "Tank Top";
    return "T-Shirt";
  }

  function merchPreviewFor(product) {
    if (isMousepadProduct(product)) {
      var mousepadBrand = merchBrand(product) === "sqts" ? "sqts-llc" : "smartsleeve-ss";
      return "/merch/" + mousepadBrand + "-mousepad-preview.png";
    }
    if (isOuterwearProduct(product)) {
      var outerwearBrand = merchBrand(product) === "sqts" ? "sqts-llc" : "smartsleeve-ss";
      var outerwearType = merchCut(product) === "Windbreaker" ? "windbreaker" : "fleece";
      return "/merch/" + outerwearBrand + "-" + outerwearType + "-preview.png";
    }
    if (isSockProduct(product) && product && product.preview) return product.preview;
    if (product && product.preview) return product.preview;
    var brand = merchBrand(product) === "sqts" ? "sqts-llc" : "smartsleeve-ss";
    var cut = merchCut(product) === "Tank Top" || merchCut(product) === "Muscle Tee" ? "tank" : "tee";
    var back = merchBackType(product) === "Website + QR" ? "promo" : merchBackType(product) === "Website" ? "website" : "brand";
    return "/merch/" + brand + "-" + cut + "-" + back + "-preview.png";
  }

  function merchFrontImage(product) {
    return product.front_mockup || product.preview || product.front_print_preview || merchPreviewFor(product);
  }

  function merchFrontDetailImage(product) {
    var cut = merchCut(product);
    var brand = merchBrand(product);
    if (cut === "Polo") {
      return brand === "sqts" ? "/merch/insets/sqts-polo-detail.png" : "/merch/insets/smartsleeve-ss-polo-detail.png";
    }
    if (cut === "T-Shirt" || cut === "Muscle Tee" || cut === "Tank Top") {
      return brand === "sqts" ? "/merch/insets/sqts-shirt-detail.png" : "/merch/insets/smartsleeve-ss-shirt-detail.png";
    }
    return "";
  }

  function merchBackImage(product) {
    return product.back_mockup || product.back_print_preview || "";
  }

  function merchHasBackPanel(product) {
    if (isSingleSurfaceProduct(product)) return false;
    if (isOuterwearProduct(product)) return false;
    return Boolean(merchBackImage(product));
  }

  function merchImageSrc(value) {
    var url = String(value || "");
    if (url.indexOf("/merch/") !== 0) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + merchImageVersion;
  }

  function merchDefaultSize(product) {
    var sizes = product && product.sizes ? product.sizes : [];
    if (sizes.indexOf("OS") !== -1) return "OS";
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

  function merchSizeLabel(size) {
    var normalized = String(size || "").toUpperCase();
    if (normalized === "OS") return "One Size";
    if (normalized === "SM") return "S/M";
    if (normalized === "LXL") return "L/XL";
    if (normalized === "16X24") return "16 x 24";
    if (normalized === "28X16") return "28 x 16";
    if (normalized === "30X60") return "30 x 60";
    if (normalized === "36X72") return "36 x 72";
    return String(size || "");
  }

  function merchOptionText(size) {
    return String(size || "").toUpperCase() === "OS" ? "One Size" : "Size " + merchSizeLabel(size);
  }

  function merchCleanName(name) {
    var clean = String(name || "SmartSleeve merch").trim();
    clean = clean.replace(/^SmartSleeve\s+SS\s*[- ]\s*/i, "SS ");
    clean = clean.replace(/^SS\s*[- ]\s*/i, "SS ");
    clean = clean.replace(/^SmartSleeve\s+SQTS\b/i, "SQTS");
    clean = clean.replace(/\s+-\s+/g, " - ");
    clean = clean.replace(/\bWebsite\s*\+\s*QR\b/ig, "Website + QR");
    clean = clean.replace(/\bWebsite\s+QR\b/ig, "Website + QR");
    clean = clean.replace(/\bBlank Back\b/ig, "Plain Back");
    clean = clean.replace(/\s{2,}/g, " ").trim();
    return clean;
  }

  function merchDisplayName(product) {
    var label = merchFrontLabel(product);
    var cut = merchCut(product);
    if (isOuterwearProduct(product)) {
      return cut + " - " + label;
    }
    return merchCleanName(product && product.name);
  }

  function sortValue(value, order) {
    var index = order.indexOf(value);
    return index === -1 ? order.length : index;
  }

  function umbrellaKey(product) {
    if (isTowelProduct(product)) return "Towels";
    return isMousepadProduct(product) ? "Office" : "Apparel";
  }

  function sortProduct(a, b) {
    return sortValue(umbrellaKey(a), ["Apparel", "Towels", "Office"]) - sortValue(umbrellaKey(b), ["Apparel", "Towels", "Office"])
      || sortValue(merchGender(a), ["Men", "Women", "All"]) - sortValue(merchGender(b), ["Men", "Women", "All"])
      || sortValue(merchCut(a), ["T-Shirt", "Polo", "Tank Top", "Muscle Tee", "Fleece Jacket", "Windbreaker", "Socks", "Bandana", "Neck Gaiter", "Beach Towel", "Gym Towel", "Rally Towel", "Mouse Pad"]) - sortValue(merchCut(b), ["T-Shirt", "Polo", "Tank Top", "Muscle Tee", "Fleece Jacket", "Windbreaker", "Socks", "Bandana", "Neck Gaiter", "Beach Towel", "Gym Towel", "Rally Towel", "Mouse Pad"])
      || sortValue(merchFrontLabel(a), ["SS", "SQTS"]) - sortValue(merchFrontLabel(b), ["SS", "SQTS"])
      || sortValue(merchBackType(a), ["Black", "Website", "Website + QR", "Left chest logo", "Right chest logo", "Outside logo", "Full-surface print"]) - sortValue(merchBackType(b), ["Black", "Website", "Website + QR", "Left chest logo", "Right chest logo", "Outside logo", "Full-surface print"])
      || merchDisplayName(a).localeCompare(merchDisplayName(b));
  }

  function groupKey(product) {
    if (isMousepadProduct(product)) return "Office::Mouse Pad";
    if (isBandanaProduct(product)) return "Apparel::Bandana";
    if (isNeckGaiterProduct(product)) return "Apparel::Neck Gaiter";
    if (merchCut(product) === "Beach Towel") return "Towels::Beach Towel";
    if (merchCut(product) === "Gym Towel") return "Towels::Gym Towel";
    if (merchCut(product) === "Rally Towel") return "Towels::Rally Towel";
    if (isSockProduct(product)) return "Apparel::Socks";
    if (isOuterwearProduct(product)) return "Apparel::Outerwear";
    if (merchCut(product) === "Muscle Tee") return "Apparel::Muscle Tee";
    return "Apparel::" + merchGender(product) + " " + merchCut(product);
  }

  function groupTitle(key) {
    var parts = String(key || "").split("::");
    var cut = parts[1] || "Apparel";
    if (cut === "Mouse Pad") return "Mouse Pads";
    if (cut === "Outerwear") return "Outerwear";
    if (cut === "Muscle Tee") return "Muscle Tees";
    if (cut === "Socks") return "Socks";
    if (cut === "Bandana") return "Bandanas";
    if (cut === "Neck Gaiter") return "Neck Gaiters";
    if (cut === "Beach Towel") return "Beach Towels";
    if (cut === "Gym Towel") return "Gym Towels";
    if (cut === "Rally Towel") return "Rally Towels";
    if (cut === "Women Tank Top") return "Women's Racerback Tanks";
    if (cut === "Women Polo") return "Women's Polos";
    if (cut === "Men T-Shirt") return "Men's T-Shirts";
    if (cut === "Men Polo") return "Men's Polos";
    if (cut === "Men Tank Top") return "Men's Tank Tops";
    if (cut === "Women T-Shirt") return "Women's T-Shirts";
    return cut;
  }

  function groupSort(key) {
    var order = {
      "Apparel::Men T-Shirt": 0,
      "Apparel::Men Polo": 1,
      "Apparel::Men Tank Top": 2,
      "Apparel::Muscle Tee": 3,
      "Apparel::Women T-Shirt": 4,
      "Apparel::Women Polo": 5,
      "Apparel::Women Tank Top": 6,
      "Apparel::Outerwear": 7,
      "Apparel::Socks": 8,
      "Apparel::Bandana": 9,
      "Apparel::Neck Gaiter": 10,
      "Towels::Beach Towel": 0,
      "Towels::Gym Towel": 1,
      "Towels::Rally Towel": 2,
      "Office::Mouse Pad": 0
    };
    return order[key] == null ? 99 : order[key];
  }

  function umbrellaSort(key) {
    return sortValue(key, ["Apparel", "Towels", "Office"]);
  }

  function sortProductsInGroup(key, products) {
    var apparelOrder = ["T-Shirt", "Polo", "Tank Top", "Muscle Tee", "Fleece Jacket", "Windbreaker", "Socks", "Bandana", "Neck Gaiter"];
    var towelOrder = ["Beach Towel", "Gym Towel", "Rally Towel"];
    var officeOrder = ["Mouse Pad"];
    return products.slice().sort(function (a, b) {
      var aOrder = umbrellaKey(a) === "Office" ? officeOrder : umbrellaKey(a) === "Towels" ? towelOrder : apparelOrder;
      var bOrder = umbrellaKey(b) === "Office" ? officeOrder : umbrellaKey(b) === "Towels" ? towelOrder : apparelOrder;
      return sortValue(merchCut(a), aOrder) - sortValue(merchCut(b), bOrder)
        || sortValue(merchFrontLabel(a), ["SS", "SQTS"]) - sortValue(merchFrontLabel(b), ["SS", "SQTS"])
        || sortValue(merchBackType(a), ["Black", "Website", "Website + QR", "Right chest logo", "Full-surface print"]) - sortValue(merchBackType(b), ["Black", "Website", "Website + QR", "Right chest logo", "Full-surface print"])
        || merchDisplayName(a).localeCompare(merchDisplayName(b));
    });
  }

  function merchCard(product) {
    var size = merchDefaultSize(product);
    var mousepad = isMousepadProduct(product);
    var backImage = merchHasBackPanel(product) ? merchBackImage(product) : "";
    var singleView = !backImage;
    var options = (product.sizes || []).map(function (item) {
      return "<option value=\"" + html(item) + "\"" + (item === size ? " selected" : "") + ">" + html(merchSizeLabel(item)) + "</option>";
    }).join("");
    var frontCaption = isSingleSurfaceProduct(product) ? "Design" : "Front";
    var frontDetail = merchFrontDetailImage(product);
    var chips = singleView
      ? ["Design: " + merchFrontLabel(product), merchBackType(product)]
      : isOuterwearProduct(product)
        ? ["Front: Right chest logo", "Back: Plain back"]
        : ["Front: " + merchFrontLabel(product), "Back: " + merchBackType(product)];
    return "<article class=\"merch-product-card\" data-merch-product-card=\"" + html(product.key) + "\">"
      + "<div class=\"merch-product-images" + (backImage ? "" : " single-view") + (frontDetail ? " with-front-detail" : "") + "\">"
      + "<figure class=\"merch-front-figure\"><img class=\"merch-main-mockup\" src=\"" + html(merchImageSrc(merchFrontImage(product))) + "\" alt=\"" + html(merchDisplayName(product)) + "\" loading=\"lazy\">"
      + (frontDetail ? "<span class=\"merch-front-inset\" role=\"img\" aria-label=\"" + html(merchFrontLabel(product)) + " print detail\"><img src=\"" + html(merchImageSrc(frontDetail)) + "\" alt=\"\" loading=\"lazy\"></span>" : "")
      + "<figcaption>" + html(frontCaption) + "</figcaption></figure>"
      + (backImage ? "<figure><img class=\"merch-main-mockup\" src=\"" + html(merchImageSrc(backImage)) + "\" alt=\"" + html(merchDisplayName(product)) + " back\" loading=\"lazy\"><figcaption>Back</figcaption></figure>" : "")
      + "</div>"
      + "<div class=\"merch-product-copy\">"
      + "<h4>" + html(merchDisplayName(product)) + "</h4>"
      + "<div class=\"merch-chip-row\">" + chips.map(function (chip) { return "<span>" + html(chip) + "</span>"; }).join("") + "</div>"
      + "<div class=\"merch-buy-row\">"
      + "<strong>" + html(product.price_label || money(merchPrice(product, size))) + "</strong>"
      + "<label>" + html(mousepad ? "Option" : "Size") + " <select data-merch-size=\"" + html(product.key) + "\">" + options + "</select></label>"
      + "<button type=\"button\" class=\"primary\" data-merch-add=\"" + html(product.key) + "\">Add to cart</button>"
      + "</div></div></article>";
  }

  function productsFrom(payload) {
    return ((payload && payload.products) || []).filter(function (product) {
      return product && product.key && product.name && product.sizes && product.sizes.length && !isNeckGaiterProduct(product);
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
    var groupKeys = Object.keys(groups).sort(function (a, b) {
      return groupSort(a) - groupSort(b) || a.localeCompare(b);
    });
    var umbrellas = {};
    groupKeys.forEach(function (key) {
      var umbrella = key.split("::")[0] || "Apparel";
      if (!umbrellas[umbrella]) umbrellas[umbrella] = [];
      umbrellas[umbrella].push(key);
    });
    grid.innerHTML = Object.keys(umbrellas).sort(function (a, b) {
      return umbrellaSort(a) - umbrellaSort(b) || a.localeCompare(b);
    }).map(function (umbrella) {
      return "<section class=\"merch-umbrella-group\"><h3>" + html(umbrella) + "</h3>"
        + umbrellas[umbrella].map(function (key) {
          return "<section class=\"merch-product-group\"><h4>" + html(groupTitle(key)) + "</h4><div class=\"merch-product-row\">"
            + sortProductsInGroup(key, groups[key]).map(merchCard).join("")
            + "</div></section>";
        }).join("")
        + "</section>";
    }).join("");
  }

  function loadCatalogOnce() {
    if (state.catalogLoaded) return;
    state.catalogLoaded = true;
    var useLiveCatalog = catalogEndpoint
      && catalogEndpoint !== staticCatalogEndpoint
      && /^https:\/\/(www\.)?smartsleeve\.ai$/i.test(window.location.origin);
    var live = useLiveCatalog ? fetch(catalogEndpoint, {cache: "no-store"}).then(function (response) {
      if (!response.ok) throw new Error("Catalog HTTP " + response.status);
      return response.json();
    }) : Promise.reject(new Error("No live catalog configured."));
    var fallback = fetch(staticCatalogEndpoint, {cache: "no-store"}).then(function (response) {
      if (!response.ok) throw new Error("Fallback catalog HTTP " + response.status);
      return response.json();
    });
    Promise.allSettled([live, fallback]).then(function (results) {
      var livePayload = results[0].status === "fulfilled" ? results[0].value : null;
      var fallbackPayload = results[1].status === "fulfilled" ? results[1].value : null;
      state.products = fallbackPayload ? productsFrom(fallbackPayload) : productsFrom(livePayload);
      renderCatalog();
      renderCart();
    }).catch(function () {
      text("merch-catalog-status", "Unavailable");
      var grid = $("merch-product-grid");
      if (grid) grid.innerHTML = "<article class=\"merch-cart-empty\">Shop unavailable</article>";
    });
  }

  function readCheckoutForm() {
    var checked = document.querySelector("input[name=\"merch-checkout-mode\"]:checked");
    state.checkoutMode = checked ? checked.value : "guest";
    var profile = currentAuthProfile();
    var emailInput = $("merch-customer-email");
    if (state.checkoutMode === "signed_in" && profile && profile.email && emailInput) {
      emailInput.value = profile.email;
    }
    state.customerEmail = normalizeEmail((emailInput || {}).value || "");
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
    if (state.checkoutMode === "signed_in") {
      var profile = currentAuthProfile();
      if (!profile || !profile.email) return {ok: false, message: "Sign in to use your SmartSleeve account at checkout."};
      if (!shippingAddress(profile)) return {ok: true, message: "Signed in. Stripe will collect shipping; save an address in Account to prefill it next time."};
      return {ok: true, message: "Signed in. Saved email and shipping profile will be sent securely to Stripe Checkout."};
    }
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
    var signedInFields = $("merch-signed-in-fields");
    var profile = currentAuthProfile();
    var emailInput = $("merch-customer-email");
    if (emailInput) {
      emailInput.readOnly = state.checkoutMode === "signed_in" && Boolean(profile && profile.email);
      if (state.checkoutMode === "signed_in" && profile && profile.email) {
        emailInput.value = profile.email;
      }
    }
    if (signedInFields) {
      signedInFields.hidden = state.checkoutMode !== "signed_in";
      text("merch-signed-in-title", profile ? "Signed in as " + displayName(profile) : "Use your SmartSleeve account");
      text(
        "merch-signed-in-detail",
        profile
          ? (shippingAddress(profile) ? "Saved shipping address is ready for Stripe Checkout." : "No saved shipping address yet. Add it in Account to reduce checkout typing.")
          : "Sign in to reuse your saved profile across SmartSleeve."
      );
    }
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
        + "<div><b>" + html(merchDisplayName(item.product)) + "</b><span>" + html(merchOptionText(item.size)) + " &middot; " + money(merchPrice(item.product, item.size)) + "</span></div>"
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
      var profile = currentAuthProfile() || {};
      if (button) button.textContent = "Opening checkout...";
      return fetch(checkoutEndpoint, {
        method: "POST",
        mode: "cors",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          customer_email: state.customerEmail,
          checkout_mode: state.checkoutMode,
          account_username: state.checkoutMode === "create_account" ? state.account.username : (profile.username || ""),
          smartsleeve_account_email: state.checkoutMode === "signed_in" ? (profile.email || "") : "",
          customer_name: state.checkoutMode === "signed_in" ? displayName(profile) : "",
          shipping_address: state.checkoutMode === "signed_in" ? shippingAddress(profile) : null,
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
    var signIn = $("merch-sign-in-button");
    if (signIn) {
      signIn.addEventListener("click", function () {
        if (window.SmartSleeveAuth && typeof window.SmartSleeveAuth.open === "function") {
          window.SmartSleeveAuth.open(currentAuthProfile() ? "profile" : "login");
        }
      });
    }
    window.addEventListener("smartsleeve-auth-change", function (event) {
      syncAuthProfile(event.detail && event.detail.profile);
    });
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
    syncAuthProfile();
    renderCart();
    if (isShopRoute()) {
      window.setTimeout(showShop, 0);
    } else {
      loadCatalogOnce();
    }
  });
})();
