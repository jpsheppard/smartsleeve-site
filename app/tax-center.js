(function () {
  "use strict";

  var state = {data: null, tab: "alpha", basket: "broad", account: "all", sleeve: "all"};

  function html(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char];
    });
  }

  function money(value, missing) {
    if (value == null || value === "" || !Number.isFinite(Number(value))) return missing || "Awaiting ledger";
    return new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0}).format(Number(value));
  }

  function percent(value, digits, missing) {
    if (value == null || value === "" || !Number.isFinite(Number(value))) return missing || "Awaiting ledger";
    return Number(value).toFixed(digits == null ? 2 : digits) + "%";
  }

  function titleCase(value) {
    return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function addNavLink(nav, label, compactLabel) {
    if (!nav || nav.querySelector('[data-nav="tax-center"]')) return;
    var link = document.createElement("a");
    link.href = "#tax-center";
    link.setAttribute("data-nav", "tax-center");
    link.textContent = nav.classList.contains("bottom-nav") ? compactLabel : label;
    var anchor = nav.querySelector('[data-nav="reallocation"]') || nav.querySelector('[data-nav="trade"]');
    if (anchor && anchor.nextSibling) anchor.parentNode.insertBefore(link, anchor.nextSibling);
    else nav.appendChild(link);
  }

  function ensureSurface() {
    addNavLink(document.querySelector(".primary-nav"), "Tax Center", "Tax");
    addNavLink(document.querySelector(".bottom-nav"), "Tax Center", "Tax");
    if (document.getElementById("tax-center")) return;
    var panel = document.createElement("section");
    panel.id = "tax-center";
    panel.className = "panel tax-center-panel";
    panel.setAttribute("data-section", "tax-center");
    panel.innerHTML = ''
      + '<div class="tax-hero">'
      + '  <div><p class="eyebrow">Tax Sage / Household Tax Authority</p><h2>Keep every account inside the wash-sale perimeter.</h2>'
      + '  <p>One evidence-backed operating view for harvested losses, tax deferral, cross-account collisions, and lot-level history.</p></div>'
      + '  <div class="tax-source-chip" id="tax-source-chip">Loading generated artifacts</div>'
      + '</div>'
      + '<div class="tax-tabs" role="tablist" aria-label="Tax Center views">'
      + '  <button type="button" role="tab" data-tax-tab="alpha" aria-selected="true">Tax alpha</button>'
      + '  <button type="button" role="tab" data-tax-tab="guard" aria-selected="false">Wash-sale guard</button>'
      + '  <button type="button" role="tab" data-tax-tab="ledger" aria-selected="false">Lot &amp; harvest ledger</button>'
      + '</div>'
      + '<div id="tax-center-content" aria-live="polite"><article class="panel-card tax-loading">Loading Tax Authority tearsheets…</article></div>'
      + '<p class="tax-disclaimer" id="tax-disclaimer">Not tax advice. Confirm live treatment with a CPA.</p>';
    var main = document.querySelector("main");
    var before = document.getElementById("shop") || document.getElementById("diagnostics") || (main && main.querySelector("footer"));
    if (main) main.insertBefore(panel, before || null);
  }

  function metric(label, value, note, tone) {
    return '<article class="tax-metric ' + html(tone || "") + '"><span>' + html(label) + '</span><strong>' + html(value) + '</strong><p>' + html(note) + '</p></article>';
  }

  function alphaView(data) {
    var ledger = data.ledger || {};
    var summary = ledger.summary || {};
    var books = ((data.tax_alpha || {}).books || []);
    var book = books.find(function (item) { return item.basket === state.basket; }) || books[0] || {};
    var never = book.never_liquidate || {};
    var liquidate = book.liquidate_at_horizon || {};
    var awaiting = ledger.status !== "available";
    var selector = books.map(function (item) {
      return '<option value="' + html(item.basket) + '"' + (item.basket === book.basket ? " selected" : "") + '>' + html(titleCase(item.basket)) + ' basket</option>';
    }).join("");
    return ''
      + '<div class="tax-section-head"><div><span>Household ledger</span><h3>' + html(ledger.tax_year || "Current year") + ' tax posture</h3></div>'
      + '<span class="tax-status ' + (awaiting ? "pending" : "ready") + '">' + html(awaiting ? "Awaiting live ledger" : "Ledger connected") + '</span></div>'
      + '<div class="tax-metric-grid live">'
      + metric("Harvested YTD", money(summary.harvested_loss_ytd_usd), awaiting ? "No live value is shown until a JSONL ledger is published." : "Gross realized losses in the published household ledger.", "primary")
      + metric("Ledger gains offset", money(summary.ledger_gains_offset_ytd_usd), "Limited to gains present in this ledger; external gains are not assumed.")
      + metric("Carryforward candidate", money(summary.carryforward_candidate_usd), "Pre-return estimate before the ordinary-income allowance and CPA reconciliation.")
      + metric("Disallowance rate", percent(summary.disallowance_rate_pct, 2), "Disallowed loss divided by gross harvested loss YTD.")
      + '</div>'
      + '<article class="panel-card tax-model-card">'
      + ' <div class="tax-section-head"><div><span>Generated backtest tearsheet</span><h3>Modeled tax-alpha proof</h3></div><label class="tax-select">Universe<select id="tax-basket-select">' + selector + '</select></label></div>'
      + ' <div class="tax-model-meta"><span>' + html(book.harvest_count || 0) + ' harvests</span><span>' + html(book.window_years || "—") + ' years</span><span>' + percent(book.harvest_yield_pct_per_yr, 2, "—") + ' harvest yield / year</span><span>' + percent(book.tracking_error_pct, 3, "—") + ' tracking error</span></div>'
      + ' <div class="tax-metric-grid modeled">'
      + metric("Modeled harvested", money(book.modeled_harvested_loss_usd, "—"), "Full simulation window, not live YTD.")
      + metric("Losses applied", money(book.modeled_losses_applied_usd, "Source did not publish"), "Losses used in the modeled tax scenario.")
      + metric("Carryforward at horizon", money(book.carryforward_at_horizon_usd, "Source did not publish"), "Unused modeled loss, shown separately from current tax value.")
      + metric("Deferral value", money(book.deferral_value_usd, "—"), "Present modeled tax value before final liquidation.", "accent")
      + metric("Disallowance rate", percent(book.disallowance_rate_pct, 2, "—"), "Generated by the selected tearsheet.")
      + ' </div>'
      + ' <div class="tax-bookends">'
      + '  <article><span>Never liquidate · upper bookend</span><strong>' + money(never.after_tax_value_usd, "—") + '</strong><b>' + percent(never.tax_alpha_pct_per_yr, 3, "—") + ' / year</b><p>Assumes the embedded gain is never realized.</p></article>'
      + '  <div class="tax-bookend-line" aria-hidden="true"><i></i></div>'
      + '  <article><span>Liquidate at horizon · lower bookend</span><strong>' + money(liquidate.after_tax_value_usd, "—") + '</strong><b>' + percent(liquidate.tax_alpha_pct_per_yr, 3, "—") + ' / year</b><p>Taxes the embedded gain at the modeled long-term rate.</p></article>'
      + ' </div>'
      + ' <div class="tax-truth-note"><b>Defers, not erases.</b><span>' + html((data.tax_alpha || {}).framing || "") + '</span></div>'
      + '</article>';
  }

  function guardView(data) {
    var guard = data.wash_guard || {};
    var collision = guard.collision || {};
    var accounts = guard.accounts || [];
    return ''
      + '<article class="tax-guard-hero">'
      + ' <span>Cross-account value protected</span><strong>' + money(guard.hero_saved_usd, "—") + '</strong>'
      + ' <h3>saved that a single-custodian robo would’ve lost</h3>'
      + ' <p>The household guard caught a ' + money(collision.realized_loss_at_risk_usd, "—") + ' loss exposed to a wash sale that the account-local check cleared.</p>'
      + '</article>'
      + '<div class="tax-metric-grid guard">'
      + metric("Collisions caught", String(guard.collisions_caught == null ? "—" : guard.collisions_caught), "Generated collision-demo events where the household view changed the ruling.", "primary")
      + metric("Window distance", collision.days_after_harvest == null ? "—" : collision.days_after_harvest + " days", "Inside the ±30-calendar-day wash-sale window.")
      + metric("Protected loss", money(collision.realized_loss_at_risk_usd, "—"), "Loss the single-account guard would have claimed.")
      + '</div>'
      + '<div class="tax-account-grid">' + accounts.map(function (account) {
        return '<article class="tax-account-card ' + html(account.temperature) + '"><div><span class="tax-temp">' + html(String(account.temperature || "").toUpperCase()) + '</span><span>' + html(account.role) + '</span></div><h3>' + html(account.account_id) + '</h3><p>' + html(account.detail) + '</p></article>';
      }).join("") + '</div>'
      + '<article class="panel-card tax-collision-card"><div class="tax-section-head"><div><span>Collision caught</span><h3>' + html(collision.symbol || "Security") + ' household timeline</h3></div><span class="tax-status ready">Guarded</span></div>'
      + '<div class="tax-timeline">'
      + ' <div><time>' + html(collision.harvest_date || "—") + '</time><b>Harvest proposed</b><p>Single-custodian action: ' + html(titleCase(collision.single_custodian_action || "unknown")) + '.</p></div>'
      + ' <i aria-hidden="true"></i>'
      + ' <div><time>' + html(collision.collision_date || "—") + '</time><b>' + html(collision.cause || "Offsetting purchase") + '</b><p>Household action: ' + html(titleCase(collision.household_action || "unknown")) + '.</p></div>'
      + '</div><p class="tax-reason">' + html(collision.household_reason || "") + '</p></article>';
  }

  function ledgerView(data) {
    var ledger = data.ledger || {};
    var rows = (ledger.lots || []).concat(ledger.dispositions || []);
    var accounts = Array.from(new Set(rows.map(function (row) { return row.account_id; }).filter(Boolean))).sort();
    var sleeves = Array.from(new Set(rows.map(function (row) { return row.sleeve; }).filter(Boolean))).sort();
    var filtered = rows.filter(function (row) {
      return (state.account === "all" || row.account_id === state.account) && (state.sleeve === "all" || row.sleeve === state.sleeve);
    });
    var filters = '<div class="tax-ledger-filters"><label>Account<select id="tax-account-filter"><option value="all">All accounts</option>'
      + accounts.map(function (value) { return '<option value="' + html(value) + '"' + (value === state.account ? " selected" : "") + '>' + html(value) + '</option>'; }).join("")
      + '</select></label><label>Sleeve<select id="tax-sleeve-filter"><option value="all">All sleeves</option>'
      + sleeves.map(function (value) { return '<option value="' + html(value) + '"' + (value === state.sleeve ? " selected" : "") + '>' + html(titleCase(value)) + '</option>'; }).join("")
      + '</select></label></div>';
    if (ledger.status !== "available") {
      return '<article class="panel-card tax-empty"><span>Household JSONL ledger</span><h3>Awaiting the first published ledger</h3><p>No lot, basis, or harvest rows are invented. Run the Tax Authority publisher with the household <code>taxlots.py</code> JSONL output to activate this view.</p></article>';
    }
    var body = filtered.map(function (row) {
      var result = row.kind === "lot"
        ? (row.status === "open" ? money(row.cost_basis_usd, "—") + " basis" : "Closed lot")
        : (row.harvested_loss_usd > 0 ? money(row.allowed_loss_usd, "—") + " allowed loss" : money(row.realized_gain_usd, "—") + " gain");
      var guard = row.kind === "lot" ? String(row.fidelity || "unknown").toUpperCase() : titleCase(row.wash_flag || "none");
      return '<tr><td data-label="Type"><span class="tax-row-kind ' + html(row.kind) + '">' + html(row.kind === "lot" ? (row.status === "open" ? "Open lot" : "Closed lot") : "Harvest / sale") + '</span></td>'
        + '<td data-label="Security"><b>' + html(row.symbol) + '</b><small>' + html(row.date) + '</small></td>'
        + '<td data-label="Account"><b>' + html(row.account_id) + '</b><small>' + html(titleCase(row.sleeve)) + '</small></td>'
        + '<td data-label="Shares">' + html(row.shares == null ? "—" : row.shares) + '</td>'
        + '<td data-label="Result"><b>' + html(result) + '</b><small>' + html(guard) + '</small></td></tr>';
    }).join("");
    return '<div class="tax-section-head"><div><span>Specific-lot authority</span><h3>Account &amp; sleeve ledger</h3></div><span class="tax-status ready">' + html(rows.length) + ' generated rows</span></div>'
      + filters
      + '<article class="panel-card tax-ledger-card"><div class="table-wrap"><table class="tax-ledger-table"><thead><tr><th>Type</th><th>Security</th><th>Account / sleeve</th><th>Shares</th><th>Result / guard</th></tr></thead><tbody>'
      + (body || '<tr><td colspan="5">No rows match these filters.</td></tr>') + '</tbody></table></div></article>'
      + '<p class="tax-ledger-note">' + html(ledger.note || "") + '</p>';
  }

  function render() {
    var target = document.getElementById("tax-center-content");
    if (!target || !state.data) return;
    var data = state.data;
    document.getElementById("tax-disclaimer").textContent = data.disclaimer || "Not tax advice. Confirm live treatment with a CPA.";
    var source = document.getElementById("tax-source-chip");
    if (source) source.textContent = data.available ? "Generated artifacts · " + (data.as_of_date || "current") : "Generated artifacts unavailable";
    if (!data.available) {
      target.innerHTML = '<article class="panel-card tax-empty"><span>Data contract</span><h3>Tax Authority artifacts are not published yet</h3><p>Missing: ' + html((data.missing_artifacts || []).join(", ")) + '.</p></article>';
      return;
    }
    target.innerHTML = state.tab === "guard" ? guardView(data) : state.tab === "ledger" ? ledgerView(data) : alphaView(data);
    wireDynamicControls();
  }

  function wireDynamicControls() {
    var basket = document.getElementById("tax-basket-select");
    if (basket) basket.addEventListener("change", function () { state.basket = basket.value; render(); });
    var account = document.getElementById("tax-account-filter");
    if (account) account.addEventListener("change", function () { state.account = account.value; render(); });
    var sleeve = document.getElementById("tax-sleeve-filter");
    if (sleeve) sleeve.addEventListener("change", function () { state.sleeve = sleeve.value; render(); });
  }

  function wireTabs() {
    document.querySelectorAll("[data-tax-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.tab = button.getAttribute("data-tax-tab") || "alpha";
        document.querySelectorAll("[data-tax-tab]").forEach(function (candidate) {
          candidate.setAttribute("aria-selected", candidate === button ? "true" : "false");
        });
        render();
      });
    });
  }

  function applyData(payload) {
    if (!payload || payload.record_type !== "tax_center") return false;
    if (state.data && state.data.available && payload.available === false) return false;
    state.data = payload;
    render();
    return true;
  }

  function loadStaticData() {
    return fetch("/app/data/tax-center.json", {cache: "no-store"}).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(applyData).catch(function () {
      applyData({record_type: "tax_center", available: false, missing_artifacts: ["tax-center.json"], disclaimer: "Not tax advice. Confirm live treatment with a CPA."});
    });
  }

  window.SmartSleeveTaxCenter = {applyData: applyData, reload: loadStaticData};
  document.addEventListener("DOMContentLoaded", function () {
    ensureSurface();
    wireTabs();
    loadStaticData();
  });
})();
