# Statement Import & Message Classifier - Implementation Guide

## Overview

This guide walks through the newly implemented features for statement import and message classification. All backend services are complete and ready to use. Frontend integration is straightforward.

---

## 🎯 What Was Just Completed

### Backend (Production Ready ✅)
1. **Message Classifier Service** - Filters SMS messages by type
2. **Statement Parser Service** - Parses XLS/PDF statements
3. **Statement Import Route** - Handles file uploads and merges
4. **Dependencies** - Added xlsx, pdf-parse, multer to package.json
5. **App Routes** - Registered /statement endpoint

### Frontend (Ready to Integrate 🔄)
1. **StatementImport Component** - Drag-drop UI for file upload
2. **Exported** - Added to components/index.ts

---

## 📋 Integration Steps

### Step 1: Verify Backend Deployment

Check that dependencies installed correctly:
```bash
cd backend
npm ls xlsx pdf-parse multer
```

Expected output:
```
├── pdf-parse@1.1.1
├── multer@1.4.5-lts.1
└── xlsx@0.18.5
```

Verify app.js has statement routes:
```bash
grep "statement" backend/src/app.js
# Should output: app.use("/statement", require("./routes/statement.routes"));
```

### Step 2: Add Message Classifier to Ingest Pipeline

**File:** `backend/src/routes/ingest.routes.js`

Find the section where transactions are parsed (around line 50-80):

**Before:**
```javascript
const transaction = await parseTransaction(rawMessage);
```

**After:**
```javascript
// Import classifier at top
const { classifyMessage } = require('../services/message-classifier.service');

// ... in route handler:
const classification = classifyMessage(rawMessage);

// Skip non-transactional messages
if (classification.type !== 'transaction') {
  console.log(`[Ingest] Skipped ${classification.type} message`, classification);
  return res.status(200).json({ 
    message: 'Message skipped (not a transaction)',
    type: classification.type,
    confidence: classification.confidence
  });
}

// Now parse transaction
const transaction = await parseTransaction(rawMessage);
```

**Optional:** Update Transaction schema to track classification:
```javascript
// In models/Transaction.js, add field:
classification_type: {
  type: String,
  enum: ['transaction', 'bill_reminder', 'promotional', 'other'],
  default: 'transaction'
},
classification_confidence: {
  type: Number,
  default: 0.95
}
```

### Step 3: Integrate StatementImport Component in Frontend

**Option A: Add to Transactions Page (Recommended)**

**File:** `frontend/src/pages/Transactions.tsx`

Add import:
```typescript
import { StatementImport } from '../components';
```

Add component in JSX (after transaction list):
```typescript
<div className="mt-8 mb-8">
  <h3 className="text-lg font-semibold mb-4">Import from Bank Statement</h3>
  <StatementImport 
    accountId={selectedAccountId} 
    onSuccess={() => {
      // Refresh transaction list
      fetchTransactions();
    }} 
  />
</div>
```

**Option B: Add to Modal/Dialog**

Create a new modal:
```typescript
// In TopBar.tsx or Transactions.tsx
import { StatementImport } from '../components';
import { Upload } from 'lucide-react';

// Add button:
<button onClick={() => setShowImportModal(true)}>
  <Upload className="w-5 h-5" />
  Import Statement
</button>

// Add modal:
{showImportModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
    <div className="bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md w-full m-4">
      <h2 className="text-xl font-bold mb-4">Import Bank Statement</h2>
      <StatementImport 
        accountId={selectedAccountId}
        onSuccess={() => {
          setShowImportModal(false);
          fetchTransactions();
        }}
      />
    </div>
  </div>
)}
```

### Step 4: Test the Integration

**Test 1: Statement Upload (XLS)**

Prepare test file:
- Create Excel file with 10-20 transactions
- Include columns: Date, Description, Debit, Credit, Balance
- Save as `test_statement.xlsx`

