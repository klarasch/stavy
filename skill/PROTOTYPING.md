# Prototyping approach (optional)

Stavy doesn't care how much of the app is real; it shows what's there. This
file is a starting point for teams who want their agents to keep a prototype
a prototype. Edit it freely, or delete it.

- **Mock the UI, not the business.** Screens, states, interactions and copy
  are the point. Data comes from seeded fixtures in the browser; no real
  backends, auth or persistence unless the team asks for them.
- **Add behaviour only when a flow needs it.** A static state is enough until
  a review needs to click through it. Then make it navigable, and only then
  interactive.
- **Presentation states over production logic.** For async processes, build
  scenes that freeze a meaningful moment (import at 62%, sync failed: auth
  expired) instead of a full job system.
- **Agree the board's outline first.** Which questions will the review
  answer? Build the states those need, not every state the app could have.
- **Say what's fake.** If something looks real but isn't (a payment, an
  email), note it on the board or in the doc.
