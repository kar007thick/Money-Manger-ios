/**
 * Message Classifier Service
 * Classifies bank SMS messages to identify transactions vs bills/reminders/promotional
 */

module.exports.classifyMessage = (rawMessage) => {
  if (!rawMessage) {
    return { type: 'unknown', confidence: 0, shouldParse: false };
  }

  // Normalize message to lowercase for matching
  const msg = rawMessage.toLowerCase();

  // Bill/Reminder keywords
  const billReminders = [
    'bill due',
    'due date',
    'payment due',
    'reminder',
    'bill amount',
    'electricity bill',
    'water bill',
    'phone bill',
    'internet bill',
    'credit card bill',
    'emi due',
    'loan payment',
    'insurance premium',
    'subscription',
    'renewal',
    'expires on',
    'expiry',
    'pending payment',
    'installment due'
  ];

  // Promotional keywords to filter out
  const promotional = [
    'offer',
    'discount',
    'cashback',
    'reward',
    'bonus',
    'promotion',
    'limited time',
    'special offer',
    'deal',
    'sale',
    'coupon',
    'free',
    'win',
    'congratulations',
    'lucky',
    'claim reward',
    'click here',
    'download app',
    'refer friend',
    'invite friend',
    'update your profile',
    'verify account',
    'suspicious activity',
    'confirm identity',
    'urgent action',
    'act now'
  ];

  // Transaction keywords (debit/credit)
  const transactionKeywords = [
    'debited',
    'credited',
    'sent',
    'received',
    'transferred',
    'paid',
    'payment',
    'deposit',
    'withdrawal',
    'atm',
    'swipe',
    'upi',
    'cheque',
    'neft',
    'rtgs',
    'imps',
    'standing instruction',
    'txn',
    'transaction',
    'purchase',
    'sale',
    'debit',
    'credit',
    'from',
    'to'
  ];

  // Check if it's a bill/reminder
  const isBillReminder = billReminders.some(keyword => msg.includes(keyword));

  // Check if it's promotional (and not a transaction)
  const isPromotional = promotional.some(keyword => msg.includes(keyword));

  // Check if it's a transaction
  const isTransaction = transactionKeywords.some(keyword => msg.includes(keyword));

  // Classification logic
  if (isBillReminder && !isTransaction) {
    console.log('[CLASSIFY] 📋 Classified as: BILL_REMINDER');
    return { type: 'bill_reminder', confidence: 0.9, shouldParse: false };
  }

  if (isPromotional && !isTransaction) {
    console.log('[CLASSIFY] 📢 Classified as: PROMOTIONAL');
    return { type: 'promotional', confidence: 0.85, shouldParse: false };
  }

  if (isTransaction) {
    console.log('[CLASSIFY] 💳 Classified as: TRANSACTION');
    return { type: 'transaction', confidence: 0.95, shouldParse: true };
  }

  // Default: uncertain, try to parse as transaction
  console.log('[CLASSIFY] ❓ Classified as: UNKNOWN');
  return { type: 'unknown', confidence: 0.5, shouldParse: true };
};

module.exports.getClassificationStats = (messages) => {
  const stats = {
    transactions: 0,
    bills: 0,
    promotional: 0,
    unknown: 0,
    total: messages.length
  };

  for (const msg of messages) {
    const classification = module.exports.classifyMessage(msg);
    stats[classification.type]++;
  }

  return stats;
};
