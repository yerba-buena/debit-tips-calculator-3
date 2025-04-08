// src/utils.js

const parseDateTime = (dateStr, timeStr) => {
  // Expects dateStr like "2025-02-18" and timeStr like "10:30 AM"
  return new Date(`${dateStr} ${timeStr}`);
};

const formatDateTime = (dt) => {
  const pad = (n) => (n < 10 ? '0' + n : n);
  return (
    dt.getFullYear() +
    '-' +
    pad(dt.getMonth() + 1) +
    '-' +
    pad(dt.getDate()) +
    ' ' +
    pad(dt.getHours()) +
    ':' +
    pad(dt.getMinutes()) +
    ':' +
    pad(dt.getSeconds())
  );
};

const floorToInterval = (dt, intervalMinutes = 15) => {
  const minutes = dt.getMinutes();
  const remainder = minutes % intervalMinutes;
  return new Date(dt.getTime() - remainder * 60000 - dt.getSeconds() * 1000 - dt.getMilliseconds());
};

// For backward compatibility (can be removed later)
const floorTo15 = (dt) => floorToInterval(dt, 15);

const addMinutes = (dt, minutes) => {
  return new Date(dt.getTime() + minutes * 60000);
};

module.exports = {
  parseDateTime,
  formatDateTime,
  floorTo15,
  floorToInterval,
  addMinutes
};
