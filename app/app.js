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
  var AUTH_TOKEN_KEY = "smartsleeve_auth_token_v1";
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
      sleeve: "Sage by SmartSleeve",
      asset: "MU",
      quantity: "1.000000",
      value: "$1,151.80",
      behaviors: ["human-directed", "guardrail checked", "report included"],
      permission: "User mandate only"
    },
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
      sleeve: "Grand Sage",
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
      value: "$0.00",
      behaviors: ["not managed"],
      permission: "Never sell until imported"
    }
  ];
  var accountSnapshots = [
    {
      id: "john-rh",
      account: "John RH",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "Robinhood Agentic",
      status: "current analytics snapshot",
      generatedAt: "2026-06-19T15:25:36Z",
      equity: 101249.11,
      cash: 5330.45,
      buyPower: 52.17,
      sleeves: "Grand Sage, Honey Badger, Savage Sage, Value Sage",
      positions: [
        {symbol: "ALAB", shares: 10.631641, price: 419.9, value: 4464.23, currency: "USD"},
        {symbol: "MU", shares: 39.13518, price: 1151.8005, value: 45075.92, currency: "USD"},
        {symbol: "SMCI", shares: 0.000088, price: 30.72, value: 0, currency: "USD"},
        {symbol: "SNDK", shares: 20.78775, price: 2209.87, value: 45938.23, currency: "USD"},
        {symbol: "SOXL", shares: 1.566025, price: 281.15, value: 440.29, currency: "USD"}
      ]
    },
    {
      id: "john-ibkr-margin",
      account: "John IBKR Margin",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "IBKR Margin",
      status: "current analytics snapshot",
      generatedAt: "2026-06-19T15:26:00Z",
      equity: 30235.10,
      cash: -2981.64,
      buyPower: 3288.98,
      sleeves: "Grand Sage, Hyper Savage, Savage Sage",
      positions: [
        {symbol: "000660", name: "SK Hynix", shares: 2, price: 2764000, value: 5528000, currency: "KRW"},
        {symbol: "MU", shares: 25, price: 1133.99, value: 28349.75, currency: "USD"},
        {symbol: "SNDK", shares: 0.3832, price: 2184.75, value: 837.2, currency: "USD"}
      ]
    },
    {
      id: "john-ibkr-roth",
      account: "John IBKR Roth",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "IBKR Roth IRA",
      status: "current analytics snapshot",
      generatedAt: "2026-06-19T15:26:00Z",
      equity: 60365.71,
      cash: 0.88,
      buyPower: 0.88,
      sleeves: "Sage by SmartSleeve",
      positions: [
        {symbol: "ALAB", shares: 2, price: 417.07, value: 834.14, currency: "USD"},
        {symbol: "CRDO", shares: 0.2571, price: 271.83, value: 69.89, currency: "USD"},
        {symbol: "IONQ", shares: 25, price: 56.55, value: 1413.75, currency: "USD"},
        {symbol: "NBIS", shares: 150.9199, price: 286.69, value: 43267.23, currency: "USD"},
        {symbol: "QBTS", shares: 25, price: 24.69, value: 617.25, currency: "USD"},
        {symbol: "RGTI", shares: 15, price: 21.36, value: 320.4, currency: "USD"},
        {symbol: "SNDK", shares: 6.3602, price: 2184.75, value: 13895.45, currency: "USD"}
      ]
    },
    {
      id: "criselda",
      account: "Crissy RH",
      ownerEmail: "criseldasarenas@gmail.com",
      broker: "Robinhood Agentic",
      status: "current analytics snapshot",
      generatedAt: "2026-06-19T15:25:36Z",
      equity: 1013.76,
      cash: 499.69,
      buyPower: 499.69,
      sleeves: "Grand Sage, Savage Sage",
      positions: [
        {symbol: "ALAB", shares: 1.22426, price: 419.9, value: 514.07, currency: "USD"}
      ]
    }
  ];
  var crossAccountAccounts = [
    {
      account: "John RH",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "Robinhood Agentic",
      equity: "$101,249.11",
      cash: "$5,330.45",
      buyPower: "$52.17",
      holdings: "$95,918.67",
      sleeves: "Grand Sage, Honey Badger, Savage Sage, Value Sage",
      status: "current analytics snapshot"
    },
    {
      account: "John IBKR Margin",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "IBKR Margin",
      equity: "$30,235.10",
      cash: "$-2,981.64",
      buyPower: "$3,288.98",
      holdings: "$29,186.95 plus SK Hynix KRW position",
      sleeves: "Grand Sage, Hyper Savage, Savage Sage",
      status: "current analytics snapshot"
    },
    {
      account: "John IBKR Roth",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "IBKR Roth IRA",
      equity: "$60,365.71",
      cash: "$0.88",
      buyPower: "$0.88",
      holdings: "$60,418.11",
      sleeves: "Sage by SmartSleeve",
      status: "current analytics snapshot"
    },
    {
      account: "John E*TRADE",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "E*TRADE Margin",
      equity: "$1,000.00",
      cash: "$1,000.00",
      buyPower: "$0.00",
      holdings: "$0.00",
      sleeves: "Sage by SmartSleeve, Edge Sage",
      status: "live-capable; funds/settlement pending"
    },
    {
      account: "John Fidelity",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "Fidelity via Plaid",
      equity: "$25,805.52",
      cash: "view-only",
      buyPower: "not tradable",
      holdings: "$25,805.52",
      sleeves: "External / diagnostic only",
      status: "view-only; production Plaid access pending"
    },
    {
      account: "John Schwab PCRA",
      ownerEmail: "jpsheppard88@gmail.com",
      broker: "Charles Schwab",
      equity: "pending",
      cash: "pending",
      buyPower: "pending",
      holdings: "pending",
      sleeves: "External / future connector",
      status: "pending official API onboarding"
    },
    {
      account: "Crissy RH",
      ownerEmail: "criseldasarenas@gmail.com",
      broker: "Robinhood Agentic",
      equity: "$1,013.76",
      cash: "$499.69",
      buyPower: "$499.69",
      holdings: "$514.07",
      sleeves: "Grand Sage, Savage Sage",
      status: "current analytics snapshot"
    }
  ];
  var crossAccountHoldings = [
    {symbol: "MU", shares: "54.270000", avgPrice: "$1,353.15", value: "$73,425.67", allocation: "54.76%", accounts: "3"},
    {symbol: "SNDK", shares: "27.455500", avgPrice: "$2,209.87", value: "$60,670.88", allocation: "45.24%", accounts: "3"},
    {symbol: "NBIS", shares: "2.000000", avgPrice: "$55.00", value: "$110.00", allocation: "0.08%", accounts: "1"}
  ];
  var crossAccountSleeveHoldings = [
    {sleeve: "Sage by SmartSleeve", account: "John RH", symbol: "SNDK", shares: "15.318354", value: "$33,851.57"},
    {sleeve: "Sage by SmartSleeve", account: "John IBKR Roth", symbol: "MU", shares: "1.825000", value: "$2,472.32"},
    {sleeve: "Semi Sage", account: "John RH", symbol: "MU", shares: "4.000000", value: "$768.00"},
    {sleeve: "Grand Sage", account: "John RH", symbol: "MU", shares: "39.135180", value: "$7,503.94"},
    {sleeve: "Semi Sage", account: "John IBKR Margin", symbol: "MU", shares: "5.000000", value: "$6,765.75"},
    {sleeve: "Savage Sage", account: "John IBKR Margin", symbol: "SNDK", shares: "1.000000", value: "$2,209.87"},
    {sleeve: "Sage by SmartSleeve", account: "John E*TRADE", symbol: "Cash", shares: "$1,000.00", value: "$1,000.00"},
    {sleeve: "Edge Sage", account: "John E*TRADE", symbol: "Options buying power", shares: "$500.00 limit", value: "$500.00"},
    {sleeve: "Grand Sage", account: "Crissy RH", symbol: "ALAB", shares: "1.224260", value: "$514.07"}
  ];
  var hebDiagnostics = [
    {
      category: "Entry",
      capture: 92,
      mandates: "12 evaluated",
      definition: "Hindsight Efficient Basis: actual buy basis compared with the lowest reachable buy basis inside the mandate window.",
      counterfactual: "$184 estimated avoidable entry slippage captured by autoGuard"
    },
    {
      category: "Exit",
      capture: 94,
      mandates: "8 evaluated",
      definition: "Actual sell basis compared with the highest reachable sale basis inside the mandate window.",
      counterfactual: "$96 estimated drawdown avoided versus immediate/manual exit"
    },
    {
      category: "Reallocation",
      capture: 86,
      mandates: "4 evaluated",
      definition: "Actual source-sell / target-buy ratio compared with the best sequential HEB ratio.",
      counterfactual: "$312 estimated opportunity recovered versus a one-shot reallocation"
    }
  ];
  var investorDecisionMetrics = [
    {
      category: "Entry choice",
      returnPct: 4.25,
      window: "18.0h avg",
      feedback: "User-selected entries gained over their chosen windows; review whether shorter windows would have reduced basis risk."
    },
    {
      category: "Exit choice",
      returnPct: 1.1,
      window: "6.5h avg",
      feedback: "Exits modestly avoided drawdown after execution; opportunity cost remained low in the evaluated windows."
    },
    {
      category: "Reallocation choice",
      returnPct: 6.8,
      window: "42.0h avg",
      feedback: "Target assets outperformed source assets after reallocation; keep scoring this separately from single-leg entries and exits."
    },
    {
      category: "Timescale choice",
      returnPct: 2.4,
      window: "31.0h avg",
      feedback: "Chosen mandate windows gave Sage useful room to work; compare future windows against basis capture and missed-opportunity estimates."
    }
  ];
  var autoGuardCounterfactuals = [
    {
      category: "Potential saved",
      value: "$184",
      window: "Entry mandates",
      feedback: "Estimated slippage avoided when Sage waited inside the approved window instead of crossing immediately."
    },
    {
      category: "Potential made",
      value: "$312",
      window: "Reallocation mandates",
      feedback: "Estimated improvement from selling the source leg and buying the target leg closer to the observed efficient relationship."
    },
    {
      category: "Manual friction cost",
      value: "$96",
      window: "Exit mandates",
      feedback: "Estimated adverse move that autoGuard could have reduced with pre-authorized execution guardrails."
    }
  ];
  var brokerConnections = [
    {
      connector: "Robinhood Agentic",
      status: "Live-capable",
      capabilities: "Limit/fractional stock intents, Sage-directed order metadata, reconcile/cancel diagnostics",
      constraints: "Broker may reject overly marketable or unsupported order shapes"
    },
    {
      connector: "IBKR Gateway",
      status: "Live-capable",
      capabilities: "Gateway daemon, managed accounts, margin/Roth profiles, cross-account diagnostics",
      constraints: "Requires Gateway listener, account visibility, and stale-connection pause mode"
    },
    {
      connector: "E*TRADE",
      status: "Live-capable; settlement-aware",
      capabilities: "Preview, place, reconcile, margin limit mode, Edge Sage options Level 1-3",
      constraints: "Funds and order/session rules must be checked before each order"
    },
    {
      connector: "Fidelity via Plaid",
      status: "View-only target",
      capabilities: "Balances and positions for diagnostics when production Plaid access is approved",
      constraints: "No trading through Plaid; sandbox does not expose John's real account details"
    },
    {
      connector: "Schwab PCRA",
      status: "Pending",
      capabilities: "Planned official Schwab API account view/trading path",
      constraints: "Requires Schwab developer approval, OAuth app, account entitlement review"
    }
  ];
  var reportingRows = [
    {
      surface: "Daily performance email",
      audience: "Developer fallback + active Sage by SmartSleeve users",
      includes: "Composite, sleeve charts, Active Sage by SmartSleeve accounts, return indexes",
      fallback: "Image-free email when hosted chart assets are unavailable"
    },
    {
      surface: "Sage by SmartSleeve account section",
      audience: "Users with sage_mode=active, sage_limit_usd > 0, or explicit subscription",
      includes: "Broker equity, Sage by SmartSleeve value, cash, positions, return index",
      fallback: "Waiting-for-analytics row instead of hiding the account"
    },
    {
      surface: "Options Sage reporting",
      audience: "Covered Sage and Convex Sage users when enabled",
      includes: "Payoff-shaped logos, sleeve values, return indexes, options-gated status",
      fallback: "Show inactive/off status until explicit options permissions exist"
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
      schedule: "Before market open, daily cloud loop, and options-family shock checks",
      artifact: "analytics_exports/daily_bayesian_tuning.json",
      behavior: "Reject unsafe or stale updates"
    },
    {
      workflow: "Active Sage report scan",
      schedule: "Every daily report run plus account analytics refresh",
      artifact: "config/smartsleeve_accounts.json",
      behavior: "Include developer fallback and active Sage by SmartSleeve users"
    },
    {
      workflow: "HEB and basis-capture evaluation",
      schedule: "After each Sage mandate window closes",
      artifact: "analytics_exports/sage_autoguard_heb_tuning.json",
      behavior: "Separate Sage execution scoring from investor decision scoring"
    },
    {
      workflow: "E*TRADE daemon health",
      schedule: "Every live cycle plus preview/place/reconcile smoke runs",
      artifact: "analytics_exports/edge_sage_bayesian_tuning.json",
      behavior: "Respect settlement, session, fractional, margin, and options-level constraints"
    },
    {
      workflow: "Execution stress matrix",
      schedule: "On demand and pre-launch",
      artifact: "analytics_exports/execution_stress_matrix.json",
      behavior: "Fail closed on sleeve-limit violations"
    }
  ];
  var diagnosticsRows = [
    {
      diagnostic: "IBKR Gateway API",
      signal: "4001/4002 listener plus ib_insync managedAccounts()",
      action: "Pause new orders; keep daemons alive in retry mode",
      evidence: "Email alert, daemon_error, health snapshot"
    },
    {
      diagnostic: "Open-order reconciliation",
      signal: "Broker open orders matched to SmartSleeve order_id/order_ref",
      action: "Cancel only SmartSleeve-owned stale orders; preserve external orders",
      evidence: "open_orders_canceled or external_open_orders_preserved event"
    },
    {
      diagnostic: "Unknown order status",
      signal: "Timeout or disconnect after order review/submission",
      action: "Halt further submissions until broker state is reconciled",
      evidence: "order_error with unknown_after_successful_review_timeout"
    },
    {
      diagnostic: "Operator alerting",
      signal: "Daemon/Gateway/order health events",
      action: "Send email alert and require phone-visible notification",
      evidence: "alert delivery log and latest diagnostics export"
    },
    {
      diagnostic: "E*TRADE preview/place/reconcile",
      signal: "Preview accepted, order placement response, then broker order-state poll",
      action: "Keep daemon live-eligible but stop new order attempts if buying power or preview fails",
      evidence: "etrade_preview, etrade_place, etrade_reconcile events"
    },
    {
      diagnostic: "Plaid/Fidelity read-only sync",
      signal: "Plaid item status, access token health, positions/balances refresh",
      action: "Show stale/read-only badge; never route trade intents through Plaid",
      evidence: "plaid_sync_status and last successful account snapshot"
    },
    {
      diagnostic: "Schwab PCRA onboarding",
      signal: "OAuth app approval, account entitlement, token refresh, account list",
      action: "Keep connector pending until official API visibility is confirmed",
      evidence: "schwab_onboarding_state"
    }
  ];
  var tabletExecutionQueue = [
    {
      title: "Sage by SmartSleeve - MU build",
      broker: "John E*TRADE",
      window: "Due Wed 2026-06-24 15:59 ET",
      state: "Waiting for settled cash; margin envelope available"
    },
    {
      title: "SNDK to MU reallocation",
      broker: "John RH",
      window: "autoGuard window closed",
      state: "HEB scoring queued after final broker reconcile"
    },
    {
      title: "Edge Sage lateral",
      broker: "John E*TRADE",
      window: "After MU acquisition",
      state: "Options L1-3 and $500 margin limit gated"
    },
    {
      title: "Fidelity diagnostic import",
      broker: "Fidelity via Plaid",
      window: "Production access pending",
      state: "Read-only balances and positions only"
    }
  ];
  var tabletBrokerMatrix = [
    {name: "Robinhood Agentic", status: "Live", detail: "Fractional stock intents; strict syntax adapter"},
    {name: "IBKR Gateway", status: "Live", detail: "Gateway heartbeat, managed accounts, margin/Roth profiles"},
    {name: "E*TRADE", status: "Live-ready", detail: "Preview/place/reconcile, settlement-aware cash, options levels"},
    {name: "Plaid/Fidelity", status: "View-only", detail: "Balances and holdings when production access is approved"},
    {name: "Schwab PCRA", status: "Pending", detail: "Official OAuth/API onboarding and entitlement review"},
    {name: "Desktop command", status: "Packaged", detail: "Windows, macOS, Linux targets share one console"}
  ];
  var tabletCycleOptimizer = [
    {name: "John IBKR server", status: "Adaptive", detail: "Faster cycle target when CPU, memory, and broker pacing allow"},
    {name: "RH daemons", status: "Conservative", detail: "Lower-capacity servers and platform constraints reduce cycle speed"},
    {name: "Market events", status: "Ramp-up", detail: "Micron, SanDisk, SK Hynix earnings trigger higher research cadence"},
    {name: "Bayesian updates", status: "Cloud", detail: "Post-window HEB review tunes entry, exit, and reallocation pacing"}
  ];
  var tabletRiskEnvelope = [
    {name: "Sage margin mode", status: "Enabled when granted", detail: "Margin use requires explicit per-sleeve limit"},
    {name: "Edge Sage", status: "$500 cap", detail: "Less of $500 or approved account margin threshold"},
    {name: "Fractionals", status: "Broker-bound", detail: "Order shape adapts by session and platform capability"},
    {name: "Emergency mode", status: "Fail closed", detail: "Unknown status stops new risk until broker reconcile completes"}
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
    android_tablet: [
      ".venv/bin/python scripts/smartsleeve_app_workflow.py doctor",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py serve-web",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py android-devices",
      "adb reverse tcp:8765 tcp:8765",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py android-install --apk mobile/android/app/build/outputs/apk/debug/app-debug.apk",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py android-launch"
    ].join("\n"),
    ios_tablet: [
      "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
      ".venv/bin/python scripts/smartsleeve_app_workflow.py serve-web",
      "open mobile/ios/SmartSleeve.xcodeproj",
      "Set SMARTSLEEVE_CONSOLE_URL=http://127.0.0.1:8765/app/ in the SmartSleeve scheme.",
      "Select an iPad simulator or connected iPad, choose a signing team, then Run.",
      "Archive and upload to TestFlight when ready for cleaner iPad distribution."
    ].join("\n"),
    desktop: [
      "cd desktop/smartsleeve-command",
      "npm install",
      "npm run dev",
      "SMARTSLEEVE_COMMAND_URL=http://127.0.0.1:8765/app/ npm run dev"
    ].join("\n"),
    linux: [
      "cd desktop/smartsleeve-command",
      "npm install",
      "npm run package:linux",
      "Outputs target AppImage, deb, rpm, and tar.gz for common Linux distributions."
    ].join("\n")
  };
  var appliedDiscountCode = "";

  function byId(id) {
    return document.getElementById(id);
  }

  function appContext() {
    var params = new URLSearchParams(window.location.search || "");
    return {
      edition: params.get("app_edition") || "web",
      accountScope: params.get("account_scope") || "all",
      principalEmail: String(params.get("principal_email") || "").trim().toLowerCase()
    };
  }

  function scopedAccounts() {
    var context = appContext();
    if (context.accountScope !== "user" || !context.principalEmail) {
      return crossAccountAccounts;
    }
    return crossAccountAccounts.filter(function (row) {
      return String(row.ownerEmail || "").toLowerCase() === context.principalEmail;
    });
  }

  function scopedAccountSnapshots() {
    var context = appContext();
    if (context.accountScope !== "user" || !context.principalEmail) {
      return accountSnapshots;
    }
    return accountSnapshots.filter(function (row) {
      return String(row.ownerEmail || "").toLowerCase() === context.principalEmail;
    });
  }

  function snapshotAccountRows() {
    var rowsByAccount = {};
    crossAccountAccounts.forEach(function (row) {
      rowsByAccount[row.account] = row;
    });
    scopedAccountSnapshots().forEach(function (snapshot) {
      rowsByAccount[snapshot.account] = {
        account: snapshot.account,
        ownerEmail: snapshot.ownerEmail,
        broker: snapshot.broker,
        equity: formatCurrency(snapshot.equity),
        cash: formatCurrency(snapshot.cash),
        buyPower: formatCurrency(snapshot.buyPower),
        holdings: formatCurrency(snapshot.positions.reduce(function (total, position) {
          return position.currency === "USD" ? total + Number(position.value || 0) : total;
        }, 0)),
        sleeves: snapshot.sleeves,
        status: snapshot.status
      };
    });
    return Object.keys(rowsByAccount).map(function (key) {
      return rowsByAccount[key];
    }).filter(function (row) {
      var context = appContext();
      return context.accountScope !== "user"
        || !context.principalEmail
        || String(row.ownerEmail || "").toLowerCase() === context.principalEmail;
    });
  }

  function scopedSleeveHoldings() {
    var allowedAccounts = scopedAccounts().map(function (row) {
      return row.account;
    });
    if (!allowedAccounts.length) {
      return [];
    }
    return crossAccountSleeveHoldings.filter(function (row) {
      return allowedAccounts.indexOf(row.account) !== -1;
    });
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

  function parseCurrency(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    var cleaned = String(value || "").replace(/[^0-9.-]/g, "");
    if (!cleaned) {
      return null;
    }
    var parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatCurrency(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return "Sync pending";
    }
    return parsed.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function accountEquityTotal(rows) {
    return rows.reduce(function (total, row) {
      var equity = parseCurrency(row.equity);
      return equity === null ? total : total + equity;
    }, 0);
  }

  function formatShares(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return String(value || "");
    }
    if (Math.abs(parsed) >= 100) {
      return parsed.toFixed(4).replace(/\.?0+$/, "");
    }
    return parsed.toFixed(6).replace(/\.?0+$/, "");
  }

  function formatPositionMoney(value, currency) {
    if (currency === "KRW") {
      return Number(value || 0).toLocaleString("ko-KR", {
        style: "currency",
        currency: "KRW",
        maximumFractionDigits: 0
      });
    }
    return formatCurrency(value);
  }

  function aggregateSnapshotHoldings(snapshots) {
    var grouped = {};
    snapshots.forEach(function (snapshot) {
      snapshot.positions.forEach(function (position) {
        var currency = position.currency || "USD";
        var key = position.symbol + "::" + currency;
        if (!grouped[key]) {
          grouped[key] = {
            symbol: position.symbol,
            currency: currency,
            shares: 0,
            value: 0,
            accounts: []
          };
        }
        grouped[key].shares += Number(position.shares || 0);
        grouped[key].value += Number(position.value || 0);
        if (grouped[key].accounts.indexOf(snapshot.account) === -1) {
          grouped[key].accounts.push(snapshot.account);
        }
      });
    });
    var usdTotal = Object.keys(grouped).reduce(function (total, key) {
      return grouped[key].currency === "USD" ? total + grouped[key].value : total;
    }, 0);
    return Object.keys(grouped).map(function (key) {
      var row = grouped[key];
      var avgPrice = row.shares ? row.value / row.shares : 0;
      return {
        symbol: row.symbol,
        currency: row.currency,
        sortValue: row.currency === "USD" ? row.value : 0,
        shares: formatShares(row.shares),
        avgPrice: formatPositionMoney(avgPrice, row.currency),
        value: formatPositionMoney(row.value, row.currency),
        allocation: row.currency === "USD" && usdTotal > 0
          ? ((row.value / usdTotal) * 100).toFixed(2) + "%"
          : row.currency + " position",
        accounts: String(row.accounts.length)
      };
    }).sort(function (a, b) {
      if (a.currency !== b.currency) {
        return a.currency === "USD" ? -1 : 1;
      }
      return b.sortValue - a.sortValue;
    });
  }

  function renderPortfolioScopeSummary(accountRows) {
    var labelNode = byId("composite-equity-label");
    var totalNode = byId("composite-equity-total");
    var noteNode = byId("composite-equity-note");
    var summaryNode = byId("portfolio-scope-summary");
    var sourceNode = byId("portfolio-data-source");
    var context = appContext();
    var numericTotal = accountEquityTotal(accountRows);
    var hasNumericEquity = accountRows.some(function (row) {
      return parseCurrency(row.equity) !== null;
    });
    if (totalNode) {
      totalNode.textContent = hasNumericEquity ? formatCurrency(numericTotal) : "Sync pending";
    }
    if (labelNode) {
      labelNode.textContent = context.accountScope === "user"
        ? "Your tracked account value"
        : "Tracked account value (all accounts)";
    }
    if (noteNode) {
      noteNode.textContent = context.accountScope === "user"
        ? "Sum of broker equity visible to this verified user session."
        : "Developer view: sum of all numeric broker-equity rows, including view-only accounts, excluding pending connectors.";
    }
    if (summaryNode) {
      if (context.accountScope === "user" && context.principalEmail) {
        summaryNode.textContent = hasNumericEquity
          ? "Showing account value and sleeve provenance for " + context.principalEmail + "."
          : "Account shell is visible for " + context.principalEmail + ", but broker value sync is still pending.";
      } else {
        summaryNode.textContent = "Developer all-account view: total is the sum of numeric Equity values in the Accounts table; Schwab pending and other non-numeric connector rows are excluded until synced.";
      }
    }
    if (sourceNode) {
      sourceNode.textContent = hasNumericEquity ? "Analytics snapshot" : "Connector missing";
      sourceNode.classList.toggle("ok", hasNumericEquity);
      sourceNode.classList.toggle("warn", !hasNumericEquity);
    }
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
    var base = authBaseUrl();
    return base ? base + "/register" : "";
  }

  function authBaseUrl() {
    var endpoint = configuredMetaContent("smartsleeve-auth-endpoint");
    if (!endpoint) {
      return "";
    }
    return endpoint.replace(/\/$/, "").replace(/\/(register|login|me|logout)$/, "");
  }

  function authUrl(path) {
    var base = authBaseUrl();
    return base ? base + path : "";
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

  function setLoginStatus(message, kind) {
    var status = byId("login-status");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.classList.remove("ok", "error");
    if (kind) {
      status.classList.add(kind);
    }
  }

  function displaySession(profile) {
    var signedIn = Boolean(profile && profile.email);
    var sessionTitle = byId("session-title");
    var sessionDetail = byId("session-detail");
    var accountName = byId("account-name");
    var accountEmail = byId("account-email");
    var accountRole = byId("account-role");
    var logoutButton = byId("logout-button");

    if (sessionTitle) {
      sessionTitle.textContent = signedIn ? "Signed in" : "Signed out";
    }
    if (sessionDetail) {
      sessionDetail.textContent = signedIn
        ? (profile.role === "developer" ? "Developer account active." : "Verified user account active.")
        : "Create or sign in to a verified SmartSleeve account.";
    }
    if (accountName) {
      accountName.textContent = signedIn
        ? (profile.nickname || profile.first_name || profile.username || "SmartSleeve user")
        : "No verified session";
    }
    if (accountEmail) {
      accountEmail.textContent = signedIn ? profile.email : "Use the sign-in form after verifying your email.";
    }
    if (accountRole) {
      accountRole.textContent = signedIn ? profile.role : "signed out";
    }
    if (logoutButton) {
      logoutButton.hidden = !signedIn;
    }
  }

  function parseAuthError(body, fallback) {
    if (!body) {
      return fallback;
    }
    if (body.errors && body.errors.length) {
      return body.errors.join(", ");
    }
    return body.error || fallback;
  }

  function storedAuthToken() {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY) || "";
    } catch (_err) {
      return "";
    }
  }

  function storeAuthToken(token) {
    try {
      if (token) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    } catch (_err) {}
  }

  function authFetch(path, options) {
    var url = authUrl(path);
    if (!url || !window.fetch) {
      return Promise.reject(new Error("auth_backend_not_configured"));
    }
    var requestOptions = Object.assign({
      mode: "cors",
      credentials: "include",
      headers: {"Content-Type": "application/json"}
    }, options || {});
    var token = storedAuthToken();
    if (token) {
      requestOptions.headers = Object.assign({}, requestOptions.headers || {}, {
        Authorization: "Bearer " + token
      });
    }
    return fetch(url, requestOptions).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body.ok) {
          throw new Error(parseAuthError(body, "request_failed"));
        }
        return body;
      });
    });
  }

  function loadCurrentSession() {
    if (!authUrl("/me") || !window.fetch) {
      displaySession(null);
      return;
    }
    authFetch("/me", {method: "GET", headers: {}})
      .then(function (body) {
        displaySession(body.profile);
      })
      .catch(function () {
        displaySession(null);
      });
  }

  function wireLoginForm() {
    var form = byId("login-form");
    var logoutButton = byId("logout-button");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(form);
        var payload = {
          identity: String(data.get("identity") || "").trim(),
          password: String(data.get("password") || "")
        };
        if (!payload.identity || !payload.password) {
          setLoginStatus("Enter your email or username and password.", "error");
          return;
        }
        var submit = form.querySelector('button[type="submit"]');
        if (submit) {
          submit.disabled = true;
        }
        setLoginStatus("Signing in...", "");
        authFetch("/login", {method: "POST", body: JSON.stringify(payload)})
          .then(function (body) {
            storeAuthToken(body.session_token || "");
            form.reset();
            displaySession(body.profile);
            setLoginStatus("Signed in.", "ok");
          })
          .catch(function (err) {
            displaySession(null);
            setLoginStatus("Sign-in failed: " + err.message + ".", "error");
          })
          .finally(function () {
            if (submit) {
              submit.disabled = false;
            }
          });
      });
    }
    if (logoutButton) {
      logoutButton.addEventListener("click", function () {
        authFetch("/logout", {method: "POST", body: "{}"})
          .then(function () {
            storeAuthToken("");
            displaySession(null);
            setLoginStatus("Signed out.", "ok");
          })
          .catch(function (err) {
            setLoginStatus("Sign-out failed: " + err.message + ".", "error");
          });
      });
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
        credentials: "include",
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

  function sageMandatePreview() {
    var preview = byId("sage-mandate-preview");
    if (!preview) {
      return;
    }
    var payload = {
      product: "Sage by SmartSleeve",
      mode: byId("sage-intent") ? byId("sage-intent").value : "open",
      algo_model_id: byId("sage-model") ? byId("sage-model").value : "sage",
      broker_account_id: byId("sage-broker") ? byId("sage-broker").value : "john_etrade",
      agent_instance_id: byId("sage-instance") ? byId("sage-instance").value : "mu_sage1",
      user_directed: true,
      symbols: byId("sage-symbols") ? byId("sage-symbols").value : "MU",
      target: byId("sage-target") ? byId("sage-target").value : "$10000",
      deadline: byId("sage-deadline") ? byId("sage-deadline").value : "",
      urgency: byId("sage-urgency") ? byId("sage-urgency").value : "balanced",
      guardrail: byId("sage-guardrail") ? byId("sage-guardrail").value : "",
      margin: {
        enabled: Number(numberOrNull("sage-margin-limit") || 0) > 0,
        limit_usd: Number(numberOrNull("sage-margin-limit") || 0)
      },
      execution_policy: {
        recommendation_boundary: "user chooses security/size/deadline; Sage optimizes implementation only",
        gateway_failure_mode: "pause_new_risk_reconcile_before_resume",
        basis_capture_eval: "score HEB after mandate window closes",
        identity_tags: ["operator_id", "ats_id", "algo_model_id", "agent_instance_id", "order_ref", "version"]
      },
      status: "draft_only_requires_user_approval_and_secure_backend_commit"
    };
    preview.textContent = JSON.stringify(payload, null, 2);
  }

  function wireSageMandateControls() {
    all("#sage input, #sage select, #sage textarea").forEach(function (input) {
      input.addEventListener("input", sageMandatePreview);
      input.addEventListener("change", sageMandatePreview);
    });
    sageMandatePreview();
  }

  function dollars(value) {
    return "$" + Number(value || 0).toFixed(2);
  }

  function rebalancePreview() {
    var preview = byId("rebalance-preview");
    if (!preview) {
      return;
    }
    var sourceSymbol = ((byId("rebalance-source-symbol") && byId("rebalance-source-symbol").value) || "SNDK").toUpperCase();
    var targetSymbol = ((byId("rebalance-target-symbol") && byId("rebalance-target-symbol").value) || "MU").toUpperCase();
    var sourceValue = numberOrNull("rebalance-source-value") || 0;
    var targetValue = numberOrNull("rebalance-target-value") || 0;
    var targetPct = (numberOrNull("rebalance-target-pct") || 80) / 100;
    var sourcePrice = numberOrNull("rebalance-source-price") || 0;
    var sourceShares = numberOrNull("rebalance-source-shares");
    var deadline = (byId("rebalance-deadline") && byId("rebalance-deadline").value) || "2026-06-24T15:59:00-04:00";
    var total = sourceValue + targetValue;
    var targetGoal = total * targetPct;
    var sourceGoal = total - targetGoal;
    var shiftUsd = targetGoal - targetValue;
    var sharesToAbsorb = sourcePrice > 0 ? shiftUsd / sourcePrice : 0;
    var reason = "Sage by SmartSleeve cross-account rebalance: shift " + dollars(shiftUsd) +
      " from " + sourceSymbol + " to " + targetSymbol + " by " + deadline + ".";
    var directive = [{
      action: "reallocate",
      source_symbol: sourceSymbol,
      target_symbol: targetSymbol,
      max_source_pct: 1.0,
      max_source_usd: Number(shiftUsd.toFixed(2)),
      deadline_at: deadline,
      reason: reason
    }];
    var payload = {
      current: {
        source_value: dollars(sourceValue),
        target_value: dollars(targetValue),
        combined_value: dollars(total)
      },
      target: {
        target_symbol_value: dollars(targetGoal),
        source_symbol_value: dollars(sourceGoal),
        target_symbol_percent: (targetPct * 100).toFixed(2) + "%"
      },
      shift: {
        source_to_target_usd: dollars(Math.max(0, shiftUsd)),
        source_account_shares_to_absorb: Math.max(0, sharesToAbsorb).toFixed(6),
        source_account_shares_available: sourceShares === null ? null : sourceShares.toFixed(6),
        enough_source_account_shares: sourceShares === null ? null : sharesToAbsorb <= sourceShares
      },
      absorb_command: "smartsleeve absorb --account john-rh --sleeve sage --symbol " + sourceSymbol +
        " --shares " + Math.max(0, sharesToAbsorb).toFixed(6) + " --clinginess 0 --reason " + JSON.stringify(reason),
      SAGE_DIRECTIVES_JSON: JSON.stringify(directive)
    };
    if (shiftUsd <= 0) {
      payload.status = targetSymbol + " is already at or above the requested target.";
    } else if (sourcePrice <= 0) {
      payload.status = "Enter a positive source-account price.";
    } else {
      payload.status = "draft_only_requires_secure_backend_commit";
    }
    preview.textContent = JSON.stringify(payload, null, 2);
  }

  function wireRebalanceControls() {
    all("#transfers input, #transfers select, #transfers textarea").forEach(function (input) {
      input.addEventListener("input", rebalancePreview);
      input.addEventListener("change", rebalancePreview);
    });
    rebalancePreview();
  }

  function cadenceNumber(id, fallback) {
    var input = byId(id);
    if (!input || input.value === "") {
      return fallback;
    }
    var value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function cadencePreview() {
    var preview = byId("cadence-preview");
    if (!preview) {
      return;
    }
    var payload = {
      daily_performance_report: {
        schedule_utc: byId("cadence-daily-report") ? byId("cadence-daily-report").value : "01:15",
        recipient_family: "daily_performance",
        required_display_name: "Sage by SmartSleeve",
        recipient_rule: "developer fallback plus active Sage by SmartSleeve accounts",
        active_sage_detection: ["sage_mode=active", "sage_limit_usd>0", "performance_report_families includes sage or daily_performance"]
      },
      intervals: {
        daemon_heartbeat_seconds: cadenceNumber("cadence-daemon-heartbeat", 60),
        portfolio_snapshot_minutes: cadenceNumber("cadence-portfolio-snapshot", 15),
        research_refresh_minutes: cadenceNumber("cadence-research-refresh", 60),
        active_sage_scan_minutes: cadenceNumber("cadence-sage-scan", 15),
        gateway_stale_seconds: cadenceNumber("cadence-gateway-stale", 120)
      },
      image_assets: {
        sage_logo: "site/app/sage-logo.png",
        email_report_logo: "reports/sqts_daily_assets/static/sage-logo.png",
        logo_size_contract: "same rendered 192px sleeve-card logo size as other report sleeves"
      },
      status: "draft_only_requires_secure_backend_commit"
    };
    preview.textContent = JSON.stringify(payload, null, 2);
  }

  function wireCadenceControls() {
    all("#reporting input, #reporting select, #reporting textarea").forEach(function (input) {
      input.addEventListener("input", cadencePreview);
      input.addEventListener("change", cadencePreview);
    });
    cadencePreview();
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

  function renderCrossAccountPortfolio() {
    var holdings = byId("cross-account-holdings");
    var accounts = byId("cross-account-accounts");
    var sleeves = byId("cross-account-sleeves");
    if (holdings) {
      var holdingRows = aggregateSnapshotHoldings(scopedAccountSnapshots());
      if (!holdingRows.length) {
        holdingRows = crossAccountHoldings;
      }
      holdings.innerHTML = holdingRows.map(function (row) {
        return "<tr>"
          + "<td><b>" + escapeHtml(row.symbol) + "</b></td>"
          + "<td>" + escapeHtml(row.shares) + "</td>"
          + "<td>" + escapeHtml(row.avgPrice) + "</td>"
          + "<td>" + escapeHtml(row.value) + "</td>"
          + "<td>" + escapeHtml(row.allocation) + "</td>"
          + "<td>" + escapeHtml(row.accounts) + "</td>"
          + "</tr>";
      }).join("");
    }
    if (accounts) {
      var accountRows = snapshotAccountRows();
      renderPortfolioScopeSummary(accountRows);
      accounts.innerHTML = accountRows.map(function (row) {
        return "<tr>"
          + "<td><b>" + escapeHtml(row.account) + "</b><br><span class=\"muted-inline\">" + escapeHtml(row.status) + "</span></td>"
          + "<td>" + escapeHtml(row.broker) + "</td>"
          + "<td>" + escapeHtml(row.equity) + "</td>"
          + "<td>" + escapeHtml(row.cash) + "</td>"
          + "<td>" + escapeHtml(row.buyPower) + "</td>"
          + "<td>" + escapeHtml(row.sleeves) + "</td>"
          + "</tr>";
      }).join("") || '<tr><td colspan="6">No account rows are visible for this verified app session.</td></tr>';
    }
    if (sleeves) {
      var sleeveRows = scopedSleeveHoldings();
      sleeves.innerHTML = sleeveRows.map(function (row) {
        return "<tr>"
          + "<td>" + escapeHtml(row.sleeve) + "</td>"
          + "<td>" + escapeHtml(row.account) + "</td>"
          + "<td><b>" + escapeHtml(row.symbol) + "</b></td>"
          + "<td>" + escapeHtml(row.shares) + "</td>"
          + "<td>" + escapeHtml(row.value) + "</td>"
          + "</tr>";
      }).join("") || '<tr><td colspan="5">No sleeve rows are visible for this verified app session.</td></tr>';
    }
  }

  function basisGauge(row) {
    var capture = Math.max(0, Math.min(100, Number(row.capture) || 0));
    return '<article class="basis-gauge">'
      + '<div><span>' + escapeHtml(row.category) + ' basis capture</span><b>' + capture.toFixed(2) + "%</b></div>"
      + '<div class="fuel-track" aria-label="' + escapeHtml(row.category) + ' basis capture gauge">'
      + '<span style="left:' + capture.toFixed(2) + '%"></span>'
      + "</div>"
      + "<p>" + escapeHtml(row.definition) + "</p>"
      + '<em>' + escapeHtml(row.mandates) + '</em>'
      + "</article>";
  }

  function renderHebDiagnostics() {
    var gauges = byId("heb-gauges");
    var table = byId("heb-diagnostics-table");
    if (gauges) {
      gauges.innerHTML = hebDiagnostics.map(basisGauge).join("");
    }
    if (table) {
      table.innerHTML = hebDiagnostics.map(function (row) {
        return "<tr>"
          + "<td>" + escapeHtml(row.category) + "</td>"
          + "<td>" + Number(row.capture).toFixed(2) + "%</td>"
          + "<td>" + escapeHtml(row.mandates) + "</td>"
          + "<td>" + escapeHtml(row.definition) + "</td>"
          + "</tr>";
      }).join("");
    }
  }

  function renderInvestorDecisionMetrics() {
    var cards = byId("investor-decision-cards");
    var table = byId("investor-decision-table");
    if (cards) {
      cards.innerHTML = investorDecisionMetrics.map(function (row) {
        var positive = Number(row.returnPct) >= 0;
        return '<article class="decision-card ' + (positive ? "positive" : "negative") + '">'
          + "<span>" + escapeHtml(row.category) + "</span>"
          + "<b>" + (positive ? "+" : "") + Number(row.returnPct).toFixed(2) + "%</b>"
          + "<em>" + escapeHtml(row.window) + "</em>"
          + "<p>" + escapeHtml(row.feedback) + "</p>"
          + "</article>";
      }).join("");
    }
    if (table) {
      table.innerHTML = investorDecisionMetrics.map(function (row) {
        return "<tr>"
          + "<td>" + escapeHtml(row.category) + "</td>"
          + "<td>" + (Number(row.returnPct) >= 0 ? "+" : "") + Number(row.returnPct).toFixed(2) + "%</td>"
          + "<td>" + escapeHtml(row.window) + "</td>"
          + "<td>" + escapeHtml(row.feedback) + "</td>"
          + "</tr>";
      }).join("");
    }
  }

  function renderAutoGuardCounterfactuals() {
    var cards = byId("autoguard-counterfactuals");
    if (!cards) {
      return;
    }
    cards.innerHTML = autoGuardCounterfactuals.map(function (row) {
      return '<article class="decision-card positive">'
        + "<span>" + escapeHtml(row.category) + "</span>"
        + "<b>" + escapeHtml(row.value) + "</b>"
        + "<em>" + escapeHtml(row.window) + "</em>"
        + "<p>" + escapeHtml(row.feedback) + "</p>"
        + "</article>";
    }).join("");
  }

  function renderBrokerConnections() {
    var table = byId("broker-connection-table");
    if (!table) {
      return;
    }
    table.innerHTML = brokerConnections.map(function (row) {
      return "<tr>"
        + "<td><b>" + escapeHtml(row.connector) + "</b></td>"
        + "<td>" + escapeHtml(row.status) + "</td>"
        + "<td>" + escapeHtml(row.capabilities) + "</td>"
        + "<td>" + escapeHtml(row.constraints) + "</td>"
        + "</tr>";
    }).join("");
  }

  function tabletListItem(row) {
    return '<div class="tablet-list-row">'
      + "<div><b>" + escapeHtml(row.title || row.name) + "</b><span>" + escapeHtml(row.broker || row.detail) + "</span></div>"
      + '<em>' + escapeHtml(row.window || row.status) + '</em>'
      + "<p>" + escapeHtml(row.state || row.detail) + "</p>"
      + "</div>";
  }

  function renderTabletCommandBoard() {
    var queue = byId("tablet-execution-queue");
    var brokers = byId("tablet-broker-matrix");
    var cycles = byId("tablet-cycle-optimizer");
    var risk = byId("tablet-risk-envelope");
    if (queue) {
      queue.innerHTML = tabletExecutionQueue.map(tabletListItem).join("");
    }
    if (brokers) {
      brokers.innerHTML = tabletBrokerMatrix.map(tabletListItem).join("");
    }
    if (cycles) {
      cycles.innerHTML = tabletCycleOptimizer.map(tabletListItem).join("");
    }
    if (risk) {
      risk.innerHTML = tabletRiskEnvelope.map(tabletListItem).join("");
    }
  }

  function wirePortfolioBreakdown() {
    var filter = byId("portfolio-filter");
    if (filter) {
      filter.addEventListener("change", renderPortfolioBreakdown);
    }
    renderPortfolioBreakdown();
    renderCrossAccountPortfolio();
    renderHebDiagnostics();
    renderInvestorDecisionMetrics();
    renderAutoGuardCounterfactuals();
    renderBrokerConnections();
    renderTabletCommandBoard();
  }

  function loadAccountSnapshots() {
    if (!window.fetch) {
      return;
    }
    fetch("data/account-snapshots.json", {cache: "no-store"})
      .then(function (response) {
        if (!response.ok) {
          throw new Error("snapshot fetch failed");
        }
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !Array.isArray(payload.accounts) || !payload.accounts.length) {
          return;
        }
        accountSnapshots = payload.accounts;
        renderCrossAccountPortfolio();
      })
      .catch(function () {});
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

  function renderReportingTable() {
    var table = byId("reporting-table");
    if (!table) {
      return;
    }
    table.innerHTML = reportingRows.map(function (row) {
      return "<tr>"
        + "<td>" + escapeHtml(row.surface) + "</td>"
        + "<td>" + escapeHtml(row.audience) + "</td>"
        + "<td>" + escapeHtml(row.includes) + "</td>"
        + '<td><span class="health-pill ok">' + escapeHtml(row.fallback) + "</span></td>"
        + "</tr>";
    }).join("");
  }

  function renderDiagnosticsTable() {
    var table = byId("diagnostics-table");
    if (!table) {
      return;
    }
    table.innerHTML = diagnosticsRows.map(function (row) {
      return "<tr>"
        + "<td>" + escapeHtml(row.diagnostic) + "</td>"
        + "<td>" + escapeHtml(row.signal) + "</td>"
        + "<td>" + escapeHtml(row.action) + "</td>"
        + "<td>" + escapeHtml(row.evidence) + "</td>"
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
    wireLoginForm();
    loadCurrentSession();
    wireRegistrationForm();
    wireBehaviorControls();
    wireAdvancedOrderControls();
    wireSageMandateControls();
    wireRebalanceControls();
    wireCadenceControls();
    wireUniverseBuilder();
    wirePortfolioBreakdown();
    loadAccountSnapshots();
    renderAutomationHealth();
    renderReportingTable();
    renderDiagnosticsTable();
    wireCommandCenter();
    wireMerchStore();
    sendAnalytics();
  });
})();
