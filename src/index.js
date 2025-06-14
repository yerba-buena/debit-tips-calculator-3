// src/index.js

const minimist = require('minimist');
const path = require('path');
const fs = require('fs');
const { loadClockData, processClockData, expandToIntervals } = require('./clockData');
const { loadTransactions, processTransactions, printTipsByDay } = require('./transactions');
const {
  countStaffPerSlot,
  computeTipPools,
  calculateIndividualTipShares,
  identifyUnallocatedTips,
  redistributeUnallocatedTips,
  aggregateFinalTips
} = require('./tipAllocation');
const { analyzeDepartments } = require('./departmentAnalysis');
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
  string: ['clock', 'transactions', 'output', 'from-tz', 'to-tz', 'boh-pct'],
  alias: { 
    c: 'clock', 
    t: 'transactions', 
    o: 'output', 
    n: 'no-tz-conversion',
    from: 'from-tz',
    to: 'to-tz',
    b: 'boh-pct'
  },
  default: {
    clock: './input-data/clock-times.csv',
    transactions: './input-data/transactions.csv',
    output: './output/',
    interval: '15',
    'no-tz-conversion': false,
    'from-tz': 'America/Chicago',
    'to-tz': 'America/New_York',
    'boh-pct': null
  },
  boolean: ['no-tz-conversion']
});

if (!args.clock || !args.transactions || !args.output) {
  console.error('Usage: node src/index.js --clock <clock_data.csv> --transactions <transactions.csv> --output <output_directory>');
  process.exit(1);
}

const clockFile = args.clock;
const transactionsFile = args.transactions;
const outputDir = args.output;
const intervalMinutes = parseInt(args.interval, 10);
const convertTimezone = !args['no-tz-conversion']; // Invert the logic - now true by default
const fromTimezone = args['from-tz'];
const toTimezone = args['to-tz'];
const bohPctOverride = args['boh-pct'] ? parseInt(args['boh-pct'], 10) : null;

// Validate interval
const minutesInDay = 24 * 60; // 1440 minutes in a day
if (minutesInDay % intervalMinutes !== 0) {
  console.error(`Error: The interval (${intervalMinutes}) must divide the day evenly.`);
  console.error('Valid intervals include: 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 60, etc.');
  console.error('These are intervals that divide 1440 minutes (24 hours) with no remainder.');
  process.exit(1);
}

