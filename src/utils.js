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

/**
 * Converts a datetime from Central Time to Eastern Time using proper timezone handling
 * @param {Date} centralTime - Date object in Central Time
 * @return {Date} - Date object converted to Eastern Time
 */
function convertCentralToEastern(centralTime) {
  if (!centralTime || !(centralTime instanceof Date)) {
    return centralTime;
  }
  
  // Get the ISO string that represents the time in Central Time
  const year = centralTime.getFullYear();
  const month = centralTime.getMonth();
  const day = centralTime.getDate();
  const hour = centralTime.getHours();
  const minute = centralTime.getMinutes();
  const second = centralTime.getSeconds();
  const millisecond = centralTime.getMilliseconds();
  
  // Create a new date in the Central timezone
  const centralDate = new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
  
  // Get the UTC time values, considering it was Central time (UTC-6 or UTC-5 depending on DST)
  const centralTimeString = centralDate.toLocaleString('en-US', { 
    timeZone: 'America/Chicago' 
  });
  
  // Parse this time as Eastern time
  const easternDate = new Date(centralTimeString);
  
  // Adjust for timezone offset difference between Central and Eastern
  const centralOffset = new Date().toLocaleString('en-US', { 
    timeZone: 'America/Chicago', 
    timeZoneName: 'short' 
  }).split(' ').pop();
  
  const easternOffset = new Date().toLocaleString('en-US', { 
    timeZone: 'America/New_York', 
    timeZoneName: 'short' 
  }).split(' ').pop();
  
  // Calculate the difference in hours between the two timezones 
  // (this handles DST differences correctly)
  const offsetDiff = (centralOffset === easternOffset) ? 1 : 0;
  
  // Apply the offset
  easternDate.setHours(easternDate.getHours() + offsetDiff);
  
  return easternDate;
}

/**
 * More robust timezone conversion using direct timezone string manipulation
 * @param {Date} date - The original date object
 * @param {string} fromTZ - Source timezone (e.g., 'America/Chicago')
 * @param {string} toTZ - Target timezone (e.g., 'America/New_York')
 * @return {Date} - Date converted to target timezone
 */
function convertTimezone(date, fromTZ, toTZ) {
  if (!date || !(date instanceof Date)) {
    return date;
  }

  // Format the date in the source timezone
  const dateString = date.toLocaleString('en-US', { timeZone: fromTZ });
  
  // Create a new date object from this string (which will be in local time)
  const localDate = new Date(dateString);
  
  // Get the current date in the target timezone
  const targetDateString = date.toLocaleString('en-US', { timeZone: toTZ });
  const targetDate = new Date(targetDateString);
  
  // Calculate the offset difference between timezones
  const offsetDiff = targetDate.getTime() - localDate.getTime();
  
  // Apply the offset to the original date
  return new Date(date.getTime() + offsetDiff);
}

module.exports = {
  parseDateTime,
  formatDateTime,
  floorTo15,
  floorToInterval,
  addMinutes,
  convertCentralToEastern,
  convertTimezone
};
