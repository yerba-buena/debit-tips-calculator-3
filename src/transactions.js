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

module.exports = {
  loadTransactions,
  processTransactions,
  readCSV
};