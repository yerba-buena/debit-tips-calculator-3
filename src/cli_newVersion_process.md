Explanation
	1.	Data Range Checks:
The script computes and logs the date ranges for both clock data and transaction data. If they don’t match, an error is thrown.
	2.	Interval Tip Summary:
The day is split into intervals (midnight–midnight) and transactions are aggregated (after flooring relative to midnight) to produce an interval summary (with FOH and BOH pools). This summary is saved to “interval_tip_summary.csv”.
	3.	Employee Presence:
The clock data is cleaned and processed. For each interval, a deduplicated list of employees present (separately for FOH and BOH) is determined and written to “interval_employee_presence.csv”.
	4.	Tip Allocation with Improved Logic:
In each interval, if one department is missing, its tip pool is added to the other (if present). If both are missing, the tip becomes orphaned. The orphaned tips are recorded and then output to “orphaned_tips.csv”.
	5.	Redistribution of Orphaned Tips:
Orphaned tips for each day are aggregated and redistributed evenly among all on‑duty employees (from clock data).
	6.	Daily Summaries:
Daily summaries for transaction totals (with orphaned amounts), employee hours, and daily tip allocations are generated and saved as CSVs.
	7.	Sanity Check:
The script compares the total transaction tips with the total allocated tips. If the difference exceeds a small tolerance, an error is thrown.
	8.	Final Totals:
The final aggregated tip totals per employee are printed to the terminal and saved to “final_employee_totals.csv”.

This updated version ensures that no tips remain unapplied by reassigning orphaned tip pools when one department is absent and by redistributing any remaining orphaned amounts across all on‑duty employees. All steps are logged via CSV outputs for manual inspection.