# Tally user manual

## Set up
1. Open Tally. Choose a **profile name** and a **passphrase** (12+ characters; four unrelated words work well). Everything is encrypted with a key made from it.
2. Add your first account and its **opening balance** (what it held before your first transaction).
3. Import a statement, add transactions by hand, or fill with sample data to look around.

## Daily use
* **Today** shows the month in one sentence, a coloured strip of where it went (tap a segment to see those transactions), balances, budgets, insights and a 60-day outlook.
* **Money**: search, filter, select many rows to recategorise or delete, tap a row to edit, split, attach a receipt. **Move between accounts** records a transfer (not counted as income or spending).
* **Ask bar** (top): "How much did I spend on groceries last month?", "income this year", "top categories in March", "what is my balance". It runs on your device.
* **Ctrl/Cmd+K** opens quick actions. **Ctrl+Shift+L** locks instantly.

## Importing a statement
1. Import → choose the account → choose a PDF, CSV, OFX or QIF file.
2. Review. Each row shows a confidence. Rows already saved or that look like duplicates are unticked. Change a category and Tally remembers that merchant.
3. The **statement check** says whether opening balance + rows = closing balance. If it is off, look at flagged rows.
4. Save. Tally then offers to check the books against the statement.
Scanned (image-only) PDFs and Excel files are not read; export CSV from your bank or save the sheet as CSV.

## Checking against the bank
Check → pick a saved statement (or type the balances from paper). If balanced you can download an HTML audit report (print it to PDF). If not, Tally lists likely causes: a missing transaction, a duplicate, a sign error, or an opening-balance mismatch.

## Backup and restore
Safe → **Save encrypted backup** gives a `.tally` file. Keep copies somewhere safe (USB, another device). To restore, choose **Restore a backup** on the first screen and unlock with the passphrase that file was made with.

## Forgotten passphrase
**There is no recovery.** That is what keeps your data private. If you have a backup, restore it and use its passphrase. Otherwise you can erase the profile and start again. We recommend writing the passphrase down and storing it somewhere physically safe.

## Privacy
Nothing leaves your device. No analytics, no accounts, no cloud. You can check: open browser developer tools → Network, and use the app; after the first load the list stays empty.
