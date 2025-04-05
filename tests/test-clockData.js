// tests/test-clockData.js

const { expect } = require('chai');
const { processClockData, expandToIntervals } = require('../src/clockData');

describe('Clock Data Module', () => {
  // Existing tests...

  it('should include full interval if clock out is within the interval (custom interval)', () => {
    const sampleData = [
      {
        'First Name': 'Alice',
        'Last Name': 'Wonder',
        'Department': 'Front of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        // Clocks out at 10:05 AM, which is within a 10-minute interval
        'Date Out': '2025-02-18',
        'Time Out': '10:05 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed, 10);
    // Even though Alice worked only 5 minutes, she should get credited for the full 10-minute interval.
    expect(intervals).to.have.lengthOf(1);
    expect(intervals[0].TimeSlotStart.getTime()).to.equal(new Date('2025-02-18T10:00:00').getTime());
    expect(intervals[0].TimeSlotEnd.getTime()).to.equal(new Date('2025-02-18T10:10:00').getTime());
  });
  
  it('should fallback to default interval when given an invalid interval', () => {
    const sampleData = [
      {
        'First Name': 'Bob',
        'Last Name': 'Builder',
        'Department': 'Back of House',
        'Date In': '2025-02-18',
        'Time In': '11:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '11:30 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    // Provide an invalid interval (e.g., 7 minutes, which doesn't evenly divide 1440)
    const intervals = expandToIntervals(processed, 7);
    // Should fallback to default 15-minute intervals, so expect 2 intervals for a 30-minute shift.
    expect(intervals).to.have.lengthOf(2);
    expect(intervals[0].TimeSlotEnd.getTime()).to.equal(new Date('2025-02-18T11:15:00').getTime());
  });
});