/**
 * Statement Parser Service
 * Parses bank statements (XLS/PDF) and extracts transactions
 * Supports HDFC, SBI, ICICI, AXIS, KOTAK formats
 * Uses rule-based name parsing with minimal AI fallback
 */

const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const { parseTransactionName } = require('./transaction-name-parser.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const extractDate = (dateStr) => {
  if (!dateStr) return null;

  // Handle Excel serial date numbers deterministically.
  if (typeof dateStr === 'number' && Number.isFinite(dateStr)) {
    const serial = Math.floor(dateStr);
    // Typical modern Excel date serial range.
    if (serial > 20000 && serial < 80000) {
      const parsed = XLSX.SSF.parse_date_code(serial);
      if (parsed && parsed.y && parsed.m && parsed.d) {
        const date = new Date(parsed.y, parsed.m - 1, parsed.d);
        date.setHours(0, 0, 0, 0);
        return date;
      }
    }
  }

  const str = String(dateStr).trim();
  if (!str) return null;

  const dateToken =
    str.match(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/)?.[1] ||
    str.match(/\b(\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2})\b/)?.[1];

  if (!dateToken) return null;

  let day;
  let month;
  let year;

  let m = dateToken.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
  if (m) {
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  } else {
    m = dateToken.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
    if (!m) return null;
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  }

  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  // Strict validation to avoid JS auto-normalization surprises.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
};

