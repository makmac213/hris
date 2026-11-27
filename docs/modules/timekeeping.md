# Timekeeping

Status: built (PR #1).

## Shift codes

Admin and HR manage shift codes at `/time/shift-codes`. There are nine Philippine defaults: whole-day shifts are 9 hours (8 paid plus a 1-hour meal break) and half-day shifts are 4 hours. Codes can be uploaded from a CSV (validated row by row before import), added one at a time, assigned to people in bulk, made the default for new hires, or archived. Each employee has one shift code on their profile, and that code decides what time is paid.

CSV columns: `code, name, kind, start_time, end_time, break_minutes, timezone, grace_minutes`.

## Recording time

Employees use **Record time** on `/my-time`. A record needs all three:

1. The time, set by the server, never the device.
2. A photo taken live with the device camera. **Uploading a picture is not allowed.**
3. The GPS location, with its accuracy.

The button stays disabled until the photo and location are ready. Timing out before the shift ends shows a warning with the undertime it will cause. Every step has a state: starting the camera, camera blocked, retake, waiting for GPS, location blocked with a retry, and a server error.

## Fixing records

Records are never edited. If a time is missing or wrong, the employee files a **time correction request** (see [payroll](payroll.md)). When it's approved, a new record with `source = correction` is added next to the original, and attendance and pay use it.

## Attendance

Admin and HR see who timed in on each recent workday at `/time`, against their shift, with filters for late, not timed in and no time out. Selecting a row shows the photos, coordinates, GPS accuracy and device.

Schema: `0002_timekeeping.sql` (roles, shift_codes, time_records), extended in `0003_payroll.sql`.
