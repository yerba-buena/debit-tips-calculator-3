// src/tipAllocation.js

const { formatDateTime } = require('./utils');
const { categorizeEmployee } = require('./employeeClassification');

function countStaffPerSlot(intervals, intervalMinutes) {
  const slotStaffMap = {};
  
  // Debug: Print a few sample intervals
  console.log("Sample intervals (first 3):");
  intervals.slice(0, 3).forEach(rec => {
    console.log(`  Employee: ${rec.Employee}, Date: ${rec.Date}, TimeSlotStart: ${rec.TimeSlotStart}`);
  });

  intervals.forEach(rec => {
    const key = `${rec.Date}|${rec.TimeSlotStart.toISOString()}`;
    if (!slotStaffMap[key]) {
      slotStaffMap[key] = { FOH: 0, BOH: 0, EXEC: 0, total: 0 };
    }

    const category = categorizeEmployee(rec);
    if (category === 'FOH') {
      slotStaffMap[key].FOH += 1;
    } else if (category === 'BOH') {
      slotStaffMap[key].BOH += 1;
    } else if (category === 'EXEC') {
      slotStaffMap[key].EXEC += 1;
    }
    
    // Only count non-executives toward total staff for tip allocation
    if (category !== 'EXEC') {
      slotStaffMap[key].total += 1;
    }
  });

  // Debug: Print a few keys from the staffMap
  console.log("Sample staff map keys (first 3):");
  Object.keys(slotStaffMap).slice(0, 3).forEach(key => {
    console.log(`  Key: ${key}, Staff: FOH=${slotStaffMap[key].FOH}, BOH=${slotStaffMap[key].BOH}`);
  });

  return slotStaffMap;
}

/**
 * Compute tip pools by time slot
 * @param {Array} tipsBySlot - Tips aggregated by time slot
 * @param {Object} staffMap - Map of staff counts by time slot
 * @param {Number} bohPctOverride - Optional override for BOH percentage (0-100)
 * @return {Array} - Array of tip pools by time slot with allocation info
 */
function computeTipPools(tipsBySlot, staffMap, bohPctOverride = null) {
  // Configure tip distribution ratio
  const BOH_RATIO = bohPctOverride !== null ? (bohPctOverride / 100) : 0.15; // 15% to BOH by default
  const FOH_RATIO = 1 - BOH_RATIO; // 85% to FOH by default
  
  // Display the tip distribution being used
  console.log(`Tip Distribution: FOH=${(FOH_RATIO*100).toFixed(0)}%, BOH=${(BOH_RATIO*100).toFixed(0)}%`);
  
  // Sample the first few intervals
  const sampleKeys = Object.keys(staffMap).slice(0, 3);
  console.log('Sample staff map keys (first 3):');
  sampleKeys.forEach(key => {
    const staff = staffMap[key];
    console.log(`  Key: ${key}, Staff: FOH=${staff.FOH}, BOH=${staff.BOH}`);
  });
  
  // Check for staff presence by date
  const staffByDate = {};
  Object.keys(staffMap).forEach(key => {
    const [date, _] = key.split('|');
    if (!staffByDate[date]) staffByDate[date] = { FOH: false, BOH: false };
    
    const staff = staffMap[key];
    if (staff.FOH > 0) staffByDate[date].FOH = true;
    if (staff.BOH > 0) staffByDate[date].BOH = true;
  });
  
  console.log('Staff by date summary:');
  Object.keys(staffByDate).sort().forEach(date => {
    const staff = staffByDate[date];
    console.log(`  ${date}: FOH=${staff.FOH ? 'present' : 'absent'}, BOH=${staff.BOH ? 'present' : 'absent'}`);
  });
  
  return tipsBySlot.map(slot => {
    const key = `${slot.Date}|${slot.TimeSlotStart.toISOString()}`;
    const staff = staffMap[key] || { FOH: 0, BOH: 0, EXEC: 0 };
    
    const FOHCount = staff.FOH || 0;
    const BOHCount = staff.BOH || 0;
    const ExecCount = staff.EXEC || 0;
    const TotalStaff = FOHCount + BOHCount + ExecCount;
    
    let FOHTipPool = 0;
    let BOHTipPool = 0;
    
    // Handle cases based on staff presence
    if (TotalStaff === 0) {
      // No staff - all tips become unallocated
      FOHTipPool = 0;
      BOHTipPool = 0;
    } 
    else if (FOHCount > 0 && BOHCount > 0) {
      // Both FOH and BOH present - use specified distribution
      FOHTipPool = slot.AmtTip * FOH_RATIO;
      BOHTipPool = slot.AmtTip * BOH_RATIO;
    }
    else if (FOHCount > 0 && BOHCount === 0) {
      // Only FOH present - allocate all tips to FOH
      FOHTipPool = slot.AmtTip;
      BOHTipPool = 0;
    }
    else if (BOHCount > 0 && FOHCount === 0) {
      // Only BOH present - allocate all tips to BOH
      FOHTipPool = 0;
      BOHTipPool = slot.AmtTip;
    }
    
    return {
      Date: slot.Date,
      TimeSlotStart: slot.TimeSlotStart,
      AmtTip: slot.AmtTip,
      FOHCount,
      BOHCount,
      ExecCount,
      TotalStaff,
      FOHTipPool,
      BOHTipPool
    };
  });
}