const extractAmount = (value) => {
  if (!value && value !== 0) return 0;
  
  if (typeof value === 'number') return Math.abs(value);
  if (typeof value !== 'string') return 0;

  // Remove currency symbols and commas
  const cleaned = String(value).replace(/[₹$£€,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return !isNaN(num) ? Math.abs(num) : 0;
};

const toDateOnly = (value) => {
  const date = value instanceof Date ? value : extractDate(value);
  if (!date) return null;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const detectBank = (headerText) => {
  const text = headerText.toLowerCase();
  if (text.includes('hdfc')) return 'HDFC';
  if (text.includes('sbi')) return 'SBI';
  if (text.includes('icici')) return 'ICICI';
  if (text.includes('axis')) return 'AXIS';
  if (text.includes('kotak')) return 'KOTAK';
  if (text.includes('bank')) return 'Bank';
  return 'Unknown';
};

const GENERIC_PARTS = new Set([
  'UPI', 'IMPS', 'NEFT', 'RTGS', 'ACH', 'BIL', 'INFT', 'PAYMENT', 'FROM', 'PHONE',
  'DEBIT', 'CREDIT', 'FOR', 'TO', 'INT', 'PD', 'SELF', 'SAVINGS', 'BANK', 'TRANSFER',
  'REQUEST', 'MANDATE', 'STOCKS', 'STOCKSIP', 'BRK', 'VALIDICICI', 'VALIDHDFC'
]);

const detectTransactionKind = (narration, accountInfo = {}) => {
  const text = String(narration || '').toUpperCase();
  const normalizedHolder = String(accountInfo.accountHolder || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  const accountNumber = String(accountInfo.accountNumber || '').replace(/\D/g, '');

  if (/INT\.?PD|INTEREST\s+PAID|INTEREST/i.test(text)) return 'interest';
  if (/UPI/i.test(text) && /ELE-|DELE-|LIMITE|CIRCLE/i.test(text)) return 'upi_circle';
  if (normalizedHolder && text.includes(normalizedHolder)) return 'self_transfer';
  if (accountNumber && accountNumber.length >= 4 && text.includes(accountNumber.slice(-4))) return 'self_transfer';
  if (/IMPS|NEFT|RTGS|INFT|TRANSFER/i.test(text)) return 'bank_transfer';
  if (/UPI/i.test(text)) return 'upi';
  if (/SAL-/.test(text) || /SALARY/.test(text)) return 'salary';
  return 'general';
};

const extractCounterpartyName = (narration, accountInfo = {}) => {
  const text = String(narration || '').trim();
  if (!text) return null;

  const upper = text.toUpperCase();
  const accountHolder = String(accountInfo.accountHolder || '').toUpperCase().trim();
  const accountNumber = String(accountInfo.accountNumber || '').replace(/\D/g, '');

  // Interest credit rows.
  if (/INT\.?PD|INTEREST\s+PAID/i.test(text)) {
    return 'Bank Interest';
  }

  // IMPS-<id>-<name>-ICIC-xxxxx format.
  let m = upper.match(/IMPS-[^-]+-([A-Z\s\.]+?)-[A-Z]{3,5}-/);
  if (m && m[1]) return m[1].trim();

  // ACH salary patterns.
  m = upper.match(/SAL-([A-Z0-9&\s\.]{3,})-/);
  if (m && m[1]) return m[1].trim();

  // UPI-<name>-<rest> pattern with spaces.
  m = upper.match(/^UPI-([A-Z0-9&\s\.]{3,}?)-[A-Z0-9@\.]+/);
  if (m && m[1]) return m[1].trim();

  // Slash-separated UPI where a proper name appears in segments.
  if (upper.includes('UPI/')) {
    const parts = upper.split('/').map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (p.includes('@')) continue; // handle
      if (/^\d+$/.test(p)) continue;
      if (p.length < 3) continue;
      if (GENERIC_PARTS.has(p)) continue;
      if (/^[A-Z0-9]{12,}$/.test(p)) continue; // long ids
      if (/^[A-Z]+[0-9]+$/.test(p)) continue; // mixed ids
      return p;
    }
  }

  // Hyphen-separated fallback.
  const dashParts = upper.split('-').map(p => p.trim()).filter(Boolean);
  for (const p of dashParts) {
    if (p.length < 3) continue;
    if (GENERIC_PARTS.has(p)) continue;
    if (/^[A-Z0-9]{10,}$/.test(p)) continue;
    if (/^[A-Z]{2,5}\d+/.test(p)) continue;
    if (p.includes('@')) continue;
    return p;
  }

  // Self transfer detection.
  if (accountHolder && upper.includes(accountHolder)) {
    return 'Self Transfer';
  }
  if (accountNumber && upper.includes(accountNumber.slice(-4))) {
    return 'Self Transfer';
  }

  return null;
};

const extractTransactionMetadata = async (narration, accountInfo = {}, options = {}) => {
  const kind = detectTransactionKind(narration, accountInfo);
  
  // Use new rule-based name parser
  const nameResult = await parseTransactionName(narration, accountInfo, {
    useAI: options.useAI !== false,
    debug: options.debug === true
  });

  return {
    counterpartyName: nameResult.name || extractCounterpartyName(narration, accountInfo),
    kind,
    isSelfTransfer: kind === 'self_transfer',
    nameParseSource: nameResult.source,
    nameNeedsReview: nameResult.needsReview
  };
};

const inferTransactionTypeFromContext = (description, amount, balance, prevBalance) => {
  const text = String(description || '').toUpperCase();

  if (typeof prevBalance === 'number' && typeof balance === 'number' && typeof amount === 'number') {
    const delta = Number((balance - prevBalance).toFixed(2));
    if (Math.abs(delta - amount) < 1) return 'credit';
    if (Math.abs(delta + amount) < 1) return 'debit';
  }

  if (/SALARY|INT\.?PD|INTEREST|CREDITED|CR\b|PAYMENT FROM|DEPOSIT/i.test(text)) return 'credit';
  if (/DEBIT|DR\b|WITHDRAW|BIL\/|UPI\/|IMPS-|NEFT/i.test(text)) return 'debit';
  return 'debit';
};

const parseStructuredPdfTransactions = async (fullText) => {
  const lines = String(fullText || '')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Account info
  const accountNumberMatch =
    fullText.match(/Account\s+no\.?\s*[:\-]?\s*(\d{10,18})/i) ||
    fullText.match(/\b(\d{10,18})\b/);
  const accountHolderMatch = fullText.match(/\n([A-Z][A-Z\s\.]{3,})\n/);

  const accountInfo = {
    bank: detectBank(fullText),
    accountNumber: accountNumberMatch ? accountNumberMatch[1] : null,
    accountHolder: accountHolderMatch ? accountHolderMatch[1].trim() : null,
    statementPeriod: null,
  };

  // Group lines by transaction blocks: starts with serial + date.
  const blocks = [];
  let current = null;
  const txStartRegex = /^\d+\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;

  for (const line of lines) {
    if (txStartRegex.test(line)) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  const transactions = [];
  let prevBalance = null;

  for (const block of blocks) {
    const joined = block.join(' ');
    const headerMatch = joined.match(/^(\d+)\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+(.*)$/);
    if (!headerMatch) continue;

    const date = extractDate(headerMatch[2]);
    if (!date) continue;

    // trailing amount + balance is usually present as "... <amount> <balance>"
    const endMoneyMatch = joined.match(/(\d[\d,]*\.\d{1,2})\s+(\d[\d,]*\.\d{1,2})\s*$/);
    if (!endMoneyMatch) continue;

    const amount = extractAmount(endMoneyMatch[1]);
    const balance = extractAmount(endMoneyMatch[2]);
    let description = headerMatch[3]
      .replace(/(\d[\d,]*\.\d{1,2})\s+(\d[\d,]*\.\d{1,2})\s*$/, '')
      .trim();

    // If first "description" token is just cheque no, strip it.
    description = description.replace(/^\d{6,20}[:\-]?\s*/, '');

    const transactionType = inferTransactionTypeFromContext(description, amount, balance, prevBalance);
    const metadata = await extractTransactionMetadata(description, accountInfo, { useAI: false });

    transactions.push({
      date: date.toISOString().split('T')[0],
      description: description || 'Transaction',
      amount,
      transactionType,
      reference: null,
      balance,
      bank: accountInfo.bank,
      accountNumber: accountInfo.accountNumber,
      counterpartyName: metadata.counterpartyName,
      transactionKind: metadata.kind,
      isSelfTransfer: metadata.isSelfTransfer,
      nameParseSource: metadata.nameParseSource,
      nameNeedsReview: metadata.nameNeedsReview
    });

    prevBalance = balance;
  }

  const openingBalance = transactions.length > 0 ? transactions[0].balance : null;
  const closingBalance = transactions.length > 0 ? transactions[transactions.length - 1].balance : null;
  const startDate = transactions.length > 0 ? toDateOnly(transactions[0].date) : null;
  const endDate = transactions.length > 0 ? toDateOnly(transactions[transactions.length - 1].date) : null;

  return {
    transactions,
    openingBalance,
    closingBalance,
    startDate,
    endDate,
    accountInfo,
    usedRuleBased: transactions.length >= 3
  };
};

// Find header row by detecting key column names
const findHeaderRow = (rawData) => {
  const keywords = ['date', 'narration', 'withdrawal', 'deposit', 'balance', 'debit', 'credit', 'description'];
  
  for (let i = 0; i < Math.min(120, rawData.length); i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) continue;
    
    const rowText = row.map(cell => String(cell || '').toLowerCase()).join(' ');
    const matches = keywords.filter(kw => rowText.includes(kw)).length;
    
    // If we find 3+ key column names, this is likely the header
    if (matches >= 3) {
      console.log(`[STATEMENT] Found header row at index ${i} with ${matches} matches`);
      return i;
    }
  }
  
  return -1;
};

// Find column index by searching header row
const findColumnIndex = (headers, searchTerms) => {
  if (!headers || !Array.isArray(headers)) return -1;
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i] || '').toLowerCase();
    for (const term of searchTerms) {
      if (header.includes(term.toLowerCase())) {
        return i;
      }
    }
  }
  return -1;
};

