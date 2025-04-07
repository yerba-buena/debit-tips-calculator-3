// cli_newVersion.js
//
// This script implements an enhanced tip allocation pipeline that encourages teamwork.
// It splits each day (midnight to midnight) into fixed intervals (default 15 minutes)
// and processes two datasets:
// 1. Transaction Data: Transaction times are floored relative to midnight and aggregated into intervals,
//    then split into tip pools (normally 85% for FOH and 15% for BOH).
// 2. Clock Data: Raw clock times (after cleaning) are processed and grouped by employee and day
//    into one or more contiguous time ranges. Then, for each full‑day interval, the script marks an employee
//    as present if any of their merged intervals overlaps that interval.
// 
// The script then allocates tips in each interval using these presence records with the following rules:
//  - If both FOH and BOH are present, split the tips as normal (85%/15%).
//  - If only one group is present, allocate 100% of the interval’s tips to that group.
//  - If no one is present in an interval, the entire interval’s tip is marked as orphaned.
// In addition, orphaned tips per day are redistributed evenly among all on‑duty employees.
// 
// For debugging, the script outputs CSV files for:
//   • Merged Clock Data ("merged_clock_data.csv")
//   • Interval Tip Summary ("interval_tip_summary.csv")
//   • Interval Employee Presence ("interval_employee_presence.csv")
//   • Detailed Orphaned Tips ("orphaned_tips.csv")
//   • Interval Coverage Summary ("interval_coverage_summary.csv")
//   • Daily Transaction Summary (merged with orphaned tips, "daily_transaction_summary.csv")
//   • Daily Employee Hours ("daily_employee_hours.csv")
//   • Daily Employee Tip Allocation ("daily_employee_tip_allocation.csv")
//   • Final Aggregated Employee Totals ("final_employee_totals.csv")
// 
// The script also logs overall date ranges for clock and transaction data (and throws an error if they don’t match)
// and performs a sanity check (throwing an error if the allocated total does not match the transaction total).
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

function floorToDayInterval(date, intervalMinutes = 15) {
  const base = new Date(date.toISOString().split("T")[0] + "T00:00:00");
  const diffMinutes = Math.floor((date - base) / 60000);
  const flooredMinutes = diffMinutes - (diffMinutes % intervalMinutes);
  return addMinutes(base, flooredMinutes);
}

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
function preprocessClockCSV(content) {
  const lines = content.split(/\r?\n/);
  const cleanedLines = lines.slice(2, lines.length - 1);
  return cleanedLines.join("\n");
}

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