function calculateIndividualTipShares(intervals, tipPools, intervalMinutes) {
  let tipPoolMap = {};
  tipPools.forEach(pool => {
    const key = pool.Date + '|' + pool.TimeSlotStart.toISOString();
    tipPoolMap[key] = pool;
  });
  let individualTipShares = [];
  intervals.forEach(rec => {
    const key = rec.Date + '|' + rec.TimeSlotStart.toISOString();
    const pool = tipPoolMap[key];
    let share = 0;
    if (pool) {
      const category = categorizeEmployee(rec);
      if (category === 'FOH' && pool.FOHCount > 0) {
        share = pool.FOHTipPool / pool.FOHCount;
      } else if (category === 'BOH' && pool.BOHCount > 0) {
        share = pool.BOHTipPool / pool.BOHCount;
      }
    }
    individualTipShares.push({
      Employee: rec.Employee,
      Department: rec.Department,
      Date: rec.Date,
      TimeSlotStart: rec.TimeSlotStart,
      TimeSlotEnd: rec.TimeSlotEnd,
      IndividualTipShare: share
    });
  });
  return individualTipShares;
}

function identifyUnallocatedTips(tipPools, intervalMinutes) {
  const unallocatedTips = [];
  
  tipPools.forEach(r => {
    let orphaned = 0;
    
    if (r.TotalStaff === 0) {
      orphaned = r.AmtTip;
    } else if (r.AmtTip > 0) {
      if (r.FOHCount === 0) orphaned += r.FOHTipPool;
      if (r.BOHCount === 0) orphaned += r.BOHTipPool;
    }
    
    if (orphaned > 0) {
      unallocatedTips.push({
        Date: r.Date,
        TimeSlotStart: r.TimeSlotStart,
        UnallocatedTip: orphaned
      });
    }
  });
  
  return unallocatedTips;
}

function redistributeUnallocatedTips(unallocatedTips, intervals, intervalMinutes) {
  let unallocByDay = {};
  unallocatedTips.forEach(rec => {
    if (!unallocByDay[rec.Date]) unallocByDay[rec.Date] = 0;
    unallocByDay[rec.Date] += rec.UnallocatedTip;
  });
  let employeesByDay = {};
  intervals.forEach(rec => {
    if (!employeesByDay[rec.Date]) employeesByDay[rec.Date] = new Set();
    employeesByDay[rec.Date].add(rec.Employee);
  });
  let redistribution = [];
  for (let date in unallocByDay) {
    const totalUnalloc = unallocByDay[date];
    const employees = Array.from(employeesByDay[date] || []);
    const share = employees.length > 0 ? totalUnalloc / employees.length : 0;
    employees.forEach(emp => {
      redistribution.push({
        Date: date,
        Employee: emp,
        UnallocatedTipShare: share
      });
    });
  }
  return redistribution;
}

function aggregateFinalTips(individualTipShares, redistribution) {
  let tipByEmployee = {};
  
  individualTipShares.forEach(rec => {
    if (!tipByEmployee[rec.Employee]) {
      tipByEmployee[rec.Employee] = {
        allocatedTips: 0,
        unallocatedTips: 0
      };
    }
    tipByEmployee[rec.Employee].allocatedTips += rec.IndividualTipShare;
  });
  
  redistribution.forEach(rec => {
    if (!tipByEmployee[rec.Employee]) {
      tipByEmployee[rec.Employee] = {
        allocatedTips: 0,
        unallocatedTips: 0
      };
    }
    tipByEmployee[rec.Employee].unallocatedTips += rec.UnallocatedTipShare;
  });
  
  let finalTotals = [];
  for (let emp in tipByEmployee) {
    finalTotals.push({
      Employee: emp,
      AllocatedTips: tipByEmployee[emp].allocatedTips,
      UnallocatedTips: tipByEmployee[emp].unallocatedTips,
      TotalTips: tipByEmployee[emp].allocatedTips + tipByEmployee[emp].unallocatedTips
    });
  }
  
  return finalTotals;
}

module.exports = {
  countStaffPerSlot,
  computeTipPools,
  calculateIndividualTipShares,
  identifyUnallocatedTips,
  redistributeUnallocatedTips,
  aggregateFinalTips
};