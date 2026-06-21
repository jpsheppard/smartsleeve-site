(function () {
  "use strict";

  var qs = function (selector, root) {
    return (root || document).querySelector(selector);
  };
  var qsa = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  var params = new URLSearchParams(window.location.search);
  var appEdition = params.get("app_edition") || "web";
  var accountScope = params.get("account_scope") || "user";
  var principalEmail = normalizeEmail(params.get("principal_email") || "");

  var state = {
    payload: null,
    accounts: [],
    holdings: [],
    foreignHoldings: [],
    sleeves: [],
    recommendations: [],
    orders: [],
    activity: [],
    sageMode: "recommend"
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

  var sleeveTargets = {
    "Sage by SmartSleeve": 35,
    "Grand Sage": 30,
    "Savage Sage": 12,
    "Honey Badger": 8,
    "Value Sage": 8,
    "Edge Sage": 4,
    "Covered Sage": 2,
    "Convex Sage": 1
  };

  var sageModes = [
    {
      id: "observe",
      name: "Observe Only",
      description: "Sage can analyze the portfolio but cannot create recommendations or orders."
    },
    {
      id: "recommend",
      name: "Recommend",
      description: "Sage can create specific recommendations, but not broker orders."
    },
    {
      id: "assisted",
      name: "Assisted Trading",
      description: "Sage can prepare draft orders that require user approval before broker preview."
    },
    {
      id: "rules",
      name: "Rules-Based Automation",
      description: "SmartSleeve can submit only within explicit user-defined sleeve rules and limits."
    },
    {
      id: "auto",
      name: "Fully Automated Sleeve",
      description: "Allowed only for enabled sleeves with strict limits, logs, and kill switch."
    }
  ];

  var basisCapture = [
    {
      label: "Entry",
      value: 82,
      description: "Average buy execution captured versus Hindsight Efficient Basis after approved windows close."
    },
    {
      label: "Exit",
      value: 74,
      description: "Average sell execution captured versus best observed reachable exit basis."
    },
    {
      label: "Reallocation",
      value: 68,
      description: "Sequential source-sale and target-buy capture for approved reallocations."
    },
    {
      label: "Investor window",
      value: 77,
      description: "How much the chosen mandate windows helped Sage versus immediate crossing."
    }
  ];

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function money(value) {
    if (typeof value !== "number" || !isFinite(value)) {
      return "Needs sync";
    }
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2
    });
  }

  function number(value, digits) {
    if (typeof value !== "number" || !isFinite(value)) {
      return "Needs sync";
    }
    return value.toLocaleString("en-US", {
      maximumFractionDigits: digits == null ? 2 : digits
    });
  }

  function pct(value, total, digits) {
    if (!total || typeof value !== "number" || !isFinite(value)) {
      return "0%";
    }
    return (value / total * 100).toFixed(digits == null ? 1 : digits) + "%";
  }

  function node(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var el = node(id);
    if (el) {
      el.textContent = value;
    }
  }

  function splitSleeves(value) {
    return String(value || "")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(Boolean)
      .map(function (item) { return item === "Hyper Savage" ? "Covered Sage" : item; });
  }

  function visibleAccounts(accounts) {
    if (accountScope === "all" || appEdition === "developer") {
      return accounts.slice();
    }
    if (!principalEmail) {
      return accounts.slice();
    }
    return accounts.filter(function (account) {
      return normalizeEmail(account.ownerEmail) === principalEmail;
    });
  }

  function accountEquityTotal(accounts) {
    return accounts.reduce(function (sum, account) {
      return sum + (Number(account.equity) || 0);
    }, 0);
  }

  function cashTotal(accounts) {
    return accounts.reduce(function (sum, account) {
      return sum + (Number(account.cash) || 0);
    }, 0);
  }

  function buyingPowerTotal(accounts) {
    return accounts.reduce(function (sum, account) {
      return sum + (Number(account.buyPower) || 0);
    }, 0);
  }

  function marginUsed(accounts) {
    return accounts.reduce(function (sum, account) {
      var cash = Number(account.cash) || 0;
      return sum + (cash < 0 ? Math.abs(cash) : 0);
    }, 0);
  }

  function aggregateHoldings(accounts) {
    var grouped = {};
    var foreign = [];
    accounts.forEach(function (account) {
      (account.positions || []).forEach(function (position) {
        var currency = position.currency || "USD";
        var value = Number(position.value) || 0;
        var shares = Number(position.shares) || 0;
        var price = Number(position.price) || 0;
        var symbol = String(position.symbol || "").toUpperCase();
        if (currency !== "USD") {
          foreign.push({
            symbol: symbol,
            name: position.name || tickerNames[symbol] || symbol,
            shares: shares,
            price: price,
            value: value,
            currency: currency,
            account: account.account
          });
          return;
        }
        if (!grouped[symbol]) {
          grouped[symbol] = {
            symbol: symbol,
            name: position.name || tickerNames[symbol] || symbol,
            shares: 0,
            value: 0,
            weightedPriceValue: 0,
            accounts: [],
            sleeves: []
          };
        }
        grouped[symbol].shares += shares;
        grouped[symbol].value += value;
        grouped[symbol].weightedPriceValue += price * value;
        if (grouped[symbol].accounts.indexOf(account.account) === -1) {
          grouped[symbol].accounts.push(account.account);
        }
        splitSleeves(account.sleeves).forEach(function (sleeve) {
          if (grouped[symbol].sleeves.indexOf(sleeve) === -1) {
            grouped[symbol].sleeves.push(sleeve);
          }
        });
      });
    });
    var holdings = Object.keys(grouped).map(function (symbol) {
      var row = grouped[symbol];
      row.avgPrice = row.value ? row.weightedPriceValue / row.value : 0;
      return row;
    });
    holdings.sort(function (a, b) { return b.value - a.value; });
    return {holdings: holdings, foreign: foreign};
  }

  function buildSleeves(accounts) {
    var sleeves = {};
    accounts.forEach(function (account) {
      var names = splitSleeves(account.sleeves);
      if (!names.length) {
        names = ["Unassigned"];
      }
      names.forEach(function (name) {
        if (!sleeves[name]) {
          sleeves[name] = {
            name: name,
            accounts: [],
            exactValue: 0,
            ledgerPending: false,
            holdings: [],
            target: sleeveTargets[name] || 0
          };
        }
        if (sleeves[name].accounts.indexOf(account.account) === -1) {
          sleeves[name].accounts.push(account.account);
        }
        if (names.length === 1) {
          sleeves[name].exactValue += Number(account.equity) || 0;
        } else {
          sleeves[name].ledgerPending = true;
        }
        (account.positions || []).forEach(function (position) {
          if ((position.currency || "USD") === "USD") {
            var symbol = String(position.symbol || "").toUpperCase();
            if (sleeves[name].holdings.indexOf(symbol) === -1) {
              sleeves[name].holdings.push(symbol);
            }
          }
        });
      });
    });
    return Object.keys(sleeves)
      .map(function (key) { return sleeves[key]; })
      .sort(function (a, b) {
        return (b.exactValue || 0) - (a.exactValue || 0) || a.name.localeCompare(b.name);
      });
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

  function buildRecommendations(accounts, holdings) {
    var total = accountEquityTotal(accounts);
    var bySymbol = {};
    holdings.forEach(function (holding) {
      bySymbol[holding.symbol] = holding;
    });
    var mu = bySymbol.MU ? bySymbol.MU.value : 0;
    var sndk = bySymbol.SNDK ? bySymbol.SNDK.value : 0;
    var top = holdings[0];
    var recommendations = [];
    if (mu + sndk > total * 0.35) {
      recommendations.push({
        id: "semi-concentration",
        title: "Review MU/SNDK concentration",
        action: "Rebalance",
        account: "Cross-account",
        ticker: "MU, SNDK",
        notional: Math.round((mu + sndk) - total * 0.35),
        reason: "MU and SNDK are a large share of tracked equity. Review whether current target still fits the investor thesis.",
        risk: "A 10% combined move in MU/SNDK would have a visible portfolio impact.",
        operator: "SAGE_RECOMMEND"
      });
    }
    if (top && top.value > total * 0.2) {
      recommendations.push({
        id: "single-name",
        title: "Check largest single-name risk",
        action: "Trim",
        account: top.accounts.join(", "),
        ticker: top.symbol,
        notional: Math.round(top.value - total * 0.18),
        reason: top.symbol + " is the largest position in the visible portfolio.",
        risk: "Single-name drawdown can dominate daily portfolio P/L.",
        operator: "SAGE_RECOMMEND"
      });
    }
    if (accounts.some(function (account) { return splitSleeves(account.sleeves).length > 1; })) {
      recommendations.push({
        id: "sleeve-ledger",
        title: "Sync sleeve ledger splits",
        action: "Assign",
        account: "Multi-sleeve accounts",
        ticker: "Ledger",
        notional: 0,
        reason: "John RH, IBKR Margin, and Crissy RH contain multiple sleeves. Exact sleeve return needs lot-level sleeve ownership.",
        risk: "Without this, sleeve return and alpha are account-level estimates.",
        operator: "SQTS_REBALANCE"
      });
    }
    if (marginUsed(accounts) > 0) {
      recommendations.push({
        id: "margin-cash",
        title: "Review negative cash before adding risk",
        action: "Raise cash",
        account: accounts.filter(function (account) { return (Number(account.cash) || 0) < 0; }).map(function (a) { return a.account; }).join(", "),
        ticker: "Cash",
        notional: marginUsed(accounts),
        reason: "At least one account reports negative cash.",
        risk: "Margin pressure can force less patient execution during volatility.",
        operator: "SQTS_RISK_EXIT"
      });
    }
    recommendations.push({
      id: "broker-pl",
      title: "Enable intraday P/L and cost basis sync",
      action: "Broker sync",
      account: "All connected brokers",
      ticker: "P/L",
      notional: 0,
      reason: "Dashboard can show holdings now, but daily P/L, total P/L, and return need broker-reported basis and time-series equity.",
      risk: "Without live P/L, contributors and detractors stay unavailable.",
      operator: "SQTS_AUTO"
    });
    return recommendations;
  }

  function renderSession() {
    setText("edition-label", appEdition === "developer" ? "Developer Edition" : "SmartSleeve");
    setText("session-title", appEdition === "developer" ? "All-account dashboard" : (principalEmail || "Verified user"));
    setText("session-detail", appEdition === "developer"
      ? "Cross-account diagnostics and operator tools."
      : "User-scoped accounts only.");
    setText("portfolio-value-label", appEdition === "developer" ? "All tracked account value" : "Your tracked account value");
  }

  function renderDashboard() {
    var accounts = state.accounts;
    var holdings = state.holdings;
    var total = accountEquityTotal(accounts);
    var cash = cashTotal(accounts);
    var bp = buyingPowerTotal(accounts);
    var margin = marginUsed(accounts);
    setText("portfolio-value", money(total));
    setText("portfolio-scope", appEdition === "developer"
      ? "All visible SmartSleeve accounts in the current analytics snapshot."
      : "Accounts tied to " + (principalEmail || "the signed-in user") + ".");
    setText("cash-value", money(cash));
    setText("buying-power", money(bp));
    setText("margin-usage", margin ? money(margin) : "$0");
    setText("daily-pl", "Needs P/L sync");
    setText("total-pl", "Needs cost basis");
    setText("portfolio-return", "Needs history");
    setText("sage-review-count", String(state.recommendations.length));

    var topHoldings = node("top-holdings");
    if (topHoldings) {
      topHoldings.innerHTML = holdings.slice(0, 5).map(function (holding) {
        var weight = pct(holding.value, total);
        return stackItem(
          holding.symbol + " - " + holding.name,
          money(holding.value) + " / " + weight,
          number(holding.shares, 6) + " shares across " + holding.accounts.length + " account(s)",
          Math.min(100, holding.value / total * 100)
        );
      }).join("") || emptyItem("No holdings found", "Connect or sync a broker to import positions.");
    }

    var reviewQueue = node("review-queue");
    if (reviewQueue) {
      reviewQueue.innerHTML = state.recommendations.slice(0, 5).map(function (rec) {
        return stackItem(rec.title, rec.action + " / " + rec.operator, rec.reason, rec.action === "Broker sync" ? 35 : 75);
      }).join("");
    }

    var accountCards = node("account-cards");
    if (accountCards) {
      accountCards.innerHTML = accounts.map(function (account) {
        var cash = Number(account.cash) || 0;
        return "<article class=\"account-card\">"
          + "<div class=\"stack-item-head\"><b>" + escapeHtml(account.account) + "</b><span>" + escapeHtml(account.broker) + "</span></div>"
          + "<p>Equity: <b>" + money(Number(account.equity) || 0) + "</b></p>"
          + "<p>Cash: <span class=\"" + (cash < 0 ? "negative" : "positive") + "\">" + money(cash) + "</span> / buying power " + money(Number(account.buyPower) || 0) + "</p>"
          + "<p>Status: " + escapeHtml(account.status || "synced") + "</p>"
          + "</article>";
      }).join("") || emptyItem("No visible accounts", "Sign in with an email that has SmartSleeve account access.");
    }

    var sleeveSummary = node("sleeve-summary");
    if (sleeveSummary) {
      sleeveSummary.innerHTML = state.sleeves.slice(0, 7).map(function (sleeve) {
        var value = sleeve.exactValue ? money(sleeve.exactValue) : "Ledger split pending";
        var body = sleeve.accounts.join(", ") + " / " + (sleeve.holdings.slice(0, 6).join(", ") || "No positions");
        return stackItem(sleeve.name, value, body, sleeve.exactValue && total ? sleeve.exactValue / total * 100 : 20);
      }).join("");
    }

    renderHoldingsTable();
  }

  function renderHoldingsTable() {
    var total = accountEquityTotal(state.accounts);
    var rows = state.holdings.slice();
    var sort = node("holdings-sort");
    var sortValue = sort ? sort.value : "value";
    if (sortValue === "symbol") {
      rows.sort(function (a, b) { return a.symbol.localeCompare(b.symbol); });
    } else if (sortValue === "account") {
      rows.sort(function (a, b) { return b.accounts.length - a.accounts.length || b.value - a.value; });
    } else {
      rows.sort(function (a, b) { return b.value - a.value; });
    }
    var table = node("holdings-table");
    if (!table) {
      return;
    }
    table.innerHTML = rows.map(function (holding) {
      var weightNum = total ? holding.value / total : 0;
      return "<tr>"
        + cell("Ticker", "<b>" + escapeHtml(holding.symbol) + "</b><small>" + escapeHtml(holding.name) + "</small>")
        + cell("Quantity", number(holding.shares, 6) + "<small>Avg " + money(holding.avgPrice) + "</small>")
        + cell("Market value", money(holding.value))
        + cell("Weight", pct(holding.value, total))
        + cell("Accounts", escapeHtml(holding.accounts.join(", ")))
        + cell("Thesis status", escapeHtml(thesisStatus(holding.symbol, weightNum)))
        + "</tr>";
    }).join("") || "<tr>" + cell("Holdings", "No holdings synced") + "</tr>";
  }

  function renderSleeves() {
    var total = accountEquityTotal(state.accounts);
    var cards = node("sleeve-cards");
    if (cards) {
      cards.innerHTML = state.sleeves.map(function (sleeve) {
        var actual = sleeve.exactValue && total ? sleeve.exactValue / total * 100 : null;
        var drift = actual == null ? "Ledger pending" : (actual - sleeve.target).toFixed(1) + " pts";
        var risk = sleeve.ledgerPending ? "Medium: needs ledger split" : (actual > 35 ? "High concentration" : "Normal");
        return "<article class=\"sleeve-card\">"
          + "<span>" + escapeHtml(sleeve.accounts.length + " account link(s)") + "</span>"
          + "<h3>" + escapeHtml(sleeve.name) + "</h3>"
          + "<p>Value: <b>" + (sleeve.exactValue ? money(sleeve.exactValue) : "Ledger split pending") + "</b></p>"
          + "<p>Target: " + sleeve.target + "% / Actual: " + (actual == null ? "needs ledger" : actual.toFixed(1) + "%") + "</p>"
          + "<p>Drift: " + escapeHtml(drift) + "</p>"
          + "<p>Risk: " + escapeHtml(risk) + "</p>"
          + "<div class=\"progress-bar\" style=\"--value:" + Math.min(100, actual || 18) + "%\"><i></i></div>"
          + "</article>";
      }).join("");
    }

    var rebalanceList = node("rebalance-list");
    if (rebalanceList) {
      rebalanceList.innerHTML = [
        stackItem("Resolve sleeve ledger splits", "Required before exact sleeve P/L", "Map each lot to a sleeve in John RH, John IBKR Margin, and Crissy RH.", 90),
        stackItem("Review semiconductor sleeve target", "MU/SNDK concentration", "Confirm whether current semiconductor exposure still matches the intended target.", 80),
        stackItem("Keep Sage automation gated", "Default mode: Recommend", "Draft orders are allowed after user approval; live automation requires sleeve limits and kill switch.", 60)
      ].join("");
    }

    var table = node("sleeve-table");
    if (table) {
      table.innerHTML = state.sleeves.map(function (sleeve) {
        return "<tr>"
          + cell("Sleeve", "<b>" + escapeHtml(sleeve.name) + "</b>")
          + cell("Account", escapeHtml(sleeve.accounts.join(", ")))
          + cell("Holdings", escapeHtml(sleeve.holdings.slice(0, 8).join(", ") || "No positions"))
          + cell("Known value", sleeve.exactValue ? money(sleeve.exactValue) : "Needs sleeve ledger")
          + cell("Next action", sleeve.ledgerPending ? "Assign lots to sleeve" : "Review drift")
          + "</tr>";
      }).join("");
    }
  }

  function renderTradeCenter() {
    populateSelect("trade-account", state.accounts.map(function (account) {
      return {value: account.account, label: account.account + " / " + account.broker};
    }));
    populateSelect("trade-sleeve", state.sleeves.map(function (sleeve) {
      return {value: sleeve.name, label: sleeve.name};
    }));
    updateTradePreview();
    renderOrders();
    renderActivity();
  }

  function populateSelect(id, rows) {
    var select = node(id);
    if (!select || select.options.length) {
      return;
    }
    select.innerHTML = rows.map(function (row) {
      return "<option value=\"" + escapeHtml(row.value) + "\">" + escapeHtml(row.label) + "</option>";
    }).join("");
  }

  function updateTradePreview() {
    var account = valueOf("trade-account");
    var sleeve = valueOf("trade-sleeve");
    var ticker = String(valueOf("trade-ticker") || "").toUpperCase();
    var action = valueOf("trade-action");
    var quantity = valueOf("trade-quantity") || "By dollar amount";
    var notional = Number(valueOf("trade-notional")) || 0;
    var orderType = valueOf("trade-order-type");
    var limit = valueOf("trade-limit");
    var tif = valueOf("trade-tif");
    var operator = valueOf("trade-operator");
    var reason = valueOf("trade-reason");
    var accountRow = state.accounts.find(function (item) { return item.account === account; });
    var total = accountEquityTotal(state.accounts);
    var estimatedPortfolioWeight = total && notional ? pct(notional, total) : "Needs notional";
    var cashAfter = accountRow && typeof accountRow.cash === "number" ? money(accountRow.cash - notional) : "Needs broker cash";
    var preview = node("trade-preview");
    if (!preview) {
      return;
    }
    preview.innerHTML = [
      previewRow("Ticker", ticker || "Needs ticker"),
      previewRow("Action", action),
      previewRow("Quantity", quantity),
      previewRow("Estimated notional", money(notional)),
      previewRow("Account", account || "Needs account"),
      previewRow("Sleeve", sleeve || "Needs sleeve"),
      previewRow("Order type", orderType + (limit ? " at " + limit : "")),
      previewRow("Time in force", tif),
      previewRow("Portfolio weight after trade", estimatedPortfolioWeight + " before existing position adjustment"),
      previewRow("Estimated cash after trade", cashAfter),
      previewRow("Main risk", "Execution and concentration must be checked against live broker preview."),
      previewRow("Reason", reason || "Needs reason"),
      previewRow("Source", operator)
    ].join("");
  }

  function createDraftOrder(event) {
    if (event) {
      event.preventDefault();
    }
    var order = {
      id: "DRAFT-" + String(Date.now()).slice(-6),
      time: new Date().toLocaleString(),
      account: valueOf("trade-account"),
      sleeve: valueOf("trade-sleeve"),
      ticker: String(valueOf("trade-ticker") || "").toUpperCase(),
      action: valueOf("trade-action"),
      quantity: valueOf("trade-quantity") || "dollar",
      notional: Number(valueOf("trade-notional")) || 0,
      orderType: valueOf("trade-order-type"),
      limit: valueOf("trade-limit"),
      tif: valueOf("trade-tif"),
      operator: valueOf("trade-operator"),
      status: "Awaiting approval",
      reason: valueOf("trade-reason")
    };
    state.orders.unshift(order);
    addActivity("Draft order created", order.operator, order.account, order.ticker + " " + order.action + " " + money(order.notional));
    renderOrders();
    renderActivity();
    toast("Draft order created. Broker preview and approval are still required.");
  }

  function renderOrders() {
    var list = node("order-list");
    setText("order-count", String(state.orders.length));
    if (!list) {
      return;
    }
    list.innerHTML = state.orders.map(function (order) {
      return "<article class=\"stack-item\">"
        + "<div class=\"stack-item-head\"><b>" + escapeHtml(order.ticker + " " + order.action) + "</b><span>" + escapeHtml(order.status) + "</span></div>"
        + "<p>" + escapeHtml(order.account) + " / " + escapeHtml(order.sleeve) + " / " + money(order.notional) + "</p>"
        + "<p>" + escapeHtml(order.orderType) + (order.limit ? " limit " + escapeHtml(order.limit) : "") + " / " + escapeHtml(order.tif) + " / " + escapeHtml(order.operator) + "</p>"
        + "<div class=\"recommendation-actions\">"
        + "<button type=\"button\" class=\"text-button\" data-order-action=\"approve\" data-order-id=\"" + escapeHtml(order.id) + "\">Approve</button>"
        + "<button type=\"button\" class=\"danger-button small\" data-order-action=\"reject\" data-order-id=\"" + escapeHtml(order.id) + "\">Reject</button>"
        + "</div>"
        + "</article>";
    }).join("") || emptyItem("No pending orders", "Create a draft from the ticket or a Sage recommendation.");
  }

  function renderActivity() {
    var list = node("activity-log");
    if (!list) {
      return;
    }
    list.innerHTML = state.activity.slice(0, 8).map(function (item) {
      return stackItem(item.event, item.operator + " / " + item.account, item.detail + " / " + item.time, 50);
    }).join("") || emptyItem("No activity yet", "Draft, approve, reject, or sync an order to create audit entries.");
  }

  function renderSage() {
    var modeList = node("sage-modes");
    if (modeList) {
      modeList.innerHTML = sageModes.map(function (mode) {
        return "<label class=\"mode-row\">"
          + "<input type=\"radio\" name=\"sage-mode\" value=\"" + escapeHtml(mode.id) + "\"" + (mode.id === state.sageMode ? " checked" : "") + ">"
          + "<span><b>" + escapeHtml(mode.name) + "</b><br>" + escapeHtml(mode.description) + "</span>"
          + "</label>";
      }).join("");
    }
    setText("sage-mode-status", sageModes.find(function (mode) { return mode.id === state.sageMode; }).name);

    var review = node("sage-review");
    if (review) {
      var total = accountEquityTotal(state.accounts);
      var top = state.holdings[0];
      var mu = state.holdings.find(function (h) { return h.symbol === "MU"; });
      var sndk = state.holdings.find(function (h) { return h.symbol === "SNDK"; });
      var semiValue = (mu ? mu.value : 0) + (sndk ? sndk.value : 0);
      review.innerHTML = [
        stackItem("Current value", money(total), "Tracked account equity in this app scope.", 80),
        stackItem("Largest position", top ? top.symbol + " / " + pct(top.value, total) : "Needs holdings", top ? thesisStatus(top.symbol, top.value / total) : "Connect broker.", top ? top.value / total * 100 : 0),
        stackItem("MU plus SNDK", money(semiValue) + " / " + pct(semiValue, total), "Semiconductor pair is the first concentration review target.", semiValue && total ? semiValue / total * 100 : 0),
        stackItem("Data gap", "Daily P/L and cost basis", "Enable broker P/L and basis sync before judging contributors, detractors, and total return.", 35)
      ].join("");
    }

    var cards = node("sage-recommendations");
    if (cards) {
      cards.innerHTML = state.recommendations.map(function (rec) {
        return "<article class=\"recommendation-card\">"
          + "<span>" + escapeHtml(rec.operator) + "</span>"
          + "<h3>" + escapeHtml(rec.title) + "</h3>"
          + "<p><b>" + escapeHtml(rec.action) + "</b> / " + escapeHtml(rec.account) + " / " + escapeHtml(rec.ticker) + "</p>"
          + "<p>" + escapeHtml(rec.reason) + "</p>"
          + "<p>Main risk: " + escapeHtml(rec.risk) + "</p>"
          + "<div class=\"recommendation-actions\">"
          + "<button type=\"button\" class=\"text-button\" data-rec-draft=\"" + escapeHtml(rec.id) + "\">Create draft</button>"
          + "<button type=\"button\" class=\"danger-button small\" data-rec-dismiss=\"" + escapeHtml(rec.id) + "\">Reject</button>"
          + "</div>"
          + "</article>";
      }).join("");
    }

    var gauges = node("basis-gauges");
    if (gauges) {
      gauges.innerHTML = basisCapture.map(gaugeCard).join("");
    }
  }

  function renderRisk() {
    var total = accountEquityTotal(state.accounts);
    var top = state.holdings[0];
    var topThree = state.holdings.slice(0, 3).reduce(function (sum, item) { return sum + item.value; }, 0);
    setText("largest-position", top ? top.symbol + " " + pct(top.value, total) : "Needs holdings");
    setText("largest-position-note", top ? money(top.value) + " in " + top.name : "Connect a broker to calculate.");
    setText("top-three-risk", pct(topThree, total));
    setText("risk-margin", marginUsed(state.accounts) ? money(marginUsed(state.accounts)) : "$0");
    setText("broker-health", state.accounts.length + " synced");

    var actions = node("risk-actions");
    if (actions) {
      actions.innerHTML = state.recommendations.slice(0, 5).map(function (rec) {
        return stackItem(rec.title, rec.action + " / " + rec.ticker, rec.risk, rec.action === "Rebalance" ? 85 : 55);
      }).join("");
    }

    var brokerConnections = node("broker-connections");
    if (brokerConnections) {
      var connected = state.accounts.map(function (account) {
        return stackItem(account.broker, "Connected / trading permissions account-specific", account.account + " last snapshot " + (account.generatedAt || "unknown"), 80);
      });
      connected.push(stackItem("Fidelity via Plaid", "Pending production access / read-only", "Sandbox keys cannot view John's live Fidelity accounts until production consent is approved.", 30));
      connected.push(stackItem("Schwab PCRA", "Pending official API onboarding", "Use read-only mode first; trading permission must be explicit.", 20));
      brokerConnections.innerHTML = connected.join("");
    }

    var table = node("risk-account-table");
    if (table) {
      table.innerHTML = state.accounts.map(function (account) {
        var cash = Number(account.cash) || 0;
        var note = cash < 0 ? "Negative cash, review margin" : "Cash non-negative";
        return "<tr>"
          + cell("Account", "<b>" + escapeHtml(account.account) + "</b>")
          + cell("Broker", escapeHtml(account.broker))
          + cell("Equity", money(Number(account.equity) || 0))
          + cell("Cash", "<span class=\"" + (cash < 0 ? "negative" : "positive") + "\">" + money(cash) + "</span>")
          + cell("Buying power", money(Number(account.buyPower) || 0))
          + cell("Risk note", escapeHtml(note))
          + "</tr>";
      }).join("");
    }
  }

  function renderAll() {
    state.sleeves = buildSleeves(state.accounts);
    state.recommendations = buildRecommendations(state.accounts, state.holdings);
    renderSession();
    renderDashboard();
    renderSleeves();
    renderTradeCenter();
    renderSage();
    renderRisk();
  }

  function stackItem(title, meta, body, progress) {
    var safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    return "<article class=\"stack-item\">"
      + "<div class=\"stack-item-head\"><b>" + escapeHtml(title) + "</b><span>" + escapeHtml(meta) + "</span></div>"
      + "<p>" + escapeHtml(body) + "</p>"
      + "<div class=\"progress-bar\" style=\"--value:" + safeProgress + "%\"><i></i></div>"
      + "</article>";
  }

  function emptyItem(title, body) {
    return stackItem(title, "Action needed", body, 15);
  }

  function cell(label, html) {
    return "<td data-label=\"" + escapeHtml(label) + "\">" + html + "</td>";
  }

  function previewRow(label, value) {
    return "<div class=\"preview-row\"><span>" + escapeHtml(label) + "</span><b>" + escapeHtml(value) + "</b></div>";
  }

  function gaugeCard(item) {
    return "<article class=\"gauge-card\">"
      + "<span>" + escapeHtml(item.label) + " basis capture</span>"
      + "<div class=\"gauge-value\" style=\"--needle:" + item.value + "%\"><b>" + item.value + "%</b></div>"
      + "<p>" + escapeHtml(item.description) + "</p>"
      + "</article>";
  }

  function valueOf(id) {
    var el = node(id);
    return el ? el.value : "";
  }

  function addActivity(event, operator, account, detail) {
    state.activity.unshift({
      event: event,
      operator: operator || "SYSTEM",
      account: account || "SmartSleeve",
      detail: detail || "",
      time: new Date().toLocaleString()
    });
  }

  function toast(message) {
    var el = node("toast");
    if (!el) {
      return;
    }
    el.textContent = message;
    el.classList.add("visible");
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(function () {
      el.classList.remove("visible");
    }, 3200);
  }

  function handleNav(section) {
    var target = section || "dashboard";
    qsa("[data-section]").forEach(function (panel) {
      panel.classList.toggle("active", panel.getAttribute("data-section") === target);
    });
    qsa("[data-nav]").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-nav") === target);
    });
    var titles = {
      dashboard: ["Dashboard", "What you own, why you own it, what changed, and what needs review."],
      sleeves: ["Sleeves", "Strategy buckets with target allocation, drift, risk, and actions."],
      trade: ["Trade Center", "Draft, review, approve, reject, and audit trade decisions."],
      sage: ["Sage", "Portfolio-specific recommendations and execution diagnostics."],
      risk: ["Risk", "Concentration, margin, broker, sleeve, and event risk."]
    };
    setText("page-title", (titles[target] || titles.dashboard)[0]);
    setText("page-subtitle", (titles[target] || titles.dashboard)[1]);
  }

  function wireEvents() {
    qsa("[data-nav]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var section = link.getAttribute("data-nav");
        history.replaceState(null, "", "#" + section);
        handleNav(section);
      });
    });
    qsa("[data-nav-button]").forEach(function (button) {
      button.addEventListener("click", function () {
        var section = button.getAttribute("data-nav-button");
        history.replaceState(null, "", "#" + section);
        handleNav(section);
      });
    });
    var sort = node("holdings-sort");
    if (sort) {
      sort.addEventListener("change", renderHoldingsTable);
    }
    var form = node("trade-form");
    if (form) {
      form.addEventListener("submit", createDraftOrder);
      qsa("input, select, textarea", form).forEach(function (input) {
        input.addEventListener("input", updateTradePreview);
        input.addEventListener("change", updateTradePreview);
      });
    }
    document.addEventListener("click", function (event) {
      var orderButton = event.target.closest("[data-order-action]");
      if (orderButton) {
        var order = state.orders.find(function (item) {
          return item.id === orderButton.getAttribute("data-order-id");
        });
        if (order) {
          var action = orderButton.getAttribute("data-order-action");
          order.status = action === "approve" ? "Approved for broker preview" : "Rejected by user";
          addActivity("Order " + (action === "approve" ? "approved" : "rejected"), order.operator, order.account, order.ticker + " " + order.action);
          renderOrders();
          renderActivity();
          toast(order.status + ".");
        }
      }
      var recButton = event.target.closest("[data-rec-draft]");
      if (recButton) {
        draftFromRecommendation(recButton.getAttribute("data-rec-draft"));
      }
      var recDismiss = event.target.closest("[data-rec-dismiss]");
      if (recDismiss) {
        var id = recDismiss.getAttribute("data-rec-dismiss");
        var rec = state.recommendations.find(function (item) { return item.id === id; });
        addActivity("Recommendation rejected", rec ? rec.operator : "SAGE_RECOMMEND", rec ? rec.account : "Sage", rec ? rec.title : id);
        state.recommendations = state.recommendations.filter(function (item) { return item.id !== id; });
        renderDashboard();
        renderSage();
        renderRisk();
        renderActivity();
        toast("Recommendation rejected.");
      }
    });
    document.addEventListener("change", function (event) {
      if (event.target && event.target.name === "sage-mode") {
        state.sageMode = event.target.value;
        setText("sage-mode-status", sageModes.find(function (mode) { return mode.id === state.sageMode; }).name);
        addActivity("Sage mode changed", "JPS_MANUAL", "SmartSleeve", "Mode set to " + state.sageMode);
        renderActivity();
      }
    });
    var killSwitch = node("kill-switch");
    if (killSwitch) {
      killSwitch.addEventListener("click", function () {
        state.sageMode = "observe";
        renderSage();
        addActivity("Automation kill switch", "JPS_MANUAL", "All accounts", "Sage set to Observe Only.");
        renderActivity();
        toast("Automation disabled. Sage is Observe Only.");
      });
    }
    var riskKill = node("risk-kill-switch");
    if (riskKill) {
      riskKill.addEventListener("click", function () {
        state.sageMode = "observe";
        renderSage();
        toast("Automation disabled. Sage is Observe Only.");
      });
    }
    var runReview = node("run-review");
    if (runReview) {
      runReview.addEventListener("click", function () {
        addActivity("Portfolio review run", "SAGE_RECOMMEND", "Cross-account", state.recommendations.length + " recommendations generated.");
        renderActivity();
        toast("Sage review refreshed from current snapshot.");
      });
    }
    var exportAudit = qs("[data-export-audit]");
    if (exportAudit) {
      exportAudit.addEventListener("click", function () {
        var payload = JSON.stringify(state.activity, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(payload).then(function () {
            toast("Audit log copied.");
          });
        } else {
          toast("Audit export ready in app memory.");
        }
      });
    }
    var rebalance = qs("[data-create-rebalance]");
    if (rebalance) {
      rebalance.addEventListener("click", function () {
        handleNav("trade");
        history.replaceState(null, "", "#trade");
        setFormValue("trade-action", "Rebalance");
        setFormValue("trade-operator", "SQTS_REBALANCE");
        setFormValue("trade-reason", "Review sleeve drift and rebalance only after server-side broker preview.");
        updateTradePreview();
      });
    }
  }

  function setFormValue(id, value) {
    var el = node(id);
    if (el) {
      el.value = value;
    }
  }

  function draftFromRecommendation(id) {
    var rec = state.recommendations.find(function (item) { return item.id === id; });
    if (!rec) {
      return;
    }
    handleNav("trade");
    history.replaceState(null, "", "#trade");
    setFormValue("trade-ticker", rec.ticker.split(",")[0].trim());
    setFormValue("trade-action", tradeActionForRecommendation(rec.action));
    setFormValue("trade-notional", rec.notional ? String(Math.max(0, rec.notional)) : "");
    setFormValue("trade-operator", rec.operator);
    setFormValue("trade-reason", rec.reason);
    updateTradePreview();
    toast("Recommendation loaded into the trade ticket.");
  }

  function tradeActionForRecommendation(action) {
    if (action === "Raise cash") {
      return "Sell";
    }
    if (action === "Assign" || action === "Broker sync") {
      return "Rebalance";
    }
    return action;
  }

  function loadSnapshots() {
    fetch("data/account-snapshots.json?ts=" + Date.now(), {cache: "no-store"})
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Snapshot request failed: " + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        state.payload = payload;
        state.accounts = visibleAccounts(payload.accounts || []);
        var aggregated = aggregateHoldings(state.accounts);
        state.holdings = aggregated.holdings;
        state.foreignHoldings = aggregated.foreign;
        setText("snapshot-source", payload.source || "Analytics snapshot");
        setText("snapshot-time", payload.generated_at ? "Generated " + payload.generated_at : "Generated time unavailable");
        setText("sync-pill", "Snapshot synced");
        addActivity("Account snapshot synced", "EXTERNAL_BROKER_SYNC", appEdition === "developer" ? "All accounts" : principalEmail, state.accounts.length + " account(s) visible.");
        renderAll();
        handleNav((window.location.hash || "#dashboard").replace("#", "") || "dashboard");
      })
      .catch(function (error) {
        setText("sync-pill", "Sync failed");
        setText("snapshot-time", "Snapshot unavailable");
        state.accounts = [];
        state.holdings = [];
        state.sleeves = [];
        state.recommendations = [{
          id: "snapshot-failed",
          title: "Reconnect portfolio snapshot",
          action: "Broker sync",
          account: "SmartSleeve",
          ticker: "Data",
          notional: 0,
          reason: error.message,
          risk: "No portfolio decisions should be made until current holdings are available.",
          operator: "EXTERNAL_BROKER_SYNC"
        }];
        renderAll();
        toast("Portfolio snapshot failed to load.");
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderSession();
    wireEvents();
    loadSnapshots();
  });
})();
