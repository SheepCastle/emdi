export interface PanelResizerOptions {
  resizerEl: HTMLElement;
  panelEl: HTMLElement;
  direction: 'left' | 'right';
  minWidth: number;
  maxWidth: number;
  defaultWidth?: number;
  storageKey: string;
}

interface ActiveNativeResize {
  sessionId: number;
  applyClientX: (clientX: number) => void;
  stop: (notifyNative: boolean) => void;
}

declare global {
  interface Window {
    __emdiPanelResizeMove?: (sessionId: number, clientX: number) => void;
    __emdiPanelResizeEnd?: (sessionId: number) => void;
  }
}

let activeNativeResize: ActiveNativeResize | null = null;
let nativeResizeSeq = 0;

function postMacNative(payload: Record<string, unknown>): boolean {
  const handler = window.webkit?.messageHandlers?.emdi;
  if (!handler) return false;
  handler.postMessage(payload);
  return true;
}

window.__emdiPanelResizeMove = (sessionId: number, clientX: number) => {
  if (!activeNativeResize || activeNativeResize.sessionId !== sessionId) return;
  activeNativeResize.applyClientX(clientX);
};

window.__emdiPanelResizeEnd = (sessionId: number) => {
  if (!activeNativeResize || activeNativeResize.sessionId !== sessionId) return;
  activeNativeResize.stop(false);
};

export function bindPanelResizer(options: PanelResizerOptions): void {
  const { resizerEl, panelEl, direction, minWidth, maxWidth, defaultWidth, storageKey } = options;

  let dragging = false;
  let activePointerId: number | null = null;
  let activeSessionId: number | null = null;
  let usingNativeTracking = false;
  let startX = 0;
  let startWidth = defaultWidth ?? minWidth;
  let shieldEl: HTMLDivElement | null = null;

  const persistWidth = (width: number) => {
    const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
    try {
      window.localStorage.setItem(storageKey, String(clamped));
    } catch {
      // Ignore storage errors
    }
  };

  const applyClientX = (clientX: number) => {
    const delta = direction === 'left' ? clientX - startX : startX - clientX;
    const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth + delta)));
    panelEl.style.width = `${nextWidth}px`;
  };

  const removeShield = () => {
    if (shieldEl) {
      shieldEl.remove();
      shieldEl = null;
    }
  };

  const mountShield = () => {
    removeShield();
    const el = document.createElement('div');
    el.className = 'panel-resize-shield';
    document.body.appendChild(el);
    shieldEl = el;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || usingNativeTracking) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    // Safeguard: if the primary mouse button is no longer pressed (e.g. mouseup
    // happened outside the window or over a native PDF/plugin view), end drag immediately.
    if (event.pointerType !== 'touch' && (event.buttons & 1) === 0) {
      stopDragging(true);
      return;
    }
    applyClientX(event.clientX);
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!dragging) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    stopDragging(true);
  };

  const onMouseUpFallback = () => {
    stopDragging(true);
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      stopDragging(true);
    }
  };

  const onLostPointerCapture = () => {
    stopDragging(true);
  };

  const detachActiveListeners = () => {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerEnd, true);
    window.removeEventListener('pointercancel', onPointerEnd, true);
    window.removeEventListener('mouseup', onMouseUpFallback, true);
    window.removeEventListener('blur', onMouseUpFallback);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    resizerEl.removeEventListener('lostpointercapture', onLostPointerCapture);
  };

  const stopDragging = (notifyNative = true) => {
    if (!dragging) return;
    dragging = false;

    const pointerId = activePointerId;
    activePointerId = null;

    const sessionId = activeSessionId;
    activeSessionId = null;
    const wasNative = usingNativeTracking;
    usingNativeTracking = false;

    if (activeNativeResize && activeNativeResize.sessionId === sessionId) {
      activeNativeResize = null;
    }

    if (wasNative && notifyNative && sessionId !== null) {
      postMacNative({ type: 'stopPanelResize', sessionId });
    }

    if (pointerId !== null) {
      try {
        if (resizerEl.hasPointerCapture(pointerId)) {
          resizerEl.releasePointerCapture(pointerId);
        }
      } catch {
        // Ignore if capture was already released
      }
    }

    detachActiveListeners();
    resizerEl.classList.remove('dragging');
    document.body.classList.remove('resizing-panel');
    removeShield();

    const finalWidth = Math.round(panelEl.getBoundingClientRect().width);
    if (finalWidth >= minWidth && finalWidth <= maxWidth) {
      persistWidth(finalWidth);
    }
  };

  resizerEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    if (activeNativeResize) {
      activeNativeResize.stop(true);
    }
    if (dragging) {
      stopDragging(true);
    }

    dragging = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startWidth = panelEl.getBoundingClientRect().width;

    resizerEl.classList.add('dragging');
    document.body.classList.add('resizing-panel');
    mountShield();

    const sessionId = ++nativeResizeSeq;
    const startedNative = postMacNative({ type: 'startPanelResize', sessionId });

    if (startedNative) {
      // On macOS WKWebView, AppKit's NSEvent monitor + NSEvent.pressedMouseButtons is the
      // single source of truth so PDF iframes can never steal mousemove/mouseup or leave drag stuck.
      usingNativeTracking = true;
      activeSessionId = sessionId;
      activeNativeResize = {
        sessionId,
        applyClientX,
        stop: (notifyNative) => stopDragging(notifyNative),
      };

      window.addEventListener('pointerup', onPointerEnd, true);
      window.addEventListener('pointercancel', onPointerEnd, true);
      window.addEventListener('mouseup', onMouseUpFallback, true);
      window.addEventListener('blur', onMouseUpFallback);
      document.addEventListener('visibilitychange', onVisibilityChange);
      return;
    }

    // Windows (WebView2) / standard browser fallback
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('mouseup', onMouseUpFallback, true);
    window.addEventListener('blur', onMouseUpFallback);
    document.addEventListener('visibilitychange', onVisibilityChange);
    resizerEl.addEventListener('lostpointercapture', onLostPointerCapture);

    try {
      resizerEl.setPointerCapture(event.pointerId);
    } catch {
      // Fallback to window listeners + shield if pointer capture is unavailable
    }
  });

  if (typeof defaultWidth === 'number') {
    resizerEl.addEventListener('dblclick', (event) => {
      event.preventDefault();
      stopDragging(true);
      const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(defaultWidth)));
      panelEl.style.width = `${clamped}px`;
      persistWidth(clamped);
    });
  }
}
