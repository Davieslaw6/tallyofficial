// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { webcrypto } from 'node:crypto';
vi.stubGlobal('crypto', webcrypto);
vi.mock('../src/ui/styles.css', () => ({}));
Object.defineProperty(window, 'matchMedia', { value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }), configurable: true });
Element.prototype.scrollIntoView = () => {};
const { default: App } = await import('../src/ui/App');
const nav = (name: string) => within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: new RegExp(`^${name}`) });

describe('UI smoke: opens without a passphrase → setup → every screen → add transaction → reload keeps data', () => {
  it('works end to end', async () => {
    const u = userEvent.setup(); render(<App />);
    await screen.findByText('Add your first account', {}, { timeout: 8000 });
    expect(document.body.textContent).not.toMatch(/passphrase|unlock/i); // no lock screen anywhere
    await u.click(screen.getByRole('button', { name: 'Fill with sample data' }));
    const h = await screen.findByRole('heading', { level: 1 }, { timeout: 8000 }); expect(h.textContent).toMatch(/You spent .*₦/);
    expect(screen.getByRole('img', { name: /Groceries|Rent/ })).toBeTruthy();
    const t = screen.getByTestId('spent-today').textContent!; const m = /Today you.ve spent ₦([\d,]+\.\d{2}) across (\d+) transactions/.exec(t); expect(m).not.toBeNull();
    expect(Number(m![1].replace(/,/g, ''))).toBeGreaterThanOrEqual(6050); expect(Number(m![2])).toBeGreaterThanOrEqual(2); // at least the two purchases dated today in the sample (₦4,200 + ₦1,850)
    for (const name of ['Money', 'Import', 'Check', 'Plan', 'Settings', 'Today']) {
      await u.click(nav(name)); await waitFor(() => expect(document.querySelector('main')!.textContent!.length).toBeGreaterThan(20));
      expect(document.querySelector('kbd')).toBeNull(); expect(document.body.textContent).not.toMatch(/Ctrl|⌘|passphrase|Lock now/i); // no visible shortcuts, no lock
    }
    await u.click(nav('Money')); await u.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Add a transaction' });
    await u.type(within(dlg).getByLabelText('Amount (₦)'), '2500'); await u.type(within(dlg).getByLabelText('Description'), 'UI test lunch CHICKEN REPUBLIC'); await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a transaction' })).toBeNull()); await screen.findByText('UI test lunch CHICKEN REPUBLIC');
    await u.type(screen.getByLabelText('Ask about your money'), 'what is my balance{enter}'); await screen.findByText(/total balance/i);
    await new Promise((r) => setTimeout(r, 700)); // let the debounced save land
    cleanup(); render(<App />); // simulate closing and reopening the page
    await screen.findByRole('heading', { level: 1 }, { timeout: 8000 }); await u.click(nav('Money')); await screen.findByText('UI test lunch CHICKEN REPUBLIC');
    cleanup();
  }, 60000);
});
