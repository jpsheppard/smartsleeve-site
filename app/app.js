(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var appEdition = params.get("app_edition") || "web";
  var accountScope = params.get("account_scope") || "user";
  var requestedDeveloperView = appEdition === "developer" || accountScope === "all";
  var principalEmail = normalizeEmail(params.get("principal_email") || "");
  var authEndpoint = metaContent("smartsleeve-auth-endpoint");
  var orderIntentEndpoint = metaContent("smartsleeve-order-intent-endpoint") || (authEndpoint ? authEndpoint.replace(/\/$/, "") + "/order-intents" : "");
  var appFeedEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/api/app-feed" : "";
  var appFeedRefreshEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/api/app-feed/refresh" : "";
  var loginEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/login" : "";
  var registerEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/register" : "";
  var passwordResetEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/password-reset/request" : "";
  var sessionToken = params.get("session_token") || "";

  var state = {
    payload: null,
    allAccounts: [],
    accounts: [],
    holdings: [],
    foreignHoldings: [],
    sleeves: [],
    recommendations: [],
    draftOrders: [],
    activity: [],
    serverTrades: [],
    brain: [],
    reports: [],
    history: {accounts: [], positions: []},
    accountCoverage: null,
    feedWarning: null,
    selectedOwnerEmail: "all",
    selectedAccountId: "all",
    selectedDetailAccountId: "",
    selectedDetailSleeveName: "",
    selectedStockPickSleeve: "",
    selectedAccountChartRange: "1D",
    sageMode: "recommend",
    selectedTradeId: null,
    orderNotificationSeen: {},
    orderNotificationPrimed: false,
    activeScrubChart: null,
    feedRefreshTimer: null,
    pullRefresh: {
      startY: 0,
      distance: 0,
      tracking: false,
      armed: false,
      refreshing: false
    },
    feedSource: "loading"
  };

  var tickerNames = {
    "000660": "SK Hynix",
    ALAB: "Astera Labs",
    CRDO: "Credo Technology",
    IONQ: "IonQ",
    MU: "Micron Technology",
    NBIS: "Nebius",
    QBTS: "D-Wave Quantum",
    RGTI: "Rigetti Computing",
    SMCI: "Super Micro Computer",
    SNDK: "SanDisk",
    SOXL: "Direxion Daily Semiconductor Bull 3x"
  };

  var orderTypeLabels = {
    market: "Market",
    limit: "Limit",
    stop_market: "Stop loss",
    stop_limit: "Stop limit",
    trailing_stop_market: "Trailing stop loss",
    trailing_stop_limit: "Trailing stop limit",
    bracket: "Bracket",
    pair_switch: "Pair switch"
  };

  var sessionLabels = {
    regular: "Regular market",
    extended: "Extended hours",
    all_day: "Overnight / 24 Hour Market"
  };

  var routeLabels = {
    direct_proposed_order: "Direct broker preview path",
    broker_native_adapter_required: "Broker-native adapter path",
    synthetic_supervised: "SmartSleeve synthetic supervisor"
  };

  var strategyLabels = {
    single_order: "Single order",
    smarttrade_window: "SmartTrade window",
    autoguard_window: "SmartTrade window",
    reallocation: "SmartTrade reallocation",
    protective_exit: "AutoGuard protective exit",
    bracket: "Bracket",
    ladder: "Ladder"
  };

  var executionModeLabels = {
    draft: "Draft only",
    server_preview: "Server preview",
    assisted_place: "Preview then request placement",
    autoguard: "AutoGuard supervised"
  };

  var sleeveTargets = {
    "Sage by SmartSleeve": 35,
    "Grand Sage": 30,
    "Savage Sage": 12,
    "Honey Badger": 8,
    "Value Sage": 8,
    "Edge Sage": 4,
    "Covered Sage": 2,
    "Convex Sage": 1,
    "Semi Sage": 10
  };

  var sageModes = [
    ["observe", "Observe Only", "Analyze portfolio only; no recommendations or orders."],
    ["recommend", "Recommend", "Create portfolio-specific recommendations, but not broker orders."],
    ["assisted", "Assisted Trading", "Prepare draft orders that require user approval."],
    ["rules", "Rules-Based Automation", "Submit only inside explicit sleeve rules and limits."],
    ["auto", "Fully Automated Sleeve", "Enabled only per sleeve with strict limits and kill switch."]
  ];

  var basisCapture = [
    ["Entry", 82, "Buy execution captured versus Hindsight Efficient Basis."],
    ["Exit", 74, "Sell execution captured versus best reachable exit basis."],
    ["Reallocation", 68, "Source-sale and target-buy capture for reallocations."],
    ["Investor window", 77, "How well the chosen mandate window helped Sage work."]
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function metaContent(name) {
    var element = document.querySelector("meta[name=\"" + name + "\"]");
    var value = element ? String(element.getAttribute("content") || "").trim() : "";
    return value && value.indexOf("__") !== 0 ? value : "";
  }

  function authFetch(url, options) {
    var headers = Object.assign({"Accept": "application/json"}, (options && options.headers) || {});
    if (sessionToken) {
      headers.Authorization = "Bearer " + sessionToken;
    }
    return fetch(url, Object.assign({
      cache: "no-store",
      credentials: "include",
      headers: headers
    }, options || {}, {headers: headers}));
  }

  function sessionStorageKey() {
    return "smartsleeve_session:" + (appEdition === "developer" ? "developer" : "user");
  }

  function restoreStoredSession() {
    if (sessionToken) return;
    try {
      var requestedPrincipal = principalEmail;
      var payload = JSON.parse(window.localStorage.getItem(sessionStorageKey()) || "{}");
      if (!payload || !payload.sessionToken) return;
      var storedPrincipal = normalizeEmail(payload.principalEmail || "");
      if (requestedPrincipal && storedPrincipal && storedPrincipal !== requestedPrincipal) {
        clearStoredSession();
        return;
      }
      sessionToken = payload.sessionToken;
      principalEmail = storedPrincipal || requestedPrincipal;
      if (payload.role === "developer" && requestedDeveloperView) {
        appEdition = "developer";
        accountScope = "all";
      } else {
        appEdition = appEdition === "developer" ? "web" : appEdition;
        accountScope = "user";
      }
    } catch (_err) {
      // localStorage can be unavailable in locked-down webviews.
    }
  }

  function persistStoredSession(profile) {
    try {
      var role = (profile || {}).role === "developer" && requestedDeveloperView ? "developer" : "user";
      var profileEmail = normalizeEmail((profile || {}).email || principalEmail);
      window.localStorage.setItem("smartsleeve_session:" + role, JSON.stringify({
        sessionToken: sessionToken,
        principalEmail: profileEmail,
        role: role,
        savedAt: new Date().toISOString()
      }));
    } catch (_err) {
      // localStorage can be unavailable in locked-down webviews.
    }
  }

  function clearStoredSession() {
    sessionToken = "";
    try {
      window.localStorage.removeItem("smartsleeve_session:user");
      window.localStorage.removeItem("smartsleeve_session:developer");
    } catch (_err) {
      // localStorage can be unavailable in locked-down webviews.
    }
  }

  function removeAuthGate() {
    var existing = $("auth-gate");
    if (existing) {
      existing.remove();
    }
  }

  function showAuthGate(message) {
    if ($("auth-gate")) {
      text("auth-gate-message", message || "Sign in to load your private SmartSleeve data.");
      return;
    }
    var gate = document.createElement("div");
    gate.id = "auth-gate";
    gate.className = "auth-gate";
    gate.innerHTML = [
      "<form class=\"auth-card\" id=\"auth-gate-form\" data-mode=\"login\">",
      "<img src=\"/brand/smartsleeve-apparel-logo-cropped.png\" alt=\"SmartSleeve\">",
      "<h2>Private SmartSleeve Access</h2>",
      "<p id=\"auth-gate-message\">" + html(message || "Sign in to load your private SmartSleeve data.") + "</p>",
      "<div class=\"auth-switch\" role=\"tablist\" aria-label=\"SmartSleeve access mode\">",
      "<button type=\"button\" data-auth-mode=\"login\" aria-selected=\"true\">Sign in</button>",
      "<button type=\"button\" data-auth-mode=\"register\" aria-selected=\"false\">Create account</button>",
      "</div>",
      "<label class=\"auth-register-field\">Username<input id=\"auth-username\" type=\"text\" autocomplete=\"username\" minlength=\"3\"></label>",
      "<div class=\"auth-name-grid auth-register-field\">",
      "<label>First name<input id=\"auth-first-name\" type=\"text\" autocomplete=\"given-name\" autocapitalize=\"words\"></label>",
      "<label>Last name<input id=\"auth-last-name\" type=\"text\" autocomplete=\"family-name\" autocapitalize=\"words\"></label>",
      "</div>",
      "<label>Email<input id=\"auth-email\" type=\"email\" autocomplete=\"username\" autocapitalize=\"none\" spellcheck=\"false\" required></label>",
      "<label>Password<input id=\"auth-password\" type=\"password\" autocomplete=\"off\" minlength=\"8\" data-lpignore=\"true\" data-1p-ignore=\"true\" autocapitalize=\"none\" spellcheck=\"false\" required></label>",
      "<label class=\"auth-register-field\">Confirm password<input id=\"auth-password-confirm\" type=\"password\" autocomplete=\"off\" minlength=\"8\" data-lpignore=\"true\" data-1p-ignore=\"true\" autocapitalize=\"none\" spellcheck=\"false\"></label>",
      "<label class=\"auth-check auth-register-field\"><input id=\"auth-accepted-terms\" type=\"checkbox\"><span>I understand SmartSleeve account access is for verified users and does not itself authorize broker trading.</span></label>",
      "<button type=\"submit\" id=\"auth-submit-button\">Sign in</button>",
      "<button type=\"button\" class=\"auth-link-button\" id=\"auth-reset-button\">Reset password</button>",
      "<small>Account data is served only after the private API verifies your session.</small>",
      "</form>"
    ].join("");
    document.body.appendChild(gate);
    var emailInput = $("auth-email");
    if (emailInput && principalEmail) {
      emailInput.value = principalEmail;
    }
    clearAuthPasswordFields();
    window.setTimeout(clearAuthPasswordFields, 120);
    window.setTimeout(clearAuthPasswordFields, 650);
    $("auth-gate-form").addEventListener("submit", function (event) {
      event.preventDefault();
      if ($("auth-gate-form").getAttribute("data-mode") === "register") {
        registerFromGate();
      } else {
        loginFromGate();
      }
    });
    $all("[data-auth-mode]", gate).forEach(function (button) {
      button.addEventListener("click", function () {
        setAuthMode(button.getAttribute("data-auth-mode") || "login");
      });
    });
    $("auth-reset-button").addEventListener("click", requestPasswordResetFromGate);
    wireAuthFieldFocus(gate);
  }

  function clearAuthPasswordFields() {
    ["auth-password", "auth-password-confirm"].forEach(function (id) {
      var input = $(id);
      if (input) {
        input.value = "";
        input.defaultValue = "";
        input.setAttribute("value", "");
      }
    });
  }

  function wireAuthFieldFocus(gate) {
    $all("input, button", gate).forEach(function (control) {
      if (control.tagName === "INPUT") {
        control.addEventListener("pointerdown", function () {
          window.setTimeout(function () { control.focus(); }, 0);
        });
      }
      control.addEventListener("focus", function () {
        window.setTimeout(function () {
          control.scrollIntoView({block: "center", inline: "nearest", behavior: "smooth"});
        }, 80);
      });
    });
  }

  function showAuthNotice(title, message, actionLabel, actionMode) {
    var form = $("auth-gate-form");
    if (!form) return;
    form.innerHTML = [
      "<img src=\"/brand/smartsleeve-apparel-logo-cropped.png\" alt=\"SmartSleeve\">",
      "<h2>" + html(title) + "</h2>",
      "<p>" + html(message) + "</p>",
      "<button type=\"button\" id=\"auth-notice-action\">" + html(actionLabel || "Return to sign in") + "</button>",
      "<small>Account data is served only after the private API verifies your session.</small>"
    ].join("");
    $("auth-notice-action").addEventListener("click", function () {
      removeAuthGate();
      showAuthGate();
      setAuthMode(actionMode || "login");
    });
  }

  function setAuthMode(mode) {
    var form = $("auth-gate-form");
    if (!form) return;
    var nextMode = mode === "register" ? "register" : "login";
    form.setAttribute("data-mode", nextMode);
    $all("[data-auth-mode]", form).forEach(function (button) {
      button.setAttribute("aria-selected", button.getAttribute("data-auth-mode") === nextMode ? "true" : "false");
    });
    text("auth-submit-button", nextMode === "register" ? "Create account" : "Sign in");
    text(
      "auth-gate-message",
      nextMode === "register"
        ? "Create a verified SmartSleeve account. Passwords must be at least 8 characters. We will email a verification link before private data can load."
        : "Sign in to load your private SmartSleeve data."
    );
    clearAuthPasswordFields();
  }

  function loginFromGate() {
    if (!loginEndpoint) {
      text("auth-gate-message", "SmartSleeve auth endpoint is not configured.");
      return;
    }
    var email = normalizeEmail(($("auth-email") || {}).value || "");
    var password = String(($("auth-password") || {}).value || "");
    text("auth-gate-message", "Signing in...");
    authFetch(loginEndpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({identity: email, password: password})
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "login_failed");
          }
          sessionToken = payload.session_token || sessionToken;
          principalEmail = normalizeEmail((payload.profile || {}).email || email);
          if ((payload.profile || {}).role === "developer" && requestedDeveloperView) {
            appEdition = "developer";
            accountScope = "all";
          } else {
            appEdition = "web";
            accountScope = "user";
          }
          persistStoredSession(payload.profile || {});
          removeAuthGate();
          renderSession();
          loadFeed();
        });
      })
      .catch(function (error) {
        text("auth-gate-message", "Sign in failed: " + error.message);
      });
  }

  function registerFromGate() {
    if (!registerEndpoint) {
      text("auth-gate-message", "SmartSleeve registration endpoint is not configured.");
      return;
    }
    var email = normalizeEmail(($("auth-email") || {}).value || "");
    var firstName = String(($("auth-first-name") || {}).value || "").trim();
    var lastName = String(($("auth-last-name") || {}).value || "").trim();
    var username = String(($("auth-username") || {}).value || email.split("@")[0] || "").trim();
    var password = String(($("auth-password") || {}).value || "");
    var passwordConfirm = String(($("auth-password-confirm") || {}).value || "");
    var acceptedTerms = Boolean(($("auth-accepted-terms") || {}).checked);
    text("auth-gate-message", "Creating account and preparing verification email...");
    authFetch(registerEndpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({
        username: username,
        email: email,
        first_name: firstName,
        last_name: lastName,
        password: password,
        password_confirm: passwordConfirm,
        accepted_terms: acceptedTerms
      })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok || !payload.ok) {
            var detail = payload.errors && payload.errors.length ? payload.errors.join(", ") : (payload.error || "registration_failed");
            throw new Error(detail);
          }
          showAuthNotice(
            "Check your email",
            "Your account request was submitted. We sent a verification link to " + email + ". Open that email, confirm the account, then return here to sign in.",
            "Back to sign in",
            "login"
          );
        });
      })
      .catch(function (error) {
        var message = error.message === "account_already_verified"
          ? "That email already has a verified SmartSleeve account. Sign in with the existing password or use Reset password."
          : "Account creation failed: " + error.message;
        text("auth-gate-message", message);
      });
  }

  function requestPasswordResetFromGate() {
    if (!passwordResetEndpoint) {
      text("auth-gate-message", "SmartSleeve password reset endpoint is not configured.");
      return;
    }
    var email = normalizeEmail(($("auth-email") || {}).value || "");
    if (!email) {
      text("auth-gate-message", "Enter your email, then tap Reset password.");
      return;
    }
    text("auth-gate-message", "Sending password reset email...");
    authFetch(passwordResetEndpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({identity: email})
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "password_reset_failed");
          }
          showAuthNotice(
            "Check your email",
            "If " + email + " has a SmartSleeve account, we sent a password reset link. Open it, set a new password, then return here to sign in.",
            "Back to sign in",
            "login"
          );
        });
      })
      .catch(function (error) {
        text("auth-gate-message", "Password reset failed: " + error.message);
      });
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function canonicalEmail(value) {
    var email = normalizeEmail(value);
    return email === "john@smartsleeve.ai" ? "jpsheppard88@gmail.com" : email;
  }

  var configuredAccountOwners = {
    "criselda": "criseldasarenas@gmail.com",
    "crissy": "criseldasarenas@gmail.com",
    "crissy-rh": "criseldasarenas@gmail.com",
    "crissy rh": "criseldasarenas@gmail.com",
    "crissy-robinhood": "criseldasarenas@gmail.com",
    "crissy robinhood": "criseldasarenas@gmail.com",
    "crissy-rh-account": "criseldasarenas@gmail.com",
    "criselda-rh": "criseldasarenas@gmail.com",
    "criseldasarenas": "criseldasarenas@gmail.com",
    "john": "jpsheppard88@gmail.com",
    "john-rh": "jpsheppard88@gmail.com",
    "john rh": "jpsheppard88@gmail.com",
    "john-etrade": "jpsheppard88@gmail.com",
    "john etrade": "jpsheppard88@gmail.com",
    "etrade": "jpsheppard88@gmail.com",
    "u25739525": "jpsheppard88@gmail.com",
    "u25815215": "jpsheppard88@gmail.com",
    "john-ibkr-margin": "jpsheppard88@gmail.com",
    "john-ibkr-roth": "jpsheppard88@gmail.com"
  };

  function knownUserEmailFromText(value) {
    var context = displayLabel(value, "").toLowerCase();
    if (!context) return "";
    if (
      context.indexOf("criseldasarenas") !== -1
      || context.indexOf("crissy") !== -1
      || context.indexOf("criselda") !== -1
      || /\bcrissy[\s_-]*(rh|robinhood)\b/.test(context)
      || /\b(criselda|sarenas)[\s_-]*(rh|robinhood)\b/.test(context)
    ) {
      return "criseldasarenas@gmail.com";
    }
    if (context.indexOf("jpsheppard88") !== -1 || context.indexOf("john@smartsleeve.ai") !== -1 || context.indexOf("john sheppard") !== -1 || /\bjohn[\s_-]*(rh|ibkr|etrade|e[-\s]?trade)\b/.test(context)) {
      return "jpsheppard88@gmail.com";
    }
    return "";
  }

  function knownAccountOwnerEmail(value) {
    if (!value) return "";
    if (typeof value === "object") {
      return knownAccountOwnerEmail(value.id)
        || knownAccountOwnerEmail(value.accountId)
        || knownAccountOwnerEmail(value.account_id)
        || knownAccountOwnerEmail(value.account)
        || knownAccountOwnerEmail(value.name)
        || knownAccountOwnerEmail(value.nickname)
        || knownUserEmailFromText([
          value.account,
          value.name,
          value.nickname,
          value.label,
          value.displayName,
          value.display_name,
          value.owner,
          value.user
        ].map(function (item) { return displayLabel(item, ""); }).join(" "));
    }
    var raw = displayLabel(value, "").trim().toLowerCase();
    if (!raw) return "";
    var normalized = raw.replace(/[_\s]+/g, "-");
    return configuredAccountOwners[raw] || configuredAccountOwners[normalized] || "";
  }

  function accountOwnerEmailById(value) {
    var id = String(value || "").trim();
    if (!id) return "";
    var account = (state.allAccounts || state.accounts || []).find(function (item) {
      return [
        item.id,
        item.accountId,
        item.account_id,
        item.account
      ].map(function (part) { return String(part || "").trim(); }).indexOf(id) !== -1;
    });
    return account ? rowOwnerEmail(account) : knownAccountOwnerEmail(id);
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
    if (element) {
      element.textContent = value;
    }
  }

  function numeric(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function firstNumericField(source, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (source && source[key] != null) {
        var value = numeric(source[key]);
        if (value != null) {
          return {key: key, value: value};
        }
      }
    }
    return null;
  }

  function firstTextField(source, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (source && source[key]) return String(source[key]);
    }
    return "";
  }

  function money(value) {
    var number = numeric(value);
    if (number == null) {
      return "Needs sync";
    }
    return number.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Math.abs(number) >= 1000 ? 0 : 2
    });
  }

  function numberText(value, digits) {
    var number = numeric(value);
    if (number == null) {
      return "Needs sync";
    }
    return number.toLocaleString("en-US", {maximumFractionDigits: digits == null ? 2 : digits});
  }

  function pct(value, total, digits) {
    var number = numeric(value);
    var denominator = numeric(total);
    if (number == null || !denominator) {
      return "0%";
    }
    return (number / denominator * 100).toFixed(digits == null ? 1 : digits) + "%";
  }

  function displayLabel(value, fallback) {
    if (value == null || value === "") return fallback || "";
    if (typeof value === "string" || typeof value === "number") {
      var textValue = String(value).trim();
      return textValue && textValue !== "[object Object]" ? textValue : (fallback || "");
    }
    if (Array.isArray(value)) {
      return value.map(function (item) { return displayLabel(item, ""); }).filter(Boolean).join(", ") || (fallback || "");
    }
    if (typeof value === "object") {
      var preferred = [
        value.label,
        value.name,
        value.displayName,
        value.display_name,
        value.title,
        value.accountName,
        value.account_name,
        value.sleeveLabel,
        value.sleeve_label,
        value.sleeve,
        value.sleeveName,
        value.sleeve_name,
        value.strategy,
        value.tradingSystem,
        value.trading_system,
        value.sleeveInstanceId,
        value.sleeve_instance_id,
        value.instanceId,
        value.instance_id,
        value.symbol,
        value.ticker,
        value.id
      ];
      for (var i = 0; i < preferred.length; i += 1) {
        var label = displayLabel(preferred[i], "");
        if (label) return label;
      }
      var shallow = Object.keys(value).slice(0, 8).map(function (key) {
        var item = value[key];
        if (item && typeof item === "object") return "";
        return displayLabel(item, "");
      }).filter(function (item) { return item && !isOperationalNoiseLabel(item); });
      return shallow.join(" / ") || (fallback || "");
    }
    return fallback || "";
  }

  function isOperationalNoiseLabel(value) {
    var label = String(value || "").trim().toLowerCase();
    if (!label) return true;
    if (/^(0|off|hibernate|hibernating|paused|inactive|unknown|false|none|null|nan)(\s*\/\s*(0|off|hibernate|hibernating|paused|inactive|unknown|false|none|null|nan))*$/.test(label)) {
      return true;
    }
    return false;
  }

  function sleeveLabel(value, fallback) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      var explicit = [
        value.label,
        value.name,
        value.displayName,
        value.display_name,
        value.title,
        value.sleeveLabel,
        value.sleeve_label,
        value.sleeve,
        value.sleeveName,
        value.sleeve_name,
        value.tradingSystem,
        value.trading_system,
        value.strategy,
        value.sleeveInstanceId,
        value.sleeve_instance_id,
        value.instanceId,
        value.instance_id
      ];
      for (var i = 0; i < explicit.length; i += 1) {
        var explicitLabel = displayLabel(explicit[i], "");
        if (explicitLabel && !isOperationalNoiseLabel(explicitLabel)) {
          return sleeveLabel(explicitLabel, fallback);
        }
      }
    }
    var label = displayLabel(value, fallback || "Ledger coverage gap");
    if (isOperationalNoiseLabel(label)) {
      return fallback || "";
    }
    if (/^unassigned$/i.test(label) && value && typeof value === "object") {
      var context = [
        value.sleeve,
        value.sleeveName,
        value.sleeve_name,
        value.strategy,
        value.tradingSystem,
        value.trading_system,
        value.operator,
        value.operatorId,
        value.operator_id
      ].map(function (item) { return displayLabel(item, ""); }).join(" ").toLowerCase();
      if (context.indexOf("sage") !== -1 || context.indexOf("smart") !== -1) {
        return "Sage by SmartSleeve";
      }
    }
    if (/^(sage|smart sleeve|smartsleeve|sage by smartsleeve)$/i.test(label)) {
      return "Sage by SmartSleeve";
    }
    return label === "Hyper Savage" ? "Covered Sage" : label;
  }

  function accountDefaultSleeveName(account) {
    var context = [
      account.sleeve,
      account.sleeveName,
      account.sleeve_name,
      account.strategy,
      account.tradingSystem,
      account.trading_system,
      account.operator,
      account.operatorId,
      account.operator_id,
      account.account,
      account.id,
      account.accountId,
      account.account_id
    ].map(function (item) { return displayLabel(item, ""); }).join(" ").toLowerCase();
    return context.indexOf("sage") !== -1 ? "Sage by SmartSleeve" : "Ledger coverage gap";
  }

  function splitSleeves(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return sleeveLabel(item, "");
      }).filter(Boolean);
    }
    if (value && typeof value === "object") {
      return [sleeveLabel(value, "")].filter(Boolean);
    }
    return String(value || "")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(function (item) { return item && item !== "[object Object]" && !isOperationalNoiseLabel(item); })
      .map(function (item) { return item === "Hyper Savage" ? "Covered Sage" : item; });
  }

  function inferAccountOwnerEmail(account) {
    var configuredOwner = knownAccountOwnerEmail(account.id)
      || knownAccountOwnerEmail(account.accountId)
      || knownAccountOwnerEmail(account.account_id)
      || knownAccountOwnerEmail(account.account)
      || knownAccountOwnerEmail(account.name)
      || knownAccountOwnerEmail(account.nickname);
    if (configuredOwner) return configuredOwner;
    var context = [
      account.ownerEmail,
      account.owner_email,
      account.userEmail,
      account.user_email,
      account.principalEmail,
      account.principal_email,
      account.accountOwnerEmail,
      account.account_owner_email,
      account.owner,
      account.ownerName,
      account.owner_name,
      account.user,
      account.userName,
      account.user_name,
      account.household,
      account.customer,
      account.displayOwner,
      account.display_owner,
      account.account,
      account.name,
      account.id,
      account.accountId,
      account.account_id,
      account.nickname,
      account.label
    ].map(function (item) { return displayLabel(item, ""); }).join(" ");
    return knownAccountOwnerEmail(context) || knownUserEmailFromText(context);
  }

  function rowOwnerEmail(row) {
    if (!row) return "";
    var configuredOwner = knownAccountOwnerEmail(row.id)
      || knownAccountOwnerEmail(row.accountId)
      || knownAccountOwnerEmail(row.account_id)
      || knownAccountOwnerEmail(row.account)
      || knownAccountOwnerEmail(row.name)
      || knownAccountOwnerEmail(row.nickname);
    if (configuredOwner) return canonicalEmail(configuredOwner);
    return canonicalEmail(
      row.ownerEmail
        || row.owner_email
        || row.userEmail
        || row.user_email
        || row.principalEmail
        || row.principal_email
        || row.email
        || knownAccountOwnerEmail(row)
        || accountOwnerEmailById(row.accountId || row.account_id || row.account)
        || inferAccountOwnerEmail(row)
    );
  }

  function rowBelongsToAnotherKnownUser(row) {
    var owner = rowOwnerEmail(row);
    var principal = canonicalEmail(principalEmail);
    if (!owner || !principal) return false;
    return owner !== principal && (
      owner === "jpsheppard88@gmail.com"
        || owner === "criseldasarenas@gmail.com"
        || principal === "jpsheppard88@gmail.com"
        || principal === "criseldasarenas@gmail.com"
    );
  }

  function normalizeAccount(account) {
    var positions = (account.positions || []).map(function (position) {
      var priceField = firstNumericField(position, [
        "currentPrice",
        "current_price",
        "markPrice",
        "mark_price",
        "lastPrice",
        "last_price",
        "lastTradePrice",
        "last_trade_price",
        "quotePrice",
        "quote_price",
        "marketPrice",
        "market_price",
        "price"
      ]);
      var shares = numeric(position.shares != null ? position.shares : position.quantity);
      var value = numeric(position.value != null ? position.value : position.market_value_usd);
      var impliedPrice = shares && value != null ? value / shares : null;
      var explicitPriceSource = position.priceSource || position.price_source;
      return {
        symbol: String(position.symbol || "").toUpperCase(),
        name: position.name || tickerNames[String(position.symbol || "").toUpperCase()],
        shares: shares,
        price: priceField ? priceField.value : impliedPrice,
        impliedPrice: impliedPrice,
        priceSource: explicitPriceSource || (priceField ? priceField.key : "value_per_share"),
        priceAsOf: firstTextField(position, ["priceAsOf", "price_as_of", "quoteAsOf", "quote_as_of", "marketDataAt", "market_data_at", "updatedAt", "updated_at", "timestamp"]),
        quotePrice: numeric(position.quotePrice != null ? position.quotePrice : position.quote_price),
        quoteAsOf: position.quoteAsOf || position.quote_as_of,
        quoteSource: position.quoteSource || position.quote_source,
        value: value,
        averageCost: numeric(position.averageCost != null ? position.averageCost : position.average_cost),
        costBasis: numeric(position.costBasis != null ? position.costBasis : position.cost_basis),
        dailyPnl: numeric(position.dailyPnl != null ? position.dailyPnl : position.daily_pnl),
        unrealizedPnl: numeric(position.unrealizedPnl != null ? position.unrealizedPnl : position.unrealized_pnl),
        realizedPnl: numeric(position.realizedPnl != null ? position.realizedPnl : position.realized_pnl),
        totalPnl: numeric(position.totalPnl != null ? position.totalPnl : position.total_pnl),
        currency: position.currency || "USD"
      };
    });
    var brokerName = account.broker || "Broker";
    var brokerEquity = numeric(account.brokerEquity != null ? account.brokerEquity : account.broker_equity);
    var equity = numeric(account.equity != null ? account.equity : account.account_equity);
    var cash = numeric(account.cash);
    var buyPower = numeric(account.buyPower != null ? account.buyPower : account.cash_available_for_buys);
    var positionValue = positions.reduce(function (sum, position) {
      return sum + (numeric(position.value) || 0);
    }, 0);
    var equitySource = "broker";
    if (brokerEquity != null && Math.abs(brokerEquity) >= 0.005 && (equity == null || Math.abs(brokerEquity - equity) > Math.max(100, Math.abs(brokerEquity) * 0.01))) {
      equity = brokerEquity;
      equitySource = "broker_equity";
    }
    if ((equity == null || equity === 0) && positionValue > 0 && /e[-*\s]?trade/i.test(brokerName)) {
      equity = positionValue + (cash || 0);
      equitySource = "positions_plus_cash_estimate";
    }
    return {
      id: account.id || account.accountId || account.account_id || account.account,
      account: displayLabel(account.account || account.name || account.id, "Account"),
      ownerEmail: rowOwnerEmail(account),
      developerEmail: account.developerEmail || account.developer_email,
      broker: brokerName,
      status: account.status || "synced",
      generatedAt: account.generatedAt || account.generated_at,
      latestGeneratedAt: account.latestGeneratedAt || account.latest_generated_at,
      portfolioSource: account.portfolioSource || account.portfolio_source,
      sourceAgeMinutes: numeric(account.sourceAgeMinutes != null ? account.sourceAgeMinutes : account.source_age_minutes),
      sourceIsStale: Boolean(account.sourceIsStale || account.source_is_stale),
      sourceFreshness: account.sourceFreshness || account.source_freshness,
      sourceFreshnessLabel: account.sourceFreshnessLabel || account.source_freshness_label,
      brokerEquity: brokerEquity,
      strategy: account.strategy,
      tradingSystem: account.tradingSystem || account.trading_system,
      operator: account.operator,
      operatorId: account.operatorId || account.operator_id,
      equity: equity,
      equitySource: equitySource,
      cash: cash,
      buyPower: buyPower,
      positions: positions,
      sleeves: account.sleeves || [],
      sleevesText: displayLabel(account.sleevesText || account.sleeves_text || "", "")
    };
  }

  function visibleRows(rows) {
    if (accountScope === "all" || appEdition === "developer") {
      return rows.slice();
    }
    if (!principalEmail) {
      return [];
    }
    return rows.filter(function (row) {
      if (row && isLocalFallbackReport(row)) {
        return true;
      }
      if (rowHasConflictingOwner(row)) {
        return false;
      }
      var audience = row.audienceEmails || row.audience_emails || [];
      if (typeof audience === "string") {
        audience = audience.split(/[,\s]+/);
      }
      if (rowBelongsToAnotherKnownUser(row)) {
        return false;
      }
      var ownerEmail = rowOwnerEmail(row);
      var principal = canonicalEmail(principalEmail);
      return ownerEmail === principal
        || (Array.isArray(audience) ? audience.map(canonicalEmail).indexOf(principal) !== -1 : false);
    });
  }

  function visibleAccountRows(rows) {
    if (accountScope === "all" || appEdition === "developer") {
      return rows.slice();
    }
    if (!principalEmail) {
      return [];
    }
    return rows.filter(function (row) {
      if (rowHasConflictingOwner(row)) {
        return false;
      }
      return rowOwnerEmail(row) === canonicalEmail(principalEmail);
    });
  }

  function rowHasConflictingOwner(row) {
    return rowBelongsToAnotherKnownUser(row);
  }

  function developerFilteredAccounts(accounts) {
    if (appEdition !== "developer") {
      return accounts;
    }
    return accounts.filter(function (account) {
      var owner = rowOwnerEmail(account);
      var accountId = String(account.id || account.accountId || account.account_id || "");
      return (state.selectedOwnerEmail === "all" || owner === state.selectedOwnerEmail)
        && (state.selectedAccountId === "all" || accountId === state.selectedAccountId);
    });
  }

  function developerVisibleRows(rows) {
    if (appEdition !== "developer") {
      return rows;
    }
    return rows.filter(function (row) {
      var owner = rowOwnerEmail(row);
      var accountId = String(row.accountId || row.account_id || row.id || "");
      return (state.selectedOwnerEmail === "all" || owner === state.selectedOwnerEmail)
        && (state.selectedAccountId === "all" || accountId === state.selectedAccountId);
    });
  }

  function visibleAccountIdSet(accounts) {
    var ids = {};
    (accounts || []).forEach(function (account) {
      [
        account.id,
        account.accountId,
        account.account_id,
        account.account
      ].forEach(function (value) {
        var key = String(value || "").trim();
        if (key) ids[key] = true;
      });
    });
    return ids;
  }

  function rowAccountId(row) {
    return String(row && (row.accountId || row.account_id || row.id || row.account || "") || "").trim();
  }

  function scopedRowsForVisibleAccounts(rows, visibleIds) {
    return visibleRows(rows || []).filter(function (row) {
      if (row && isLocalFallbackReport(row)) {
        return true;
      }
      if (rowHasConflictingOwner(row)) {
        return false;
      }
      var accountId = rowAccountId(row);
      return !accountId || Boolean(visibleIds[accountId]);
    });
  }

  function accountOwnerLabel(email) {
    var normalized = normalizeEmail(email);
    if (normalized === "jpsheppard88@gmail.com" || normalized === "john@smartsleeve.ai") return "John";
    if (normalized === "criseldasarenas@gmail.com") return "Crissy";
    return normalized || "Unassigned";
  }

  function accountTotal(key) {
    return state.accounts.reduce(function (sum, account) {
      return sum + (numeric(account[key]) || 0);
    }, 0);
  }

  function nullableSum(rows, key) {
    var found = false;
    var sum = rows.reduce(function (total, row) {
      var value = numeric(row[key]);
      if (value == null) return total;
      found = true;
      return total + value;
    }, 0);
    return found ? sum : null;
  }

  function signedMoney(value, missingText) {
    var number = numeric(value);
    if (number == null) {
      return missingText || "Needs sync";
    }
    if (Math.abs(number) < 0.005) {
      return "$0.00";
    }
    return (number > 0 ? "+" : "-") + money(Math.abs(number));
  }

  function valueClass(value) {
    var number = numeric(value);
    if (number == null) return "needs-sync";
    if (number > 0.004) return "positive";
    if (number < -0.004) return "negative";
    return "neutral";
  }

  function signedPercent(value) {
    var number = numeric(value);
    if (number == null) return "0.00%";
    if (Math.abs(number) < 0.005) return "0.00%";
    return (number > 0 ? "+" : "-") + Math.abs(number).toFixed(2) + "%";
  }

  function setMetric(id, value, formatter, missingText) {
    var element = $(id);
    if (!element) return;
    var number = numeric(value);
    element.classList.remove("positive", "negative", "neutral", "needs-sync");
    element.classList.add(valueClass(number));
    element.textContent = number == null ? (missingText || "Needs sync") : formatter(number);
  }

  function marginUsed() {
    return state.accounts.reduce(function (sum, account) {
      var cash = numeric(account.cash) || 0;
      return sum + (cash < 0 ? Math.abs(cash) : 0);
    }, 0);
  }

  function aggregateHoldings(accounts) {
    var grouped = {};
    var foreign = [];
    accounts.forEach(function (account) {
      account.positions.forEach(function (position) {
        var value = numeric(position.value) || 0;
        var shares = numeric(position.shares) || 0;
        var price = numeric(position.price) || 0;
        var symbol = String(position.symbol || "").toUpperCase();
        if (!symbol) {
          return;
        }
        if ((position.currency || "USD") !== "USD") {
          foreign.push(Object.assign({account: account.account}, position));
          return;
        }
        if (!grouped[symbol]) {
          grouped[symbol] = {
            symbol: symbol,
            name: position.name || tickerNames[symbol] || symbol,
            shares: 0,
            value: 0,
            priceValue: 0,
            costBasis: null,
            costShares: 0,
            quotePriceValue: 0,
            quoteShares: 0,
            impliedPrice: null,
            priceSource: "",
            priceAsOf: "",
            priceDivergencePct: null,
            dailyPnl: null,
            unrealizedPnl: null,
            realizedPnl: null,
            totalPnl: null,
            accounts: [],
            sleeves: []
          };
        }
        grouped[symbol].shares += shares;
        grouped[symbol].value += value;
        grouped[symbol].priceValue += price * shares;
        if (numeric(position.price) != null && shares) {
          grouped[symbol].quotePriceValue += numeric(position.price) * shares;
          grouped[symbol].quoteShares += shares;
          grouped[symbol].priceSource = grouped[symbol].priceSource || position.priceSource || "quote";
        }
        if (position.priceAsOf && (!grouped[symbol].priceAsOf || new Date(position.priceAsOf) > new Date(grouped[symbol].priceAsOf))) {
          grouped[symbol].priceAsOf = position.priceAsOf;
        }
        var averageCost = numeric(position.averageCost);
        var costBasis = numeric(position.costBasis);
        if (costBasis == null && averageCost != null && shares) {
          costBasis = averageCost * shares;
        }
        if (costBasis != null) {
          grouped[symbol].costBasis = (grouped[symbol].costBasis || 0) + costBasis;
          grouped[symbol].costShares += shares;
        }
        ["dailyPnl", "unrealizedPnl", "realizedPnl", "totalPnl"].forEach(function (key) {
          var pnl = numeric(position[key]);
          if (pnl != null) {
            grouped[symbol][key] = (grouped[symbol][key] || 0) + pnl;
          }
        });
        if (grouped[symbol].accounts.indexOf(account.account) === -1) {
          grouped[symbol].accounts.push(account.account);
        }
        splitSleeves(account.sleeves.length ? account.sleeves : account.sleevesText).forEach(function (sleeve) {
          if (grouped[symbol].sleeves.indexOf(sleeve) === -1) {
            grouped[symbol].sleeves.push(sleeve);
          }
        });
      });
    });
    var holdings = Object.keys(grouped).map(function (symbol) {
      var row = grouped[symbol];
      row.impliedPrice = row.shares && row.value ? row.value / row.shares : null;
      row.price = row.quoteShares ? row.quotePriceValue / row.quoteShares : row.impliedPrice;
      if (row.price != null && row.impliedPrice != null && row.impliedPrice > 0) {
        row.priceDivergencePct = Math.abs(row.price - row.impliedPrice) / row.impliedPrice * 100;
      }
      row.avgPrice = row.price;
      row.averageCost = row.costBasis != null && row.costShares ? row.costBasis / row.costShares : null;
      return row;
    }).sort(function (a, b) { return b.value - a.value; });
    return {holdings: holdings, foreign: foreign};
  }

  function buildSleeves(accounts) {
    var bySleeve = {};
    accounts.forEach(function (account) {
      var liveSleeves = Array.isArray(account.sleeves) ? account.sleeves : [];
      if (liveSleeves.length) {
        var foundLiveSleeve = false;
        liveSleeves.forEach(function (sleeve) {
          var name = sleeveLabel(sleeve, "");
          if (!name) return;
          foundLiveSleeve = true;
          ensureSleeve(bySleeve, name, account.account);
          var sleeveValues = resolvedSleeveValues(sleeve, account);
          bySleeve[name].exactValue += sleeveValues.net;
          bySleeve[name].cash += sleeveValues.cash;
          bySleeve[name].positionValue += sleeveValues.positionValue;
          if (sleeveValues.derived) bySleeve[name].ledgerPending = true;
          bySleeve[name].lastReconciledAt = sleeve.lastReconciledAt || sleeve.last_reconciled_at || bySleeve[name].lastReconciledAt;
          bySleeve[name].operatingMode = sleeve.operatingMode || sleeve.operating_mode || bySleeve[name].operatingMode;
          (sleeve.holdings || []).forEach(function (holding) {
            var symbol = String(holding.symbol || "").toUpperCase();
            if (symbol && bySleeve[name].holdings.indexOf(symbol) === -1) {
              bySleeve[name].holdings.push(symbol);
            }
          });
        });
        if (foundLiveSleeve) return;
      }
      var names = splitSleeves(account.sleevesText || account.sleeves);
      if (!names.length) {
        names = [accountDefaultSleeveName(account)];
      }
      names.forEach(function (name) {
        ensureSleeve(bySleeve, name, account.account);
        if (names.length === 1) {
          bySleeve[name].exactValue += numeric(account.equity) || 0;
        } else {
          bySleeve[name].ledgerPending = true;
        }
        account.positions.forEach(function (position) {
          var symbol = String(position.symbol || "").toUpperCase();
          if (symbol && bySleeve[name].holdings.indexOf(symbol) === -1) {
            bySleeve[name].holdings.push(symbol);
          }
        });
      });
    });
    return Object.keys(bySleeve).map(function (name) {
      return bySleeve[name];
    }).filter(function (sleeve) {
      return !isOperationalNoiseLabel(sleeve.name)
        && ((numeric(sleeve.exactValue) || 0) > 0
          || (numeric(sleeve.cash) || 0) > 0
          || (numeric(sleeve.positionValue) || 0) > 0
          || (sleeve.holdings || []).length > 0
          || sleeve.lastReconciledAt);
    }).sort(function (a, b) {
      return (b.exactValue || 0) - (a.exactValue || 0) || a.name.localeCompare(b.name);
    });
  }

  function resolvedSleeveValues(sleeve, account) {
    var cash = numeric(sleeve.cashUsd != null ? sleeve.cashUsd : sleeve.cash_usd);
    var positionValue = numeric(sleeve.positionValueUsd != null ? sleeve.positionValueUsd : sleeve.position_value_usd);
    var net = numeric(sleeve.netLiquidationUsd != null ? sleeve.netLiquidationUsd : sleeve.net_liquidation_usd);
    var ledgerCash = numeric(sleeve.ledgerCashUsd != null ? sleeve.ledgerCashUsd : sleeve.ledger_cash_usd);
    var ledgerPosition = numeric(sleeve.ledgerPositionValueUsd != null ? sleeve.ledgerPositionValueUsd : sleeve.ledger_position_value_usd);
    var ledgerNet = numeric(sleeve.ledgerNetLiquidationUsd != null ? sleeve.ledgerNetLiquidationUsd : sleeve.ledger_net_liquidation_usd);
    var derived = false;
    if ((cash == null || Math.abs(cash) < 0.005) && ledgerCash != null && Math.abs(ledgerCash) >= 0.005) {
      cash = ledgerCash;
      derived = true;
    }
    if ((positionValue == null || Math.abs(positionValue) < 0.005) && ledgerPosition != null && Math.abs(ledgerPosition) >= 0.005) {
      positionValue = ledgerPosition;
      derived = true;
    }
    if ((net == null || Math.abs(net) < 0.005) && ledgerNet != null && Math.abs(ledgerNet) >= 0.005) {
      net = ledgerNet;
      derived = true;
    }
    var holdingEstimate = sleeveHoldingMarketValue(sleeve, account);
    if ((positionValue == null || Math.abs(positionValue) < 0.005) && Math.abs(holdingEstimate.positionValue) >= 0.005) {
      positionValue = holdingEstimate.positionValue;
      derived = true;
    }
    if ((cash == null || Math.abs(cash) < 0.005) && Math.abs(holdingEstimate.cash) >= 0.005) {
      cash = holdingEstimate.cash;
      derived = true;
    }
    if ((net == null || Math.abs(net) < 0.005) && (Math.abs(positionValue || 0) >= 0.005 || Math.abs(cash || 0) >= 0.005)) {
      net = (positionValue || 0) + (cash || 0);
      derived = true;
    }
    return {
      cash: cash || 0,
      positionValue: positionValue || 0,
      net: net || 0,
      derived: derived
    };
  }

  function sleeveHoldingMarketValue(sleeve, account) {
    var bySymbol = {};
    (account.positions || []).forEach(function (position) {
      var symbol = String(position.symbol || "").toUpperCase();
      var shares = numeric(position.shares);
      var value = numeric(position.value);
      if (symbol && shares && value != null) {
        bySymbol[symbol] = value / shares;
      }
    });
    var positionValue = 0;
    var cash = 0;
    (sleeve.holdings || []).forEach(function (holding) {
      var symbol = String(holding.symbol || "").toUpperCase();
      var shares = numeric(holding.shares);
      if (!symbol || shares == null) return;
      if (symbol === "CASH") {
        cash += shares;
      } else if (bySymbol[symbol] != null) {
        positionValue += shares * bySymbol[symbol];
      }
    });
    return {positionValue: positionValue, cash: cash};
  }

  function sleeveHasCurrentOwnership(sleeve) {
    if (!sleeve || typeof sleeve !== "object") return false;
    var directValue = [
      sleeve.cashUsd,
      sleeve.cash_usd,
      sleeve.positionValueUsd,
      sleeve.position_value_usd,
      sleeve.netLiquidationUsd,
      sleeve.net_liquidation_usd
    ].some(function (value) { return Math.abs(numeric(value) || 0) >= 0.005; });
    if (directValue) return true;
    var positionValues = sleeve.positionValues || sleeve.position_values || {};
    if (positionValues && typeof positionValues === "object" && Object.keys(positionValues).some(function (symbol) {
      return Math.abs(numeric(positionValues[symbol]) || 0) >= 0.005;
    })) return true;
    var positionQuantities = sleeve.positionQuantities || sleeve.position_quantities || {};
    if (positionQuantities && typeof positionQuantities === "object" && Object.keys(positionQuantities).some(function (symbol) {
      return Math.abs(numeric(positionQuantities[symbol]) || 0) >= 0.000001;
    })) return true;
    return (sleeve.holdings || []).some(function (holding) {
      return holding && holding.source === "current_position" && Math.abs(numeric(holding.shares) || 0) >= 0.000001;
    });
  }

  function ensureSleeve(map, name, accountName) {
    name = sleeveLabel(name, "Ledger coverage gap");
    if (!map[name]) {
      map[name] = {
        name: name,
        accounts: [],
        exactValue: 0,
        cash: 0,
        positionValue: 0,
        ledgerPending: false,
        holdings: [],
        target: sleeveTargets[name] || 0,
        operatingMode: "unknown",
        lastReconciledAt: null
      };
    }
    if (map[name].accounts.indexOf(accountName) === -1) {
      map[name].accounts.push(accountName);
    }
  }

  function thesisStatus(symbol, weight) {
    if (symbol === "MU" || symbol === "SNDK" || symbol === "000660") {
      return weight > 0.15 ? "Core semiconductor, concentration review" : "Core semiconductor exposure";
    }
    if (symbol === "NBIS") {
      return "AI infrastructure, high volatility watch";
    }
    if (symbol === "ALAB" || symbol === "CRDO") {
      return "AI/semiconductor infrastructure sleeve";
    }
    if (symbol === "IONQ" || symbol === "QBTS" || symbol === "RGTI") {
      return "Quantum speculation sleeve";
    }
    if (symbol === "SOXL") {
      return "Levered semiconductor exposure, size tightly";
    }
    return "Needs thesis note";
  }

  function isSageLabel(value) {
    return String(value || "").toLowerCase().indexOf("sage") !== -1 || String(value || "").toLowerCase().indexOf("custom_sage") !== -1;
  }

  function holdingHasSage(holding) {
    return (holding.sleeves || []).some(isSageLabel);
  }

  function tradeHasSage(trade) {
    return [trade.origin, trade.operatorId, trade.operator_id, trade.tradingSystem, trade.trading_system, trade.sleeve, trade.sleeveId].some(isSageLabel);
  }

  function isAutoGuardTrade(trade) {
    return [trade.autoGuardMode, trade.auto_guard_mode, trade.operatorId, trade.operator_id, trade.workflow, trade.strategy].some(function (value) {
      return String(value || "").toLowerCase().indexOf("autoguard") !== -1;
    });
  }

  function isSmartTrade(trade) {
    var workflow = String(trade.workflow || trade.strategy || "").toLowerCase();
    var smartTrade = trade.smartTrade || trade.smart_trade || {};
    return Boolean(smartTrade.enabled)
      || workflow.indexOf("smarttrade") !== -1
      || workflow.indexOf("reallocation") !== -1
      || workflow.indexOf("open") !== -1
      || workflow.indexOf("close") !== -1
      || Boolean(trade.targetSymbol || trade.target_symbol);
  }

  function logoImg(src, label, className) {
    return "<img class=\"" + html(className || "mini-logo") + "\" src=\"" + html(src) + "\" alt=\"" + html(label) + "\">";
  }

  function sageBadge() {
    return logoImg("/app/sage-logo.png", "Sage by SmartSleeve", "mini-logo sage-mini-logo");
  }

  function featureBadges(trade) {
    var badges = [];
    if (tradeHasSage(trade)) badges.push(sageBadge());
    if (isAutoGuardTrade(trade)) badges.push(logoImg("/app/autoguard-logo.svg", "AutoGuard", "mini-logo feature-mini-logo"));
    if (isSmartTrade(trade)) badges.push(logoImg("/app/smarttrade-logo.svg", "SmartTrade", "mini-logo feature-mini-logo"));
    return badges.length ? "<span class=\"feature-badges\">" + badges.join("") + "</span>" : "";
  }

  function userDirectedBadge() {
    return logoImg("/app/user-trade-logo.svg", "User-directed order", "mini-logo user-mini-logo");
  }

  function isSageDirectedOrder(order) {
    return [order.origin, order.operatorId, order.operator_id, order.operator, order.tradingSystem, order.trading_system, order.sourceLabel].some(isSageLabel);
  }

  function isUserDirectedOrder(order) {
    var values = [order.origin, order.operatorId, order.operator_id, order.operator, order.originator, order.sourceLabel].join(" ").toLowerCase();
    if (isSageDirectedOrder(order)) return false;
    return values.indexOf("user_directed") !== -1
      || values.indexOf("user-directed") !== -1
      || values.indexOf("manual") !== -1
      || values.indexOf("human") !== -1;
  }

  function originLabel(order) {
    if (isSageDirectedOrder(order)) return "Sage by SmartSleeve";
    if (isUserDirectedOrder(order)) return "User-directed";
    return order.origin || order.operatorId || order.operator_id || order.operator || "SmartSleeve";
  }

  function originBadges(order) {
    var badges = [];
    if (isUserDirectedOrder(order)) badges.push(userDirectedBadge());
    if (tradeHasSage(order)) badges.push(sageBadge());
    if (isAutoGuardTrade(order)) badges.push(logoImg("/app/autoguard-logo.svg", "AutoGuard", "mini-logo feature-mini-logo"));
    if (isSmartTrade(order)) badges.push(logoImg("/app/smarttrade-logo.svg", "SmartTrade", "mini-logo feature-mini-logo"));
    return badges.length ? "<span class=\"feature-badges\">" + badges.join("") + "</span>" : "";
  }

  function notificationIconForOrder(order) {
    if (tradeHasSage(order)) return "/app/sage-logo.png";
    if (isUserDirectedOrder(order)) return "/app/user-trade-logo.svg";
    return "/favicon-32x32.png";
  }

  function orderNotificationKey(order) {
    return orderLifecycleId(order) + "|" + orderStatusLabel(order);
  }

  function orderNotificationTitle(order, verb) {
    var actor = originLabel(order);
    var titleVerb = verb || orderStatusLabel(order);
    return actor + " order " + titleVerb;
  }

  function orderNotificationBody(order) {
    var symbol = String(order.symbol || order.ticker || "?").split(" ")[0].toUpperCase();
    var account = order.account || order.accountId || "Account";
    var side = orderTypeLabel(order);
    var value = money(orderNotional(order));
    var status = orderStatusLabel(order);
    return symbol + " / " + side + " / " + value + " / " + account + " / " + status;
  }

  function sendOrderNotification(order, verb) {
    var title = orderNotificationTitle(order, verb);
    var body = orderNotificationBody(order);
    var icon = notificationIconForOrder(order);
    toast(title + ": " + body);
    if (window.SmartSleeveNative && typeof window.SmartSleeveNative.notify === "function") {
      try {
        window.SmartSleeveNative.notify(title, body, icon);
        return;
      } catch (_bridgeErr) {
        // Fall through to browser notifications when the native bridge is not ready.
      }
    }
    if (!("Notification" in window)) return;
    var options = {
      body: body,
      icon: icon,
      badge: "/favicon-32x32.png",
      tag: orderNotificationKey(order),
      renotify: true
    };
    if (Notification.permission === "granted") {
      try { new Notification(title, options); } catch (_err) {}
      return;
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().then(function (permission) {
        if (permission === "granted") {
          try { new Notification(title, options); } catch (_err) {}
        }
      });
    }
  }

  function restoreOrderNotificationSeen() {
    try {
      state.orderNotificationSeen = JSON.parse(window.localStorage.getItem("smartsleeve_order_notification_seen") || "{}") || {};
    } catch (_err) {
      state.orderNotificationSeen = {};
    }
  }

  function persistOrderNotificationSeen() {
    try {
      var entries = Object.keys(state.orderNotificationSeen).slice(-300).reduce(function (acc, key) {
        acc[key] = state.orderNotificationSeen[key];
        return acc;
      }, {});
      state.orderNotificationSeen = entries;
      window.localStorage.setItem("smartsleeve_order_notification_seen", JSON.stringify(entries));
    } catch (_err) {
      // localStorage can be unavailable in locked-down webviews.
    }
  }

  function notifyOrderFeedChanges(rows) {
    var orders = (rows || []).map(function (trade) {
      return Object.assign({}, trade, {lifecycleSource: "server", sourceLabel: "Broker/analytics feed"});
    });
    if (!state.orderNotificationPrimed) {
      orders.forEach(function (order) {
        state.orderNotificationSeen[orderNotificationKey(order)] = Date.now();
      });
      state.orderNotificationPrimed = true;
      persistOrderNotificationSeen();
      return;
    }
    orders.slice(0, 25).forEach(function (order) {
      var key = orderNotificationKey(order);
      if (state.orderNotificationSeen[key]) return;
      var status = String(orderStatusLabel(order)).toLowerCase();
      var verb = status.indexOf("fill") !== -1 || status.indexOf("execut") !== -1 || status.indexOf("complete") !== -1
        ? "executed"
        : status.indexOf("cancel") !== -1
          ? "canceled"
          : "placed";
      state.orderNotificationSeen[key] = Date.now();
      sendOrderNotification(order, verb);
    });
    persistOrderNotificationSeen();
  }

  function scheduleFeedRefresh() {
    if (state.feedRefreshTimer || !appFeedEndpoint) return;
    state.feedRefreshTimer = window.setInterval(function () {
      if (!$("auth-gate")) loadFeed({silent: true});
    }, 60000);
  }

  function buildRecommendations() {
    var total = accountTotal("equity");
    var bySymbol = {};
    state.holdings.forEach(function (holding) { bySymbol[holding.symbol] = holding; });
    var mu = bySymbol.MU ? bySymbol.MU.value : 0;
    var sndk = bySymbol.SNDK ? bySymbol.SNDK.value : 0;
    var top = state.holdings[0];
    var recs = [];
    if (mu + sndk > total * 0.35) {
      recs.push(recommendation("semi-concentration", "Review MU/SNDK concentration", "Rebalance", "Cross-account", "MU, SNDK", Math.max(0, (mu + sndk) - total * 0.35), "MU and SNDK are a large share of tracked equity. Confirm the target or draft a rebalance.", "A 10% combined move in MU/SNDK would visibly move portfolio value.", "SAGE_RECOMMEND"));
    }
    if (top && top.value > total * 0.2) {
      recs.push(recommendation("single-name", "Check largest single-name risk", "Trim", top.accounts.join(", "), top.symbol, Math.max(0, top.value - total * 0.18), top.symbol + " is the largest visible position.", "Single-name drawdown can dominate daily P/L.", "SAGE_RECOMMEND"));
    }
    if (state.sleeves.some(function (sleeve) { return sleeve.ledgerPending; })) {
      recs.push(recommendation("sleeve-ledger", "Sync sleeve ledger splits", "Assign", "Multi-sleeve accounts", "Ledger", 0, "Exact sleeve P/L needs lot-level sleeve ownership.", "Without this, sleeve return and alpha are account-level estimates.", "SQTS_REBALANCE"));
    }
    if (marginUsed() > 0) {
      recs.push(recommendation("margin-cash", "Review margin buffer before adding risk", "Check margin", state.accounts.filter(function (account) { return (numeric(account.cash) || 0) < 0; }).map(function (account) { return account.account; }).join(", "), "Margin", marginUsed(), "At least one margin account is using broker credit rather than cash.", "Thin margin buffer can force less patient execution during volatility.", "SQTS_RISK_EXIT"));
    }
    if (state.accounts.some(function (account) { return account.equitySource === "positions_plus_cash_estimate"; })) {
      recs.push(recommendation("etrade-value-sync", "Verify E-Trade account value export", "Broker sync", "E-Trade", "Value", 0, "E-Trade reported zero account value while positions or cash implied a positive balance.", "Buying power can be zero even when account equity is positive; UI is using a positions-plus-cash estimate until the broker export is corrected.", "EXTERNAL_BROKER_SYNC"));
    }
    recs.push(recommendation("broker-pl", "Enable intraday P/L and cost basis sync", "Broker sync", "All connected brokers", "P/L", 0, "Holdings are visible; daily P/L, total P/L, and return need broker basis/history.", "Without live P/L, contributors and detractors remain unavailable.", "SQTS_AUTO"));
    return recs;
  }

  function recommendation(id, title, action, account, ticker, notional, reason, risk, operator) {
    return {id: id, title: title, action: action, account: account, ticker: ticker, notional: Math.round(notional || 0), reason: reason, risk: risk, operator: operator};
  }

  function renderSession() {
    text("edition-label", appEdition === "developer" ? "Developer Edition" : "SmartSleeve");
    text("session-title", appEdition === "developer" ? "All-account dashboard" : (principalEmail || "Verified user"));
    text("session-detail", appEdition === "developer" ? "Cross-account diagnostics and operator tools." : "User-scoped accounts only.");
    text("portfolio-value-label", appEdition === "developer" ? "All tracked account value" : "Your tracked account value");
  }

  function renderDashboard() {
    var total = accountTotal("equity");
    var dailyPnl = nullableSum(state.holdings, "dailyPnl");
    var unrealizedPnl = nullableSum(state.holdings, "unrealizedPnl");
    var realizedPnl = nullableSum(state.holdings, "realizedPnl");
    var totalPnl = nullableSum(state.holdings, "totalPnl");
    if (totalPnl == null && (unrealizedPnl != null || realizedPnl != null)) {
      totalPnl = (unrealizedPnl || 0) + (realizedPnl || 0);
    }
    var totalCostBasis = nullableSum(state.holdings, "costBasis");
    text("portfolio-value", money(total));
    text("portfolio-scope", appEdition === "developer" ? "All visible SmartSleeve accounts in the current live feed." : "Accounts tied to " + (principalEmail || "the signed-in user") + ".");
    text("cash-value", money(accountTotal("cash")));
    text("buying-power", money(accountTotal("buyPower")));
    text("margin-usage", marginUsed() ? money(marginUsed()) : "$0");
    setMetric("daily-pl", dailyPnl, function (value) { return signedMoney(value); }, "Needs daily P/L sync");
    setMetric("total-pl", totalPnl, function (value) { return signedMoney(value); }, "Needs basis sync");
    setMetric("portfolio-return", totalPnl != null && totalCostBasis ? totalPnl / totalCostBasis * 100 : null, function (value) { return (value >= 0 ? "+" : "") + value.toFixed(2) + "%"; }, "Needs basis sync");
    text("sage-review-count", String(state.recommendations.length));
    renderDeveloperControls();
    renderTopHoldings(total);
    renderReviewQueue();
    renderAccounts();
    renderAccountDirectory();
    renderAccountDetail();
    renderAccountCoverage();
    renderSleeveSummary(total);
    renderPerformanceCharts();
    renderReports();
    renderHoldingsTable();
  }

  function renderDeveloperControls() {
    var strip = $("developer-controls");
    var userSelect = $("developer-user-filter");
    var accountSelect = $("developer-account-filter");
    if (!strip || !userSelect || !accountSelect) return;
    if (appEdition !== "developer") {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    var owners = {};
    var accounts = {};
    (state.allAccounts || state.accounts || []).forEach(function (account) {
      var owner = normalizeEmail(account.ownerEmail);
      if (owner) owners[owner] = accountOwnerLabel(owner);
      accounts[String(account.id)] = account.account + " / " + accountOwnerLabel(owner);
    });
    var ownerOptions = ["<option value=\"all\">All users</option>"].concat(Object.keys(owners).sort().map(function (email) {
      return "<option value=\"" + html(email) + "\">" + html(owners[email]) + " - " + html(email) + "</option>";
    }));
    var accountOptions = ["<option value=\"all\">All accounts</option>"].concat(Object.keys(accounts).sort().map(function (id) {
      return "<option value=\"" + html(id) + "\">" + html(accounts[id]) + "</option>";
    }));
    userSelect.innerHTML = ownerOptions.join("");
    accountSelect.innerHTML = accountOptions.join("");
    userSelect.value = owners[state.selectedOwnerEmail] ? state.selectedOwnerEmail : "all";
    accountSelect.value = accounts[state.selectedAccountId] ? state.selectedAccountId : "all";
  }

  function renderTopHoldings(total) {
    var target = $("top-holdings");
    if (!target) return;
    target.innerHTML = state.holdings.slice(0, 5).map(function (holding) {
      return holdingSummaryRow(holding, total);
    }).join("") || emptyItem("No holdings found", "Connect or sync a broker to import positions.");
  }

  function holdingSummaryRow(holding, total) {
    var shareCount = numberText(holding.shares, 6);
    var subtitle = (holding.name || tickerNames[holding.symbol] || "Holding") + " / " + holding.accounts.length + " acct";
    return "<article class=\"compact-ledger-row\">"
      + "<span><b>" + html(holding.symbol) + "</b><small>" + html(subtitle) + "</small></span>"
      + "<span><b>" + html(money(holding.value)) + "</b><small>" + html(pct(holding.value, total) + " / " + shareCount + " sh") + "</small></span>"
      + "</article>";
  }

  function renderReviewQueue() {
    var target = $("review-queue");
    if (!target) return;
    target.innerHTML = state.recommendations.slice(0, 5).map(function (rec) {
      return stackItem(rec.title, rec.action + " / " + rec.operator, rec.reason, rec.action === "Broker sync" ? 35 : 75);
    }).join("");
  }

  function renderAccounts() {
    var target = $("account-cards");
    if (!target) return;
    target.innerHTML = state.accounts.map(function (account) {
      var positionValue = (account.positions || []).reduce(function (sum, position) { return sum + (numeric(position.value) || 0); }, 0);
      return "<article class=\"account-card interactive-card\" data-account-detail=\"" + html(account.id) + "\" tabindex=\"0\">"
        + "<div class=\"stack-item-head\"><b>" + html(account.account) + "</b><span>" + html(account.broker) + "</span></div>"
        + accountPositionsStrip(account)
        + "<div class=\"account-mini-grid\">"
        + miniMetric("Equity", money(account.equity))
        + miniMetric("Cash", money(account.cash))
        + miniMetric("Buy power", money(account.buyPower))
        + miniMetric("Holdings", money(positionValue))
        + miniMetric("Positions", String((account.positions || []).length))
        + miniMetric("Status", accountStatusLabel(account))
        + "</div>"
        + "</article>";
    }).join("") || emptyItem("No visible accounts", "Sign in with an email that has SmartSleeve account access.");
  }

  function miniMetric(label, value) {
    return "<span class=\"mini-metric\"><i>" + html(label) + "</i><b>" + html(value) + "</b></span>";
  }

  function marginCopy(account) {
    var cash = numeric(account.cash) || 0;
    var buyPower = numeric(account.buyPower);
    if (cash < 0) {
      var buffer = buyPower == null ? "buffer needs sync" : "buffer " + money(buyPower);
      return "Margin used: <span class=\"negative\">" + money(Math.abs(cash)) + "</span> / " + buffer;
    }
    return "Cash: <span class=\"positive\">" + money(cash) + "</span> / buying power " + money(buyPower);
  }

  function renderAccountDirectory() {
    var target = $("accounts-directory");
    if (!target) return;
    target.innerHTML = state.accounts.map(function (account) {
      var positionValue = (account.positions || []).reduce(function (sum, position) { return sum + (numeric(position.value) || 0); }, 0);
      return "<article class=\"account-card interactive-card\" data-account-detail=\"" + html(account.id) + "\" tabindex=\"0\">"
        + "<div class=\"stack-item-head\"><b>" + html(account.account) + "</b><span>" + html(accountOwnerLabel(account.ownerEmail)) + " / " + html(account.broker) + "</span></div>"
        + accountPositionsStrip(account)
        + "<div class=\"account-mini-grid\">"
        + miniMetric("Value", money(account.equity))
        + miniMetric("Cash", money(account.cash))
        + miniMetric("Buy power", money(account.buyPower))
        + miniMetric("Holdings", money(positionValue))
        + miniMetric("Positions", String((account.positions || []).length))
        + miniMetric("Freshness", accountFreshnessLabel(account))
        + "</div>"
        + "<div class=\"recommendation-actions\"><button type=\"button\" class=\"text-button\" data-account-detail=\"" + html(account.id) + "\">Open details</button></div>"
        + "</article>";
    }).join("") || emptyItem("No visible accounts", "Sign in with an email that has SmartSleeve account access.");
  }

  function accountPositionsStrip(account) {
    var rows = (account.positions || []).slice().sort(function (a, b) {
      return (numeric(b.value) || 0) - (numeric(a.value) || 0);
    }).slice(0, 4);
    if (!rows.length) {
      return "<div class=\"account-position-strip\"><span>No synced positions</span></div>";
    }
    return "<div class=\"account-position-strip\">" + rows.map(function (position) {
      return "<span><b>" + html(position.symbol) + "</b> " + html(numberText(position.shares, 4)) + " / " + html(money(position.value)) + "</span>";
    }).join("") + "</div>";
  }

  function findAccountById(id) {
    return state.accounts.find(function (account) { return String(account.id) === String(id); }) || state.accounts[0] || null;
  }

  function renderAccountDetail() {
    var target = $("account-detail-content");
    if (!target) return;
    var account = findAccountById(state.selectedDetailAccountId);
    if (!account) {
      text("account-detail-title", "Account");
      text("account-detail-subtitle", "No visible account selected.");
      target.innerHTML = emptyItem("No account selected", "Open an account from the Accounts tab.");
      return;
    }
    state.selectedDetailAccountId = String(account.id);
    text("account-detail-title", account.account);
    text("account-detail-subtitle", accountOwnerLabel(account.ownerEmail) + " / " + account.broker + " / " + accountStatusLabel(account));
    var holdings = (account.positions || []).slice().sort(function (a, b) { return (numeric(b.value) || 0) - (numeric(a.value) || 0); });
    var sleeveCoverage = accountSleeveCoverage(account);
    var emptyAccountWarning = !holdings.length && !(numeric(account.equity) > 0) && /awaiting|configured|pending|sync/i.test(account.status || "");
    target.innerHTML = [
      "<article class=\"panel-card\"><div class=\"card-head\"><div><span>Broker values</span><h2>Cash and margin</h2></div><span class=\"status-chip\">" + html(account.broker) + "</span></div><div class=\"stack-list\">"
        + stackItem("Account value", money(account.equity), accountValueSourceCopy(account), null)
        + stackItem("Data freshness", accountFreshnessLabel(account), account.sourceIsStale ? "Broker positions may be stale. Refresh the daemon/account analytics before trading from this view." : "Broker/account export is inside the freshness window.", account.sourceIsStale ? 25 : null, account.sourceIsStale ? "with-progress" : "")
        + stackItem("Cash / margin", cashMarginMeta(account), marginPlainText(account), numeric(account.cash) < 0 ? 45 : 0, numeric(account.cash) < 0 ? "with-progress" : "")
        + stackItem("Buying power", money(account.buyPower), "Buying power can be zero even when account value is positive.", null)
        + (emptyAccountWarning ? stackItem("Live holdings missing", "Awaiting broker export", "This configured account has no synced positions or equity in the current app feed, so do not treat it as a true zero-balance account.") : "")
      + "</div></article>",
      accountDetailValueChart(account),
      "<article class=\"panel-card\"><div class=\"card-head\"><div><span>Sleeves</span><h2>Active sleeve coverage</h2></div><button type=\"button\" class=\"text-button\" data-nav-button=\"sleeves\">All sleeves</button></div><div class=\"stack-list\">"
        + (sleeveCoverage.active.length ? sleeveCoverage.active.map(function (sleeve) {
          return stackItem(sleeve.label, sleeveCoverageMeta(sleeve), sleeveCoverageBody(sleeve), 80);
        }).join("") : emptyItem("No funded active sleeve", "This account has no sleeve row with both live coverage and non-zero value/holdings."))
        + (sleeveCoverage.inactive.length ? "<div class=\"coverage-subhead\">Inactive or config-only</div>" + sleeveCoverage.inactive.slice(0, 8).map(function (sleeve) {
          return stackItem(sleeve.label, sleeveCoverageMeta(sleeve), "Configured row only; not counted as active sleeve coverage until it has value, holdings, or live ownership.", 20, "muted-stack");
        }).join("") : "")
      + "</div></article>",
      "<article class=\"panel-card wide-card\"><div class=\"card-head\"><div><span>Holdings</span><h2>Account positions</h2></div><span class=\"status-chip\">" + holdings.length + " positions</span></div><div class=\"table-wrap\"><table><tbody>"
        + (holdings.map(function (position) {
          return "<tr>"
            + cell("Ticker", "<b>" + html(position.symbol) + "</b><small>" + html(position.name || tickerNames[position.symbol] || "") + "</small>")
            + cell("Shares", numberText(position.shares, 6))
            + cell("Value", money(position.value))
            + cell("Mark", holdingPriceCell(position))
            + cell("Cost basis", position.costBasis == null ? "<span class=\"needs-sync\">Needs basis sync</span>" : money(position.costBasis))
            + cell("P/L", pnlCell(position.totalPnl, "Needs basis sync"))
            + "</tr>";
        }).join("") || "<tr>" + cell("Holdings", "No positions synced") + "</tr>")
      + "</tbody></table></div></article>"
    ].join("");
  }

  function accountSleeveCoverage(account) {
    var rows = Array.isArray(account.sleeves) ? account.sleeves : [];
    if (!rows.length) {
      return {
        active: [],
        inactive: splitSleeves(account.sleevesText).map(function (name) {
          return {label: name, operatingMode: "reported", net: 0, cash: 0, positionValue: 0, holdings: []};
        })
      };
    }
    var accountSymbols = {};
    (account.positions || []).forEach(function (position) {
      var symbol = String(position.symbol || "").toUpperCase();
      if (symbol) accountSymbols[symbol] = true;
    });
    var active = [];
    var inactive = [];
    rows.forEach(function (sleeve) {
      var values = resolvedSleeveValues(sleeve, account);
      var holdings = (sleeve.holdings || []).filter(function (holding) {
        return Math.abs(numeric(holding.shares) || 0) >= 0.000001;
      });
      var hasAccountHolding = holdings.some(function (holding) {
        return Boolean(accountSymbols[String(holding.symbol || holding.ticker || holding || "").toUpperCase()]);
      });
      var mode = String(sleeve.operatingMode || sleeve.operating_mode || "unknown").toLowerCase();
      var hasValue = Math.abs(values.net) >= 0.005 || Math.abs(values.cash) >= 0.005 || Math.abs(values.positionValue) >= 0.005;
      var hasCurrentOwnership = sleeveHasCurrentOwnership(sleeve);
      var isOff = /^(off|disabled|inactive|hibernate|hibernating|paused|sleep)$/i.test(mode);
      var row = {
        label: sleeveLabel(sleeve, "Sleeve"),
        operatingMode: sleeve.operatingMode || sleeve.operating_mode || "unknown",
        net: values.net,
        cash: values.cash,
        positionValue: values.positionValue,
        holdings: holdings,
        lastReconciledAt: sleeve.lastReconciledAt || sleeve.last_reconciled_at,
        initialized: Boolean(sleeve.initialized)
      };
      if (!isOff && hasCurrentOwnership && (hasValue || hasAccountHolding)) {
        active.push(row);
      } else {
        inactive.push(row);
      }
    });
    active.sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net) || a.label.localeCompare(b.label); });
    inactive.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return {active: active, inactive: inactive};
  }

  function sleeveCoverageMeta(sleeve) {
    var value = Math.abs(numeric(sleeve.net) || 0) >= 0.005 ? money(sleeve.net) : "No funded value";
    return value + " / " + (sleeve.operatingMode || "mode unknown");
  }

  function sleeveCoverageBody(sleeve) {
    var symbols = (sleeve.holdings || []).map(function (holding) {
      return String(holding.symbol || "").toUpperCase();
    }).filter(Boolean).slice(0, 8).join(", ");
    return (symbols || "No current holdings") + (sleeve.lastReconciledAt ? " / reconciled " + compactDateTime(sleeve.lastReconciledAt) : "");
  }

  function accountDetailValueChart(account) {
    var range = state.selectedAccountChartRange || "1D";
    var allPoints = accountHistoryPoints(account);
    var points = filterHistoryRange(allPoints, range);
    if (!points.length && numeric(account.equity) != null) {
      points = [{at: account.generatedAt || new Date().toISOString(), value: account.equity}];
    }
    var cleanPoints = points.map(function (point) {
      return {at: point.at, value: numeric(point.value)};
    }).filter(function (point) { return point.at && point.value != null; }).sort(function (a, b) {
      return new Date(a.at).getTime() - new Date(b.at).getTime();
    });
    var first = cleanPoints[0];
    var last = cleanPoints[cleanPoints.length - 1];
    var pnl = first && last ? last.value - first.value : null;
    var pnlPct = first && first.value ? pnl / first.value * 100 : null;
    var trendClass = valueClass(pnl);
    var lineColor = trendClass === "negative" ? "var(--red)" : "var(--green)";
    var meta = cleanPoints.length > 1
      ? signedMoney(pnl, "$0.00") + " (" + signedPercent(pnlPct) + ") " + range
      : "Needs more synced points for selected range P&L";
    var chartId = "account-detail-chart-" + String(account.id || account.account || "account").replace(/[^a-zA-Z0-9_-]/g, "-") + "-" + range;
    var tabs = ["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"].map(function (item) {
      return "<button type=\"button\" class=\"time-tab" + (item === range ? " active" : "") + "\" data-account-chart-range=\"" + html(item) + "\">" + html(item) + "</button>";
    }).join("");
    return "<article class=\"panel-card wide-card account-detail-chart-card\"><div class=\"card-head\"><div><span>Account chart</span><h2>Account Holdings Value ($)</h2></div><span class=\"status-chip " + html(trendClass) + "\">" + html(meta) + "</span></div>"
      + (last ? "<div class=\"chart-readout\" data-chart-readout=\"" + html(chartId) + "\"><b>" + html(money(last.value)) + "</b><span class=\"" + html(trendClass) + "\">" + html(meta) + "</span></div>" : "")
      + (cleanPoints.length ? buildLineChart(cleanPoints, lineColor, "Account value", {interactive: true, compact: true, chartId: chartId, baseline: first ? first.value : null, range: range}) : emptyItem("No account history", "Private account history has not synced for this account yet."))
      + "<div class=\"time-tabs\" role=\"tablist\" aria-label=\"Account chart range\">" + tabs + "</div>"
      + (last ? "<p class=\"chart-footnote\">Latest " + html(money(last.value)) + " / " + html(compactDateTime(last.at)) + "</p>" : "")
      + "</article>";
  }

  function accountHistoryPoints(account) {
    return (state.history.accounts || []).filter(function (row) {
      return rowAccountId(row) === account.id;
    }).map(function (row) {
      return {at: row.at || row.generatedAt || row.generated_at, value: numeric(row.equity != null ? row.equity : row.value)};
    }).filter(function (row) { return row.at && row.value != null; });
  }

  function filterHistoryRange(points, range) {
    var rows = (points || []).slice().sort(function (a, b) {
      return new Date(a.at).getTime() - new Date(b.at).getTime();
    });
    if (!rows.length || range === "ALL") return rows;
    var latest = new Date(rows[rows.length - 1].at).getTime();
    if (range === "YTD") {
      var latestDate = new Date(latest);
      var startOfYear = new Date(latestDate.getFullYear(), 0, 1).getTime();
      return rows.filter(function (row) { return new Date(row.at).getTime() >= startOfYear; });
    }
    var hours = range === "1D" ? 24 : range === "1W" ? 24 * 7 : range === "1M" ? 24 * 31 : range === "3M" ? 24 * 93 : 24 * 366;
    var cutoff = latest - hours * 60 * 60 * 1000;
    return rows.filter(function (row) { return new Date(row.at).getTime() >= cutoff; });
  }

  function cashMarginMeta(account) {
    var cash = numeric(account.cash) || 0;
    return cash < 0 ? "Margin used " + money(Math.abs(cash)) : "Cash " + money(cash);
  }

  function accountFreshnessLabel(account) {
    if (account.sourceFreshnessLabel) return account.sourceFreshnessLabel;
    if (account.sourceAgeMinutes != null) return Math.round(account.sourceAgeMinutes) + " min old";
    return account.generatedAt ? compactDateTime(account.generatedAt) : "needs sync";
  }

  function accountStatusLabel(account) {
    var status = account.status || "synced";
    if (account.sourceIsStale && status.indexOf("stale") === -1) {
      status = "stale analytics export";
    }
    return status + (account.equitySource === "positions_plus_cash_estimate" ? " est." : "");
  }

  function accountValueSourceCopy(account) {
    if (account.equitySource === "broker_equity") {
      return "Fresh broker equity was preferred because it differed materially from the older normalized account value.";
    }
    if (account.equitySource === "positions_plus_cash_estimate") {
      return "Estimated from E-Trade positions plus cash because broker value was zero.";
    }
    return "Broker-reported account value.";
  }

  function marginPlainText(account) {
    var cash = numeric(account.cash) || 0;
    if (cash < 0) {
      return "This is margin usage and buffer context, not a generic negative-cash error. Review broker maintenance and buying-power buffer before adding risk.";
    }
    return "Cash is non-negative in this account.";
  }

  function renderAccountCoverage() {
    var target = $("account-coverage");
    if (!target) return;
    var coverage = state.accountCoverage || {};
    var expected = coverage.expected || [];
    if (appEdition !== "developer" && principalEmail) {
      expected = expected.filter(function (row) { return rowOwnerEmail(row) === canonicalEmail(principalEmail); });
    }
    if (!expected.length) {
      target.innerHTML = emptyItem("Account coverage unavailable", "The private feed did not include an expected-account checklist.");
      return;
    }
    var missing = coverage.missing || [];
    var configuredOnly = coverage.configured_without_live || [];
    if (appEdition !== "developer" && principalEmail) {
      missing = missing.filter(function (row) { return rowOwnerEmail(row) === canonicalEmail(principalEmail); });
      configuredOnly = configuredOnly.filter(function (row) { return rowOwnerEmail(row) === canonicalEmail(principalEmail); });
    }
    var visible = appEdition === "developer" ? Number(coverage.visible_count || state.accounts.length || 0) : state.accounts.length;
    var total = appEdition === "developer" ? Number(coverage.expected_count || expected.length || 0) : expected.length;
    var rows = [
      stackItem(
        "Expected account coverage",
        visible + " of " + total + " visible",
        missing.length ? missing.length + " expected account(s) are not in the current app feed." : "All expected accounts for this user/developer scope are represented.",
        total ? visible / total * 100 : 0
      )
    ];
    missing.slice(0, 6).forEach(function (row) {
      rows.push(stackItem("Missing: " + (row.account || row.id), row.broker || "Broker unknown", row.expectedUse || row.status || "Expected account has no current app-feed row.", 12));
    });
    configuredOnly.slice(0, 6).forEach(function (row) {
      rows.push(stackItem("Awaiting live export: " + (row.account || row.id), row.broker || "Broker unknown", row.expectedUse || row.status || "Configured account is visible but lacks live analytics.", 35));
    });
    target.innerHTML = rows.join("");
  }

  function renderPerformanceCharts() {
    var accountTarget = $("account-value-charts");
    var holdingTarget = $("holding-value-charts");
    if (accountTarget) {
      accountTarget.innerHTML = state.accounts.map(function (account) {
        var points = state.history.accounts.filter(function (row) { return row.accountId === account.id; });
        if (!points.length && numeric(account.equity) != null) {
          points = [{at: account.generatedAt || new Date().toISOString(), equity: account.equity}];
        }
        return lineChartCard(account.account, "Account value", points, "equity", "Account value");
      }).join("") || emptyItem("No account history", "Account value charts appear after private feed history syncs.");
    }
    if (holdingTarget) {
      var latestByKey = {};
      state.accounts.forEach(function (account) {
        (account.positions || []).forEach(function (position) {
          var key = account.id + "::" + position.symbol;
          latestByKey[key] = {account: account, position: position, value: numeric(position.value) || 0};
        });
      });
      var rows = Object.keys(latestByKey).map(function (key) { return latestByKey[key]; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
      holdingTarget.innerHTML = rows.map(function (row) {
        var points = state.history.positions.filter(function (point) {
          return point.accountId === row.account.id && point.symbol === row.position.symbol;
        });
        points = deglitchHoldingHistory(points, row.position.value);
        if (!points.length && numeric(row.position.value) != null) {
          points = [{at: row.account.generatedAt || new Date().toISOString(), value: row.position.value}];
        }
        var title = row.position.symbol + " / " + row.account.account;
        var meta = (row.position.name || tickerNames[row.position.symbol] || row.position.symbol) + " holding value";
        return lineChartCard(title, meta, points, "value", "Stock value", row.position.totalPnl);
      }).join("") || emptyItem("No holding history", "Stock holding charts appear after private feed history syncs.");
    }
  }

  function deglitchHoldingHistory(points, currentValue) {
    var latestValue = numeric(currentValue);
    if (latestValue == null || latestValue <= 0) {
      return points || [];
    }
    var threshold = Math.max(1, latestValue * 0.015);
    return (points || []).filter(function (point) {
      var value = numeric(point.value);
      var shares = numeric(point.shares);
      if (value == null) return false;
      if (value > threshold) return true;
      return shares != null && shares > 0.000001 && value > 0;
    });
  }

  function renderSleeveSummary(total) {
    var target = $("sleeve-summary");
    if (!target) return;
    var sleeves = state.sleeves.filter(function (sleeve) {
      return sleeve && sleeve.name && !isOperationalNoiseLabel(sleeve.name);
    });
    target.innerHTML = sleeves.slice(0, 8).map(function (sleeve) {
      var value = sleeve.exactValue ? money(sleeve.exactValue) : "Ledger split pending";
      return stackItem(sleeve.name, value, sleeve.accounts.join(", ") + " / " + (sleeve.holdings.slice(0, 7).join(", ") || "No current holdings"), sleeve.exactValue && total ? sleeve.exactValue / total * 100 : 20);
    }).join("") || emptyItem("No active sleeve holdings", "No funded sleeve positions are visible for this account scope.");
  }

  function renderReports() {
    var daily = $("report-archive-list");
    var picks = $("stock-pick-report-list");
    var reports = visibleRows(state.reports);
    if (daily) {
      daily.innerHTML = reports.filter(function (report) { return report.type === "daily_performance"; }).map(reportCard).join("") || emptyItem("No daily reports archived", "Daily report workflow will archive reports here after generation.");
    }
    if (picks) {
      picks.innerHTML = reports.filter(function (report) { return report.type === "stock_pick"; }).map(reportCard).join("") || emptyItem("No stock-pick reports archived", "Stock-pick emails will appear for days when the user had that algo active.");
    }
  }

  function stockPickReports() {
    return visibleRows(state.reports).filter(function (report) {
      var type = String(report.type || report.reportType || report.report_type || "").toLowerCase();
      var title = String(report.title || report.subject || "").toLowerCase();
      return type === "stock_pick" || type === "stock-pick" || title.indexOf("stock pick") !== -1 || title.indexOf("stock-pick") !== -1;
    });
  }

  function stockPickKey(value) {
    var textValue = displayLabel(value, "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (textValue === "grand sage" || textValue === "grand philosophe" || textValue === "semi sage") return "grand_sage";
    if (textValue === "general sage") return "general_sage";
    if (textValue === "value sage") return "value_sage";
    if (textValue.indexOf("grand") !== -1 || textValue.indexOf("semi") !== -1) return "grand_sage";
    if (textValue.indexOf("general") !== -1) return "general_sage";
    if (textValue.indexOf("value") !== -1) return "value_sage";
    return textValue.replace(/\s+/g, "_");
  }

  function stockPickLatestUrl(report) {
    var key = stockPickKey(report.algo || report.sleeve || report.sleeves || report.title || report.url);
    if (key === "grand_sage") return "/app/reports/stock-picks/grand_sage/latest.html";
    if (key === "general_sage") return "/app/reports/stock-picks/general_sage/latest.html";
    return "";
  }

  function normalizeStockPickUrl(report) {
    var url = report.url || report.latestUrl || report.latest_url || report.displayUrl || "#";
    var latestUrl = stockPickLatestUrl(report);
    if (latestUrl && !/^https?:\/\//i.test(String(url))) {
      return latestUrl;
    }
    return url;
  }

  function stockPickFallbackReports() {
    return [
      {
        id: "grand_sage-latest",
        type: "stock_pick",
        localFallback: true,
        algo: "grand_sage",
        sleeves: ["Grand Sage", "Semi Sage"],
        title: "Grand Sage stock picks",
        date: "latest",
        summary: "Latest known Grand Sage/Semi Sage archive universe. The private report gateway remains authoritative for thesis notes and sizing context.",
        candidateSymbols: ["SNDK", "ALAB", "MU", "CRDO", "NBIS", "AMD", "CAT", "TSM", "SMCI", "VRT", "NVDA", "AVGO", "MRVL"],
        url: "/app/reports/stock-picks/grand_sage/latest.html",
        latestUrl: "/app/reports/stock-picks/grand_sage/latest.html"
      },
      {
        id: "general_sage-latest",
        type: "stock_pick",
        localFallback: true,
        algo: "general_sage",
        sleeves: ["General Sage"],
        title: "General Sage stock picks",
        date: "latest",
        summary: "Latest known General Sage archive universe. Tactical hedge assets are separated from ranked long picks.",
        candidateSymbols: ["MU", "NVDA", "AMD", "MSFT", "GOOGL", "SMCI", "CRDO", "QQQ", "SPY", "XLI", "JPM", "V", "LLY", "NVO", "COP", "CAT", "COST"],
        hedgeSymbols: ["SQQQ", "SOXS", "SPXU"],
        url: "/app/reports/stock-picks/general_sage/latest.html",
        latestUrl: "/app/reports/stock-picks/general_sage/latest.html"
      }
    ];
  }

  function isLocalFallbackReport(report) {
    return Boolean(report && (report.localFallback || report.local_fallback));
  }

  function ensureStockPickReports(reports) {
    var rows = (reports || []).slice();
    var seen = {};
    rows.forEach(function (report) {
      var key = stockPickKey(report.algo || report.sleeve || report.sleeves || report.title);
      if (key) seen[key] = true;
    });
    stockPickFallbackReports().forEach(function (report) {
      var key = stockPickKey(report.algo);
      if (!seen[key]) {
        rows.push(report);
      }
    });
    return rows;
  }

  function reportSleeveNames(report) {
    var names = splitSleeves(report.sleeves || report.sleeve || report.sleeveName || report.sleeve_name || report.algo || report.universe || report.strategy);
    if (!names.length) {
      var haystack = String([report.title, report.subject, report.description, report.summary].filter(Boolean).join(" ")).toLowerCase();
      state.sleeves.forEach(function (sleeve) {
        if (haystack.indexOf(String(sleeve.name).toLowerCase()) !== -1 && names.indexOf(sleeve.name) === -1) {
          names.push(sleeve.name);
        }
      });
    }
    return names;
  }

  function subscribedStockPickSleeves() {
    var byName = {};
    state.sleeves.forEach(function (sleeve) {
      var name = sleeveLabel(sleeve.name, "");
      if (!name) return;
      byName[name] = {
        name: name,
        status: /hibernate|paused|sleep/i.test(sleeve.operatingMode || "") ? "Hibernating" : "Active",
        holdings: sleeve.holdings || [],
        reportCount: 0,
        description: sleeveDescription(name)
      };
    });
    stockPickReports().forEach(function (report) {
      var names = reportSleeveNames(report);
      if (!names.length) {
        names = ["General SmartSleeve"];
      }
      names.forEach(function (rawName) {
        var name = sleeveLabel(rawName, "General SmartSleeve");
        if (!byName[name]) {
          byName[name] = {
            name: name,
            status: report.status || report.subscriptionStatus || report.subscription_status || "Subscribed",
            holdings: [],
            reportCount: 0,
            description: displayLabel(report.description || report.summary, sleeveDescription(name))
          };
        }
        byName[name].reportCount += 1;
      });
    });
    return Object.keys(byName).map(function (name) { return byName[name]; }).sort(function (a, b) {
      return b.reportCount - a.reportCount || a.name.localeCompare(b.name);
    });
  }

  function sleeveDescription(name) {
    if (/semi|sage by smartsleeve|grand sage/i.test(name)) return "Semiconductor and AI infrastructure stock-pick universe with thesis notes, catalysts, and sizing context.";
    if (/quantum|convex/i.test(name)) return "Speculative convexity universe where weekly picks need extra room for thesis and risk notes.";
    if (/value/i.test(name)) return "Value-oriented universe focused on valuation, balance-sheet durability, and patient entry windows.";
    if (/honey|badger|savage/i.test(name)) return "Higher-volatility universe where behavior, liquidity, and drawdown notes matter as much as the ticker list.";
    return "Subscribed SmartSleeve algo universe. Weekly pick descriptions are shown full width so longer notes do not get squeezed on mobile.";
  }

  function renderStockPicks() {
    var sleeveTarget = $("stock-pick-sleeves");
    var archiveTarget = $("stock-pick-archive");
    if (!sleeveTarget || !archiveTarget) return;
    var sleeves = subscribedStockPickSleeves();
    if (!state.selectedStockPickSleeve || !sleeves.some(function (sleeve) { return sleeve.name === state.selectedStockPickSleeve; })) {
      state.selectedStockPickSleeve = sleeves.length ? sleeves[0].name : "";
    }
    sleeveTarget.innerHTML = sleeves.map(function (sleeve) {
      var active = sleeve.name === state.selectedStockPickSleeve ? " active" : "";
      var holdings = sleeve.holdings && sleeve.holdings.length
        ? sleeve.holdings.slice(0, 8).map(function (holding) { return displayLabel(holding.symbol || holding.ticker || holding, ""); }).filter(Boolean).join(", ")
        : "Universe archive";
      return "<button type=\"button\" class=\"stock-pick-sleeve" + active + "\" data-stock-pick-sleeve=\"" + html(sleeve.name) + "\">"
        + "<span>" + html(sleeve.status || "Subscribed") + "</span>"
        + "<b>" + html(sleeve.name) + "</b>"
        + "<small>" + html(sleeve.reportCount + " archived report" + (sleeve.reportCount === 1 ? "" : "s") + " / " + holdings) + "</small>"
        + "</button>";
    }).join("") || emptyItem("No subscribed stock-pick sleeves", "Stock-pick universes will appear after the private feed includes subscriptions or stock-pick reports.");
    var selected = sleeves.find(function (sleeve) { return sleeve.name === state.selectedStockPickSleeve; });
    text("stock-pick-title", selected ? selected.name + " stock-pick archive" : "Stock-pick reports");
    if (!selected) {
      archiveTarget.innerHTML = emptyItem("No archive selected", "Choose a subscribed sleeve once stock-pick reports are available.");
      return;
    }
    var reports = stockPickReports().filter(function (report) {
      var names = reportSleeveNames(report);
      var selectedKey = stockPickKey(selected.name);
      return !names.length || names.indexOf(selected.name) !== -1 || names.some(function (name) { return stockPickKey(name) === selectedKey; });
    });
    archiveTarget.innerHTML = [
      "<article class=\"stack-item stock-pick-description\"><div class=\"stack-item-head\"><b>" + html(selected.name) + "</b><span>" + html(selected.status || "Subscribed") + "</span></div><p>" + html(selected.description) + "</p></article>",
      reports.map(stockPickArchiveCard).join("") || emptyItem("No weekly picks archived yet", "The sleeve is subscribed, but no weekly stock-pick reports are present in the current app feed.")
    ].join("");
  }

  function stockPickArchiveCard(report) {
    var url = normalizeStockPickUrl(report);
    var title = displayLabel(report.title || report.subject, "Weekly stock picks");
    var date = displayLabel(report.date || report.generatedAt || report.generated_at || report.timestamp, "latest");
    var body = displayLabel(report.description || report.summary || report.notes, "Open the archived weekly stock-pick email/report for ticker list, rationale, and universe notes.");
    var candidates = (report.candidateSymbols || report.candidate_symbols || report.symbols || report.tickers || []).map(function (symbol) {
      return displayLabel(symbol, "").toUpperCase();
    }).filter(Boolean);
    var hedges = (report.hedgeSymbols || report.hedge_symbols || []).map(function (symbol) {
      return displayLabel(symbol, "").toUpperCase();
    }).filter(Boolean);
    var symbolMarkup = candidates.length
      ? "<div class=\"symbol-chip-row\" aria-label=\"Stock-pick tickers\">" + candidates.slice(0, 24).map(function (symbol) { return "<span>" + html(symbol) + "</span>"; }).join("") + "</div>"
      : "";
    var hedgeMarkup = hedges.length
      ? "<p class=\"stock-pick-hedges\">Hedges: " + html(hedges.join(", ")) + "</p>"
      : "";
    return "<article class=\"stack-item stock-pick-description\">"
      + "<div class=\"stack-item-head\"><b>" + html(title) + "</b><span>" + html(date) + "</span></div>"
      + "<p>" + html(body) + "</p>"
      + symbolMarkup
      + hedgeMarkup
      + "<div class=\"recommendation-actions\"><a class=\"text-button\" href=\"" + html(url) + "\" target=\"_blank\" rel=\"noopener\">Open archive</a></div>"
      + "</article>";
  }

  function reportCard(report) {
    var url = report.type === "stock_pick" ? normalizeStockPickUrl(report) : (report.url || report.latestUrl || "#");
    return "<article class=\"stack-item\">"
      + "<div class=\"stack-item-head\"><b>" + html(report.title) + "</b><span>" + html(report.date || "latest") + "</span></div>"
      + "<p>" + html(report.type === "stock_pick" ? "Stock pick email/report archive" : "Daily performance report archive") + "</p>"
      + "<div class=\"recommendation-actions\"><a class=\"text-button\" href=\"" + html(url) + "\" target=\"_blank\" rel=\"noopener\">Open report</a></div>"
      + "</article>";
  }

  function renderHoldingsTable() {
    var total = accountTotal("equity");
    var rows = state.holdings.slice();
    var sort = $("holdings-sort");
    var sortValue = sort ? sort.value : "value";
    if (sortValue === "symbol") rows.sort(function (a, b) { return a.symbol.localeCompare(b.symbol); });
    else if (sortValue === "account") rows.sort(function (a, b) { return b.accounts.length - a.accounts.length || b.value - a.value; });
    else rows.sort(function (a, b) { return b.value - a.value; });
    var target = $("holdings-table");
    if (!target) return;
    target.innerHTML = rows.map(function (holding) {
      var weightNum = total ? holding.value / total : 0;
      var holdingBadge = holdingHasSage(holding) ? sageBadge() : "";
      return "<tr>"
        + cell("Ticker", "<span class=\"ticker-lockup\">" + holdingBadge + "<span><b>" + html(holding.symbol) + "</b><small>" + html(holding.name) + "</small></span></span>")
        + cell("Company", html(holding.name))
        + cell("Shares", numberText(holding.shares, 6))
        + cell("Stock price", holdingPriceCell(holding))
        + cell("Avg buy price", holding.averageCost == null ? "<span class=\"needs-sync\">Needs basis sync</span>" : money(holding.averageCost))
        + cell("Market value", money(holding.value))
        + cell("Cost basis", holding.costBasis == null ? "<span class=\"needs-sync\">Needs basis sync</span>" : money(holding.costBasis))
        + cell("Daily P/L", pnlCell(holding.dailyPnl, "Needs daily sync"))
        + cell("Unrealized P/L", pnlCell(holding.unrealizedPnl, "Needs basis sync"))
        + cell("Realized P/L", pnlCell(holding.realizedPnl, "Needs trade sync"))
        + cell("Total P/L", pnlCell(holding.totalPnl, "Needs basis sync"))
        + cell("Accounts", html(holding.accounts.join(", ")))
        + cell("Weight", pct(holding.value, total) + "<small>" + html(thesisStatus(holding.symbol, weightNum)) + "</small>")
        + "</tr>";
    }).join("") || "<tr>" + cell("Holdings", "No holdings synced") + "</tr>";
  }

  function priceSourceLabel(source) {
    var key = String(source || "").replace(/_/g, " ").trim();
    if (!key || key === "value per share") return "Value / shares";
    if (/current/i.test(key)) return "Current quote";
    if (/mark/i.test(key)) return "Mark quote";
    if (/last/i.test(key)) return "Last trade";
    if (/market/i.test(key)) return "Market quote";
    if (/price/i.test(key)) return "Quote";
    return key;
  }

  function compactDateTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
  }

  function holdingPriceCell(holding) {
    if (numeric(holding.price) == null) {
      return "<span class=\"needs-sync\">Needs quote sync</span>";
    }
    var meta = priceSourceLabel(holding.priceSource);
    var asOf = compactDateTime(holding.priceAsOf);
    if (asOf) meta += " " + asOf;
    if (holding.quotePrice != null) meta += " | quote " + money(holding.quotePrice);
    var warning = "";
    if (holding.priceDivergencePct != null && holding.priceDivergencePct > 1.5) {
      warning = "<small class=\"price-warning\">Value implies " + html(money(holding.impliedPrice)) + " (" + holding.priceDivergencePct.toFixed(1) + "% diff)</small>";
    }
    return html(money(holding.price)) + "<small>" + html(meta) + "</small>" + warning;
  }

  function renderSleeves() {
    var total = accountTotal("equity");
    var cards = $("sleeve-cards");
    if (cards) {
      cards.innerHTML = state.sleeves.map(function (sleeve) {
        var actual = sleeve.exactValue && total ? sleeve.exactValue / total * 100 : null;
        var drift = actual == null || !sleeve.target ? "Needs target/ledger" : (actual - sleeve.target).toFixed(1) + " pts";
        return "<article class=\"sleeve-card interactive-card\" data-sleeve-detail=\"" + html(sleeve.name) + "\" tabindex=\"0\">"
          + "<span>" + html(sleeve.operatingMode || "mode unknown") + "</span>"
          + "<h3>" + html(sleeve.name) + "</h3>"
          + "<p>Value: <b>" + (sleeve.exactValue ? money(sleeve.exactValue) : "Ledger split pending") + "</b></p>"
          + "<p>Cash: " + money(sleeve.cash) + " / holdings " + money(sleeve.positionValue) + "</p>"
          + "<p>Target: " + sleeve.target + "% / Actual: " + (actual == null ? "needs ledger" : actual.toFixed(1) + "%") + "</p>"
          + "<p>Drift: " + html(drift) + "</p>"
          + "<div class=\"progress-bar\" style=\"--value:" + Math.min(100, actual || 18) + "%\"><i></i></div>"
          + "<div class=\"recommendation-actions\"><button type=\"button\" class=\"text-button\" data-sleeve-detail=\"" + html(sleeve.name) + "\">Open details</button></div>"
          + "</article>";
      }).join("");
    }
    var rebalance = $("rebalance-list");
    if (rebalance) {
      rebalance.innerHTML = [
        stackItem("Use live sleeve ledger", "Canonical analytics export", "Sleeve values and holdings now come from account-scoped analytics when available.", 90),
        stackItem("Review semiconductor target", "MU/SNDK concentration", "Confirm whether current semiconductor exposure still matches the intended target.", 80),
        stackItem("Keep Sage automation gated", "Default mode: Recommend", "Draft orders are allowed after user approval; live automation requires sleeve limits and kill switch.", 60)
      ].join("");
    }
    var table = $("sleeve-table");
    if (table) {
      table.innerHTML = state.sleeves.map(function (sleeve) {
        return "<tr>"
          + cell("Sleeve", "<b>" + html(sleeve.name) + "</b>")
          + cell("Account", html(sleeve.accounts.join(", ")))
          + cell("Holdings", html(sleeve.holdings.slice(0, 10).join(", ") || "No current positions"))
          + cell("Known value", sleeve.exactValue ? money(sleeve.exactValue) : "Needs sleeve ledger")
          + cell("Next action", sleeve.ledgerPending ? "Assign lots to sleeve" : "Review drift")
          + "</tr>";
      }).join("");
    }
    renderSleeveDetail();
  }

  function findSleeveByName(name) {
    return state.sleeves.find(function (sleeve) { return sleeve.name === name; }) || state.sleeves[0] || null;
  }

  function renderSleeveDetail() {
    var target = $("sleeve-detail-content");
    if (!target) return;
    var sleeve = findSleeveByName(state.selectedDetailSleeveName);
    if (!sleeve) {
      text("sleeve-detail-title", "Sleeve");
      text("sleeve-detail-subtitle", "No active sleeve selected.");
      target.innerHTML = emptyItem("No sleeve selected", "Open a sleeve from the Sleeves tab.");
      return;
    }
    state.selectedDetailSleeveName = sleeve.name;
    text("sleeve-detail-title", sleeve.name);
    text("sleeve-detail-subtitle", sleeve.accounts.join(", ") + " / " + (sleeve.operatingMode || "mode unknown"));
    var trades = state.serverTrades.filter(function (trade) {
      return String(trade.sleeve || trade.sleeveId || trade.sleeve_id || "").toLowerCase().indexOf(sleeve.name.toLowerCase()) !== -1;
    }).slice(0, 8);
    target.innerHTML = [
      "<article class=\"panel-card\"><div class=\"card-head\"><div><span>Behavior</span><h2>Current sleeve state</h2></div><span class=\"status-chip\">" + html(sleeve.operatingMode || "Unknown") + "</span></div><div class=\"stack-list\">"
        + stackItem("Known value", sleeve.exactValue ? money(sleeve.exactValue) : "Ledger split pending", "Ledger quality controls whether drift and P/L are exact.", sleeve.exactValue ? 80 : 30)
        + stackItem("Cash / holdings", money(sleeve.cash) + " / " + money(sleeve.positionValue), "Sleeve-level cash and position value where the analytics feed provides it.", 70)
        + stackItem("Target", sleeve.target ? sleeve.target + "%" : "Needs target", "Drift can be reviewed once target and exact ledger value are present.", sleeve.target || 25)
      + "</div></article>",
      "<article class=\"panel-card\"><div class=\"card-head\"><div><span>Holdings</span><h2>Tracked symbols</h2></div><button type=\"button\" class=\"text-button\" data-nav-button=\"reallocation\">Analyze rotate</button></div><div class=\"stack-list\">"
        + (sleeve.holdings.length ? sleeve.holdings.slice(0, 12).map(function (symbol) {
          return stackItem(symbol, thesisStatus(symbol, 0), "Review behavior and portfolio role before reallocating.", 55);
        }).join("") : emptyItem("No holdings", "No current symbols are tagged to this sleeve."))
      + "</div></article>",
      "<article class=\"panel-card wide-card\"><div class=\"card-head\"><div><span>Trades</span><h2>Recent sleeve activity</h2></div><span class=\"status-chip\">Private feed</span></div><div class=\"stack-list\">"
        + (trades.map(function (trade) {
          return stackItem(trade.symbol || trade.ticker || "Trade", orderStatusLabel(trade), (trade.account || trade.accountId || "Account") + " / " + orderTypeLabel(trade), 55);
        }).join("") || emptyItem("No sleeve trades", "No current server trade rows are tagged to this sleeve."))
      + "</div></article>"
    ].join("");
  }

  function renderTradeCenter() {
    populateSelect("trade-account", state.accounts.map(function (account) { return [account.account, account.account + " / " + account.broker]; }));
    populateSelect("trade-sleeve", state.sleeves.map(function (sleeve) { return [sleeve.name, sleeve.name]; }));
    updateTradePreview();
    renderDraftOrders();
    renderActivity();
    renderServerTrades();
    renderReallocation();
  }

  function renderReallocation() {
    populateSelect("reallocation-account", state.accounts.map(function (account) { return [account.account, account.account + " / " + account.broker]; }));
    populateSelect("reallocation-sleeve", state.sleeves.map(function (sleeve) { return [sleeve.name, sleeve.name]; }));
    setDefaultReallocationDeadline();
    updateReallocationPreview();
  }

  function populateSelect(id, rows) {
    var select = $(id);
    if (!select) return;
    var current = select.value;
    select.innerHTML = rows.map(function (row) {
      return "<option value=\"" + html(row[0]) + "\">" + html(row[1]) + "</option>";
    }).join("");
    if (current && rows.some(function (row) { return row[0] === current; })) {
      select.value = current;
    }
  }

  function valueOf(id) {
    var element = $(id);
    return element ? element.value : "";
  }

  function setDefaultReallocationDeadline() {
    var input = $("reallocation-deadline");
    if (!input || input.value) return;
    var now = new Date();
    var deadline = new Date(now.getFullYear(), 5, 24, 12, 59, 0, 0);
    if (now.getTime() > deadline.getTime()) {
      deadline = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      deadline.setHours(12, 59, 0, 0);
    }
    input.value = formatLocalDateTime(deadline);
  }

  function formatLocalDateTime(date) {
    function pad(value) { return String(value).padStart(2, "0"); }
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function checked(id) {
    var element = $(id);
    return Boolean(element && element.checked);
  }

  function selectedAccount() {
    var accountName = valueOf("trade-account");
    return state.accounts.find(function (item) { return item.account === accountName; }) || null;
  }

  function brokerKey(account) {
    var broker = String((account && account.broker) || "").toLowerCase();
    if (broker.indexOf("robinhood") !== -1) return "robinhood";
    if (broker.indexOf("e*trade") !== -1 || broker.indexOf("etrade") !== -1) return "etrade";
    if (broker.indexOf("ibkr") !== -1 || broker.indexOf("interactive") !== -1) return "ibkr";
    return "generic";
  }

  function numericOrNull(id) {
    var raw = valueOf(id);
    if (raw === "") return null;
    var number = Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function sideFromAction(action) {
    return action === "buy" ? "buy" : "sell";
  }

  function routeForOrderType(orderType) {
    if (orderType === "market" || orderType === "limit") return "direct_proposed_order";
    if (orderType === "stop_market" || orderType === "stop_limit" || orderType === "trailing_stop_market") return "broker_native_adapter_required";
    return "synthetic_supervised";
  }

  function isSmartTradeStrategy(strategy, action) {
    var normalized = String(strategy || "").toLowerCase();
    var actionText = String(action || "").toLowerCase();
    return normalized.indexOf("smarttrade") !== -1
      || normalized === "autoguard_window"
      || normalized === "reallocation"
      || actionText === "reallocate"
      || actionText === "exit";
  }

  function currentHolding(symbol) {
    var normalized = String(symbol || "").toUpperCase();
    return state.holdings.find(function (holding) { return holding.symbol === normalized; }) || null;
  }

  function buildAdvancedIntent() {
    var account = selectedAccount();
    var orderType = valueOf("trade-order-type");
    var action = valueOf("trade-action");
    var trail = numericOrNull("trade-trail");
    var trailUnit = valueOf("trade-trail-unit");
    var intent = {
      schema_version: 1,
      event_type: "advanced_order_intent",
      intent_id: "app_" + Date.now(),
      created_at: new Date().toISOString(),
      status: "draft",
      account_id: account ? (account.id || account.account) : valueOf("trade-account"),
      account_label: account ? account.account : valueOf("trade-account"),
      ownerEmail: account ? account.ownerEmail : principalEmail,
      sleeve: valueOf("trade-sleeve"),
      symbol: String(valueOf("trade-ticker") || "").trim().toUpperCase(),
      side: sideFromAction(action),
      action: action,
      asset_type: valueOf("trade-asset-type"),
      order_type: orderType,
      execution_route: routeForOrderType(orderType),
      session: valueOf("trade-session"),
      time_in_force: valueOf("trade-tif"),
      sizing_mode: valueOf("trade-sizing"),
      quantity: numericOrNull("trade-quantity"),
      notional_usd: numericOrNull("trade-notional"),
      target_portfolio_pct: numericOrNull("trade-percent"),
      limit_price: numericOrNull("trade-limit"),
      stop_price: numericOrNull("trade-stop"),
      trailing_amount: trailUnit === "amount" ? trail : null,
      trailing_percent: trailUnit === "percent" && trail != null ? trail / 100 : null,
      target_symbol: String(valueOf("trade-target-ticker") || "").trim().toUpperCase() || null,
      strategy: valueOf("trade-strategy"),
      execution_mode: valueOf("trade-execution-mode"),
      operator_id: valueOf("trade-operator"),
      originator: appEdition === "developer" ? "smartsleeve_developer_app" : "smartsleeve_user_app",
      notes: valueOf("trade-reason"),
      autoguard: {
        window_end_local: valueOf("trade-window-end") || null,
        margin_limit_usd: numericOrNull("trade-margin-limit"),
        broker_preview_required: true,
        account_guardrails_required: true
      },
      smartTrade: {
        enabled: isSmartTradeStrategy(valueOf("trade-strategy"), action),
        workflow: strategyLabels[valueOf("trade-strategy")] || valueOf("trade-strategy"),
        window_end_local: valueOf("trade-window-end") || null
      }
    };
    if (intent.order_type === "trailing_stop_limit" && intent.limit_price != null) {
      intent.limit_offset = intent.limit_price;
    }
    return intent;
  }

  function validateIntent(intent) {
    var account = selectedAccount();
    var broker = brokerKey(account);
    var errors = [];
    var warnings = [];
    var confirmations = [];
    if (!intent.account_id) errors.push("Choose an account before drafting the order intent.");
    if (!intent.sleeve) errors.push("Choose a sleeve so audit logs can attribute the trade.");
    if (!intent.symbol) errors.push("Enter a ticker symbol.");
    if (intent.action === "reallocate" && !intent.target_symbol) {
      warnings.push("Reallocation intents should name a target ticker.");
    }
    if (intent.sizing_mode === "quantity" && !(intent.quantity > 0)) {
      errors.push("Quantity sizing requires a positive share/contract quantity.");
    }
    if (intent.sizing_mode === "notional" && !(intent.notional_usd > 0)) {
      errors.push("Dollar sizing requires a positive dollar amount.");
    }
    if (intent.sizing_mode === "percent" && !(intent.target_portfolio_pct > 0)) {
      errors.push("Percent sizing requires a positive target portfolio percent.");
    }
    if ((intent.order_type === "limit" || intent.order_type === "stop_limit") && !(intent.limit_price > 0)) {
      errors.push("Limit and stop-limit intents require a positive limit price.");
    }
    if ((intent.order_type === "stop_market" || intent.order_type === "stop_limit") && !(intent.stop_price > 0)) {
      errors.push("Stop-loss and stop-limit intents require a positive stop price.");
    }
    if ((intent.order_type === "trailing_stop_market" || intent.order_type === "trailing_stop_limit") && !(intent.trailing_amount > 0 || intent.trailing_percent > 0)) {
      errors.push("Trailing stops require a positive trail amount or percent.");
    }
    if (intent.order_type === "trailing_stop_limit" && !(intent.limit_price > 0 || intent.limit_offset > 0)) {
      errors.push("Trailing stop-limit intents need a limit price or limit offset.");
    }
    var holding = currentHolding(intent.symbol);
    var observedPrice = holding && holding.avgPrice ? holding.avgPrice : null;
    if (observedPrice && intent.limit_price && intent.side === "buy" && intent.limit_price / observedPrice > 5) {
      warnings.push("The buy limit is far above the visible average/mark; Robinhood may treat that as extremely marketable or reject/cancel it.");
    }
    if (broker === "robinhood") {
      if (intent.session === "all_day") {
        confirmations.push("Robinhood 24 Hour Market is handled as overnight/all-day routing and only works for eligible securities.");
        if (intent.order_type !== "limit") {
          errors.push("Robinhood overnight/24-hour stock trading should use limit orders, not market/stop/trailing orders.");
        }
        if (intent.sizing_mode !== "quantity" || !(intent.quantity > 0) || Math.abs(intent.quantity - Math.round(intent.quantity)) > 0.000001) {
          errors.push("Robinhood overnight/24-hour orders should be whole-share quantity orders.");
        }
      } else if (intent.session === "extended") {
        if (intent.order_type === "market") {
          errors.push("Robinhood extended-hours stock orders should use limit orders; market orders are regular-session behavior.");
        }
        if (intent.order_type.indexOf("stop") !== -1 || intent.order_type.indexOf("trailing") !== -1) {
          warnings.push("Robinhood stop and trailing-stop orders generally trigger during regular market hours; use SmartSleeve supervision for off-hours protection.");
        }
        if (intent.sizing_mode !== "quantity") {
          warnings.push("Fractional/dollar extended-hours eligibility depends on Robinhood security/account support; server preview must confirm it.");
        }
      } else {
        confirmations.push("Regular-market Robinhood intents can use market, limit, stop, stop-limit, and trailing-stop style controls subject to broker preview.");
      }
      if (intent.time_in_force === "gtc") {
        confirmations.push("Robinhood GTC orders can stay open across sessions until filled, cancelled, or broker expiration.");
      }
    } else if (broker === "etrade") {
      if (intent.session !== "regular") {
        warnings.push("E*TRADE extended/all-day API routing is stricter: limit, day-only, and round-lot constraints may apply before preview.");
      }
      if (intent.order_type !== "market" && intent.order_type !== "limit") {
        warnings.push("Advanced E*TRADE intents may need a broker-native adapter or SmartSleeve synthetic supervisor.");
      }
    } else if (broker === "ibkr") {
      confirmations.push("IBKR supports richer order routing, but SmartSleeve still requires preview/reconcile and account-specific permission gates.");
    } else {
      warnings.push("Broker-specific rules are unknown for this account; server preview is mandatory.");
    }
    return {broker: broker, errors: errors, warnings: warnings, confirmations: confirmations};
  }

  function updateTradePreview() {
    var accountRow = selectedAccount();
    var intent = buildAdvancedIntent();
    var validation = validateIntent(intent);
    var notional = Number(intent.notional_usd) || 0;
    var preview = $("trade-preview");
    if (preview) {
      preview.innerHTML = [
      previewRow("Ticker", intent.symbol || "Needs ticker"),
      previewRow("Intent", intent.action + " / " + intent.side),
      previewRow("Strategy", strategyLabels[intent.strategy] || intent.strategy),
      previewRow("Quantity", intent.quantity == null ? "By sizing mode" : numberText(intent.quantity, 6)),
      previewRow("Estimated notional", money(notional)),
      previewRow("Account", intent.account_label || "Needs account"),
      previewRow("Sleeve", intent.sleeve || "Needs sleeve"),
      previewRow("Order type", orderTypeLabels[intent.order_type] || intent.order_type),
      previewRow("Session", sessionLabels[intent.session] || intent.session),
      previewRow("Time in force", intent.time_in_force),
      previewRow("Execution route", routeLabels[intent.execution_route] || intent.execution_route),
      previewRow("Execution mode", executionModeLabels[intent.execution_mode] || intent.execution_mode),
      previewRow("Portfolio weight after trade", accountTotal("equity") && notional ? pct(notional, accountTotal("equity")) + " before existing position adjustment" : "Needs notional"),
      previewRow("Estimated cash after buy", accountRow && numeric(accountRow.cash) != null ? money(accountRow.cash - notional) : "Needs broker cash"),
      previewRow("Compatibility", validation.errors.length ? "Fix required" : validation.warnings.length ? "Preview with warnings" : "Ready for server preview"),
      previewRow("Reason", intent.notes || "Needs reason"),
      previewRow("Source", intent.operator_id)
      ].join("");
    }
    renderCompatibility(validation);
    renderIntentJson(intent);
    return {intent: intent, validation: validation};
  }

  function renderCompatibility(validation) {
    var status = $("broker-rule-status");
    if (status) {
      status.textContent = validation.errors.length ? "Fix required" : validation.warnings.length ? "Warnings" : "Compatible";
      status.classList.toggle("warning", Boolean(validation.errors.length || validation.warnings.length));
    }
    var target = $("broker-compatibility");
    if (!target) return;
    var rows = [];
    validation.errors.forEach(function (message) {
      rows.push(stackItem("Fix before preview", "Required", message, 15, "compat-error"));
    });
    validation.warnings.forEach(function (message) {
      rows.push(stackItem("Preview warning", "Check", message, 55, "compat-warn"));
    });
    validation.confirmations.forEach(function (message) {
      rows.push(stackItem("Broker rule", validation.broker, message, 85, "compat-ok"));
    });
    target.innerHTML = rows.join("") || stackItem("Broker rule check", validation.broker, "This intent is ready for server-side broker preview and account guardrails.", 90, "compat-ok");
  }

  function renderIntentJson(intent) {
    var target = $("intent-json");
    if (target) {
      target.textContent = JSON.stringify(intent, null, 2);
    }
  }

  function createDraftOrder(event) {
    if (event) event.preventDefault();
    var built = updateTradePreview();
    var intent = built.intent;
    var validation = built.validation;
    if (validation.errors.length) {
      toast("Fix required broker/session fields before creating this intent.");
      return;
    }
    if (!checked("trade-confirm")) {
      toast("Confirm the order-intent acknowledgement first.");
      return;
    }
    var order = {
      id: intent.intent_id,
      time: new Date().toLocaleString(),
      account: intent.account_label,
      sleeve: intent.sleeve,
      ticker: intent.symbol + (intent.target_symbol ? " -> " + intent.target_symbol : ""),
      action: intent.action,
      notional: intent.notional_usd || 0,
      orderType: intent.order_type,
      limit: intent.limit_price,
      tif: intent.time_in_force,
      operator: intent.operator_id,
      status: "Awaiting approval",
      reason: intent.notes,
      intent: intent,
      validation: validation
    };
    state.draftOrders.unshift(order);
    persistDraftOrders();
    addActivity("Draft order created", order.operator, order.account, order.ticker + " " + order.action + " " + money(order.notional));
    renderDraftOrders();
    renderServerTrades();
    renderActivity();
    sendOrderNotification(order, "drafted");
    toast("Draft intent created. Broker preview and approval are still required.");
  }

  function renderDraftOrders() {
    var list = $("order-list");
    text("order-count", String(state.draftOrders.length));
    if (!list) return;
    list.innerHTML = state.draftOrders.map(function (order) {
      return "<article class=\"stack-item\">"
        + "<div class=\"stack-item-head\"><b>" + originBadges(order) + html(order.ticker + " " + order.action) + "</b><span>" + html(order.status) + "</span></div>"
        + "<p>" + html(order.account) + " / " + html(order.sleeve) + " / " + money(order.notional) + "</p>"
        + "<p>" + html(orderTypeLabel(order)) + (order.limit ? " limit " + html(order.limit) : "") + " / " + html(order.tif) + " / " + html(originLabel(order)) + "</p>"
        + "<div class=\"recommendation-actions\"><button type=\"button\" class=\"text-button\" data-order-action=\"preview\" data-order-id=\"" + html(order.id) + "\">Server preview</button><button type=\"button\" class=\"text-button\" data-order-action=\"copy\" data-order-id=\"" + html(order.id) + "\">Copy JSON</button><button type=\"button\" class=\"danger-button small\" data-order-action=\"reject\" data-order-id=\"" + html(order.id) + "\">Reject</button></div>"
        + "</article>";
    }).join("") || emptyItem("No draft orders", "Create a draft from the ticket or a Sage by SmartSleeve recommendation.");
  }

  function persistDraftOrders() {
    try {
      window.localStorage.setItem("smartsleeve_draft_order_intents", JSON.stringify(state.draftOrders.slice(0, 50)));
    } catch (_err) {
      // localStorage can be unavailable in locked-down webviews.
    }
  }

  function restoreDraftOrders() {
    try {
      var raw = window.localStorage.getItem("smartsleeve_draft_order_intents");
      var parsed = raw ? JSON.parse(raw) : [];
      state.draftOrders = Array.isArray(parsed) ? parsed.slice(0, 50) : [];
    } catch (_err) {
      state.draftOrders = [];
    }
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return Promise.reject(new Error("clipboard unavailable"));
  }

  function submitIntentToServer(intent) {
    if (!orderIntentEndpoint) {
      toast("Order-intent backend is not configured yet; draft is saved locally.");
      return Promise.resolve({ok: false, localOnly: true});
    }
    return authFetch(orderIntentEndpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({intent: intent})
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || "Server preview returned HTTP " + response.status);
        });
      }
      return response.json();
    });
  }

  function previewCurrentIntent() {
    var built = updateTradePreview();
    if (built.validation.errors.length) {
      toast("Fix required broker/session fields before server preview.");
      return;
    }
    if (!checked("trade-confirm")) {
      toast("Confirm the order-intent acknowledgement first.");
      return;
    }
    submitIntentToServer(built.intent)
      .then(function (result) {
        if (result && result.ok) {
          toast("Server accepted the order intent for preview.");
          addActivity("Order intent queued", built.intent.operator_id, built.intent.account_label, built.intent.symbol + " " + built.intent.order_type);
          sendOrderNotification(Object.assign({}, built.intent, {
            lifecycleSource: "preview",
            sourceLabel: "Server preview",
            account: built.intent.account_label,
            orderType: built.intent.order_type,
            limitPrice: built.intent.limit_price,
            notionalUsd: built.intent.notional_usd,
            timeInForce: built.intent.time_in_force,
            operatorId: built.intent.operator_id,
            placedAt: built.intent.created_at,
            status: "Server preview accepted"
          }), "queued");
          renderActivity();
        }
      })
      .catch(function (error) {
        toast("Server preview unavailable: " + error.message);
      });
  }

  function renderServerTrades() {
    var target = $("server-trade-history");
    if (!target) return;
    var rows = combinedOrderRows().slice(0, 60);
    if (!state.selectedTradeId && rows.length) {
      state.selectedTradeId = orderLifecycleId(rows[0]);
    }
    if (state.selectedTradeId && !rows.some(function (row) { return orderLifecycleId(row) === state.selectedTradeId; })) {
      state.selectedTradeId = rows.length ? orderLifecycleId(rows[0]) : null;
    }
    target.innerHTML = rows.map(function (order) {
      var id = orderLifecycleId(order);
      var selected = id === state.selectedTradeId;
      var title = orderLifecycleTitle(order);
      var meta = orderStatusLabel(order) + " / " + orderLifecycleTimestamp(order);
      var body = (order.account || order.accountId || "") + " / " + money(orderNotional(order)) + " / " + orderTypeLabel(order);
      var price = orderSharePrice(order);
      var quantity = orderQuantity(order);
      var right = originLabel(order) + " / " + (quantity == null ? "shares sync" : numberText(quantity, 6) + " sh") + " / " + (price == null ? "price sync" : money(price));
      return "<button type=\"button\" class=\"trade-row" + (selected ? " active" : "") + "\" data-server-trade-id=\"" + html(id) + "\">"
        + "<span><b>" + originBadges(order) + html(title) + "</b><small>" + html(body) + "</small><small>" + html(meta) + "</small></span>"
        + "<i>" + html(right) + "</i>"
        + "</button>";
    }).join("") || emptyItem("No order history", "Draft orders, broker statuses, and completed execution records will appear here.");
    renderTradeDetail();
  }

  function combinedOrderRows() {
    var drafts = state.draftOrders.map(function (order) {
      var intent = order.intent || {};
      return Object.assign({}, intent, order, {
        lifecycleSource: "draft",
        sourceLabel: "Local draft",
        id: order.id || intent.intent_id,
        orderId: order.orderId || intent.order_id,
        account: order.account || intent.account_label,
        accountId: intent.account_id,
        sleeve: order.sleeve || intent.sleeve,
        symbol: intent.symbol || order.ticker,
        targetSymbol: intent.target_symbol,
        side: intent.side || sideFromAction(order.action),
        action: order.action || intent.action,
        quantity: intent.quantity,
        notionalUsd: order.notional != null ? order.notional : intent.notional_usd,
        orderType: order.orderType || intent.order_type,
        limitPrice: order.limit != null ? order.limit : intent.limit_price,
        timeInForce: order.tif || intent.time_in_force,
        session: intent.session,
        operatorId: order.operator || intent.operator_id,
        placedAt: intent.created_at || order.time,
        submittedAt: intent.created_at || order.time,
        status: order.status || intent.status || "Draft"
      });
    });
    var trades = visibleRows(state.serverTrades).map(function (trade) {
      return Object.assign({}, trade, {
        lifecycleSource: "server",
        sourceLabel: "Broker/analytics feed",
        placedAt: trade.placedAt || trade.placed_at || trade.submittedAt || trade.submitted_at,
        executedAt: trade.executedAt || trade.executed_at || trade.filledAt || trade.filled_at || trade.completedAt || trade.completed_at,
        canceledAt: trade.canceledAt || trade.canceled_at
      });
    });
    return drafts.concat(trades).sort(function (a, b) {
      return timestampMs(orderLifecycleTimestamp(b)) - timestampMs(orderLifecycleTimestamp(a));
    });
  }

  function timestampMs(value) {
    var parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function orderLifecycleId(order) {
    return String((order.lifecycleSource || "server") + ":" + (order.id || order.orderId || order.order_id || order.intent_id || [order.accountId || order.account, order.submittedAt || order.submitted_at || order.placedAt, order.symbol, order.side].join("|")));
  }

  function tradeId(trade) {
    return String(trade.id || trade.orderId || trade.order_id || [trade.accountId || trade.account, trade.submittedAt || trade.submitted_at, trade.symbol, trade.side].join("|"));
  }

  function tradeTitle(trade) {
    var side = String(trade.side || trade.action || "?").toUpperCase();
    var symbol = trade.symbol || "?";
    if (trade.targetSymbol || trade.target_symbol) {
      return "REALLOCATE " + symbol + " -> " + (trade.targetSymbol || trade.target_symbol);
    }
    return side + " " + symbol;
  }

  function orderLifecycleTitle(order) {
    var target = order.targetSymbol || order.target_symbol;
    var symbol = String(order.symbol || order.ticker || "?").toUpperCase();
    if (target) {
      return "REALLOCATE " + symbol + " -> " + String(target).toUpperCase();
    }
    return orderTypeLabel(order) + " " + symbol;
  }

  function orderTypeLabel(order) {
    var side = String(order.side || sideFromAction(order.action) || "").toLowerCase();
    var type = order.orderType || order.order_type || "order";
    var base = orderTypeLabels[type] || String(type).replace(/_/g, " ");
    if (side === "buy" || side === "sell") {
      return base + " " + side;
    }
    if (String(order.action || "").toLowerCase() === "reallocate") {
      return base + " reallocation";
    }
    return base;
  }

  function orderStatusLabel(order) {
    return order.status || order.orderStatus || order.order_status || "submitted_or_recorded";
  }

  function orderLifecycleTimestamp(order) {
    var status = String(orderStatusLabel(order)).toLowerCase();
    if (status.indexOf("cancel") !== -1 && (order.canceledAt || order.canceled_at)) return order.canceledAt || order.canceled_at;
    if ((status.indexOf("fill") !== -1 || status.indexOf("complete") !== -1 || status.indexOf("execut") !== -1) && (order.executedAt || order.executed_at || order.filledAt || order.filled_at || order.completedAt || order.completed_at)) {
      return order.executedAt || order.executed_at || order.filledAt || order.filled_at || order.completedAt || order.completed_at;
    }
    return order.submittedAt || order.submitted_at || order.placedAt || order.placed_at || order.time || "time unknown";
  }

  function orderExecutionText(order) {
    var status = orderStatusLabel(order);
    var executed = order.executedAt || order.executed_at || order.filledAt || order.filled_at || order.completedAt || order.completed_at;
    var canceled = order.canceledAt || order.canceled_at;
    if (canceled) return "Canceled: " + canceled;
    if (executed) return "Executed: " + executed;
    return status;
  }

  function orderQuantity(order) {
    return numeric(order.quantity != null ? order.quantity : order.filledQuantity != null ? order.filledQuantity : order.filled_quantity);
  }

  function orderNotional(order) {
    var explicit = numeric(order.notionalUsd != null ? order.notionalUsd : order.notional_usd);
    if (explicit != null) return explicit;
    var quantity = orderQuantity(order);
    var price = orderSharePrice(order);
    return quantity != null && price != null ? quantity * price : null;
  }

  function orderSharePrice(order) {
    var price = numeric(order.limitPrice != null ? order.limitPrice : order.limit_price);
    if (price != null) return price;
    price = numeric(order.averageFillPrice != null ? order.averageFillPrice : order.average_fill_price);
    if (price != null) return price;
    var notional = numeric(order.notionalUsd != null ? order.notionalUsd : order.notional_usd);
    var quantity = orderQuantity(order);
    return notional != null && quantity ? notional / quantity : null;
  }

  function workflowLabel(trade) {
    var workflow = trade.workflow || trade.command || trade.strategy;
    var smartTrade = trade.smartTrade || trade.smart_trade || {};
    if (smartTrade.enabled && smartTrade.workflow) return String(smartTrade.workflow).replace(/smarttrade/gi, "SmartTrade").replace(/autoguard/gi, "AutoGuard");
    if (smartTrade.enabled) return "SmartTrade execution";
    if (workflow && strategyLabels[workflow]) return strategyLabels[workflow];
    if (workflow) return String(workflow).replace(/smarttrade/gi, "SmartTrade").replace(/autoguard/gi, "AutoGuard");
    if (isSmartTrade(trade)) return "SmartTrade execution";
    if (trade.autoGuardMode || trade.autoGuardEndAt) return "AutoGuard supervised";
    var origin = String(trade.origin || trade.operatorId || trade.operator_id || "").toLowerCase();
    return origin.indexOf("sage") !== -1 || origin.indexOf("custom_sage") !== -1 ? "Sage-directed order" : "Manual/direct order";
  }

  function renderTradeDetail() {
    var panel = $("trade-detail-panel");
    var status = $("trade-detail-status");
    if (!panel) return;
    var trade = combinedOrderRows().find(function (row) { return orderLifecycleId(row) === state.selectedTradeId; });
    if (!trade) {
      panel.innerHTML = emptyItem("Select an order", "Choose an order or completed trade to inspect lifecycle details and retrospective diagnostics.");
      if (status) status.textContent = "Select order";
      return;
    }
    var evaluation = trade.evaluation || {};
    var evalStatus = evaluation.status || retrospectiveStatus(trade);
    if (status) status.textContent = orderStatusLabel(trade);
    var symbol = String(trade.symbol || trade.ticker || "?").split(" ")[0].toUpperCase();
    var targetSymbol = trade.targetSymbol || trade.target_symbol;
    var company = tickerNames[symbol] || "Needs security master sync";
    var quantity = orderQuantity(trade);
    var sharePrice = orderSharePrice(trade);
    var notional = orderNotional(trade);
    panel.innerHTML = ""
      + "<div class=\"trade-detail-title\"><h3>" + originBadges(trade) + html(orderLifecycleTitle(trade)) + "</h3><span>" + html(evalStatus) + "</span></div>"
      + "<div class=\"detail-grid\">"
      + detailItem("Placed by", originLabel(trade))
      + detailItem("Order type", orderTypeLabel(trade))
      + detailItem("Ticker", targetSymbol ? symbol + " -> " + targetSymbol : symbol)
      + detailItem("Company", company)
      + detailItem("# shares", quantity == null ? "Needs broker fill sync" : numberText(quantity, 6))
      + detailItem("Share price", sharePrice == null ? "Needs price/fill sync" : money(sharePrice))
      + detailItem("Total cash value", money(notional))
      + detailItem("Placement timestamp", trade.placedAt || trade.placed_at || trade.submittedAt || trade.submitted_at || trade.time || "Unknown")
      + detailItem("Execution timestamp/status", orderExecutionText(trade))
      + detailItem("Status", orderStatusLabel(trade))
      + detailItem("Lifecycle source", trade.sourceLabel || trade.lifecycleSource || "Analytics feed")
      + detailItem("Workflow", workflowLabel(trade))
      + detailItem("Account", trade.account || trade.accountId || "Unknown")
      + detailItem("Sleeve", trade.sleeve || trade.sleeveId || "Unknown")
      + detailItem("Session", sessionLabels[trade.session] || trade.session || "Unknown")
      + detailItem("Time in force", trade.timeInForce || trade.time_in_force || "Needs broker sync")
      + detailItem("Order ID", trade.orderId || trade.order_id || "Needs broker sync")
      + detailItem("AutoGuard mode", trade.autoGuardMode || trade.auto_guard_mode || "Not used")
      + detailItem("AutoGuard / SmartTrade end", trade.autoGuardEndAt || trade.auto_guard_end_at || "Not windowed")
      + "</div>"
      + "<article class=\"trade-rationale\"><b>Rationale</b><p>" + html(trade.rationale || "No rationale recorded for this trade.") + "</p></article>"
      + renderRetrospectiveDiagnostics(trade);
  }

  function detailItem(label, value) {
    return "<div class=\"detail-item\"><span>" + html(label) + "</span><b>" + html(value) + "</b></div>";
  }

  function retrospectiveStatus(trade) {
    if (!(trade.autoGuardMode || trade.autoGuardEndAt || trade.workflow)) {
      return "Manual/no HEB";
    }
    if (!trade.autoGuardEndAt) {
      return "Needs end time";
    }
    var end = new Date(trade.autoGuardEndAt).getTime();
    if (Number.isFinite(end) && Date.now() < end) {
      return "Pending window";
    }
    return "Awaiting yFinance evaluation";
  }

  function renderRetrospectiveDiagnostics(trade) {
    var evaluation = trade.evaluation || {};
    var hasHeb = numeric(evaluation.hindsightEfficientBasisPct) != null;
    var hasCapture = numeric(evaluation.basisCapturePct) != null;
    var hasSaved = numeric(evaluation.savedUsd) != null;
    if (!hasHeb && !hasCapture && !hasSaved) {
      return "<article class=\"trade-rationale\"><b>Retrospective diagnostics</b><p>" + html(retrospectiveExplainer(trade)) + "</p></article>";
    }
    return "<div class=\"gauge-grid trade-gauge-grid\">"
      + gaugeCard("HEB", clampPct(evaluation.hindsightEfficientBasisPct), "Hindsight Efficient Basis percent after the trade window closes.")
      + gaugeCard("SmartTrade", clampPct(evaluation.basisCapturePct), "Basis capture versus the best achievable retrospective entry/exit/reallocation.")
      + "<article class=\"gauge-card\"><span>You saved</span><h3>" + html(money(evaluation.savedUsd)) + "</h3><p>Estimated improvement from SmartTrade or AutoGuard versus immediate/manual baseline, using " + html(evaluation.dataSource || "yFinance") + " data.</p></article>"
      + "</div>";
  }

  function clampPct(value) {
    var number = numeric(value);
    if (number == null) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function retrospectiveExplainer(trade) {
    if (!(trade.autoGuardMode || trade.autoGuardEndAt || trade.workflow)) {
      return "This looks like a manual/direct order. HEB, basis capture, and savings diagnostics are reserved for Sage SmartTrade entries, exits, reallocations, and AutoGuard windows.";
    }
    if (trade.autoGuardEndAt && Date.now() < new Date(trade.autoGuardEndAt).getTime()) {
      return "SmartTrade/AutoGuard diagnostics will unlock after the specified end time, once retrospective market data are available.";
    }
    return "The trade is eligible for retrospective HEB and basis-capture evaluation, but no completed yFinance evaluation has been archived yet.";
  }

  function renderActivity() {
    var list = $("activity-log");
    if (!list) return;
    list.innerHTML = state.activity.slice(0, 8).map(function (item) {
      return stackItem(item.event, item.operator + " / " + item.account, item.detail + " / " + item.time, 50);
    }).join("") || emptyItem("No activity yet", "Draft, approve, reject, or sync an order to create audit entries.");
  }

  function renderSage() {
    var modeList = $("sage-modes");
    if (modeList) {
      modeList.innerHTML = sageModes.map(function (mode) {
        return "<label class=\"mode-row\"><input type=\"radio\" name=\"sage-mode\" value=\"" + html(mode[0]) + "\"" + (mode[0] === state.sageMode ? " checked" : "") + "><span><b>" + html(mode[1]) + "</b><br>" + html(mode[2]) + "</span></label>";
      }).join("");
    }
    var currentMode = sageModes.find(function (mode) { return mode[0] === state.sageMode; }) || sageModes[1];
    text("sage-mode-status", currentMode[1]);
    renderSageReview();
    renderRecommendations();
    renderBrain();
    var gauges = $("basis-gauges");
    if (gauges) {
      gauges.innerHTML = basisCapture.map(function (item) { return gaugeCard(item[0], item[1], item[2]); }).join("");
    }
  }

  function renderSageReview() {
    var review = $("sage-review");
    if (!review) return;
    var total = accountTotal("equity");
    var top = state.holdings[0];
    var mu = state.holdings.find(function (item) { return item.symbol === "MU"; });
    var sndk = state.holdings.find(function (item) { return item.symbol === "SNDK"; });
    var semiValue = (mu ? mu.value : 0) + (sndk ? sndk.value : 0);
    review.innerHTML = [
      stackItem("Current value", money(total), "Tracked account equity in this app scope.", 80),
      stackItem("Largest position", top ? top.symbol + " / " + pct(top.value, total) : "Needs holdings", top ? thesisStatus(top.symbol, top.value / total) : "Connect broker.", top ? top.value / total * 100 : 0),
      stackItem("MU plus SNDK", money(semiValue) + " / " + pct(semiValue, total), "Semiconductor pair is the first concentration review target.", semiValue && total ? semiValue / total * 100 : 0),
      stackItem("Data gap", "Daily P/L and cost basis", "Enable broker P/L and basis sync before judging contributors, detractors, and total return.", 35)
    ].join("");
  }

  function renderRecommendations() {
    var cards = $("sage-recommendations");
    if (!cards) return;
    cards.innerHTML = state.recommendations.map(function (rec) {
      return recommendationCard(rec);
    }).join("");
  }

  function renderRecommendationsPage() {
    var list = $("recommendations-page-list");
    var context = $("recommendations-page-context");
    if (list) {
      list.innerHTML = state.recommendations.map(recommendationCard).join("")
        || emptyItem("No recommendations", "Sage has no open recommendations in the current scoped feed.");
    }
    if (context) {
      var total = accountTotal("equity");
      context.innerHTML = [
        stackItem("Portfolio scope", money(total), appEdition === "developer" ? "Developer view may include multiple users depending on filters." : "This view is restricted to " + (principalEmail || "the signed-in user") + ".", 80),
        stackItem("Buying power", money(accountTotal("buyPower")), "Available buying power helps determine whether entries can begin before exits fully complete.", 60),
        stackItem("Review discipline", state.recommendations.length + " open", "Create drafts from recommendations, then preview broker/session compatibility before any live placement.", state.recommendations.length ? 70 : 20)
      ].join("");
    }
  }

  function recommendationCard(rec) {
    return "<article class=\"recommendation-card\"><span>" + html(displayLabel(rec.operator, "SAGE_RECOMMEND")) + "</span><h3>" + html(displayLabel(rec.title, "Recommendation")) + "</h3><p><b>" + html(displayLabel(rec.action, "Review")) + "</b> / " + html(displayLabel(rec.account, "Account")) + " / " + html(displayLabel(rec.ticker, "Portfolio")) + "</p><p>" + html(displayLabel(rec.reason, "Review the current portfolio feed.")) + "</p><p>Main risk: " + html(displayLabel(rec.risk, "Needs review before trading.")) + "</p><div class=\"recommendation-actions\"><button type=\"button\" class=\"text-button\" data-rec-draft=\"" + html(rec.id) + "\">Create draft</button><button type=\"button\" class=\"danger-button small\" data-rec-dismiss=\"" + html(rec.id) + "\">Reject</button></div></article>";
  }

  function renderBrain() {
    var target = $("brain-decisions");
    if (!target) return;
    target.innerHTML = visibleRows(state.brain).slice(0, 9).map(function (row) {
      var forecasts = (row.topForecasts || row.top_forecasts || []).slice(0, 3).map(function (item) { return item.symbol; }).filter(Boolean).join(", ");
      return "<article class=\"recommendation-card\"><span>" + html(row.account || row.accountId || "") + "</span><h3>" + html(row.sleeve || row.sleeveId || "Sleeve decision") + "</h3><p>Approved " + html(row.approvedOrderCount != null ? row.approvedOrderCount : row.approved_order_count || 0) + " / proposed " + html(row.proposedOrderCount != null ? row.proposedOrderCount : row.proposed_order_count || 0) + " / blocked " + html(row.blockedOrderCount != null ? row.blockedOrderCount : row.blocked_order_count || 0) + "</p><p>Top forecasts: " + html(forecasts || "none in latest cycle") + "</p><p>Generated: " + html(row.generatedAt || row.timestamp || "unknown") + "</p></article>";
    }).join("") || emptyItem("No brain feed", "Latest decision_summary events are not available for this user/account yet.");
  }

  function renderRisk() {
    var total = accountTotal("equity");
    var top = state.holdings[0];
    var topThree = state.holdings.slice(0, 3).reduce(function (sum, item) { return sum + item.value; }, 0);
    text("largest-position", top ? top.symbol + " " + pct(top.value, total) : "Needs holdings");
    text("largest-position-note", top ? money(top.value) + " in " + top.name : "Connect a broker to calculate.");
    text("top-three-risk", pct(topThree, total));
    text("risk-margin", marginUsed() ? money(marginUsed()) : "$0");
    text("broker-health", state.accounts.length + " synced");
    var actions = $("risk-actions");
    if (actions) {
      actions.innerHTML = state.recommendations.slice(0, 5).map(function (rec) {
        return stackItem(rec.title, rec.action + " / " + rec.ticker, rec.risk, rec.action === "Rebalance" ? 85 : 55);
      }).join("");
    }
    var brokerConnections = $("broker-connections");
    if (brokerConnections) {
      var connected = state.accounts.map(function (account) {
        return stackItem(account.broker, account.status || "Connected", account.account + " last snapshot " + (account.generatedAt || "unknown"), 80);
      });
      connected.unshift(stackItem("Daemon outage alerts", "Watchdog covered", "IBKR Gateway, RH/E*TRADE auth, daemon crashes, and abnormal stops use the shared phone/email alert path.", 80));
      connected.push(stackItem("Fidelity via Plaid", "Pending production access / read-only", "Sandbox keys cannot view John's live Fidelity accounts until production consent is approved.", 30));
      connected.push(stackItem("Schwab PCRA", "Pending official API onboarding", "Use read-only mode first; trading permission must be explicit.", 20));
      brokerConnections.innerHTML = connected.join("");
    }
    var table = $("risk-account-table");
    if (table) {
      table.innerHTML = state.accounts.map(function (account) {
        var cash = numeric(account.cash) || 0;
        return "<tr>"
          + cell("Account", "<b>" + html(account.account) + "</b>")
          + cell("Broker", html(account.broker))
          + cell("Equity", money(account.equity))
          + cell("Cash", "<span class=\"" + (cash < 0 ? "negative" : "positive") + "\">" + money(cash) + "</span>")
          + cell("Buying power", money(account.buyPower))
          + cell("Risk note", cash < 0 ? "Margin balance, review buffer" : "Cash non-negative")
          + "</tr>";
      }).join("");
    }
  }

  function renderAll() {
    state.sleeves = buildSleeves(state.accounts);
    state.recommendations = buildRecommendations();
    if (state.feedWarning) {
      state.recommendations.unshift(state.feedWarning);
    }
    renderSession();
    renderDashboard();
    renderSleeves();
    renderStockPicks();
    renderRecommendationsPage();
    renderTradeCenter();
    renderSage();
    renderRisk();
  }

  function stackItem(title, meta, body, progress, className) {
    var classes = String(className || "");
    var showProgress = classes.split(/\s+/).indexOf("with-progress") !== -1;
    return "<article class=\"stack-item " + html(classes) + "\"><div class=\"stack-item-head\"><b>" + html(title) + "</b><span>" + html(meta) + "</span></div><p>" + html(body) + "</p>"
      + (showProgress ? "<div class=\"progress-bar\" style=\"--value:" + Math.max(0, Math.min(100, Number(progress) || 0)) + "%\"><i></i></div>" : "")
      + "</article>";
  }

  function emptyItem(title, body) {
    return stackItem(title, "Action needed", body, 15);
  }

  function cell(label, content) {
    return "<td data-label=\"" + html(label) + "\">" + content + "</td>";
  }

  function pnlCell(value, missingText) {
    var number = numeric(value);
    if (number == null) {
      return "<span class=\"needs-sync\">" + html(missingText || "Needs sync") + "</span>";
    }
    return "<span class=\"" + valueClass(number) + "\">" + signedMoney(number) + "</span>";
  }

  function updateReallocationPreview() {
    var preview = $("reallocation-preview");
    if (!preview) return;
    var notional = numeric(valueOf("reallocation-notional")) || 0;
    var horizon = valueOf("reallocation-window") || "same_day";
    var source = String(valueOf("reallocation-source") || "Source").toUpperCase();
    var target = String(valueOf("reallocation-target") || "Target").toUpperCase();
    var targetTiming = targetTimingPlan(target);
    var sourceTiming = sourceExitTimingPlan(source);
    var funding = reallocationFundingPlan(notional);
    var horizonPenalty = {same_day: 22, two_day: 14, week: 8, patient: 4}[horizon] || 12;
    var concentrationPenalty = state.holdings.slice(0, 3).some(function (holding) {
      return holding.symbol === source;
    }) ? 8 : 3;
    var timingPenalty = (targetTiming.bias === "wait" || sourceTiming.bias === "wait") ? -8 : (targetTiming.bias === "urgent" || sourceTiming.bias === "urgent") ? 8 : 0;
    var basisRisk = Math.min(90, Math.max(5, horizonPenalty + concentrationPenalty + Math.min(20, notional / 1000)));
    basisRisk = Math.min(90, Math.max(5, basisRisk + timingPenalty));
    var capture = Math.max(15, 100 - basisRisk);
    var patience = horizon === "same_day"
      ? "Sage would prefer at least a two-day SmartTrade window unless the risk exit is urgent."
      : horizon === "patient"
        ? "Patient window selected; Sage can prioritize basis capture over immediacy."
        : "Window gives Sage some room to avoid rushed basis loss.";
    preview.innerHTML = [
      previewRow("Source", source),
      previewRow("Target", target),
      previewRow("Amount", money(notional)),
      previewRow("Latest deadline", targetTiming.deadlineLabel),
      previewRow("Source trend", sourceTiming.trendLabel),
      previewRow("Exit timing stance", sourceTiming.stance),
      previewRow("Target trend", targetTiming.trendLabel),
      previewRow("Entry timing stance", targetTiming.stance),
      previewRow("Buying-power dependency", funding.label),
      previewRow("Estimated basis-risk drag", basisRisk.toFixed(0) + " / 100"),
      previewRow("Estimated basis capture", capture.toFixed(0) + "%"),
      "<p>" + html(patience) + "</p>",
      "<p>" + html(sourceTiming.plan) + "</p>",
      "<p>" + html(targetTiming.plan) + "</p>",
      "<p>" + html(funding.plan) + "</p>",
      "<p>Settlement, buying-power, and margin constraints still require server-side broker preview before any live order.</p>"
    ].join("");
  }

  function selectedReallocationAccount() {
    var accountName = valueOf("reallocation-account");
    return state.accounts.find(function (item) { return item.account === accountName; }) || null;
  }

  function reallocationFundingPlan(notional) {
    var account = selectedReallocationAccount();
    var buyingPower = account ? numeric(account.buyPower) : null;
    var cash = account ? numeric(account.cash) : null;
    if (buyingPower != null && buyingPower >= notional && notional > 0) {
      return {
        label: "Entry can run in parallel",
        plan: "Existing buying power appears sufficient for the open-position leg, so Sage can start target entries independently while waiting for a better source exit peak/plateau."
      };
    }
    if (buyingPower != null && buyingPower > 0) {
      return {
        label: "Partial parallel entry",
        plan: "Some buying power is available, so Sage can stage a partial target entry before the source exit cash settles; the remaining entry still depends on close-leg proceeds or deadline pressure."
      };
    }
    if (cash != null && cash < 0) {
      return {
        label: "Margin/buffer constrained",
        plan: "This account appears margin constrained. Sage should not assume the target entry can precede the source exit; broker preview and margin buffer dominate timing."
      };
    }
      return {
        label: "Exit-chunk funded",
        plan: "No sufficient free buying power is visible, but Sage can still open the target in chunks funded by already-completed source exit chunks. That capacity is optional, not mandatory: if the target still lacks a good entry, Sage should reserve the proceeds rather than spend them immediately."
      };
  }

  function targetTimingPlan(symbol) {
    var deadline = parseLocalDateTime(valueOf("reallocation-deadline"));
    var now = new Date();
    var minutesLeft = deadline ? Math.max(0, (deadline.getTime() - now.getTime()) / 60000) : null;
    var history = targetPriceHistory(symbol);
    var trend = priceTrend(history);
    var deadlineLabel = deadline ? deadline.toLocaleString([], {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : "No deadline set";
    if (!history.length) {
      return {
        bias: minutesLeft != null && minutesLeft < 90 ? "urgent" : "neutral",
        deadlineLabel: deadlineLabel,
        trendLabel: "Needs live quote/history",
        stance: minutesLeft != null && minutesLeft < 90 ? "Deadline close: prepare preview now" : "Collect live target tape before buying",
        plan: "Sage does not have enough target-price history in the app feed to call momentum. Pull the latest daemon cycle, then use a broker preview or limit ladder rather than a blind market buy."
      };
    }
    var room = minutesLeft == null ? "unknown time" : minutesLeft < 60 ? "less than 1 hour" : Math.round(minutesLeft / 60) + " hours";
    if (trend.direction === "down" && minutesLeft != null && minutesLeft >= 90) {
      return {
        bias: "wait",
        deadlineLabel: deadlineLabel,
        trendLabel: trend.label,
        stance: "Watch and wait for a better entry",
        plan: symbol + " is drifting down and there is " + room + " before the deadline. Sage should stage the entry in chunks, watch for deceleration, stabilization, or a limit fill near the lower band before committing the rest, and avoid market-buying just because the reallocation exists."
      };
    }
    if (trend.direction === "down") {
      return {
        bias: "urgent",
        deadlineLabel: deadlineLabel,
        trendLabel: trend.label,
        stance: "Deadline close: use staged limit preview",
        plan: symbol + " is still trending down, but the deadline is close. Sage should prefer a small staged/limit entry with broker preview over waiting indefinitely or using a market order."
      };
    }
    if (trend.direction === "flat") {
      return {
        bias: "neutral",
        deadlineLabel: deadlineLabel,
        trendLabel: trend.label,
        stance: "Wait for confirmation or limit fill",
        plan: symbol + " is not showing a decisive target-entry discount in the available feed. Sage can place the emphasis on limit discipline and broker-preview constraints."
      };
    }
    return {
      bias: "neutral",
      deadlineLabel: deadlineLabel,
      trendLabel: trend.label,
      stance: "Do not chase without price discipline",
      plan: symbol + " is firming in the available feed. Sage should avoid assuming a discount remains available and should use limits/staging if the reallocation still makes sense."
    };
  }

  function sourceExitTimingPlan(symbol) {
    var deadline = parseLocalDateTime(valueOf("reallocation-deadline"));
    var now = new Date();
    var minutesLeft = deadline ? Math.max(0, (deadline.getTime() - now.getTime()) / 60000) : null;
    var history = targetPriceHistory(symbol);
    var trend = priceTrend(history);
    var deadlineLabel = deadline ? deadline.toLocaleString([], {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : "No deadline set";
    if (!history.length) {
      return {
        bias: minutesLeft != null && minutesLeft < 90 ? "urgent" : "neutral",
        deadlineLabel: deadlineLabel,
        trendLabel: "Needs live quote/history",
        stance: minutesLeft != null && minutesLeft < 90 ? "Deadline close: prepare close preview now" : "Collect live source tape before selling",
        plan: "Sage does not have enough source-price history in the app feed to call exit momentum. Pull the latest daemon cycle, then prefer broker preview and limit discipline rather than a blind market sell."
      };
    }
    var room = minutesLeft == null ? "unknown time" : minutesLeft < 60 ? "less than 1 hour" : Math.round(minutesLeft / 60) + " hours";
    if (trend.direction === "up" && minutesLeft != null && minutesLeft >= 90) {
      return {
        bias: "wait",
        deadlineLabel: deadlineLabel,
        trendLabel: trend.label,
        stance: "Watch and wait for a better exit",
        plan: symbol + " is rising and there is " + room + " before the deadline. Sage should stage the close leg in chunks, wait for peak/plateau evidence before selling the rest, and still respect the deadline."
      };
    }
    if (trend.direction === "up") {
      return {
        bias: "urgent",
        deadlineLabel: deadlineLabel,
        trendLabel: trend.label,
        stance: "Deadline close: use staged limit exit",
        plan: symbol + " is rising, but the deadline is close. Sage should prefer a staged/limit sell preview over waiting indefinitely for a perfect peak."
      };
    }
    if (trend.direction === "flat") {
      return {
        bias: "neutral",
        deadlineLabel: deadlineLabel,
        trendLabel: trend.label,
        stance: "Plateau forming: exit can be previewed",
        plan: symbol + " looks closer to a plateau in the available feed. Sage can consider previewing the close leg with limit discipline if the reallocation still makes sense."
      };
    }
    return {
      bias: "neutral",
      deadlineLabel: deadlineLabel,
      trendLabel: trend.label,
      stance: "Do not delay exit solely for price",
      plan: symbol + " is not rising in the available feed. Sage should not wait for a peak that is not currently forming; deadline, risk, and target-entry quality should dominate."
    };
  }

  function parseLocalDateTime(value) {
    if (!value) return null;
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function targetPriceHistory(symbol) {
    var normalized = String(symbol || "").toUpperCase();
    if (!normalized) return [];
    var rows = (state.history.positions || []).filter(function (row) {
      return String(row.symbol || row.ticker || "").toUpperCase() === normalized;
    }).map(function (row) {
      var value = numeric(row.price != null ? row.price : row.markPrice != null ? row.markPrice : row.market_price != null ? row.market_price : row.currentPrice != null ? row.currentPrice : row.current_price);
      if (value == null) {
        var shares = numeric(row.shares != null ? row.shares : row.quantity);
        var marketValue = numeric(row.value != null ? row.value : row.marketValue != null ? row.marketValue : row.market_value_usd);
        value = shares ? marketValue / shares : null;
      }
      return {at: new Date(row.at || row.timestamp || row.generatedAt || row.generated_at || 0), price: value};
    }).filter(function (point) {
      return point.price != null && !Number.isNaN(point.at.getTime());
    }).sort(function (a, b) {
      return a.at - b.at;
    });
    var holding = state.holdings.find(function (row) { return row.symbol === normalized; });
    if (holding && numeric(holding.price) != null) {
      rows.push({at: new Date(), price: numeric(holding.price)});
    }
    return rows.slice(-12);
  }

  function priceTrend(points) {
    if (!points.length) return {direction: "unknown", label: "Needs live quote/history"};
    var first = points[0].price;
    var last = points[points.length - 1].price;
    var changePct = first ? (last - first) / first * 100 : 0;
    var lastThree = points.slice(-3);
    var fallingSteps = 0;
    for (var i = 1; i < lastThree.length; i += 1) {
      if (lastThree[i].price < lastThree[i - 1].price) fallingSteps += 1;
    }
    var label = money(last) + " / " + (changePct >= 0 ? "+" : "") + changePct.toFixed(2) + "% recent feed";
    if (changePct < -0.8 || fallingSteps >= 2) return {direction: "down", label: label + " / falling"};
    if (Math.abs(changePct) < 0.35) return {direction: "flat", label: label + " / stabilizing"};
    return {direction: "up", label: label + " / firming"};
  }

  function shortDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleDateString("en-US", {month: "short", day: "numeric"});
  }

  function compactMoney(value) {
    var number = numeric(value);
    if (number == null) return "$0";
    var abs = Math.abs(number);
    if (abs >= 1000000) return "$" + (number / 1000000).toFixed(abs >= 10000000 ? 0 : 1) + "M";
    if (abs >= 1000) return "$" + (number / 1000).toFixed(abs >= 10000 ? 0 : 1) + "K";
    return "$" + number.toFixed(abs >= 100 ? 0 : 2);
  }

  function lineChartCard(title, meta, points, valueKey, yLabel, pnlValue) {
    var cleanPoints = (points || []).map(function (point) {
      return {
        at: point.at,
        value: numeric(point[valueKey])
      };
    }).filter(function (point) { return point.at && point.value != null; }).sort(function (a, b) {
      return new Date(a.at).getTime() - new Date(b.at).getTime();
    });
    if (!cleanPoints.length) {
      return emptyItem(title, "No synced history yet.");
    }
    var first = cleanPoints[0];
    var last = cleanPoints[cleanPoints.length - 1];
    var trend = numeric(pnlValue);
    if (trend == null && cleanPoints.length > 1) trend = last.value - first.value;
    var trendClass = valueClass(trend);
    var lineColor = trendClass === "negative" ? "var(--red)" : "var(--green)";
    var chart = buildLineChart(cleanPoints, lineColor, yLabel);
    var sub = cleanPoints.length > 1
      ? shortDate(first.at) + " to " + shortDate(last.at) + " / " + signedMoney(last.value - first.value)
      : "One synced point / more history needed";
    return "<article class=\"chart-card\">"
      + "<div class=\"stack-item-head\"><b>" + html(title) + "</b><span class=\"" + trendClass + "\">" + html(sub) + "</span></div>"
      + "<p>" + html(meta) + " / latest " + html(money(last.value)) + "</p>"
      + chart
      + "</article>";
  }

  function buildLineChart(points, lineColor, yLabel, options) {
    options = options || {};
    var width = 420;
    var height = 220;
    var left = options.compact ? 18 : 58;
    var right = 18;
    var top = 18;
    var bottom = options.compact ? 28 : 46;
    var values = points.map(function (point) { return point.value; });
    var minValue = Math.min.apply(Math, values);
    var maxValue = Math.max.apply(Math, values);
    if (minValue === maxValue) {
      var pad = Math.max(1, Math.abs(minValue) * 0.02);
      minValue -= pad;
      maxValue += pad;
    }
    var minTime = new Date(points[0].at).getTime();
    var maxTime = new Date(points[points.length - 1].at).getTime();
    if (minTime === maxTime) maxTime = minTime + 1;
    function x(point) {
      return left + (new Date(point.at).getTime() - minTime) / (maxTime - minTime) * (width - left - right);
    }
    function y(pointValue) {
      return top + (maxValue - pointValue) / (maxValue - minValue) * (height - top - bottom);
    }
    var path = points.map(function (point, index) {
      return (index ? "L" : "M") + x(point).toFixed(1) + " " + y(point.value).toFixed(1);
    }).join(" ");
    var yTicks = [minValue, (minValue + maxValue) / 2, maxValue];
    var grid = yTicks.map(function (tick) {
      var yy = y(tick).toFixed(1);
      return "<line x1=\"" + left + "\" y1=\"" + yy + "\" x2=\"" + (width - right) + "\" y2=\"" + yy + "\" class=\"chart-grid-line\"/>"
        + (options.compact ? "" : "<text x=\"" + (left - 8) + "\" y=\"" + (Number(yy) + 4) + "\" class=\"chart-tick\" text-anchor=\"end\">" + html(compactMoney(tick)) + "</text>");
    }).join("");
    var dots = points.length === 1
      ? "<circle cx=\"" + x(points[0]).toFixed(1) + "\" cy=\"" + y(points[0].value).toFixed(1) + "\" r=\"4\" fill=\"" + lineColor + "\"/>"
      : "";
    var chartPoints = points.map(function (point) {
      return {
        at: point.at,
        value: point.value,
        x: Number(x(point).toFixed(2)),
        y: Number(y(point.value).toFixed(2))
      };
    });
    var interactive = options.interactive
      ? " interactive-line-chart\" data-chart-id=\"" + html(options.chartId || "") + "\" data-chart-range=\"" + html(options.range || "") + "\" data-chart-baseline=\"" + html(options.baseline == null ? "" : String(options.baseline)) + "\" data-chart-points=\"" + html(JSON.stringify(chartPoints)) + "\""
      : "";
    var scrub = options.interactive
      ? "<line class=\"chart-scrub-line\" data-chart-scrub-line x1=\"0\" y1=\"" + top + "\" x2=\"0\" y2=\"" + (height - bottom) + "\" hidden/>"
        + "<circle class=\"chart-scrub-dot\" data-chart-scrub-dot cx=\"0\" cy=\"0\" r=\"5\" hidden/>"
        + "<rect class=\"chart-touch-target\" x=\"" + left + "\" y=\"" + top + "\" width=\"" + (width - left - right) + "\" height=\"" + (height - top - bottom) + "\"/>"
      : "";
    return "<svg class=\"line-chart" + (options.compact ? " robinhood-line-chart" : "") + interactive + "\" style=\"color:" + html(lineColor) + "\" viewBox=\"0 0 " + width + " " + height + "\" role=\"img\" aria-label=\"" + html(yLabel) + " over time\">"
      + grid
      + (options.compact ? "" : "<line x1=\"" + left + "\" y1=\"" + top + "\" x2=\"" + left + "\" y2=\"" + (height - bottom) + "\" class=\"chart-axis\"/>")
      + "<line x1=\"" + left + "\" y1=\"" + (height - bottom) + "\" x2=\"" + (width - right) + "\" y2=\"" + (height - bottom) + "\" class=\"chart-axis\"/>"
      + "<path d=\"" + path + "\" fill=\"none\" stroke=\"" + lineColor + "\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
      + dots
      + scrub
      + (options.compact ? "" : "<text x=\"" + ((left + width - right) / 2) + "\" y=\"" + (height - 12) + "\" class=\"chart-label\" text-anchor=\"middle\">Time</text>"
        + "<text x=\"16\" y=\"" + ((top + height - bottom) / 2) + "\" class=\"chart-label\" transform=\"rotate(-90 16 " + ((top + height - bottom) / 2) + ")\" text-anchor=\"middle\">" + html(yLabel) + "</text>")
      + "<text x=\"" + left + "\" y=\"" + (height - 28) + "\" class=\"chart-tick\" text-anchor=\"start\">" + html(shortDate(points[0].at)) + "</text>"
      + "<text x=\"" + (width - right) + "\" y=\"" + (height - 28) + "\" class=\"chart-tick\" text-anchor=\"end\">" + html(shortDate(points[points.length - 1].at)) + "</text>"
      + "</svg>";
  }

  function chartEventX(svg, event) {
    var rect = svg.getBoundingClientRect();
    if (!rect.width) return 0;
    return (event.clientX - rect.left) / rect.width * 420;
  }

  function chartPoints(svg) {
    try {
      return JSON.parse(svg.getAttribute("data-chart-points") || "[]") || [];
    } catch (error) {
      return [];
    }
  }

  function nearestChartPoint(svg, event) {
    var points = chartPoints(svg);
    if (!points.length) return null;
    var x = chartEventX(svg, event);
    var nearest = points[0];
    var distance = Math.abs(points[0].x - x);
    points.forEach(function (point) {
      var nextDistance = Math.abs(point.x - x);
      if (nextDistance < distance) {
        nearest = point;
        distance = nextDistance;
      }
    });
    return nearest;
  }

  function updateChartScrub(svg, event) {
    var point = nearestChartPoint(svg, event);
    if (!point) return;
    var line = svg.querySelector("[data-chart-scrub-line]");
    var dot = svg.querySelector("[data-chart-scrub-dot]");
    if (line) {
      line.setAttribute("x1", point.x);
      line.setAttribute("x2", point.x);
      line.hidden = false;
    }
    if (dot) {
      dot.setAttribute("cx", point.x);
      dot.setAttribute("cy", point.y);
      dot.hidden = false;
    }
    var chartId = svg.getAttribute("data-chart-id") || "";
    var readout = chartId ? document.querySelector("[data-chart-readout=\"" + cssEscape(chartId) + "\"]") : null;
    var baseline = numeric(svg.getAttribute("data-chart-baseline"));
    var value = numeric(point.value);
    var pnl = value != null && baseline != null ? value - baseline : null;
    var pnlPct = baseline ? pnl / baseline * 100 : null;
    if (readout && value != null) {
      var trendClass = valueClass(pnl);
      readout.innerHTML = "<b>" + html(money(value)) + "</b><span class=\"" + html(trendClass) + "\">" + html(signedMoney(pnl, "$0.00") + " (" + signedPercent(pnlPct) + ") " + scrubTimestamp(point.at)) + "</span>";
    }
  }

  function resetChartScrub(svg) {
    if (!svg) return;
    var line = svg.querySelector("[data-chart-scrub-line]");
    var dot = svg.querySelector("[data-chart-scrub-dot]");
    if (line) line.hidden = true;
    if (dot) dot.hidden = true;
    var points = chartPoints(svg);
    var last = points[points.length - 1];
    var chartId = svg.getAttribute("data-chart-id") || "";
    var readout = chartId ? document.querySelector("[data-chart-readout=\"" + cssEscape(chartId) + "\"]") : null;
    var baseline = numeric(svg.getAttribute("data-chart-baseline"));
    if (readout && last) {
      var pnl = baseline != null ? last.value - baseline : null;
      var pnlPct = baseline ? pnl / baseline * 100 : null;
      var trendClass = valueClass(pnl);
      readout.innerHTML = "<b>" + html(money(last.value)) + "</b><span class=\"" + html(trendClass) + "\">" + html(signedMoney(pnl, "$0.00") + " (" + signedPercent(pnlPct) + ") " + (svg.getAttribute("data-chart-range") || "")) + "</span>";
    }
  }

  function scrubTimestamp(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function previewRow(label, value) {
    return "<div class=\"preview-row\"><span>" + html(label) + "</span><b>" + html(value) + "</b></div>";
  }

  function gaugeCard(label, value, description) {
    return "<article class=\"gauge-card\"><span>" + html(label) + " basis capture</span><div class=\"gauge-value\" style=\"--needle:" + value + "%\"><b>" + value + "%</b></div><p>" + html(description) + "</p></article>";
  }

  function addActivity(event, operator, account, detail) {
    state.activity.unshift({event: event, operator: operator || "SYSTEM", account: account || "SmartSleeve", detail: detail || "", time: new Date().toLocaleString()});
  }

  function toast(message) {
    var element = $("toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(function () { element.classList.remove("visible"); }, 3200);
  }

  function pullRefreshAtTop() {
    if ($("auth-gate")) return false;
    return window.scrollY <= 2 && document.documentElement.scrollTop <= 2 && document.body.scrollTop <= 2;
  }

  function updatePullRefreshIndicator(distance, armed, label) {
    var indicator = $("pull-refresh-indicator");
    var textTarget = $("pull-refresh-label");
    if (!indicator) return;
    var progress = Math.max(0, Math.min(1, distance / 96));
    indicator.style.setProperty("--pull-progress", progress.toFixed(2));
    indicator.classList.toggle("visible", distance > 8 || state.pullRefresh.refreshing);
    indicator.classList.toggle("armed", Boolean(armed));
    indicator.classList.toggle("refreshing", Boolean(state.pullRefresh.refreshing));
    applyPullStretch(distance);
    if (textTarget) {
      textTarget.textContent = label || (armed ? "Release to sync latest daemon cycle" : "Pull down to sync latest daemon cycle");
    }
  }

  function applyPullStretch(distance) {
    var shell = document.querySelector(".app-shell");
    if (!shell) return;
    var pull = Math.max(0, Math.min(86, Number(distance) || 0));
    shell.style.setProperty("--pull-distance", pull.toFixed(0) + "px");
    shell.classList.toggle("pulling-refresh", pull > 2 && !state.pullRefresh.refreshing);
  }

  function resetPullRefresh(delay) {
    window.setTimeout(function () {
      state.pullRefresh.tracking = false;
      state.pullRefresh.armed = false;
      state.pullRefresh.distance = 0;
      updatePullRefreshIndicator(0, false, "Pull down to sync latest daemon cycle");
      applyPullStretch(0);
    }, delay || 0);
  }

  function triggerPullRefresh() {
    if (state.pullRefresh.refreshing) return;
    var previousStamp = feedStamp(state.payload || {});
    state.pullRefresh.refreshing = true;
    state.pullRefresh.tracking = false;
    state.pullRefresh.armed = false;
    updatePullRefreshIndicator(96, true, "Checking latest trader cycle...");
    text("sync-pill", "Refreshing cache");
    var refreshStarted = requestServerFeedRefresh();
    Promise.all([
      loadFeed({silent: true, interactiveRefresh: true}),
      wait(650)
    ]).then(function (results) {
      var ok = Boolean(results[0]);
      if (!ok) return {ok: false, updated: false, refreshStarted: false};
      return wait(150).then(function () {
        var updated = Boolean(previousStamp && feedStamp(state.payload || {}) !== previousStamp);
        return {ok: true, updated: updated, refreshStarted: refreshStarted};
      });
    }).then(function (result) {
      state.pullRefresh.refreshing = false;
      runRefreshBounce(result.ok);
      updatePullRefreshIndicator(result.ok ? 72 : 48, false, result.ok ? (result.updated ? "Latest trader cycle synced." : "Already current") : "Still showing current view");
      if (result.ok && result.updated) {
        toast("Latest trader cycle synced.");
      } else if (!result.ok && !state.payload) {
        toast("Private feed unavailable. Sign in or retry.");
      }
      resetPullRefresh(result.updated ? 750 : 350);
    });
  }

  function requestServerFeedRefresh() {
    if (!appFeedRefreshEndpoint) return false;
    try {
      authFetch(appFeedRefreshEndpoint, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-SmartSleeve-Refresh": "pull-to-refresh"},
        body: JSON.stringify({reason: "app_pull_to_refresh"})
      }).catch(function () {
        // The visible refresh uses the latest published feed; server refresh is best-effort.
      });
      return true;
    } catch (_err) {
      return false;
    }
  }

  function runRefreshBounce(ok) {
    var shell = document.querySelector(".app-shell");
    if (!shell) return;
    shell.classList.remove("refresh-bounce", "refresh-bounce-failed");
    void shell.offsetWidth;
    shell.classList.add(ok ? "refresh-bounce" : "refresh-bounce-failed");
    window.setTimeout(function () {
      shell.classList.remove("refresh-bounce", "refresh-bounce-failed");
    }, 780);
  }

  function wirePullRefresh() {
    if (!$("pull-refresh-indicator")) return;
    function begin(y, target) {
      if (state.pullRefresh.refreshing || !pullRefreshAtTop()) return false;
      if (target && target.closest && target.closest("input, textarea, select, button, a, .bottom-nav")) return false;
      state.pullRefresh.startY = y;
      state.pullRefresh.distance = 0;
      state.pullRefresh.tracking = true;
      state.pullRefresh.armed = false;
      return true;
    }
    function move(y, event) {
      if (!state.pullRefresh.tracking) return;
      var delta = y - state.pullRefresh.startY;
      if (delta <= 0) {
        resetPullRefresh();
        return;
      }
      if (!pullRefreshAtTop()) return;
      if (delta > 8 && event && event.preventDefault) event.preventDefault();
      var distance = Math.min(136, delta * 0.62);
      var armed = distance >= 76;
      state.pullRefresh.distance = distance;
      state.pullRefresh.armed = armed;
      updatePullRefreshIndicator(distance, armed);
    }
    function end() {
      if (!state.pullRefresh.tracking) return;
      if (state.pullRefresh.armed) {
        triggerPullRefresh();
      } else {
        resetPullRefresh();
      }
    }
    document.addEventListener("touchstart", function (event) {
      if (event.touches.length !== 1) return;
      begin(event.touches[0].clientY, event.target);
    }, {passive: true});

    document.addEventListener("touchmove", function (event) {
      if (!state.pullRefresh.tracking || event.touches.length !== 1) return;
      move(event.touches[0].clientY, event);
    }, {passive: false});

    ["touchend", "touchcancel"].forEach(function (eventName) {
      document.addEventListener(eventName, end, {passive: true});
    });

    document.addEventListener("mousedown", function (event) {
      if (event.button !== 0) return;
      begin(event.clientY, event.target);
    });
    document.addEventListener("mousemove", function (event) { move(event.clientY, event); });
    document.addEventListener("mouseup", end);
  }

  function scrollActiveBottomNavIntoView() {
    var active = document.querySelector(".bottom-nav [data-nav].active");
    if (!active || !active.scrollIntoView) return;
    active.scrollIntoView({block: "nearest", inline: "center", behavior: "smooth"});
  }

  function wireBottomNavScroller() {
    var nav = document.querySelector(".bottom-nav");
    if (!nav) return;
    var dragging = false;
    var pointerId = null;
    var startX = 0;
    var startScroll = 0;
    var moved = 0;
    nav.addEventListener("wheel", function (event) {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      nav.scrollLeft += event.deltaY;
    }, {passive: false});
    nav.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = nav.scrollLeft;
      moved = 0;
      nav.classList.add("dragging");
      if (nav.setPointerCapture) nav.setPointerCapture(pointerId);
    });
    nav.addEventListener("pointermove", function (event) {
      if (!dragging || event.pointerId !== pointerId) return;
      var delta = event.clientX - startX;
      moved = Math.max(moved, Math.abs(delta));
      if (moved > 3) {
        nav.scrollLeft = startScroll - delta;
        event.preventDefault();
      }
    });
    function stopDrag() {
      dragging = false;
      pointerId = null;
      window.setTimeout(function () { moved = 0; }, 0);
      nav.classList.remove("dragging");
    }
    nav.addEventListener("pointerup", stopDrag);
    nav.addEventListener("pointercancel", stopDrag);
    nav.addEventListener("click", function (event) {
      if (moved > 8) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function handleNav(section) {
    var target = section || "dashboard";
    var aliases = {overview: "dashboard", portfolio: "dashboard", command: "trade", trades: "trade", picks: "stock-picks", stock: "stock-picks", recs: "recommendations", recommend: "recommendations", recommendations: "recommendations", health: "diagnostics", risk: "diagnostics"};
    target = aliases[target] || target;
    $all("[data-section]").forEach(function (panel) {
      panel.classList.toggle("active", panel.getAttribute("data-section") === target);
    });
    $all("[data-nav]").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-nav") === target);
    });
    var titles = {
      dashboard: ["Dashboard", "What you own, why you own it, what changed, and what needs review."],
      accounts: ["Accounts", "Account-scoped broker values, cash, margin buffer, holdings, and sync quality."],
      "account-detail": ["Account Detail", "Broker, holdings, cash, margin buffer, and sleeve coverage."],
      sleeves: ["Sleeves", "Active sleeve behavior, account coverage, drift, and ledger quality."],
      "sleeve-detail": ["Sleeve Detail", "Behavior, trades, holdings, and portfolio role for one sleeve."],
      "stock-picks": ["Stock Picks", "Subscribed sleeve universes and weekly stock-pick archives."],
      recommendations: ["Recs", "Actionable Sage recommendations ready for review or draft trade tickets."],
      trade: ["Trade Center", "Draft, review, approve, reject, and audit trade decisions."],
      reallocation: ["Reallocation", "Estimate basis cost, settlement friction, and patience before drafting a trade."],
      sage: ["Sage", "Agent controls, recommendations, decision feed, and execution diagnostics."],
      diagnostics: ["Diagnostics", "Broker health, margin clarity, account coverage, and sync gaps."]
    };
    if (!titles[target]) {
      target = "dashboard";
      $all("[data-section]").forEach(function (panel) {
        panel.classList.toggle("active", panel.getAttribute("data-section") === target);
      });
      $all("[data-nav]").forEach(function (link) {
        link.classList.toggle("active", link.getAttribute("data-nav") === target);
      });
    }
    text("page-title", (titles[target] || titles.dashboard)[0]);
    text("page-subtitle", (titles[target] || titles.dashboard)[1]);
    scrollActiveBottomNavIntoView();
  }

  function wireEvents() {
    $all("[data-nav]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var section = link.getAttribute("data-nav");
        history.replaceState(null, "", "#" + section);
        handleNav(section);
      });
    });
    $all("[data-nav-button]").forEach(function (button) {
      button.addEventListener("click", function () {
        var section = button.getAttribute("data-nav-button");
        history.replaceState(null, "", "#" + section);
        handleNav(section);
      });
    });
    var sort = $("holdings-sort");
    if (sort) sort.addEventListener("change", renderHoldingsTable);
    var refreshFeed = $("refresh-feed-button");
    if (refreshFeed) refreshFeed.addEventListener("click", function () {
      var refreshStarted = requestServerFeedRefresh();
      loadFeed({silent: true, interactiveRefresh: true}).then(function (ok) {
        if (ok) {
          toast(refreshStarted ? "Refresh requested. Latest available trader cycle is showing." : "Private feed checked.");
        } else if (!state.payload) {
          toast("Private feed unavailable. Sign in or retry.");
        }
      });
    });
    wirePullRefresh();
    wireBottomNavScroller();
    var signOut = $("sign-out-button");
    if (signOut) signOut.addEventListener("click", function () {
      clearStoredSession();
      state.accounts = [];
      state.allAccounts = [];
      state.holdings = [];
      state.sleeves = [];
      state.recommendations = [];
      text("sync-pill", "Signed out");
      renderAll();
      showAuthGate("Signed out. Sign in again to load private SmartSleeve data.");
    });
    var form = $("trade-form");
    if (form) {
      form.addEventListener("submit", createDraftOrder);
      $all("input, select, textarea", form).forEach(function (input) {
        input.addEventListener("input", updateTradePreview);
        input.addEventListener("change", updateTradePreview);
      });
    }
    var serverPreviewButton = $("server-preview-button");
    if (serverPreviewButton) serverPreviewButton.addEventListener("click", previewCurrentIntent);
    var copyIntentJson = $("copy-intent-json");
    if (copyIntentJson) {
      copyIntentJson.addEventListener("click", function () {
        copyText(JSON.stringify(buildAdvancedIntent(), null, 2))
          .then(function () { toast("Intent JSON copied."); })
          .catch(function () { toast("Clipboard unavailable in this browser."); });
      });
    }
    document.addEventListener("click", function (event) {
      var orderButton = event.target.closest("[data-order-action]");
      if (orderButton) {
        var order = state.draftOrders.find(function (item) { return item.id === orderButton.getAttribute("data-order-id"); });
        if (order) {
          var action = orderButton.getAttribute("data-order-action");
          if (action === "copy") {
            copyText(JSON.stringify(order.intent || order, null, 2))
              .then(function () { toast("Draft intent JSON copied."); })
              .catch(function () { toast("Clipboard unavailable in this browser."); });
            return;
          }
          if (action === "preview") {
            order.status = "Queued for server preview";
            submitIntentToServer(order.intent || order)
              .then(function (result) {
                if (result && result.ok) {
                  order.status = "Server preview accepted";
                  persistDraftOrders();
                  renderDraftOrders();
                  renderServerTrades();
                  sendOrderNotification(order, "queued");
                  toast("Server accepted the draft for preview.");
                }
              })
              .catch(function (error) {
                order.status = "Server preview unavailable";
                persistDraftOrders();
                renderDraftOrders();
                renderServerTrades();
                toast("Server preview unavailable: " + error.message);
              });
          } else {
            order.status = "Rejected by user";
          }
          addActivity("Order " + (action === "preview" ? "preview requested" : "rejected"), order.operator, order.account, order.ticker + " " + order.action);
          persistDraftOrders();
          renderDraftOrders();
          renderServerTrades();
          renderActivity();
          if (action !== "preview") toast(order.status + ".");
        }
      }
      var recButton = event.target.closest("[data-rec-draft]");
      if (recButton) draftFromRecommendation(recButton.getAttribute("data-rec-draft"));
      var tradeButton = event.target.closest("[data-server-trade-id]");
      if (tradeButton) {
        state.selectedTradeId = tradeButton.getAttribute("data-server-trade-id");
        renderServerTrades();
      }
      var accountButton = event.target.closest("[data-account-detail]");
      if (accountButton) {
        state.selectedDetailAccountId = accountButton.getAttribute("data-account-detail");
        renderAccountDetail();
        handleNav("account-detail");
        history.replaceState(null, "", "#account-detail");
      }
      var accountChartRange = event.target.closest("[data-account-chart-range]");
      if (accountChartRange) {
        state.selectedAccountChartRange = accountChartRange.getAttribute("data-account-chart-range") || "1D";
        renderAccountDetail();
      }
      var sleeveButton = event.target.closest("[data-sleeve-detail]");
      if (sleeveButton) {
        state.selectedDetailSleeveName = sleeveButton.getAttribute("data-sleeve-detail");
        renderSleeveDetail();
        handleNav("sleeve-detail");
        history.replaceState(null, "", "#sleeve-detail");
      }
      var stockPickButton = event.target.closest("[data-stock-pick-sleeve]");
      if (stockPickButton) {
        state.selectedStockPickSleeve = stockPickButton.getAttribute("data-stock-pick-sleeve");
        renderStockPicks();
        handleNav("stock-picks");
        history.replaceState(null, "", "#stock-picks");
      }
      var recDismiss = event.target.closest("[data-rec-dismiss]");
      if (recDismiss) {
        state.recommendations = state.recommendations.filter(function (item) { return item.id !== recDismiss.getAttribute("data-rec-dismiss"); });
        renderDashboard();
        renderSage();
        renderRisk();
        toast("Recommendation rejected.");
      }
    });
    document.addEventListener("pointerdown", function (event) {
      var chart = event.target.closest(".interactive-line-chart");
      if (!chart) return;
      state.activeScrubChart = chart;
      updateChartScrub(chart, event);
      if (chart.setPointerCapture && event.pointerId != null) {
        try {
          chart.setPointerCapture(event.pointerId);
        } catch (error) {
          // Embedded webviews can reject pointer capture; scrub still works.
        }
      }
      event.preventDefault();
    });
    document.addEventListener("pointermove", function (event) {
      var chart = state.activeScrubChart || event.target.closest(".interactive-line-chart");
      if (!chart) return;
      updateChartScrub(chart, event);
    });
    document.addEventListener("pointerup", function () {
      if (!state.activeScrubChart) return;
      resetChartScrub(state.activeScrubChart);
      state.activeScrubChart = null;
    });
    document.addEventListener("pointercancel", function () {
      if (!state.activeScrubChart) return;
      resetChartScrub(state.activeScrubChart);
      state.activeScrubChart = null;
    });
    document.addEventListener("pointerleave", function (event) {
      var chart = event.target && event.target.closest ? event.target.closest(".interactive-line-chart") : null;
      if (chart && !state.activeScrubChart) resetChartScrub(chart);
    }, true);
    document.addEventListener("change", function (event) {
      if (event.target && event.target.id === "developer-user-filter") {
        state.selectedOwnerEmail = normalizeEmail(event.target.value || "all") || "all";
        state.selectedAccountId = "all";
        if (state.payload) applyFeed(state.payload, state.feedSource);
        return;
      }
      if (event.target && event.target.id === "developer-account-filter") {
        state.selectedAccountId = event.target.value || "all";
        if (state.payload) applyFeed(state.payload, state.feedSource);
        return;
      }
      if (event.target && event.target.name === "sage-mode") {
        state.sageMode = event.target.value;
        renderSage();
        addActivity("Sage mode changed", "JPS_MANUAL", "SmartSleeve", "Mode set to " + state.sageMode);
        renderActivity();
      }
    });
    var killSwitch = $("kill-switch");
    if (killSwitch) {
      killSwitch.addEventListener("click", function () {
        state.sageMode = "observe";
        renderSage();
        addActivity("Automation kill switch", "JPS_MANUAL", "All accounts", "Sage set to Observe Only.");
        renderActivity();
        toast("Automation disabled. Sage is Observe Only.");
      });
    }
    var riskKill = $("risk-kill-switch");
    if (riskKill) riskKill.addEventListener("click", function () { state.sageMode = "observe"; renderSage(); toast("Automation disabled. Sage is Observe Only."); });
    var runReview = $("run-review");
    if (runReview) runReview.addEventListener("click", function () { addActivity("Portfolio review run", "SAGE_RECOMMEND", "Cross-account", state.recommendations.length + " recommendations generated."); renderActivity(); toast("Sage review refreshed from current feed."); });
    ["reallocation-account", "reallocation-sleeve", "reallocation-source", "reallocation-target", "reallocation-notional", "reallocation-window", "reallocation-deadline", "reallocation-reason"].forEach(function (id) {
      var input = $(id);
      if (input) {
        input.addEventListener("input", updateReallocationPreview);
        input.addEventListener("change", updateReallocationPreview);
      }
    });
    var analyzeReallocation = $("analyze-reallocation");
    if (analyzeReallocation) analyzeReallocation.addEventListener("click", function () { updateReallocationPreview(); toast("Sage reallocation analysis refreshed."); });
    var draftReallocation = $("draft-reallocation");
    if (draftReallocation) {
      draftReallocation.addEventListener("click", function () {
        handleNav("trade");
        history.replaceState(null, "", "#trade");
        setFormValue("trade-account", valueOf("reallocation-account"));
        setFormValue("trade-sleeve", valueOf("reallocation-sleeve"));
        setFormValue("trade-strategy", "reallocation");
        setFormValue("trade-action", "reallocate");
        setFormValue("trade-ticker", (valueOf("reallocation-source") || "").toUpperCase());
        setFormValue("trade-target-ticker", (valueOf("reallocation-target") || "").toUpperCase());
        setFormValue("trade-notional", valueOf("reallocation-notional"));
        setFormValue("trade-window-end", valueOf("reallocation-deadline"));
        setFormValue("trade-operator", "SAGE_ASSISTED");
        setFormValue("trade-reason", valueOf("reallocation-reason") + " Sage timing note: watch target trend until the deadline; prefer staged/limit entry if the target is still falling and time remains.");
        updateTradePreview();
        toast("Reallocation loaded into the trade ticket.");
      });
    }
    var rebalance = document.querySelector("[data-create-rebalance]");
    if (rebalance) {
      rebalance.addEventListener("click", function () {
        handleNav("trade");
        history.replaceState(null, "", "#trade");
        setFormValue("trade-strategy", "reallocation");
        setFormValue("trade-action", "reallocate");
        setFormValue("trade-operator", "SQTS_REBALANCE");
        setFormValue("trade-reason", "Review sleeve drift and rebalance only after server-side broker preview.");
        updateTradePreview();
      });
    }
  }

  function setFormValue(id, value) {
    var element = $(id);
    if (element) element.value = value;
  }

  function draftFromRecommendation(id) {
    var rec = state.recommendations.find(function (item) { return item.id === id; });
    if (!rec) return;
    handleNav("trade");
    history.replaceState(null, "", "#trade");
    setFormValue("trade-ticker", rec.ticker.split(",")[0].trim());
    setFormValue("trade-action", rec.action === "Raise cash" || rec.action === "Trim" ? "sell" : rec.action === "Assign" || rec.action === "Broker sync" || rec.action === "Rebalance" ? "reallocate" : "buy");
    setFormValue("trade-notional", rec.notional ? String(Math.max(0, rec.notional)) : "");
    setFormValue("trade-operator", rec.operator);
    setFormValue("trade-reason", rec.reason);
    updateTradePreview();
    toast("Recommendation loaded into the trade ticket.");
  }

  function applyFeed(payload, sourceUrl) {
    removeAuthGate();
    var session = payload.session || {};
    var profile = session.profile || {};
    var requestedPrincipal = principalEmail;
    if (profile.email) {
      principalEmail = normalizeEmail(profile.email);
    }
    if (profile.role === "developer" && requestedDeveloperView) {
      appEdition = "developer";
      accountScope = "all";
    } else {
      appEdition = appEdition === "developer" ? "web" : appEdition;
      accountScope = "user";
    }
    var accounts = (payload.accounts || []).map(normalizeAccount);
    state.payload = payload;
    state.feedSource = sourceUrl;
    state.allAccounts = visibleAccountRows(accounts);
    state.accounts = developerFilteredAccounts(state.allAccounts);
    if (requestedPrincipal && appEdition !== "developer" && principalEmail !== requestedPrincipal) {
      state.accounts = [];
      state.allAccounts = [];
      state.feedWarning = recommendation("session-principal-mismatch", "Wrong account session", "Sign in again", "SmartSleeve", "Auth", 0, "This browser session is for " + principalEmail + ", but this app link is scoped to " + requestedPrincipal + ".", "Sign out and sign in with the requested SmartSleeve account before reviewing balances or trades.", "EXTERNAL_BROKER_SYNC");
      text("snapshot-time", "Sign in with " + requestedPrincipal);
      clearStoredSession();
      renderAll();
      showAuthGate("Sign in with " + requestedPrincipal + " to load this SmartSleeve app.");
      return;
    }
    var aggregated = aggregateHoldings(state.accounts);
    state.holdings = aggregated.holdings;
    state.foreignHoldings = aggregated.foreign;
    var visibleAccountIds = visibleAccountIdSet(state.accounts);
    var history = payload.history || {};
    state.history = {
      accounts: developerVisibleRows(visibleRows(history.accounts || [])).filter(function (row) { return visibleAccountIds[rowAccountId(row)]; }),
      positions: developerVisibleRows(visibleRows(history.positions || [])).filter(function (row) { return visibleAccountIds[rowAccountId(row)]; })
    };
    state.serverTrades = developerVisibleRows(scopedRowsForVisibleAccounts(payload.trades || [], visibleAccountIds));
    notifyOrderFeedChanges(state.serverTrades);
    state.brain = developerVisibleRows(scopedRowsForVisibleAccounts(payload.brain || [], visibleAccountIds));
    state.reports = ensureStockPickReports(scopedRowsForVisibleAccounts(payload.reports || [], visibleAccountIds));
    state.accountCoverage = payload.accountCoverage || null;
    state.feedWarning = null;
    text("snapshot-source", appEdition === "developer" ? (payload.source || "Private API") : "");
    text("snapshot-time", latestDaemonLabel(payload));
    text("sync-pill", "Private API synced");
    addActivity("Cloud feed synced", "EXTERNAL_BROKER_SYNC", appEdition === "developer" ? "All accounts" : principalEmail, state.accounts.length + " account(s), " + state.serverTrades.length + " trades, " + state.brain.length + " brain rows.");
    renderAll();
    handleNav((window.location.hash || "#dashboard").replace("#", "") || "dashboard");
    scheduleFeedRefresh();
  }

  function latestDaemonLabel(payload) {
    var source = payload || state.payload || {};
    var timestamps = [];
    collectDaemonTimestamps(source, timestamps);
    var latest = timestamps.map(function (value) { return new Date(value); }).filter(function (date) {
      return !Number.isNaN(date.getTime());
    }).sort(function (a, b) { return b - a; })[0];
    return latest ? "Last synced trader cycle at " + latest.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"}) + " on " + latest.toLocaleDateString([], {month: "long", day: "numeric", year: "numeric"}) + "." : "Last synced trader cycle unavailable.";
  }

  function collectDaemonTimestamps(value, out) {
    if (!value || out.length > 80) return;
    if (Array.isArray(value)) {
      value.slice(0, 80).forEach(function (item) { collectDaemonTimestamps(item, out); });
      return;
    }
    if (typeof value !== "object") return;
    ["generated_at", "generatedAt", "last_reconciled_at", "lastReconciledAt", "updated_at", "timestamp", "as_of"].forEach(function (key) {
      if (value[key]) out.push(value[key]);
    });
    Object.keys(value).slice(0, 40).forEach(function (key) {
      if (typeof value[key] === "object") collectDaemonTimestamps(value[key], out);
    });
  }

  function feedStamp(payload) {
    if (!payload) return "";
    return String(payload.published_at || payload.generated_at || payload.generatedAt || payload.updated_at || payload.updatedAt || "");
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function waitForUpdatedFeed(previousStamp, attempts) {
    if (!previousStamp || attempts <= 0) return Promise.resolve(true);
    return wait(3500).then(function () {
      return loadFeed({silent: true}).then(function (ok) {
        return ok && feedStamp(state.payload || {}) !== previousStamp;
      }).catch(function () {
        return false;
      });
    }).then(function (updated) {
      if (updated || attempts <= 1) return updated;
      return waitForUpdatedFeed(previousStamp, attempts - 1);
    });
  }

  function fetchAppFeed(options) {
    options = options || {};
    if (!appFeedEndpoint) {
      return Promise.reject(new Error("SmartSleeve private API is not configured."));
    }
    var separator = appFeedEndpoint.indexOf("?") === -1 ? "?" : "&";
    var query = [];
    if (options.refresh) query.push("refresh=1");
    query.push("ts=" + Date.now());
    var headers = options.refresh ? {"X-SmartSleeve-Refresh": "pull-to-refresh"} : {};
    return authFetch(appFeedEndpoint + separator + query.join("&"), {headers: headers})
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (response.status === 401) {
            var err = new Error("Please sign in to load your private portfolio feed.");
            err.authRequired = true;
            throw err;
          }
          if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || "Private API returned HTTP " + response.status);
          }
          return {payload: payload.feed || payload, url: appFeedEndpoint};
        });
      });
  }

  function loadFeed(options) {
    options = options || {};
    return fetchAppFeed(options)
      .then(function (result) {
        applyFeed(result.payload, result.url);
        return true;
      })
      .catch(function (error) {
        if (state.payload && (options.refresh || options.silent || options.interactiveRefresh || error.authRequired)) {
          text("sync-pill", options.interactiveRefresh || options.silent ? "Checked" : "Showing latest loaded data");
          text("snapshot-time", latestDaemonLabel(state.payload) || "Latest loaded trader cycle is still displayed.");
          state.feedWarning = options.interactiveRefresh || options.silent
            ? null
            : recommendation("feed-refresh-kept-current", "Latest loaded data shown", "Retry sync", "SmartSleeve", "Data", 0, error.message, "Holdings already on screen remain visible; confirm the timestamp before acting.", "EXTERNAL_BROKER_SYNC");
          renderAll();
          if (options.refresh || options.interactiveRefresh) {
            toast("Latest loaded data is still displayed.");
          }
        } else {
          text("snapshot-time", "Feed unavailable");
          state.accounts = [];
          state.allAccounts = [];
          state.holdings = [];
          state.sleeves = [];
          state.recommendations = [recommendation("feed-failed", "Reconnect cloud feed", "Broker sync", "SmartSleeve", "Data", 0, error.message, "No portfolio decisions should be made until current holdings are available.", "EXTERNAL_BROKER_SYNC")];
          renderAll();
          if (error.authRequired) {
            clearStoredSession();
            showAuthGate(error.message);
          } else {
            showAuthGate("Private feed unavailable: " + error.message);
          }
        }
        if (!options.silent && !(state.payload && (options.refresh || options.interactiveRefresh || error.authRequired))) {
          toast("Portfolio feed failed to load.");
        }
        return false;
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    restoreStoredSession();
    restoreDraftOrders();
    restoreOrderNotificationSeen();
    renderSession();
    wireEvents();
    loadFeed();
  });
})();
