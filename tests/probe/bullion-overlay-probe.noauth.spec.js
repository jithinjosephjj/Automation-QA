const { test } = require('../../fixtures/test-fixtures');

/**
 * READ-ONLY probe (saves nothing): why do the Bullion Booking selects time
 * out on click (TC-BBI-01 on 28-09, TC-BBI-02 on 26-09)? Opens the booking
 * form 3 times and samples, every 250 ms for 40 s, whether the
 * .ngx-spinner-overlay is visible, which API calls are in flight, and what
 * element sits on top of the Booking Type select (the click target).
 */
test('probe bullion booking overlay', async ({ loginPage, bullionBooking, page }) => {
  test.setTimeout(420_000);
  await loginPage.ensureLoggedIn({ bu: 'Cochin' });
  const inflight = new Map();
  page.on('request', (r) => { if (/\/api\/|sioniq/i.test(r.url()) && r.resourceType() !== 'image') inflight.set(r, Date.now()); });
  const done = (r) => {
    const t = inflight.get(r);
    if (t !== undefined) {
      const ms = Date.now() - t;
      if (ms > 3_000) console.log(`  SLOW ${ms} ms ${r.method()} ${r.url().split('/').slice(-2).join('/')}`);
      inflight.delete(r);
    }
  };
  page.on('requestfinished', done);
  page.on('requestfailed', (r) => { console.log(`  FAILED ${r.method()} ${r.url().split('/').slice(-2).join('/')} ${r.failure() && r.failure().errorText}`); done(r); });

  for (let round = 1; round <= 3; round++) {
    await bullionBooking.goto('/prc/app-bullion-list');
    const t0 = Date.now();
    await bullionBooking.waitForIdle();
    await bullionBooking.addBtn.click({ timeout: 60_000 });
    const sel = page.locator('sioniq-ng-select[controlname="bookingType"] ng-select .ng-select-container').first();
    await sel.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    let overlayMs = 0; let lastTop = ''; const topSeen = new Set();
    for (let i = 0; i < 160; i++) {
      const s = await page.evaluate(() => {
        const ov = [...document.querySelectorAll('.ngx-spinner-overlay')].filter((n) => n.offsetParent || getComputedStyle(n).display !== 'none');
        const host = document.querySelector('sioniq-ng-select[controlname="bookingType"] ng-select .ng-select-container');
        let top = '';
        if (host) {
          const r = host.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          top = el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}` : '(none)';
        }
        return { overlays: ov.length, spinnerNames: ov.map((n) => n.closest('ngx-spinner')?.getAttribute('name') || '?'), top };
      });
      if (s.overlays) overlayMs += 250;
      topSeen.add(s.top);
      if (s.top !== lastTop) { console.log(`  round ${round} t=${Date.now() - t0} ms: top element over Booking Type = ${s.top}; overlays ${s.overlays} ${JSON.stringify(s.spinnerNames)}; in flight ${[...inflight.keys()].map((r) => r.url().split('/').pop().slice(0, 40)).join(', ') || '-'}`); lastTop = s.top; }
      await page.waitForTimeout(250);
    }
    console.log(`ROUND ${round}: overlay visible ~${overlayMs} ms of 40 s; elements seen on top of the select: ${JSON.stringify([...topSeen])}`);
    await page.screenshot({ path: `test-results/probe-bullion-overlay-${round}.png`, fullPage: true });
  }
});
