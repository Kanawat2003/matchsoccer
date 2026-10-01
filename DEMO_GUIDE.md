# MatchSoccer — Professor Demo Guide

## Demo order (7–10 minutes)

1. Open MatchSoccer and show the home/search screen.
2. Show the venue list and select a location with multiple fields.
3. Demonstrate choosing Field A/B/C and viewing available time slots.
4. Log in as a player and create a booking.
5. Open Find Match and show the match/player discovery flow, including profile age/skill information where available.
6. Open the booking and demonstrate Split Bill: add members, generate share links, and show payment status.
7. Complete all member payments and close the bill. Show that the booking/match is removed from the active lists.
8. Switch to Owner view: show facility, multiple fields, field status and booking/notification information.
9. Switch to Admin view: show user/role management and venue review workflow.
10. Finish with the system highlights below.

## Key features

- Real-time field availability and booking confirmation.
- Multiple playable fields under one facility.
- Find teammates/opponents from an open match.
- Split field cost among members using share links.
- Payment-state validation prevents closing an unpaid bill.
- Role-based access: Player, Owner, Admin.
- Owner venue onboarding and Admin review/approval.
- Reliability / attendance tracking to reduce no-show problems.
- Session invalidation after password reset.
- Responsive UI for desktop and mobile layouts.

## QA status

- API smoke test: 8/8 passed.
- Booking → Match → Split Bill → Close E2E: passed.
- Share Link + Payment: passed.
- Duplicate payment prevention: passed.
- Auth session test: passed.
- Owner/Admin/User permission tests: passed.
- Reliability QA: passed.
- QA cleanup: passed.
- Production build: passed.

## Demo safety

Use dedicated presentation accounts rather than personal accounts. Do not display real passwords, tokens, or private user data during the presentation.

## Suggested closing statement

"MatchSoccer is designed not only to reserve a football field, but also to solve the coordination problems after booking: finding players, splitting costs, tracking participation, and managing venues through separate Player, Owner, and Admin roles."