Test via API:
```bash
curl -X POST http://localhost:5000/statement/import \
  -H "x-api-key: ios_secret_key_123" \
  -F "file=@test_statement.xlsx" \
  -F "accountId=YOUR_ACCOUNT_ID"
```

**Test 2: Frontend Upload**

1. Start backend: `npm start` (from backend folder)
2. Start frontend: `npm run dev` (from frontend folder)
3. Navigate to Transactions page
4. Find "Import from Bank Statement" section
5. Drag & drop XLS/PDF file or click to browse
6. Verify transactions appear in list
7. Check balance updated correctly

**Test 3: Balance Reconciliation**

1. Note account's opening balance
2. Upload statement with different opening balance
3. Should see warning: "Opening balance mismatch detected"
4. Closing balance should update to statement's closing balance

**Test 4: Message Classification**

Make test API call:
```bash
curl -X POST http://localhost:5000/ingest \
  -H "Content-Type: application/json" \
  -H "x-api-key: ios_secret_key_123" \
  -d '{
    "messages": [
      "Your account has been debited by INR 500 on 15-Jan-2025",
      "EMI of INR 5000 is due today",
      "Get 50% off on your next purchase"
    ]
  }'
```

Expected: Only first message parsed as transaction

---

## 🔍 Implementation Details

### Message Classifier Keywords

**Transaction Keywords (Confidence: 0.95)**
- debited, credited, sent, received
- upi, atm, withdrawal, deposit
- payment, transfer, transaction
- debit, credit, spent, received

**Bill Keywords (Confidence: 0.90)**
- bill due, emi due, loan payment
- insurance premium, subscription renewal
- interest charges, service charges
- payment reminder, payment due

**Promotional Keywords (Confidence: 0.85)**
- offer, discount, cashback, reward
- limited time, exclusive, claim now
- click here, download app, sign up
- verify account, confirm identity (phishing)

**Unknown (Confidence: 0.50)**
- Anything not matching above patterns

### Statement Parser - File Routing

**XLS/XLSX Parsing:**
1. Load file with XLSX library
2. Parse first sheet
3. Match columns by header name
4. Extract transactions
5. Return structured data

**PDF Parsing:**
1. Extract text with pdf-parse
2. Send to Gemini 1.5 Flash
3. Gemini extracts JSON structure
4. Parse transactions from response
5. Return structured data

### Balance Reconciliation Logic

```javascript
// In statement import route:
1. Parse statement → get opening_balance, closing_balance
2. Fetch account from DB → get current_balance
3. Compare: if (opening_balance != current_balance)
   → Log warning: "Opening balance mismatch"
4. Delete transactions in statement date range
5. Insert new transactions
6. Update account.current_balance = statement.closing_balance
7. Return summary with counts & mismatch flag
```

---

## 🧪 Testing Scenarios

### Scenario 1: Fresh Account Import
- Account has 0 transactions
- Upload statement with 50 transactions
- Expected: 50 new transactions, balance updated

### Scenario 2: Overlap/Merge
- Account has transactions for Jan 1-15
- Upload statement for Jan 10-31
- Expected: Jan 1-9 kept, Jan 10-31 replaced (delete & recreate)

### Scenario 3: Balance Mismatch
- Account balance: ₹100,000
- Statement opening: ₹95,000
- Expected: Warning in response, but import continues

### Scenario 4: Invalid File
- Upload .txt file as statement
- Expected: Error "Invalid file type"

### Scenario 5: File Too Large
- Upload 15MB file
- Expected: Error "File size exceeds 10MB limit"

### Scenario 6: Corrupted PDF
- Upload PDF with no readable text
- Expected: Error from Gemini or empty result

---

## 📊 API Responses

