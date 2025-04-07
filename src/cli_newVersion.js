// cli_newVersion.js
//
// This script implements an enhanced tip allocation pipeline that encourages teamwork.
// It splits each day (midnight to midnight) into fixed intervals (default 15 minutes)
// and processes two datasets:
// 1. Transaction Data: Transactions are floored to these intervals and aggregated,
//    then split into tip pools (normally 85% FOH and 15% BOH).
// 2. Clock Data: Raw clock times are processed to determine which employees were on duty
//    in each interval (each employee is counted only once).
//
// New fallback logic in Step 3:
// - If both FOH and BOH are present, split as usual.
// - If only one category is present, allocate the entire interval's tips (100%) to that group.
// - If no one is present, the interval’s tips are orphaned.
// Orphaned tips for each day are then redistributed evenly among all employees on duty that day.
//
// The script outputs CSVs for inspection at each step and performs a sanity check,
// throwing an error if the final allocated total doesn’t match the total transaction tips.
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
// Preprocess raw clock CSV: skip first two rows and remove the last row (totals).
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
    if (emp.TimeIn < interval.TimeSlotEnd && emp.TimeOut > interval.TimeSlotStart) {
      if (!unique.has(emp.Employee)) {
        unique.set(emp.Employee, emp);
      }
    }
  });
  return Array.from(unique.values());
}

// ---------------- Transaction Processing ----------------
// Process transactions CSV and aggregate AmtTip per day interval (flooring relative to midnight).
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

// Aggregates daily employee hours worked from clock data.
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
// For each full-day interval, assign transaction tips and compute FOH and BOH tip pools.
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
// For each interval, allocate the tip pools to present employees.
// New fallback logic:
// - If both FOH and BOH are present, split as normal (85%/15%).
// - If only one group is present, allocate 100% of the interval's tips to that group.
function allocateTips(intervalTipSummary, intervalPresence) {
  const allocations = [];
  const orphaned = [];
  
  intervalTipSummary.forEach(summary => {
    const presence = intervalPresence.find(p => p.Date === summary.Date &&
      p.TimeSlotStart.getTime() === summary.TimeSlotStart.getTime());
    if (presence) {
      if (presence.FOHCount > 0 && presence.BOHCount > 0) {
        // Both groups present: use normal split.
        const shareFOH = summary.FOHTipPool / presence.FOHCount;
        presence.FOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareFOH });
        });
        const shareBOH = summary.BOHTipPool / presence.BOHCount;
        presence.BOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareBOH });
        });
      } else if (presence.FOHCount > 0) {
        // Only FOH present: allocate entire interval's tips to FOH.
        const share = summary.TotalTips / presence.FOHCount;
        presence.FOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: share });
        });
      } else if (presence.BOHCount > 0) {
        // Only BOH present: allocate entire interval's tips to BOH.
        const share = summary.TotalTips / presence.BOHCount;
        presence.BOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: share });
        });
      } else {
        // Shouldn't happen, but if presence record exists with zero in both, orphan.
        orphaned.push({ Date: summary.Date, Department: "BOTH", OrphanedTip: summary.TotalTips });
      }
    } else {
      // No presence record: orphan entire interval.
      orphaned.push({ Date: summary.Date, Department: "BOTH", OrphanedTip: summary.TotalTips });
    }
  });
  
  return { allocations, orphaned };
}

// ---------------- Step 4: Redistribute Orphaned Tips ----------------
// For each day, combine orphaned tips and redistribute evenly among all on‑duty employees.
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

// Verify that the date ranges match.
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

// ---------- Step 3: Allocate Tips to Employees (with fallback) ----------
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
if (Math.abs(allocatedTotal - txnTotal) >= 0.01) {
  throw new Error(`Sanity Check FAILED: Transaction Total ($${txnTotal.toFixed(2)}) does not match Allocated Total ($${allocatedTotal.toFixed(2)})`);
}
console.log("Sanity Check Passed: Allocated totals match transaction totals.");

// ---------- Additional Daily Summaries ----------

// Daily Transaction Summary (including orphaned tips).
const dailyTxnSummary = aggregateDailyTransactionSummary(intervalTipSummary);
const dailyOrphaned = orphaned.length ? aggregateDailyOrphanedTips(orphaned) : [];
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