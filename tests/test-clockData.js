// tests/test-clockData.js

const { expect } = require('chai');
const { processClockData, expandToIntervals } = require('../src/clockData');

describe('Clock Data Module', () => {
  const sampleData = [
    {
      'First Name': 'John',
      'Last Name': 'Doe',
      'Department': 'Front of House',
      'Date In': '2025-02-18',
      'Time In': '10:00 AM',
      'Date Out': '2025-02-18',
      'Time Out': '6:00 PM',
      'Total Less Break': '8'
    }
  ];

  it('should process clock data correctly', () => {
    const processed = processClockData(sampleData);
    expect(processed).to.have.lengthOf(1);
    expect(processed[0]).to.have.property('Employee', 'John Doe');
  });

  it('should expand shifts to 15-minute intervals', () => {
    const processed = processClockData(sampleData);
    const intervals = expandToIntervals(processed);
    expect(intervals.length).to.be.greaterThan(0);
  });
});