(function () {
  "use strict";

  var endpoint = meta("smartsleeve-auth-endpoint") || "https://smartsleeve-auth.jpsheppard88.workers.dev";
  endpoint = endpoint.replace(/\/$/, "");
  var state = {
    ready: false,
    profile: null,
    sessionToken: "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function meta(name) {
    var element = document.querySelector("meta[name=\"" + name + "\"]");
    var value = element ? String(element.getAttribute("content") || "").trim() : "";
    return value && value.indexOf("__") !== 0 ? value : "";
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
    if (element) element.textContent = value;
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function sessionKey() {
    return "smartsleeve_session:user";
  }

  function loadStoredSession() {
    try {
      var payload = JSON.parse(window.localStorage.getItem(sessionKey()) || "{}");
      state.sessionToken = payload.sessionToken || "";
    } catch (_err) {
      state.sessionToken = "";
    }
  }

  function storeSession(profile, token) {
    state.profile = profile || null;
    state.sessionToken = token || state.sessionToken || "";
    try {
      if (state.sessionToken && state.profile && state.profile.email) {
        window.localStorage.setItem(sessionKey(), JSON.stringify({
          sessionToken: state.sessionToken,
          principalEmail: normalizeEmail(state.profile.email),
          role: state.profile.role || "user",
          savedAt: new Date().toISOString()
        }));
      }
    } catch (_err) {
      // localStorage can be unavailable in locked-down browsers.
    }
  }

  function clearSession() {
    state.profile = null;
    state.sessionToken = "";
    try {
      window.localStorage.removeItem("smartsleeve_session:user");
      window.localStorage.removeItem("smartsleeve_session:developer");
    } catch (_err) {
      // localStorage can be unavailable in locked-down browsers.
    }
  }

  function authHeaders(extra) {
    var headers = Object.assign({"Accept": "application/json"}, extra || {});
    if (state.sessionToken) {
      headers.Authorization = "Bearer " + state.sessionToken;
    }
    return headers;
  }

  function authFetch(path, options) {
    options = options || {};
    return fetch(endpoint + path, Object.assign({
      mode: "cors",
      credentials: "include",
      cache: "no-store",
      headers: authHeaders(options.headers)
    }, options, {headers: authHeaders(options.headers)}));
  }

  function emitChange() {
    renderWidget();
    window.dispatchEvent(new CustomEvent("smartsleeve-auth-change", {
      detail: {
        ready: state.ready,
        profile: state.profile,
        sessionToken: state.sessionToken
      }
    }));
  }

  function displayName(profile) {
    return profile && (profile.display_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || profile.username || profile.email) || "SmartSleeve user";
  }

  function hasPortalAccess(profile) {
    return Boolean(profile && (
      profile.platform_access === true ||
      profile.platform_access === "true" ||
      profile.role === "developer"
    ));
  }

  function ensureWidget() {
    if ($("ss-auth-widget")) return;
    var widget = document.createElement("div");
    widget.id = "ss-auth-widget";
    widget.className = "ss-auth-widget";
    widget.innerHTML = [
      "<div class=\"ss-auth-status\"><b id=\"ss-auth-title\">SmartSleeve</b><span id=\"ss-auth-subtitle\">Checking session</span></div>",
      "<button type=\"button\" class=\"ss-auth-button\" id=\"ss-auth-open\">Sign in</button>",
      "<button type=\"button\" class=\"ss-auth-link\" id=\"ss-auth-logout\" hidden>Sign out</button>"
    ].join("");
    document.body.appendChild(widget);
    $("ss-auth-open").addEventListener("click", function () { openModal(state.profile ? "profile" : "login"); });
    $("ss-auth-logout").addEventListener("click", logout);
  }

  function renderWidget() {
    ensureWidget();
    var profile = state.profile;
    var title = $("ss-auth-title");
    var subtitle = $("ss-auth-subtitle");
    var open = $("ss-auth-open");
    var logoutButton = $("ss-auth-logout");
    if (!state.ready) {
      if (title) title.textContent = "SmartSleeve";
      if (subtitle) subtitle.textContent = "Checking session";
      if (open) open.textContent = "Sign in";
      return;
    }
    if (profile) {
      if (title) title.textContent = displayName(profile);
      if (subtitle) subtitle.textContent = hasPortalAccess(profile) ? "Portal access enabled" : "Website account";
      if (open) open.textContent = "Account";
      if (logoutButton) logoutButton.hidden = false;
    } else {
      if (title) title.textContent = "SmartSleeve";
      if (subtitle) subtitle.textContent = "Guest browsing";
      if (open) open.textContent = "Sign in";
      if (logoutButton) logoutButton.hidden = true;
    }
  }

  function openModal(mode) {
    ensureModal();
    setMode(mode || (state.profile ? "profile" : "login"));
    $("ss-auth-modal").hidden = false;
    fillProfileForm();
  }

  function closeModal() {
    var modal = $("ss-auth-modal");
    if (modal) modal.hidden = true;
  }

  function ensureModal() {
    if ($("ss-auth-modal")) return;
    var modal = document.createElement("div");
    modal.id = "ss-auth-modal";
    modal.className = "ss-auth-modal";
    modal.hidden = true;
    modal.innerHTML = [
      "<form class=\"ss-auth-card\" id=\"ss-auth-form\" data-mode=\"login\">",
      "<button type=\"button\" class=\"ss-auth-close\" id=\"ss-auth-close\" aria-label=\"Close\">&times;</button>",
      "<h2>SmartSleeve Account</h2>",
      "<p id=\"ss-auth-message\" class=\"ss-auth-message\">Sign in once and SmartSleeve can reuse your profile across the site.</p>",
      "<div class=\"ss-auth-tabs\" role=\"tablist\" aria-label=\"SmartSleeve account mode\">",
      "<button type=\"button\" data-ss-auth-mode=\"login\" aria-selected=\"true\">Sign in</button>",
      "<button type=\"button\" data-ss-auth-mode=\"register\" aria-selected=\"false\">Create account</button>",
      "<button type=\"button\" data-ss-auth-mode=\"profile\" aria-selected=\"false\">Profile</button>",
      "</div>",
      "<label class=\"ss-auth-register-fields\">Username<input id=\"ss-auth-username\" type=\"text\" autocomplete=\"username\" minlength=\"3\"></label>",
      "<div class=\"ss-auth-grid ss-auth-register-fields\">",
      "<label>First name<input id=\"ss-auth-first-name\" type=\"text\" autocomplete=\"given-name\"></label>",
      "<label>Last name<input id=\"ss-auth-last-name\" type=\"text\" autocomplete=\"family-name\"></label>",
      "</div>",
      "<label class=\"ss-auth-login-field\"><span id=\"ss-auth-identity-label\">Email or username</span><input id=\"ss-auth-identity\" type=\"text\" autocomplete=\"username\" autocapitalize=\"none\" spellcheck=\"false\"></label>",
      "<label class=\"ss-auth-login-field\">Password<input id=\"ss-auth-password\" type=\"password\" autocomplete=\"current-password\" minlength=\"12\" data-lpignore=\"true\" data-1p-ignore=\"true\"></label>",
      "<label class=\"ss-auth-register-fields\">Confirm password<input id=\"ss-auth-password-confirm\" type=\"password\" autocomplete=\"new-password\" minlength=\"12\" data-lpignore=\"true\" data-1p-ignore=\"true\"></label>",
      "<label class=\"ss-auth-register-fields\"><span><input id=\"ss-auth-terms\" type=\"checkbox\"> I understand this creates a general SmartSleeve user and does not authorize broker trading.</span></label>",
      "<div class=\"ss-auth-profile-fields\" hidden>",
      "<div class=\"ss-auth-grid\">",
      "<label>First name<input id=\"ss-profile-first-name\" type=\"text\" autocomplete=\"given-name\"></label>",
      "<label>Last name<input id=\"ss-profile-last-name\" type=\"text\" autocomplete=\"family-name\"></label>",
      "</div>",
      "<label>Shipping name<input id=\"ss-profile-ship-name\" type=\"text\" autocomplete=\"name\"></label>",
      "<label>Address line 1<input id=\"ss-profile-line1\" type=\"text\" autocomplete=\"shipping address-line1\"></label>",
      "<label>Address line 2<input id=\"ss-profile-line2\" type=\"text\" autocomplete=\"shipping address-line2\"></label>",
      "<div class=\"ss-auth-grid\">",
      "<label>City<input id=\"ss-profile-city\" type=\"text\" autocomplete=\"shipping address-level2\"></label>",
      "<label>State<input id=\"ss-profile-state\" type=\"text\" autocomplete=\"shipping address-level1\"></label>",
      "</div>",
      "<div class=\"ss-auth-grid\">",
      "<label>ZIP<input id=\"ss-profile-postal\" type=\"text\" autocomplete=\"shipping postal-code\"></label>",
      "<label>Phone<input id=\"ss-profile-phone\" type=\"tel\" autocomplete=\"tel\"></label>",
      "</div>",
      "</div>",
      "<button type=\"submit\" class=\"ss-auth-submit\" id=\"ss-auth-submit\">Sign in</button>",
      "</form>"
    ].join("");
    document.body.appendChild(modal);
    $("ss-auth-close").addEventListener("click", closeModal);
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });
    Array.prototype.slice.call(modal.querySelectorAll("[data-ss-auth-mode]")).forEach(function (button) {
      button.addEventListener("click", function () { setMode(button.getAttribute("data-ss-auth-mode")); });
    });
    $("ss-auth-form").addEventListener("submit", submitModal);
  }

  function setMode(mode) {
    var next = mode === "register" ? "register" : mode === "profile" ? "profile" : "login";
    if (next === "profile" && !state.profile) next = "login";
    var form = $("ss-auth-form");
    if (!form) return;
    form.setAttribute("data-mode", next);
    Array.prototype.slice.call(form.querySelectorAll("[data-ss-auth-mode]")).forEach(function (button) {
      button.setAttribute("aria-selected", button.getAttribute("data-ss-auth-mode") === next ? "true" : "false");
    });
    Array.prototype.slice.call(form.querySelectorAll(".ss-auth-register-fields")).forEach(function (element) {
      element.hidden = next !== "register";
    });
    Array.prototype.slice.call(form.querySelectorAll(".ss-auth-login-field")).forEach(function (element) {
      element.hidden = next === "profile";
    });
    var profileFields = form.querySelector(".ss-auth-profile-fields");
    if (profileFields) profileFields.hidden = next !== "profile";
    text("ss-auth-identity-label", next === "register" ? "Email" : "Email or username");
    $("ss-auth-submit").textContent = next === "register" ? "Create account" : next === "profile" ? "Save profile" : "Sign in";
    $("ss-auth-message").textContent = next === "register"
      ? "Create a verified SmartSleeve website account. You will need to confirm your email before sign-in."
      : next === "profile"
        ? "Save the profile and shipping address SmartSleeve can use across the site."
        : "Sign in once and SmartSleeve can reuse your profile across the site.";
    fillProfileForm();
  }

  function profilePayloadFromForm() {
    return {
      first_name: ($("ss-profile-first-name") || {}).value || "",
      last_name: ($("ss-profile-last-name") || {}).value || "",
      shipping_address: {
        name: ($("ss-profile-ship-name") || {}).value || "",
        line1: ($("ss-profile-line1") || {}).value || "",
        line2: ($("ss-profile-line2") || {}).value || "",
        city: ($("ss-profile-city") || {}).value || "",
        state: ($("ss-profile-state") || {}).value || "",
        postal_code: ($("ss-profile-postal") || {}).value || "",
        country: "US",
        phone: ($("ss-profile-phone") || {}).value || ""
      }
    };
  }

  function fillProfileForm() {
    var profile = state.profile || {};
    var shipping = profile.shipping_address || {};
    [
      ["ss-profile-first-name", profile.first_name || ""],
      ["ss-profile-last-name", profile.last_name || ""],
      ["ss-profile-ship-name", shipping.name || displayName(profile)],
      ["ss-profile-line1", shipping.line1 || ""],
      ["ss-profile-line2", shipping.line2 || ""],
      ["ss-profile-city", shipping.city || ""],
      ["ss-profile-state", shipping.state || ""],
      ["ss-profile-postal", shipping.postal_code || ""],
      ["ss-profile-phone", shipping.phone || ""]
    ].forEach(function (pair) {
      var input = $(pair[0]);
      if (input && !input.value) input.value = pair[1];
    });
    var identity = $("ss-auth-identity");
    if (identity && !identity.value && profile.email) identity.value = profile.email;
  }

  function submitModal(event) {
    event.preventDefault();
    var mode = $("ss-auth-form").getAttribute("data-mode");
    if (mode === "register") return register();
    if (mode === "profile") return saveProfile();
    return login();
  }

  function login() {
    var identity = ($("ss-auth-identity") || {}).value || "";
    var password = ($("ss-auth-password") || {}).value || "";
    $("ss-auth-message").textContent = "Signing in...";
    authFetch("/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({identity: identity, password: password})
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || "login_failed");
        storeSession(payload.profile, payload.session_token);
        state.ready = true;
        emitChange();
        closeModal();
      });
    }).catch(function (error) {
      $("ss-auth-message").textContent = "Sign in failed: " + error.message;
    });
  }

  function register() {
    var email = normalizeEmail(($("ss-auth-identity") || {}).value || "");
    var password = ($("ss-auth-password") || {}).value || "";
    $("ss-auth-message").textContent = "Creating account...";
    authFetch("/register", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        username: ($("ss-auth-username") || {}).value || email.split("@")[0],
        email: email,
        first_name: ($("ss-auth-first-name") || {}).value || "",
        last_name: ($("ss-auth-last-name") || {}).value || "",
        password: password,
        password_confirm: ($("ss-auth-password-confirm") || {}).value || "",
        accepted_terms: Boolean(($("ss-auth-terms") || {}).checked)
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.ok) {
          throw new Error(payload.errors && payload.errors.length ? payload.errors.join(", ") : payload.error || "registration_failed");
        }
        $("ss-auth-message").textContent = "Check your email for the SmartSleeve verification link, then come back to sign in.";
        setMode("login");
      });
    }).catch(function (error) {
      $("ss-auth-message").textContent = "Account creation failed: " + error.message;
    });
  }

  function saveProfile() {
    $("ss-auth-message").textContent = "Saving profile...";
    return authFetch("/profile", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(profilePayloadFromForm())
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || "profile_update_failed");
        storeSession(payload.profile, state.sessionToken);
        state.ready = true;
        emitChange();
        $("ss-auth-message").textContent = "Profile saved.";
      });
    }).catch(function (error) {
      $("ss-auth-message").textContent = "Profile save failed: " + error.message;
    });
  }

  function refresh() {
    loadStoredSession();
    return authFetch("/me")
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (response.ok && payload.ok && payload.profile) {
            storeSession(payload.profile, state.sessionToken || payload.session_token);
          } else {
            clearSession();
          }
          state.ready = true;
          emitChange();
          return state;
        });
      })
      .catch(function () {
        state.ready = true;
        emitChange();
        return state;
      });
  }

  function logout() {
    authFetch("/logout", {method: "POST"}).catch(function () {}).then(function () {
      clearSession();
      state.ready = true;
      emitChange();
    });
  }

  window.SmartSleeveAuth = {
    state: state,
    refresh: refresh,
    open: openModal,
    logout: logout,
    saveProfile: saveProfile,
    hasPortalAccess: hasPortalAccess
  };

  document.addEventListener("DOMContentLoaded", function () {
    ensureWidget();
    renderWidget();
    refresh();
  });
})();
