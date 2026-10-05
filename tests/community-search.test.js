const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EXTENSION_DIR } = require('./load-analyzer');

const SOURCE = fs.readFileSync(path.join(EXTENSION_DIR, 'community-search.js'), 'utf8');

class FakeEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
}

function fakeElement(tag, attrs = {}, extra = {}) {
  const element = {
    tagName: tag.toUpperCase(),
    type: attrs.type || '',
    value: '',
    events: [],
    clicked: 0,
    focused: false,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    getClientRects: () => (extra.hidden ? [] : [{}]),
    dispatchEvent(event) { this.events.push(event.key ? `${event.type}:${event.key}` : event.type); return true; },
    focus() { this.focused = true; },
    click() { this.clicked += 1; if (extra.onClick) extra.onClick(); }
  };
  return Object.assign(element, extra.props || {});
}

/** A page whose querySelectorAll matches by a simple selector -> elements map. */
function fakeWindow(hash, matches) {
  const replaced = [];
  const window = {
    location: { hostname: 'communityhub.sage.com', pathname: '/za/sage-300-people/', search: '', hash },
    history: { state: null, replaceState: (state, title, url) => replaced.push(url) },
    document: {
      documentElement: {},
      querySelectorAll: (selector) => matches[selector] || []
    },
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    replaced
  };
  window.window = window;
  window.globalThis = window;
  return window;
}

function run(window) {
  const context = vm.createContext(window);
  vm.runInContext(SOURCE, context);
  return context.NetAdminCommunitySearch;
}

test('community search: reads and sanitises the keywords from the fragment only', () => {
  const api = run({ console });
  assert.equal(api.readSearchText('#netadmin-search=third%20party%20logon%20string'), 'third party logon string');
  assert.equal(api.readSearchText('#netadmin-search=TOT+screen+slow+open'), 'TOT screen slow open');
  assert.equal(api.readSearchText('#netadmin-search=%3Cscript%3Ex'), 'script x');
  assert.equal(api.readSearchText('#netadmin-search=%E0%A4%A'), '');
  assert.equal(api.readSearchText('#other=1'), '');
  assert.equal(api.readSearchText(''), '');
  assert.equal(api.readSearchText(`#netadmin-search=${'a'.repeat(500)}`).length, 120);
});

test('community search: fills the product area search box, submits it and clears the fragment', () => {
  const input = fakeElement('input', { type: 'search' });
  const window = fakeWindow('#netadmin-search=TOT%20screen%20slow%20open', { 'input[type="search"]': [input] });
  run(window);
  assert.equal(input.value, 'TOT screen slow open');
  assert.equal(input.focused, true);
  assert.deepEqual(input.events, ['input', 'change', 'keydown:Enter', 'keypress:Enter', 'keyup:Enter']);
  assert.deepEqual(window.replaced, ['/za/sage-300-people/']);
});

test('community search: submits the enclosing search form when it has an action', () => {
  let submitted = 0;
  const form = { getAttribute: (name) => (name === 'action' ? '/search' : null), requestSubmit: () => { submitted += 1; } };
  const input = fakeElement('input', { type: 'text', name: 'q' }, { props: { form } });
  run(fakeWindow('#netadmin-search=leave%20balance', { 'input[name="q"]': [input] }));
  assert.equal(input.value, 'leave balance');
  assert.equal(submitted, 1);
  assert.ok(!input.events.some((event) => event.startsWith('key')));
});

test('community search: opens a hidden search box without following navigation links', () => {
  const input = fakeElement('input', { type: 'search' }, { hidden: true });
  const navigate = fakeElement('a', { href: '/search', 'aria-label': 'Search' });
  const toggle = fakeElement('button', { 'aria-label': 'Search' }, { onClick: () => { input.getClientRects = () => [{}]; } });
  const window = fakeWindow('#netadmin-search=GL%20batch%20missing', {
    'input[type="search"]': [input],
    'a[aria-label*="search" i]': [navigate],
    'button[aria-label*="search" i]': [toggle]
  });
  run(window);
  assert.equal(navigate.clicked, 0);
  assert.equal(toggle.clicked, 1);
  assert.equal(input.value, 'GL batch missing');
});

test('community search: does nothing without the extension fragment or on other hosts', () => {
  const input = fakeElement('input', { type: 'search' });
  const window = fakeWindow('', { 'input[type="search"]': [input] });
  run(window);
  assert.equal(input.value, '');
  assert.deepEqual(window.replaced, []);
  const other = fakeWindow('#netadmin-search=x', { 'input[type="search"]': [input] });
  other.location.hostname = 'example.com';
  run(other);
  assert.equal(input.value, '');
});

test('manifest: the community search script only runs on the Community Hub', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  const entry = manifest.content_scripts.find((item) => item.js.includes('community-search.js'));
  assert.deepEqual(entry.matches, ['https://communityhub.sage.com/*']);
});
