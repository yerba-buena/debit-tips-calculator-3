# Tip Allocation

This Node.js package processes employee clock data and transaction tip data to fairly allocate tips based on configurable time intervals. It handles raw CSV pre-processing, splits shifts into configurable time chunks, computes tip pools, allocates individual shares, redistributes unallocated tips, and aggregates final totals per employee.

## Features

- **Configurable Time Intervals:**  
  Default is 15 minutes; you can specify any interval between 2 and 60 minutes that evenly divides 1440 minutes.

- **Fair Allocation:**  
  If an employee clocks out mid-interval, they are credited for the full interval. Unallocated tips from incomplete staffing are redistributed evenly among all employees working that day.

- **CSV Processing:**  
  Pre-processes raw clock times CSV (skipping header rows and totals) and transaction CSVs to generate multiple intermediate CSV files.

- **Test Suite:**  
  Includes unit tests, integration tests for individual modules, and full flow tests to ensure consistent behavior regardless of interval size.

## Getting Started

### Prerequisites

Ensure you have Node.js (version 14 or above is recommended) installed on your machine.

#### macOS

1. Install [Homebrew](https://brew.sh/) if you haven't already.
2. Install Node.js:
   ```bash
   brew install node
   ```
3. Verify installation:
   ```bash
   node -v
   npm -v
   ```

#### Setup

1. Clone the repository
2. Install dependencies
3. Project Structure Overview:
   ```
   tip-allocation/
   ├── package.json
   ├── README.md
   ├── src
   │   ├── index.js              # Main entry point
   │   ├── utils.js              # Utility functions (date parsing, etc.)
   │   ├── clockData.js          # Clock times CSV processing and interval expansion
   │   ├── transactions.js       # Transaction CSV processing
   │   └── tipAllocation.js      # Tip pooling, individual tip allocation, and redistribution
   └── tests
       ├── test-utils.js         # Unit tests for utility functions
       ├── test-clockData.js     # Tests for clock data processing
       ├── test-transactions.js  # Tests for transaction processing
       ├── test-tipAllocation.js # Tests for tip allocation logic
       └── test-flow-intervals.js# End-to-end integration tests with different interval sizes
   ```

### Running the Code

By default, the script expects the following files:
- Clock Times CSV: ./input-data/clock-times.csv
- Transactions CSV: ./input-data/transactions.csv

Outputs will be saved to ./output/.

You can run the script with default settings:
```bash
npm start
```

Or specify custom paths and interval size:
```bash
node src/index.js --clock ./input-data/clock-times.csv --transactions ./input-data/transactions.csv --output ./output/ --interval 15
```

#### Running the Tests

The package includes a comprehensive test suite using Mocha and Chai. To run all tests:
```bash
npm test
```

## Troubleshooting

- **CSV Format Issues:**
  The clock times CSV is pre-processed to remove header rows and totals. Ensure that the CSV in ./input-data/clock-times.csv follows the expected raw format.
  
- **Invalid Interval:**
  If an interval is provided that is not numeric, less than 2, greater than 60, or does not evenly divide 1440, the code will fall back to a default 15-minute interval with a warning.