// Extract account info from header section
const extractAccountInfo = (rawData) => {
  const info = {
    accountNumber: null,
    accountHolder: null,
    bank: null,
    branch: null,
    address: null,
    statementPeriod: null
  };

  // Search first 30 rows for account details
  for (let i = 0; i < Math.min(30, rawData.length); i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) continue;

    const rowText = row.join(' ');
    const rowTextLower = rowText.toLowerCase();

    // Bank name detection
    if (!info.bank) {
      info.bank = detectBank(rowText);
    }

    // Account number (10-18 digits, often after "Account No")
    const accountMatch = rowText.match(/\b(\d{10,18})\b/);
    if (accountMatch && !info.accountNumber) {
      info.accountNumber = accountMatch[1];
      console.log(`[STATEMENT] Found account: ${info.accountNumber}`);
    }

    // Account holder name
    if (row[0] && !info.accountHolder && typeof row[0] === 'string') {
      const name = String(row[0]).trim();
      if (name.match(/^[A-Z\s\.]+$/) && name.length > 3) {
        info.accountHolder = name;
      }
    }

    // Statement period
    if (!info.statementPeriod && rowTextLower.includes('statement')) {
      const dateMatch = rowText.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\s+(?:to|To)\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
      if (dateMatch) {
        info.statementPeriod = {
          from: `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`,
          to: `${dateMatch[4]}/${dateMatch[5]}/${dateMatch[6]}`
        };
        console.log(`[STATEMENT] Statement period: ${info.statementPeriod.from} to ${info.statementPeriod.to}`);
      }
    }
  }

  return info;
};

