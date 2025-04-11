const fs = require('fs');
const { 
  readCSV, 
  loadTransactions, 
  processTransactions, 
  printTipsByDay, 
  saveTipsByDayToCSV 
} = require('../src/transactions');
const { convertTimezone, createStandardInterval } = require('../src/utils');

// Mock dependencies
jest.mock('fs');
jest.mock('csv-parser', () => {
  return () => {
    const { Transform } = require('stream');
    const parser = new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      }
    });
    return parser;
  };
});
jest.mock('../src/utils');

describe('readCSV', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should read CSV file successfully', async () => {
    // Mock data
    const mockData = [{ id: 1, name: 'Test' }];
    
    // Setup mock implementation
    const mockStream = {
      pipe: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation(function(event, callback) {
        if (event === 'data') {
          mockData.forEach(callback);
        }
        if (event === 'end') {
          callback();
        }
        return this;
      })
    };
    
    fs.createReadStream.mockReturnValue(mockStream);
    
    const result = await readCSV('test.csv');
    expect(result).toEqual(mockData);
    expect(fs.createReadStream).toHaveBeenCalledWith('test.csv');
  });
  
  test('should handle file read error', async () => {
    const mockError = new Error('File read error');
    
    const mockStream = {
      pipe: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation(function(event, callback) {
        if (event === 'error') {
          callback(mockError);
        }
        return this;
      })
    };
    
    fs.createReadStream.mockReturnValue(mockStream);
    
    await expect(readCSV('nonexistent.csv')).rejects.toThrow('File read error');
  });
  
  test('should handle empty CSV file', async () => {
    const mockStream = {
      pipe: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation(function(event, callback) {
        if (event === 'end') {
          callback();
        }
        return this;
      })
    };
    
    fs.createReadStream.mockReturnValue(mockStream);
    
    const result = await readCSV('empty.csv');
    expect(result).toEqual([]);
  });
});

describe('loadTransactions', () => {
  test('should load transactions from CSV file', async () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01 12:00:00', AmtTip: '5.00', Approved: 'Yes' }
    ];
    
    // Mock readCSV to return our test data
    jest.spyOn(require('../src/transactions'), 'readCSV').mockResolvedValue(mockTransactions);
    
    const result = await loadTransactions('test.csv');
    expect(result).toEqual(mockTransactions);
  });
  
  test('should propagate errors from readCSV', async () => {
    jest.spyOn(require('../src/transactions'), 'readCSV').mockRejectedValue(new Error('CSV read error'));
    
    await expect(loadTransactions('test.csv')).rejects.toThrow('CSV read error');
  });
});

describe('processTransactions', () => {
  beforeEach(() => {
    convertTimezone.mockImplementation((date, from, to) => {
      // Mock timezone conversion by just returning the date
      return date;
    });
    createStandardInterval.mockImplementation((date, interval) => ({
      TimeSlotStart: new Date(date.setMinutes(0, 0, 0)),
      Date: date.toISOString().split('T')[0]
    }));
  });
  
  test('should process transactions with default parameters', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T12:10:00', AmtTip: '3.50', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T13:00:00', AmtTip: '2.00', Approved: 'Yes' }
    ];
    
    const result = processTransactions(mockTransactions);
    
    expect(result.length).toBe(2); // Two different time slots
    expect(result.find(r => r.AmtTip === 8.5)).toBeTruthy(); // 5.00 + 3.50
    expect(result.find(r => r.AmtTip === 2.0)).toBeTruthy();
  });
  
  test('should filter out non-approved transactions', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T12:10:00', AmtTip: '3.50', Approved: 'No' }
    ];
    
    const result = processTransactions(mockTransactions);
    
    expect(result.length).toBe(1);
    expect(result[0].AmtTip).toBe(5.0);
  });
  
  test('should handle case insensitivity in Approved field', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'yes' },
      { TransDateTime: '2023-01-01T12:10:00', AmtTip: '3.50', Approved: 'YES' }
    ];
    
    const result = processTransactions(mockTransactions);
    expect(result.length).toBe(1);
    expect(result[0].AmtTip).toBe(8.5);
  });
  
  test('should handle different interval sizes', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T12:30:00', AmtTip: '3.50', Approved: 'Yes' }
    ];
    
    // Mock for 30-minute intervals
    createStandardInterval.mockImplementation((date, interval) => {
      return {
        TimeSlotStart: new Date(date),
        Date: date.toISOString().split('T')[0]
      };
    });
    
    const result = processTransactions(mockTransactions, 30);
    
    expect(result.length).toBe(2); // With 30-min intervals these are different slots
  });
  
  test('should handle empty transaction list', () => {
    const result = processTransactions([]);
    expect(result.length).toBe(0);
  });
  
  test('should skip transactions with invalid data', () => {
    const mockTransactions = [
      { TransDateTime: 'invalid-date', AmtTip: '5.00', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: 'invalid-amount', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T13:00:00', AmtTip: '2.00', Approved: 'Yes' }
    ];
    
    const result = processTransactions(mockTransactions);
    expect(result.length).toBe(1);
  });
  
  test('should disable timezone conversion when convertTz is false', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' }
    ];
    
    processTransactions(mockTransactions, 15, false);
    expect(convertTimezone).not.toHaveBeenCalled();
  });
  
  test('should use custom timezone parameters', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' }
    ];
    
    processTransactions(mockTransactions, 15, true, 'America/Los_Angeles', 'Europe/London');
    expect(convertTimezone).toHaveBeenCalledWith(expect.any(Date), 'America/Los_Angeles', 'Europe/London');
  });
});

