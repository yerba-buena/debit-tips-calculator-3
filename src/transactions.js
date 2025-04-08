// src/transactions.js

const fs = require('fs');
const csvParser = require('csv-parser');
const { floorToInterval } = require('./utils');

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

function processTransactions(transactions, intervalMinutes = 15) {
  let approved = transactions.filter(r => r.Approved && r.Approved.toLowerCase() === 'yes')
    .map(r => {
      const transDT = new Date(r.TransDateTime);
      const floored = floorToInterval(transDT, intervalMinutes);
      const dateStr = floored.toISOString().split('T')[0];
      return {
        TransDateTime: transDT,
        AmtTip: parseFloat(r.AmtTip),
        TimeSlotStart: floored,
        Date: dateStr
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