const fs = require('fs');
const { 
  readCSV, 
  loadTransactions, 
  processTransactions, 
  printTipsByDay, 
  saveTipsByDayToCSV 
} = require('../src/transactions');
const utils = require('../src/utils');

// Mock modules properly
jest.mock('fs', () => ({
  createReadStream: jest.fn(),
  writeFileSync: jest.fn()
}));

jest.mock('csv-parser', () => jest.fn(() => {
  const { Transform } = require('stream');
  const parser = new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      callback(null, chunk);
    }
  });
  return parser;
}));

jest.mock('../src/utils', () => ({
  floorToInterval: jest.fn(),
  convertTimezone: jest.fn(date => date),
  createStandardInterval: jest.fn((date, interval) => ({
    TimeSlotStart: new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0),
    Date: date.toISOString().split('T')[0]
  }))
}));

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

  test('should handle file read error with multiple errors', async () => {
    const mockErrors = [
      new Error('First error'),
      new Error('Second error')
    ];
    
    const mockStream = {
      pipe: jest.fn().mockReturnThis(),
      on: jest.fn().mockImplementation(function(event, callback) {
        if (event === 'error') {
          // Test multiple error handling
          mockErrors.forEach(err => callback(err));
        }
        return this;
      })
    };
    
    fs.createReadStream.mockReturnValue(mockStream);
    
    await expect(readCSV('nonexistent.csv')).rejects.toThrow('First error');
  });
});

describe('loadTransactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should load transactions from CSV file', async () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01 12:00:00', AmtTip: '5.00', Approved: 'Yes' }
    ];
    
    // Mock readCSV directly with jest.spyOn
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const mockStream = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn().mockImplementation(function(event, callback) {
          if (event === 'data') {
            mockTransactions.forEach(callback);
          }
          if (event === 'end') {
            callback();
          }
          return this;
        })
      };
      return mockStream;
    });
    
    const result = await loadTransactions('test.csv');
    expect(result).toEqual(mockTransactions);
  });
  
  test('should propagate errors from readCSV', async () => {
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const mockStream = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn().mockImplementation(function(event, callback) {
          if (event === 'error') {
            callback(new Error('CSV read error'));
          }
          return this;
        })
      };
      return mockStream;
    });
    
    await expect(loadTransactions('test.csv')).rejects.toThrow('CSV read error');
  });
  
  test('should handle empty transactions file', async () => {
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const mockStream = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn().mockImplementation(function(event, callback) {
          if (event === 'end') {
            callback();
          }
          return this;
        })
      };
      return mockStream;
    });
    
    const result = await loadTransactions('empty.csv');
    expect(result).toEqual([]);
  });
});

describe('processTransactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.convertTimezone.mockImplementation((date) => date);
    utils.createStandardInterval.mockImplementation((date, interval) => ({
      TimeSlotStart: new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0),
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

  test('should handle transactions spanning multiple days', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' },
      { TransDateTime: '2023-01-02T12:00:00', AmtTip: '3.50', Approved: 'Yes' }
    ];
    
    const result = processTransactions(mockTransactions);
    
    expect(result.length).toBe(2); // Two different days
    expect(result.find(r => r.Date === '2023-01-01')).toBeTruthy();
    expect(result.find(r => r.Date === '2023-01-02')).toBeTruthy();
  });

  test('should handle transactions with zero tips', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '0.00', Approved: 'Yes' }
    ];
    
    const result = processTransactions(mockTransactions);
    
    expect(result.length).toBe(1);
    expect(result[0].AmtTip).toBe(0);
  });

  test('should handle transactions with missing AmtTip field', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', Approved: 'Yes' }
    ];
    
    const result = processTransactions(mockTransactions);
    
    expect(result.length).toBe(1);
    expect(result[0].AmtTip).toBe(0); // Should default to 0
  });

  test('should handle transactions with negative tips', () => {
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '-5.00', Approved: 'Yes' }
    ];
    
    const result = processTransactions(mockTransactions);
    
    expect(result.length).toBe(1);
    expect(result[0].AmtTip).toBe(-5);
  });
});

