(function () {
  "use strict";

  var MERCH_MERCHANT_OF_RECORD = "SmartSleeve Quantitative Trading Systems, LLC";
  var MERCH_PRODUCT_URLS = {
    "sqts-tee": "",
    "smartsleeve-ss-tee": ""
  };

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

  function startMerchantCheckout(productKey, fallbackUrl) {
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

  function wireMerchStore() {
    all("[data-merch-checkout]").forEach(function (button) {
      button.addEventListener("click", function () {
        var productKey = button.getAttribute("data-merch-checkout") || "";
        var url = merchCheckoutUrl(productKey);
        startMerchantCheckout(productKey, url)
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
    wireMerchStore();
    sendAnalytics();
  });
})();
