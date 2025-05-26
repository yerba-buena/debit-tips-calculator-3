// src/transactions.js

const fs = require('fs');
const csvParser = require('csv-parser');
const { floorToInterval, convertTimezone, createStandardInterval } = require('./utils');

function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    let results = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

async function loadTransactions(filePath) {
  const data = await readCSV(filePath);
  return data;
}

/**
 * Process transaction data to aggregate tips by time slot
 * @param {Array} transactions - Array of transaction records
 * @param {Number} intervalMinutes - Size of time interval in minutes
 * @param {Boolean} convertTz - Whether to convert between timezones
 * @param {String} fromTz - Source timezone (default: 'America/Chicago')
 * @param {String} toTz - Target timezone (default: 'America/New_York')
 * @return {Array} - Array of tips by time slot
 */
function processTransactions(transactions, intervalMinutes = 15, convertTz = true, fromTz = 'America/Chicago', toTz = 'America/New_York') {
  let approved = transactions.filter(r => r.Approved && r.Approved.toLowerCase() === 'yes')
    .map(r => {
      let transDT = new Date(r.TransDateTime);

      // Convert timezone if specified, using the more robust method
      if (convertTz) {
        transDT = convertTimezone(transDT, fromTz, toTz);
      }

      // Use the standardized interval function
      const standardInterval = createStandardInterval(transDT, intervalMinutes);
      
      return {
        TransDateTime: transDT,
        AmtTip: parseFloat(r.AmtTip),
        TimeSlotStart: standardInterval.TimeSlotStart,
        Date: standardInterval.Date
      };
    });

  let slotMap = {};
  approved.forEach(txn => {
    const key = txn.Date + '|' + txn.TimeSlotStart.toISOString();
    if (!slotMap[key]) {
      slotMap[key] = { Date: txn.Date, TimeSlotStart: txn.TimeSlotStart, AmtTip: 0 };
    }
    slotMap[key].AmtTip += txn.AmtTip;
  });

  return Object.values(slotMap);
}

/**
 * Print total tips grouped by day and optionally save to CSV
 * @param {Array} transactions - Array of processed transaction records
 * @param {String} csvFilePath - Optional path to save the data as CSV
 * @return {Object} - Tips by day data
 */
function printTipsByDay(transactions, csvFilePath = null) {
  const tipsByDay = transactions.reduce((acc, txn) => {
    if (!acc[txn.Date]) {
      acc[txn.Date] = 0;
    }
    acc[txn.Date] += txn.AmtTip;
    return acc;
  }, {});

  console.log("Tips by Day:");
  
  // Create an array of objects for easier handling
  const tipsData = Object.keys(tipsByDay).sort().map(date => {
    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
    const tipAmount = tipsByDay[date];
    console.log(`  ${date} (${dayOfWeek}): $${tipAmount.toFixed(2)}`);
    
    return {
      Date: date,
      DayOfWeek: dayOfWeek,
      TipAmount: tipAmount.toFixed(2)
    };
  });
  
  // Save to CSV if a file path is provided
  if (csvFilePath) {
    saveTipsByDayToCSV(tipsData, csvFilePath);
  }
  
  return tipsData;
}

/**
 * Save tips by day data to a CSV file
 * @param {Array} tipsData - Array of objects with Date, DayOfWeek, and TipAmount
 * @param {String} filePath - Path to save the CSV file
 */
function saveTipsByDayToCSV(tipsData, filePath) {
  const header = 'Date,DayOfWeek,TipAmount\n';
  const rows = tipsData.map(row => 
    `${row.Date},${row.DayOfWeek},$${row.TipAmount}`
  ).join('\n');
  
  const csvContent = header + rows;
  fs.writeFileSync(filePath, csvContent);
  console.log(`Tips by day data saved to ${filePath}`);
}

module.exports = {
  loadTransactions,
  processTransactions,
  readCSV,
  printTipsByDay,
  saveTipsByDayToCSV
};