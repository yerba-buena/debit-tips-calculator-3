// cli_newVersion.js
//
// This script implements a new tip allocation logic that encourages teamwork.
// It splits each day (midnight to midnight) into fixed intervals (e.g., 15 minutes),
// assigns transactions to those intervals, and separately determines which employees
// (from clock data) were on duty during each interval. Each interval’s tip pools are computed:
//   - Total Tips from transactions,
//   - FOH Tip Pool: 85% of total,
//   - BOH Tip Pool: 15% of total.
//
// For each interval, the script allocates the tip pools evenly among the unique employees
// present in each category. If an interval lacks FOH or BOH employees, the orphaned tip pool
// is recorded. Then, for each day, all orphaned tips are combined and redistributed evenly among
// all on‑duty employees for that day. The final aggregated tip totals per employee are output to a CSV.
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

// Floors a date relative to midnight for a given interval.
function floorToDayInterval(date, intervalMinutes = 15) {
  const base = new Date(date.toISOString().split("T")[0] + "T00:00:00");
  const diffMinutes = Math.floor((date - base) / 60000);
  const flooredMinutes = diffMinutes - (diffMinutes % intervalMinutes);
  return addMinutes(base, flooredMinutes);
}

// Generates full-day intervals (from midnight to midnight) for a given date.
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
// Preprocesses the raw clock CSV by skipping the first two rows and removing the last row (totals).
function preprocessClockCSV(content) {
  const lines = content.split(/\r?\n/);
  const cleanedLines = lines.slice(2, lines.length - 1);
  return cleanedLines.join("\n");
}

// Processes clock CSV rows into structured employee shift objects.
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

// Returns a deduplicated list of employees (by name) whose shifts overlap the given interval.
function getEmployeesForInterval(interval, employees) {
  const unique = new Map();
  employees.forEach(emp => {
    // Employee is present if any part of their shift overlaps the interval.
    if (emp.TimeIn < interval.TimeSlotEnd && emp.TimeOut > interval.TimeSlotStart) {
      if (!unique.has(emp.Employee)) {
        unique.set(emp.Employee, emp);
      }
    }
  });
  return Array.from(unique.values());
}

// ---------------- Transaction Processing ----------------
// Processes transactions CSV and aggregates AmtTip per day interval (flooring transaction time relative to midnight).
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
// For each full-day interval, assign transaction tips (floored relative to midnight)
// and compute the FOH (85%) and BOH (15%) tip pools.
function generateIntervalTipSummary(dayIntervals, transactionsByInterval) {
  let transMap = {};
  transactionsByInterval.forEach(txn => {
    const key = txn.Date + "|" + txn.TimeSlotStart.toISOString();
    transMap[key] = txn.AmtTip;
  });
  
  return dayIntervals.map(interval => {
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
}

// ---------------- Step 2: Generate Interval Employee Presence ----------------
// For each full-day interval, determine the unique list of employees present.
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
// For each interval, allocate the FOH and BOH tip pools evenly among present employees.
// If one category is missing, the entire tip pool for that category becomes orphaned.
function allocateTips(intervalTipSummary, intervalPresence) {
  const allocations = [];
  const orphaned = []; // To hold unallocated tips per interval
  
  intervalTipSummary.forEach(summary => {
    // Find matching presence record.
    const presence = intervalPresence.find(p => p.Date === summary.Date &&
      p.TimeSlotStart.getTime() === summary.TimeSlotStart.getTime());
    if (presence) {
      // Allocate FOH pool.
      if (presence.FOHCount > 0) {
        const shareFOH = summary.FOHTipPool / presence.FOHCount;
        presence.FOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareFOH });
        });
      } else {
        orphaned.push({ Date: summary.Date, OrphanedTip: summary.FOHTipPool });
      }
      // Allocate BOH pool.
      if (presence.BOHCount > 0) {
        const shareBOH = summary.BOHTipPool / presence.BOHCount;
        presence.BOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareBOH });
        });
      } else {
        orphaned.push({ Date: summary.Date, OrphanedTip: summary.BOHTipPool });
      }
    }
  });
  
  return { allocations, orphaned };
}

