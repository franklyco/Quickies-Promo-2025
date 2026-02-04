(function () {
  const DEV_MODE = true;
  const PREVIEW_EVENT = "promoPreviewToggle";

  const DISCOUNT_MAP = {
    fivepromo: {
      code: "Quickies-FIVEPROMO",
      label: "Quickies-FIVEPROMO: $20 off at checkout",
      variantId: window.fiveFingerVariantId,
      showGuestBanner: true,
      showStickerForFirstOrder: true,
      showReturningBanner: true,
    },
  };

  let promoBannerMounted = false;

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

  function hideDefaultPrice() {
    const priceBlock = document.querySelector(".product-block-price");
    if (priceBlock) {
      priceBlock.style.display = "none";
    }
  }

  function generatePromoSVG(
    priceText = "$5",
    curvedText = "LIMITED TIME ONLY"
  ) {
    const svg = `
    <svg class="fco-sticker" width="100" height="120" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
      <defs>
        <path id="fco-arc-path" d="M2,52 A50,50 0 0,1 98,52" fill="none"/>
      </defs>

      <text class="fco-sticker__arc-text" font-size="9" fill="#000" font-weight="bold" font-family="sans-serif">
        <textPath href="#fco-arc-path" startOffset="50%" text-anchor="middle">
          ${curvedText}
        </textPath>
      </text>

      <circle cx="50" cy="68" r="48" fill="#FF6347" stroke="#000" stroke-width="1"/>

      <text
        class="fco-sticker__price-text"
        x="50"
        y="68"
        text-anchor="middle"
        alignment-baseline="middle"
        font-size="22"
        font-weight="bold"
        fill="#000"
        font-family="sans-serif"
      >
        ${priceText}
      </text>
    </svg>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = svg.trim();
    return wrapper.firstChild;
  }

  function buildAccountUrl(basePath) {
    const currentPath = window.location.pathname + window.location.search;
    const returnValue = encodeURIComponent(currentPath || "/");
    const separator = basePath.indexOf("?") >= 0 ? "&" : "?";
    return `${basePath}${separator}return_url=${returnValue}`;
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
  }) {
    waitForElement(".product-block-title", (titleEl) => {
      const banner = document.createElement("div");
      banner.className = "fco-banner";

      let ctaHTML = "";
      if (ctaType === "register") {
        const registerUrl = buildAccountUrl("/account/register");
        ctaHTML = `<a class="fco-banner__cta fco-banner__cta--register" href="${registerUrl}">${ctaText}</a>`;
      } else if (ctaType === "addToCart" && variantId) {
        ctaHTML = `<button id="fcoAddToCartBtn" class="fco-banner__cta fco-banner__cta--add">${ctaText}</button>`;
      }

      const smallPrintHTML = includeSmallPrint
        ? `<div class="fco-banner__smallprint"><a href="#promo-details" id="promoDetailsToggle">Once in a lifetime promo for new customers</a></div>`
        : "";

      const promoDetailsPanel = `
        <div class="fco-banner__promo-details" id="promoDetailsPanel" style="display:none; margin-top:10px;">
          <p>${promoDetailsText}</p>
          <div style="margin:8px 0;">
            <code id="promoCode" style="cursor:pointer;" title="Click to copy">${discountCode}</code>
          </div>
        </div>
      `;

      banner.innerHTML = `
      <div class="fco-banner__wrapper">
        <div class="fco-banner__sticker" aria-hidden="true"></div>
        <div class="fco-banner__content">
          <div class="fco-banner__heading">${heading}</div>
          ${ctaHTML}
          ${smallPrintHTML}
          ${promoDetailsPanel}
        </div>
      </div>
    `;

      titleEl.parentElement.insertBefore(banner, titleEl);

      const svgWrapper = banner.querySelector(".fco-banner__sticker");
      if (svgWrapper) {
        const svgElement = generatePromoSVG(priceText, curvedText);
        svgWrapper.appendChild(svgElement);
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

      const targetStickerContainer = document.querySelector(
        ".product-media .row-start-1.col-span-full"
      );
      if (targetStickerContainer && svgWrapper) {
        targetStickerContainer.appendChild(svgWrapper);
      }

      const promoToggle = banner.querySelector("#promoDetailsToggle");
      const promoPanel = banner.querySelector("#promoDetailsPanel");
      if (promoToggle && promoPanel) {
        promoToggle.addEventListener("click", (e) => {
          e.preventDefault();
          promoPanel.style.display =
            promoPanel.style.display === "none" ? "block" : "none";
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

  function initDiscountDisplay() {
    const previewEnabled = isPreviewEnabled();

    if (!previewEnabled && !DEV_MODE) return;
    if (!previewEnabled && typeof window.currentProductCollections === "undefined")
      return;
    if (promoBannerMounted) return;

    const isLoggedIn = window.customerIsLoggedIn;
    const orderCount = window.customerOrdersCount || 0;
    const collections = window.currentProductCollections || [];
    let config = null;

    for (let i = 0; i < collections.length; i++) {
      const handle = collections[i].handle;
      if (DISCOUNT_MAP[handle]) {
        config = DISCOUNT_MAP[handle];
        break;
      }
    }

    if (!config && previewEnabled) {
      const fallbackHandle = Object.keys(DISCOUNT_MAP)[0];
      config = fallbackHandle ? DISCOUNT_MAP[fallbackHandle] : null;
    }

    if (!config) return;

    if (!isLoggedIn && config.showGuestBanner) {
      injectBannerAboveTitle({
        heading: "NEW CUSTOMERS: get your first pair for only $5",
        ctaType: "register",
        ctaText: "BUY FOR $5",
        curvedText: "EXCLUSIVE OFFER",
        priceText: "$5",
      });
    } else if (
      isLoggedIn &&
      orderCount === 0 &&
      config.showStickerForFirstOrder
    ) {
      hideDefaultPrice();
      injectBannerAboveTitle({
        heading: "YOU'RE IN! SNAG THE DEAL.",
        ctaType: "addToCart",
        ctaText: "GIMME MY QUICKIE",
        variantId: config.variantId,
        includeSmallPrint: true,
        curvedText: "LIMITED TIME ONLY",
        priceText: "$5",
        discountCode: config.code,
        promoDetailsText:
          "If the discount doesn’t apply automatically, use this code at checkout.",
      });
    } else if (isLoggedIn && orderCount > 0 && config.showReturningBanner) {
      injectBannerAboveTitle({
        heading: "Hmm, seems we've already met.",
        ctaType: null,
        curvedText: "THANK YOU ❤️",
        priceText: "",
      });
    }

    promoBannerMounted = true;
  }

  document.addEventListener("DOMContentLoaded", initDiscountDisplay);

  window.addEventListener(PREVIEW_EVENT, (event) => {
    if (event.detail && event.detail.enabled) {
      initDiscountDisplay();
    }
  });
})();
