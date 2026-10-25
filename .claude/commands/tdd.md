---
description: Implement a change test-first
argument-hint: <what to build or fix>
---

Implement: $ARGUMENTS

1. Restate the behaviour as one or more test cases. Ask if the intended behaviour is ambiguous.
2. Write the failing test(s) first. Run them and show that they fail for the right reason.
3. Write the smallest implementation that makes them pass.
4. Refactor with the tests green.
5. Run `npm run verify` and read the output. Report failures honestly; do not claim done until it is green.
