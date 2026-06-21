(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var appEdition = params.get("app_edition") || "web";
  var accountScope = params.get("account_scope") || "user";
  var principalEmail = normalizeEmail(params.get("principal_email") || "");
  var authEndpoint = metaContent("smartsleeve-auth-endpoint");
  var orderIntentEndpoint = metaContent("smartsleeve-order-intent-endpoint") || (authEndpoint ? authEndpoint.replace(/\/$/, "") + "/order-intents" : "");
  var appFeedEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/api/app-feed" : "";
  var loginEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/login" : "";
  var registerEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/register" : "";
  var passwordResetEndpoint = authEndpoint ? authEndpoint.replace(/\/$/, "") + "/password-reset/request" : "";
  var sessionToken = params.get("session_token") || "";

  var state = {
    payload: null,
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
    sageMode: "recommend",
    selectedTradeId: null,
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
      "<label>First name<input id=\"auth-first-name\" type=\"text\" autocomplete=\"given-name\"></label>",
      "<label>Last name<input id=\"auth-last-name\" type=\"text\" autocomplete=\"family-name\"></label>",
      "</div>",
      "<label>Email<input id=\"auth-email\" type=\"email\" autocomplete=\"username\" required></label>",
      "<label>Password<input id=\"auth-password\" type=\"password\" autocomplete=\"current-password\" required></label>",
      "<label class=\"auth-register-field\">Confirm password<input id=\"auth-password-confirm\" type=\"password\" autocomplete=\"new-password\"></label>",
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
        ? "Create a verified SmartSleeve account. We will email a verification link before private data can load."
        : "Sign in to load your private SmartSleeve data."
    );
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
          if ((payload.profile || {}).role === "developer") {
            appEdition = "developer";
            accountScope = "all";
          } else {
            appEdition = "web";
            accountScope = "user";
          }
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

  function splitSleeves(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return item && (item.label || item.name || item.id);
      }).filter(Boolean);
    }
    return String(value || "")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(Boolean)
      .map(function (item) { return item === "Hyper Savage" ? "Covered Sage" : item; });
  }

  function normalizeAccount(account) {
    var positions = (account.positions || []).map(function (position) {
      return {
        symbol: String(position.symbol || "").toUpperCase(),
        name: position.name || tickerNames[String(position.symbol || "").toUpperCase()],
        shares: numeric(position.shares != null ? position.shares : position.quantity),
        price: numeric(position.price != null ? position.price : position.current_price),
        value: numeric(position.value != null ? position.value : position.market_value_usd),
        averageCost: numeric(position.averageCost != null ? position.averageCost : position.average_cost),
        costBasis: numeric(position.costBasis != null ? position.costBasis : position.cost_basis),
        dailyPnl: numeric(position.dailyPnl != null ? position.dailyPnl : position.daily_pnl),
        unrealizedPnl: numeric(position.unrealizedPnl != null ? position.unrealizedPnl : position.unrealized_pnl),
        realizedPnl: numeric(position.realizedPnl != null ? position.realizedPnl : position.realized_pnl),
        totalPnl: numeric(position.totalPnl != null ? position.totalPnl : position.total_pnl),
        currency: position.currency || "USD"
      };
    });
    return {
      id: account.id || account.accountId || account.account_id || account.account,
      account: account.account || account.name || account.id || "Account",
      ownerEmail: account.ownerEmail || account.owner_email,
      developerEmail: account.developerEmail || account.developer_email,
      broker: account.broker || "Broker",
      status: account.status || "synced",
      generatedAt: account.generatedAt || account.generated_at,
      equity: numeric(account.equity != null ? account.equity : account.account_equity),
      cash: numeric(account.cash),
      buyPower: numeric(account.buyPower != null ? account.buyPower : account.cash_available_for_buys),
      positions: positions,
      sleeves: account.sleeves || [],
      sleevesText: account.sleevesText || account.sleeves_text || ""
    };
  }

  function visibleRows(rows) {
    if (accountScope === "all" || appEdition === "developer" || !principalEmail) {
      return rows.slice();
    }
    return rows.filter(function (row) {
      return normalizeEmail(row.ownerEmail || row.owner_email) === principalEmail
        || normalizeEmail(row.developerEmail || row.developer_email) === principalEmail
        || (row.audienceEmails || []).map(normalizeEmail).indexOf(principalEmail) !== -1;
    });
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
      row.price = row.shares ? (row.value ? row.value / row.shares : row.priceValue / row.shares) : null;
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
        liveSleeves.forEach(function (sleeve) {
          var name = sleeve.label || sleeve.name || sleeve.id || "Unassigned";
          ensureSleeve(bySleeve, name, account.account);
          bySleeve[name].exactValue += numeric(sleeve.netLiquidationUsd != null ? sleeve.netLiquidationUsd : sleeve.net_liquidation_usd) || 0;
          bySleeve[name].cash += numeric(sleeve.cashUsd != null ? sleeve.cashUsd : sleeve.cash_usd) || 0;
          bySleeve[name].positionValue += numeric(sleeve.positionValueUsd != null ? sleeve.positionValueUsd : sleeve.position_value_usd) || 0;
          bySleeve[name].lastReconciledAt = sleeve.lastReconciledAt || sleeve.last_reconciled_at || bySleeve[name].lastReconciledAt;
          bySleeve[name].operatingMode = sleeve.operatingMode || sleeve.operating_mode || bySleeve[name].operatingMode;
          (sleeve.holdings || []).forEach(function (holding) {
            var symbol = String(holding.symbol || "").toUpperCase();
            if (symbol && bySleeve[name].holdings.indexOf(symbol) === -1) {
              bySleeve[name].holdings.push(symbol);
            }
          });
        });
        return;
      }
      var names = splitSleeves(account.sleevesText || account.sleeves);
      if (!names.length) {
        names = ["Unassigned"];
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
    }).sort(function (a, b) {
      return (b.exactValue || 0) - (a.exactValue || 0) || a.name.localeCompare(b.name);
    });
  }

  function ensureSleeve(map, name, accountName) {
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
      recs.push(recommendation("margin-cash", "Review negative cash before adding risk", "Raise cash", state.accounts.filter(function (account) { return (numeric(account.cash) || 0) < 0; }).map(function (account) { return account.account; }).join(", "), "Cash", marginUsed(), "At least one account reports negative cash.", "Margin pressure can force less patient execution during volatility.", "SQTS_RISK_EXIT"));
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
    renderTopHoldings(total);
    renderReviewQueue();
    renderAccounts();
    renderSleeveSummary(total);
    renderPerformanceCharts();
    renderReports();
    renderHoldingsTable();
  }

  function renderTopHoldings(total) {
    var target = $("top-holdings");
    if (!target) return;
    target.innerHTML = state.holdings.slice(0, 5).map(function (holding) {
      return stackItem(holding.symbol + " - " + holding.name, money(holding.value) + " / " + pct(holding.value, total), numberText(holding.shares, 6) + " shares across " + holding.accounts.length + " account(s)", holding.value / total * 100);
    }).join("") || emptyItem("No holdings found", "Connect or sync a broker to import positions.");
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
      var cash = numeric(account.cash) || 0;
      return "<article class=\"account-card\">"
        + "<div class=\"stack-item-head\"><b>" + html(account.account) + "</b><span>" + html(account.broker) + "</span></div>"
        + "<p>Equity: <b>" + money(account.equity) + "</b></p>"
        + "<p>Cash: <span class=\"" + (cash < 0 ? "negative" : "positive") + "\">" + money(cash) + "</span> / buying power " + money(account.buyPower) + "</p>"
        + "<p>Holdings: " + money((account.positions || []).reduce(function (sum, position) { return sum + (numeric(position.value) || 0); }, 0)) + " / positions " + (account.positions || []).length + "</p>"
        + "<p>Status: " + html(account.status) + "</p>"
        + "</article>";
    }).join("") || emptyItem("No visible accounts", "Sign in with an email that has SmartSleeve account access.");
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
        if (!points.length && numeric(row.position.value) != null) {
          points = [{at: row.account.generatedAt || new Date().toISOString(), value: row.position.value}];
        }
        var title = row.position.symbol + " / " + row.account.account;
        var meta = (row.position.name || tickerNames[row.position.symbol] || row.position.symbol) + " holding value";
        return lineChartCard(title, meta, points, "value", "Stock value", row.position.totalPnl);
      }).join("") || emptyItem("No holding history", "Stock holding charts appear after private feed history syncs.");
    }
  }

  function renderSleeveSummary(total) {
    var target = $("sleeve-summary");
    if (!target) return;
    target.innerHTML = state.sleeves.slice(0, 8).map(function (sleeve) {
      var value = sleeve.exactValue ? money(sleeve.exactValue) : "Ledger split pending";
      return stackItem(sleeve.name, value, sleeve.accounts.join(", ") + " / " + (sleeve.holdings.slice(0, 7).join(", ") || "No current holdings"), sleeve.exactValue && total ? sleeve.exactValue / total * 100 : 20);
    }).join("");
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

  function reportCard(report) {
    var url = report.url || report.latestUrl || "#";
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
      return "<tr>"
        + cell("Ticker", "<b>" + html(holding.symbol) + "</b><small>" + html(holding.name) + "</small>")
        + cell("Company", html(holding.name))
        + cell("Shares", numberText(holding.shares, 6))
        + cell("Stock price", money(holding.price))
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

  function renderSleeves() {
    var total = accountTotal("equity");
    var cards = $("sleeve-cards");
    if (cards) {
      cards.innerHTML = state.sleeves.map(function (sleeve) {
        var actual = sleeve.exactValue && total ? sleeve.exactValue / total * 100 : null;
        var drift = actual == null || !sleeve.target ? "Needs target/ledger" : (actual - sleeve.target).toFixed(1) + " pts";
        return "<article class=\"sleeve-card\">"
          + "<span>" + html(sleeve.operatingMode || "mode unknown") + "</span>"
          + "<h3>" + html(sleeve.name) + "</h3>"
          + "<p>Value: <b>" + (sleeve.exactValue ? money(sleeve.exactValue) : "Ledger split pending") + "</b></p>"
          + "<p>Cash: " + money(sleeve.cash) + " / holdings " + money(sleeve.positionValue) + "</p>"
          + "<p>Target: " + sleeve.target + "% / Actual: " + (actual == null ? "needs ledger" : actual.toFixed(1) + "%") + "</p>"
          + "<p>Drift: " + html(drift) + "</p>"
          + "<div class=\"progress-bar\" style=\"--value:" + Math.min(100, actual || 18) + "%\"><i></i></div>"
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
  }

  function renderTradeCenter() {
    populateSelect("trade-account", state.accounts.map(function (account) { return [account.account, account.account + " / " + account.broker]; }));
    populateSelect("trade-sleeve", state.sleeves.map(function (sleeve) { return [sleeve.name, sleeve.name]; }));
    updateTradePreview();
    renderDraftOrders();
    renderActivity();
    renderServerTrades();
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
      previewRow("Strategy", intent.strategy),
      previewRow("Quantity", intent.quantity == null ? "By sizing mode" : numberText(intent.quantity, 6)),
      previewRow("Estimated notional", money(notional)),
      previewRow("Account", intent.account_label || "Needs account"),
      previewRow("Sleeve", intent.sleeve || "Needs sleeve"),
      previewRow("Order type", orderTypeLabels[intent.order_type] || intent.order_type),
      previewRow("Session", sessionLabels[intent.session] || intent.session),
      previewRow("Time in force", intent.time_in_force),
      previewRow("Execution route", routeLabels[intent.execution_route] || intent.execution_route),
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
    renderActivity();
    toast("Draft intent created. Broker preview and approval are still required.");
  }

  function renderDraftOrders() {
    var list = $("order-list");
    text("order-count", String(state.draftOrders.length));
    if (!list) return;
    list.innerHTML = state.draftOrders.map(function (order) {
      return "<article class=\"stack-item\">"
        + "<div class=\"stack-item-head\"><b>" + html(order.ticker + " " + order.action) + "</b><span>" + html(order.status) + "</span></div>"
        + "<p>" + html(order.account) + " / " + html(order.sleeve) + " / " + money(order.notional) + "</p>"
        + "<p>" + html(orderTypeLabels[order.orderType] || order.orderType) + (order.limit ? " limit " + html(order.limit) : "") + " / " + html(order.tif) + " / " + html(order.operator) + "</p>"
        + "<div class=\"recommendation-actions\"><button type=\"button\" class=\"text-button\" data-order-action=\"preview\" data-order-id=\"" + html(order.id) + "\">Server preview</button><button type=\"button\" class=\"text-button\" data-order-action=\"copy\" data-order-id=\"" + html(order.id) + "\">Copy JSON</button><button type=\"button\" class=\"danger-button small\" data-order-action=\"reject\" data-order-id=\"" + html(order.id) + "\">Reject</button></div>"
        + "</article>";
    }).join("") || emptyItem("No pending orders", "Create a draft from the ticket or a Sage recommendation.");
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
    var rows = visibleRows(state.serverTrades).slice(0, 40);
    if (!state.selectedTradeId && rows.length) {
      state.selectedTradeId = tradeId(rows[0]);
    }
    target.innerHTML = rows.map(function (trade) {
      var id = tradeId(trade);
      var selected = id === state.selectedTradeId;
      var title = tradeTitle(trade);
      var meta = (trade.workflow || trade.autoGuardMode || "manual/order") + " / " + (trade.operatorId || trade.operator_id || "SQTS_AUTO");
      var body = (trade.account || trade.accountId || "") + " / " + money(trade.notionalUsd != null ? trade.notionalUsd : trade.notional_usd) + " / " + (trade.submittedAt || trade.submitted_at || "time unknown");
      return "<button type=\"button\" class=\"trade-row" + (selected ? " active" : "") + "\" data-server-trade-id=\"" + html(id) + "\">"
        + "<span><b>" + html(title) + "</b><small>" + html(body) + "</small></span>"
        + "<i>" + html(meta) + "</i>"
        + "</button>";
    }).join("") || emptyItem("No server trade history", "Analytics trade ledger is not available for this user/account yet.");
    renderTradeDetail();
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

  function workflowLabel(trade) {
    var workflow = trade.workflow || trade.command || trade.strategy;
    if (workflow) return workflow;
    if (trade.autoGuardMode || trade.autoGuardEndAt) return "autoGuard supervised";
    var origin = String(trade.origin || trade.operatorId || trade.operator_id || "").toLowerCase();
    return origin.indexOf("sage") !== -1 || origin.indexOf("custom_sage") !== -1 ? "Sage-directed order" : "Manual/direct order";
  }

  function renderTradeDetail() {
    var panel = $("trade-detail-panel");
    var status = $("trade-detail-status");
    if (!panel) return;
    var trade = visibleRows(state.serverTrades).find(function (row) { return tradeId(row) === state.selectedTradeId; });
    if (!trade) {
      panel.innerHTML = emptyItem("Select a trade", "Choose a submitted trade to inspect execution details and retrospective diagnostics.");
      if (status) status.textContent = "Select trade";
      return;
    }
    var evaluation = trade.evaluation || {};
    var evalStatus = evaluation.status || retrospectiveStatus(trade);
    if (status) status.textContent = evalStatus;
    panel.innerHTML = ""
      + "<div class=\"trade-detail-title\"><h3>" + html(tradeTitle(trade)) + "</h3><span>" + html(evalStatus) + "</span></div>"
      + "<div class=\"detail-grid\">"
      + detailItem("Origin", trade.origin || workflowLabel(trade))
      + detailItem("Workflow", workflowLabel(trade))
      + detailItem("Account", trade.account || trade.accountId || "Unknown")
      + detailItem("Sleeve", trade.sleeve || trade.sleeveId || "Unknown")
      + detailItem("Submitted", trade.submittedAt || trade.submitted_at || "Unknown")
      + detailItem("Status", trade.status || "submitted_or_recorded")
      + detailItem("Order type", orderTypeLabels[trade.orderType || trade.order_type] || trade.orderType || trade.order_type || "Unknown")
      + detailItem("Session", sessionLabels[trade.session] || trade.session || "Unknown")
      + detailItem("Time in force", trade.timeInForce || trade.time_in_force || "Needs broker sync")
      + detailItem("Limit price", trade.limitPrice == null ? "None/market" : money(trade.limitPrice))
      + detailItem("Quantity", trade.quantity == null ? "Needs fill sync" : numberText(trade.quantity, 6))
      + detailItem("Notional", money(trade.notionalUsd != null ? trade.notionalUsd : trade.notional_usd))
      + detailItem("Order ID", trade.orderId || trade.order_id || "Needs broker sync")
      + detailItem("autoGuard mode", trade.autoGuardMode || trade.auto_guard_mode || "Not used")
      + detailItem("autoGuard end", trade.autoGuardEndAt || trade.auto_guard_end_at || "Not windowed")
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
      + gaugeCard("autoGuard", clampPct(evaluation.basisCapturePct), "Basis capture versus the best achievable retrospective entry/exit/reallocation.")
      + "<article class=\"gauge-card\"><span>You saved</span><h3>" + html(money(evaluation.savedUsd)) + "</h3><p>Estimated improvement from autoGuard versus immediate/manual baseline, using " + html(evaluation.dataSource || "yFinance") + " data.</p></article>"
      + "</div>";
  }

  function clampPct(value) {
    var number = numeric(value);
    if (number == null) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function retrospectiveExplainer(trade) {
    if (!(trade.autoGuardMode || trade.autoGuardEndAt || trade.workflow)) {
      return "This looks like a manual/direct order. HEB, basis capture, and autoGuard savings are reserved for Sage windowed entries, exits, and reallocations.";
    }
    if (trade.autoGuardEndAt && Date.now() < new Date(trade.autoGuardEndAt).getTime()) {
      return "autoGuard diagnostics will unlock after the specified end time, once retrospective market data are available.";
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
      return "<article class=\"recommendation-card\"><span>" + html(rec.operator) + "</span><h3>" + html(rec.title) + "</h3><p><b>" + html(rec.action) + "</b> / " + html(rec.account) + " / " + html(rec.ticker) + "</p><p>" + html(rec.reason) + "</p><p>Main risk: " + html(rec.risk) + "</p><div class=\"recommendation-actions\"><button type=\"button\" class=\"text-button\" data-rec-draft=\"" + html(rec.id) + "\">Create draft</button><button type=\"button\" class=\"danger-button small\" data-rec-dismiss=\"" + html(rec.id) + "\">Reject</button></div></article>";
    }).join("");
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
          + cell("Risk note", cash < 0 ? "Negative cash, review margin" : "Cash non-negative")
          + "</tr>";
      }).join("");
    }
  }

  function renderAll() {
    state.sleeves = buildSleeves(state.accounts);
    state.recommendations = buildRecommendations();
    renderSession();
    renderDashboard();
    renderSleeves();
    renderTradeCenter();
    renderSage();
    renderRisk();
  }

  function stackItem(title, meta, body, progress, className) {
    return "<article class=\"stack-item " + html(className || "") + "\"><div class=\"stack-item-head\"><b>" + html(title) + "</b><span>" + html(meta) + "</span></div><p>" + html(body) + "</p><div class=\"progress-bar\" style=\"--value:" + Math.max(0, Math.min(100, Number(progress) || 0)) + "%\"><i></i></div></article>";
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

  function buildLineChart(points, lineColor, yLabel) {
    var width = 420;
    var height = 220;
    var left = 58;
    var right = 18;
    var top = 18;
    var bottom = 46;
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
        + "<text x=\"" + (left - 8) + "\" y=\"" + (Number(yy) + 4) + "\" class=\"chart-tick\" text-anchor=\"end\">" + html(compactMoney(tick)) + "</text>";
    }).join("");
    var dots = points.length === 1
      ? "<circle cx=\"" + x(points[0]).toFixed(1) + "\" cy=\"" + y(points[0].value).toFixed(1) + "\" r=\"4\" fill=\"" + lineColor + "\"/>"
      : "";
    return "<svg class=\"line-chart\" viewBox=\"0 0 " + width + " " + height + "\" role=\"img\" aria-label=\"" + html(yLabel) + " over time\">"
      + grid
      + "<line x1=\"" + left + "\" y1=\"" + top + "\" x2=\"" + left + "\" y2=\"" + (height - bottom) + "\" class=\"chart-axis\"/>"
      + "<line x1=\"" + left + "\" y1=\"" + (height - bottom) + "\" x2=\"" + (width - right) + "\" y2=\"" + (height - bottom) + "\" class=\"chart-axis\"/>"
      + "<path d=\"" + path + "\" fill=\"none\" stroke=\"" + lineColor + "\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
      + dots
      + "<text x=\"" + ((left + width - right) / 2) + "\" y=\"" + (height - 12) + "\" class=\"chart-label\" text-anchor=\"middle\">Time</text>"
      + "<text x=\"16\" y=\"" + ((top + height - bottom) / 2) + "\" class=\"chart-label\" transform=\"rotate(-90 16 " + ((top + height - bottom) / 2) + ")\" text-anchor=\"middle\">" + html(yLabel) + "</text>"
      + "<text x=\"" + left + "\" y=\"" + (height - 28) + "\" class=\"chart-tick\" text-anchor=\"start\">" + html(shortDate(points[0].at)) + "</text>"
      + "<text x=\"" + (width - right) + "\" y=\"" + (height - 28) + "\" class=\"chart-tick\" text-anchor=\"end\">" + html(shortDate(points[points.length - 1].at)) + "</text>"
      + "</svg>";
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

  function handleNav(section) {
    var target = section || "dashboard";
    var aliases = {overview: "dashboard", portfolio: "dashboard", command: "trade", trades: "trade"};
    target = aliases[target] || target;
    $all("[data-section]").forEach(function (panel) {
      panel.classList.toggle("active", panel.getAttribute("data-section") === target);
    });
    $all("[data-nav]").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-nav") === target);
    });
    var titles = {
      dashboard: ["Dashboard", "What you own, why you own it, what changed, and what needs review."],
      sleeves: ["Sleeves", "Strategy buckets with target allocation, drift, risk, and actions."],
      trade: ["Trade Center", "Draft, review, approve, reject, and audit trade decisions."],
      sage: ["Sage", "Portfolio-specific recommendations and execution diagnostics."],
      risk: ["Risk", "Concentration, margin, broker, sleeve, and event risk."]
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
                  toast("Server accepted the draft for preview.");
                }
              })
              .catch(function (error) {
                order.status = "Server preview unavailable";
                persistDraftOrders();
                renderDraftOrders();
                toast("Server preview unavailable: " + error.message);
              });
          } else {
            order.status = "Rejected by user";
          }
          addActivity("Order " + (action === "preview" ? "preview requested" : "rejected"), order.operator, order.account, order.ticker + " " + order.action);
          persistDraftOrders();
          renderDraftOrders();
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
      var recDismiss = event.target.closest("[data-rec-dismiss]");
      if (recDismiss) {
        state.recommendations = state.recommendations.filter(function (item) { return item.id !== recDismiss.getAttribute("data-rec-dismiss"); });
        renderDashboard();
        renderSage();
        renderRisk();
        toast("Recommendation rejected.");
      }
    });
    document.addEventListener("change", function (event) {
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
    if (profile.email) {
      principalEmail = normalizeEmail(profile.email);
    }
    if (profile.role === "developer") {
      appEdition = "developer";
      accountScope = "all";
    } else {
      appEdition = appEdition === "developer" ? "web" : appEdition;
      accountScope = "user";
    }
    var accounts = (payload.accounts || []).map(normalizeAccount);
    state.payload = payload;
    state.feedSource = sourceUrl;
    state.accounts = visibleRows(accounts);
    var aggregated = aggregateHoldings(state.accounts);
    state.holdings = aggregated.holdings;
    state.foreignHoldings = aggregated.foreign;
    var visibleAccountIds = {};
    state.accounts.forEach(function (account) { visibleAccountIds[account.id] = true; });
    var history = payload.history || {};
    state.history = {
      accounts: visibleRows(history.accounts || []).filter(function (row) { return visibleAccountIds[row.accountId]; }),
      positions: visibleRows(history.positions || []).filter(function (row) { return visibleAccountIds[row.accountId]; })
    };
    state.serverTrades = visibleRows(payload.trades || []);
    state.brain = visibleRows(payload.brain || []);
    state.reports = visibleRows(payload.reports || []);
    text("snapshot-source", payload.source || "Private SmartSleeve API");
    text("snapshot-time", payload.generated_at ? "Generated " + payload.generated_at : "Generated time unavailable");
    text("sync-pill", "Private API synced");
    addActivity("Cloud feed synced", "EXTERNAL_BROKER_SYNC", appEdition === "developer" ? "All accounts" : principalEmail, state.accounts.length + " account(s), " + state.serverTrades.length + " trades, " + state.brain.length + " brain rows.");
    renderAll();
    handleNav((window.location.hash || "#dashboard").replace("#", "") || "dashboard");
  }

  function fetchAppFeed() {
    if (!appFeedEndpoint) {
      return Promise.reject(new Error("SmartSleeve private API is not configured."));
    }
    return authFetch(appFeedEndpoint + (appFeedEndpoint.indexOf("?") === -1 ? "?ts=" : "&ts=") + Date.now())
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

  function loadFeed() {
    fetchAppFeed()
      .then(function (result) { applyFeed(result.payload, result.url); })
      .catch(function (error) {
        text("sync-pill", "Sync failed");
        text("snapshot-time", "Feed unavailable");
        state.accounts = [];
        state.holdings = [];
        state.sleeves = [];
        state.recommendations = [recommendation("feed-failed", "Reconnect cloud feed", "Broker sync", "SmartSleeve", "Data", 0, error.message, "No portfolio decisions should be made until current holdings are available.", "EXTERNAL_BROKER_SYNC")];
        renderAll();
        if (error.authRequired) {
          showAuthGate(error.message);
        } else {
          showAuthGate("Private feed unavailable: " + error.message);
        }
        toast("Portfolio feed failed to load.");
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    restoreDraftOrders();
    renderSession();
    wireEvents();
    loadFeed();
  });
})();
