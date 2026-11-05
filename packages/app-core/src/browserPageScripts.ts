const MAX_CONSOLE_ENTRIES = 200;
const MAX_NETWORK_ENTRIES = 200;
const MAX_ENTRY_TEXT_LENGTH = 2_000;
export const MAX_INTERACTIVE_ELEMENTS = 200;
export const MAX_INTERACTIVE_ELEMENT_NAME_LENGTH = 120;
export const MAX_VISIBLE_TEXT_LENGTH = 20_000;

export const BROWSER_HOST_INIT_SCRIPT = `(() => {
  if (globalThis.__t3Host) return;
  const consoleEntries = [];
  const networkEntries = [];
  const now = () => new Date().toISOString();
  const clip = (value) => String(value).slice(0, ${MAX_ENTRY_TEXT_LENGTH});
  const push = (list, entry, limit) => {
    list.push(entry);
    if (list.length > limit) list.splice(0, list.length - limit);
  };
  const format = (args) => args.map((arg) => {
    if (typeof arg === "string") return arg;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }).join(" ");
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level];
    console[level] = function (...args) {
      push(consoleEntries, { level, text: clip(format(args)), timestamp: now() }, ${MAX_CONSOLE_ENTRIES});
      return original.apply(this, args);
    };
  }
  addEventListener("error", (event) => {
    push(consoleEntries, {
      level: "error",
      text: clip(event.message || "Uncaught error"),
      timestamp: now(),
      source: event.filename || undefined,
    }, ${MAX_CONSOLE_ENTRIES});
  });
  addEventListener("unhandledrejection", (event) => {
    push(consoleEntries, {
      level: "error",
      text: clip("Unhandled rejection: " + format([event.reason])),
      timestamp: now(),
    }, ${MAX_CONSOLE_ENTRIES});
  });
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || String(input);
      const method = (init && init.method) || (input && input.method) || "GET";
      const timestamp = now();
      return originalFetch.apply(this, arguments).then((response) => {
        push(networkEntries, { url: clip(new URL(url, location.href).href), method, status: response.status, failed: !response.ok && response.status >= 400, timestamp }, ${MAX_NETWORK_ENTRIES});
        return response;
      }, (error) => {
        push(networkEntries, { url: clip(new URL(url, location.href).href), method, status: null, failed: true, errorText: clip(error), timestamp }, ${MAX_NETWORK_ENTRIES});
        throw error;
      });
    };
  }
  const OriginalXhr = globalThis.XMLHttpRequest;
  if (typeof OriginalXhr === "function") {
    const open = OriginalXhr.prototype.open;
    const send = OriginalXhr.prototype.send;
    OriginalXhr.prototype.open = function (method, url) {
      this.__t3Request = { method: String(method).toUpperCase(), url: String(url) };
      return open.apply(this, arguments);
    };
    OriginalXhr.prototype.send = function () {
      const request = this.__t3Request;
      if (request) {
        const timestamp = now();
        this.addEventListener("loadend", () => {
          const status = this.status || null;
          push(networkEntries, { url: clip(new URL(request.url, location.href).href), method: request.method, status, failed: status === null || status >= 400, timestamp }, ${MAX_NETWORK_ENTRIES});
        });
      }
      return send.apply(this, arguments);
    };
  }
  const post = (message) => {
    try { globalThis.ipc && globalThis.ipc.postMessage(JSON.stringify(message)); } catch {}
  };
  let lastFavicon = null;
  const captureFavicon = () => {
    const links = Array.from(document.querySelectorAll("link[rel~='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']"));
    const href = links.length > 0 ? links[0].href : new URL("/favicon.ico", location.href).href;
    if (!href || href === lastFavicon) return;
    lastFavicon = href;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 32, 32);
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl.length <= 8192) post({ type: "favicon", dataUrl, pageUrl: location.href });
      } catch {}
    };
    image.src = href;
  };
  const watchFavicon = () => {
    captureFavicon();
    new MutationObserver(captureFavicon).observe(document.head || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "rel"] });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", watchFavicon, { once: true });
  else watchFavicon();

  let overlay = null;
  const overlayRoot = () => {
    if (overlay && overlay.host.isConnected) return overlay;
    const host = document.createElement("t3-agent-overlay");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = '<style>.cursor{position:fixed;left:0;top:0;transition:opacity 150ms ease-out,transform 150ms ease-out;will-change:transform}.ping{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:9999px;animation:ping 1s cubic-bezier(0,0,.2,1) infinite}@keyframes ping{75%,100%{transform:scale(2);opacity:0}}.zoom{position:fixed;top:12px;right:12px;border-radius:9999px;padding:4px 10px;font:500 12px/16px system-ui,-apple-system,sans-serif;transition:opacity 200ms ease-out,transform 200ms ease-out;box-shadow:0 4px 6px -1px rgb(0 0 0/.1),0 2px 4px -2px rgb(0 0 0/.1)}</style><div class="cursor" style="opacity:0"><span class="ping" hidden></span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:relative;transform:translate(-2px,-2px);filter:drop-shadow(0 1px 1px rgb(0 0 0/.15))"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg></div><div class="zoom" style="opacity:0;transform:translateY(-4px)"></div>';
    (document.body || document.documentElement).appendChild(host);
    overlay = { host, root, cursorTimer: 0, zoomTimer: 0 };
    return overlay;
  };
  const theme = () => globalThis.__t3HostTheme || { primary: "#2563eb", background: "#ffffff", popover: "#ffffff", foreground: "#0a0a0a", border: "#e5e5e5" };
  globalThis.__t3Host = {
    consoleEntries,
    networkEntries,
    cursor(x, y, phase) {
      const { root } = overlayRoot();
      const colors = theme();
      const zoom = globalThis.__t3HostZoom || 1;
      const cursor = root.querySelector(".cursor");
      const svg = cursor.querySelector("svg");
      const ping = cursor.querySelector(".ping");
      svg.setAttribute("stroke", colors.primary);
      svg.setAttribute("fill", colors.background);
      ping.style.background = colors.primary + "40";
      ping.hidden = phase !== "click";
      cursor.style.transform = "translate3d(" + x + "px," + y + "px,0) scale(" + (1 / zoom) + ")";
      cursor.style.transformOrigin = "0 0";
      cursor.style.opacity = "1";
      clearTimeout(overlay.cursorTimer);
      overlay.cursorTimer = setTimeout(() => { cursor.style.opacity = "0.55"; }, 700);
    },
    hideCursor() {
      if (!overlay) return;
      overlay.root.querySelector(".cursor").style.opacity = "0";
    },
    zoomIndicator(percent) {
      const { root } = overlayRoot();
      const colors = theme();
      const zoom = globalThis.__t3HostZoom || 1;
      const pill = root.querySelector(".zoom");
      pill.textContent = percent;
      pill.style.background = colors.popover;
      pill.style.color = colors.foreground;
      pill.style.border = "1px solid " + colors.border;
      pill.style.transformOrigin = "100% 0";
      pill.style.transform = "scale(" + (1 / zoom) + ")";
      pill.style.opacity = "1";
      clearTimeout(overlay.zoomTimer);
      overlay.zoomTimer = setTimeout(() => {
        pill.style.opacity = "0";
        pill.style.transform = "translateY(-4px) scale(" + (1 / zoom) + ")";
      }, 1500);
    },
  };
})();`;

