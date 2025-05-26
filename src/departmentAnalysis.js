const { categorizeDepartment } = require('./employeeClassification');

/**
 * Analyze department classifications from clock data
 * @param {Array} clockData - The clock data records
 * @returns {Object} Analysis results including departments, staff categories, and employee departments
 */
function analyzeDepartments(clockData) {
  const departments = {};
  const staffCategories = { FOH: 0, BOH: 0, Exec: 0, Unknown: 0 };
  const employeeDepts = {};
  
  // Count unique employees by department
  clockData.forEach(record => {
    const dept = record.Department;
    if (!departments[dept]) departments[dept] = new Set();
    departments[dept].add(record.Employee);
    
    employeeDepts[record.Employee] = dept;
  });
  
  // Determine category counts
  console.log('\nDepartment Classification Analysis:');
  console.log('----------------------------------');
  Object.keys(departments).sort().forEach(dept => {
    const count = departments[dept].size;
    
    // Use the centralized categorization logic
    const category = categorizeDepartment(dept);
    
    // Update the appropriate counter based on the category
    if (category === 'FOH') {
      staffCategories.FOH += count;
    } else if (category === 'BOH') {
      staffCategories.BOH += count;
    } else if (category === 'EXEC') {
      staffCategories.Exec += count;
    } else {
      staffCategories.Unknown += count;
    }
    
    console.log(`  ${dept}: ${count} employees (Classified as: ${category})`);
  });
  
  console.log('\nStaff Category Totals:');
  console.log(`  FOH: ${staffCategories.FOH} employees`);
  console.log(`  BOH: ${staffCategories.BOH} employees`);
  console.log(`  Exec: ${staffCategories.Exec} employees`);
  if (staffCategories.Unknown > 0) {
    console.log(`  Unknown: ${staffCategories.Unknown} employees`);
  }
  console.log('----------------------------------');
  
  return { departments, staffCategories, employeeDepts };
}

module.exports = {
  analyzeDepartments
};
