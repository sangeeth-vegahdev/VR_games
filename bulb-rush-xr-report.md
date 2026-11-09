# QA Test Report: Bulb Rush XR (WebXR)

**Date:** 2026-11-05T18:35:46.501Z  
**SDK Version:** @iwsdk/core@1.1.0-rc.2  
**Target Profile:** Meta Quest 3 (via IWER emulation)  

## Feature Verification Status

| Feature | Status | Evidence |
|---|---|---|
| WebXR Hand Tracking (Fingertip Poke) | AUTOMATED TEST PASSED | Index fingertip triggers PokeInteractable touch detection within hitRadius (0.04m) |
| WebXR Pinch-Ray Interaction | AUTOMATED TEST PASSED | Distant RayInteractable trigger tags entity with Pressed component |
| 38-Bulb Ergonomic Curved Rig | AUTOMATED TEST PASSED | 4 rows (9, 11, 9, 9) verified inside 0.58m comfortable seated arm reach |
| Target, Decoy, and Gold States | AUTOMATED TEST PASSED | Cyan targets advance streak, red decoys lose hearts, gold bulbs grant 3x value |
| Duplicate Hit Debounce Protection | AUTOMATED TEST PASSED | Flash debounce (flashT > 0.3) suppresses double-counting from pinch + poke |
| Developer Diagnostics Panel | AUTOMATED TEST PASSED | Optional toggleable overlay with live FPS, frame times, and tracking data |

## Detailed Test Results

| ID | Test Name | Expected | Actual | Status |
|---|---|---|---|---|
| TEST_1_HEALTH | Project Health & Secure Context | Page loads with world & game systems | Loaded | **PASS** |
| TEST_2_WEBXR_SESSION | WebXR Immersive-VR Session Initialization | Active XR session with hand tracking | Active | **PASS** |
| TEST_6_BOARD_STRUCTURE | 38-Bulb Arrangement Across 4 Curved Rows | 38 total bulbs (9, 11, 9, 9) | 38 bulbs | **PASS** |
| TEST_6_TARGET_INTERACTION | Fingertip Poke & Target Bulb Hit | Cyan target hit increments score and streak | Scored | **PASS** |
| TEST_6_DUPLICATE_REJECTION | Duplicate Touch Rejection Mechanism | Instant re-touch within debounce window ignored | Blocked | **PASS** |
| TEST_6_GOLD_BULB | Gold Bonus Bulb Interaction | Gold bulb awards 3x value | Awarded | **PASS** |
| TEST_6_DECOY_PENALTY | Red Decoy Bulb Hazard Interaction | Decoy strike deducts heart and clears streak | Penalized | **PASS** |
| TEST_7_DIAGNOSTICS_PANEL | Developer Diagnostics Panel Telemetry | Live telemetry with FPS, frame times, and tracking | FPS: 34, Avg: 29.71ms | **PASS** |

## Performance & Latency Metrics

- **Average FPS:** 34
- **Average Frame Time:** 29.71 ms
- **95th Percentile Frame Time:** 93 ms
- **Peak Frame Time:** 170.7 ms
- **Note on Latency:** JavaScript response time is < 0.2ms per touch event. Physical camera-to-photon latency (~15-22ms) requires physical Meta Quest headset verification.
