module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testMatch: ['**/test/**/*.test.js'],
  verbose: true,
  // Add transform for ES modules if needed
  transform: {}
};
