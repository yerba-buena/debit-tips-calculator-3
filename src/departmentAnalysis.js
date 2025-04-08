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
    let category = 'Unknown';
    
    // Apply the same logic used in tipAllocation.js but with improved matching
    const deptLower = dept.toLowerCase();
    if (deptLower.includes('boh') || 
        deptLower.includes('back of house')) {
      category = 'BOH';
      staffCategories.BOH += count;
    } 
    else if (deptLower.includes('exec') || 
             deptLower.includes('manager') || 
             deptLower.includes('management') ||
             deptLower.includes('gm')) {
      category = 'Exec';
      staffCategories.Exec += count;
    }
    else {
      category = 'FOH';
      staffCategories.FOH += count;
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