// Validate BOH percentage if provided
if (bohPctOverride !== null && (bohPctOverride < 0 || bohPctOverride > 100)) {
  console.error(`Error: BOH percentage (${bohPctOverride}) must be between 0 and 100.`);
  process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function main() {
  // Step 1: Process clock data
  console.log('Step 1: Processing clock data...');
  const rawClockData = await loadClockData(clockFile);
  const cleanedClock = processClockData(rawClockData);
  
  // Add department analysis before further processing
  console.log('\nAnalyzing department classifications:');
  const deptAnalysis = analyzeDepartments(cleanedClock);
  
  const intervals = expandToIntervals(cleanedClock, intervalMinutes);
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
  const tipsBySlot = processTransactions(rawTransactions, intervalMinutes, convertTimezone, fromTimezone, toTimezone);

  if (!convertTimezone) {
    console.log('  Note: Transaction times NOT converted from source timezone');
  } else {
    console.log(`  Note: Transaction times converted from ${fromTimezone} to ${toTimezone} (default)`);
  }
  
  // Add this call to print tips by day and save to CSV
  printTipsByDay(tipsBySlot, path.join(outputDir, 'tips_by_day.csv'));
  
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
  const staffMap = countStaffPerSlot(intervals, intervalMinutes);
  const tipPools = computeTipPools(tipsBySlot, staffMap, bohPctOverride);
  await writeCSV(path.join(outputDir, 'step4_tip_pools.csv'),
    [
      { id: 'Date', title: 'Date' },
      { id: 'TimeSlotStart', title: 'TimeSlotStart' },
      { id: 'AmtTip', title: 'AmtTip' },
      { id: 'FOHCount', title: 'FOHCount' },
      { id: 'BOHCount', title: 'BOHCount' },
      { id: 'ExecCount', title: 'ExecCount' },
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
      ExecCount: r.ExecCount || 0,
      FOHTipPool: r.FOHTipPool.toFixed(2),
      BOHTipPool: r.BOHTipPool.toFixed(2),
      TotalStaff: r.TotalStaff
    }))
  );
  console.log('Tip pools computed and saved.');

  // Step 4: Calculate individual tip shares
  console.log('Step 4: Calculating individual tip shares...');
  const individualTipShares = calculateIndividualTipShares(intervals, tipPools, intervalMinutes);  // Add intervalMinutes parameter
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
  const unallocatedTips = identifyUnallocatedTips(tipPools, intervalMinutes);  // Add intervalMinutes parameter
  
  // Add summary of unallocated tips by day
  const unallocatedByDay = {};
  unallocatedTips.forEach(tip => {
    if (!unallocatedByDay[tip.Date]) unallocatedByDay[tip.Date] = 0;
    unallocatedByDay[tip.Date] += tip.UnallocatedTip;
  });
  
  console.log('\nUnallocated Tips Summary by Day:');
  Object.keys(unallocatedByDay).sort().forEach(date => {
    console.log(`  ${date}: $${unallocatedByDay[date].toFixed(2)}`);
  });
  
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
  const redistribution = require('./tipAllocation').redistributeUnallocatedTips(unallocatedTips, intervals, intervalMinutes);  // Add intervalMinutes parameter
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
      { id: 'AllocatedTips', title: 'Allocated Tips' },
      { id: 'UnallocatedTips', title: 'Unallocated Tips' },
      { id: 'TotalTips', title: 'Total Tips' }
    ],
    finalTotals.map(r => ({
      Employee: r.Employee,
      AllocatedTips: r.AllocatedTips.toFixed(2),
      UnallocatedTips: r.UnallocatedTips.toFixed(2),
      TotalTips: r.TotalTips.toFixed(2)
    }))
  );
  
  // Print unallocated tips percentage
  const totalAllocated = finalTotals.reduce((acc, r) => acc + r.AllocatedTips, 0);
  const totalUnallocated = finalTotals.reduce((acc, r) => acc + r.UnallocatedTips, 0);
  const totalTips = totalAllocated + totalUnallocated;
  
  console.log('\nTip Allocation Summary:');
  console.log(`  Total Allocated Tips: $${totalAllocated.toFixed(2)} (${(totalAllocated/totalTips*100).toFixed(1)}%)`);
  console.log(`  Total Unallocated Tips: $${totalUnallocated.toFixed(2)} (${(totalUnallocated/totalTips*100).toFixed(1)}%)`);
  console.log(`  Total Tips: $${totalTips.toFixed(2)}`);
  
  // Add detailed diagnostics to understand unallocated tips
  console.log('\nDIAGNOSTIC INFORMATION:');
  
  // Check for timeslots with tips but no staff
  const tipSlotsWithNoStaff = tipPools.filter(tp => tp.AmtTip > 0 && tp.TotalStaff === 0);
  if (tipSlotsWithNoStaff.length > 0) {
    console.log(`\nFound ${tipSlotsWithNoStaff.length} time slots with tips but NO STAFF present:`);
    tipSlotsWithNoStaff.slice(0, 5).forEach(slot => {
      console.log(`  Date: ${slot.Date}, Time: ${formatDateTime(slot.TimeSlotStart)}, Tips: $${slot.AmtTip.toFixed(2)}`);
    });
    if (tipSlotsWithNoStaff.length > 5) {
      console.log(`  ... and ${tipSlotsWithNoStaff.length - 5} more slots`);
    }
  }
  
  // Check for imbalanced staff (e.g., FOH but no BOH, or vice versa)
  const imbalancedStaffSlots = tipPools.filter(tp => 
    tp.AmtTip > 0 && tp.TotalStaff > 0 && (tp.FOHCount === 0 || tp.BOHCount === 0)
  );
  if (imbalancedStaffSlots.length > 0) {
    console.log(`\nFound ${imbalancedStaffSlots.length} time slots with tips but IMBALANCED STAFF:`);
    imbalancedStaffSlots.slice(0, 5).forEach(slot => {
      console.log(`  Date: ${slot.Date}, Time: ${formatDateTime(slot.TimeSlotStart)}, Tips: $${slot.AmtTip.toFixed(2)}, FOH: ${slot.FOHCount}, BOH: ${slot.BOHCount}`);
    });
    if (imbalancedStaffSlots.length > 5) {
      console.log(`  ... and ${imbalancedStaffSlots.length - 5} more slots`);
    }
  }
  
  // Analyze distribution of unallocated tips by hour of day
  const unallocatedByHour = {};
  unallocatedTips.forEach(tip => {
    const hour = new Date(tip.TimeSlotStart).getHours();
    if (!unallocatedByHour[hour]) unallocatedByHour[hour] = 0;
    unallocatedByHour[hour] += tip.UnallocatedTip;
  });
  
  console.log('\nUnallocated tips by hour of day:');
  Object.keys(unallocatedByHour).sort((a, b) => Number(a) - Number(b)).forEach(hour => {
    const hourFormatted = hour.padStart(2, '0') + ':00';
    console.log(`  ${hourFormatted}: $${unallocatedByHour[hour].toFixed(2)}`);
  });
  
  // Add a diagnostic CSV output with detailed information about each timeslot
  await writeCSV(path.join(outputDir, 'diagnostic_timeslot_analysis.csv'),
    [
      { id: 'Date', title: 'Date' },
      { id: 'TimeSlotStart', title: 'TimeSlotStart' },
      { id: 'AmtTip', title: 'AmtTip' },
      { id: 'FOHCount', title: 'FOHCount' },
      { id: 'BOHCount', title: 'BOHCount' },
      { id: 'ExecCount', title: 'ExecCount' },
      { id: 'TotalStaff', title: 'TotalStaff' },
      { id: 'FOHTipPool', title: 'FOHTipPool' },
      { id: 'BOHTipPool', title: 'BOHTipPool' },
      { id: 'UnallocatedTip', title: 'UnallocatedTip' },
      { id: 'HasStaffIssue', title: 'HasStaffIssue' }
    ],
    tipPools.map(tp => {
      // Find corresponding unallocated tip entry
      const unallocated = unallocatedTips.find(ut => 
        ut.Date === tp.Date && 
        new Date(ut.TimeSlotStart).getTime() === new Date(tp.TimeSlotStart).getTime()
      );
      
      return {
        Date: tp.Date,
        TimeSlotStart: formatDateTime(tp.TimeSlotStart),
        AmtTip: tp.AmtTip.toFixed(2),
        FOHCount: tp.FOHCount,
        BOHCount: tp.BOHCount,
        ExecCount: tp.ExecCount || 0,
        TotalStaff: tp.TotalStaff,
        FOHTipPool: tp.FOHTipPool.toFixed(2),
        BOHTipPool: tp.BOHTipPool.toFixed(2),
        UnallocatedTip: unallocated ? unallocated.UnallocatedTip.toFixed(2) : "0.00",
        HasStaffIssue: (tp.AmtTip > 0 && (tp.TotalStaff === 0 || tp.FOHCount === 0 || tp.BOHCount === 0)) ? "YES" : "NO"
      };
    })
  );
  
  console.log('Created diagnostic_timeslot_analysis.csv with detailed information about each timeslot.');
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