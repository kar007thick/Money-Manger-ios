# Statement Parser - Ready to Test 🧪

## Quick Start Test

### 1. Restart Backend with Logging

```bash
cd backend
npm start
# Leave this running and watch console output
```

### 2. Test with Your HDFC Statement

In a new terminal:

```bash
curl -v -X POST "http://localhost:3000/statement/import" \
  -H "x-api-key: ios_secret_key_123" \
  -F "file=@/Users/indran/Downloads/Acct Statement_1988_25042026_08.27.15.xls" \
  -F "account_id=6962b4c48a96617537d2da38"
```

### 3. Watch Backend Logs

You should see:
```
[STATEMENT-EXCEL] Reading file: ...
[STATEMENT] Found header row at index 15 with 5 matches
[STATEMENT-EXCEL] Account Info: { bank: 'HDFC', accountNumber: '5xxx...x8', ... }
[STATEMENT-EXCEL] Extracted 23 transactions
[STATEMENT-ROUTE] Parsed 23 transactions
[STATEMENT-ROUTE] Opening balance: ₹15810
[STATEMENT-ROUTE] Closing balance: ₹12345
[STATEMENT-ROUTE] Deleted 0 existing transactions
[STATEMENT-ROUTE] Inserted 23 new transactions
```

### 4. Check Response

Should return:
```json
{
  "status": "success",
  "message": "Statement imported successfully",
  "summary": {
    "deleted": 0,
    "imported": 23,
    "openingBalance": 15810,
    "closingBalance": 12345,
    "balanceMismatch": false,
    "dateRange": {
      "start": "2026-03-01",
      "end": "2026-03-31"
    }
  }
}
```

---

## What to Check

### ✅ Parser Logs
- [ ] "Found header row" - Check row number matches transaction table
- [ ] "Account Info" - Verify bank name, account number detected
- [ ] "Extracted X transactions" - Check count is reasonable

### ✅ API Response
- [ ] Status is "success"
- [ ] Count of imported matches actual transactions in statement
- [ ] Opening/closing balances match statement
- [ ] Date range is correct

### ✅ Database
- [ ] Count `db.transactions.find({source: 'statement_import'}).count()`
- [ ] Should match imported count
- [ ] Verify balance_after values match statement

---

## If It Fails

### Error: "Could not find transaction table"
**Cause:** Header row not found
**Check:**
- Open the XLS file in Excel
- Find the row with: Date | Narration | Withdrawal | Deposit | Balance
- Count rows from top
- Should be within first 50 rows

**Fix:** Add more keywords to `findHeaderRow()` function

### Error: "No transactions found"
**Cause:** Transaction parsing failed
**Check:**
- Backend logs should show which rows were skipped
- Verify column headers match keywords
- Check date format is DD/MM/YYYY

**Fix:** Add logging to `parseTransactionRow()` to debug

### Error: "Could not auto-detect account"
**Cause:** Account number not found
**Check:**
- Open statement, find "Account No: 5xxxxxxxxx8"
- Verify this account exists in your DB
- Try providing account_id manually

**Fix:** Add account to DB or provide account_id

---

## Testing Checklist

- [ ] Backend starts without errors
- [ ] Curl command returns 200 status
- [ ] Response has "success" status
- [ ] Transaction count > 0
- [ ] Opening/closing balances populated
- [ ] Date range correct
- [ ] Backend logs show successful parsing
- [ ] Database has new transactions
- [ ] Account balance updated

---

## Next: Test from Frontend

Once API works:

1. Navigate to http://localhost:5173/transactions
2. Find "Import from Bank Statement" section
3. Drag & drop or upload the XLS file
4. Should see loading spinner
5. Should see success message with summary
6. Transaction list should refresh
7. New transactions should appear

---

## Debug Mode

Add more logging:

```javascript
// In backend/src/services/statement-parser.service.js
console.log('[DEBUG] Row data:', row);
console.log('[DEBUG] Parsed transaction:', txn);
```

Then run test again and check backend logs for detailed output.

---

**Ready to test! Run the curl command above and check the logs. 🚀**
