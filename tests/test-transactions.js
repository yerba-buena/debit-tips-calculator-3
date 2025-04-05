// tests/test-transactions.js

const { expect } = require('chai');
const { processTransactions } = require('../src/transactions');

describe('Transactions Module', () => {
  const sampleTransactions = [
    {
      TransDateTime: '2025-02-18T10:37:00',
      AmtTip: '10.00',
      Approved: 'Yes'
    },
    {
      TransDateTime: '2025-02-18T10:50:00',
      AmtTip: '5.00',
      Approved: 'No'
    }
  ];

  it('should process approved transactions correctly', () => {
    const processed = processTransactions(sampleTransactions);
    expect(processed).to.have.lengthOf(1);
    expect(processed[0]).to.have.property('AmtTip', 10.00);
  });
});