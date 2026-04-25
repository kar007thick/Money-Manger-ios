const { parseStatementFile } = require('./src/services/statement-parser.service');
const path = require('path');

// Test with the actual file
const filePath = '/Users/indran/Downloads/Acct Statement_1988_25042026_08.27.15.xls';

(async () => {
  try {
    console.log('🚀 Testing statement parser...\n');
    const result = await parseStatementFile(filePath, 'xls');
    
    console.log('\n✅ Parser Result:');
    console.log('  Format:', result.format);
    console.log('  Transactions:', result.count);
    console.log('  Opening Balance:', result.openingBalance);
    console.log('  Closing Balance:', result.closingBalance);
    console.log('  Date Range:', result.startDate, 'to', result.endDate);
    console.log('  Bank:', result.accountInfo?.bank);
    console.log('  Account:', result.accountInfo?.accountNumber);
    console.log('  Account Holder:', result.accountInfo?.accountHolder);
    
    console.log('\n📋 Sample Transactions:');
    result.transactions.slice(0, 3).forEach((txn, idx) => {
      console.log(`  ${idx + 1}. ${txn.date} - ${txn.description} - ₹${txn.amount} (${txn.transactionType})`);
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
  }
})();
