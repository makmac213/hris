# Design critique (impeccable.style method)

Each phase is reviewed screen by screen against impeccable.style's slop list and its hierarchy, clarity and craft criteria, then fixed. Screenshots of each review are in the project files under `hris-prototype/screenshots/`.

## Employee management review

| Severity | Finding | Fix |
| --- | --- | --- |
| P1 | Every directory row had a green "Active" badge, so the rows that needed attention didn't stand out. | Active is now plain muted text. Badges appear only for Onboarding, On leave and Former. |
| P1 | The org chart cut off the sixth executive at desktop width. | Narrower nodes, a fit-to-width zoom that runs on load, and zoom controls. |
| P1 | Focusing a person in the org chart scrolled the whole page and moved the sidebar. | The chart now scrolls only inside its own canvas. |
| P1 | The "Overdue" due date on a checklist task was grey because the base style overrode the danger colour. | The overdue date is now red, and overdue next tasks are flagged on the onboarding list too. |
| P1 | In the add-employee form, an old email error stayed visible after the email was filled in automatically. | Editing the name now clears the email error. |
| P2 | The closed mobile sidebar could still take keyboard focus. | It is hidden from focus and screen readers when closed. |
| P2 | Picking a buddy didn't tick the "Choose an onboarding buddy" task. | The two are linked. |
| P2 | Long emails overflowed the profile panel on phones. | They now wrap. |
| P2 | Each org chart node had four lines of text, which made the chart noisy. | The department line was removed. Use "Highlight a department" instead. |

Things that were checked and pass: every input has a visible label (no placeholder-only labels), there is one primary action per screen, heading levels are in order, targets are at least 32px (40px for main controls), focus rings are visible, there are empty and not-found states, long names are handled (`Max von Hohenberg-Castellanos`), there are no nested cards, no gradient accents, no eyebrow labels and no metric-tile grids.

## Timekeeping review

| Severity | Finding | Fix |
| --- | --- | --- |
| P1 | An employee could time out hours before the end of their shift without any warning. | The dialog now says when the shift ends and how much will count as undertime. The day then shows "timed out early". |
| P1 | Every shift-code row had three text buttons (Assign, Make default, Archive), so the table was a wall of equal-weight actions. | One "Assign people" button per row. The other actions moved into a "more" menu. |
| P1 | The labels mixed "clocked in" and "timed in". | Everything now says "time in" and "time out", matching "Record Time". |
| P2 | Number headers were right-aligned over left-aligned values. | Headers and values now line up. |
| P2 | Shift codes like OPS-D0730 wrapped onto two lines in the upload preview. | Codes no longer wrap. |
| P2 | The Attendance and Shift codes pages gave different counts of people without a shift code. | Both pages now use the same rule. |

The Record Time flow has a state for every step: starting the camera, camera blocked, retake, waiting for GPS, location blocked with a retry, and a server error. Photos must come from the live camera. Uploading a file is not allowed (removed in the payroll phase). The single-file preview runs where browsers block the camera and GPS, so only there it offers "use sample photo (preview only)" and "use office location (preview only)". Those come from a build flag and are never in the Next.js app.

## Payroll, overtime and corrections review

| Severity | Finding | Fix |
| --- | --- | --- |
| P1 | The register's total adjustments read "₱-2,112.64": a hyphen, the sign after the currency, and not red. | All money formats negatives as `−₱2,112.64` (true minus sign) and the total uses the deduction colour. |
| P1 | An employee could request a correction for a time out later today, before it had happened. | Corrected times in the future are rejected with "That time hasn't happened yet". |
| P1 | A photo could be uploaded from a file instead of taken live, which defeats the proof. | File upload removed. Only the live camera is accepted. |
| P1 | Finalizing payroll was possible while overtime or correction requests were still pending, or with someone below minimum wage. | Finalize is disabled with the reason shown until the period has ended, nothing is pending and nobody is below the wage floor. |
| P2 | Overtime requests gave approvers nothing to check against. | Each request shows how much of it the time records cover; only the covered part is paid. |
| P2 | Rejecting a request without a reason left the employee guessing. | A note is required to reject. |
| P2 | Payslip lines didn't say how they were worked out. | Each line has its basis underneath (hours, rate, multiplier, salary credit), and the payslip has a day-by-day breakdown. |

Checked and passing: the payslip reads top to bottom as earnings, time not worked, gross, contributions, tax and net, with one hero number; the open-period payslip says it is a projection; managers only see approvals for their own team and never their own requests; managerial staff can't file overtime and are told why (Art. 82); the employee pages have no horizontal overflow at 390px.
