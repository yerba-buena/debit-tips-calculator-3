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

const floorTo15 = (dt) => {
  const minutes = dt.getMinutes();
  const remainder = minutes % 15;
  return new Date(dt.getTime() - remainder * 60000 - dt.getSeconds() * 1000 - dt.getMilliseconds());
};

const addMinutes = (dt, minutes) => {
  return new Date(dt.getTime() + minutes * 60000);
};

module.exports = {
  parseDateTime,
  formatDateTime,
  floorTo15,
  addMinutes
};
