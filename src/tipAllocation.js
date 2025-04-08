// src/tipAllocation.js

const { formatDateTime } = require('./utils');

/**
 * Categorize an employee based on department and title
 * @param {Object} employee - Employee record with Department and Employee (name/title) fields
 * @returns {String} - 'FOH', 'BOH', or 'EXEC'
 */
function categorizeEmployee(employee) {
  // Check for executives first (they're excluded from tip allocation)
  if (employee.Employee && (
      employee.Employee.includes('CEO') ||
      employee.Employee.includes('COO') || 
      employee.Employee.includes('Chief Operations Officer') ||
      /\bC[A-Z]{2}\b/.test(employee.Employee) // Match any 3-letter C-suite title (CFO, CTO, CIO, etc.)
  )) {
    return 'EXEC';
  }
  
  // Check department name for categorization
  const dept = (employee.Department || '').toLowerCase();
  
  if (dept.includes('front')) {
    return 'FOH';
  } else if (dept.includes('back')) {
    return 'BOH';
  } else if (dept === 'management') {
    return 'FOH'; // Management is FOH unless they're an executive
  } else {
    return 'BOH'; // Default case: assume BOH when not possible to determine
  }
}

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
  // Debug: Print a few samples of tipsBySlot
  console.log("Sample tips by slot (first 3):");
  tipsBySlot.slice(0, 3).forEach(slot => {
    console.log(`  Date: ${slot.Date}, TimeSlotStart: ${slot.TimeSlotStart}, AmtTip: ${slot.AmtTip}`);
  });
  
  // Debug: Print a few keys from staffMap
  console.log("Sample staffMap keys in computeTipPools (first 3):");
  Object.keys(staffMap).slice(0, 3).forEach(key => {
    console.log(`  Key: ${key}`);
  });

  return tipsBySlot.map(slot => {
    const key = `${slot.Date}|${slot.TimeSlotStart.toISOString()}`;
    
    // Debug: Log key lookup
    if (slot.AmtTip > 0) {
      console.log(`Looking up key: ${key}, Found: ${!!staffMap[key]}`);
      if (staffMap[key]) {
        console.log(`  Staff for this slot: FOH=${staffMap[key].FOH}, BOH=${staffMap[key].BOH}`);
      }
    }
    
    const staff = staffMap[key] || { FOH: 0, BOH: 0, EXEC: 0, total: 0 };
    const totalStaff = staff.FOH + staff.BOH;
    
    let fohTipPool = 0;
    let bohTipPool = 0;
    
    // Handle case where only one department is present
    if (staff.FOH > 0 && staff.BOH === 0) {
      // Only FOH present - they get all tips
      fohTipPool = slot.AmtTip;
    } else if (staff.FOH === 0 && staff.BOH > 0) {
      // Only BOH present - they get all tips
      bohTipPool = slot.AmtTip;
    } else if (totalStaff > 0) {
      // Both departments present - split according to normal rules
      fohTipPool = (staff.FOH / totalStaff) * slot.AmtTip;
      bohTipPool = (staff.BOH / totalStaff) * slot.AmtTip;
    }
    // If no staff present, both pools remain 0
    
    return {
      Date: slot.Date,
      TimeSlotStart: slot.TimeSlotStart,
      AmtTip: slot.AmtTip,
      FOHCount: staff.FOH,
      BOHCount: staff.BOH,
      ExecCount: staff.EXEC || 0, // Changed from Exec to EXEC to match naming in countStaffPerSlot
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