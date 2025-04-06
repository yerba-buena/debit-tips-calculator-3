// cli_fullDay.js
//
// This script reads clock data and transaction CSVs,
// chunks the entire day (midnight to midnight) into intervals (default 15 minutes),
// assigns transactions to those intervals (by flooring relative to midnight),
// and then determines which employees were present during each interval
// (an employee is counted as present if any part of their shift overlaps the interval).
//
// Tip pools are computed per interval (85% to FOH, 15% to BOH), then divided equally among present employees.
// Any unallocated tips (from intervals with no staff in a department) are redistributed evenly among all employees for that day.
// Finally, the script prints out final aggregated tip totals per employee.
// Run using: node cli_fullDay.js --clock ./input-data/clock-times.csv --transactions ./input-data/transactions.csv --interval 15

const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const minimist = require("minimist");

// ----- Utility Functions -----
function parseDateTime(dateStr, timeStr) {
  return new Date(dateStr + " " + timeStr);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// Floors a date relative to midnight for the given interval.
function floorToDayInterval(date, intervalMinutes = 15) {
  const base = new Date(date.toISOString().split("T")[0] + "T00:00:00");
  const diffMinutes = Math.floor((date - base) / 60000);
  const flooredMinutes = diffMinutes - (diffMinutes % intervalMinutes);
  return addMinutes(base, flooredMinutes);
}

// Generates an array of day intervals (from midnight to midnight) for a given date.
function generateDayIntervals(dateStr, intervalMinutes = 15) {
  const base = new Date(dateStr + "T00:00:00");
  const intervals = [];
  const numIntervals = 1440 / intervalMinutes;
  for (let i = 0; i < numIntervals; i++) {
    const start = addMinutes(base, i * intervalMinutes);
    const end = addMinutes(start, intervalMinutes);
    intervals.push({ Date: dateStr, TimeSlotStart: start, TimeSlotEnd: end });
  }
  return intervals;
}

// ----- Clock Data Processing -----
// Preprocess raw clock CSV: skip first two lines and remove the last line (totals)
function preprocessClockCSV(content) {
  const lines = content.split(/\r?\n/);
  const cleanedLines = lines.slice(2, lines.length - 1);
  return cleanedLines.join("\n");
}

// Process clock data rows into structured objects.
function processClockData(clockData) {
  return clockData.map(row => {
    const employee = row["First Name"] + " " + row["Last Name"];
    const timeIn = parseDateTime(row["Date In"], row["Time In"]);
    let timeOut = row["Time Out"] ? parseDateTime(row["Date Out"], row["Time Out"]) : null;
    if (!timeOut && row["Total Less Break"]) {
      const hours = parseFloat(row["Total Less Break"]);
      timeOut = addMinutes(timeIn, hours * 60);
    }
    const dateStr = timeIn.toISOString().split("T")[0];
    return {
      Employee: employee,
      Department: row["Department"],
      Date: dateStr,
      TimeIn: timeIn,
      TimeOut: timeOut
    };
  });
}

// For a given interval (with start and end) and a list of employee shifts,
// return an array of employees who were present (if their shift overlaps the interval).
function getEmployeesForInterval(interval, employees) {
  return employees.filter(emp => {
    // Employee is considered present if any part of their shift overlaps the interval.
    return emp.TimeIn < interval.TimeSlotEnd && emp.TimeOut > interval.TimeSlotStart;
  });
}

// ----- Transaction Processing -----
// Process transactions CSV and aggregate AmtTip per day interval (floored relative to midnight).
function processTransactions(transactions, intervalMinutes = 15) {
  let approved = transactions.filter(r => r.Approved && r.Approved.toLowerCase() === "yes")
    .map(r => {
      const transDT = new Date(r.TransDateTime);
      const floored = floorToDayInterval(transDT, intervalMinutes);
      const dateStr = floored.toISOString().split("T")[0];
      return {
        TransDateTime: transDT,
        AmtTip: parseFloat(r.AmtTip),
        TimeSlotStart: floored,
        Date: dateStr
      };
    });
  
  let map = {};
  approved.forEach(txn => {
    const key = txn.Date + "|" + txn.TimeSlotStart.toISOString();
    if (!map[key]) {
      map[key] = { Date: txn.Date, TimeSlotStart: txn.TimeSlotStart, AmtTip: 0 };
    }
    map[key].AmtTip += txn.AmtTip;
  });
  return Object.values(map);
}

// ----- Tip Allocation -----
// For each day interval, compute tip pools and allocate tips to employees present.
function allocateTipsForDay(dayIntervals, transactionsByInterval, employees, intervalMinutes = 15) {
  // Map transactions by interval key.
  let transMap = {};
  transactionsByInterval.forEach(txn => {
    const key = txn.Date + "|" + txn.TimeSlotStart.toISOString();
    transMap[key] = txn.AmtTip;
  });
  
  // For each day interval, determine employees present and calculate individual shares.
  const allocations = [];
  // Unallocated pool will hold any amounts where one department has no employees.
  let unallocatedByInterval = [];
  
  dayIntervals.forEach(interval => {
    const key = interval.Date + "|" + interval.TimeSlotStart.toISOString();
    const amtTip = transMap[key] || 0;
    // Tip pools: FOH gets 85%, BOH gets 15%.
    const fohtipPool = amtTip * 0.85;
    const bohtipPool = amtTip * 0.15;
    
    // Get employees present in this interval.
    const present = getEmployeesForInterval(interval, employees);
    // Split into FOH and BOH.
    const fohPresent = present.filter(emp => emp.Department.toLowerCase().includes("front"));
    const bohPresent = present.filter(emp => emp.Department.toLowerCase().includes("back"));
    
    // Compute allocation for each employee present in this interval.
    if (fohPresent.length > 0) {
      const share = fohtipPool / fohPresent.length;
      fohPresent.forEach(emp => {
        allocations.push({
          Employee: emp.Employee,
          Date: emp.Date,
          TipShare: share
        });
      });
    } else {
      // No FOH present: FOH pool remains unallocated.
      unallocatedByInterval.push({ Date: interval.Date, UnallocatedTip: fohtipPool });
    }
    
    if (bohPresent.length > 0) {
      const share = bohtipPool / bohPresent.length;
      bohPresent.forEach(emp => {
        allocations.push({
          Employee: emp.Employee,
          Date: emp.Date,
          TipShare: share
        });
      });
    } else {
      unallocatedByInterval.push({ Date: interval.Date, UnallocatedTip: bohtipPool });
    }
  });
  
  return { allocations, unallocatedByInterval };
}

// Redistribute unallocated tips per day evenly among all employees who worked that day.
function redistributeUnallocatedTips(unallocatedByInterval, employees) {
  // Sum unallocated tips per day.
  const sumByDay = {};
  unallocatedByInterval.forEach(item => {
    if (!sumByDay[item.Date]) sumByDay[item.Date] = 0;
    sumByDay[item.Date] += item.UnallocatedTip;
  });
  
  // Determine employees present per day.
  const employeesByDay = {};
  employees.forEach(emp => {
    if (!employeesByDay[emp.Date]) employeesByDay[emp.Date] = new Set();
    employeesByDay[emp.Date].add(emp.Employee);
  });
  
  const redistribution = [];
  for (let date in sumByDay) {
    const totalUnalloc = sumByDay[date];
    const empList = Array.from(employeesByDay[date] || []);
    const share = empList.length > 0 ? totalUnalloc / empList.length : 0;
    empList.forEach(emp => {
      redistribution.push({ Employee: emp, Date: date, TipShare: share });
    });
  }
  return redistribution;
}

// Aggregate allocations (direct + redistributed) per employee.
function aggregateFinalTotals(allocations, redistribution) {
  const totals = {};
  allocations.forEach(rec => {
    if (!totals[rec.Employee]) totals[rec.Employee] = 0;
    totals[rec.Employee] += rec.TipShare;
  });
  redistribution.forEach(rec => {
    if (!totals[rec.Employee]) totals[rec.Employee] = 0;
    totals[rec.Employee] += rec.TipShare;
  });
  const final = [];
  for (let emp in totals) {
    final.push({ Employee: emp, TotalTips: totals[emp] });
  }
  return final;
}

// ----- Main Script -----
// Parse command line arguments.
const args = minimist(process.argv.slice(2), {
  string: ["clock", "transactions", "output", "interval"],
  alias: { c: "clock", t: "transactions", o: "output", i: "interval" },
  default: {
    clock: "./input-data/clock-times.csv",
    transactions: "./input-data/transactions.csv",
    output: "./output/",
    interval: "15"
  }
});

const intervalMinutes = parseInt(args.interval, 10);

// Read CSV files.
const rawClock = fs.readFileSync(path.resolve(args.clock), "utf8");
const rawTransactions = fs.readFileSync(path.resolve(args.transactions), "utf8");

// Preprocess and parse clock data.
const preprocessedClock = preprocessClockCSV(rawClock);
const clockData = Papa.parse(preprocessedClock, { header: true }).data;
const cleanedClock = processClockData(clockData);

// Get distinct dates from clock data.
const distinctDates = [...new Set(cleanedClock.map(emp => emp.Date))];

// Generate full-day intervals for each date.
let fullDayIntervals = [];
distinctDates.forEach(dateStr => {
  const intervals = generateDayIntervals(dateStr, intervalMinutes);
  fullDayIntervals = fullDayIntervals.concat(intervals);
});

// Process transactions; now we floor relative to midnight.
const transactionsData = Papa.parse(rawTransactions, { header: true }).data;
const transactionsByInterval = processTransactions(transactionsData, intervalMinutes);

// For each day interval, we need to know which employees were working.
const allocationsPerInterval = allocateTipsForDay(fullDayIntervals, transactionsByInterval, cleanedClock, intervalMinutes);

// Redistribute any unallocated tips across all employees for that day.
const redistribution = redistributeUnallocatedTips(allocationsPerInterval.unallocatedByInterval, cleanedClock);

// Aggregate final totals.
const finalTotals = aggregateFinalTotals(allocationsPerInterval.allocations, redistribution);

// Output final results.
console.log("Final Aggregated Tip Totals:");
finalTotals.forEach(row => {
  console.log(`${row.Employee}: $${row.TotalTips.toFixed(2)}`);
});