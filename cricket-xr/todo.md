# Cricket XR - Lag, Crouch, and Reset Bug Fixes

## Playbook: Bug Fix
- [x] 1. Reproduce it yourself on the matching surface via the driver skill
- [x] 2. Binary-search the cause. Form candidate hypotheses, rule them out with runtime evidence
- [x] 3. Plan the fix and implement with minimal diff
- [x] 4. Verify on the same surface. All reproduction and regression tests pass
- [x] 5. Stage the commits with tests and fixes
- [x] 6. Run Opening a PR (skip: local workspace without git remote)

## Tasks
- [x] Task 1: Fix Game Lag (slow motion):
  - Root cause: `dt = Math.min(dt, 0.05)` in `game.js:769` clamped frame delta to 50ms (20 FPS), causing slow-motion simulation whenever frame rate dipped.
  - Root cause: `sampleTrajectory()` allocated 31 `new Vector3()` instances on every frame during flight.
  - Root cause: `diagnostics.dom.innerHTML` executed layout reflows on every animation frame (60-90 Hz).
  - Fix: Increased delta-time clamp to `0.15` (150ms), preallocated trajectory vectors, and throttled DOM updates to 10 Hz.
- [x] Task 2: Implement Low Catch Crouch:
  - Added smooth knee-bend crouch (`this.crouchOffset`, up to -0.38m) driven by `isLowCatch` arrival target and downward gaze/head pitch (`focus.dir.y < -0.10`).
  - Applied crouch to `player.position.y` (`xrOrigin`), smoothly translating head, camera, and hands together without visual disjoint or VR discomfort.
  - Enables physical and emulated hands to comfortably reach shin, knee, and ground-level deliveries.
- [x] Task 3: Smooth Player Stance Reset:
  - During `feedback` and `ready` states, smoothly lerps `crouchOffset` back to `0.0` over 1.2s.
  - Restores player rig to exact `0.0m` neutral floor position before bowler launches the next delivery.
  - Never touches or corrupts physical headset tracking or floor reference space.
- [x] Task 4: Automated Verification:
  - Unit tests: 19/19 passed (including delta time 1:1 speed, crouch reach, and neutral reset).
  - Comprehensive catch audit: 25/25 passed.
  - Production build (`vite build`): Clean build, zero errors.
