// tests/test-flow.js

const { expect } = require('chai');
const { processClockData, expandToIntervals } = require('../src/clockData');
const { processTransactions } = require('../src/transactions');
const {
  countStaffPerSlot,
  computeTipPools,
  calculateIndividualTipShares,
  identifyUnallocatedTips,
  redistributeUnallocatedTips,
  aggregateFinalTips
} = require('../src/tipAllocation');

// Helper function to simulate approved transaction record formatting
const simulateTransaction = (transDateTime, amtTip) => {
  return {
    TransDateTime: transDateTime,
    AmtTip: amtTip.toString(),
    Approved: 'Yes'
  };
};

describe('Full Flow Integration Test', () => {
  it('should aggregate final tip totals matching expected values', () => {
    // Simulate raw clock data (already in the CSV row object format after preprocessing)
    // Note: In the raw file, headers are "First Name", "Last Name", "Department", "Date In", "Time In", "Date Out", "Time Out", "Total Less Break"
    // We supply one row per employee.
    const rawClockData = [
      {
        'First Name': 'John',
        'Last Name': 'Doe',
        'Department': 'Front of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0' // not used because Time Out exists
      },
      {
        'First Name': 'Jane',
        'Last Name': 'Smith',
        'Department': 'Front of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0'
      }
    ];

    // Process clock data
    const cleanedClock = processClockData(rawClockData);
    const intervals = expandToIntervals(cleanedClock);
    // Given a 10:00 to 10:30 shift, each employee should have two intervals:
    // [10:00, 10:15] and [10:15, 10:30]

    // Simulate transactions
    // Create one approved transaction at "2025-02-18 10:05:00" with AmtTip $20
    // After flooring, the transaction belongs to the slot starting at 10:00
    const rawTransactions = [
      simulateTransaction('2025-02-18T10:05:00', 20.00)
    ];
    const tipsBySlot = processTransactions(rawTransactions);

    // Compute tip pools using our intervals
    const staffMap = countStaffPerSlot(intervals);
    const tipPools = computeTipPools(tipsBySlot, staffMap);

    // Calculate individual tip shares
    const individualTipShares = calculateIndividualTipShares(intervals, tipPools);
    // At this point, only intervals matching a tip slot get a direct share.
    // The transaction at 10:00 yields:
    // - FOH Tip Pool = $20 * 0.85 = $17, split among 2 FOH employees => $8.50 each
    // - BOH Tip Pool = $20 * 0.15 = $3, but since no BOH staff were present, this remains unallocated.

    // Identify unallocated tips and redistribute by day
    const unallocatedTips = identifyUnallocatedTips(tipPools);
    const redistribution = redistributeUnallocatedTips(unallocatedTips, intervals);
    // In this case, the $3 unallocated tip will be split evenly between the two employees,
    // yielding an additional $1.50 each.

    // Aggregate final tip totals per employee
    const finalTotals = aggregateFinalTips(individualTipShares, redistribution);
    // Expected:
    // - John Doe: $8.50 (direct) + $1.50 (redistribution) = $10.00
    // - Jane Smith: $8.50 + $1.50 = $10.00

    // Assert final totals
    const john = finalTotals.find(r => r.Employee === 'John Doe');
    const jane = finalTotals.find(r => r.Employee === 'Jane Smith');

    expect(john).to.exist;
    expect(jane).to.exist;
    expect(john.TotalTips).to.be.closeTo(10.00, 0.01);
    expect(jane.TotalTips).to.be.closeTo(10.00, 0.01);

    // Also, the sum of final totals should equal the total transaction tip ($20)
    const finalSum = finalTotals.reduce((acc, rec) => acc + rec.TotalTips, 0);
    expect(finalSum).to.be.closeTo(20.00, 0.01);
  });
});