(function () {
  const DEV_MODE = true;
  const PREVIEW_EVENT = "promoPreviewToggle";
  const STICKER_COLOR = "#D9391F";
  const TOKEN_BACKGROUND = "#f7f6f4";
  const TOKEN_TEXT = "#43362f";
  const PREVIEW_SHORTCUT_KEY = "p";
  const SMALL_DESKTOP_MEDIA_QUERY = "(min-width: 990px) and (max-width: 1400px)";
  const BASE_PROMO_COLLECTION_HANDLE = "fivepromo";
  const SALE_TIER_COLLECTION_PREFIX = "fivepromo-sale-";

  const DISCOUNT_MAP = {
    fivepromo: {
      code: "Quickies-FIVEPROMO",
      label: "Quickies-FIVEPROMO: $20 off at checkout",
      variantId: window.fiveFingerVariantId,
      showGuestBanner: true,
      showStickerForFirstOrder: true,
      showReturningBanner: true,
      returningBannerSmallText: "Offer for new customers only. For more info, please visit our FAQ.",
      overrideAddToCartButton: true,
      authRedirectPath: function () {
        return window.location.pathname + window.location.search;
      },
      showProductBlockPrice: true,
      promoInlinePriceText: "$5.00",
      forceReloadForLoggedInPromo: true,
    },
  };
  // Keys must be collection handles (not collection titles).
  const SALE_TIER_MAP = {
    "fivepromo-sale-20": {
      code: "Quickies-FIVEPROMO-SALE-20",
      label: "Quickies-FIVEPROMO-SALE-20",
    },
    "FIVEPROMO-SALE-18": {
      code: "Quickies-FIVEPROMO-SALE-18",
      label: "Quickies-FIVEPROMO-SALE-18",
    },
    "FIVEPROMO-SALE-17": {
      code: "Quickies-FIVEPROMO-SALE-17",
      label: "Quickies-FIVEPROMO-SALE-17",
    },
    "fivepromo-sale-15": {
      code: "Quickies-FIVEPROMO-SALE-15",
      label: "Quickies-FIVEPROMO-SALE-15",
    },
    "fivepromo-sale-13": {
      code: "Quickies-FIVEPROMO-SALE-13",
      label: "Quickies-FIVEPROMO-SALE-13",
    },
    "fivepromo-sale-12": {
      code: "Quickies-FIVEPROMO-SALE-12",
      label: "Quickies-FIVEPROMO-SALE-12",
    },
    "fivepromo-sale-10": {
      code: "Quickies-FIVEPROMO-SALE-10",
      label: "Quickies-FIVEPROMO-SALE-10",
    },
    "fivepromo-sale-8": {
      code: "Quickies-FIVEPROMO-SALE-8",
      label: "Quickies-FIVEPROMO-SALE-8",
    },
    "fivepromo-sale-7": {
      code: "Quickies-FIVEPROMO-SALE-7",
      label: "Quickies-FIVEPROMO-SALE-7",
    },
    "fivepromo-sale-6": {
      code: "Quickies-FIVEPROMO-SALE-6",
      label: "Quickies-FIVEPROMO-SALE-6",
    },
  };

  let promoBannerMounted = false;
  let promoInitInFlight = false;
  let promoReapplyTimer = null;

  function isPreviewEnabled() {
    return Boolean(window.promoPreviewEnabled);
  }

  function waitForElement(selector, callback, interval = 50, timeout = 3000) {
    const start = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (el) {
        callback(el);
      } else if (Date.now() - start < timeout) {
        setTimeout(check, interval);
      }
    };
    check();
  }

  function normalizeCollectionKey(value) {
    if (typeof value !== "string") return "";
    return value
      .trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getCollectionHandles(collections) {
    if (!Array.isArray(collections)) return [];
    const keys = new Set();

    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];

      if (typeof collection === "string") {
        const lowered = collection.toLowerCase();
        keys.add(lowered);
        const normalized = normalizeCollectionKey(collection);
        if (normalized) keys.add(normalized);
        continue;
      }

      if (!collection || typeof collection !== "object") continue;

      if (typeof collection.handle === "string") {
        keys.add(collection.handle.toLowerCase());
      }

      if (typeof collection.title === "string") {
        keys.add(collection.title.toLowerCase());
        const normalizedTitle = normalizeCollectionKey(collection.title);
        if (normalizedTitle) keys.add(normalizedTitle);
      }
    }

    return Array.from(keys);
  }

  function resolveDiscountConfig(collections, previewEnabled) {
    const baseConfig = DISCOUNT_MAP[BASE_PROMO_COLLECTION_HANDLE];
    if (!baseConfig) return null;

    const handles = getCollectionHandles(collections);
    const hasBasePromoCollection =
      handles.indexOf(BASE_PROMO_COLLECTION_HANDLE) !== -1;

    if (!hasBasePromoCollection) {
      if (previewEnabled) {
        return Object.assign({}, baseConfig);
      }
      return null;
    }

    let hasAnyTierCollection = false;
    for (let i = 0; i < handles.length; i++) {
      if (handles[i].indexOf(SALE_TIER_COLLECTION_PREFIX) === 0) {
        hasAnyTierCollection = true;
        break;
      }
    }

    // Deterministic priority: first key in SALE_TIER_MAP wins when multiple tiers match.
    const tierPriorityHandles = Object.keys(SALE_TIER_MAP);
    for (let i = 0; i < tierPriorityHandles.length; i++) {
      const tierKey = tierPriorityHandles[i];
      const normalizedTierKey = normalizeCollectionKey(tierKey);
      if (!normalizedTierKey) continue;
      if (handles.indexOf(normalizedTierKey) === -1) continue;

      const tierOverrideConfig = SALE_TIER_MAP[tierKey];
      if (!tierOverrideConfig) continue;
      return Object.assign({}, baseConfig, tierOverrideConfig);
    }

    if (hasAnyTierCollection) {
      const detectedTierHandles = handles.filter((handle) => {
        return handle.indexOf(SALE_TIER_COLLECTION_PREFIX) === 0;
      });
      console.warn(
        `[Promo] No mapped code found for tier handles (${detectedTierHandles.join(
          ", "
        )}). Falling back to base ${BASE_PROMO_COLLECTION_HANDLE} config.`
      );
    }

    return Object.assign({}, baseConfig);
  }

  async function syncCustomerState() {
    const liquidState = {
      isLoggedIn:
        typeof window.FCO_CUSTOMER_LOGGED_IN === "boolean"
          ? window.FCO_CUSTOMER_LOGGED_IN
          : Boolean(window.customerIsLoggedIn),
      orderCount: Number(window.customerOrdersCount) || 0,
    };

    const syncedState = {
      isLoggedIn: liquidState.isLoggedIn,
      orderCount: liquidState.isLoggedIn ? liquidState.orderCount : 0,
    };

    // New Customer Accounts can redirect /account off-origin and trigger noisy
    // fetch errors in wrapped/instrumented fetch implementations.
    window.customerIsLoggedIn = syncedState.isLoggedIn;
    window.customerOrdersCount = syncedState.orderCount;
    return syncedState;
  }

  function hideDefaultPrice() {
    setDefaultPriceVisibility(false);
  }

  function setDefaultPriceVisibility(shouldShow) {
    const priceBlock = document.querySelector(".product-block-price");
    if (priceBlock) {
      priceBlock.style.display = shouldShow ? "" : "none";
    }
  }

  function resetPromoRenderState() {
    document.querySelectorAll(".fco-banner").forEach((el) => el.remove());
    document.querySelectorAll(".fco-sticker-overlay").forEach((el) => el.remove());
    document
      .querySelectorAll(".fco-banner__sticker-mobile")
      .forEach((el) => el.remove());

    const priceBlock = document.querySelector(".product-block-price");
    if (priceBlock) {
      priceBlock.style.display = "";
      priceBlock.querySelectorAll(".fco-price-promo").forEach((el) => el.remove());
      const basePrice = priceBlock.querySelector("[data-product-price]");
      if (basePrice) {
        basePrice.classList.remove("fco-price-original");
      }
    }

    promoBannerMounted = false;
  }

  function schedulePromoReapply() {
    if (promoReapplyTimer) {
      window.clearTimeout(promoReapplyTimer);
    }
    promoReapplyTimer = window.setTimeout(() => {
      resetPromoRenderState();
      initDiscountDisplay();
    }, 120);
  }

  function applyPromoInlinePrice(promoText) {
    if (!promoText) return;

    waitForElement(
      ".product-block-price",
      (priceBlock) => {
        const apply = () => {
          if (priceBlock.dataset.promoPriceApplying === "true") return;
          priceBlock.dataset.promoPriceApplying = "true";

          try {
            const currentPriceEl = priceBlock.querySelector("[data-product-price]");
            if (!currentPriceEl) return;

            if (!currentPriceEl.classList.contains("fco-price-original")) {
              currentPriceEl.classList.add("fco-price-original");
            }

            let promoPriceEl = priceBlock.querySelector(".fco-price-promo");
            if (!promoPriceEl) {
              promoPriceEl = document.createElement("span");
              promoPriceEl.className = "fco-price-promo";
              currentPriceEl.insertAdjacentElement("afterend", promoPriceEl);
            }

            if (promoPriceEl.textContent !== promoText) {
              promoPriceEl.textContent = promoText;
            }
          } finally {
            priceBlock.dataset.promoPriceApplying = "false";
          }
        };

        apply();

        if (priceBlock.dataset.promoPriceObserverAttached === "true") {
          return;
        }
        priceBlock.dataset.promoPriceObserverAttached = "true";

        const observer = new MutationObserver((mutations) => {
          if (priceBlock.dataset.promoPriceApplying === "true") return;

          const hasRelevantMutation = mutations.some((mutation) => {
            const mutationTarget = mutation.target;
            if (!(mutationTarget instanceof Element || mutationTarget instanceof Text)) {
              return false;
            }

            const elementTarget =
              mutationTarget instanceof Text ? mutationTarget.parentElement : mutationTarget;
            if (!elementTarget) return false;
            if (elementTarget.closest(".fco-price-promo")) return false;

            if (
              elementTarget.matches("[data-product-price]") ||
              Boolean(elementTarget.closest("[data-product-price]"))
            ) {
              return true;
            }

            for (let i = 0; i < mutation.addedNodes.length; i++) {
              const node = mutation.addedNodes[i];
              if (!(node instanceof Element)) continue;
              if (
                node.matches("[data-product-price]") ||
                Boolean(node.querySelector("[data-product-price]"))
              ) {
                return true;
              }
            }

            return false;
          });

          if (!hasRelevantMutation) return;
          window.requestAnimationFrame(apply);
        });

        observer.observe(priceBlock, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      },
      100,
      5000
    );
  }

  function maybeForceLoggedInPromoReload(config, isLoggedIn) {
    if (!config || !isLoggedIn || !config.forceReloadForLoggedInPromo) return;

    const codePart = config.code || "promo";
    const reloadKey = `quickiesPromoReloaded:${codePart}:${window.location.pathname}`;

    try {
      if (sessionStorage.getItem(reloadKey) === "true") return;
      sessionStorage.setItem(reloadKey, "true");
    } catch (err) {
      if (window.location.search.indexOf("promo_refreshed=1") !== -1) return;
      const separator = window.location.search ? "&" : "?";
      window.location.replace(
        `${window.location.pathname}${window.location.search}${separator}promo_refreshed=1${window.location.hash || ""}`
      );
      return;
    }

    window.location.reload();
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 990px)").matches;
  }

  function placeStickerOnFeaturedImage(stickerEl) {
    if (!stickerEl) return;

    waitForElement(
      ".splide--product img.media-style",
      (imageEl) => {
        const container = imageEl.parentElement;
        if (!container) return;

        const computed = window.getComputedStyle(container);
        if (computed.position === "static") {
          container.style.position = "relative";
        }

        const existingOverlay = container.querySelector(
          ".fco-sticker-overlay"
        );
        if (existingOverlay) {
          existingOverlay.remove();
        }

        const overlay = document.createElement("div");
        overlay.className = "fco-sticker-overlay";
        overlay.style.position = "absolute";
        overlay.style.top = "calc(var(--section-vertical-spacing) / 1)";
        overlay.style.right = "12px";
        overlay.style.zIndex = "5";
        overlay.style.pointerEvents = "none";
        overlay.style.transform = "scale(1.1)";
        overlay.style.transformOrigin = "top right";

        const stickerStyles = window.getComputedStyle(stickerEl);
        ["--fco-sticker-color", "--color-scheme-background", "--color-scheme-text"].forEach(
          (prop) => {
            const value = stickerStyles.getPropertyValue(prop);
            if (value) {
              overlay.style.setProperty(prop, value.trim());
            }
          }
        );

        const stickerClone = stickerEl.cloneNode(true);
        overlay.appendChild(stickerClone);
        container.appendChild(overlay);

        stickerEl.style.display = "none";
      },
      50,
      3000
    );
  }

  function renderMobileSticker(stickerEl, banner) {
    if (!banner) return;

    const existing = banner.querySelector(":scope > .fco-banner__sticker-mobile");
    if (existing) {
      existing.remove();
    }

    const mobileContainer = document.createElement("div");
    mobileContainer.className = "fco-banner__sticker-mobile";
    const mobileSticker = stickerEl.cloneNode(true);
    mobileSticker.style.position = "absolute";
    mobileSticker.style.top = "-11%";
    mobileSticker.style.left = "0";
    mobileSticker.style.transform = "scale(1)";
    mobileSticker.style.transformOrigin = "top left";
    mobileSticker.style.width = "100px";
    mobileSticker.style.height = "100px";
    mobileSticker.style.zIndex = "1";
    mobileSticker.style.flexShrink = "0";
    mobileSticker.style.pointerEvents = "none";
    mobileContainer.appendChild(mobileSticker);
    banner.insertBefore(mobileContainer, banner.firstChild);
    stickerEl.style.display = "none";
  }

  function replaceAddToCartButtonText(newText) {
    if (!newText) return;
    waitForElement(
      ".add-to-cart-btn",
      (button) => {
        const textTargetSelector = '[x-text="addToCartText"]';
        const textNode =
          button.querySelector(textTargetSelector) ||
          button.querySelector(".push-btn-surface") ||
          button;

        const applyText = () => {
          if (!textNode) return;
          const current = (textNode.textContent || "").trim();
          if (current === newText) return;
          textNode.textContent = newText;
          button.setAttribute("aria-label", newText);
        };

        applyText();

        if (button.dataset.promoAtcObserverAttached === "true") {
          return;
        }
        button.dataset.promoAtcObserverAttached = "true";

        const observer = new MutationObserver(() => {
          if (!textNode) return;
          const current = (textNode.textContent || "").trim();
          if (current !== newText) {
            applyText();
          }
        });

        observer.observe(button, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      },
      100,
      5000
    );
  }

  function applyPromoAddToCartAttribute() {
    const setPromoAttribute = (button) => {
      if (!(button instanceof Element)) return;
      if (!button.matches(".add-to-cart-btn")) return;
      if (button.getAttribute("data-promo-five") === "true") return;
      button.setAttribute("data-promo-five", "true");
    };

    const applyAttribute = () => {
      document.querySelectorAll(".add-to-cart-btn").forEach(setPromoAttribute);
    };

    waitForElement(
      ".add-to-cart-btn",
      () => {
        applyAttribute();

        if (document.body.dataset.promoFiveObserverAttached === "true") {
          return;
        }
        document.body.dataset.promoFiveObserverAttached = "true";

        const observer = new MutationObserver((mutations) => {
          for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            for (let j = 0; j < mutation.addedNodes.length; j++) {
              const node = mutation.addedNodes[j];
              if (!(node instanceof Element)) continue;
              setPromoAttribute(node);
              node.querySelectorAll(".add-to-cart-btn").forEach(setPromoAttribute);
            }
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      },
      100,
      5000
    );
  }

  function togglePreviewMode(forceValue) {
    const nextValue =
      typeof forceValue === "boolean"
        ? forceValue
        : !Boolean(window.promoPreviewEnabled);
    window.promoPreviewEnabled = nextValue;
    window.dispatchEvent(
      new CustomEvent(PREVIEW_EVENT, {
        detail: { enabled: nextValue },
      })
    );
    console.info(
      `[Promo Preview] ${nextValue ? "Enabled" : "Disabled"} via shortcut`
    );
  }

  function handlePreviewShortcut(event) {
    const key = event.key || event.code;
    if (!key) return;
    if (!event.shiftKey || !event.altKey) return;
    if (key.toLowerCase() !== PREVIEW_SHORTCUT_KEY) return;

    const target = event.target;
    const tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
    if (["input", "textarea"].includes(tagName) || target.isContentEditable) {
      return;
    }

    event.preventDefault();
    togglePreviewMode();
  }

  function getStickerSvgDimensions() {
    const isSmallDesktop = window.matchMedia(SMALL_DESKTOP_MEDIA_QUERY).matches;
    if (isSmallDesktop) {
      return { width: 60, height: 100 };
    }
    return { width: 100, height: 120 };
  }

  function generatePromoSVG(
    priceText = "$5",
    curvedText = "EXCLUSIVE OFFER"
  ) {
    const svgDimensions = getStickerSvgDimensions();
    const svg = `
    <svg class="fco-sticker" width="${svgDimensions.width}" height="${svgDimensions.height}" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
      <defs>
        <path id="fco-arc-path" d="M2,52 A50,50 0 0,1 98,52" fill="none"/>
      </defs>

      <text class="fco-sticker__arc-text" font-size="9" fill="var(--color-scheme-text)" font-weight="bold">
        <textPath href="#fco-arc-path" startOffset="50%" text-anchor="middle">
          ${curvedText}
        </textPath>
      </text>

      <circle cx="50" cy="68" r="48" fill="var(--fco-sticker-color, #D9391F)"/>

      <text
        class="fco-sticker__price-text"
        x="50"
        y="72"
        text-anchor="middle"
        alignment-baseline="middle"
        font-size="22"
        font-weight="bold"
        fon-family="HeadingNow-96Bold"
        fill="#efe3f3"
      >
        ${priceText}
      </text>
    </svg>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = svg.trim();
    return wrapper.firstChild;
  }

  function buildAccountUrl(basePath, returnPath) {
    const currentPath =
      typeof returnPath === "string" && returnPath.length > 0
        ? returnPath
        : window.location.pathname + window.location.search;
    const returnValue = encodeURIComponent(currentPath || "/");
    const separator = basePath.indexOf("?") >= 0 ? "&" : "?";
    return `${basePath}${separator}return_to=${returnValue}&return_url=${returnValue}`;
  }

  function getStorefrontLoginBasePath() {
    if (
      typeof window.FCO_STOREFRONT_LOGIN_URL === "string" &&
      window.FCO_STOREFRONT_LOGIN_URL.trim().length > 0
    ) {
      return window.FCO_STOREFRONT_LOGIN_URL;
    }
    return "/customer_authentication/login";
  }

  function injectBannerAboveTitle({
    heading,
    ctaType,
    ctaText,
    variantId,
    includeSmallPrint = false,
    curvedText = "EXCLUSIVE OFFER",
    priceText = "$5",
    discountCode,
    promoDetailsText = "If the discount doesn’t apply automatically, use this code at checkout.",
    overrideAddToCartText = false,
    authRedirectPath,
    smallText = "",
  }) {
    waitForElement(".product-block-title", (titleEl) => {
      const banner = document.createElement("div");
      banner.className = "fco-banner";

      let ctaHTML = "";
      if (ctaType === "register") {
        const redirectPath =
          typeof authRedirectPath === "function"
            ? authRedirectPath({ heading, ctaType, variantId })
            : authRedirectPath;
        const storefrontLoginPath = getStorefrontLoginBasePath();
        const registerUrl = buildAccountUrl(
          storefrontLoginPath,
          redirectPath
        );
        ctaHTML = `<a class="fco-banner__cta fco-banner__cta--register" href="${registerUrl}">${ctaText}</a>`;
      } else if (ctaType === "addToCart" && variantId) {
        ctaHTML = `<button id="fcoAddToCartBtn" class="fco-banner__cta fco-banner__cta--add" data-promo-five="true">${ctaText}</button>`;
      }

      const smallPrintHTML = includeSmallPrint
        ? `<div class="fco-banner__smallprint"><a href="#promo-details" id="promoDetailsToggle" aria-expanded="false" aria-controls="promoDetailsPanel">Once in a lifetime promo for new customers</a></div>`
        : "";
      const smallTextHTML = smallText
        ? `<div class="fco-banner__smallprint fco-banner__smallprint--text">${smallText}</div>`
        : "";

      const promoDetailsPanel = `
        <div class="fco-banner__promo-details" id="promoDetailsPanel" aria-hidden="true">
          <p>${promoDetailsText}</p>
          <div style="margin:8px 0;">
            <code id="promoCode" style="cursor:pointer;" title="Click to copy">${discountCode}</code>
          </div>
          <p>For more info, please visit our <a href="/pages/faq" title="link to FAQ page" class="fco-banner__smallprint-link">FAQ</a>.</p>
        </div>
      `;

      banner.style.setProperty("--fco-sticker-color", STICKER_COLOR);
      banner.style.setProperty(
        "--color-scheme-background",
        TOKEN_BACKGROUND
      );
      banner.style.setProperty("--color-scheme-text", TOKEN_TEXT);

      banner.innerHTML = `
      <div class="fco-banner__wrapper">
        <div class="fco-banner__sticker" aria-hidden="true"></div>
        <div class="fco-banner__content">
          <div class="fco-banner__heading">${heading}</div>
          ${ctaHTML}
          ${smallPrintHTML}
          ${smallTextHTML}
          ${promoDetailsPanel}
        </div>
      </div>
    `;

      titleEl.parentElement.insertBefore(banner, titleEl);

      const svgWrapper = banner.querySelector(".fco-banner__sticker");
      if (svgWrapper) {
        const svgElement = generatePromoSVG(priceText, curvedText);
        svgWrapper.appendChild(svgElement);
        svgWrapper.style.setProperty("--fco-sticker-color", STICKER_COLOR);
        svgWrapper.style.setProperty(
          "--color-scheme-background",
          TOKEN_BACKGROUND
        );
        svgWrapper.style.setProperty("--color-scheme-text", TOKEN_TEXT);
        svgWrapper.style.transform = "scale(1.5)";
        svgWrapper.style.transformOrigin = "center";

        if (isMobileViewport()) {
          renderMobileSticker(svgWrapper, banner);
        } else {
          placeStickerOnFeaturedImage(svgWrapper);
        }
      }

      if (ctaType === "addToCart" && variantId) {
        document
          .getElementById("fcoAddToCartBtn")
          .addEventListener("click", () => {
            fetch("/cart/add.js", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: variantId, quantity: 1 }),
            })
              .then((res) => res.json())
              .then(() => {
                const discountURL = `/discount/${encodeURIComponent(
                  discountCode
                )}?redirect=/cart`;
                window.location.href = discountURL;
              })
              .catch((err) => {
                console.error("Add to cart failed:", err);
              });
          });
      }

      if (overrideAddToCartText && ctaType === "addToCart" && ctaText) {
        replaceAddToCartButtonText(ctaText);
      }


      const promoToggle = banner.querySelector("#promoDetailsToggle");
      const promoPanel = banner.querySelector("#promoDetailsPanel");
      if (promoToggle && promoPanel) {
        promoToggle.setAttribute("aria-expanded", "false");
        promoPanel.setAttribute("aria-hidden", "true");
        promoToggle.addEventListener("click", (e) => {
          e.preventDefault();
          const isOpen = promoPanel.classList.toggle("is-open");
          promoToggle.setAttribute("aria-expanded", String(isOpen));
          promoPanel.setAttribute("aria-hidden", String(!isOpen));
        });
      }

      const promoCodeEl = banner.querySelector("#promoCode");
      if (promoCodeEl) {
        promoCodeEl.addEventListener("click", () => {
          navigator.clipboard
            .writeText(promoCodeEl.textContent)
            .then(() => {
              promoCodeEl.textContent = "Copied!";
              setTimeout(() => {
                promoCodeEl.textContent = discountCode;
              }, 1500);
            })
            .catch((err) => {
              console.error("Failed to copy code:", err);
            });
        });
      }
    });
  }

  async function initDiscountDisplay() {
    const previewEnabled = isPreviewEnabled();

    if (!previewEnabled && !DEV_MODE) return;
    if (!previewEnabled && typeof window.currentProductCollections === "undefined")
      return;
    if (promoBannerMounted || promoInitInFlight) return;

    promoInitInFlight = true;
    try {
      const syncedState = await syncCustomerState();
      const isLoggedIn = syncedState.isLoggedIn;
      const orderCount = syncedState.orderCount;
      const collections = window.currentProductCollections || [];
      const config = resolveDiscountConfig(collections, previewEnabled);

      if (!config) return;

      applyPromoAddToCartAttribute();

      maybeForceLoggedInPromoReload(config, isLoggedIn);

      if (!isLoggedIn && config.showGuestBanner) {
        injectBannerAboveTitle({
          heading: "NEW CUSTOMERS: get your first pair for only $5",
          ctaType: "register",
          ctaText: "Buy for $5.00",
          curvedText: "EXCLUSIVE OFFER",
          priceText: "$5",
          authRedirectPath:
            config.authRedirectPath ||
            function () {
              return window.location.pathname + window.location.search;
            },
        });
      } else if (
        isLoggedIn &&
        orderCount === 0 &&
        config.showStickerForFirstOrder
      ) {
        const showPriceBlock = Boolean(config.showProductBlockPrice);
        setDefaultPriceVisibility(showPriceBlock);
        if (showPriceBlock) {
          applyPromoInlinePrice(config.promoInlinePriceText || "$5");
        }
        injectBannerAboveTitle({
          heading: "NEW CUSTOMERS: get your first pair for only $5",
          ctaType: "addToCart",
          ctaText: "Add to Cart for $5.00 (CAD)",
          variantId: config.variantId,
          includeSmallPrint: true,
          curvedText: "EXCLUSIVE OFFER",
          priceText: "$5",
          discountCode: config.code,
          promoDetailsText:
            "If the discount doesn’t apply automatically, use this code at checkout.",
          overrideAddToCartText: Boolean(config.overrideAddToCartButton),
        });
      } else if (isLoggedIn && orderCount > 0 && config.showReturningBanner) {
        injectBannerAboveTitle({
          heading: "Hmm… looks like you’ve already had a Quickie",
          ctaType: null,
          curvedText: "EXCLUSIVE OFFER",
          priceText: "$5",
          smallText:
            config.returningBannerSmallText ||
            `Offer for new customers only. For more info, please visit our <a href="/pages/faq" title="link to FAQ page" class="fco-banner__smallprint-link">FAQ</a>.`,
        });
      }

      promoBannerMounted = true;
    } finally {
      promoInitInFlight = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.addEventListener("keydown", handlePreviewShortcut);
    initDiscountDisplay();
  });

  window.addEventListener("pageshow", () => {
    schedulePromoReapply();
  });

  window.addEventListener("focus", () => {
    schedulePromoReapply();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    schedulePromoReapply();
  });

  window.addEventListener(PREVIEW_EVENT, (event) => {
    if (event.detail && typeof event.detail.enabled === "boolean") {
      schedulePromoReapply();
    }
  });
})();
