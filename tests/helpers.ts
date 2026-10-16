import { createEmptyDb } from '../src/core/db';
import { Repo } from '../src/core/repo';
export async function freshRepo() {
  const db = await createEmptyDb(); const repo = new Repo(db);
  const acct = repo.addAccount('GTBank Current', 'checking', 0, '2026-01-01');
  return { db, repo, acct };
}
export const FAST_KDF = { m: 8192, t: 2, p: 1 };
