// Where images go (#523): Preferences › Editor › Images names the one folder for images of a
// project, and says where it is. What the app does with the folder (the project's, the link from
// the document's folder) is the Rust's, which its own tests hold (`image_files.rs`); this is how the
// setting looks and what it refuses.

import { expect, test } from '../src/journey.ts';
import { shotName, writeShot } from '../src/shots.ts';

test.describe('the folder for images @views', () => {
  test('the Images row is one folder’s name, and says where the folder is', async ({ start }) => {
    const j = await start({ doc: 'Hello\n', tracking: false });
    const { page } = j;
    await page.goto('/preferences.html');
    await page.emulateMedia({ colorScheme: j.options.scheme });
    const shot = (name: string) => writeShot(page, j.info, shotName(name, j.options));
    await page.getByRole('tab', { name: 'Editor' }).click();
    const row = page.locator('[data-row="Images"]');
    await expect(row).toBeVisible();
    // No choice of place, only the name.
    await expect(row.locator('select')).toHaveCount(0);
    const name = row.getByLabel('Folder name');
    await expect(name).toHaveValue('images');
    await expect(row.locator('[role="status"]')).toContainText(
      'in the project’s folder, the one the sidebar shows',
    );
    await row.scrollIntoViewIfNeeded();
    await shot('image-folder-row');
    // A name that a folder in the project can't have is said so, and not saved.
    await name.fill('a/b');
    await expect(row.locator('[role="status"]')).toHaveText(
      'A folder’s name has no slash and doesn’t start with a dot.',
    );
    await shot('image-folder-refused');
    await name.fill('Bilder');
    await expect(row.locator('[role="status"]')).toContainText('“Bilder” in the project’s folder');
    await name.blur();
    await shot('image-folder-renamed');
  });
});
