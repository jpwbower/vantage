import { test, expect } from '@playwright/test';

test('runner handed off a live server without needing a browser', async ({ request, baseURL }) => {
  const response = await request.get(baseURL);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe('child-bound fixture');
});