const json = (value: unknown): string => JSON.stringify(value) ?? "null";

export function clickDispatchScript(x: number, y: number): string {
  return `(() => {
    const x = ${json(x)};
    const y = ${json(y)};
    const target = document.elementFromPoint(x, y) || document.body;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, view: window };
    target.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true, buttons: 1 }));
    const downAccepted = target.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1, detail: 1 }));
    if (downAccepted && typeof target.focus === "function") target.focus({ preventScroll: true });
    target.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0, detail: 1 }));
    if (typeof target.click === "function") target.click();
    else target.dispatchEvent(new MouseEvent("click", { ...base, detail: 1 }));
    return null;
  })()`;
}

export function keyDispatchScript(input: {
  readonly key: string;
  readonly code: string;
  readonly text: string;
  readonly keyCode: number;
  readonly modifiers: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift">;
}): string {
  return `(() => {
    const target = document.activeElement || document.body;
    const modifiers = ${json(input.modifiers)};
    const init = { key: ${json(input.key)}, code: ${json(input.code)}, keyCode: ${json(input.keyCode)}, which: ${json(input.keyCode)}, bubbles: true, cancelable: true, composed: true, altKey: modifiers.includes("Alt"), ctrlKey: modifiers.includes("Control"), metaKey: modifiers.includes("Meta"), shiftKey: modifiers.includes("Shift") };
    const accepted = target.dispatchEvent(new KeyboardEvent("keydown", init));
    const text = ${json(input.text)};
    if (accepted) {
      if (text === "\\r") {
        if (target instanceof HTMLTextAreaElement || target.isContentEditable) document.execCommand("insertLineBreak");
        else if (target.form && typeof target.form.requestSubmit === "function") target.form.requestSubmit();
        else if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) target.click();
      } else if (text.length > 0) {
        target.dispatchEvent(new KeyboardEvent("keypress", init));
        document.execCommand("insertText", false, text);
      } else if (init.key === "Backspace") {
        document.execCommand("delete", false);
      } else if (init.key === "Delete") {
        document.execCommand("forwardDelete", false);
      } else if (init.key === "Tab") {
        const focusable = Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])")).filter((element) => !element.disabled);
        const index = focusable.indexOf(target);
        const next = focusable[(index + (init.shiftKey ? -1 : 1) + focusable.length) % focusable.length];
        if (next) next.focus();
      }
    }
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    return null;
  })()`;
}