// ---------------- Step 4: Redistribute Orphaned Tips ----------------
// For each day, combine orphaned tips and redistribute them evenly among all on‑duty employees.
function redistributeOrphanedTips(orphaned, employees) {
  const sumByDay = {};
  orphaned.forEach(item => {
    if (!sumByDay[item.Date]) sumByDay[item.Date] = 0;
    sumByDay[item.Date] += item.OrphanedTip;
  });
  
  // Identify unique employees on duty per day from the clock data.
  const employeesByDay = {};
  employees.forEach(emp => {
    if (!employeesByDay[emp.Date]) employeesByDay[emp.Date] = new Set();
    employeesByDay[emp.Date].add(emp.Employee);
  });
  
  const redistribution = [];
  for (let date in sumByDay) {
    const totalOrphaned = sumByDay[date];
    const empList = Array.from(employeesByDay[date] || []);
    const share = empList.length > 0 ? totalOrphaned / empList.length : 0;
    empList.forEach(emp => {
      redistribution.push({ Employee: emp, Date: date, TipShare: share });
    });
  }
  return redistribution;
}

// ---------------- Step 5: Aggregate Final Totals ----------------
// Sum all allocations (direct and redistributed) per employee.
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

// ---------------- CSV Helper ----------------
// Converts an array of objects into a CSV string.
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

// Read input CSV files.
const rawClock = fs.readFileSync(path.resolve(args.clock), "utf8");
const rawTransactions = fs.readFileSync(path.resolve(args.transactions), "utf8");

// ---------- Process Clock Data ----------
const preprocessedClock = preprocessClockCSV(rawClock);
const clockDataParsed = Papa.parse(preprocessedClock, { header: true }).data;
const cleanedClock = processClockData(clockDataParsed);

// ---------- Generate Full-Day Intervals ----------
const distinctDates = [...new Set(cleanedClock.map(emp => emp.Date))];
let fullDayIntervals = [];
distinctDates.forEach(dateStr => {
  const intervals = generateDayIntervals(dateStr, intervalMinutes);
  fullDayIntervals = fullDayIntervals.concat(intervals);
});

// ---------- Process Transaction Data ----------
const transactionsData = Papa.parse(rawTransactions, { header: true }).data;
const transactionsByInterval = processTransactions(transactionsData, intervalMinutes);

// ---------- Step 1: Generate Interval Tip Summary ----------
const intervalTipSummary = generateIntervalTipSummary(fullDayIntervals, transactionsByInterval);
const intervalTipCSV = generateCSV(intervalTipSummary);
const outputDir = path.resolve(args.output);
if (!fs.existsSync(outputDir)) { fs.mkdirSync(outputDir, { recursive: true }); }
const intervalTipCSVPath = path.join(outputDir, "interval_tip_summary.csv");
fs.writeFileSync(intervalTipCSVPath, intervalTipCSV, "utf8");
console.log(`Interval Tip Summary CSV written to: ${intervalTipCSVPath}`);

// ---------- Step 2: Generate Interval Employee Presence ----------
const intervalPresence = generateIntervalEmployeePresence(fullDayIntervals, cleanedClock);
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
const { allocations, orphaned } = allocateTips(intervalTipSummary, intervalPresence);

// ---------- Step 4: Redistribute Orphaned Tips ----------
const redistribution = redistributeOrphanedTips(orphaned, cleanedClock);

// ---------- Step 5: Aggregate Final Totals ----------
const finalTotals = aggregateFinalTotals(allocations, redistribution);

// ---------- Sanity Check ----------
const txnTotal = transactionsByInterval.reduce((sum, txn) => sum + txn.AmtTip, 0);
const allocatedTotal = finalTotals.reduce((sum, rec) => sum + rec.TotalTips, 0);
const tolerance = 0.01;
if (Math.abs(allocatedTotal - txnTotal) < tolerance) {
  console.log("Sanity Check Passed: Allocated totals match transaction totals.");
} else {
  console.error("Sanity Check FAILED: Discrepancy detected.");
  console.error(`Transaction Total: $${txnTotal.toFixed(2)}, Allocated Total: $${allocatedTotal.toFixed(2)}`);
}

// ---------- Output Final CSV ----------
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