// New function: Group clock data by employee and date, and merge contiguous intervals.
function groupAndMergeClockData(clockData) {
  const groups = {};
  clockData.forEach(entry => {
    const key = entry.Employee + "|" + entry.Date;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push({ TimeIn: entry.TimeIn, TimeOut: entry.TimeOut, Department: entry.Department });
  });
  const mergedData = [];
  for (const key in groups) {
    const [employee, date] = key.split("|");
    let intervals = groups[key];
    intervals.sort((a, b) => a.TimeIn - b.TimeIn);
    const merged = [];
    let current = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
      const next = intervals[i];
      // Merge if next starts before or at current ends (or within a small tolerance to avoid seconds issues)
      if (next.TimeIn <= addMinutes(current.TimeOut, 1)) {
        current.TimeOut = new Date(Math.max(current.TimeOut.getTime(), next.TimeOut.getTime()));
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
    // For each merged interval, record an entry.
    merged.forEach(interval => {
      mergedData.push({
        Employee: employee,
        Date: date,
        TimeIn: interval.TimeIn,
        TimeOut: interval.TimeOut,
        Department: interval.Department // Assuming department remains the same for a given employee on a day.
      });
    });
  }
  return mergedData;
}

// ---------------- Transaction Processing ----------------
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
function computeDateRange(data) {
  const dates = data.map(d => new Date(d.Date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  return { min: minDate, max: maxDate };
}

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
function generateIntervalEmployeePresence(dayIntervals, mergedClockData) {
  return dayIntervals.map(interval => {
    // Check if the interval overlaps with any merged clock range for that day.
    const present = mergedClockData.filter(emp => {
      return emp.TimeIn < interval.TimeSlotEnd && emp.TimeOut > interval.TimeSlotStart;
    });
    const foh = present.filter(emp => emp.Department.toLowerCase().includes("front"));
    const boh = present.filter(emp => emp.Department.toLowerCase().includes("back"));
    return {
      Date: interval.Date,
      TimeSlotStart: interval.TimeSlotStart,
      TimeSlotEnd: interval.TimeSlotEnd,
      FOHEmployees: Array.from(new Set(foh.map(emp => emp.Employee))),
      BOHEmployees: Array.from(new Set(boh.map(emp => emp.Employee))),
      FOHCount: foh.length > 0 ? Array.from(new Set(foh.map(emp => emp.Employee))).length : 0,
      BOHCount: boh.length > 0 ? Array.from(new Set(boh.map(emp => emp.Employee))).length : 0
    };
  });
}

// ---------------- Additional Debug: Count Interval Coverage ----------------
function countCoveragePerDay(intervalPresence) {
  const counts = {};
  intervalPresence.forEach(rec => {
    if (!counts[rec.Date]) counts[rec.Date] = { withCoverage: 0, withoutCoverage: 0, total: 0 };
    counts[rec.Date].total++;
    if (rec.FOHCount + rec.BOHCount > 0) {
      counts[rec.Date].withCoverage++;
    } else {
      counts[rec.Date].withoutCoverage++;
    }
  });
  return counts;
}

// ---------------- Step 3: Allocate Tips to Employees (with fallback) ----------------
function allocateTips(intervalTipSummary, intervalPresence, mergedClockData) {
  const allocations = [];
  const orphaned = [];
  
  intervalTipSummary.forEach(summary => {
    let presence = intervalPresence.find(p => p.Date === summary.Date &&
      p.TimeSlotStart.getTime() === summary.TimeSlotStart.getTime());
    if (!presence || (presence.FOHCount === 0 && presence.BOHCount === 0)) {
      // Fallback: use all employees from that day.
      const fallback = mergedClockData.filter(emp => emp.Date === summary.Date);
      const unique = new Map();
      fallback.forEach(emp => {
        if (!unique.has(emp.Employee)) {
          unique.set(emp.Employee, emp);
        }
      });
      const fallbackList = Array.from(unique.values());
      if (fallbackList.length > 0) {
        const share = summary.TotalTips / fallbackList.length;
        fallbackList.forEach(emp => {
          allocations.push({ Employee: emp.Employee, Date: summary.Date, TipShare: share });
        });
        console.warn(`Fallback applied for interval ${summary.TimeSlotStart.toISOString()} on ${summary.Date}. Allocated among ${fallbackList.length} fallback employees.`);
      } else {
        orphaned.push({ Date: summary.Date, Department: "BOTH", OrphanedTip: summary.TotalTips });
      }
    } else {
      if (presence.FOHCount > 0 && presence.BOHCount > 0) {
        const shareFOH = summary.FOHTipPool / presence.FOHCount;
        presence.FOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareFOH });
        });
        const shareBOH = summary.BOHTipPool / presence.BOHCount;
        presence.BOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: shareBOH });
        });
      } else if (presence.FOHCount > 0) {
        const share = summary.TotalTips / presence.FOHCount;
        presence.FOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: share });
        });
      } else if (presence.BOHCount > 0) {
        const share = summary.TotalTips / presence.BOHCount;
        presence.BOHEmployees.forEach(emp => {
          allocations.push({ Employee: emp, Date: summary.Date, TipShare: share });
        });
      } else {
        orphaned.push({ Date: summary.Date, Department: "BOTH", OrphanedTip: summary.TotalTips });
      }
    }
  });
  
  return { allocations, orphaned };
}