// Parse a transaction row using column detection
const parseTransactionRow = async (row, headers, accountInfo, options = {}) => {
  if (!row || !Array.isArray(row)) return null;

  // Find column indices
  const dateIdx = findColumnIndex(headers, ['date', 'transaction date', 'tran date']);
  const narrationIdx = findColumnIndex(headers, ['narration', 'description', 'particulars', 'details']);
  const withdrawalIdx = findColumnIndex(headers, ['withdrawal', 'debit', 'withdrawal amt', 'debit amt']);
  const depositIdx = findColumnIndex(headers, ['deposit', 'credit', 'deposit amt', 'credit amt']);
  const balanceIdx = findColumnIndex(headers, ['balance', 'closing balance', 'closing', 'col bal']);
  const refIdx = findColumnIndex(headers, ['chq', 'ref', 'reference', 'value dt', 'utr']);

  // Skip if no date column found
  if (dateIdx === -1) return null;

  // Extract values
  const dateStr = row[dateIdx] ? String(row[dateIdx]).trim() : null;
  const narration = narrationIdx >= 0 ? String(row[narrationIdx] || '').trim() : '';
  const withdrawal = withdrawalIdx >= 0 ? extractAmount(row[withdrawalIdx]) : 0;
  const deposit = depositIdx >= 0 ? extractAmount(row[depositIdx]) : 0;
  const balance = balanceIdx >= 0 ? extractAmount(row[balanceIdx]) : null;
  const reference = refIdx >= 0 ? String(row[refIdx] || '').trim() : '';
  const metadata = await extractTransactionMetadata(narration, accountInfo, options);

  // Parse date
  const date = extractDate(dateStr);
  if (!date) return null;

  // Skip separator rows
  if (narration && narration.includes('*')) return null;

  // Check for opening balance
  if (narration.toLowerCase().includes('opening')) {
    return {
      type: 'opening_balance',
      value: balance || deposit || withdrawal
    };
  }

  // Check for closing balance
  if (narration.toLowerCase().includes('closing')) {
    return {
      type: 'closing_balance',
      value: balance || deposit || withdrawal
    };
  }

  // Must have either debit or credit
  if (withdrawal === 0 && deposit === 0) return null;

  return {
    type: 'transaction',
    data: {
      date: date.toISOString().split('T')[0],
      description: narration || 'Transaction',
      amount: withdrawal > 0 ? withdrawal : deposit,
      transactionType: withdrawal > 0 ? 'debit' : 'credit',
      reference: reference || null,
      balance: balance,
      bank: accountInfo.bank,
      accountNumber: accountInfo.accountNumber,
      counterpartyName: metadata.counterpartyName,
      transactionKind: metadata.kind,
      isSelfTransfer: metadata.isSelfTransfer,
      nameParseSource: metadata.nameParseSource,
      nameNeedsReview: metadata.nameNeedsReview
    }
  };
};

