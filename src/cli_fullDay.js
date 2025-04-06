// cli_fullDay.js
//
// This script reads clock data and transaction CSVs,
// chunks the entire day (midnight to midnight) into intervals (default 15 minutes),
// assigns transactions to those intervals (flooring relative to midnight),
// and then determines which employees were on duty (whose shifts overlap the interval).
//
// For each interval, tips are split into two pools (85% FOH, 15% BOH) and allocated equally among
// the employees present in that department. Any unallocated tips (from intervals missing staff)
// are then redistributed evenly among all employees working that day.
// Finally, the script performs a sanity check to ensure the sum of final allocations equals the total tips
// and outputs a final CSV file of aggregated tip totals per employee.
//
// Usage:
//   node cli_fullDay.js --clock ./input-data/clock-times.csv --transactions ./input-data/transactions.csv --output ./output/ --interval 15

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
// Preprocess raw clock CSV: skip first two lines and remove the last row (totals)
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

// Returns an array of employees whose shifts overlap a given interval.
function getEmployeesForInterval(interval, employees) {
  return employees.filter(emp => {
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
// For each day interval, determine which employees were on shift, and allocate tips.
function allocateTipsForDay(dayIntervals, transactionsByInterval, employees, intervalMinutes = 15) {
  // Map transactions by interval key.
  let transMap = {};
  transactionsByInterval.forEach(txn => {
    const key = txn.Date + "|" + txn.TimeSlotStart.toISOString();
    transMap[key] = txn.AmtTip;
  });
  
  // For each day interval, get employees on shift.
  const allocations = [];
  const unallocatedByInterval = [];
  
  dayIntervals.forEach(interval => {
    const key = interval.Date + "|" + interval.TimeSlotStart.toISOString();
    const amtTip = transMap[key] || 0;
    const fohtipPool = amtTip * 0.85;
    const bohtipPool = amtTip * 0.15;
    
    const present = getEmployeesForInterval(interval, employees);
    const fohPresent = present.filter(emp => emp.Department.toLowerCase().includes("front"));
    const bohPresent = present.filter(emp => emp.Department.toLowerCase().includes("back"));
    
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

// Redistribute unallocated tips evenly among all employees for that day.
function redistributeUnallocatedTips(unallocatedByInterval, employees) {
  const sumByDay = {};
  unallocatedByInterval.forEach(item => {
    if (!sumByDay[item.Date]) sumByDay[item.Date] = 0;
    sumByDay[item.Date] += item.UnallocatedTip;
  });
  
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

// Aggregates final tip totals per employee.
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

// Process transactions (flooring relative to midnight).
const transactionsData = Papa.parse(rawTransactions, { header: true }).data;
const transactionsByInterval = processTransactions(transactionsData, intervalMinutes);

// For each day interval, determine which employees were present and allocate tips.
const { allocations, unallocatedByInterval } = allocateTipsForDay(fullDayIntervals, transactionsByInterval, cleanedClock, intervalMinutes);

// Redistribute unallocated tips.
const redistribution = redistributeUnallocatedTips(unallocatedByInterval, cleanedClock);

// Aggregate final tip totals.
const finalTotals = aggregateFinalTotals(allocations, redistribution);

// ----- Sanity Checks -----
// Compute total tip amount from transactions.
const txnTotal = transactionsByInterval.reduce((sum, txn) => sum + txn.AmtTip, 0);
// Compute final allocated tip sum.
const finalAllocated = finalTotals.reduce((sum, rec) => sum + rec.TotalTips, 0);
const tolerance = 0.01;
if (Math.abs(finalAllocated - txnTotal) < tolerance) {
  console.log("Sanity Check Passed: Final allocated tips match total transaction tips.");
} else {
  console.error("Sanity Check FAILED: Final allocated tips do not match total transaction tips.");
  console.error(`Total Transaction Tips: $${txnTotal.toFixed(2)}, Final Allocated: $${finalAllocated.toFixed(2)}`);
}

// ----- Output Final CSV -----
// Generate CSV string for final totals.
const finalCSV = Papa.unparse(finalTotals.map(r => ({
  Employee: r.Employee,
  TotalTips: r.TotalTips.toFixed(2)
})));

// Ensure output directory exists.
const outputDir = path.resolve(args.output);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write final CSV file.
const finalCSVPath = path.join(outputDir, "final_employee_totals.csv");
fs.writeFileSync(finalCSVPath, finalCSV, "utf8");

console.log("Final Aggregated Tip Totals:");
finalTotals.forEach(row => {
  console.log(`${row.Employee}: $${row.TotalTips.toFixed(2)}`);
});
console.log(`Final CSV written to: ${finalCSVPath}`);