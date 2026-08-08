type DeferredMessage = {
  readonly socket: WebSocket;
  readonly listener: EventListenerOrEventListenerObject;
  readonly event: Event;
};

const deferredMessages = new Map<
  EventListenerOrEventListenerObject,
  DeferredMessage
>();

const isInteractiveControl = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLSelectElement ||
  element instanceof HTMLTextAreaElement;

const isUserEditing = (): boolean => isInteractiveControl(document.activeElement);

const invokeListener = (
  listener: EventListenerOrEventListenerObject,
  socket: WebSocket,
  event: Event,
): void => {
  if (typeof listener === 'function') listener.call(socket, event);
  else listener.handleEvent(event);
};

const flushDeferredMessages = (): void => {
  if (isUserEditing() || deferredMessages.size === 0) return;
  const pending = [...deferredMessages.values()];
  deferredMessages.clear();
  for (const item of pending) {
    invokeListener(item.listener, item.socket, item.event);
  }
};

const originalAddEventListener = WebSocket.prototype.addEventListener as (
  this: WebSocket,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) => void;

WebSocket.prototype.addEventListener = function (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
): void {
  if (type !== 'message' || listener === null) {
    originalAddEventListener.call(this, type, listener, options);
    return;
  }

  const socket = this;
  const guardedListener: EventListener = (event) => {
    if (isUserEditing()) {
      // Coalesce high-frequency snapshots while a native input/select is active.
      // Keeping only the newest message prevents unbounded queue growth and avoids
      // replacing the live form control underneath the user's pointer/keyboard.
      deferredMessages.set(listener, { socket, listener, event });
      return;
    }
    invokeListener(listener, socket, event);
  };
  originalAddEventListener.call(this, type, guardedListener, options);
};

document.addEventListener(
  'focusout',
  () => {
    window.setTimeout(flushDeferredMessages, 0);
  },
  true,
);

window.addEventListener('blur', flushDeferredMessages);
