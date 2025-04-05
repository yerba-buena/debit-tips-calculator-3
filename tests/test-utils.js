// tests/test-utils.js

const { expect } = require('chai');
const { parseDateTime, formatDateTime, floorTo15, addMinutes } = require('../src/utils');

describe('Utils Module', () => {
  it('should parse date and time correctly', () => {
    const dt = parseDateTime('2025-02-18', '10:30 AM');
    expect(dt).to.be.instanceof(Date);
  });

  it('should format date correctly', () => {
    const dt = new Date('2025-02-18T10:30:00');
    const formatted = formatDateTime(dt);
    expect(formatted).to.match(/2025-02-18/);
  });

  it('should floor date to nearest 15 minutes', () => {
    const dt = new Date('2025-02-18T10:37:00');
    const floored = floorTo15(dt);
    expect(floored.getMinutes() % 15).to.equal(0);
  });

  it('should add minutes correctly', () => {
    const dt = new Date('2025-02-18T10:30:00');
    const newDt = addMinutes(dt, 15);
    expect(newDt.getMinutes()).to.equal(45);
  });
});