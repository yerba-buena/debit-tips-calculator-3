// src/clockData.js

const fs = require('fs');
const csvParser = require('csv-parser');
const { parseDateTime, addMinutes, createStandardInterval } = require('./utils');
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
  // Debug: Count entries with missing clock-out times
  const missedClockouts = clockData.filter(row => 
    row['Time Out'] === '-' || row['Date Out'] === 'Missed Clockout');
  
  if (missedClockouts.length > 0) {
    console.log(`Found ${missedClockouts.length} missed clockouts.`);
    // Log a few examples
    missedClockouts.slice(0, 3).forEach(entry => {
      console.log(`  Employee: ${entry['First Name']} ${entry['Last Name']}, Date: ${entry['Date In']}, Time In: ${entry['Time In']}, Time Out: ${entry['Time Out']}`);
      console.log(`  Total Less Break: ${entry['Total Less Break']} (using for timeOut calculation)`);
    });
  }
  
  const processed = clockData.map(row => {
    const employee = `${row['First Name']} ${row['Last Name']}`;
    const timeIn = parseDateTime(row['Date In'], row['Time In']);
    let timeOut = row['Time Out'] && row['Time Out'] !== '-' ? parseDateTime(row['Date Out'], row['Time Out']) : null;
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
  
  // Check for any entries with missing timeOut after processing
  const missingTimeOuts = processed.filter(row => !row.TimeOut);
  if (missingTimeOuts.length > 0) {
    console.error(`WARNING: ${missingTimeOuts.length} entries still have missing TimeOut values after processing`);
  }
  
  return processed;
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
 * Note: Intervals are floored to standard time boundaries (like :00, :15, etc.)
 * to ensure alignment with transaction data.
 */
function expandToIntervals(cleanedClock, intervalMinutes = 15) {
  // Add date range logging to understand the scope of clock data
  const dates = new Set(cleanedClock.map(entry => entry.Date));
  const sortedDates = Array.from(dates).sort();
  console.log(`Clock data covers ${dates.size} unique dates from ${sortedDates[0]} to ${sortedDates[sortedDates.length-1]}`);
  
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
    // Floor the timeIn to the standard interval boundary
    let standardInterval = createStandardInterval(row.TimeIn, intervalMinutes, row.Date);
    let slotStart = standardInterval.TimeSlotStart;
    
    // Continue generating intervals as long as slotStart is before the clock-out time
    while (slotStart < row.TimeOut) {
      let standardInterval = createStandardInterval(slotStart, intervalMinutes, row.Date);
      intervals.push({
        Employee: row.Employee,
        Department: row.Department,
        Date: standardInterval.Date,
        TimeSlotStart: standardInterval.TimeSlotStart,
        TimeSlotEnd: standardInterval.TimeSlotEnd
      });
      slotStart = standardInterval.TimeSlotEnd;
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