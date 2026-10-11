# Tally user manual

## Set up
Open Tally and add your first account and its **opening balance** (what it held before your first transaction). Then import a statement, add transactions by hand, or fill with sample data to look around. There is no sign-in and no passphrase.

## Daily use
* **Today** shows the month in one sentence, a thin ribbon of where it went (click a label to see those transactions), balances, budgets, insights and a 60-day outlook.
* **Money**: search, filter, select many rows to recategorise or delete, click a row to edit, split, or attach a receipt. **Move between accounts** records a transfer (not counted as income or spending).
* **Ask bar** (top): "How much did I spend on groceries last month?", "income this year", "top categories in March", "what is my balance". It runs on your device.

## Importing a statement
1. Import → choose the account → choose a PDF, CSV, OFX or QIF file.
2. Review. Each row shows a confidence. Rows already saved or that look like duplicates are unticked. Change a category and Tally remembers that merchant.
3. The **statement check** says whether opening balance + rows = closing balance. If it is off, look at flagged rows.
4. Save. Tally then offers to check the books against the statement.
Scanned (image-only) PDFs and Excel files are not read; export CSV from your bank or save the sheet as CSV.

## Checking against the bank
Check → pick a saved statement (or type the balances from paper). If balanced you can download an HTML audit report (print it to PDF). If not, Tally lists likely causes: a missing transaction, a duplicate, a sign error, or an opening-balance mismatch.

## Backup and restore
Settings → **Save backup** gives a `.tally` file (a plain database file; it is **not** password-protected). Keep copies somewhere private. To restore, use **Restore from backup** in Settings, or on the first screen of a fresh browser.

## Your data and privacy
Everything stays in this browser on this device. Nothing is sent anywhere: no analytics, no accounts, no cloud. You can check: open browser developer tools → Network and use the app; after the first load the list stays empty. Because there is no passphrase, anyone who can open this browser profile can see your data. Use your device's own lock screen and, on shared computers, a separate browser profile. **Settings → Erase all data** removes everything.
