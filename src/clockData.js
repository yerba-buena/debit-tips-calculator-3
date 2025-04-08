// src/clockData.js

const fs = require('fs');
const csvParser = require('csv-parser');
const { parseDateTime, addMinutes } = require('./utils');
const { Readable } = require('stream');

// Reads CSV file without any pre-processing (not used for clock data)
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

/**
 * loadClockData - Reads the raw clock times CSV, pre-processes it by:
 *  - Skipping the first two rows (which contain time range info and extra header info)
 *  - Removing the last row (totals)
 * Then parses the cleaned CSV content.
 */
async function loadClockData(filePath) {
  // Read entire file as text
  const rawContent = fs.readFileSync(filePath, 'utf8');
  // Split into lines
  const lines = rawContent.split(/\r?\n/);
  // Remove the first two rows and the last row (totals)
  const cleanedLines = lines.slice(2, lines.length - 1);
  // Join the cleaned lines back into a CSV string
  const cleanedCSV = cleanedLines.join('\n');
  
  // Create a readable stream from the cleaned CSV string
  return new Promise((resolve, reject) => {
    let results = [];
    Readable.from([cleanedCSV])
      .pipe(csvParser())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

/**
 * processClockData - Transforms the raw clock data into a cleaned format.
 * Combines first and last names, parses clock in/out times, and fills missing
 * clock-out times using 'Total Less Break' (assumed to be hours).
 */
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

/**
 * expandToIntervals - Expands each shift into contiguous time intervals.
 * Accepts an optional interval parameter (in minutes) with a default of 15.
 * For fairness: if an employee clocks out partway through an interval,
 * they are still credited with the entire interval.
 *
 * The interval must be between 2 and 60 minutes and evenly divide 1440.
 * If invalid, defaults to 15 minutes.
 * 
 * Note: Intervals are based on actual clock-in time, not aligned to fixed
 * time boundaries (like :00, :15, etc.). This ensures accurate representation
 * of employee work time, but requires careful syncing with transaction data.
 */
function expandToIntervals(cleanedClock, intervalMinutes = 15) {
  // Validate the intervalMinutes parameter
  if (
    typeof intervalMinutes !== 'number' ||
    intervalMinutes < 2 ||
    intervalMinutes > 60 ||
    1440 % intervalMinutes !== 0
  ) {
    console.warn(
      `Invalid interval (${intervalMinutes} minutes). Falling back to default of 15 minutes.`
    );
    intervalMinutes = 15;
  }
  
  let intervals = [];
  cleanedClock.forEach(row => {
    let slotStart = new Date(row.TimeIn);
    // Continue generating intervals as long as slotStart is before the clock-out time.
    // Even if the employee clocks out in the middle of an interval,
    // we include that entire block.
    while (slotStart < row.TimeOut) {
      let slotEnd = addMinutes(slotStart, intervalMinutes);
      intervals.push({
        Employee: row.Employee,
        Department: row.Department,
        Date: row.Date,
        TimeSlotStart: new Date(slotStart),
        TimeSlotEnd: new Date(slotEnd)
      });
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