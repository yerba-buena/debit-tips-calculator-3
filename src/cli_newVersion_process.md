Explanation
	1.	Data Range Checks:
– The script computes and logs the date ranges for clock data and transactions. It throws an error if they do not match.
	2.	Interval Tip Summary (Step 1):
– Full‑day intervals are generated and transactions are aggregated per interval. The resulting summary (with total tips, FOH tip pool, and BOH tip pool) is saved to “interval_tip_summary.csv.”
	3.	Interval Employee Presence (Step 2):
– For each interval, the unique list of employees (deduplicated by name) is determined, and counts (and names) for FOH and BOH are output to “interval_employee_presence.csv.”
	4.	Tip Allocation (Step 3):
– The tip pools for each interval are allocated evenly to present employees. If a department is missing, that pool is recorded as orphaned (with a “Department” field added).
	5.	Orphaned Tips CSV (Step 4):
– All orphaned tips (from missing FOH or BOH in an interval) are output to “orphaned_tips.csv” so a human can inspect the values.
	6.	Redistribution (Step 5):
– Orphaned tips are aggregated per day and redistributed evenly among all on‑duty employees.
	7.	Aggregation and Daily Summaries:
– Final totals per employee are computed.
– Daily summaries are generated: the daily transaction summary now includes a column for total orphaned tips. Daily employee hours and daily tip allocations per employee are also computed and saved.
	8.	Sanity Check & Final Output:
– A sanity check ensures that the total allocated tips match the total transaction tips. If the check fails, an error is thrown.
– The final overall employee totals are written to “final_employee_totals.csv” and printed to the terminal.

This enhanced version produces several CSVs at key steps—including a dedicated orphaned tips CSV—so that a human can manually inspect the orphaned tip logic and verify all calculations.
