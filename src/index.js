// src/index.js

const minimist = require('minimist');
const path = require('path');
const fs = require('fs');
const { loadClockData, processClockData, expandToIntervals } = require('./clockData');
const { loadTransactions, processTransactions } = require('./transactions');
const {
  countStaffPerSlot,
  computeTipPools,
  calculateIndividualTipShares,
  identifyUnallocatedTips,
  redistributeUnallocatedTips,
  aggregateFinalTips
} = require('./tipAllocation');
const { createObjectCsvWriter } = require('csv-writer');
const { formatDateTime } = require('./utils');

// Helper: Write CSV
function writeCSV(filePath, header, records) {
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: header,
  });
  return csvWriter.writeRecords(records);
}

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ['clock', 'transactions', 'output'],
  alias: { c: 'clock', t: 'transactions', o: 'output' },
  default: {
    clock: './input-data/clock-times.csv',
    transactions: './input-data/transactions.csv',
    output: './output/'
  }
});
if (!args.clock || !args.transactions || !args.output) {
  console.error('Usage: node src/index.js --clock <clock_data.csv> --transactions <transactions.csv> --output <output_directory>');
  process.exit(1);
}

const clockFile = args.clock;
const transactionsFile = args.transactions;
const outputDir = args.output;

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function main() {
  // Step 1: Process clock data
  console.log('Step 1: Processing clock data...');
  const rawClockData = await loadClockData(clockFile);
  const cleanedClock = processClockData(rawClockData);
  const intervals = expandToIntervals(cleanedClock);
  await writeCSV(path.join(outputDir, 'step1_cleaned_clock_data.csv'),
    [
      { id: 'Employee', title: 'Employee' },
      { id: 'Department', title: 'Department' },
      { id: 'Date', title: 'Date' },
      { id: 'TimeIn', title: 'TimeIn' },
      { id: 'TimeOut', title: 'TimeOut' }
    ],
    cleanedClock.map(r => ({
      Employee: r.Employee,
      Department: r.Department,
      Date: r.Date,
      TimeIn: formatDateTime(r.TimeIn),
      TimeOut: formatDateTime(r.TimeOut)
    }))
  );
  await writeCSV(path.join(outputDir, 'step2_time_intervals.csv'),
    [
      { id: 'Employee', title: 'Employee' },
      { id: 'Department', title: 'Department' },
      { id: 'Date', title: 'Date' },
      { id: 'TimeSlotStart', title: 'TimeSlotStart' },
      { id: 'TimeSlotEnd', title: 'TimeSlotEnd' }
    ],
    intervals.map(r => ({
      Employee: r.Employee,
      Department: r.Department,
      Date: r.Date,
      TimeSlotStart: formatDateTime(r.TimeSlotStart),
      TimeSlotEnd: formatDateTime(r.TimeSlotEnd)
    }))
  );
  console.log('Clock data processed and saved.');

  // Step 2: Process transaction data
  console.log('Step 2: Processing transaction data...');
  const rawTransactions = await loadTransactions(transactionsFile);
  const tipsBySlot = processTransactions(rawTransactions);
  await writeCSV(path.join(outputDir, 'step3_tips_by_slot.csv'),
    [
      { id: 'Date', title: 'Date' },
      { id: 'TimeSlotStart', title: 'TimeSlotStart' },
      { id: 'AmtTip', title: 'AmtTip' }
    ],
    tipsBySlot.map(r => ({
      Date: r.Date,
      TimeSlotStart: formatDateTime(r.TimeSlotStart),
      AmtTip: r.AmtTip.toFixed(2)
    }))
  );
  console.log('Transaction data processed and saved.');

  // Step 3: Compute tip pools
  console.log('Step 3: Computing tip pools...');
  const staffMap = countStaffPerSlot(intervals);
  const tipPools = computeTipPools(tipsBySlot, staffMap);
  await writeCSV(path.join(outputDir, 'step4_tip_pools.csv'),
    [
      { id: 'Date', title: 'Date' },
      { id: 'TimeSlotStart', title: 'TimeSlotStart' },
      { id: 'AmtTip', title: 'AmtTip' },
      { id: 'FOHCount', title: 'FOHCount' },
      { id: 'BOHCount', title: 'BOHCount' },
      { id: 'FOHTipPool', title: 'FOHTipPool' },
      { id: 'BOHTipPool', title: 'BOHTipPool' },
      { id: 'TotalStaff', title: 'TotalStaff' }
    ],
    tipPools.map(r => ({
      Date: r.Date,
      TimeSlotStart: formatDateTime(r.TimeSlotStart),
      AmtTip: r.AmtTip.toFixed(2),
      FOHCount: r.FOHCount,
      BOHCount: r.BOHCount,
      FOHTipPool: r.FOHTipPool.toFixed(2),
      BOHTipPool: r.BOHTipPool.toFixed(2),
      TotalStaff: r.TotalStaff
    }))
  );
  console.log('Tip pools computed and saved.');

  // Step 4: Calculate individual tip shares
  console.log('Step 4: Calculating individual tip shares...');
  const individualTipShares = calculateIndividualTipShares(intervals, tipPools);
  await writeCSV(path.join(outputDir, 'step5_individual_tip_shares.csv'),
    [
      { id: 'Employee', title: 'Employee' },
      { id: 'Department', title: 'Department' },
      { id: 'Date', title: 'Date' },
      { id: 'TimeSlotStart', title: 'TimeSlotStart' },
      { id: 'TimeSlotEnd', title: 'TimeSlotEnd' },
      { id: 'IndividualTipShare', title: 'IndividualTipShare' }
    ],
    individualTipShares.map(r => ({
      Employee: r.Employee,
      Department: r.Department,
      Date: r.Date,
      TimeSlotStart: formatDateTime(r.TimeSlotStart),
      TimeSlotEnd: formatDateTime(r.TimeSlotEnd),
      IndividualTipShare: r.IndividualTipShare.toFixed(2)
    }))
  );
  console.log('Individual tip shares calculated and saved.');

  // Step 5: Identify and redistribute unallocated tips
  console.log('Step 5: Identifying unallocated tips...');
  const unallocatedTips = require('./tipAllocation').identifyUnallocatedTips(tipPools);
  await writeCSV(path.join(outputDir, 'step6_unallocated_tips.csv'),
    [
      { id: 'Date', title: 'Date' },
      { id: 'TimeSlotStart', title: 'TimeSlotStart' },
      { id: 'UnallocatedTip', title: 'UnallocatedTip' }
    ],
    unallocatedTips.map(r => ({
      Date: r.Date,
      TimeSlotStart: formatDateTime(r.TimeSlotStart),
      UnallocatedTip: r.UnallocatedTip.toFixed(2)
    }))
  );
  console.log('Unallocated tips identified and saved.');

  console.log('Step 6: Redistributing unallocated tips by day...');
  const redistribution = require('./tipAllocation').redistributeUnallocatedTips(unallocatedTips, intervals);
  await writeCSV(path.join(outputDir, 'step7_unallocated_tip_distribution.csv'),
    [
      { id: 'Date', title: 'Date' },
      { id: 'Employee', title: 'Employee' },
      { id: 'UnallocatedTipShare', title: 'UnallocatedTipShare' }
    ],
    redistribution.map(r => ({
      Date: r.Date,
      Employee: r.Employee,
      UnallocatedTipShare: r.UnallocatedTipShare.toFixed(2)
    }))
  );
  console.log('Unallocated tips redistributed and saved.');

  // Step 7: Aggregate final tip totals per employee
  console.log('Step 7: Aggregating final tip totals per employee...');
  const finalTotals = aggregateFinalTips(individualTipShares, redistribution);
  await writeCSV(path.join(outputDir, 'step8_final_employee_totals.csv'),
    [
      { id: 'Employee', title: 'Employee' },
      { id: 'TotalTips', title: 'TotalTips' }
    ],
    finalTotals.map(r => ({
      Employee: r.Employee,
      TotalTips: r.TotalTips.toFixed(2)
    }))
  );
  console.log('Final employee tip totals aggregated and saved.');

  // Step 8: Sanity check
  console.log('Step 8: Running sanity check...');
  const finalSum = finalTotals.reduce((acc, rec) => acc + rec.TotalTips, 0);
  const txnTotal = tipsBySlot.reduce((acc, rec) => acc + rec.AmtTip, 0);
  console.log(`Final Adjusted Employee Total: $${finalSum.toFixed(2)}`);
  console.log(`Transaction Tip Total: $${txnTotal.toFixed(2)}`);
  if (Math.abs(finalSum - txnTotal) < 0.01) {
    console.log('Sanity Check Passed: Totals match!');
  } else {
    console.error('Sanity Check FAILED: Totals do not match!');
  }
}

main().catch(err => {
  console.error('Error in processing:', err);
});