(function () {
  "use strict";

  var assetIndex = [
    {
      symbol: "MU",
      name: "Micron Technology",
      type: "Long stock",
      price: "$192.00",
      stats: "Memory, HBM, DRAM, AI infrastructure",
      description: "Cyclical semiconductor memory leader with AI data-center exposure."
    },
    {
      symbol: "SNDK",
      name: "SanDisk",
      type: "Long stock",
      price: "$2,000.00",
      stats: "NAND, storage, high volatility",
      description: "Storage and NAND exposure with large intraday swings."
    },
    {
      symbol: "NBIS",
      name: "Nebius Group",
      type: "Long stock",
      price: "$55.00",
      stats: "AI cloud, high beta",
      description: "AI infrastructure and cloud compute candidate."
    },
    {
      symbol: "CRDO",
      name: "Credo Technology",
      type: "Long stock",
      price: "$130.00",
      stats: "Connectivity, AI networking",
      description: "High-growth AI networking and connectivity exposure."
    },
    {
      symbol: "AMD",
      name: "Advanced Micro Devices",
      type: "Long stock",
      price: "$165.00",
      stats: "AI accelerators, CPU, GPU",
      description: "Large-cap semiconductor and AI accelerator exposure."
    },
    {
      symbol: "NVDA",
      name: "NVIDIA",
      type: "Long stock",
      price: "$145.00",
      stats: "AI accelerator bellwether",
      description: "Dominant GPU and AI infrastructure platform."
    },
    {
      symbol: "TSM",
      name: "Taiwan Semiconductor",
      type: "Long stock",
      price: "$210.00",
      stats: "Foundry, global semis",
      description: "Leading global foundry at the center of advanced-node supply."
    },
    {
      symbol: "ALAB",
      name: "Astera Labs",
      type: "Long stock",
      price: "$95.00",
      stats: "AI connectivity, PCIe, CXL",
      description: "AI connectivity and data-center interconnect candidate."
    },
    {
      symbol: "VRT",
      name: "Vertiv",
      type: "Long stock",
      price: "$120.00",
      stats: "Data-center power and thermal",
      description: "Data-center infrastructure beneficiary."
    },
    {
      symbol: "SOXL",
      name: "Direxion Daily Semiconductor Bull 3x",
      type: "Levered long ETF",
      price: "$205.00",
      stats: "3x semiconductor bull exposure",
      description: "Tactical leveraged long semiconductor basket."
    },
    {
      symbol: "SOXS",
      name: "Direxion Daily Semiconductor Bear 3x",
      type: "Inverse / bear ETF",
      price: "$5.00",
      stats: "3x inverse semiconductor exposure",
      description: "Tactical bear semiconductor ETF for pullback regimes."
    },
    {
      symbol: "SQQQ",
      name: "ProShares UltraPro Short QQQ",
      type: "Inverse / bear ETF",
      price: "$9.00",
      stats: "3x inverse Nasdaq-100",
      description: "Tactical broad tech bear ETF for Nasdaq drawdown protection."
    },
    {
      symbol: "QQQ",
      name: "Invesco QQQ Trust",
      type: "Long ETF",
      price: "$540.00",
      stats: "Nasdaq-100 large-cap tech",
      description: "Broad large-cap technology and growth exposure."
    },
    {
      symbol: "VOO",
      name: "Vanguard S&P 500 ETF",
      type: "Long ETF",
      price: "$560.00",
      stats: "S&P 500 core market",
      description: "Broad US equity market exposure."
    }
  ];

  var defaultUniverse = ["MU", "SNDK", "NBIS", "CRDO", "AMD", "NVDA", "TSM", "ALAB", "VRT", "SOXS"];
  var selectedUniverse = [];
  var MERCH_MERCHANT_OF_RECORD = "SmartSleeve Quantitative Trading Systems, LLC";
  var MERCH_STRIPE_CHECKOUT_ENDPOINT = "";
  var MERCH_PROVIDER_STORE_URL = "";
  var MERCH_PRODUCT_URLS = {
    "sqts-tee": "",
    "semisage-tee": ""
  };
  var checkoutBasePrices = {
    core: 20,
    grand_sage: 100
  };
  var discountCodes = {
    BFF4LYFE: {
      label: "BFF4LYFE",
      description: "Free SmartSleeve Core and free Grand Sage subscription.",
      core_discount_pct: 1,
      grand_sage_discount_pct: 1
    },
    OG2026FOUNDER: {
      label: "OG2026FOUNDER",
      description: "Free SmartSleeve Core and 50% off optional Grand Sage.",
      core_discount_pct: 1,
      grand_sage_discount_pct: 0.5
    },
    OG2026USER: {
      label: "OG2026USER",
      description: "20% off SmartSleeve Core and 20% off optional Grand Sage.",
      core_discount_pct: 0.2,
      grand_sage_discount_pct: 0.2
    }
  };
  var portfolioRows = [
    {
      sleeve: "Semi Sage",
      asset: "MU",
      quantity: "4.000000",
      value: "$768.00",
      behaviors: ["stickiness 100%", "clinginess 100%", "diversity 0%", "gain-locking 0%"],
      permission: "Sleeve-owned only"
    },
    {
      sleeve: "Semi Sage",
      asset: "SNDK",
      quantity: "3.000000",
      value: "$6,000.00",
      behaviors: ["stickiness 100%", "clinginess 100%", "attraction 50%"],
      permission: "Sleeve-owned only"
    },
    {
      sleeve: "Honey Badger",
      asset: "Cash",
      quantity: "$750.00",
      value: "$750.00",
      behaviors: ["flip resistance", "bullishness tunable"],
      permission: "Cash limit locked"
    },
    {
      sleeve: "Custom Sage (Grand Sage)",
      asset: "Cash",
      quantity: "$10,889.38",
      value: "$10,889.38",
      behaviors: ["Grand Sage universe", "SOXS bear coverage", "daily tuning"],
      permission: "Universe-scoped buys"
    },
    {
      sleeve: "Non-sleeve",
      asset: "Manual holdings",
      quantity: "Read-only",
      value: "$--",
      behaviors: ["not managed"],
      permission: "Never sell"
    }
  ];
  var automationRows = [
    {
      workflow: "Grand Sage collection",
      schedule: "Weekdays before market open",
      artifact: "analytics_exports/grand_philosophe_robinhood.json",
      behavior: "Reuse latest successful universe"
    },
    {
      workflow: "Custom priors refresh",
      schedule: "After universe assignment, then intraday",
      artifact: "research_priors_history.jsonl",
      behavior: "Keep prior coefficients if research fails"
    },
    {
      workflow: "Bayesian tuning",
      schedule: "Before market open and daily cloud loop",
      artifact: "analytics_exports/daily_bayesian_tuning.json",
      behavior: "Reject unsafe or stale updates"
    },
    {
      workflow: "Execution stress matrix",
      schedule: "On demand and pre-launch",
      artifact: "analytics_exports/execution_stress_matrix.json",
      behavior: "Fail closed on sleeve-limit violations"
    }
  ];
  var installCommands = {
    android: [
      ".venv/bin/python scripts/smartsleeve_app_workflow.py doctor",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py serve-web",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py android-devices",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py android-install --apk mobile/android/app/build/outputs/apk/debug/app-debug.apk"
    ].join("\n"),
    ios: [
      ".venv/bin/python scripts/smartsleeve_app_workflow.py ios-simulators",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py serve-web",
      "Set SMARTSLEEVE_CONSOLE_URL=http://127.0.0.1:8765/app/ in the Xcode scheme.",
      "Use TestFlight for cleaner iPhone beta distribution."
    ].join("\n"),
    desktop: [
      "cd desktop/smartsleeve-command",
      "npm install",
      "npm run dev",
      "SMARTSLEEVE_COMMAND_URL=http://127.0.0.1:8765/app/ npm run dev"
    ].join("\n")
  };
  var appliedDiscountCode = "";

  function byId(id) {
    return document.getElementById(id);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function canonicalSectionName(name) {
    return name === "store" ? "shop" : name;
  }

  function activateSection(name) {
    var fallback = "overview";
    var requested = canonicalSectionName(name || fallback);
    var section = document.querySelector('[data-section="' + requested + '"]') ? requested : fallback;
    all("[data-section]").forEach(function (item) {
      item.classList.toggle("active", item.getAttribute("data-section") === section);
    });
    all("[data-nav]").forEach(function (item) {
      item.classList.toggle("active", item.getAttribute("data-nav") === section);
    });
  }

  function wireNavigation() {
    all("[data-nav]").forEach(function (item) {
      item.addEventListener("click", function (event) {
        var target = item.getAttribute("data-nav");
        if (!target) {
          return;
        }
        event.preventDefault();
        window.location.hash = target;
        activateSection(target);
      });
    });
    window.addEventListener("hashchange", function () {
      activateSection((window.location.hash || "#overview").slice(1));
    });
    activateSection((window.location.hash || "#overview").slice(1));
  }

  function showPrototypeToast(message) {
    var toast = byId("prototype-toast");
    if (!toast) {
      return;
    }
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.add("show");
    window.clearTimeout(showPrototypeToast.timeoutId);
    showPrototypeToast.timeoutId = window.setTimeout(function () {
      toast.classList.remove("show");
      toast.hidden = true;
    }, 4200);
  }

  function wirePrototypeActions() {
    all("[data-prototype-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        showPrototypeToast(button.getAttribute("data-prototype-action"));
      });
    });
  }

  function money(value) {
    return "$" + Number(value || 0).toFixed(2) + "/mo";
  }

  function normalizedDiscountCode() {
    var input = byId("discount-code");
    return input ? input.value.trim().toUpperCase() : "";
  }

  function checkoutSelection() {
    var grandSage = byId("checkout-grand-sage");
    return {
      core: true,
      grand_sage: grandSage ? grandSage.checked : true
    };
  }

  function discountedAmount(price, discountPct) {
    return Math.max(0, price * (1 - Number(discountPct || 0)));
  }

  function updateCheckoutPreview() {
    var coreTotal = byId("core-total");
    var grandSageTotal = byId("grand-sage-total");
    var checkoutTotal = byId("checkout-total");
    var summary = byId("discount-summary");
    if (!coreTotal || !grandSageTotal || !checkoutTotal || !summary) {
      return;
    }
    var selected = checkoutSelection();
    var discount = appliedDiscountCode ? discountCodes[appliedDiscountCode] : null;
    var core = selected.core
      ? discountedAmount(checkoutBasePrices.core, discount && discount.core_discount_pct)
      : 0;
    var grandSage = selected.grand_sage
      ? discountedAmount(checkoutBasePrices.grand_sage, discount && discount.grand_sage_discount_pct)
      : 0;

    coreTotal.textContent = money(core);
    grandSageTotal.textContent = selected.grand_sage ? money(grandSage) : "Not selected";
    checkoutTotal.textContent = money(core + grandSage);
    summary.classList.remove("ok", "error");
    if (discount) {
      summary.textContent = "Applied " + discount.label + ": " + discount.description;
      summary.classList.add("ok");
    } else if (appliedDiscountCode) {
      summary.textContent = "Discount code not recognized.";
      summary.classList.add("error");
    } else {
      summary.textContent = "Enter a discount code to preview eligible subscription pricing.";
    }
  }

  function applyDiscountCode() {
    var code = normalizedDiscountCode();
    appliedDiscountCode = code && discountCodes[code] ? code : code;
    updateCheckoutPreview();
  }

  function wireCheckoutPreview() {
    var apply = byId("apply-discount");
    var input = byId("discount-code");
    var grandSage = byId("checkout-grand-sage");
    if (apply) {
      apply.addEventListener("click", applyDiscountCode);
    }
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          applyDiscountCode();
        }
      });
      input.addEventListener("input", function () {
        if (!input.value.trim()) {
          appliedDiscountCode = "";
          updateCheckoutPreview();
        }
      });
    }
    if (grandSage) {
      grandSage.addEventListener("change", updateCheckoutPreview);
    }
    updateCheckoutPreview();
  }

  function configuredMetaContent(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta && meta.content && meta.content.indexOf("__") !== 0 ? meta.content.trim() : "";
  }

  function authRegisterUrl() {
    var endpoint = configuredMetaContent("smartsleeve-auth-endpoint");
    if (!endpoint) {
      return "";
    }
    return endpoint.replace(/\/$/, "").endsWith("/register") ? endpoint : endpoint.replace(/\/$/, "") + "/register";
  }

  function setRegistrationStatus(message, kind) {
    var status = byId("registration-status");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.classList.remove("ok", "error");
    if (kind) {
      status.classList.add(kind);
    }
  }

  function registrationPayload(form) {
    var data = new FormData(form);
    return {
      username: String(data.get("username") || "").trim(),
      email: String(data.get("email") || "").trim(),
      first_name: String(data.get("first_name") || "").trim(),
      middle_name: String(data.get("middle_name") || "").trim(),
      last_name: String(data.get("last_name") || "").trim(),
      nickname: String(data.get("nickname") || "").trim(),
      password: String(data.get("password") || ""),
      password_confirm: String(data.get("password_confirm") || ""),
      report_recipients: String(data.get("report_recipients") || "").trim(),
      notes: String(data.get("notes") || "").trim(),
      accepted_terms: Boolean(data.get("accepted_terms"))
    };
  }

  function validateRegistrationPayload(payload) {
    var errors = [];
    if (payload.username.length < 3) {
      errors.push("username");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      errors.push("valid email");
    }
    if (!payload.first_name) {
      errors.push("first name");
    }
    if (!payload.last_name) {
      errors.push("last name");
    }
    if (payload.password.length < 12) {
      errors.push("12+ character password");
    }
    if (payload.password !== payload.password_confirm) {
      errors.push("matching passwords");
    }
    if (!payload.accepted_terms) {
      errors.push("acknowledgement checkbox");
    }
    return errors;
  }

  function wireRegistrationForm() {
    var form = byId("profile-form");
    if (!form) {
      return;
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var payload = registrationPayload(form);
      var errors = validateRegistrationPayload(payload);
      if (errors.length) {
        setRegistrationStatus("Please check: " + errors.join(", ") + ".", "error");
        return;
      }
      var endpoint = authRegisterUrl();
      if (!endpoint || !window.fetch) {
        setRegistrationStatus(
          "Registration backend is not connected yet. Configure SMARTSLEEVE_AUTH_ENDPOINT to send verification emails.",
          "error"
        );
        showPrototypeToast("Account details validated locally. The auth Worker endpoint still needs to be configured before verification emails can send.");
        return;
      }
      var submit = form.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = true;
      }
      setRegistrationStatus("Sending verification email...", "");
      fetch(endpoint, {
        method: "POST",
        mode: "cors",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok || !body.ok) {
              var detail = body.errors && body.errors.length ? body.errors.join(", ") : body.error || "registration_failed";
              throw new Error(detail);
            }
            return body;
          });
        })
        .then(function () {
          form.reset();
          setRegistrationStatus("Verification email sent. Check your inbox and click the SmartSleeve verification link.", "ok");
        })
        .catch(function (err) {
          setRegistrationStatus("Could not send verification email: " + err.message + ".", "error");
        })
        .finally(function () {
          if (submit) {
            submit.disabled = false;
          }
        });
    });
  }

  function updateSliderOutput(input) {
    var output = byId(input.id + "-out");
    if (output) {
      output.textContent = input.value + "%";
    }
  }

  function numberOrNull(id) {
    var input = byId(id);
    if (!input || input.value === "") {
      return null;
    }
    var parsed = Number(input.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function orderRouteForType(orderType) {
    if (orderType === "market" || orderType === "limit") {
      return "direct_proposed_order";
    }
    if (orderType === "stop_market" || orderType === "stop_limit" || orderType === "trailing_stop_market") {
      return "broker_native_adapter_required";
    }
    return "synthetic_supervised";
  }

  function advancedOrderPreview() {
    var preview = byId("advanced-order-preview");
    var route = byId("advanced-order-route");
    if (!preview) {
      return;
    }
    var type = byId("advanced-order-type") ? byId("advanced-order-type").value : "market";
    var routeValue = orderRouteForType(type);
    var trailingPercent = numberOrNull("advanced-order-trailing-percent");
    var payload = {
      sleeve: byId("advanced-order-sleeve") ? byId("advanced-order-sleeve").value : "safer_v1",
      symbol: (byId("advanced-order-symbol") && byId("advanced-order-symbol").value ? byId("advanced-order-symbol").value : "MU").toUpperCase(),
      side: byId("advanced-order-side") ? byId("advanced-order-side").value : "buy",
      order_type: type,
      route: routeValue,
      session: byId("advanced-order-session") ? byId("advanced-order-session").value : "regular_hours",
      quantity: numberOrNull("advanced-order-quantity"),
      notional_usd: numberOrNull("advanced-order-notional"),
      limit_price: numberOrNull("advanced-order-limit-price"),
      stop_price: numberOrNull("advanced-order-stop-price"),
      trailing_amount: numberOrNull("advanced-order-trailing-amount"),
      trailing_percent: trailingPercent === null ? null : trailingPercent / 100,
      limit_offset: numberOrNull("advanced-order-limit-offset"),
      notes: byId("advanced-order-notes") ? byId("advanced-order-notes").value : "",
      status: "draft_only_requires_secure_backend_commit"
    };
    if (type === "bracket") {
      payload.child_intents = [
        {role: "entry", type: payload.limit_price === null ? "market" : "limit"},
        {role: "take_profit", type: "limit", limit_price: payload.limit_price},
        {role: "stop_loss", type: "stop_market", stop_price: payload.stop_price}
      ];
    } else if (type === "oco") {
      payload.child_intents = [
        {role: "first_exit", type: "limit_or_stop"},
        {role: "sibling_exit", type: "cancelled_when_first_fills"}
      ];
    } else if (type === "if_then") {
      payload.trigger = {reference: "last", operator: "gte_or_lte", threshold: payload.stop_price};
    }
    if (route) {
      route.textContent = routeValue;
      route.classList.toggle("synthetic", routeValue === "synthetic_supervised");
      route.classList.toggle("adapter", routeValue === "broker_native_adapter_required");
    }
    preview.textContent = JSON.stringify(payload, null, 2);
  }

  function wireAdvancedOrderControls() {
    all("#advanced-orders input, #advanced-orders select, #advanced-orders textarea").forEach(function (input) {
      input.addEventListener("input", advancedOrderPreview);
      input.addEventListener("change", advancedOrderPreview);
    });
    advancedOrderPreview();
  }

  function behaviorPreview() {
    var sleeve = byId("behavior-sleeve");
    var symbol = byId("behavior-symbol");
    var scope = byId("behavior-scope");
    var quantity = byId("behavior-quantity");
    var preview = byId("behavior-preview");
    if (!preview) {
      return;
    }
    var payload = {
      sleeve: sleeve ? sleeve.value : "Semi Sage",
      symbol: (symbol && symbol.value ? symbol.value : "MU").toUpperCase(),
      scope: scope ? scope.value : "All future purchases",
      quantity: quantity && quantity.value ? Number(quantity.value) : null,
      behaviors: {
        clinginess_or_flip_resistance: Number(byId("clinginess").value) / 100,
        diversity: Number(byId("diversity").value) / 100,
        attraction: Number(byId("attraction").value) / 100,
        bullishness: Number(byId("bullishness").value) / 100,
        stickiness: Number(byId("stickiness").value) / 100,
        gain_locking: Number(byId("gain-locking").value) / 100,
        hold: Boolean(byId("hard-hold") && byId("hard-hold").checked)
      },
      status: "draft_only_requires_secure_backend_commit"
    };
    preview.textContent = JSON.stringify(payload, null, 2);
  }

  function wireBehaviorControls() {
    all("#behaviors input, #behaviors select").forEach(function (input) {
      if (input.type === "range") {
        updateSliderOutput(input);
      }
      input.addEventListener("input", function () {
        if (input.type === "range") {
          updateSliderOutput(input);
        }
        behaviorPreview();
      });
      input.addEventListener("change", behaviorPreview);
    });
    behaviorPreview();
  }

  function getSelectedAsset(symbol) {
    return assetIndex.find(function (item) {
      return item.symbol === symbol;
    });
  }

  function saveUniverse() {
    try {
      window.localStorage.setItem("sqts_selected_universe_v1", JSON.stringify(selectedUniverse));
    } catch (_err) {
      // Non-sensitive preference only; failing silently is fine.
    }
  }

  function loadUniverse() {
    try {
      var raw = window.localStorage.getItem("sqts_selected_universe_v1");
      var parsed = raw ? JSON.parse(raw) : null;
      selectedUniverse = Array.isArray(parsed) && parsed.length ? parsed.slice(0, 20) : defaultUniverse.slice();
    } catch (_err) {
      selectedUniverse = defaultUniverse.slice();
    }
  }

  function renderSelectedUniverse() {
    var list = byId("selected-universe");
    var count = byId("universe-count");
    if (!list || !count) {
      return;
    }
    list.innerHTML = "";
    selectedUniverse.forEach(function (symbol, index) {
      var asset = getSelectedAsset(symbol) || {symbol: symbol, name: "Custom asset", type: "User selected", price: "-", stats: ""};
      var item = document.createElement("li");
      item.innerHTML = "<b>" + (index + 1) + ". " + asset.symbol + "</b><span>" + asset.name + " - " + asset.type + " - " + asset.price + "</span>";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        selectedUniverse = selectedUniverse.filter(function (value) {
          return value !== symbol;
        });
        saveUniverse();
        renderSelectedUniverse();
        renderAssetResults();
      });
      item.appendChild(remove);
      list.appendChild(item);
    });
    count.textContent = selectedUniverse.length + " / 20";
  }

  function addAsset(symbol) {
    if (selectedUniverse.indexOf(symbol) !== -1 || selectedUniverse.length >= 20) {
      return;
    }
    selectedUniverse.push(symbol);
    saveUniverse();
    renderSelectedUniverse();
    renderAssetResults();
  }

  function renderAssetResults() {
    var search = byId("asset-search");
    var results = byId("asset-results");
    if (!search || !results) {
      return;
    }
    var query = search.value.trim().toLowerCase();
    var filtered = assetIndex.filter(function (asset) {
      var haystack = [asset.symbol, asset.name, asset.type, asset.stats, asset.description].join(" ").toLowerCase();
      return !query || haystack.indexOf(query) !== -1;
    });
    results.innerHTML = "";
    filtered.slice(0, 12).forEach(function (asset) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "asset-button";
      button.disabled = selectedUniverse.indexOf(asset.symbol) !== -1 || selectedUniverse.length >= 20;
      button.innerHTML = "<b>" + asset.symbol + "</b><span>" + asset.name + "<br>" + asset.description + "</span><em>" + asset.price + "</em>";
      button.addEventListener("click", function () {
        addAsset(asset.symbol);
      });
      results.appendChild(button);
    });
  }

  function wireUniverseBuilder() {
    loadUniverse();
    var search = byId("asset-search");
    if (search) {
      search.addEventListener("input", renderAssetResults);
    }
    renderSelectedUniverse();
    renderAssetResults();
  }

  function behaviorTags(tags) {
    return '<span class="behavior-tags">' + tags.map(function (tag) {
      return "<span>" + escapeHtml(tag) + "</span>";
    }).join("") + "</span>";
  }

  function renderPortfolioBreakdown() {
    var table = byId("portfolio-breakdown");
    var filter = byId("portfolio-filter");
    if (!table) {
      return;
    }
    var selected = filter ? filter.value : "all";
    var rows = portfolioRows.filter(function (row) {
      return selected === "all" || row.sleeve === selected;
    });
    table.innerHTML = rows.map(function (row) {
      var locked = row.permission === "Never sell" || row.permission === "Cash limit locked";
      return "<tr>"
        + "<td>" + escapeHtml(row.sleeve) + "</td>"
        + "<td><b>" + escapeHtml(row.asset) + "</b></td>"
        + "<td>" + escapeHtml(row.quantity) + "</td>"
        + "<td>" + escapeHtml(row.value) + "</td>"
        + "<td>" + behaviorTags(row.behaviors) + "</td>"
        + '<td><span class="permission-pill ' + (locked ? "locked" : "") + '">' + escapeHtml(row.permission) + "</span></td>"
        + "</tr>";
    }).join("");
  }

  function wirePortfolioBreakdown() {
    var filter = byId("portfolio-filter");
    if (filter) {
      filter.addEventListener("change", renderPortfolioBreakdown);
    }
    renderPortfolioBreakdown();
  }

  function renderAutomationHealth() {
    var table = byId("automation-health");
    if (!table) {
      return;
    }
    table.innerHTML = automationRows.map(function (row, index) {
      var kind = index < 2 ? "ok" : "warn";
      return "<tr>"
        + "<td>" + escapeHtml(row.workflow) + "</td>"
        + "<td>" + escapeHtml(row.schedule) + "</td>"
        + "<td><code>" + escapeHtml(row.artifact) + "</code></td>"
        + '<td><span class="health-pill ' + kind + '">' + escapeHtml(row.behavior) + "</span></td>"
        + "</tr>";
    }).join("");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.setAttribute("readonly", "readonly");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(textArea);
      }
    });
  }

  function wireCommandCenter() {
    var preview = byId("install-command-preview");
    all("[data-install-command]").forEach(function (button) {
      button.addEventListener("click", function () {
        var key = button.getAttribute("data-install-command");
        var command = installCommands[key] || "";
        if (preview) {
          preview.textContent = command;
        }
        copyText(command)
          .then(function () {
            showPrototypeToast("Copied " + key + " workflow commands.");
          })
          .catch(function () {
            showPrototypeToast("Showing " + key + " workflow commands. Copy manually from the preview.");
          });
      });
    });
  }

  function merchCheckoutUrl(productKey) {
    return MERCH_PRODUCT_URLS[productKey] || MERCH_PROVIDER_STORE_URL || "";
  }

  function startMerchantCheckout(productKey, fallbackUrl) {
    if (!MERCH_STRIPE_CHECKOUT_ENDPOINT || !window.fetch) {
      return Promise.resolve(false);
    }
    return window.fetch(MERCH_STRIPE_CHECKOUT_ENDPOINT, {
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
            showPrototypeToast(
              "SmartSleeve LLC merch checkout is ready for wiring, but MERCH_STRIPE_CHECKOUT_ENDPOINT or legacy provider product URLs still need to be configured."
            );
          })
          .catch(function () {
            if (url) {
              window.open(url, "_blank", "noopener,noreferrer");
              return;
            }
            showPrototypeToast(
              "SmartSleeve LLC merchant checkout could not start. Check the Stripe Checkout endpoint and fulfillment webhook configuration."
            );
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
        visitorId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random());
        localStorage.setItem(visitorKey, visitorId);
      }
    } catch (_err) {
      visitorId = "session-" + String(Date.now()) + "-" + Math.random();
    }
    fetch(endpoint, {
      method: "POST",
      mode: "cors",
      keepalive: true,
      headers: {"Content-Type": "application/json"},
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
    wireNavigation();
    wirePrototypeActions();
    wireCheckoutPreview();
    wireRegistrationForm();
    wireBehaviorControls();
    wireAdvancedOrderControls();
    wireUniverseBuilder();
    wirePortfolioBreakdown();
    renderAutomationHealth();
    wireCommandCenter();
    wireMerchStore();
    sendAnalytics();
  });
})();
