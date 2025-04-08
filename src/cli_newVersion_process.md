Explanation
	1.	Clock Data Processing:
	•	The script cleans the raw clock CSV and processes each row.
	•	Then it groups and merges contiguous clock entries for each employee by day using groupAndMergeClockData().
	•	The merged clock data is saved as “employee_presence_ranges.csv.”
	2.	Transaction Data Processing:
	•	The transactions are processed, with transaction times floored relative to midnight and aggregated by interval.
	•	The interval tip summary (with total tips and the FOH/BOH splits) is saved as “interval_transaction_summary.csv.”
	3.	Employee Presence:
	•	The day is split into full-day intervals (from midnight to midnight).
	•	For each interval, the merged clock data is used to determine which employees were present.
	•	This deduplicated presence data (with counts and lists for FoH and BoH) is saved as “interval_employee_presence.csv.”
	•	An additional “interval_coverage_summary.csv” is created to log, per day, how many intervals had coverage versus none.
	4.	Tip Allocation:
	•	For each interval, the script checks for employee presence.
	•	If there’s no coverage for an interval but there are transaction tips, the script applies a fallback by using all employees from that day. (In this version, we throw an error if an interval with tips has zero presence; you might then see what fallback is applied.)
	•	Allocations are made according to the rules described, and any orphaned tips are recorded and written to “orphaned_tips.csv.”
	5.	Redistribution & Aggregation:
	•	All orphaned tips are aggregated per day and redistributed evenly among all employees on duty that day.
	•	The final per-employee totals are aggregated and saved as “final_employee_totals.csv.”
	6.	Daily Summary Pivot Table:
	•	The daily tip allocations per employee are pivoted into a table (with one row per employee and one column per day) and saved as “daily_employee_tip_summary.csv.”
	7.	Sanity Check:
	•	The script confirms that the sum of all allocated tips equals the total transaction tips. If not, it throws an error.
