(function () {
  "use strict";

  var MERCH_MERCHANT_OF_RECORD = "SmartSleeve Quantitative Trading Systems, LLC";
  var MERCH_PRODUCT_URLS = {
    "smartsleeve-ss-tee-brand": "",
    "smartsleeve-ss-tee": "",
    "smartsleeve-ss-tank-brand": "",
    "smartsleeve-ss-tank": "",
    "sqts-llc-tee-brand": "",
    "sqts-llc-tee": "",
    "sqts-llc-tank-brand": "",
    "sqts-llc-tank": "",
    "smartsleeve-ss-tee-promo": "",
    "smartsleeve-ss-tank-promo": "",
    "sqts-llc-tee-promo": "",
    "sqts-llc-tank-promo": ""
  };
  var MERCH_CATALOG = {};
  var MERCH_CART_STORAGE_KEY = "smartsleeve_merch_cart_v1";
  var MERCH_CART = [];

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function configuredMetaContent(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta && meta.content && meta.content.indexOf("__") !== 0 ? meta.content.trim() : "";
  }

  function showToast(message) {
    var toast = byId("prototype-toast");
    if (!toast) {
      return;
    }
    toast.textContent = message;
    toast.classList.add("toast-visible");
    window.setTimeout(function () {
      toast.classList.remove("toast-visible");
    }, 4200);
  }

  function merchCheckoutUrl(productKey) {
    return MERCH_PRODUCT_URLS[productKey] || "";
  }

  function startMerchantCheckout(itemsOrProductKey, fallbackUrl, size) {
    var endpoint = configuredMetaContent("smartsleeve-merch-checkout-endpoint");
    if (!endpoint || !window.fetch) {
      return Promise.resolve(false);
    }
    var payload = Array.isArray(itemsOrProductKey)
      ? {
          items: itemsOrProductKey.map(function (item) {
            return {
              product_key: item.product_key,
              quantity: item.quantity || 1,
              size: item.size || "M"
            };
          }),
          merchant_of_record: MERCH_MERCHANT_OF_RECORD,
          fallback_url: fallbackUrl || window.location.href
        }
      : {
          product_key: itemsOrProductKey,
          quantity: 1,
          size: size || "M",
          merchant_of_record: MERCH_MERCHANT_OF_RECORD,
          fallback_url: fallbackUrl || window.location.href
        };
    return window.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Checkout endpoint returned " + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.checkout_url) {
          throw new Error("Checkout endpoint did not return checkout_url");
        }
        window.open(payload.checkout_url, "_blank", "noopener,noreferrer");
        return true;
      });
  }

  function merchProduct(productKey) {
    return MERCH_CATALOG[productKey] || null;
  }

  function selectedMerchSize(button) {
    var root = button.closest("[data-merch-product-card]") || button.closest("article") || document;
    var select = root.querySelector("[data-merch-size]");
    return select && select.value ? select.value : "M";
  }

  function priceForSize(product, size) {
    if (!product || !product.prices) {
      return "";
    }
    return product.prices[size] || product.prices.M || "";
  }

  function centsFromPrice(price) {
    var value = Number(price || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return Math.round(value * 100);
  }

  function formatUsd(cents) {
    return "$" + (Math.max(0, cents || 0) / 100).toFixed(2);
  }

  function cartLineKey(productKey, size) {
    return String(productKey || "") + "|" + String(size || "M");
  }

  function clampCartQuantity(quantity) {
    var parsed = Math.floor(Number(quantity || 1));
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }
    return Math.min(parsed, 6);
  }

  function readCart() {
    try {
      var parsed = JSON.parse(localStorage.getItem(MERCH_CART_STORAGE_KEY) || "[]");
      MERCH_CART = Array.isArray(parsed)
        ? parsed
            .map(function (item) {
              return {
                product_key: String(item.product_key || ""),
                size: String(item.size || "M"),
                quantity: clampCartQuantity(item.quantity)
              };
            })
            .filter(function (item) {
              return item.product_key;
            })
        : [];
    } catch (_err) {
      MERCH_CART = [];
    }
  }

  function writeCart() {
    try {
      localStorage.setItem(MERCH_CART_STORAGE_KEY, JSON.stringify(MERCH_CART));
    } catch (_err) {
      // Cart persistence is a convenience; checkout still works without it.
    }
  }

  function selectedMerchQuantity(button) {
    var root = button.closest("[data-merch-product-card]") || button.closest("article") || document;
    var input = root.querySelector("[data-merch-quantity]");
    return clampCartQuantity(input && input.value ? input.value : 1);
  }

  function addMerchToCart(productKey, size, quantity) {
    var normalizedSize = size || "M";
    var key = cartLineKey(productKey, normalizedSize);
    var existing = MERCH_CART.find(function (item) {
      return cartLineKey(item.product_key, item.size) === key;
    });
    if (existing) {
      existing.quantity = clampCartQuantity(existing.quantity + quantity);
    } else {
      MERCH_CART.push({
        product_key: productKey,
        size: normalizedSize,
        quantity: clampCartQuantity(quantity)
      });
    }
    writeCart();
    renderCart();
  }

  function cartLineUnitCents(item) {
    var product = merchProduct(item.product_key);
    return centsFromPrice(priceForSize(product, item.size));
  }

  function cartSubtotalCents() {
    return MERCH_CART.reduce(function (total, item) {
      return total + cartLineUnitCents(item) * clampCartQuantity(item.quantity);
    }, 0);
  }

  function renderCart() {
    var itemsRoot = document.querySelector("[data-merch-cart-items]");
    var empty = document.querySelector("[data-merch-cart-empty]");
    var count = document.querySelector("[data-merch-cart-count]");
    var subtotal = document.querySelector("[data-merch-cart-subtotal]");
    var checkout = document.querySelector("[data-merch-cart-checkout]");
    var clear = document.querySelector("[data-merch-cart-clear]");
    if (!itemsRoot) {
      return;
    }
    itemsRoot.innerHTML = "";
    var totalQuantity = MERCH_CART.reduce(function (total, item) {
      return total + clampCartQuantity(item.quantity);
    }, 0);
    if (count) {
      count.textContent = totalQuantity === 1 ? "1 item" : totalQuantity + " items";
    }
    if (subtotal) {
      subtotal.textContent = formatUsd(cartSubtotalCents());
    }
    if (empty) {
      empty.hidden = MERCH_CART.length > 0;
    }
    if (checkout) {
      checkout.disabled = MERCH_CART.length === 0;
    }
    if (clear) {
      clear.disabled = MERCH_CART.length === 0;
    }
    MERCH_CART.forEach(function (item) {
      var product = merchProduct(item.product_key);
      var row = document.createElement("div");
      row.className = "merch-cart-row";
      row.setAttribute("data-cart-line", cartLineKey(item.product_key, item.size));

      var copy = document.createElement("div");
      var title = document.createElement("strong");
      title.textContent = product ? product.name : item.product_key;
      var meta = document.createElement("span");
      meta.textContent = item.size + " · Qty " + item.quantity + " · " + formatUsd(cartLineUnitCents(item) * item.quantity);
      copy.appendChild(title);
      copy.appendChild(meta);

      var controls = document.createElement("div");
      controls.className = "merch-cart-controls";
      [
        { label: "-", action: "decrement" },
        { label: "+", action: "increment" },
        { label: "Remove", action: "remove" }
      ].forEach(function (control) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = control.label;
        button.setAttribute("data-cart-action", control.action);
        button.setAttribute("data-cart-line-key", cartLineKey(item.product_key, item.size));
        controls.appendChild(button);
      });

      row.appendChild(copy);
      row.appendChild(controls);
      itemsRoot.appendChild(row);
    });
  }

  function merchText(product) {
    return String((product && (product.name || product.printful_name)) || "").toLowerCase();
  }

  function merchLogoMeta(product) {
    var text = merchText(product);
    if (text.indexOf("sqts") >= 0) {
      return { rank: 1, label: "SQTS" };
    }
    return { rank: 0, label: "SS" };
  }

  function merchBackMeta(product) {
    var text = merchText(product);
    if (text.indexOf("website+qr") >= 0 || text.indexOf("website qr") >= 0 || text.indexOf("qr back") >= 0) {
      return { rank: 2, label: "Website + QR back" };
    }
    if (text.indexOf("website back") >= 0) {
      return { rank: 1, label: "Website back" };
    }
    if (text.indexOf("plain back") >= 0 || text.indexOf("blank back") >= 0) {
      return { rank: 0, label: "Plain back" };
    }
    return { rank: 3, label: "Other back" };
  }

  function merchGenderMeta(product) {
    var text = merchText(product);
    if (text.indexOf("women") >= 0) {
      return { rank: 1, label: "Women's" };
    }
    if (text.indexOf("men") >= 0 || text.indexOf("muscle tee") >= 0) {
      return { rank: 0, label: "Men's" };
    }
    if (text.indexOf("unisex") >= 0) {
      return { rank: 2, label: "Unisex" };
    }
    return { rank: 3, label: "Apparel" };
  }

  function merchApparelMeta(product) {
    var text = merchText(product);
    if (text.indexOf("muscle tee") >= 0 || text.indexOf("muscle shirt") >= 0) {
      return { rank: 1, label: "Muscle Tee" };
    }
    if (text.indexOf("tank") >= 0) {
      return { rank: 2, label: "Tank top" };
    }
    if (text.indexOf("tee") >= 0 || text.indexOf("t-shirt") >= 0 || text.indexOf("shirt") >= 0) {
      return { rank: 0, label: "T-shirt" };
    }
    return { rank: 9, label: "Item" };
  }

  function merchSortKey(product) {
    var logo = merchLogoMeta(product);
    var back = merchBackMeta(product);
    var gender = merchGenderMeta(product);
    var apparel = merchApparelMeta(product);
    return [
      gender.rank,
      apparel.rank,
      logo.rank,
      back.rank,
      merchText(product),
      Number(product && product.printful_product_id) || 0
    ];
  }

  function compareMerchProducts(a, b) {
    var left = merchSortKey(a);
    var right = merchSortKey(b);
    for (var index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) {
        return -1;
      }
      if (left[index] > right[index]) {
        return 1;
      }
    }
    return 0;
  }

  function merchKicker(product) {
    var logo = merchLogoMeta(product);
    var back = merchBackMeta(product);
    var gender = merchGenderMeta(product);
    var apparel = merchApparelMeta(product);
    return logo.label + " · " + back.label + " · " + gender.label + " " + apparel.label.toLowerCase();
  }

  function merchDescription(product) {
    var back = merchBackMeta(product);
    if (back.rank === 0) {
      return "Front-only brand merch with a clean blank back. Price, sizes, and checkout mapping come from the synced Printful product.";
    }
    if (back.rank === 1) {
      return "Website-promo merch with the SmartSleeve front design and a centered smartsleeve.ai back. Price and sizes come from Printful.";
    }
    if (back.rank === 2) {
      return "Founder promo merch with the SmartSleeve front design plus smartsleeve.ai and a subtle QR code on the back.";
    }
    return "Published Printful product synced into SmartSleeve checkout. Price and size options come from Printful.";
  }

  function merchGenderSectionMeta(product) {
    var gender = merchGenderMeta(product);
    if (gender.rank === 0) {
      return { rank: 0, key: "mens", label: "Men's Apparel" };
    }
    if (gender.rank === 1) {
      return { rank: 1, key: "womens", label: "Women's Apparel" };
    }
    if (gender.rank === 2) {
      return { rank: 2, key: "unisex", label: "Unisex Apparel" };
    }
    return { rank: 3, key: "other", label: "Other Apparel" };
  }

  function merchApparelSectionMeta(product) {
    var apparel = merchApparelMeta(product);
    if (apparel.rank === 0) {
      return { rank: 0, key: "tshirts", label: "T-shirts" };
    }
    if (apparel.rank === 1) {
      return { rank: 1, key: "muscle-tees", label: "Muscle Tees" };
    }
    if (apparel.rank === 2) {
      return { rank: 2, key: "tank-tops", label: "Tank Tops" };
    }
    return { rank: 9, key: "other-items", label: "Other items" };
  }

  function createMerchGenderHeading(product) {
    var gender = merchGenderSectionMeta(product);
    var heading = document.createElement("div");
    heading.className = "merch-section-heading";
    var kicker = document.createElement("span");
    kicker.className = "plan-kicker";
    kicker.textContent = "SmartSleeve merch";
    var title = document.createElement("h3");
    title.textContent = gender.label;
    var copy = document.createElement("p");
    copy.textContent = "Browse by apparel type, then logo style and back design.";
    heading.appendChild(kicker);
    heading.appendChild(title);
    heading.appendChild(copy);
    return heading;
  }

  function createMerchApparelHeading(product) {
    var apparel = merchApparelSectionMeta(product);
    var heading = document.createElement("div");
    heading.className = "merch-subsection-heading";
    var title = document.createElement("h4");
    title.textContent = apparel.label;
    heading.appendChild(title);
    return heading;
  }

  function createMerchCard(product) {
    var article = document.createElement("article");
    article.className = "merch-card featured";
    article.setAttribute("data-merch-product-card", product.key);

    var image = document.createElement("img");
    image.src = product.preview || "/smartsleeve-ss-banner.png";
    image.alt = "Preview of " + product.name;
    article.appendChild(image);

    var copy = document.createElement("div");
    copy.className = "merch-copy";

    var kicker = document.createElement("span");
    kicker.className = "plan-kicker";
    kicker.textContent = merchKicker(product);
    copy.appendChild(kicker);

    var title = document.createElement("h3");
    title.textContent = product.name;
    copy.appendChild(title);

    var price = document.createElement("strong");
    var priceValue = document.createElement("span");
    priceValue.setAttribute("data-merch-price", "");
    priceValue.textContent = product.price_label || "$19.99";
    var shipping = document.createElement("span");
    shipping.textContent = " + shipping";
    price.appendChild(priceValue);
    price.appendChild(shipping);
    copy.appendChild(price);

    var description = document.createElement("p");
    description.textContent = merchDescription(product);
    copy.appendChild(description);

    var label = document.createElement("label");
    label.className = "merch-size-picker";
    label.textContent = "Size ";
    var select = document.createElement("select");
    select.setAttribute("data-merch-size", "");
    select.setAttribute("aria-label", product.name + " size");
    label.appendChild(select);
    copy.appendChild(label);

    var quantityLabel = document.createElement("label");
    quantityLabel.className = "merch-size-picker merch-quantity-picker";
    quantityLabel.textContent = "Qty ";
    var quantity = document.createElement("input");
    quantity.type = "number";
    quantity.min = "1";
    quantity.max = "6";
    quantity.step = "1";
    quantity.value = "1";
    quantity.setAttribute("data-merch-quantity", "");
    quantity.setAttribute("aria-label", product.name + " quantity");
    quantityLabel.appendChild(quantity);
    copy.appendChild(quantityLabel);

    var actions = document.createElement("div");
    actions.className = "action-row";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "button primary";
    button.setAttribute("data-merch-checkout", product.key);
    button.textContent = "Add to cart";
    actions.appendChild(button);
    copy.appendChild(actions);

    article.appendChild(copy);
    return article;
  }

  function renderPrintfulCatalog(catalog) {
    if (!catalog || !Array.isArray(catalog.products) || catalog.products.length === 0) {
      return;
    }
    var grid = document.querySelector("[data-printful-catalog-grid]");
    if (!grid) {
      return;
    }
    grid.innerHTML = "";
    var lastGenderKey = "";
    var lastApparelKey = "";
    catalog.products.slice().sort(compareMerchProducts).forEach(function (product) {
      if (product && product.key) {
        var gender = merchGenderSectionMeta(product);
        var apparel = merchApparelSectionMeta(product);
        if (gender.key !== lastGenderKey) {
          grid.appendChild(createMerchGenderHeading(product));
          lastGenderKey = gender.key;
          lastApparelKey = "";
        }
        if (apparel.key !== lastApparelKey) {
          grid.appendChild(createMerchApparelHeading(product));
          lastApparelKey = apparel.key;
        }
        grid.appendChild(createMerchCard(product));
      }
    });
    var compact = document.querySelector("[data-static-merch-extras]");
    if (compact) {
      compact.hidden = true;
    }
  }

  function updateCardPrice(root, productKey, size) {
    var product = merchProduct(productKey);
    all("[data-merch-checkout]", root).forEach(function (button) {
      var buttonProductKey = button.getAttribute("data-merch-checkout") || "";
      var buttonProduct = merchProduct(buttonProductKey);
      var buttonPrice = priceForSize(buttonProduct, size);
      if (!button.dataset.merchBaseLabel) {
        button.dataset.merchBaseLabel = button.textContent;
      }
      if (buttonPrice) {
        button.textContent = button.dataset.merchBaseLabel + " · $" + buttonPrice;
      }
    });
    if (!product) {
      return;
    }
    var priceNode = root.querySelector("[data-merch-price]");
    var selectedPrice = priceForSize(product, size);
    if (priceNode) {
      priceNode.textContent = selectedPrice ? "$" + selectedPrice : product.price_label || "$19.99";
    }
    var rangeNode = root.querySelector("[data-merch-price-range]");
    if (rangeNode) {
      rangeNode.textContent = product.price_label || "";
    }
  }

  function applyMerchCatalog(catalog) {
    if (!catalog || !Array.isArray(catalog.products)) {
      return;
    }
    catalog.products.forEach(function (product) {
      if (product && product.key) {
        MERCH_CATALOG[product.key] = product;
      }
    });
    renderPrintfulCatalog(catalog);
    all("[data-merch-product-card]").forEach(function (card) {
      var productKey = card.getAttribute("data-merch-product-card") || "";
      var product = merchProduct(productKey);
      if (!product) {
        return;
      }
      var select = card.querySelector("[data-merch-size]");
      var sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes : (catalog.sizes || ["S", "M", "L", "XL", "2XL"]);
      if (select && select.options.length === 0) {
        sizes.forEach(function (size) {
          var option = document.createElement("option");
          option.value = size;
          option.textContent = size;
          select.appendChild(option);
        });
        select.value = sizes.indexOf("M") >= 0 ? "M" : sizes[0];
      }
      updateCardPrice(card, productKey, select && select.value ? select.value : "M");
    });
    renderCart();
  }

  function fillFallbackSizes() {
    all("[data-merch-size]").forEach(function (select) {
      if (select.options.length > 0) {
        return;
      }
      ["S", "M", "L", "XL", "2XL"].forEach(function (size) {
        var option = document.createElement("option");
        option.value = size;
        option.textContent = size;
        select.appendChild(option);
      });
      select.value = "M";
    });
  }

  function loadMerchCatalog() {
    if (!window.fetch) {
      fillFallbackSizes();
      return Promise.resolve();
    }
    return fetch("/merch/printful-storefront-catalog.json", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("catalog unavailable");
        }
        return response.json();
      })
      .then(applyMerchCatalog)
      .catch(fillFallbackSizes);
  }

  function wireMerchStore() {
    all("[data-merch-size]").forEach(function (select) {
      select.addEventListener("change", function () {
        var root = select.closest("[data-merch-product-card]") || select.closest("article") || document;
        var productKey = root.getAttribute("data-merch-product-card") || "";
        updateCardPrice(root, productKey, select.value || "M");
      });
    });
    all("[data-merch-checkout]").forEach(function (button) {
      button.addEventListener("click", function () {
        var productKey = button.getAttribute("data-merch-checkout") || "";
        var size = selectedMerchSize(button);
        var quantity = selectedMerchQuantity(button);
        addMerchToCart(productKey, size, quantity);
        showToast("Added " + quantity + " item" + (quantity === 1 ? "" : "s") + " to your cart.");
      });
    });

    var cart = document.querySelector("[data-merch-cart]");
    if (cart) {
      cart.addEventListener("click", function (event) {
        var target = event.target;
        if (!target || !target.getAttribute) {
          return;
        }
        var action = target.getAttribute("data-cart-action");
        var lineKey = target.getAttribute("data-cart-line-key") || "";
        if (action) {
          MERCH_CART = MERCH_CART.reduce(function (items, item) {
            if (cartLineKey(item.product_key, item.size) !== lineKey) {
              items.push(item);
              return items;
            }
            if (action === "remove") {
              return items;
            }
            var nextQuantity = item.quantity + (action === "increment" ? 1 : -1);
            if (nextQuantity > 0) {
              items.push({
                product_key: item.product_key,
                size: item.size,
                quantity: clampCartQuantity(nextQuantity)
              });
            }
            return items;
          }, []);
          writeCart();
          renderCart();
        }
      });
    }

    var checkoutButton = document.querySelector("[data-merch-cart-checkout]");
    if (checkoutButton) {
      checkoutButton.addEventListener("click", function () {
        if (MERCH_CART.length === 0) {
          showToast("Add at least one SmartSleeve item before checkout.");
          return;
        }
        checkoutButton.disabled = true;
        checkoutButton.textContent = "Opening checkout...";
        startMerchantCheckout(MERCH_CART)
          .then(function (openedMerchantCheckout) {
            if (!openedMerchantCheckout) {
              showToast("SmartSleeve cart checkout is not configured yet.");
            }
          })
          .catch(function () {
            showToast("SmartSleeve cart checkout could not start. Check the Stripe Checkout endpoint and fulfillment webhook configuration.");
          })
          .then(function () {
            checkoutButton.textContent = "Checkout cart";
            checkoutButton.disabled = MERCH_CART.length === 0;
          });
      });
    }

    var clearButton = document.querySelector("[data-merch-cart-clear]");
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        MERCH_CART = [];
        writeCart();
        renderCart();
      });
    }
  }

  function sendAnalytics() {
    var endpoint = configuredMetaContent("sqts-analytics-endpoint");
    if (!endpoint || !window.fetch) {
      return;
    }
    var visitorKey = "sqts_visitor_id_v1";
    var visitorId = "";
    try {
      visitorId = localStorage.getItem(visitorKey) || "";
      if (!visitorId) {
        visitorId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
        localStorage.setItem(visitorKey, visitorId);
      }
    } catch (_err) {
      visitorId = "session-" + String(Date.now()) + "-" + Math.random();
    }
    fetch(endpoint, {
      method: "POST",
      mode: "cors",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "smartsleeve.ai",
        path: window.location.pathname || "/app/",
        referrer: document.referrer || "",
        visitor_id: visitorId,
        timestamp: new Date().toISOString()
      })
    }).catch(function () {});
  }

  document.addEventListener("DOMContentLoaded", function () {
    readCart();
    loadMerchCatalog().then(wireMerchStore);
    if (window.location.hash.indexOf("#shop-success") === 0) {
      MERCH_CART = [];
      writeCart();
      showToast("Thanks for the SmartSleeve order. Stripe confirmed checkout; fulfillment will follow through SmartSleeve.");
    }
    renderCart();
    sendAnalytics();
  });
})();