const extractSummaryBalances = (rawData) => {
  let openingBalance = null;
  let closingBalance = null;
  let summaryHeaderColumns = null;

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !Array.isArray(row)) continue;
    const cells = row.map(cell => String(cell || '').trim());
    if (cells.every(c => !c)) continue;

    const rowText = cells.join(' ').toLowerCase();
    const numberTokens = cells
      .map(cell => extractAmount(cell))
      .filter(num => Number.isFinite(num) && num > 0);

    if (rowText.includes('statement summary')) {
      summaryHeaderColumns = null;
      continue;
    }

    // Handles summary blocks like "Opening Balance ... Closing Bal" in same row.
    if (rowText.includes('opening balance') && rowText.includes('closing')) {
      summaryHeaderColumns = {
        openingIdx: cells.findIndex(c => c.toLowerCase().includes('opening')),
        closingIdx: cells.findIndex(c => c.toLowerCase().includes('closing')),
      };
      if (numberTokens.length >= 2) {
        openingBalance = openingBalance ?? numberTokens[0];
        closingBalance = closingBalance ?? numberTokens[numberTokens.length - 1];
      }
      continue;
    }

    // Handles HDFC-style two-row summary where labels and values are split.
    if (summaryHeaderColumns && openingBalance == null && closingBalance == null) {
      const openingCell = summaryHeaderColumns.openingIdx >= 0 ? cells[summaryHeaderColumns.openingIdx] : '';
      const closingCell = summaryHeaderColumns.closingIdx >= 0 ? cells[summaryHeaderColumns.closingIdx] : '';
      const openingCandidate = extractAmount(openingCell);
      const closingCandidate = extractAmount(closingCell);

      if (openingCandidate > 0 || closingCandidate > 0) {
        openingBalance = openingBalance ?? (openingCandidate > 0 ? openingCandidate : null);
        closingBalance = closingBalance ?? (closingCandidate > 0 ? closingCandidate : null);
      }
    }

    if (rowText.includes('opening balance') && numberTokens.length > 0) {
      openingBalance = openingBalance ?? numberTokens[0];
      continue;
    }

    if (rowText.includes('closing balance') || rowText.includes('closing bal')) {
      if (numberTokens.length > 0) {
        closingBalance = closingBalance ?? numberTokens[numberTokens.length - 1];
      }
    }
  }

  return { openingBalance, closingBalance };
};

