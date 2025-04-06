// cli_newVersion.js
//
// This script implements a new tip allocation logic that encourages teamwork by:
// 1. Chopping each day (midnight to midnight) into fixed intervals (e.g., 15 minutes).
// 2. Assigning transactions to these intervals (using transaction times floored to midnight).
//    For each interval, a tip summary is generated with:
//      - Total Tips (from transactions),
//      - FOH Tip Pool (85% of total),
//      - BOH Tip Pool (15% of total).
//    This summary is written to "interval_tip_summary.csv".
// 3. Separately processing clock times:
//    - The raw clock CSV is cleaned (skipping header rows and totals).
//    - Each employee’s shift is parsed, and the full day is partitioned into intervals.
//    - For each interval, the script determines which employees are present (ensuring each employee
//      is counted only once per interval) and categorizes them as FOH or BOH.
//    This presence info is logged to "interval_employee_presence.csv".
// 4. Finally, the script uses the tip summary and employee presence to split the tip pools evenly
//    among those present in each interval. It aggregates the allocations per employee, performs a sanity
//    check (to ensure total allocated equals total transaction tips), and outputs a final CSV
//    "final_employee_totals.csv" with each employee's tip total.
//
// Usage:
//   node cli_newVersion.js --clock ./input-data/clock-times.csv --transactions ./input-data/transactions.csv --output ./output/ --interval 15

const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const minimist = require("minimist");

// ---------------- Utility Functions ----------------

function parseDateTime(dateStr, timeStr) {
  return new Date(dateStr + " " + timeStr);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// Floors a date relative to midnight for a given interval (in minutes).
function floorToDayInterval(date, intervalMinutes = 15) {
  const base = new Date(date.toISOString().split("T")[0] + "T00:00:00");
  const diffMinutes = Math.floor((date - base) / 60000);
  const flooredMinutes = diffMinutes - (diffMinutes % intervalMinutes);
  return addMinutes(base, flooredMinutes);
}

// Generates an array of day intervals for a given date (from midnight to midnight).
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

// ---------------- Clock Data Processing ----------------

// Preprocess raw clock CSV content: skip the first two rows and remove the last row (totals).
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

// Returns an array of unique employees (by name) whose shift overlaps the given interval.
function getEmployeesForInterval(interval, employees) {
  const unique = new Map();
  employees.forEach(emp => {
    // An employee is considered present if any part of their shift overlaps the interval.
    if (emp.TimeIn < interval.TimeSlotEnd && emp.TimeOut > interval.TimeSlotStart) {
      if (!unique.has(emp.Employee)) {
        unique.set(emp.Employee, emp);
      }
    }
  });
  return Array.from(unique.values());
}

// ---------------- Transaction Processing ----------------

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

// ---------------- Step 1: Generate Interval Tip Summary ----------------

// For each day interval, assign transaction tips and compute FOH and BOH tip pools.
function generateIntervalTipSummary(dayIntervals, transactionsByInterval) {
  // Map transactions by interval key.
  let transMap = {};
  transactionsByInterval.forEach(txn => {
    const key = txn.Date + "|" + txn.TimeSlotStart.toISOString();
    transMap[key] = txn.AmtTip;
  });
  
  // Build summary for each day interval.
  const summary = dayIntervals.map(interval => {
    const key = interval.Date + "|" + interval.TimeSlotStart.toISOString();
    const amtTip = transMap[key] || 0;
    return {
      Date: interval.Date,
      TimeSlotStart: interval.TimeSlotStart,
      TimeSlotEnd: interval.TimeSlotEnd,
      TotalTips: amtTip,
      FOHTipPool: amtTip * 0.85,
      BOHTipPool: amtTip * 0.15
    };
  });
  return summary;
}

// ---------------- Step 2: Generate Employee Presence per Interval ----------------

// For each day interval, determine the unique list of employees present and their department.
function generateIntervalEmployeePresence(dayIntervals, employees) {
  return dayIntervals.map(interval => {
    const present = getEmployeesForInterval(interval, employees);
    const foh = present.filter(emp => emp.Department.toLowerCase().includes("front"));
    const boh = present.filter(emp => emp.Department.toLowerCase().includes("back"));
    return {
      Date: interval.Date,
      TimeSlotStart: interval.TimeSlotStart,
      TimeSlotEnd: interval.TimeSlotEnd,
      FOHEmployees: foh.map(emp => emp.Employee),
      BOHEmployees: boh.map(emp => emp.Employee),
      FOHCount: foh.length,
      BOHCount: boh.length
    };
  });
}

// ---------------- Step 3: Allocate Tips to Employees ----------------

// Using the interval tip summary and employee presence, allocate tips evenly among present employees.
function allocateTips(intervalTipSummary, intervalPresence) {
  const allocations = [];
  
  // For each interval, split FOH and BOH pools among present employees.
  intervalTipSummary.forEach(summary => {
    // Find corresponding presence record.
    const presence = intervalPresence.find(p => p.Date === summary.Date && 
      p.TimeSlotStart.getTime() === summary.TimeSlotStart.getTime());
    
    if (presence) {
      // Allocate FOH pool.
      if (presence.FOHCount > 0) {
        const shareFOH = summary.FOHTipPool / presence.FOHCount;
        presence.FOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareFOH });
        });
      }
      // Allocate BOH pool.
      if (presence.BOHCount > 0) {
        const shareBOH = summary.BOHTipPool / presence.BOHCount;
        presence.BOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareBOH });
        });
      }
    }
  });
  
  return allocations;
}

