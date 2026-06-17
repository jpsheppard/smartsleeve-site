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

  function startMerchantCheckout(productKey, fallbackUrl, size) {
    var endpoint = configuredMetaContent("smartsleeve-merch-checkout-endpoint");
    if (!endpoint || !window.fetch) {
      return Promise.resolve(false);
    }
    return window.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_key: productKey,
        quantity: 1,
        size: size || "M",
        merchant_of_record: MERCH_MERCHANT_OF_RECORD,
        fallback_url: fallbackUrl || window.location.href
      })
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
    kicker.textContent = product.printful_product_id ? "Printful product " + product.printful_product_id : "Printful product";
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
    description.textContent = "Published Printful product synced into SmartSleeve checkout. Price and size options come from Printful.";
    copy.appendChild(description);

    var label = document.createElement("label");
    label.className = "merch-size-picker";
    label.textContent = "Size ";
    var select = document.createElement("select");
    select.setAttribute("data-merch-size", "");
    select.setAttribute("aria-label", product.name + " size");
    label.appendChild(select);
    copy.appendChild(label);

    var actions = document.createElement("div");
    actions.className = "action-row";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "button primary";
    button.setAttribute("data-merch-checkout", product.key);
    button.textContent = "Order";
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
    catalog.products.forEach(function (product) {
      if (product && product.key) {
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
        var url = merchCheckoutUrl(productKey);
        var size = selectedMerchSize(button);
        startMerchantCheckout(productKey, url, size)
          .then(function (openedMerchantCheckout) {
            if (openedMerchantCheckout) {
              return;
            }
            if (url) {
              window.open(url, "_blank", "noopener,noreferrer");
              return;
            }
            showToast("SmartSleeve shop checkout is ready for wiring, but the Stripe Checkout endpoint is not configured yet.");
          })
          .catch(function () {
            if (url) {
              window.open(url, "_blank", "noopener,noreferrer");
              return;
            }
            showToast("SmartSleeve shop checkout could not start. Check the Stripe Checkout endpoint and fulfillment webhook configuration.");
          });
      });
    });
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
    loadMerchCatalog().then(wireMerchStore);
    if (window.location.hash === "#shop-success") {
      showToast("Thanks for the SmartSleeve order. Stripe confirmed checkout; fulfillment will follow through SmartSleeve.");
    }
    sendAnalytics();
  });
})();
