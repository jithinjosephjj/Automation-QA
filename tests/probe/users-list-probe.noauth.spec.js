const { test } = require('../../fixtures/test-fixtures');

// PROBE (read-only): does the Users list on qa hold the given login names? Used
// after a CreateUser 504 (the gateway times out at 30 s while the backend may
// still save). Prints every matching row.
//   LOGINS=Sioniquser52,Sioniquser51 npx playwright test tests/probe/users-list-probe.noauth.spec.js --project=no-auth --reporter=line
test('PROBE users list', async ({ loginPage, userPage, page }) => {
  test.setTimeout(300_000);
  const logins = (process.env.LOGINS || 'Sioniquser52').split(',').map((s) => s.trim()).filter(Boolean);
  await loginPage.ensureLoggedIn({ bu: 'Kakkanad' });
  const hits = {};
  for (const login of logins) {
    const listed = page.waitForResponse((r) => /User\/GetAll\w*Pagination/i.test(r.url()) && (r.request().postData() || '').includes(login), { timeout: 30_000 }).catch(() => null);
    const res = await page.request.post(`${process.env.SIONIQ_URL || 'https://qa.sioniq.com'}/sioniq/User/GetAllUserPagination`, { data: { pageNumber: 1, recordsPerPage: 20, filters: [], sort: [], searchValue: login } }).catch(() => null);
    let rows = [];
    if (res && res.ok()) {
      const body = await res.json().catch(() => null);
      rows = ((body && body.data) || []).map((u) => `${u.loginName} | ${u.name} | ${u.mobileNumber} | active ${u.active} | ${String(u.createdDate || '').slice(0, 19)}`);
    } else {
      // the API needs the app's auth headers - fall back to the Users page search box
      await userPage.open().catch(() => {});
      const search = page.getByRole('textbox', { name: /Search/i }).locator('visible=true').first();
      await search.fill(login);
      await search.press('Enter');
      await listed;
      await page.waitForTimeout(3_000);
      rows = (await page.locator('table tbody tr').locator('visible=true').allInnerTexts().catch(() => [])).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.includes(login));
    }
    hits[login] = rows;
    console.log(`=== ${login}: ${rows.length} row(s) ${JSON.stringify(rows)}`);
  }
  console.log('HITS ' + JSON.stringify(hits));
});