// ---------------- Step 4: Aggregate Allocations ----------------

// Sum up allocations per employee across all intervals.
function aggregateFinalTotals(allocations) {
  const totals = {};
  allocations.forEach(rec => {
    if (!totals[rec.Employee]) totals[rec.Employee] = 0;
    totals[rec.Employee] += rec.TipShare;
  });
  const final = [];
  for (let emp in totals) {
    final.push({ Employee: emp, TotalTips: totals[emp] });
  }
  return final;
}

// ---------------- CSV Helper ----------------

// Converts an array of objects to a CSV string using PapaParse.
function generateCSV(data) {
  return Papa.unparse(data);
}

// ---------------- Main Script ----------------

// Parse command-line arguments.
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

// ---------- Process Clock Data ----------
// Preprocess raw clock CSV.
const preprocessedClock = preprocessClockCSV(rawClock);
// Parse CSV with headers.
const clockDataParsed = Papa.parse(preprocessedClock, { header: true }).data;
// Process clock data to get employee shifts.
const cleanedClock = processClockData(clockDataParsed);

// ---------- Generate Full-Day Intervals ----------
// Get distinct dates from clock data.
const distinctDates = [...new Set(cleanedClock.map(emp => emp.Date))];
// Generate full-day intervals for each date.
let fullDayIntervals = [];
distinctDates.forEach(dateStr => {
  const intervals = generateDayIntervals(dateStr, intervalMinutes);
  fullDayIntervals = fullDayIntervals.concat(intervals);
});

// ---------- Process Transaction Data ----------
// Parse transactions CSV.
const transactionsData = Papa.parse(rawTransactions, { header: true }).data;
// Process transactions (flooring times relative to midnight).
const transactionsByInterval = processTransactions(transactionsData, intervalMinutes);

// ---------- Step 1: Generate Interval Tip Summary ----------
const intervalTipSummary = generateIntervalTipSummary(fullDayIntervals, transactionsByInterval);
// Write interval tip summary CSV.
const intervalTipCSV = generateCSV(intervalTipSummary);
const outputDir = path.resolve(args.output);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
const intervalTipCSVPath = path.join(outputDir, "interval_tip_summary.csv");
fs.writeFileSync(intervalTipCSVPath, intervalTipCSV, "utf8");
console.log(`Interval Tip Summary CSV written to: ${intervalTipCSVPath}`);

// ---------- Step 2: Generate Interval Employee Presence ----------
const intervalPresence = generateIntervalEmployeePresence(fullDayIntervals, cleanedClock);
// For logging, we can create a summary CSV with counts and concatenated employee names.
const intervalPresenceForCSV = intervalPresence.map(rec => ({
  Date: rec.Date,
  TimeSlotStart: rec.TimeSlotStart.toISOString(),
  TimeSlotEnd: rec.TimeSlotEnd.toISOString(),
  FOHCount: rec.FOHCount,
  BOHCount: rec.BOHCount,
  FOHEmployees: rec.FOHEmployees.join("; "),
  BOHEmployees: rec.BOHEmployees.join("; ")
}));
const intervalPresenceCSV = generateCSV(intervalPresenceForCSV);
const intervalPresenceCSVPath = path.join(outputDir, "interval_employee_presence.csv");
fs.writeFileSync(intervalPresenceCSVPath, intervalPresenceCSV, "utf8");
console.log(`Interval Employee Presence CSV written to: ${intervalPresenceCSVPath}`);

// ---------- Step 3: Allocate Tips to Employees ----------
const allocations = allocateTips(intervalTipSummary, intervalPresence);

// ---------- Step 4: Aggregate Final Totals ----------
const finalTotals = aggregateFinalTotals(allocations);

// ---------- Sanity Check ----------
// Sum of transaction tips.
const txnTotal = transactionsByInterval.reduce((sum, txn) => sum + txn.AmtTip, 0);
// Sum of allocated tips.
const allocatedTotal = finalTotals.reduce((sum, rec) => sum + rec.TotalTips, 0);
const tolerance = 0.01;
if (Math.abs(allocatedTotal - txnTotal) < tolerance) {
  console.log("Sanity Check Passed: Allocated totals match transaction totals.");
} else {
  console.error("Sanity Check FAILED: Discrepancy detected.");
  console.error(`Transaction Total: $${txnTotal.toFixed(2)}, Allocated Total: $${allocatedTotal.toFixed(2)}`);
}

// Write final employee totals CSV.
const finalTotalsCSV = generateCSV(finalTotals.map(r => ({
  Employee: r.Employee,
  TotalTips: r.TotalTips.toFixed(2)
})));
const finalTotalsCSVPath = path.join(outputDir, "final_employee_totals.csv");
fs.writeFileSync(finalTotalsCSVPath, finalTotalsCSV, "utf8");
console.log(`Final Employee Totals CSV written to: ${finalTotalsCSVPath}`);

console.log("Final Aggregated Tip Totals:");
finalTotals.forEach(row => {
  console.log(`${row.Employee}: $${row.TotalTips.toFixed(2)}`);
});