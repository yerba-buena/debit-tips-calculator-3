// src/clockData.js

const fs = require('fs');
const csvParser = require('csv-parser');
const { parseDateTime, addMinutes } = require('./utils');

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

async function loadClockData(filePath) {
  const data = await readCSV(filePath);
  return data;
}

function processClockData(clockData) {
  return clockData.map(row => {
    const employee = `${row['First Name']} ${row['Last Name']}`;
    const timeIn = parseDateTime(row['Date In'], row['Time In']);
    let timeOut = row['Time Out'] ? parseDateTime(row['Date Out'], row['Time Out']) : null;
    if (!timeOut && row['Total Less Break']) {
      const hours = parseFloat(row['Total Less Break']);
      timeOut = addMinutes(timeIn, hours * 60);
    }
    const dateStr = timeIn.toISOString().split('T')[0];
    return {
      Employee: employee,
      Department: row['Department'],
      Date: dateStr,
      TimeIn: timeIn,
      TimeOut: timeOut
    };
  });
}

function expandToIntervals(cleanedClock) {
  let intervals = [];
  cleanedClock.forEach(row => {
    let slotStart = new Date(row.TimeIn);
    while (slotStart < row.TimeOut) {
      let slotEnd = addMinutes(slotStart, 15);
      if (slotEnd <= row.TimeOut) {
        intervals.push({
          Employee: row.Employee,
          Department: row.Department,
          Date: row.Date,
          TimeSlotStart: new Date(slotStart),
          TimeSlotEnd: new Date(slotEnd)
        });
      }
      slotStart = slotEnd;
    }
  });
  return intervals;
}

module.exports = {
  loadClockData,
  processClockData,
  expandToIntervals,
  readCSV
};