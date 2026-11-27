# Time in and time out: repeated punches and edge cases

How the app handles someone recording time in and time out more than once, too quickly, out of order, or not at all. The same rules run in the web app and the API (`lib/punch.ts`), and payroll counts the result with `lib/sessions.ts`.

## The rules

| Setting | Value | Why |
| --- | --- | --- |
| Same punch window | 2 minutes | The same kind again this soon is a double tap, a retry or a second device. The first punch stands and nothing new is saved. |
| Minimum gap | 1 minute | Time in and time out less than a minute apart is a mistake, not work. |
| Punches per day | 12 | Enough for breaks and split shifts. More than that needs a correction. |
| Offline punches | up to 72 hours old | A device queue can catch up after an outage. Older punches need a correction. |
| Clock ahead | 2 minutes | A punch time later than the server's clock by more than this is refused. |

Time in and time out alternate. A day can have several in and out pairs ("sessions"), for a lunch break, a split shift, or a time out by mistake.

## Every case

| What happens | What the app does | How payroll counts it |
| --- | --- | --- |
| Double tap on Record, or the app retries after a timeout | The second tap returns the first record. The button is also disabled while saving. API: `200` with `"duplicate": true` and the original record. | Once. |
| Phone and kiosk both record the same time in | The second one is the same punch (within 2 minutes) and returns the first. In Postgres, `record_punch()` takes a lock per person so two devices can't both pass the check (migration 0009). | Once. |
| Time in, then time out seconds later | Refused: "Your time in was 20 seconds ago. Wait at least a minute between time in and time out." | Nothing extra. |
| In, out, in, out minutes apart | Allowed. My time shows each session and a **Time in again** button after a time out. | Only time inside the sessions counts. Time away inside the schedule counts toward the unpaid break first. |
| Lunch break punched (out 12:00, in 13:00) | Allowed. | The hour away is the break, so the break isn't deducted again. A full day is still 8 hours. |
| Time out by mistake at 10:00, back at 12:00 | Allowed. | Two hours away: one is the break, the other is undertime. |
| Two time ins in a row | Refused: "You're already timed in since 9:00 AM. Record your time out first." | Old data with two ins: the second adds nothing. |
| Time out with no time in | Refused: "Record a time in first." (Unless an approved correction already added the time in.) | Old data with a stray time out: kept for the record, not paid. |
| **Forgot to time out, then timed in the next day** | The next day's time in works and starts a new day. The earlier day stays open: it shows **No time out** in My time and Attendance, a banner on My time says which day, and the person gets a notification that opens the correction form for that day ("Missing time out"). Asked once per day. | The open day is paid only for finished sessions, so time after the last time in is unpaid. The payslip says "N days with a time in but no time out. Unpaid until a time correction is approved." An approved correction closes the day and it is paid normally. |
| Overnight shift, time out after midnight | The time out up to 4 hours after the shift ends belongs to the night it started. | One work day, split by calendar date for holidays and night differential. |
| Overnight shift, break out at 2 AM and back at 3 AM | The time in stays on the same night because the shift is still running. | Same as a day-shift break. |
| Overnight shift, forgot to time out, next time in the next evening (or morning) | A time in only joins the previous night while that shift is still running, so this starts a new day and flags the night before. | As above. |
| Device offline, punches sent later | Accepted with their own times, up to 72 hours old. Older: "File a time correction instead." | As recorded. |
| Queued punch arrives after a later one, and would leave two outs in a row | Refused: "This time out clashes with the time out at 5:00 PM. File a correction instead." | Nothing extra. |
| Exact retry of the same offline punch | Same punch: returns the original. Postgres also has a unique index on person, kind and time. | Once. |
| Device clock ahead of the server | Refused when more than 2 minutes ahead. People's own punches always use the server time. | Nothing extra. |
| Time in at 5:00 for a 9:00 shift, out at 21:00 | Allowed: the record is evidence. | Only the scheduled 9:00 to 18:00 is paid. The 3 hours after the shift are flagged as "outside schedule, not filed" and are paid only with an approved overtime request. Arriving early isn't flagged. |
| More than 12 punches in a day | Refused: "File a time correction instead." | As recorded so far. |
| Payroll already finalized for that date | Refused: "File a correction or ask HR for an adjustment." | Unchanged. |

## Where to see it

- **My time:** the headline shows the last time out. **Time in again** appears after a time out, and a list of sessions appears when there is more than one. A banner names any earlier day with no time out, with **Request a fix**.
- **Attendance:** the No time out count and badge.
- **Notifications:** "No time out on <date>". It opens My time with the correction form filled in for that day.
- **API:** `POST /time-records` returns `unclosed_work_date` when this time in found an earlier day with no time out. A refusal is `409` with a message that says what to do, or `422` for a bad time.

## Not yet

- Closing an open day automatically at the shift end. Today it stays open until a correction, because inventing a time out would pay time nobody recorded.
- A daily reminder before the shift ends for anyone still timed in.
- Rules per company (window, gap, maximum punches).