const parseExcelStatement = async (filePath) => {
  try {
    console.log(`[STATEMENT-EXCEL] Reading file: ${filePath}`);
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    console.log(`[STATEMENT-EXCEL] Using sheet: ${sheetName}`);
    
    const worksheet = workbook.Sheets[sheetName];
    
    // Get raw data as array to work with headers manually
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    console.log(`[STATEMENT-EXCEL] Total rows: ${rawData.length}`);
    
    // Extract account info from header section
    const accountInfo = extractAccountInfo(rawData);
    console.log(`[STATEMENT-EXCEL] Account Info:`, accountInfo);

    // Find transaction table header row
    const headerRowIdx = findHeaderRow(rawData);
    if (headerRowIdx === -1) {
      console.error('[STATEMENT-EXCEL] Could not find transaction table header');
      throw new Error('Could not find transaction table. Check statement format.');
    }

    const headers = rawData[headerRowIdx];
    console.log(`[STATEMENT-EXCEL] Headers (row ${headerRowIdx}):`, headers);

    // Parse transactions after header
    const transactions = [];
    let openingBalance = null;
    let closingBalance = null;
    let startDate = null;
    let endDate = null;

    for (let i = headerRowIdx + 1; i < rawData.length; i++) {
      const row = rawData[i];
      
      // Skip empty rows
      if (!row || row.every(cell => !cell || String(cell).trim() === '')) {
        continue;
      }

      const parsed = await parseTransactionRow(row, headers, accountInfo, { useAI: false });

      if (parsed) {
        if (parsed.type === 'transaction') {
          transactions.push(parsed.data);
          const txnDate = toDateOnly(parsed.data.date);
          if (!startDate || (txnDate && txnDate < startDate)) startDate = txnDate;
          if (!endDate || (txnDate && txnDate > endDate)) endDate = txnDate;
          console.log(`[STATEMENT-EXCEL] Transaction: ${parsed.data.date} ${parsed.data.description} ₹${parsed.data.amount} → ${parsed.data.counterpartyName}`);
        } else if (parsed.type === 'opening_balance') {
          openingBalance = parsed.value;
          console.log(`[STATEMENT-EXCEL] Opening balance: ₹${openingBalance}`);
        } else if (parsed.type === 'closing_balance') {
          closingBalance = parsed.value;
          console.log(`[STATEMENT-EXCEL] Closing balance: ₹${closingBalance}`);
        }
      }
    }

    console.log(`[STATEMENT-EXCEL] Extracted ${transactions.length} transactions`);

    if (transactions.length === 0) {
      throw new Error('No transactions found. Check that statement has transaction data.');
    }

    // Fallback: infer balances from statement summary/footer or transaction balances.
    const summaryBalances = extractSummaryBalances(rawData);
    if (openingBalance == null) {
      openingBalance = summaryBalances.openingBalance;
    }
    if (closingBalance == null) {
      closingBalance = summaryBalances.closingBalance;
    }
    if (openingBalance == null) {
      openingBalance = transactions[0]?.balance ?? null;
    }
    if (closingBalance == null) {
      closingBalance = transactions[transactions.length - 1]?.balance ?? null;
    }

    if (!startDate) startDate = toDateOnly(transactions[0]?.date);
    if (!endDate) endDate = toDateOnly(transactions[transactions.length - 1]?.date);

    return {
      format: 'xlsx',
      transactions,
      openingBalance,
      closingBalance,
      startDate,
      endDate,
      count: transactions.length,
      accountInfo,
      parseEngine: 'excel_local'
    };
  } catch (err) {
    console.error('[STATEMENT-EXCEL] Parse error:', err.message);
    throw new Error(`Failed to parse Excel statement: ${err.message}`);
  }
};

