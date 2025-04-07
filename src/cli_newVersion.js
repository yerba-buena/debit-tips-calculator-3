// cli_newVersion.js
//
// This script implements an enhanced tip allocation pipeline that encourages teamwork.
// It splits each day (midnight to midnight) into fixed intervals (default 15 minutes),
// and then processes two separate datasets:
// 1. Transaction Data: Transactions are floored to these intervals, aggregated,
//    and then split into FOH (85%) and BOH (15%) tip pools. This creates an interval tip summary.
// 2. Clock Data: The raw clock times (after cleaning extra header rows and totals) are processed
//    to determine which employees were present during each interval (deduplicating employees with overlapping shifts).
//
// Next, for each interval the tip pools are allocated evenly among the employees present in each department.
// If one department is missing in an interval, that tip pool becomes orphaned.
// Then, orphaned tips are aggregated per day and redistributed evenly among all on‑duty employees.
// Additionally, daily summaries are computed that show:
//  - Total transaction tips per day, with the FOH/BOH split and orphaned tip amounts.
//  - Total hours worked per employee per day.
//  - Daily tip allocations per employee.
//
// The script prints the overall date ranges from clock and transaction data (and throws an error if they don’t match).
// It also performs a sanity check (throwing an error if the final allocated tip total does not match total transaction tips).
//
// Finally, several CSVs are written for inspection:
//    • interval_tip_summary.csv
//    • interval_employee_presence.csv
//    • orphaned_tips.csv
//    • daily_transaction_summary.csv (merged with orphaned tip data)
//    • daily_employee_hours.csv
//    • daily_employee_tip_allocation.csv
//    • final_employee_totals.csv
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

// Generates full-day intervals (midnight to midnight) for a given date.
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
// Preprocess raw clock CSV: skip the first two rows and remove the last row (totals).
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

// Returns a deduplicated list of employees (by name) whose shifts overlap the given interval.
function getEmployeesForInterval(interval, employees) {
  const unique = new Map();
  employees.forEach(emp => {
    // Employee is considered present if any part of their shift overlaps the interval.
    if (emp.TimeIn < interval.TimeSlotEnd && emp.TimeOut > interval.TimeSlotStart) {
      if (!unique.has(emp.Employee)) {
        unique.set(emp.Employee, emp);
      }
    }
  });
  return Array.from(unique.values());
}

// ---------------- Transaction Processing ----------------
// Processes transactions CSV and aggregates AmtTip per day interval (flooring relative to midnight).
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

// ---------------- Daily Range & Summary Functions ----------------