const locatorQuery = (locatorJson: string, strict: boolean): string =>
  `(() => { const injected = globalThis.__t3PlaywrightInjected; return injected.querySelector(injected.parseSelector(${locatorJson}), document, ${strict}); })()`;

export const playwrightInstalledProbe = "Boolean(globalThis.__t3PlaywrightInjected)";

export const pageInfoScript = `(() => {
  const selectorFor = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    for (const attribute of ["data-testid", "name"]) {
      const value = element.getAttribute(attribute);
      if (value) return element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
    }
    const buildParts = (current, parts = []) => {
      if (!current || current.nodeType !== Node.ELEMENT_NODE || parts.length >= 8) {
        return parts;
      }
      const parent = current.parentElement;
      const siblings = parent
        ? Array.from(parent.children).filter((child) => child.tagName === current.tagName)
        : [];
      const base = current.tagName.toLowerCase();
      const part = siblings.length > 1
        ? base + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
        : base;
      return buildParts(parent, [part, ...parts]);
    };
    return buildParts(element).join(" > ");
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const elements = Array.from(document.querySelectorAll(
    "a[href],button,input,textarea,select,[role],[tabindex]"
  )).filter(visible).slice(0, ${MAX_INTERACTIVE_ELEMENTS}).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: (element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || "").slice(0, ${MAX_INTERACTIVE_ELEMENT_NAME_LENGTH}),
      selector: selectorFor(element),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  });
  const host = globalThis.__t3Host;
  let accessibilityTree = null;
  try {
    const injected = globalThis.__t3PlaywrightInjected;
    if (injected && typeof injected.ariaSnapshot === "function") {
      accessibilityTree = injected.ariaSnapshot(document.body, { mode: "expect" });
    }
  } catch {}
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== "complete",
    visibleText: (document.body?.innerText || "").slice(0, ${MAX_VISIBLE_TEXT_LENGTH}),
    interactiveElements: elements,
    accessibilityTree,
    consoleEntries: host ? host.consoleEntries.slice() : [],
    networkEntries: host ? host.networkEntries.slice() : [],
    viewport: { width: innerWidth, height: innerHeight }
  };
})()`;

