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

function computeTipPools(tipsBySlot, staffMap) {
  // Create a map of staff by date to handle time slots with no scheduled staff
  const staffByDate = {};
  
  for (const key in staffMap) {
    const [date] = key.split('|');
    if (!staffByDate[date]) {
      staffByDate[date] = { FOH: 0, BOH: 0, EXEC: 0, uniqueFOH: new Set(), uniqueBOH: new Set() };
    }
    
    // Record the presence of each department on this day
    if (staffMap[key].FOH > 0) staffByDate[date].FOH = 1;
    if (staffMap[key].BOH > 0) staffByDate[date].BOH = 1;
    
    // We'll also need to count unique employees for later redistribution
    // This would require enhancing the staffMap to track unique employees, but we'll leave it as a placeholder
  }
  
  console.log("Staff by date summary:");
  Object.keys(staffByDate).forEach(date => {
    console.log(`  ${date}: FOH=${staffByDate[date].FOH > 0 ? 'present' : 'none'}, BOH=${staffByDate[date].BOH > 0 ? 'present' : 'none'}`);
  });

  return tipsBySlot.map(slot => {
    const key = `${slot.Date}|${slot.TimeSlotStart.toISOString()}`;
    const staff = staffMap[key] || { FOH: 0, BOH: 0, EXEC: 0, total: 0 };
    const totalStaff = staff.FOH + staff.BOH;
    
    let fohTipPool = 0;
    let bohTipPool = 0;
    
    if (totalStaff > 0) {
      // Normal case: Staff is present for this time slot
      if (staff.FOH > 0 && staff.BOH === 0) {
        // Only FOH present - they get all tips
        fohTipPool = slot.AmtTip;
      } else if (staff.FOH === 0 && staff.BOH > 0) {
        // Only BOH present - they get all tips
        bohTipPool = slot.AmtTip;
      } else if (totalStaff > 0) {
        // Both departments present - split according to headcount
        fohTipPool = (staff.FOH / totalStaff) * slot.AmtTip;
        bohTipPool = (staff.BOH / totalStaff) * slot.AmtTip;
      }
    } 
    else if (staffByDate[slot.Date]) {
      // No staff in this specific time slot, but staff worked on this day
      // Allocate based on which departments were present that day
      const dayStaff = staffByDate[slot.Date];
      const deptPresent = (dayStaff.FOH > 0 ? 1 : 0) + (dayStaff.BOH > 0 ? 1 : 0);
      
      if (deptPresent === 0) {
        // If no staff on this day, mark as unallocated
        // This shouldn't happen if there's valid clock data
      } 
      else if (dayStaff.FOH > 0 && dayStaff.BOH === 0) {
        // Only FOH worked that day
        fohTipPool = slot.AmtTip;
      } 
      else if (dayStaff.FOH === 0 && dayStaff.BOH > 0) {
        // Only BOH worked that day
        bohTipPool = slot.AmtTip;
      } 
      else {
        // Both departments worked that day - split 50/50
        // This is a simplification; could be refined with actual staff counts
        fohTipPool = slot.AmtTip / 2;
        bohTipPool = slot.AmtTip / 2;
      }
    }
    // If no staff worked that day at all, both pools remain 0
    
    return {
      Date: slot.Date,
      TimeSlotStart: slot.TimeSlotStart,
      AmtTip: slot.AmtTip,
      FOHCount: staff.FOH,
      BOHCount: staff.BOH,
      ExecCount: staff.EXEC || 0,
      FOHTipPool: fohTipPool,
      BOHTipPool: bohTipPool,
      TotalStaff: totalStaff
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