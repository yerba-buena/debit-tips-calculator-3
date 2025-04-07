	1.	Data Range Checks:
– The script computes the date range from the clock data and from the transactions. It logs both ranges and throws an error if they don’t match.
	2.	Interval Tip Summary (Step 1):
– The full day is split into fixed intervals, and transactions are aggregated by interval (with tips split 85%/15%). The result is saved to a CSV.
	3.	Interval Employee Presence (Step 2):
– For each interval, the script determines the unique employees present (using deduplication) and logs the counts and names of FOH and BOH employees to a CSV.
	4.	Tip Allocation (Step 3):
– The tip pools for each interval are divided evenly among present employees. If one category is missing, that pool is marked as orphaned.
	5.	Redistribution (Step 4):
– All orphaned tips for each day are combined and redistributed evenly among all employees on duty that day.
	6.	Final Totals and Sanity Check (Step 5):
– Final allocations are aggregated per employee. The script checks that the sum of allocated tips matches the total transaction tips (within a tolerance) and throws an error if not.
	7.	Daily Summaries:
– Daily summaries are generated and saved as CSVs:
• Daily transaction summary (total tips and FOH/BOH split).
• Daily employee hours worked (from clock data).
• Daily employee tip allocation (per employee per day).
	8.	Final Output:
– The final aggregated tip totals for each employee are printed to the terminal and saved to a CSV.

This enhanced version logs intermediate CSVs and detailed daily summaries so that a human can manually inspect and verify the results. It also enforces date range matching and fails if the sanity check doesn’t pass.