const parsePdfStatement = async (filePath) => {
  try {
    console.log(`[STATEMENT-PDF] Reading file: ${filePath}`);
    const fileBuffer = fs.readFileSync(filePath);

    // Extract text from PDF
    const pdf = await pdfParse(fileBuffer);
    const fullText = pdf.text;

    console.log(`[STATEMENT-PDF] Extracted ${fullText.length} characters from PDF`);

    // First try deterministic parsing to minimize token usage.
    const deterministic = await parseStructuredPdfTransactions(fullText);
    if (deterministic.usedRuleBased) {
      console.log(`[STATEMENT-PDF] Using rule-based parser. Parsed ${deterministic.transactions.length} transactions.`);
      return {
        format: 'pdf',
        transactions: deterministic.transactions,
        openingBalance: deterministic.openingBalance,
        closingBalance: deterministic.closingBalance,
        startDate: deterministic.startDate,
        endDate: deterministic.endDate,
        count: deterministic.transactions.length,
        accountInfo: deterministic.accountInfo,
        parseEngine: 'rule_based_local'
      };
    }

    // Fallback to Gemini only when deterministic parsing is insufficient.
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const frontChunk = fullText.substring(0, 5000);
    const backChunk = fullText.substring(Math.max(0, fullText.length - 5000));

    const prompt = `You are a bank statement parser. Extract ALL transaction data from this bank statement PDF.

IMPORTANT: This may be an HDFC, SBI, ICICI, AXIS, or KOTAK statement. Look for the transaction table.

Return ONLY valid JSON. No markdown. No explanation.

JSON Format:
{
  "bank": "HDFC|SBI|ICICI|AXIS|KOTAK|Unknown",
  "accountNumber": "string or null",
  "accountHolder": "string or null",
  "statementPeriod": {
    "from": "DD/MM/YYYY",
    "to": "DD/MM/YYYY"
  },
  "openingBalance": number or null,
  "closingBalance": number or null,
  "transactions": [
    {
      "date": "DD/MM/YYYY",
      "narration": "string",
      "withdrawal": number,
      "deposit": number,
      "balance": number or null,
      "reference": "string or null"
    }
  ]
}

RULES:
- Extract ALL transactions shown in the statement
- If only withdrawal amount shown, deposit = 0
- If only deposit amount shown, withdrawal = 0
- Include reference/check number if present; if unavailable use null
- Balance should be after transaction (closing balance for that day)
- Use exact dates from statement (DD/MM/YYYY format)
- Return minimum of 5 transactions if present
- Skip separator rows or summary rows
- Some banks keep "STATEMENT SUMMARY" at end of PDF; extract openingBalance and closingBalance from that summary if present
- If summary opening/closing is unavailable, infer openingBalance from first transaction balance and closingBalance from last transaction balance

Bank Statement (BEGINNING CHUNK):
"""
${frontChunk}
"""

Bank Statement (ENDING CHUNK):
"""
${backChunk}
"""

Return ONLY the JSON object, no other text.`;

    console.log('[STATEMENT-PDF] Sending to Gemini for parsing...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let jsonText = response.text();

    // Clean up response - remove markdown code blocks
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    console.log('[STATEMENT-PDF] Gemini response received, parsing JSON...');
    const parsed = JSON.parse(jsonText);

    // Convert transactions to internal format (with async support for name parsing)
    const transactions = await Promise.all((parsed.transactions || []).map(async t => {
      const date = extractDate(t.date);
      const amount = t.withdrawal > 0 ? t.withdrawal : t.deposit;
      const metadata = await extractTransactionMetadata(t.narration, {
        accountHolder: parsed.accountHolder,
        accountNumber: parsed.accountNumber
      }, { useAI: false });
      
      return {
        date: date ? date.toISOString().split('T')[0] : t.date,
        description: t.narration,
        amount: amount,
        transactionType: t.withdrawal > 0 ? 'debit' : 'credit',
        reference: t.reference || null,
        balance: t.balance,
        bank: parsed.bank,
        accountNumber: parsed.accountNumber,
        counterpartyName: metadata.counterpartyName,
        transactionKind: metadata.kind,
        isSelfTransfer: metadata.isSelfTransfer,
        nameParseSource: metadata.nameParseSource,
        nameNeedsReview: metadata.nameNeedsReview
      };
    }));

    console.log(`[STATEMENT-PDF] Extracted ${transactions.length} transactions`);
    console.log(`[STATEMENT-PDF] Bank: ${parsed.bank}, Account: ${parsed.accountNumber}`);

    let startDate = null;
    let endDate = null;
    for (const txn of transactions) {
      const d = toDateOnly(txn.date);
      if (!d) continue;
      if (!startDate || d < startDate) startDate = d;
      if (!endDate || d > endDate) endDate = d;
    }

    if (parsed.openingBalance == null && transactions.length > 0) {
      parsed.openingBalance = transactions[0]?.balance ?? null;
    }
    if (parsed.closingBalance == null && transactions.length > 0) {
      parsed.closingBalance = transactions[transactions.length - 1]?.balance ?? null;
    }

    return {
      format: 'pdf',
      transactions,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      startDate,
      endDate,
      count: transactions.length,
      accountInfo: {
        bank: parsed.bank,
        accountNumber: parsed.accountNumber,
        accountHolder: parsed.accountHolder,
        statementPeriod: parsed.statementPeriod
      },
      parseEngine: 'gemini_fallback'
    };
  } catch (err) {
    console.error('[STATEMENT-PDF] Parse error:', err.message);
    throw new Error(`Failed to parse PDF statement: ${err.message}`);
  }
};

module.exports.parseStatementFile = async (filePath, fileType) => {
  try {
    console.log(`[STATEMENT] Parsing ${fileType} file: ${filePath}`);

    if (fileType === 'xlsx' || fileType === 'xls') {
      return await parseExcelStatement(filePath);
    } else if (fileType === 'pdf') {
      return await parsePdfStatement(filePath);
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
  } catch (err) {
    console.error('[STATEMENT] Parse error:', err);
    throw err;
  }
};
