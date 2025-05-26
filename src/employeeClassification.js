/**
 * Functions for classifying employees and departments
 */

/**
 * Categorize an employee based on their title
 * @param {String} employeeTitle - The employee's title/name
 * @returns {String} - 'EXEC' if executive, null otherwise
 */
function categorizeByTitle(employeeTitle) {
  if (!employeeTitle) return null;
  
  // Check for executive titles
  if (employeeTitle.includes('CEO') ||
      employeeTitle.includes('COO') || 
      employeeTitle.includes('Chief Operations Officer') ||
      /\bC[A-Z]{2}\b/.test(employeeTitle)) { // Match any 3-letter C-suite title (CFO, CTO, CIO, etc.)
    return 'EXEC';
  }
  
  return null;
}

/**
 * Categorize a department as FOH, BOH, or Exec
 * @param {String} department - Name of the department
 * @returns {String} - 'FOH', 'BOH', or 'EXEC'
 */
function categorizeDepartment(department) {
  if (!department) return 'FOH'; // Default if no department
  
  const deptLower = department.toLowerCase();
  
  if (deptLower.includes('boh') || 
      deptLower.includes('back of house')) {
    return 'BOH';
  } 
  else if (deptLower.includes('exec') || 
           deptLower.includes('manager') || 
           deptLower.includes('management') ||
           deptLower.includes('gm')) {
    return 'EXEC';
  }
  else if (deptLower.includes('front')) {
    return 'FOH';
  }
  else {
    // Default to FOH for other departments
    return 'FOH';
  }
}

/**
 * Categorize an employee based on department and title
 * @param {Object} employee - Employee record with Department and Employee (name/title) fields
 * @returns {String} - 'FOH', 'BOH', or 'EXEC'
 */
function categorizeEmployee(employee) {
  // First check if they're an executive by title
  const titleCategory = categorizeByTitle(employee.Employee);
  if (titleCategory === 'EXEC') {
    return 'EXEC';
  }
  
  // Otherwise categorize by department
  return categorizeDepartment(employee.Department);
}

module.exports = {
  categorizeEmployee,
  categorizeDepartment,
  categorizeByTitle
};
