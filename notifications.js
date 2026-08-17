// notifications.js — in-app toasts (specs/phase1.md B2.12).
// Phase 1: toasts only. The Notification API + sound arrive in Phase 2 — the
// interface `notify()` is defined now but stays toast-only in Phase 1.

import { logger } from './utils.js';

let root = null;

function ensureRoot() {
  if (root) return root;
  root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, kind = 'info', durationMs = 3500) {
  const container = ensureRoot();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  container.appendChild(el);

  // Exit animation + remove
  const remove = () => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 250);
  };
  const timer = setTimeout(remove, durationMs);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return { el, close: remove };
}

// Phase 2 stub: the Notification API/audio path is out of Phase 1 scope.
export async function notify(message, _opts = {}) {
  // Interface only — Phase 1 falls back to an in-app toast.
  toast(message, 'info');
}