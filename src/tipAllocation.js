// src/tipAllocation.js

function countStaffPerSlot(intervals, intervalMinutes) {
  let slotStaffMap = {};
  intervals.forEach(rec => {
    const key = rec.Date + '|' + rec.TimeSlotStart.toISOString();
    if (!slotStaffMap[key]) {
      slotStaffMap[key] = { FOH: 0, BOH: 0 };
    }
    if (rec.Department.toLowerCase().includes('front')) {
      slotStaffMap[key].FOH += 1;
    } else if (rec.Department.toLowerCase().includes('back')) {
      slotStaffMap[key].BOH += 1;
    }
  });
  return slotStaffMap;
}

function computeTipPools(tipsBySlot, slotStaffMap, intervalMinutes) {
  return tipsBySlot.map(slot => {
    const key = slot.Date + '|' + slot.TimeSlotStart.toISOString();
    const staff = slotStaffMap[key] || { FOH: 0, BOH: 0 };
    return {
      Date: slot.Date,
      TimeSlotStart: slot.TimeSlotStart,
      AmtTip: slot.AmtTip,
      FOHCount: staff.FOH,
      BOHCount: staff.BOH,
      FOHTipPool: slot.AmtTip * 0.85,
      BOHTipPool: slot.AmtTip * 0.15,
      TotalStaff: staff.FOH + staff.BOH
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
      if (rec.Department.toLowerCase().includes('front') && pool.FOHCount > 0) {
        share = pool.FOHTipPool / pool.FOHCount;
      } else if (rec.Department.toLowerCase().includes('back') && pool.BOHCount > 0) {
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
  let fullyUnallocated = tipPools.filter(r => r.TotalStaff === 0)
    .map(r => ({
      Date: r.Date,
      TimeSlotStart: r.TimeSlotStart,
      UnallocatedTip: r.AmtTip
    }));
  let partialUnallocated = tipPools.filter(r => r.TotalStaff > 0 && r.AmtTip > 0 && (r.FOHCount === 0 || r.BOHCount === 0))
    .map(r => {
      let orphaned = 0;
      if (r.FOHCount === 0) {
        orphaned += r.FOHTipPool;
      }
      if (r.BOHCount === 0) {
        orphaned += r.BOHTipPool;
      }
      return {
        Date: r.Date,
        TimeSlotStart: r.TimeSlotStart,
        UnallocatedTip: orphaned
      };
    });
  return fullyUnallocated.concat(partialUnallocated);
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
  
  // Initialize with structure to track both allocated and unallocated
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