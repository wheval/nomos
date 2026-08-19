/**
 * Nomos embeddable checkout widget.
 *
 * Drop this on any page:
 *   <script src="https://<nomos-host>/widget.js"
 *           data-nomos-to="0x..."
 *           data-nomos-amount="25"
 *           data-nomos-note="Order #123"
 *           data-nomos-label="Pay with Nomos"></script>
 *
 * Renders a button in place of the script tag. Clicking it opens the Nomos
 * checkout (/pay) in a modal iframe - the merchant's page never touches a
 * viewing key, a wallet, or STRK20 directly; that all stays inside the
 * iframe, same trust boundary as embedding Stripe or Paystack's checkout.
 */
(function () {
  "use strict";

  var thisScript = document.currentScript;
  if (!thisScript) return; // script must be a plain <script src=...>, not injected async

  var origin = new URL(thisScript.src, window.location.href).origin;
  var data = thisScript.dataset || {};

  if (!data.nomosTo) {
    console.error("[nomos widget] missing data-nomos-to (the recipient address) - widget not rendered.");
    return;
  }

  var STYLE_ID = "nomos-widget-style";
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".nomos-widget-btn{font-family:-apple-system,system-ui,sans-serif;font-weight:600;font-size:15px;" +
      "color:#fff;background:#e56b43;border:none;border-radius:12px;padding:13px 22px;cursor:pointer;}" +
      ".nomos-widget-btn:hover{filter:brightness(1.06);}" +
      ".nomos-widget-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;" +
      "justify-content:center;padding:20px;background:rgba(13,14,14,.45);}" +
      ".nomos-widget-frame{width:min(480px,100%);height:min(720px,90vh);border:none;border-radius:20px;" +
      "background:#fff;box-shadow:0 24px 70px -20px rgba(13,14,14,.5);}" +
      ".nomos-widget-close{position:fixed;width:32px;height:32px;border-radius:50%;border:none;" +
      "background:#fff;color:#0d0e0e;font-size:16px;cursor:pointer;box-shadow:0 4px 14px rgba(13,14,14,.25);}";
    document.head.appendChild(style);
  }

  function buildPayUrl() {
    var url = new URL("/pay", origin);
    url.searchParams.set("to", data.nomosTo);
    if (data.nomosAmount) url.searchParams.set("amount", data.nomosAmount);
    if (data.nomosNote) url.searchParams.set("note", data.nomosNote);
    if (data.nomosRef) url.searchParams.set("ref", data.nomosRef);
    if (data.nomosExp) url.searchParams.set("exp", data.nomosExp);
    return url.toString();
  }

  function openModal() {
    var overlay = document.createElement("div");
    overlay.className = "nomos-widget-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    var frame = document.createElement("iframe");
    frame.className = "nomos-widget-frame";
    frame.src = buildPayUrl();
    frame.title = "Nomos checkout";

    var close = document.createElement("button");
    close.className = "nomos-widget-close";
    close.setAttribute("aria-label", "Close checkout");
    close.textContent = "×";
    close.style.top = "calc(50% - min(360px, 45vh) - 44px)";
    close.style.left = "calc(50% + min(240px, 50vw) - 32px)";

    function closeModal() {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    }
    function onKey(e) {
      if (e.key === "Escape") closeModal();
    }

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    close.addEventListener("click", closeModal);
    document.addEventListener("keydown", onKey);

    overlay.appendChild(frame);
    overlay.appendChild(close);
    document.body.appendChild(overlay);
  }

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nomos-widget-btn";
  btn.textContent = data.nomosLabel || "Pay with Nomos";
  btn.addEventListener("click", openModal);

  thisScript.insertAdjacentElement("afterend", btn);
})();
