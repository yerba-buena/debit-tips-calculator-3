// tests/test-tipAllocation.js

const { expect } = require('chai');
const { countStaffPerSlot, computeTipPools, calculateIndividualTipShares, identifyUnallocatedTips, redistributeUnallocatedTips, aggregateFinalTips } = require('../src/tipAllocation');

describe('Tip Allocation Module', () => {
  it('should count staff per slot', () => {
    const intervals = [
      { Date: '2025-02-18', TimeSlotStart: new Date('2025-02-18T10:00:00'), Department: 'Front of House' },
      { Date: '2025-02-18', TimeSlotStart: new Date('2025-02-18T10:00:00'), Department: 'Back of House' }
    ];
    const staffMap = countStaffPerSlot(intervals);
    const key = '2025-02-18|' + new Date('2025-02-18T10:00:00').toISOString();
    expect(staffMap[key].FOH).to.equal(1);
    expect(staffMap[key].BOH).to.equal(1);
  });

  it('should compute tip pools correctly', () => {
    const tipsBySlot = [
      { Date: '2025-02-18', TimeSlotStart: new Date('2025-02-18T10:00:00'), AmtTip: 20.00 }
    ];
    const staffMap = { ['2025-02-18|' + new Date('2025-02-18T10:00:00').toISOString()]: { FOH: 2, BOH: 1 } };
    const pools = computeTipPools(tipsBySlot, staffMap);
    expect(pools[0].FOHTipPool).to.equal(20.00 * 0.85);
    expect(pools[0].BOHTipPool).to.equal(20.00 * 0.15);
  });

  it('should calculate individual tip shares correctly', () => {
    const intervals = [
      { Employee: 'John Doe', Department: 'Front of House', Date: '2025-02-18', TimeSlotStart: new Date('2025-02-18T10:00:00'), TimeSlotEnd: new Date('2025-02-18T10:15:00') }
    ];
    const tipPools = [
      { Date: '2025-02-18', TimeSlotStart: new Date('2025-02-18T10:00:00'), AmtTip: 20.00, FOHCount: 2, BOHCount: 1, FOHTipPool: 20.00 * 0.85, BOHTipPool: 20.00 * 0.15, TotalStaff: 3 }
    ];
    const shares = calculateIndividualTipShares(intervals, tipPools);
    expect(shares[0].IndividualTipShare).to.equal((20.00 * 0.85) / 2);
  });

  it('should identify unallocated tips', () => {
    const tipPools = [
      { Date: '2025-02-18', TimeSlotStart: new Date('2025-02-18T10:00:00'), AmtTip: 20.00, FOHCount: 0, BOHCount: 0, FOHTipPool: 17.00, BOHTipPool: 3.00, TotalStaff: 0 },
      { Date: '2025-02-18', TimeSlotStart: new Date('2025-02-18T10:15:00'), AmtTip: 30.00, FOHCount: 0, BOHCount: 2, FOHTipPool: 25.50, BOHTipPool: 4.50, TotalStaff: 2 }
    ];
    const unallocated = identifyUnallocatedTips(tipPools);
    expect(unallocated.length).to.equal(2);
  });

  it('should redistribute unallocated tips', () => {
    const unallocatedTips = [
      { Date: '2025-02-18', UnallocatedTip: 10.00 }
    ];
    const intervals = [
      { Date: '2025-02-18', Employee: 'John Doe' },
      { Date: '2025-02-18', Employee: 'Jane Smith' }
    ];
    const redistribution = redistributeUnallocatedTips(unallocatedTips, intervals);
    expect(redistribution.length).to.equal(2);
    expect(redistribution[0].UnallocatedTipShare).to.equal(5.00);
  });

  it('should aggregate final tips correctly', () => {
    const individualTipShares = [
      { Employee: 'John Doe', IndividualTipShare: 10.00 },
      { Employee: 'Jane Smith', IndividualTipShare: 15.00 }
    ];
    const redistribution = [
      { Employee: 'John Doe', UnallocatedTipShare: 5.00 },
      { Employee: 'Jane Smith', UnallocatedTipShare: 5.00 }
    ];
    const finalTotals = aggregateFinalTips(individualTipShares, redistribution);
    const john = finalTotals.find(r => r.Employee === 'John Doe');
    const jane = finalTotals.find(r => r.Employee === 'Jane Smith');
    expect(john.TotalTips).to.equal(15.00);
    expect(jane.TotalTips).to.equal(20.00);
  });
});