describe('printTipsByDay', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    fs.writeFileSync.mockClear();
  });
  
  test('should print tips by day correctly', () => {
    const mockTransactions = [
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T12:00:00'), AmtTip: 5.0 },
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T13:00:00'), AmtTip: 3.5 },
      { Date: '2023-01-02', TimeSlotStart: new Date('2023-01-02T12:00:00'), AmtTip: 2.0 }
    ];
    
    const result = printTipsByDay(mockTransactions);
    
    expect(result.length).toBe(2); // Two different days
    expect(result.find(r => r.Date === '2023-01-01' && r.TipAmount === '8.50')).toBeTruthy();
    expect(result.find(r => r.Date === '2023-01-02' && r.TipAmount === '2.00')).toBeTruthy();
    expect(console.log).toHaveBeenCalledWith("Tips by Day:");
  });
  
  test('should handle empty transaction list', () => {
    const result = printTipsByDay([]);
    expect(result.length).toBe(0);
  });
  
  test('should save to CSV if filepath is provided', () => {
    const mockTransactions = [
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T12:00:00'), AmtTip: 5.0 }
    ];
    
    printTipsByDay(mockTransactions, 'output.csv');
    
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
  
  test('should handle fractional tip amounts correctly', () => {
    const mockTransactions = [
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T12:00:00'), AmtTip: 5.123 }
    ];
    
    const result = printTipsByDay(mockTransactions);
    expect(result[0].TipAmount).toBe('5.12');
  });
  
  test('should sort days in ascending order', () => {
    const mockTransactions = [
      { Date: '2023-01-03', TimeSlotStart: new Date('2023-01-03T12:00:00'), AmtTip: 3.0 },
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T12:00:00'), AmtTip: 1.0 },
      { Date: '2023-01-02', TimeSlotStart: new Date('2023-01-02T12:00:00'), AmtTip: 2.0 }
    ];
    
    const result = printTipsByDay(mockTransactions);
    expect(result[0].Date).toBe('2023-01-01');
    expect(result[1].Date).toBe('2023-01-02');
    expect(result[2].Date).toBe('2023-01-03');
  });
});

describe('saveTipsByDayToCSV', () => {
  beforeEach(() => {
    fs.writeFileSync.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  
  test('should save tips data to CSV', () => {
    const mockTipsData = [
      { Date: '2023-01-01', DayOfWeek: 'Sunday', TipAmount: '8.50' },
      { Date: '2023-01-02', DayOfWeek: 'Monday', TipAmount: '2.00' }
    ];
    
    saveTipsByDayToCSV(mockTipsData, 'output.csv');
    
    const expectedCsvContent = 'Date,DayOfWeek,TipAmount\n2023-01-01,Sunday,$8.50\n2023-01-02,Monday,$2.00';
    expect(fs.writeFileSync).toHaveBeenCalledWith('output.csv', expectedCsvContent);
    expect(console.log).toHaveBeenCalledWith('Tips by day data saved to output.csv');
  });
  
  test('should handle empty data', () => {
    saveTipsByDayToCSV([], 'output.csv');
    
    const expectedCsvContent = 'Date,DayOfWeek,TipAmount\n';
    expect(fs.writeFileSync).toHaveBeenCalledWith('output.csv', expectedCsvContent);
  });
  
  test('should handle file system errors', () => {
    const mockTipsData = [
      { Date: '2023-01-01', DayOfWeek: 'Sunday', TipAmount: '8.50' }
    ];
    
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    
    // Wrap in a function to catch the error
    expect(() => saveTipsByDayToCSV(mockTipsData, 'output.csv')).toThrow('Permission denied');
  });
  
  test('should handle special characters in CSV data', () => {
    const mockTipsData = [
      { Date: '2023-01-01', DayOfWeek: 'Sunday, Fun Day', TipAmount: '8.50' }
    ];
    
    saveTipsByDayToCSV(mockTipsData, 'output.csv');
    
    const expectedCsvContent = 'Date,DayOfWeek,TipAmount\n2023-01-01,Sunday, Fun Day,$8.50';
    expect(fs.writeFileSync).toHaveBeenCalledWith('output.csv', expectedCsvContent);
  });
});