describe('printTipsByDay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  test('should handle floating point math precision issues', () => {
    const mockTransactions = [
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T12:00:00'), AmtTip: 0.1 },
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T13:00:00'), AmtTip: 0.2 }
    ];
    
    const result = printTipsByDay(mockTransactions);
    expect(result[0].TipAmount).toBe('0.30'); // Should be 0.30, not 0.3000000000000001
  });

  test('should handle dates in different formats', () => {
    const mockTransactions = [
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T12:00:00'), AmtTip: 5.0 },
      { Date: '2023/01/02', TimeSlotStart: new Date('2023-01-02T12:00:00'), AmtTip: 3.0 } // Different date format
    ];
    
    const result = printTipsByDay(mockTransactions);
    expect(result.length).toBe(2);
  });

  test('should handle high precision decimal values correctly', () => {
    const mockTransactions = [
      { Date: '2023-01-01', TimeSlotStart: new Date('2023-01-01T12:00:00'), AmtTip: 5.999999 }
    ];
    
    const result = printTipsByDay(mockTransactions);
    expect(result[0].TipAmount).toBe('6.00'); // Should round to 6.00
  });
});

describe('saveTipsByDayToCSV', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  test('should handle quotes in field values', () => {
    const mockTipsData = [
      { Date: '2023-01-01', DayOfWeek: 'Sunday "Busy Day"', TipAmount: '8.50' }
    ];
    
    saveTipsByDayToCSV(mockTipsData, 'output.csv');
    
    const expectedCsvContent = 'Date,DayOfWeek,TipAmount\n2023-01-01,Sunday "Busy Day",$8.50';
    expect(fs.writeFileSync).toHaveBeenCalledWith('output.csv', expectedCsvContent);
  });

  test('should handle newlines in field values', () => {
    const mockTipsData = [
      { Date: '2023-01-01', DayOfWeek: 'Sunday\nMonday', TipAmount: '8.50' }
    ];
    
    saveTipsByDayToCSV(mockTipsData, 'output.csv');
    
    const expectedCsvContent = 'Date,DayOfWeek,TipAmount\n2023-01-01,Sunday\nMonday,$8.50';
    expect(fs.writeFileSync).toHaveBeenCalledWith('output.csv', expectedCsvContent);
  });

  test('should handle large numbers of records efficiently', () => {
    const mockTipsData = Array(1000).fill(null).map((_, i) => ({
      Date: `2023-01-${String(i % 31 + 1).padStart(2, '0')}`,
      DayOfWeek: 'Sunday',
      TipAmount: '8.50'
    }));
    
    saveTipsByDayToCSV(mockTipsData, 'output.csv');
    
    expect(fs.writeFileSync).toHaveBeenCalled();
    const csvContent = fs.writeFileSync.mock.calls[0][1];
    expect(csvContent.split('\n').length).toBe(1001); // Header + 1000 rows
  });
});

// Additional test suite for edge cases across multiple functions
describe('Integrated functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.convertTimezone.mockImplementation((date) => date);
    utils.createStandardInterval.mockImplementation((date, interval) => ({
      TimeSlotStart: new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0),
      Date: date.toISOString().split('T')[0]
    }));
  });

  test('should handle the full workflow from loading to saving', async () => {
    // Mock CSV reading
    const mockTransactions = [
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T12:30:00', AmtTip: '3.50', Approved: 'Yes' }
    ];
    
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const mockStream = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn().mockImplementation(function(event, callback) {
          if (event === 'data') {
            mockTransactions.forEach(callback);
          }
          if (event === 'end') {
            callback();
          }
          return this;
        })
      };
      return mockStream;
    });
    
    // Full workflow
    const transactions = await loadTransactions('test.csv');
    const processed = processTransactions(transactions, 30);
    const report = printTipsByDay(processed, 'tips_report.csv');
    
    // Verify results
    expect(transactions.length).toBe(2);
    expect(processed.length).toBe(2); // Two different 30-min time slots
    expect(report.length).toBe(1); // One day
    expect(report[0].TipAmount).toBe('8.50');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  test('should handle unexpected input data gracefully', async () => {
    // Mock various types of invalid data
    const mockTransactions = [
      { TransDateTime: 'invalid-date', AmtTip: '5.00', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: 'invalid-amount', Approved: 'Yes' },
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Maybe' }, // Invalid approval
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00' }, // Missing approval field
      { TransDateTime: '2023-01-01T12:00:00', AmtTip: '5.00', Approved: 'Yes' } // One valid record
    ];
    
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const mockStream = {
        pipe: jest.fn().mockReturnThis(),
        on: jest.fn().mockImplementation(function(event, callback) {
          if (event === 'data') {
            mockTransactions.forEach(callback);
          }
          if (event === 'end') {
            callback();
          }
          return this;
        })
      };
      return mockStream;
    });
    
    // Process the data
    const transactions = await loadTransactions('test.csv');
    const processed = processTransactions(transactions);
    
    // Verify only valid records are processed
    expect(transactions.length).toBe(5);
    expect(processed.length).toBe(1);
  });
});
