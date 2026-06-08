SPECIALISTS CSV — Accepted formats for the "working_days" column
==================================================================

Any of the following are accepted (case-insensitive):

  Mon,Tue,Wed,Thu,Fri      (comma separated — recommended)
  Mon;Tue;Wed;Thu;Fri      (semicolons)
  Mon Tue Wed Thu Fri      (whitespace)
  Mon|Tue|Wed              (pipes)
  Monday, Tuesday          (full names)
  MWF  /  MTWRF            (single-letter codes: M T W R F)
  Mon-Fri                  (range — expands inclusive)
  All  /  Daily  /  Weekdays   (all 5 weekdays)
  (blank cell)             (defaults to Mon–Fri)

Day code map: M=Mon, T=Tue, W=Wed, R/Th=Thu, F=Fri

Other columns
-------------
- Quote any value containing commas, e.g. "Mon,Tue,Wed".
- Boolean columns (uses_cart, two_schools, is_part_time): yes/no, true/false, 1/0.
- Blank numeric columns fall back to defaults (planning=45, lunch=30).
- location may be left blank.

Tip: edit in Excel or Google Sheets — quoted cells round-trip safely.
