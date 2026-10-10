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

describe('UI smoke: onboarding → every screen → add transaction → lock → wrong/right passphrase', () => {
  it('works end to end', async () => {
    const u = userEvent.setup(); render(<App />);
    await screen.findByText('Make a private notebook', {}, { timeout: 8000 });
    await u.type(screen.getByLabelText('Passphrase'), 'short'); await u.type(screen.getByLabelText('Type it again'), 'short'); await u.click(screen.getByRole('button', { name: 'Create notebook' }));
    expect((await screen.findAllByRole('alert')).some((a) => /at least 12/.test(a.textContent ?? ''))).toBe(true);
    const pass = 'lantern-orbit-ferry-77'; await u.clear(screen.getByLabelText('Passphrase')); await u.type(screen.getByLabelText('Passphrase'), pass); await u.clear(screen.getByLabelText('Type it again')); await u.type(screen.getByLabelText('Type it again'), pass);
    await u.click(screen.getByRole('button', { name: 'Create notebook' }));
    await screen.findByText('Add your first account', {}, { timeout: 20000 });
    await u.click(screen.getByRole('button', { name: 'Fill with sample data' }));
    const h = await screen.findByRole('heading', { level: 1 }, { timeout: 8000 }); expect(h.textContent).toMatch(/You spent .*₦/);
    expect(screen.getByRole('img', { name: /Groceries|Rent/ })).toBeTruthy(); // dye bar has an accessible description
    for (const name of ['Money', 'Import', 'Check', 'Plan', 'Safe']) {
      await u.click(within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getByRole('button', { name: new RegExp(`^${name}`) }));
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0));
    }
    await u.click(within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getByRole('button', { name: /^Money/ }));
    await u.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Add a transaction' });
    await u.type(within(dlg).getByLabelText('Amount (₦)'), '2500'); await u.type(within(dlg).getByLabelText('Description'), 'UI test lunch CHICKEN REPUBLIC'); await u.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a transaction' })).toBeNull()); await screen.findByText('UI test lunch CHICKEN REPUBLIC');
    // natural-language bar
    await u.type(screen.getByLabelText('Ask about your money'), 'what is my balance{enter}'); await screen.findByText(/total balance/i);
    // lock via hotkey, wrong then right passphrase
    await u.keyboard('{Control>}{Shift>}L{/Shift}{/Control}');
    await screen.findByText(/Enter your passphrase/, {}, { timeout: 8000 });
    await u.type(screen.getByLabelText('Passphrase'), 'definitely wrong pass'); await u.click(screen.getByRole('button', { name: 'Unlock' })); await screen.findByText(/Wrong passphrase/, {}, { timeout: 15000 });
    await u.clear(screen.getByLabelText('Passphrase')); await u.type(screen.getByLabelText('Passphrase'), pass); await u.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('heading', { level: 1 }, { timeout: 15000 });
    await u.click(within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getByRole('button', { name: /^Money/ })); await screen.findByText('UI test lunch CHICKEN REPUBLIC'); // data persisted through encrypted save
    cleanup();
  }, 120000);
});
