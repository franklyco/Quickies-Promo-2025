(() => {
  const KEY_RETURN = "fco_return_to";
  const KEY_MODE = "fco_accounts_mode"; // "legacy" | "new"
  const LEGACY_KEY_RETURN = "quickiesPromoReturnUrl";
  const LEGACY_KEY_PENDING = "quickiesPromoReturnPending";

  const STOREFRONT_LOGIN_URL =
    window.FCO_STOREFRONT_LOGIN_URL || "/account/login";
  const LEGACY_REGISTER_URL =
    window.FCO_LEGACY_REGISTER_URL || "/account/register";

  function currentRelativeUrl() {
    return (
      window.location.pathname +
      window.location.search +
      window.location.hash
    );
  }

  function isSafeRelativePath(value) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.startsWith("/") &&
      !value.startsWith("//")
    );
  }

  function normalizeReturnTo(value) {
    if (!value || typeof value !== "string") return "";

    try {
      const decoded = decodeURIComponent(value);
      if (isSafeRelativePath(decoded)) return decoded;
      const decodedUrl = new URL(decoded, window.location.origin);
      if (decodedUrl.origin !== window.location.origin) return "";
      return decodedUrl.pathname + decodedUrl.search + decodedUrl.hash;
    } catch (err) {
      try {
        if (isSafeRelativePath(value)) return value;
        const url = new URL(value, window.location.origin);
        if (url.origin !== window.location.origin) return "";
        return url.pathname + url.search + url.hash;
      } catch (innerErr) {
        return "";
      }
    }
  }

  function safeSessionRead(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function safeSessionWrite(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function safeSessionRemove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch (err) {}
  }

  function storeReturnTo(returnTo) {
    const normalized = normalizeReturnTo(returnTo);
    if (!isSafeRelativePath(normalized)) return "";

    safeSessionWrite(KEY_RETURN, normalized);

    // Keep legacy fallback behavior aligned with current implementation.
    safeSessionWrite(LEGACY_KEY_RETURN, normalized);
    safeSessionWrite(LEGACY_KEY_PENDING, "true");

    return normalized;
  }

  function getStoredReturnTo() {
    return normalizeReturnTo(safeSessionRead(KEY_RETURN));
  }

  function clearStoredReturnTo() {
    safeSessionRemove(KEY_RETURN);
    safeSessionRemove(LEGACY_KEY_RETURN);
    safeSessionRemove(LEGACY_KEY_PENDING);
  }

  function getReturnFromQuery() {
    const params = new URLSearchParams(window.location.search);
    return normalizeReturnTo(params.get("return_to") || params.get("return_url"));
  }

  function buildRedirectUrl(base, returnTo) {
    const u = new URL(base, window.location.origin);
    u.searchParams.set("return_to", returnTo);
    u.searchParams.set("return_url", returnTo);
    return u.pathname + (u.search || "") + (u.hash || "");
  }

  async function detectAccountsMode() {
    const cached = safeSessionRead(KEY_MODE);
    if (cached === "legacy" || cached === "new") return cached;

    try {
      const res = await fetch("/account/login", {
        credentials: "include",
        redirect: "follow",
        cache: "no-store",
      });
      const finalUrl = new URL(res.url, window.location.origin);
      const isNew = finalUrl.pathname.indexOf("/customer_authentication/") === 0;
      const mode = isNew ? "new" : "legacy";
      safeSessionWrite(KEY_MODE, mode);
      return mode;
    } catch (err) {
      // Use legacy as a safe fallback to preserve current behavior.
      safeSessionWrite(KEY_MODE, "legacy");
      return "legacy";
    }
  }

  function injectReturnToIntoLegacyRegisterForm() {
    if (window.location.pathname !== "/account/register") return;

    const returnTo = getReturnFromQuery() || getStoredReturnTo();
    if (!isSafeRelativePath(returnTo)) return;

    const form = document.querySelector('form[action="/account"]');
    if (!form) return;

    let returnToInput = form.querySelector('input[name="return_to"]');
    if (!returnToInput) {
      returnToInput = document.createElement("input");
      returnToInput.type = "hidden";
      returnToInput.name = "return_to";
      form.appendChild(returnToInput);
    }
    returnToInput.value = returnTo;

    let returnUrlInput = form.querySelector('input[name="return_url"]');
    if (!returnUrlInput) {
      returnUrlInput = document.createElement("input");
      returnUrlInput.type = "hidden";
      returnUrlInput.name = "return_url";
      form.appendChild(returnUrlInput);
    }
    returnUrlInput.value = returnTo;
  }

  function postAuthFallbackRedirect() {
    if (!window.FCO_CUSTOMER_LOGGED_IN) return;

    const returnTo = getStoredReturnTo();
    if (!isSafeRelativePath(returnTo)) return;

    const path = window.location.pathname;
    const onAccountish =
      path.indexOf("/account") === 0 ||
      path.indexOf("/customer_authentication") === 0;
    if (!onAccountish) return;

    if (currentRelativeUrl() === returnTo) {
      clearStoredReturnTo();
      return;
    }

    clearStoredReturnTo();
    window.location.replace(returnTo);
  }

  async function handleAuthClick(event) {
    const link = event.target.closest(
      "a.fco-banner__cta--register, a.fco-banner__cta--login, a[data-fco-auth-cta]"
    );
    if (!link) return;

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();

    const capturedReturnTo = storeReturnTo(currentRelativeUrl()) || "/";
    const requestedMode = (link.dataset.fcoAuthCta || "").toLowerCase();
    const wantsRegister =
      requestedMode === "register" ||
      link.classList.contains("fco-banner__cta--register");

    try {
      let targetBase = STOREFRONT_LOGIN_URL;
      if (wantsRegister) {
        const mode = await detectAccountsMode();
        targetBase = mode === "legacy" ? LEGACY_REGISTER_URL : STOREFRONT_LOGIN_URL;
      }
      window.location.href = buildRedirectUrl(targetBase, capturedReturnTo);
    } catch (err) {
      // Fall back to authored href if detection/navigation fails.
      window.location.href =
        link.getAttribute("href") ||
        (wantsRegister ? LEGACY_REGISTER_URL : STOREFRONT_LOGIN_URL);
    }
  }

  function primeReturnFromQuery() {
    const returnTo = getReturnFromQuery();
    if (!isSafeRelativePath(returnTo)) return;
    storeReturnTo(returnTo);
  }

  document.addEventListener("click", handleAuthClick);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      primeReturnFromQuery();
      injectReturnToIntoLegacyRegisterForm();
      postAuthFallbackRedirect();
    });
  } else {
    primeReturnFromQuery();
    injectReturnToIntoLegacyRegisterForm();
    postAuthFallbackRedirect();
  }
})();
