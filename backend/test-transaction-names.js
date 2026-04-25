/**
 * Test Transaction Name Parser
 * Demonstrates the new rule-based name parsing with minimal AI usage
 */

const {
  parseTransactionName,
  parseUPI,
  parseIMPS,
  parseACHSalary,
  parseInvestment,
  parseInterest,
  parseSelfTransfer
} = require('./src/services/transaction-name-parser.service');

const testCases = [
  // UPI Transactions
  {
    name: 'UPI - Person to Person',
    narration: 'SBIN0000579/KAVISHKARTHICK/XXXXX91509/sumanajay03@oksbi/UPI/609764590814/UPI',
    expected: 'KAVISHKARTHICK',
    category: 'UPI'
  },
  {
    name: 'UPI - Investment (Stocks)',
    narration: 'UPI-INDSTOCKS-INDSTOCKS.BRK@VALIDICICI-ICIC0DC0099-490110656070-PAYMENT FROM PHONE',
    expected: 'INDSTOCKS',
    category: 'Investment'
  },
  {
    name: 'UPI - Investment (SIP)',
    narration: 'UPI-GROWW INVEST TECH PR-GROWW.STOCKSIP.BRK@VALIDHDFC-HDFC0MERUPI-102931921952-DEBIT FOR STOCKS S',
    expected: 'GROWW INVEST TECH PR',
    category: 'Investment'
  },
  {
    name: 'UPI - Circle Transaction',
    narration: 'ELE-ranjanem18/UPI/q91601674@ybl/UPI/YES BANK LIMITE/AXI0dba82af2376430ebb0f9261bac3240c/DELE-ranjanem18',
    expected: 'ranjanem18',
    category: 'UPI Circle'
  },

  // IMPS Transactions
  {
    name: 'IMPS - Bank Transfer',
    narration: 'IMPS-607033624384-B KARTHICK RAJA-ICIC-XXXXXXXX8257-SAVINGS',
    expected: 'B KARTHICK RAJA',
    category: 'IMPS'
  },

  // Salary/ACH
  {
    name: 'Salary - Complex Format',
    narration: 'ACH C- SAL-AMAZONDEVELCENTI-SALARYAMAZON',
    expected: 'SALARYAMAZON',
    category: 'Salary'
  },
  {
    name: 'Salary - Simple',
    narration: 'SAL-GOOGLE-GOOGLE INDIA',
    expected: 'GOOGLE',
    category: 'Salary'
  },

  // Interest
  {
    name: 'Interest - Paid',
    narration: '055201578257:Int.Pd:31-12-2025 to 29-03-2026',
    expected: 'Bank Interest',
    category: 'Interest'
  },
  {
    name: 'Interest - Interest Paid',
    narration: 'INTEREST PAID 2025-2026',
    expected: 'Bank Interest',
    category: 'Interest'
  },

  // Generic Transfers
  {
    name: 'Generic - Hyphen separated',
    narration: 'NEFT-123456789/JOHN SMITH/HDFC',
    expected: 'JOHN SMITH',
    category: 'Generic'
  },
  {
    name: 'Generic - Slash separated',
    narration: 'TRANSFER/JANE DOE/5555XXXX',
    expected: 'JANE DOE',
    category: 'Generic'
  }
];

async function runTests() {
  console.log('\n' + '='.repeat(80));
  console.log('TRANSACTION NAME PARSER - TEST SUITE');
  console.log('='.repeat(80) + '\n');

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    try {
      const result = await parseTransactionName(test.narration, {
        accountHolder: 'KARTHICK RAJA',
        accountNumber: '123456789012'
      });

      const success = result.name?.includes(test.expected) || test.expected.includes(result.name);
      
      if (success) {
        console.log(`✅ PASS: ${test.name}`);
        console.log(`   Narration: "${test.narration}"`);
        console.log(`   Expected: "${test.expected}"`);
        console.log(`   Got: "${result.name}" (source: ${result.source})`);
        passed++;
      } else {
        console.log(`❌ FAIL: ${test.name}`);
        console.log(`   Narration: "${test.narration}"`);
        console.log(`   Expected: "${test.expected}"`);
        console.log(`   Got: "${result.name}" (source: ${result.source})`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ERROR: ${test.name}`);
      console.log(`   ${error.message}`);
      failed++;
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  console.log(`Success Rate: ${((passed / testCases.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(80) + '\n');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testCases, runTests };
