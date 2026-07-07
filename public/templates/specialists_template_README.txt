SPECIALISTS TEMPLATE — quick guide
==================================================================

Only TWO columns are required:

  name      the specialist's name          e.g. Swanson
  subject   what they teach                e.g. Art, Tech, PE, Music

Everything else is optional — leave it blank and set the details later
in the wizard (planning minutes, lunch, part-time, traveling cart,
two-school itinerants, and so on all have sensible defaults).

Optional columns
----------------
  working days   blank = Mon-Fri. Accepted formats (case-insensitive):
                   Mon,Tue,Wed,Thu,Fri    (comma separated — recommended)
                   Mon;Tue;Wed | Mon Tue Wed | Mon|Tue|Wed
                   Monday, Tuesday        (full names)
                   MWF / MTWRF            (letter codes: M T W R F)
                   Mon-Fri                (range — expands inclusive)
                   All / Daily / Weekdays (all 5 weekdays)
                 Day code map: M=Mon, T=Tue, W=Wed, R/Th=Thu, F=Fri
  room           room or location, e.g. D-1. May be blank.

You can also add columns like phone, email, planning, lunch, cart,
part time — the importer recognizes them, and anything it doesn't
recognize is handled by the AI fallback.

Tips
----
- Quote any value containing commas, e.g. "Mon,Tue,Wed".
- Edit in Excel or Google Sheets — quoted cells round-trip safely.
