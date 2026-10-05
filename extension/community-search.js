/**
 * NetAdmin Assistant - Community Hub search pre-fill.
 *
 * The side panel opens a Sage Community Hub product area (for example
 * https://communityhub.sage.com/za/sage-300-people/) with the issue keywords
 * in the URL fragment: #netadmin-search=<keywords>. This script, which only
 * runs on communityhub.sage.com, puts those keywords in the page's own search
 * box and submits it, so the search starts inside that product area. Nothing
 * is read from the page or sent anywhere; the fragment is removed afterwards.
 */
(function (root) {
  'use strict';

  const HASH_KEY = 'netadmin-search';
  const MAX_LENGTH = 120;
  const WAIT_MS = 10000;

  const INPUT_SELECTORS = [
    'input[type="search"]',
    'input[name="q"]',
    'input[placeholder*="search" i]',
    'input[aria-label*="search" i]',
    'input[id*="search" i]',
    'input[class*="search" i]'
  ];
  // Controls that only reveal a hidden search box. Links that navigate away
  // (for example to the site-wide /search page) are never clicked, because
  // that would leave the product area.
  const TOGGLE_SELECTORS = [
    'button[aria-label*="search" i]',
    'button[class*="search" i]',
    '[role="button"][aria-label*="search" i]',
    'a[aria-label*="search" i]',
    'a[class*="search" i]',
    'li[class*="search" i] > a',
    'div[class*="search" i] > a'
  ];

  /** The keywords carried in the fragment, or '' when there are none. */
  function readSearchText(hash) {
    const match = /(?:^#|&)netadmin-search=([^&]*)/.exec(String(hash || ''));
    if (!match) return '';
    let value = '';
    try {
      value = decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch (error) {
      return '';
    }
    return value.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
  }

  function isVisible(element) {
    if (!element || element.disabled || element.readOnly) return false;
    if (typeof element.getClientRects === 'function' && !element.getClientRects().length) return false;
    return true;
  }

  function findInput(doc) {
    for (const selector of INPUT_SELECTORS) {
      const found = Array.from(doc.querySelectorAll(selector))
        .find((element) => !/^(?:hidden|password|checkbox|radio|submit|button)$/i.test(element.type || '') && isVisible(element));
      if (found) return found;
    }
    return null;
  }

  function isSafeToggle(element) {
    if (!element) return false;
    if (String(element.tagName || '').toLowerCase() !== 'a') return true;
    const href = (element.getAttribute && element.getAttribute('href')) || '';
    return !href || href === '#' || /^javascript:/i.test(href);
  }

  function openSearchBox(doc) {
    for (const selector of TOGGLE_SELECTORS) {
      const toggle = Array.from(doc.querySelectorAll(selector)).find((element) => isSafeToggle(element) && isVisible(element));
      if (toggle) {
        toggle.click();
        return true;
      }
    }
    return false;
  }

  function fire(element, type, view) {
    const EventType = (view && view.Event) || root.Event;
    if (typeof EventType === 'function') element.dispatchEvent(new EventType(type, { bubbles: true }));
  }

  function pressEnter(element, view) {
    const KeyboardEventType = (view && view.KeyboardEvent) || root.KeyboardEvent;
    if (typeof KeyboardEventType !== 'function') return;
    for (const type of ['keydown', 'keypress', 'keyup']) {
      element.dispatchEvent(new KeyboardEventType(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }
  }

  /** Put the keywords in the search box and submit; true when a box was found. */
  function fillSearch(doc, value, view) {
    const input = findInput(doc);
    if (!input) return false;
    input.focus();
    input.value = value;
    fire(input, 'input', view);
    fire(input, 'change', view);
    const form = input.form;
    if (form && form.getAttribute && form.getAttribute('action') && typeof form.requestSubmit === 'function') form.requestSubmit();
    else pressEnter(input, view);
    return true;
  }

  /** Remove the fragment so a reload or a shared link does not search again. */
  function clearHash(view) {
    const loc = view.location;
    if (view.history && typeof view.history.replaceState === 'function') {
      view.history.replaceState(view.history.state, '', `${loc.pathname}${loc.search}`);
    }
  }

  function start(view) {
    const value = readSearchText(view.location && view.location.hash);
    if (!value) return false;
    clearHash(view);
    const doc = view.document;
    if (fillSearch(doc, value, view)) return true;
    const observer = typeof view.MutationObserver === 'function'
      ? new view.MutationObserver(() => {
        if (fillSearch(doc, value, view)) observer.disconnect();
      })
      : null;
    if (observer) observer.observe(doc.documentElement || doc.body, { childList: true, subtree: true, attributes: true });
    if (openSearchBox(doc) && fillSearch(doc, value, view) && observer) observer.disconnect();
    if (observer && typeof view.setTimeout === 'function') view.setTimeout(() => observer.disconnect(), WAIT_MS);
    return true;
  }

  root.NetAdminCommunitySearch = Object.freeze({ HASH_KEY, readSearchText, findInput, fillSearch, start });

  if (root.document && root.location && /(?:^|\.)communityhub\.sage\.com$/.test(root.location.hostname || '')) {
    start(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