// ---------------- Step 4: Redistribute Orphaned Tips ----------------
function redistributeOrphanedTips(orphaned, mergedClockData) {
  const sumByDay = {};
  orphaned.forEach(item => {
    if (!sumByDay[item.Date]) sumByDay[item.Date] = 0;
    sumByDay[item.Date] += item.OrphanedTip;
  });
  
  const employeesByDay = {};
  mergedClockData.forEach(emp => {
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

// Group and merge clock entries for each employee (per day).
const mergedClockData = groupAndMergeClockData(cleanedClock);
const mergedClockCSV = generateCSV(mergedClockData.map(r => ({
  Employee: r.Employee,
  Date: r.Date,
  TimeIn: r.TimeIn.toISOString(),
  TimeOut: r.TimeOut.toISOString(),
  Department: r.Department
})));
const outputDir = path.resolve(args.output);
if (!fs.existsSync(outputDir)) { fs.mkdirSync(outputDir, { recursive: true }); }
const mergedClockCSVPath = path.join(outputDir, "merged_clock_data.csv");
fs.writeFileSync(mergedClockCSVPath, mergedClockCSV, "utf8");
console.log(`Merged Clock Data CSV written to: ${mergedClockCSVPath}`);

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
const intervalTipCSVPath = path.join(outputDir, "interval_tip_summary.csv");
fs.writeFileSync(intervalTipCSVPath, intervalTipCSV, "utf8");
console.log(`Interval Tip Summary CSV written to: ${intervalTipCSVPath}`);

// ---------- Step 2: Generate Interval Employee Presence ----------
const intervalPresence = generateIntervalEmployeePresence(fullDayIntervals, mergedClockData);
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

// ---------- Additional Debug: Interval Coverage Summary ----------
const coverageCounts = countCoveragePerDay(intervalPresence);
const coverageArray = [];
for (let date in coverageCounts) {
  coverageArray.push({ Date: date, TotalIntervals: coverageCounts[date].total, WithCoverage: coverageCounts[date].withCoverage, WithoutCoverage: coverageCounts[date].withoutCoverage });
}
const coverageCSV = generateCSV(coverageArray);
const coverageCSVPath = path.join(outputDir, "interval_coverage_summary.csv");
fs.writeFileSync(coverageCSVPath, coverageCSV, "utf8");
console.log(`Interval Coverage Summary CSV written to: ${coverageCSVPath}`);

// ---------- Step 3: Allocate Tips to Employees (with fallback) ----------
const { allocations, orphaned } = allocateTips(intervalTipSummary, intervalPresence, mergedClockData);

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
const redistribution = redistributeOrphanedTips(orphaned, mergedClockData);

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

const dailyEmployeeHours = aggregateDailyEmployeeHours(cleanedClock);
const dailyEmployeeHoursCSV = generateCSV(dailyEmployeeHours);
const dailyEmployeeHoursCSVPath = path.join(outputDir, "daily_employee_hours.csv");
fs.writeFileSync(dailyEmployeeHoursCSVPath, dailyEmployeeHoursCSV, "utf8");
console.log(`Daily Employee Hours CSV written to: ${dailyEmployeeHoursCSVPath}`);

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

// ---------------- Debug: Detailed Orphaned Intervals ----------------
const detailedOrphaned = intervalTipSummary.map(summary => {
  const presence = intervalPresence.find(p => p.Date === summary.Date &&
    p.TimeSlotStart.getTime() === summary.TimeSlotStart.getTime());
  let orphanedTip = 0;
  if (!presence || (presence.FOHCount + presence.BOHCount === 0)) {
    orphanedTip = summary.TotalTips;
  }
  return {
    Date: summary.Date,
    TimeSlotStart: summary.TimeSlotStart.toISOString(),
    TimeSlotEnd: summary.TimeSlotEnd.toISOString(),
    TotalTips: summary.TotalTips.toFixed(2),
    OrphanedTip: orphanedTip.toFixed(2)
  };
});
const detailedOrphanedCSV = generateCSV(detailedOrphaned);
const detailedOrphanedCSVPath = path.join(outputDir, "detailed_orphaned_intervals.csv");
fs.writeFileSync(detailedOrphanedCSVPath, detailedOrphanedCSV, "utf8");
console.log(`Detailed Orphaned Intervals CSV written to: ${detailedOrphanedCSVPath}`);