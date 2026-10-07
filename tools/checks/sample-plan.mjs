// A new user starts with an empty plan (roadmap B3). Tools that need the sample apartment load it the way a user does,
// with 載入範例公寓 on the empty plan, and then reload with only the saved plan in storage: a returning user with the
// sample. The replacement backup and the notice are gone, so the page looks as it did when the sample was the first plan.
export const PLAN_KEY = 'open-plan:document:v1';

/** Clears storage, loads the sample through the UI, and reloads. `extra` entries are added to storage before the reload. Returns the saved sample. */
export async function openSample(page, extra = []) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-empty-plan]').getByRole('button', { name: '載入範例公寓' }).click();
  await page.waitForFunction(k => JSON.parse(localStorage.getItem(k) || '{}').walls?.length > 0, PLAN_KEY);
  const plan = await page.evaluate(k => localStorage.getItem(k), PLAN_KEY);
  await page.evaluate(([entries]) => { localStorage.clear(); for (const [k, v] of entries) localStorage.setItem(k, v); }, [[[PLAN_KEY, plan], ...extra]]);
  await page.reload();
  await page.waitForSelector('svg.plan-svg');
  return JSON.parse(plan);
}
