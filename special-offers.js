(function () {
  "use strict";

  var OFFER_ID = "cedars_sinai_voya";
  var currentTab = "access";
  var prospectusLoaded = false;
  var submitting = false;

  function $(id) { return document.getElementById(id); }

  function hasOffer(profile) {
    return Boolean(profile && Array.isArray(profile.special_offers) && profile.special_offers.indexOf(OFFER_ID) !== -1);
  }

  function enrollment(profile) {
    return profile && profile.retirement_sage_enrollment || null;
  }

  function setMessage(id, message, kind) {
    var element = $(id);
    if (!element) return;
    element.textContent = message || "";
    element.className = "form-message" + (kind ? " " + kind : "");
  }

  function request(path, options) {
    if (!window.SmartSleeveAuth || typeof window.SmartSleeveAuth.request !== "function") {
      return Promise.reject(new Error("account_controls_unavailable"));
    }
    return window.SmartSleeveAuth.request(path, options).then(function (response) {
      var contentType = response.headers.get("Content-Type") || "";
      if (contentType.indexOf("text/html") !== -1) {
        return response.text().then(function (body) {
          if (!response.ok) throw new Error("special_offer_content_unavailable");
          return body;
        });
      }
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || "request_failed");
        return payload;
      });
    });
  }

  function selectTab(tabName) {
    var profile = window.SmartSleeveAuth && window.SmartSleeveAuth.state.profile;
    if (tabName === "cedars-voya" && !hasOffer(profile)) return;
    currentTab = tabName;
    document.querySelectorAll("[data-offer-tab]").forEach(function (button) {
      button.setAttribute("aria-selected", button.getAttribute("data-offer-tab") === tabName ? "true" : "false");
    });
    $("access-panel").hidden = tabName !== "access";
    $("cedars-panel").hidden = tabName !== "cedars-voya";
    if (tabName === "cedars-voya") {
      window.history.replaceState({}, document.title, "#cedars-voya");
      loadProspectus();
    } else {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  function render() {
    var auth = window.SmartSleeveAuth;
    var state = auth && auth.state || {ready: false, profile: null};
    var profile = state.profile;
    if (!state.ready) {
      $("account-state").textContent = "Checking your SmartSleeve session...";
      return;
    }
    if (!profile) {
      $("account-state").textContent = "Sign in with a verified SmartSleeve account to view and unlock special offers.";
      $("account-sign-in").hidden = false;
      $("offers-workspace").hidden = true;
      return;
    }
    $("account-sign-in").hidden = true;
    $("offers-workspace").hidden = false;
    $("account-state").textContent = "Signed in as " + (profile.display_name || profile.username) + ".";
    var unlocked = hasOffer(profile);
    $("cedars-tab").setAttribute("aria-disabled", unlocked ? "false" : "true");
    $("cedars-tab-status").textContent = unlocked ? "Unlocked" : "Locked";
    $("unlocked-card").hidden = !unlocked;
    $("enrollment-email").textContent = profile.email;
    renderEnrollment(profile);
    if (unlocked && (window.location.hash === "#cedars-voya" || currentTab === "cedars-voya")) {
      selectTab("cedars-voya");
    } else if (!unlocked && currentTab === "cedars-voya") {
      selectTab("access");
    }
  }

  function renderEnrollment(profile) {
    var value = enrollment(profile);
    var active = Boolean(value && value.status === "active");
    $("enrollment-status").textContent = active ? "Enrolled monthly" : value && value.status === "canceled" ? "Enrollment canceled" : "Not enrolled";
    $("enrollment-status").className = "enrollment-status" + (active ? " active" : "");
    $("consent-row").hidden = active;
    $("enroll-button").hidden = active;
    $("cancel-enrollment").hidden = !active;
    if (!active) $("enrollment-consent").checked = false;
  }

  function loadProspectus() {
    if (prospectusLoaded) return;
    prospectusLoaded = true;
    $("prospectus-loading").hidden = false;
    request("/special-offers/cedars-voya/content", {method: "GET"}).then(function (markup) {
      var host = $("prospectus-host");
      var root = host.shadowRoot || host.attachShadow({mode: "open"});
      root.innerHTML = markup;
      $("prospectus-loading").hidden = true;
    }).catch(function () {
      prospectusLoaded = false;
      $("prospectus-loading").textContent = "The prospectus could not be loaded. Please refresh and try again.";
    });
  }

  function redeemOffer(event) {
    event.preventDefault();
    if (submitting) return;
    var code = $("offer-code").value.trim();
    if (!code) return;
    submitting = true;
    setMessage("offer-code-message", "Checking your invitation code...");
    request("/special-offers/redeem", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({code: code})
    }).then(function () {
      $("offer-code").value = "";
      setMessage("offer-code-message", "Cedars-Sinai Voya is now unlocked on your account.", "success");
      return window.SmartSleeveAuth.refresh();
    }).then(function () {
      selectTab("cedars-voya");
    }).catch(function (error) {
      var message = error.message === "special_offer_code_invalid"
        ? "That Special Offer code is not valid. Check the code and try again."
        : "The offer could not be unlocked right now. Please try again.";
      setMessage("offer-code-message", message, "error");
    }).finally(function () { submitting = false; });
  }

  function submitEnrollment(event) {
    event.preventDefault();
    if (submitting) return;
    if (!$("enrollment-consent").checked) {
      setMessage("enrollment-message", "Confirm that you want to receive the monthly emails before enrolling.", "error");
      return;
    }
    submitting = true;
    $("enroll-button").disabled = true;
    setMessage("enrollment-message", "Enrolling your verified account...");
    request("/retirement-sage/enrollment", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({action: "enroll", consent: true})
    }).then(function (payload) {
      setMessage("enrollment-message", payload.confirmation_email === "sent"
        ? "Enrollment confirmed. A confirmation email is on its way."
        : "Enrollment confirmed. Your monthly recommendations are active.", "success");
      return window.SmartSleeveAuth.refresh();
    }).catch(function () {
      setMessage("enrollment-message", "Enrollment could not be completed right now. Please try again.", "error");
    }).finally(function () {
      submitting = false;
      $("enroll-button").disabled = false;
    });
  }

  function cancelEnrollment() {
    if (submitting) return;
    submitting = true;
    setMessage("enrollment-message", "Canceling future monthly emails...");
    request("/retirement-sage/enrollment", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({action: "cancel"})
    }).then(function () {
      setMessage("enrollment-message", "Monthly Retirement Sage emails are canceled. You can enroll again at any time.", "success");
      return window.SmartSleeveAuth.refresh();
    }).catch(function () {
      setMessage("enrollment-message", "The enrollment could not be canceled right now. Please try again.", "error");
    }).finally(function () { submitting = false; });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-offer-tab]").forEach(function (button) {
      button.addEventListener("click", function () { selectTab(button.getAttribute("data-offer-tab")); });
    });
    document.querySelectorAll("[data-open-cedars]").forEach(function (button) {
      button.addEventListener("click", function () { selectTab("cedars-voya"); });
    });
    $("offer-code-form").addEventListener("submit", redeemOffer);
    $("enrollment-form").addEventListener("submit", submitEnrollment);
    $("cancel-enrollment").addEventListener("click", cancelEnrollment);
    $("account-sign-in").addEventListener("click", function () {
      if (window.SmartSleeveAuth) window.SmartSleeveAuth.open("login");
    });
    window.addEventListener("smartsleeve-auth-change", render);
    render();
  });
})();
