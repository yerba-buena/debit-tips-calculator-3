// Additional tests for time interval edge cases in tests/test-clockData.js

const { expect } = require('chai');
const { processClockData, expandToIntervals } = require('../src/clockData');

describe('Time Interval Edge Cases', () => {
  // For a 30-minute shift from 10:00 AM to 10:30 AM:

  it('should generate 15 intervals for a 2-minute interval', () => {
    const sampleData = [
      {
        'First Name': 'Test',
        'Last Name': 'User',
        'Department': 'Front of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed, 2);
    expect(intervals).to.have.lengthOf(15);
    // Check that the first interval is 10:00 to 10:02 and the last interval ends at 10:30
    expect(intervals[0].TimeSlotStart.getTime()).to.equal(new Date('2025-02-18T10:00:00').getTime());
    expect(intervals[0].TimeSlotEnd.getTime()).to.equal(new Date('2025-02-18T10:02:00').getTime());
    expect(intervals[14].TimeSlotStart.getTime()).to.equal(new Date('2025-02-18T10:28:00').getTime());
    expect(intervals[14].TimeSlotEnd.getTime()).to.equal(new Date('2025-02-18T10:30:00').getTime());
  });

  it('should generate 1 interval for a 60-minute interval even if the shift is shorter', () => {
    const sampleData = [
      {
        'First Name': 'Test',
        'Last Name': 'User',
        'Department': 'Back of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed, 60);
    // Even though the employee worked only 30 minutes, they are credited with a full 60-minute interval.
    expect(intervals).to.have.lengthOf(1);
    expect(intervals[0].TimeSlotStart.getTime()).to.equal(new Date('2025-02-18T10:00:00').getTime());
    expect(intervals[0].TimeSlotEnd.getTime()).to.equal(new Date('2025-02-18T11:00:00').getTime());
  });

  it('should fallback to the default 15-minute interval if given interval is less than 2 minutes', () => {
    const sampleData = [
      {
        'First Name': 'Low',
        'Last Name': 'Interval',
        'Department': 'Front of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed, 1); // Invalid: less than 2 minutes
    // With the default 15-minute interval, a 30-minute shift should yield 2 intervals.
    expect(intervals).to.have.lengthOf(2);
  });

  it('should fallback to the default 15-minute interval if given interval is greater than 60 minutes', () => {
    const sampleData = [
      {
        'First Name': 'High',
        'Last Name': 'Interval',
        'Department': 'Back of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed, 61); // Invalid: greater than 60 minutes
    expect(intervals).to.have.lengthOf(2);
  });

  it('should fallback to the default 15-minute interval if given interval does not evenly divide 1440', () => {
    const sampleData = [
      {
        'First Name': 'NotEven',
        'Last Name': 'Divider',
        'Department': 'Front of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed, 7); // 7 does not evenly divide 1440, so fallback occurs
    expect(intervals).to.have.lengthOf(2);
  });

  it('should fallback to the default 15-minute interval if given interval is non-numeric', () => {
    const sampleData = [
      {
        'First Name': 'Bad',
        'Last Name': 'Input',
        'Department': 'Back of House',
        'Date In': '2025-02-18',
        'Time In': '10:00 AM',
        'Date Out': '2025-02-18',
        'Time Out': '10:30 AM',
        'Total Less Break': '0'
      }
    ];
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed, 'foo'); // Non-numeric, should fallback to 15 minutes
    expect(intervals).to.have.lengthOf(2);
  });
});