### Successful Import
```json
{
  "status": "success",
  "message": "Statement imported successfully",
  "summary": {
    "deleted": 15,
    "imported": 50,
    "openingBalance": 100000,
    "closingBalance": 95000,
    "balanceMismatch": false,
    "dateRange": {
      "start": "2025-01-01",
      "end": "2025-01-31"
    }
  }
}
```

### Error Response
```json
{
  "status": "error",
  "message": "Invalid file type. Please upload XLS, XLSX, or PDF files only."
}
```

### Classification Response
```json
{
  "status": "success",
  "parsed": 1,
  "skipped": 2,
  "classifications": {
    "transaction": 1,
    "bill_reminder": 1,
    "promotional": 1,
    "unknown": 0
  }
}
```

---

## 🚀 Deployment Checklist

Before going to production:

- [ ] Backend dependencies installed (`npm install`)
- [ ] App.js has statement routes registered
- [ ] Message classifier integrated in ingest route
- [ ] Frontend StatementImport component added to page
- [ ] Test statement file uploaded successfully
- [ ] Balance reconciliation verified
- [ ] Error handling tested
- [ ] File size limits enforced
- [ ] Gemini API key verified for PDF parsing
- [ ] Multer upload directory writable

---

## 📞 Troubleshooting

### Issue: "Cannot find module 'xlsx'"
**Solution:** Run `npm install` in backend folder
```bash
cd backend && npm install
```

### Issue: PDF upload returns "signal is aborted"
**Solution:** Check Gemini API key is set
```bash
grep GEMINI_API_KEY .env
```

### Issue: Transactions not appearing after import
**Solution:** Check database connection and date range
```bash
# Verify MongoDB running
# Check if date range matches statement dates
```

### Issue: "File size exceeds 10MB limit" error
**Solution:** Statement file is too large. Split into multiple files or check file format.

### Issue: Component not found error
**Solution:** Ensure StatementImport exported from index.ts
```bash
grep StatementImport frontend/src/components/index.ts
```

---

## 📝 File Reference

### Backend Files
- **Message Classifier:** `/backend/src/services/message-classifier.service.js`
- **Statement Parser:** `/backend/src/services/statement-parser.service.js`
- **Statement Routes:** `/backend/src/routes/statement.routes.js`
- **App Config:** `/backend/src/app.js` (updated)
- **Package Config:** `/backend/package.json` (updated)

### Frontend Files
- **StatementImport:** `/frontend/src/components/StatementImport.tsx`
- **Components Index:** `/frontend/src/components/index.ts` (updated)

---

## 🎓 Code Examples

### Using Classifier in Custom Code
```javascript
const { classifyMessage, getClassificationStats } = 
  require('./services/message-classifier.service');

// Classify single message
const result = classifyMessage("Debited INR 500");
console.log(result); 
// { type: 'transaction', confidence: 0.95, shouldParse: true }

// Get stats for multiple messages
const messages = [/* ... */];
const stats = getClassificationStats(messages);
console.log(stats);
// { transactions: 45, bills: 5, promotional: 3, unknown: 2, total: 55 }
```

### Using Parser in Custom Code
```javascript
const { parseStatementFile } = 
  require('./services/statement-parser.service');

const result = await parseStatementFile('statement.xlsx', 'xlsx');
console.log(result);
// {
//   format: 'xlsx',
//   transactions: [{ date, description, amount, reference, balance }],
//   openingBalance: 50000,
//   closingBalance: 48500,
//   startDate: Date,
//   endDate: Date,
//   count: 15
// }
```

---

## ✅ Success Criteria

You'll know everything is working when:

1. ✅ Statement file uploads without error
2. ✅ Transactions appear in transaction list
3. ✅ Account balance matches statement closing balance
4. ✅ Date range filtered transactions are replaced
5. ✅ Non-transactional SMS messages are classified/skipped
6. ✅ Error messages display correctly in UI
7. ✅ Loading spinner shows during upload
8. ✅ Success message shows import summary

---

**Next Steps:** Follow the Integration Steps above to complete the setup!