export function clickPointScript(locator: string): string {
  return `(() => {
    try {
      const injected = globalThis.__t3PlaywrightInjected;
      const parsed = injected.parseSelector(${json(locator)});
      const element = injected.querySelector(parsed, document, true);
      if (!element) return { notFound: true };
      const visible = injected.elementState(element, "visible");
      const enabled = injected.elementState(element, "enabled");
      if (!visible.matches || !enabled.matches) return { notFound: true };
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    } catch (error) {
      return { invalidSelector: true, message: String(error) };
    }
  })()`;
}

export const viewportSizeScript = "({ width: window.innerWidth, height: window.innerHeight })";

export function cursorScript(x: number, y: number, phase: "move" | "click"): string {
  return `(globalThis.__t3Host && globalThis.__t3Host.cursor(${json(x)}, ${json(y)}, ${json(phase)}), null)`;
}

export function zoomIndicatorScript(zoomFactor: number): string {
  return `(globalThis.__t3HostZoom = ${json(zoomFactor)}, globalThis.__t3Host && globalThis.__t3Host.zoomIndicator(${json(`${Math.round(zoomFactor * 100)}%`)}), null)`;
}

export function typeScript(input: {
  readonly locator: string | null;
  readonly text: string;
  readonly clear: boolean;
}): string {
  return `(() => {
    try {
      const element = ${input.locator ? locatorQuery(json(input.locator), true) : "document.activeElement"};
      if (!element) return { notFound: true };
      const textControl =
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement &&
          !new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]).has(element.type));
      const editable = textControl || element.isContentEditable;
      if (!editable || element.disabled || element.readOnly) return { notEditable: true };
      element.focus();
      if (document.activeElement !== element) return { notEditable: true };
      const clear = ${json(input.clear)};
      if (clear) {
        if (textControl) {
          element.select();
        } else {
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = document.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
      const text = ${json(input.text)};
      let inserted = true;
      if (text.length > 0) {
        inserted = document.execCommand("insertText", false, text);
      } else if (clear) {
        document.execCommand("delete", false);
        const cleared = textControl
          ? element.value.length === 0
          : (element.textContent ?? "").length === 0;
        if (!cleared) {
          if (textControl) {
            const prototype = element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            if (valueSetter) valueSetter.call(element, "");
            else element.value = "";
          } else {
            element.replaceChildren();
          }
          element.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentBackward",
          }));
        }
      }
      if (!inserted) return { notEditable: true };
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    } catch (error) {
      return { invalidSelector: true, message: String(error) };
    }
  })()`;
}

export function scrollScript(input: {
  readonly locator: string | null;
  readonly deltaX: number;
  readonly deltaY: number;
}): string {
  return `(() => {
    try {
      const target = ${input.locator ? locatorQuery(json(input.locator), true) : "window"};
      if (!target) return { notFound: true };
      target.scrollBy({ left: ${json(input.deltaX)}, top: ${json(input.deltaY)}, behavior: "instant" });
      return { ok: true };
    } catch (error) {
      return { invalidSelector: true, message: String(error) };
    }
  })()`;
}

export function waitForScript(input: {
  readonly locator: string | null;
  readonly text: string | null;
  readonly urlIncludes: string | null;
}): string {
  return `(() => {
    try {
      const selectorMatched = ${input.locator ? `${locatorQuery(json(input.locator), false)} !== null` : "true"};
      const textMatched = ${input.text ? `(document.body?.innerText || "").includes(${json(input.text)})` : "true"};
      const urlMatched = ${input.urlIncludes ? `location.href.includes(${json(input.urlIncludes)})` : "true"};
      return { matched: selectorMatched && textMatched && urlMatched };
    } catch (error) {
      return { invalidSelector: true, message: String(error) };
    }
  })()`;
}

export function userExpressionScript(expression: string, awaitPromise: boolean): string {
  return awaitPromise ? `(async () => await (${expression}))()` : `(${expression})`;
}

export const documentReadyStateScript = "document.readyState";