// Computes the date range (min and max) from data with a Date property.
function computeDateRange(data) {
  const dates = data.map(d => new Date(d.Date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  return { min: minDate, max: maxDate };
}

// Aggregates daily transaction summary from interval tip summary.
function aggregateDailyTransactionSummary(intervalTipSummary) {
  const daily = {};
  intervalTipSummary.forEach(item => {
    if (!daily[item.Date]) {
      daily[item.Date] = { TotalTips: 0, FOHTipPool: 0, BOHTipPool: 0 };
    }
    daily[item.Date].TotalTips += item.TotalTips;
    daily[item.Date].FOHTipPool += item.FOHTipPool;
    daily[item.Date].BOHTipPool += item.BOHTipPool;
  });
  const summary = [];
  for (let date in daily) {
    summary.push({ Date: date, ...daily[date] });
  }
  return summary;
}

// Aggregates daily orphaned tips from orphaned items (by department).
function aggregateDailyOrphanedTips(orphaned) {
  const daily = {};
  orphaned.forEach(item => {
    if (!daily[item.Date]) {
      daily[item.Date] = { FOHOrphaned: 0, BOHOrphaned: 0, TotalOrphaned: 0 };
    }
    if (item.Department === "FOH") {
      daily[item.Date].FOHOrphaned += item.OrphanedTip;
    } else if (item.Department === "BOH") {
      daily[item.Date].BOHOrphaned += item.OrphanedTip;
    }
    daily[item.Date].TotalOrphaned += item.OrphanedTip;
  });
  const result = [];
  for (let date in daily) {
    result.push({ Date: date, ...daily[date] });
  }
  return result;
}

// Aggregates daily employee hours from clock data.
function aggregateDailyEmployeeHours(clockData) {
  const hoursByEmployee = {};
  clockData.forEach(rec => {
    const duration = (rec.TimeOut - rec.TimeIn) / (1000 * 3600);
    const key = rec.Employee + "|" + rec.Date;
    if (!hoursByEmployee[key]) {
      hoursByEmployee[key] = { Employee: rec.Employee, Date: rec.Date, HoursWorked: 0 };
    }
    hoursByEmployee[key].HoursWorked += duration;
  });
  return Object.values(hoursByEmployee);
}

// Aggregates daily tip allocations per employee.
function aggregateDailyEmployeeTips(allocations, redistribution) {
  const dailyAlloc = {};
  allocations.concat(redistribution).forEach(rec => {
    const key = rec.Employee + "|" + rec.Date;
    if (!dailyAlloc[key]) {
      dailyAlloc[key] = { Employee: rec.Employee, Date: rec.Date, TipTotal: 0 };
    }
    dailyAlloc[key].TipTotal += rec.TipShare;
  });
  return Object.values(dailyAlloc);
}

// ---------------- Step 1: Generate Interval Tip Summary ----------------
// For each full-day interval, assign transaction tips and compute FOH/BOH tip pools.
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
// If one category is missing, record the orphaned tip pool with the department.
function allocateTips(intervalTipSummary, intervalPresence) {
  const allocations = [];
  const orphaned = [];
  
  intervalTipSummary.forEach(summary => {
    const presence = intervalPresence.find(p => p.Date === summary.Date &&
      p.TimeSlotStart.getTime() === summary.TimeSlotStart.getTime());
    if (presence) {
      if (presence.FOHCount > 0) {
        const shareFOH = summary.FOHTipPool / presence.FOHCount;
        presence.FOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareFOH });
        });
      } else {
        orphaned.push({ Date: summary.Date, Department: "FOH", OrphanedTip: summary.FOHTipPool });
      }
      if (presence.BOHCount > 0) {
        const shareBOH = summary.BOHTipPool / presence.BOHCount;
        presence.BOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareBOH });
        });
      } else {
        orphaned.push({ Date: summary.Date, Department: "BOH", OrphanedTip: summary.BOHTipPool });
      }
    }
  });
  
  return { allocations, orphaned };
}

// ---------------- Step 4: Redistribute Orphaned Tips ----------------
// For each day, combine orphaned tips (separately by department) and then redistribute the total evenly among all on‑duty employees.
function redistributeOrphanedTips(orphaned, employees) {
  const sumByDay = {};
  orphaned.forEach(item => {
    if (!sumByDay[item.Date]) sumByDay[item.Date] = 0;
    sumByDay[item.Date] += item.OrphanedTip;
  });
  
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
// Sum allocations (direct and redistributed) per employee.
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
const clockRange = computeDateRange(cleanedClock);
console.log(`Clock Data Date Range: ${clockRange.min.toISOString().split("T")[0]} to ${clockRange.max.toISOString().split("T")[0]}`);

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
const txnRange = computeDateRange(transactionsByInterval);
console.log(`Transaction Data Date Range: ${txnRange.min.toISOString().split("T")[0]} to ${txnRange.max.toISOString().split("T")[0]}`);

// Verify date ranges match.
if (txnRange.min.toISOString().split("T")[0] !== clockRange.min.toISOString().split("T")[0] ||
    txnRange.max.toISOString().split("T")[0] !== clockRange.max.toISOString().split("T")[0]) {
  throw new Error("Date range mismatch between clock data and transaction data.");
}

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

// ---------- Step 4: Output Orphaned Tips CSV ----------
const orphanedCSV = generateCSV(orphaned.map(r => ({
  Date: r.Date,
  Department: r.Department,
  OrphanedTip: r.OrphanedTip.toFixed(2)
})));
const orphanedCSVPath = path.join(outputDir, "orphaned_tips.csv");
fs.writeFileSync(orphanedCSVPath, orphanedCSV, "utf8");
console.log(`Orphaned Tips CSV written to: ${orphanedCSVPath}`);

// ---------- Step 5: Redistribute Orphaned Tips ----------
const redistribution = redistributeOrphanedTips(orphaned, cleanedClock);

// ---------- Step 6: Aggregate Final Totals ----------
const finalTotals = aggregateFinalTotals(allocations, redistribution);

// ---------- Sanity Check ----------
const txnTotal = transactionsByInterval.reduce((sum, txn) => sum + txn.AmtTip, 0);
const allocatedTotal = finalTotals.reduce((sum, rec) => sum + rec.TotalTips, 0);
const tolerance = 0.01;
if (Math.abs(allocatedTotal - txnTotal) >= tolerance) {
  throw new Error(`Sanity Check FAILED: Transaction Total ($${txnTotal.toFixed(2)}) does not match Allocated Total ($${allocatedTotal.toFixed(2)})`);
}
console.log("Sanity Check Passed: Allocated totals match transaction totals.");

// ---------- Additional Daily Summaries ----------

// Daily Transaction Summary (with orphaned tips merged).
const dailyTxnSummary = aggregateDailyTransactionSummary(intervalTipSummary);
const dailyOrphaned = aggregateDailyOrphanedTips(orphaned);
const dailyTxnWithOrphaned = dailyTxnSummary.map(item => {
  const orphanedItem = dailyOrphaned.find(o => o.Date === item.Date) || { TotalOrphaned: 0 };
  return { ...item, TotalOrphaned: orphanedItem.TotalOrphaned.toFixed(2) };
});
const dailyTxnCSV = generateCSV(dailyTxnWithOrphaned);
const dailyTxnCSVPath = path.join(outputDir, "daily_transaction_summary.csv");
fs.writeFileSync(dailyTxnCSVPath, dailyTxnCSV, "utf8");
console.log(`Daily Transaction Summary CSV written to: ${dailyTxnCSVPath}`);

// Daily Employee Hours.
const dailyEmployeeHours = aggregateDailyEmployeeHours(cleanedClock);
const dailyEmployeeHoursCSV = generateCSV(dailyEmployeeHours);
const dailyEmployeeHoursCSVPath = path.join(outputDir, "daily_employee_hours.csv");
fs.writeFileSync(dailyEmployeeHoursCSVPath, dailyEmployeeHoursCSV, "utf8");
console.log(`Daily Employee Hours CSV written to: ${dailyEmployeeHoursCSVPath}`);

// Daily Employee Tip Allocation.
const dailyEmployeeTips = aggregateDailyEmployeeTips(allocations, redistribution);
const dailyEmployeeTipsCSV = generateCSV(dailyEmployeeTips);
const dailyEmployeeTipsCSVPath = path.join(outputDir, "daily_employee_tip_allocation.csv");
fs.writeFileSync(dailyEmployeeTipsCSVPath, dailyEmployeeTipsCSV, "utf8");
console.log(`Daily Employee Tip Allocation CSV written to: ${dailyEmployeeTipsCSVPath}`);

// ---------- Final Aggregated Totals ----------
const finalTotalsCSV = generateCSV(finalTotals.map(r => ({
  Employee: r.Employee,
  TotalTips: r.TotalTips.toFixed(2)
})));
const finalTotalsCSVPath = path.join(outputDir, "final_employee_totals.csv");
fs.writeFileSync(finalTotalsCSVPath, finalTotalsCSV, "utf8");
console.log(`Final Employee Totals CSV written to: ${finalTotalsCSVPath}`);

// ---------- Print Final Totals to Terminal ----------
console.log("Final Aggregated Tip Totals:");
finalTotals.forEach(row => {
  console.log(`${row.Employee}: $${row.TotalTips.toFixed(2)}`);
});